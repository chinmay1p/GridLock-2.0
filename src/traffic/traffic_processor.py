from __future__ import annotations

import logging
from pathlib import Path
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
from tqdm import tqdm
import osmnx as ox

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
SYNTHETIC_PATH = DATA_DIR / "synthetic_backbone.csv"
MAPPED_EVENTS_PATH = DATA_DIR / "astram_mapped_events.csv"
EDGES_PATH = DATA_DIR / "edges.csv"
FINAL_OUTPUT_PATH = DATA_DIR / "traffic_timeseries.csv"

class TrafficProcessor:
    """
    Processes the baseline traffic timeseries by injecting Astram event impacts
    (accidents, breakdowns, construction) and propagating congestion spatially.
    """
    def __init__(self):
        # Load the graphml to get correct neighbors
        try:
            from src.graph_builder import load_bangalore_graph
        except ImportError:
            import sys
            sys.path.append(str(BASE_DIR))
            from src.graph_builder import load_bangalore_graph
            
        self.graph = load_bangalore_graph()
        # Build quick edge lookup: edge_id -> (u, v, key)
        self.edge_lookup = {}
        for u, v, k, data in self.graph.edges(keys=True, data=True):
            eid = data.get("edge_id")
            if eid:
                self.edge_lookup[eid] = (u, v, k)
                # Also index without underscores if needed
                if eid.endswith("___"):
                    self.edge_lookup[eid[:-3]] = (u, v, k)

    def get_neighbors_by_depth(self, edge_id: str, max_depth: int = 2) -> dict[int, set[str]]:
        """
        Finds neighbor edge IDs up to max_depth using BFS traversal.
        """
        clean_eid = str(edge_id).strip()
        if clean_eid.endswith("___"):
            clean_eid = clean_eid[:-3]
            
        target = self.edge_lookup.get(clean_eid)
        if not target:
            return {d: set() for d in range(1, max_depth + 1)}
            
        u0, v0, _ = target
        neighbors = {d: set() for d in range(1, max_depth + 1)}
        
        # Depth 1
        # Predecessors of u0: edges (p, u0, k)
        depth1_edges = []
        for p, _, k in self.graph.in_edges(u0, keys=True):
            if p != v0: # avoid backtracking
                eid = self.graph[p][u0][k].get("edge_id")
                if eid:
                    depth1_edges.append(eid)
                    neighbors[1].add(eid)
                    
        # Successors of v0: edges (v0, s, k)
        for _, s, k in self.graph.out_edges(v0, keys=True):
            if s != u0:
                eid = self.graph[v0][s][k].get("edge_id")
                if eid:
                    depth1_edges.append(eid)
                    neighbors[1].add(eid)
                    
        if max_depth < 2:
            return neighbors
            
        # Depth 2
        for d1_eid in depth1_edges:
            d1_clean = d1_eid[:-3] if d1_eid.endswith("___") else d1_eid
            d1_target = self.edge_lookup.get(d1_clean)
            if not d1_target:
                continue
            u1, v1, _ = d1_target
            
            for p, _, k in self.graph.in_edges(u1, keys=True):
                if p != v1:
                    eid = self.graph[p][u1][k].get("edge_id")
                    if eid and eid not in neighbors[1] and eid != edge_id:
                        neighbors[2].add(eid)
                        
            for _, s, k in self.graph.out_edges(v1, keys=True):
                if s != u1:
                    eid = self.graph[v1][s][k].get("edge_id")
                    if eid and eid not in neighbors[1] and eid != edge_id:
                        neighbors[2].add(eid)
                        
        return neighbors

    def get_event_reduction_factor(self, row: pd.Series) -> float:
        """
        Determines the speed reduction factor (0.0 to 1.0) for an event.
        1.0 means complete road closure (speed drops to 0).
        """
        # Check for road closure
        closure = str(row.get("requires_road_closure", "")).lower()
        if closure in ("true", "yes", "1"):
            return 1.0
            
        cause = str(row.get("event_cause", "")).lower()
        priority = str(row.get("priority", "")).lower()
        
        if "accident" in cause:
            if "high" in priority:
                return 0.70  # 70% reduction
            return 0.40      # 40% reduction
        elif "water" in cause or "flood" in cause:
            return 0.50      # 50% reduction
        elif "breakdown" in cause or "stuck" in cause:
            return 0.30      # 30% reduction
        elif "construction" in cause:
            return 0.40      # 40% reduction
        else:
            return 0.20      # 20% reduction (default)

    def parse_event_timestamps(self, row: pd.Series) -> list[str]:
        """
        Returns a list of hourly timestamp strings when the event was active.
        """
        start_str = str(row["start_datetime"])
        end_str = str(row.get("end_datetime", ""))
        
        # Parse timezone-aware or naive datetimes and normalize to naive UTC
        try:
            start_dt = pd.to_datetime(start_str).tz_localize(None)
        except Exception:
            return []
            
        if pd.isna(end_str) or end_str in ("None", "", "NaN", "<NA>"):
            # Estimate duration based on cause
            cause = str(row.get("event_cause", "")).lower()
            if "accident" in cause:
                duration = timedelta(hours=2)
            elif "breakdown" in cause:
                duration = timedelta(hours=1)
            elif "water" in cause:
                duration = timedelta(hours=3)
            elif "construction" in cause:
                duration = timedelta(hours=24)
            else:
                duration = timedelta(hours=2)
            end_dt = start_dt + duration
        else:
            try:
                end_dt = pd.to_datetime(end_str).tz_localize(None)
            except Exception:
                end_dt = start_dt + timedelta(hours=2)
                
        # Round to nearest hour
        start_hour = start_dt.replace(minute=0, second=0, microsecond=0)
        end_hour = end_dt.replace(minute=0, second=0, microsecond=0)
        
        timestamps = []
        curr = start_hour
        while curr <= end_hour:
            timestamps.append(curr.strftime("%Y-%m-%d %H:%M:%S"))
            curr += timedelta(hours=1)
            
        return timestamps

    def process(self) -> pd.DataFrame:
        """
        Applies Astram event impacts to the synthetic backbone timeseries.
        """
        if not SYNTHETIC_PATH.exists():
            raise FileNotFoundError(f"Synthetic backbone not found at {SYNTHETIC_PATH}. Run synthetic generator first.")
        if not MAPPED_EVENTS_PATH.exists():
            raise FileNotFoundError(f"Mapped Astram events not found at {MAPPED_EVENTS_PATH}. Run map events first.")
            
        logging.info("Loading synthetic backbone...")
        backbone_df = pd.read_csv(SYNTHETIC_PATH)
        
        logging.info("Loading edges metadata...")
        edges_df = pd.read_csv(EDGES_PATH).drop_duplicates(subset=["edge_id"])
        # Map edge_id to capacity, lanes, and free-flow speed for recomputations
        edge_meta = edges_df.set_index("edge_id")[["capacity", "lanes", "speed"]].to_dict("index")
        
        # Get set of edge IDs present in backbone
        backbone_edges = set(backbone_df["edge_id"].unique())
        
        logging.info("Loading Astram events...")
        events_df = pd.read_csv(MAPPED_EVENTS_PATH)
        
        # Clean event edge IDs to match backbone edge IDs
        def get_matching_edge(val):
            if pd.isna(val):
                return None
            val_str = str(val).strip()
            if val_str in backbone_edges:
                return val_str
            if val_str.endswith("___") and val_str[:-3] in backbone_edges:
                return val_str[:-3]
            # List case
            if val_str.startswith("[") and "]" in val_str:
                parts = val_str.split("]")[0].replace("[", "").split(",")
                for p in parts:
                    p_clean = p.strip()
                    if p_clean in backbone_edges:
                        return p_clean
                    if p_clean + "___" in backbone_edges:
                        return p_clean + "___"
            return None
            
        events_df["matching_edge_id"] = events_df["nearest_edge_id"].apply(get_matching_edge)
        valid_events = events_df.dropna(subset=["matching_edge_id", "start_datetime"])
        logging.info("Found %d valid events affecting backbone edges.", len(valid_events))
        
        # Multi-index backbone for fast lookups and speed updates
        logging.info("Structuring timeseries for injection...")
        backbone_df = backbone_df.set_index(["timestamp", "edge_id"]).sort_index()
        
        # We will track speed multipliers: (timestamp, edge_id) -> multiplier
        # 1.0 means no reduction. 0.0 means complete closure.
        multipliers = {}
        
        # Inject event impacts
        for _, event in tqdm(list(valid_events.iterrows()), desc="Injecting events"):
            target_edge = event["matching_edge_id"]
            reduction = self.get_event_reduction_factor(event)
            active_hours = self.parse_event_timestamps(event)
            
            # Find neighbors for spatial propagation
            neighbors = self.get_neighbors_by_depth(target_edge, max_depth=2)
            
            for t in active_hours:
                # 1. Apply to target edge
                key = (t, target_edge)
                if key in backbone_df.index:
                    multipliers[key] = min(multipliers.get(key, 1.0), 1.0 - reduction)
                    
                # 2. Propagate to Depth 1 neighbors (50% reduction)
                for n_edge in neighbors[1]:
                    n_key = (t, n_edge)
                    if n_key in backbone_df.index:
                        multipliers[n_key] = min(multipliers.get(n_key, 1.0), 1.0 - (reduction * 0.5))
                        
                # 3. Propagate to Depth 2 neighbors (25% reduction)
                for n_edge in neighbors[2]:
                    n_key = (t, n_edge)
                    if n_key in backbone_df.index:
                        multipliers[n_key] = min(multipliers.get(n_key, 1.0), 1.0 - (reduction * 0.25))
                        
        logging.info("Applying %d calculated speed reductions to baseline...", len(multipliers))
        
        # Update speeds based on multipliers
        # To make it fast, we slice the updates
        count = 0
        for (t, eid), mult in tqdm(multipliers.items(), desc="Updating speeds"):
            try:
                base_speed = backbone_df.loc[(t, eid), "speed"]
                # Apply speed reduction
                new_speed = max(1.0, base_speed * mult) # minimum speed of 1.0 to avoid division by zero
                backbone_df.loc[(t, eid), "speed"] = round(new_speed, 2)
                count += 1
            except KeyError:
                pass
                
        logging.info("Updated %d timeseries entries with event impacts.", count)
        
        # Reset index to compute metrics
        backbone_df = backbone_df.reset_index()
        
        # Recompute density, flow, congestion_score
        logging.info("Recalculating traffic metrics (flow, density, congestion)...")
        
        def recompute_row(row):
            eid = row["edge_id"]
            meta = edge_meta.get(eid)
            if not meta:
                return row
                
            free_flow_speed = meta["speed"]
            capacity = meta["capacity"]
            lanes = meta["lanes"]
            current_speed = row["speed"]
            
            congestion_score = max(0.0, min(1.0, 1.0 - (current_speed / free_flow_speed)))
            density = (lanes * 120.0) * congestion_score
            flow = min(capacity, density * current_speed)
            
            row["congestion_score"] = round(congestion_score, 3)
            row["density"] = round(density, 2)
            row["flow"] = round(flow, 1)
            return row
            
        # Recompute columns in a vectorized way
        # Map values
        ff_speeds = backbone_df["edge_id"].map(lambda x: edge_meta.get(x, {}).get("speed", 50.0))
        capacities = backbone_df["edge_id"].map(lambda x: edge_meta.get(x, {}).get("capacity", 3600.0))
        lanes = backbone_df["edge_id"].map(lambda x: edge_meta.get(x, {}).get("lanes", 2.0))
        
        # Vectorized calculations
        backbone_df["congestion_score"] = (1.0 - (backbone_df["speed"] / ff_speeds)).clip(0.0, 1.0).round(3)
        backbone_df["density"] = (lanes * 120.0 * backbone_df["congestion_score"]).round(2)
        backbone_df["flow"] = np.minimum(capacities, backbone_df["density"] * backbone_df["speed"]).round(1)
        
        # Save to final output
        backbone_df.to_csv(FINAL_OUTPUT_PATH, index=False)
        logging.info("Successfully saved final traffic timeseries to %s", FINAL_OUTPUT_PATH)
        return backbone_df

if __name__ == "__main__":
    processor = TrafficProcessor()
    df = processor.process()
    print("\nSample final traffic timeseries (with events):")
    print(df[df["congestion_score"] > 0.3].head())
