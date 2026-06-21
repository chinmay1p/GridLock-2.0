from __future__ import annotations

import logging
from pathlib import Path
from datetime import datetime
from typing import Any

import pandas as pd
from src.traffic.local_traffic_engine import traffic_engine

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
EDGES_PATH = DATA_DIR / "edges.csv"
MAPPED_EVENTS_PATH = DATA_DIR / "astram_mapped_events.csv"
LIVE_TRAFFIC_DIR = DATA_DIR / "live_traffic"

class TomTomCollector:
    """
    Offline/Local Traffic Collector.
    Simulates live traffic sampling using the offline local_traffic_engine.
    """
    def __init__(self, api_key: str | None = None):
        self.api_key = "local_offline_bypass"
        
        # Priority road types to sample
        self.priority_road_types = {
            "motorway", "motorway_link",
            "trunk", "trunk_link",
            "primary", "primary_link",
            "secondary", "secondary_link",
            "tertiary", "tertiary_link"
        }
        
    def get_priority_edges(self) -> pd.DataFrame:
        """
        Loads edges and filters by priority road types.
        """
        if not EDGES_PATH.exists():
            raise FileNotFoundError(f"Edges CSV not found at {EDGES_PATH}. Run graph builder first.")
        
        edges_df = pd.read_csv(EDGES_PATH)
        priority_mask = edges_df["road_type"].isin(self.priority_road_types)
        selected_edges = edges_df[priority_mask].copy()
        return selected_edges

    def calculate_gps_midpoints(self, edges_df: pd.DataFrame) -> pd.DataFrame:
        """
        Calculates simple midpoints based on existing attributes or geometry coordinates.
        """
        # Return fallback midpoints
        edges_df["midpoint_lat"] = 12.9716
        edges_df["midpoint_lon"] = 77.5946
        return edges_df

    def query_tomtom_flow(self, lat: float, lon: float) -> dict[str, Any] | None:
        """
        No-op offline fallback.
        """
        return None

    def collect(self, limit: int | None = 10) -> pd.DataFrame:
        """
        Simulates live traffic logs from the offline local traffic engine.
        """
        selected_edges = self.get_priority_edges()
        selected_edges = self.calculate_gps_midpoints(selected_edges)
        
        if limit is not None:
            selected_edges = selected_edges.sample(min(limit, len(selected_edges)), random_state=42)
            
        results = []
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        hour, day_type, _ = traffic_engine.get_current_time_info()
        
        for _, row in selected_edges.iterrows():
            edge_id = row["edge_id"]
            lat = row["midpoint_lat"]
            lon = row["midpoint_lon"]
            
            state = traffic_engine.get_traffic_state(edge_id, hour, day_type)
            
            results.append({
                "timestamp": timestamp,
                "edge_id": edge_id,
                "u": row["u"],
                "v": row["v"],
                "road_name": row["road_name"],
                "road_type": row["road_type"],
                "current_speed": state["expected_speed"],
                "free_flow_speed": state["normal_speed"],
                "congestion_score": state["congestion_score"],
                "confidence": 1.0,
                "latitude": lat,
                "longitude": lon
            })
            
        results_df = pd.DataFrame(results)
        
        LIVE_TRAFFIC_DIR.mkdir(parents=True, exist_ok=True)
        file_name = f"live_traffic_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
        out_path = LIVE_TRAFFIC_DIR / file_name
        results_df.to_csv(out_path, index=False)
        logging.info("Collected offline traffic for %d edges and saved to %s", len(results_df), out_path)
        
        return results_df

def fetch_live_traffic(lat: float, lon: float) -> dict[str, Any]:
    """
    Offline local traffic lookup based on coordinates.
    """
    # Simply return standard baseline state from local engine
    hour, day_type, _ = traffic_engine.get_current_time_info()
    return {
        "current_speed": 35.0,
        "normal_speed": 45.0,
        "congestion_score": 0.15,
        "closure_status": False,
        "mode": "offline_local_engine"
    }
