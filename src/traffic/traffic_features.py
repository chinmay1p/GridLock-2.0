from __future__ import annotations

import logging
from pathlib import Path
import pandas as pd
import numpy as np
from tqdm import tqdm

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
TIMESERIES_PATH = DATA_DIR / "traffic_timeseries.csv"
FEATURES_OUTPUT_PATH = DATA_DIR / "traffic_features.csv"

class TrafficFeatureEngineer:
    """
    Engineers ML-ready features (lags, rolling averages, graph-based spatial metrics,
    and temporal features) from the traffic timeseries dataset.
    """
    def __init__(self):
        try:
            from src.traffic.traffic_processor import TrafficProcessor
        except ImportError:
            import sys
            sys.path.append(str(BASE_DIR))
            from src.traffic.traffic_processor import TrafficProcessor
            
        self.processor = TrafficProcessor()

    def engineer_features(self, df: pd.DataFrame | None = None) -> pd.DataFrame:
        """
        Engineers temporal, lag, rolling, and spatial features.
        """
        if df is None:
            if not TIMESERIES_PATH.exists():
                raise FileNotFoundError(f"Traffic timeseries not found at {TIMESERIES_PATH}. Run traffic processor first.")
            logging.info("Loading traffic timeseries from %s...", TIMESERIES_PATH)
            df = pd.read_csv(TIMESERIES_PATH)
            
        df = df.copy()
        
        # Ensure correct sorting by edge and timestamp
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.sort_values(by=["edge_id", "timestamp"]).reset_index(drop=True)
        
        logging.info("Engineering temporal features...")
        df["hour"] = df["timestamp"].dt.hour
        df["day_of_week"] = df["timestamp"].dt.dayofweek
        df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)
        
        logging.info("Engineering lag features...")
        grouped = df.groupby("edge_id")
        
        # Lags
        df["speed_lag_1"] = grouped["speed"].shift(1)
        df["speed_lag_2"] = grouped["speed"].shift(2)
        df["speed_lag_3"] = grouped["speed"].shift(3)
        
        df["congestion_lag_1"] = grouped["congestion_score"].shift(1)
        df["congestion_lag_2"] = grouped["congestion_score"].shift(2)
        df["congestion_lag_3"] = grouped["congestion_score"].shift(3)
        
        logging.info("Engineering rolling statistics...")
        # Rolling averages (using transform to keep index alignment)
        df["speed_roll_mean_3h"] = grouped["speed"].transform(lambda x: x.rolling(3, min_periods=1).mean())
        df["speed_roll_mean_6h"] = grouped["speed"].transform(lambda x: x.rolling(6, min_periods=1).mean())
        
        df["congestion_roll_mean_3h"] = grouped["congestion_score"].transform(lambda x: x.rolling(3, min_periods=1).mean())
        df["congestion_roll_mean_6h"] = grouped["congestion_score"].transform(lambda x: x.rolling(6, min_periods=1).mean())
        
        logging.info("Engineering graph-based spatial features...")
        # Get unique edge IDs
        unique_edges = df["edge_id"].unique()
        
        # Precompute neighbors
        neighbors_map = []
        for edge_id in tqdm(unique_edges, desc="Mapping neighbors"):
            # Get depth-1 neighbors (direct predecessors/successors)
            neighbors = self.processor.get_neighbors_by_depth(edge_id, max_depth=1)[1]
            for n in neighbors:
                neighbors_map.append({"edge_id": edge_id, "neighbor_id": n})
                
        neighbors_df = pd.DataFrame(neighbors_map)
        
        if not neighbors_df.empty:
            # We want the speed of neighbors at t-1
            # Rename columns to map neighbor speeds
            temp_df = df[["timestamp", "edge_id", "speed_lag_1"]].rename(
                columns={"edge_id": "neighbor_id", "speed_lag_1": "neighbor_speed_lag_1"}
            )
            
            # Vectorized join
            spatial_df = neighbors_df.merge(temp_df, on="neighbor_id")
            
            # Compute average neighbor speed at t-1
            spatial_means = spatial_df.groupby(["timestamp", "edge_id"])["neighbor_speed_lag_1"].mean().reset_index()
            
            # Merge back into main df
            df = df.merge(spatial_means, on=["timestamp", "edge_id"], how="left")
            
            # Fill missing neighbor speed lags with the edge's own speed lag
            df["neighbor_speed_lag_1"] = df["neighbor_speed_lag_1"].fillna(df["speed_lag_1"])
        else:
            df["neighbor_speed_lag_1"] = df["speed_lag_1"]
            
        # Drop rows with NaN (due to first lags) to prepare for clean training
        clean_df = df.dropna().copy()
        
        # Save to output
        clean_df.to_csv(FEATURES_OUTPUT_PATH, index=False)
        logging.info("Features engineered successfully. Saved %d rows to %s", len(clean_df), FEATURES_OUTPUT_PATH)
        return clean_df

if __name__ == "__main__":
    engineer = TrafficFeatureEngineer()
    df = engineer.engineer_features()
    print("\nSample engineered features:")
    print(df[["timestamp", "edge_id", "speed", "speed_lag_1", "speed_roll_mean_3h", "neighbor_speed_lag_1"]].head())
