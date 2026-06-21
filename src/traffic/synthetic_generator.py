from __future__ import annotations

import logging
from pathlib import Path
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
from tqdm import tqdm

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
EDGES_PATH = DATA_DIR / "edges.csv"
SYNTHETIC_OUTPUT_PATH = DATA_DIR / "synthetic_backbone.csv"

class SyntheticTrafficGenerator:
    """
    Generates realistic synthetic traffic timeseries based on historical patterns
    (peak/off-peak, weekdays/weekends) for selected graph edges.
    """
    def __init__(self, start_date: str = "2023-11-09", end_date: str = "2024-04-08"):
        self.start_date = datetime.strptime(start_date, "%Y-%m-%d")
        self.end_date = datetime.strptime(end_date, "%Y-%m-%d")
        
    def generate_timestamps(self, interval_hours: int = 1) -> list[datetime]:
        """
        Generates a list of datetimes in the range.
        """
        timestamps = []
        current = self.start_date
        while current <= self.end_date:
            timestamps.append(current)
            current += timedelta(hours=interval_hours)
        return timestamps

    def get_edges_subset(self, sample_size: int | None = 1000) -> pd.DataFrame:
        """
        Loads the edges and selects a subset to generate timeseries for.
        Always prioritizing motorway, trunk, primary, secondary roads.
        """
        if not EDGES_PATH.exists():
            raise FileNotFoundError(f"Edges CSV not found at {EDGES_PATH}")
            
        edges_df = pd.read_csv(EDGES_PATH).drop_duplicates(subset=["edge_id"])
        
        # We prioritize key road networks and event-mapped roads
        # We can check which edges have events mapped in astram_mapped_events.csv
        mapped_events_path = DATA_DIR / "astram_mapped_events.csv"
        event_edge_ids = set()
        if mapped_events_path.exists():
            try:
                events_df = pd.read_csv(mapped_events_path)
                for val in events_df["nearest_edge_id"].dropna().unique():
                    val_str = str(val).strip()
                    if val_str.startswith("[") and "]" in val_str:
                        parts = val_str.split("]")[0].replace("[", "").split(",")
                        for p in parts:
                            p_clean = p.strip()
                            if p_clean:
                                event_edge_ids.add(p_clean + "___")
                                event_edge_ids.add(p_clean)
                    else:
                        event_edge_ids.add(val_str)
                        if val_str.endswith("___"):
                            event_edge_ids.add(val_str[:-3])
            except Exception as e:
                logging.error("Error reading events: %s", e)
                
        # Mark edges with events
        edges_df["has_event"] = edges_df["edge_id"].astype(str).apply(
            lambda x: x in event_edge_ids or x.split('_')[0] in event_edge_ids
        )
        
        # Sort so we always keep event edges and priority roads
        priority_order = {
            "motorway": 0, "motorway_link": 1,
            "trunk": 2, "trunk_link": 3,
            "primary": 4, "primary_link": 5,
            "secondary": 6, "secondary_link": 7,
            "tertiary": 8, "tertiary_link": 9,
            "residential": 10, "living_street": 11,
            "service": 12, "unclassified": 13, "road": 14
        }
        edges_df["road_priority"] = edges_df["road_type"].map(priority_order).fillna(99)
        
        # Sort: event edges first, then by road priority
        edges_df = edges_df.sort_values(by=["has_event", "road_priority"], ascending=[False, True])
        
        if sample_size is not None:
            # Take the top sample_size edges (guarantees we include event edges)
            subset = edges_df.head(sample_size).copy()
        else:
            subset = edges_df.copy()
            
        logging.info("Selected %d edges for synthetic timeseries generation.", len(subset))
        return subset

    def generate_baseline_speed_multiplier(self, dt: datetime) -> float:
        """
        Generates speed multiplier based on hour and day of week.
        """
        hour = dt.hour
        is_weekend = dt.weekday() >= 5
        
        if not is_weekend:
            # Weekdays
            if 7 <= hour <= 10:
                # Morning peak
                mean = 0.45
                std = 0.05
            elif 17 <= hour <= 21:
                # Evening peak
                mean = 0.40
                std = 0.05
            elif 10 < hour < 17:
                # Off-peak daytime
                mean = 0.75
                std = 0.05
            else:
                # Nighttime
                mean = 0.92
                std = 0.03
        else:
            # Weekends
            if 11 <= hour <= 16:
                # Weekend daytime
                mean = 0.80
                std = 0.05
            else:
                # Weekend night/morning
                mean = 0.95
                std = 0.03
                
        # Generate multiplier with normal noise
        multiplier = np.random.normal(mean, std)
        return float(np.clip(multiplier, 0.15, 1.0))

    def generate(self, sample_size: int | None = 1000, interval_hours: int = 1) -> pd.DataFrame:
        """
        Generates the baseline synthetic traffic timeseries.
        """
        logging.info("Generating synthetic traffic backbone...")
        edges_subset = self.get_edges_subset(sample_size)
        timestamps = self.generate_timestamps(interval_hours)
        
        logging.info("Generating data for %d timestamps...", len(timestamps))
        
        # Prepare list of dicts for efficient dataframe creation
        data_rows = []
        
        # To avoid giant loops, let's vectorise or pre-compute multipliers
        multipliers = [self.generate_baseline_speed_multiplier(t) for t in timestamps]
        
        # Extract necessary edge fields
        edge_data = edges_subset[["edge_id", "speed", "lanes", "capacity"]].to_dict("records")
        
        for edge in tqdm(edge_data, desc="Simulating edges"):
            edge_id = edge["edge_id"]
            free_flow_speed = edge["speed"]
            lanes = edge["lanes"]
            capacity = edge["capacity"]
            
            # Estimating jam density: lanes * 120 vehicles/km
            jam_density = lanes * 120.0
            
            for t, mult in zip(timestamps, multipliers):
                current_speed = round(free_flow_speed * mult, 2)
                congestion_score = round(1.0 - (current_speed / free_flow_speed), 3)
                congestion_score = max(0.0, min(1.0, congestion_score))
                
                # Flow/density relation
                density = round(jam_density * congestion_score, 2)
                flow = round(min(capacity, density * current_speed), 1)
                
                data_rows.append({
                    "timestamp": t.strftime("%Y-%m-%d %H:%M:%S"),
                    "edge_id": edge_id,
                    "speed": current_speed,
                    "flow": flow,
                    "density": density,
                    "congestion_score": congestion_score
                })
                
        df = pd.DataFrame(data_rows)
        # Save to output
        df.to_csv(SYNTHETIC_OUTPUT_PATH, index=False)
        logging.info("Generated %d rows and saved to %s", len(df), SYNTHETIC_OUTPUT_PATH)
        return df

if __name__ == "__main__":
    generator = SyntheticTrafficGenerator()
    # Generate 6-month backbone for a small sample of 100 edges to test speed
    df = generator.generate(sample_size=100)
    print("\nSample generated synthetic traffic data:")
    print(df.head())
