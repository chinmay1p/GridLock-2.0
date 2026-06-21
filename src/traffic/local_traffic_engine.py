import csv
import logging
from datetime import datetime
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

BASE_DIR = Path(__file__).resolve().parents[2]
TRAFFIC_PATTERNS_CSV = BASE_DIR / "data" / "bangalore_traffic_patterns.csv"

class LocalTrafficEngine:
    def __init__(self):
        self.patterns = {}
        self.load_dataset()

    def load_dataset(self):
        if not TRAFFIC_PATTERNS_CSV.exists():
            logging.warning("Traffic pattern CSV not found: %s", TRAFFIC_PATTERNS_CSV)
            return

        logging.info("Caching traffic patterns from %s", TRAFFIC_PATTERNS_CSV)
        try:
            with open(TRAFFIC_PATTERNS_CSV, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    edge_id = row.get("edge_id")
                    hour = int(row.get("hour", 0))
                    day_type = row.get("day_type", "weekday")
                    
                    key = (edge_id, hour, day_type)
                    self.patterns[key] = {
                        "expected_speed": float(row.get("expected_speed", 30.0)),
                        "normal_speed": float(row.get("normal_speed", 45.0)),
                        "traffic_density": float(row.get("traffic_density", 0.1)),
                        "congestion_score": float(row.get("congestion_score", 0.1)),
                        "vehicle_flow": int(row.get("vehicle_flow", 200)),
                        "traffic_level": row.get("traffic_level", "LOW")
                    }
            logging.info("Successfully cached %d traffic pattern entries.", len(self.patterns))
        except Exception as exc:
            logging.error("Failed to load traffic patterns dataset: %s", exc)

    def _get_deterministic_jitter(self, edge_id: str, hour: int, day_type: str) -> float:
        # Generate a deterministic jitter between -0.05 and 0.05 (+/- 5%) based on key hash
        key = f"{edge_id}_{hour}_{day_type}"
        h = 0
        for char in key:
            h = (31 * h + ord(char)) & 0xFFFFFFFF
        return ((h % 101) / 1000.0) - 0.05

    def get_traffic_state(self, edge_id: str, hour: int, day_type: str) -> dict:
        key = (edge_id, hour, day_type)
        row = self.patterns.get(key)
        
        # Fallback if specific pattern not cached
        if not row:
            # Default fallback values
            row = {
                "expected_speed": 35.0,
                "normal_speed": 45.0,
                "traffic_density": 0.15,
                "congestion_score": 0.15,
                "vehicle_flow": 250,
                "traffic_level": "LOW"
            }

        jitter = self._get_deterministic_jitter(edge_id, hour, day_type)
        
        congestion = max(0.02, min(0.98, row["congestion_score"] * (1.0 + jitter)))
        density = max(0.02, min(0.98, row["traffic_density"] * (1.0 + jitter)))
        speed = max(5.0, min(row["normal_speed"], row["expected_speed"] * (1.0 - jitter * 0.5)))
        
        if congestion < 0.35:
            level = "LOW"
        elif congestion <= 0.7:
            level = "MEDIUM"
        else:
            level = "HIGH"

        return {
            "congestion_score": round(congestion, 3),
            "traffic_density": round(density, 3),
            "expected_speed": round(speed, 1),
            "normal_speed": row["normal_speed"],
            "vehicle_flow": int(row["vehicle_flow"] * (1.0 + jitter)),
            "traffic_level": level
        }

    def get_current_time_info(self, current_time=None):
        if current_time is None:
            current_time = datetime.now()
        hour = current_time.hour
        # Weekday / Weekend mapping (Monday=0 ... Sunday=6)
        day_type = "weekend" if current_time.weekday() >= 5 else "weekday"
        return hour, day_type, current_time.strftime("%A %I:%M %p")

# Singleton instance
traffic_engine = LocalTrafficEngine()
