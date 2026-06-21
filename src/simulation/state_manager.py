"""
State Manager — Maintains the current city-wide traffic state.

Loads the road graph, traffic data, and ML models at startup.
For every road segment, tracks: current speed, congestion, capacity,
flow, and active events.
"""
from __future__ import annotations

import copy
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

import numpy as np
import pandas as pd
import networkx as nx

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
GRAPH_PATH = DATA_DIR / "bangalore_graph.graphml"
TRAFFIC_PATH = DATA_DIR / "traffic_timeseries.csv"
EDGES_PATH = DATA_DIR / "edges.csv"

# ---------------------------------------------------------------------------
# Singleton city state
# ---------------------------------------------------------------------------
_state: Optional["CityState"] = None


class CityState:
    """In-memory snapshot of every road segment's traffic state."""

    def __init__(self):
        self.roads: Dict[str, Dict[str, Any]] = {}
        self.active_events: List[Dict[str, Any]] = []
        self._graph: Optional[nx.MultiDiGraph] = None
        self._baseline: Dict[str, Dict[str, Any]] = {}
        self._loaded = False

    # ------------------------------------------------------------------
    # Bootstrap
    # ------------------------------------------------------------------
    def load(self) -> None:
        """Load graph, traffic data, and initialise per-road state."""
        if self._loaded:
            return

        logging.info("CityState: loading road graph from %s …", GRAPH_PATH)
        from src.graph_builder import load_bangalore_graph
        self._graph = load_bangalore_graph()

        # Build per-edge state from graph attributes
        for u, v, k, data in self._graph.edges(keys=True, data=True):
            eid = data.get("edge_id")
            if not eid:
                continue

            road = {
                "edge_id": eid,
                "u": u,
                "v": v,
                "road_name": data.get("road_name", "Unknown"),
                "road_type": data.get("road_type", "unclassified"),
                "speed_limit": float(data.get("speed_kmph", 30.0) or 30.0),
                "current_speed": float(data.get("speed_kmph", 30.0) or 30.0),
                "capacity": int(data.get("capacity", 1800) or 1800),
                "flow": float(data.get("current_flow", 0.0) or 0.0),
                "congestion": 0.0,
                "density": 0.0,
                "length_m": float(data.get("length_meter", data.get("length", 100.0)) or 100.0),
                "lanes": int(data.get("lanes", 1) or 1),
                "status": "normal",
                "events": [],
            }
            self.roads[eid] = road

        # Overlay traffic time-series data if available
        if TRAFFIC_PATH.exists():
            logging.info("CityState: overlaying traffic_timeseries.csv …")
            df = pd.read_csv(TRAFFIC_PATH)
            # Use last row per edge_id as the "current" observation
            latest = df.sort_values("timestamp" if "timestamp" in df.columns else df.columns[0])
            latest = latest.groupby("edge_id").last().reset_index()
            for _, row in latest.iterrows():
                eid = str(row["edge_id"])
                if eid in self.roads:
                    self.roads[eid]["current_speed"] = float(row.get("speed", self.roads[eid]["current_speed"]))
                    self.roads[eid]["congestion"] = float(row.get("congestion_score", 0.0))
                    self.roads[eid]["density"] = float(row.get("density", 0.0))
                    self.roads[eid]["flow"] = float(row.get("flow", 0.0))

        # Save baseline for reset
        self._baseline = copy.deepcopy(self.roads)
        self._loaded = True
        logging.info("CityState: loaded %d road segments.", len(self.roads))

    # ------------------------------------------------------------------
    # Accessors
    # ------------------------------------------------------------------
    @property
    def graph(self) -> nx.MultiDiGraph:
        self.load()
        return self._graph

    def get_current_state(self) -> Dict[str, Dict[str, Any]]:
        """Return a shallow copy of the full city road state dictionary."""
        self.load()
        return dict(self.roads)

    def get_road(self, edge_id: str) -> Optional[Dict[str, Any]]:
        """Return state dict for a single road, or None."""
        self.load()
        return self.roads.get(edge_id)

    # ------------------------------------------------------------------
    # Mutators
    # ------------------------------------------------------------------
    def update_road_state(self, edge_id: str, **kwargs) -> None:
        """Update arbitrary fields on a road segment."""
        self.load()
        if edge_id not in self.roads:
            logging.warning("CityState: edge %s not found, skipping update.", edge_id)
            return
        self.roads[edge_id].update(kwargs)

    def apply_event(self, event: Dict[str, Any], affected_edge_id: str) -> None:
        """Attach an event to a road and degrade its traffic state."""
        self.load()
        self.active_events.append({**event, "affected_edge_id": affected_edge_id})

        if affected_edge_id in self.roads:
            impact = float(event.get("impact_score", 0.5))
            rd = self.roads[affected_edge_id]
            rd["congestion"] = min(1.0, rd["congestion"] + impact)
            rd["current_speed"] = max(1.0, rd["speed_limit"] * (1.0 - impact))
            rd["status"] = "incident"
            rd["events"].append(event.get("type", "unknown"))

    def apply_congestion_map(self, congestion_map: Dict[str, float]) -> None:
        """Bulk-update congestion values (e.g. from ST-GNN output)."""
        self.load()
        for eid, cong in congestion_map.items():
            if eid in self.roads:
                self.roads[eid]["congestion"] = float(min(1.0, cong))
                spd_limit = self.roads[eid]["speed_limit"]
                self.roads[eid]["current_speed"] = max(1.0, spd_limit / (1.0 + 0.15 * (cong ** 4)))

    def reset_state(self) -> None:
        """Reset all roads back to their baseline values."""
        self.roads = copy.deepcopy(self._baseline)
        self.active_events.clear()
        logging.info("CityState: reset to baseline.")


def get_city_state() -> CityState:
    """Return the singleton CityState instance, lazily initialised."""
    global _state
    if _state is None:
        _state = CityState()
        _state.load()
    return _state
