import csv
import math
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parents[2]
COMMAND_CENTER_ROADS_CSV = BASE_DIR / "data" / "command_center_roads.csv"

# Coordinates
STADIUM_COORDS = {"lat": 12.9788, "lng": 77.5996}

# Road list details
HIGH_IMPACT_KEYWORDS = ["mg road", "cubbon", "queens", "kasturba", "lavelle", "st marks", "st. marks", "residency", "minsk", "vittal mallya"]
MEDIUM_IMPACT_KEYWORDS = ["richmond", "infantry", "brigade", "commercial street"]

# Specific points for deployment
BARRICADE_LOCATIONS = [
    {"id": "b1", "lat": 12.9798, "lng": 77.6008, "name": "Stadium Gate 1 Access"},
    {"id": "b2", "lat": 12.9778, "lng": 77.6012, "name": "Queens Road Upstream Entry"},
    {"id": "b3", "lat": 12.9792, "lng": 77.5975, "name": "Cubbon Road Stadium Entrance"},
    {"id": "b4", "lat": 12.9765, "lng": 77.5992, "name": "Kasturba Road Link"}
]

POLICE_LOCATIONS = [
    {"id": "p1", "lat": 12.9785, "lng": 77.5996, "officers": 15, "name": "Stadium Gates & Pedestrian Control"},
    {"id": "p2", "lat": 12.9802, "lng": 77.5985, "officers": 10, "name": "Cubbon Road Junction Regulation"},
    {"id": "p3", "lat": 12.9758, "lng": 77.6002, "officers": 10, "name": "MG Road Corridor Patrol"},
    {"id": "p4", "lat": 12.9772, "lng": 77.6025, "officers": 10, "name": "Parking Exit Management Point"}
]

# Simple Lat/Lng parser for geometry (LINESTRING (x y, ...))
def parse_geometry_points(geom_wkt):
    if not isinstance(geom_wkt, str) or "LINESTRING" not in geom_wkt:
        return []
    try:
        pts_str = geom_wkt.replace("LINESTRING", "").replace("(", "").replace(")", "").strip()
        pts = []
        for pt in pts_str.split(","):
            parts = pt.strip().split()
            if len(parts) >= 2:
                # Keep EPSG:4326 parsed or local projected.
                # In command_center_roads, geometries are parsed to lat/lng in dashboard_routes.
                # Let's see: command_center_roads.csv stores projected EPSG:32643 coordinate strings,
                # but parsed into Lat/Lng. Let's make sure we return correct relative data.
                pass
        return pts
    except Exception:
        return []

class IPLScenarioEngine:
    def __init__(self):
        self.roads = []
        self._load_roads()

    def _load_roads(self):
        if not COMMAND_CENTER_ROADS_CSV.exists():
            logger.error(f"Operational roads file not found: {COMMAND_CENTER_ROADS_CSV}")
            return
        try:
            with open(COMMAND_CENTER_ROADS_CSV, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    self.roads.append({
                        "edge_id": row["edge_id"],
                        "road_name": row["road_name"],
                        "road_type": row["road_type"],
                        "speed": float(row.get("speed") or 30.0),
                        "capacity": float(row.get("capacity") or 2000.0),
                        "geometry": row.get("geometry")
                    })
            logger.info(f"IPL Scenario Engine loaded {len(self.roads)} operational roads.")
        except Exception as e:
            logger.error(f"Failed to load roads: {e}")

    def get_impact_level(self, name):
        if not name or not isinstance(name, str):
            return 0
        n = name.lower()
        if any(k in n for k in HIGH_IMPACT_KEYWORDS):
            return 2
        if any(k in n for k in MEDIUM_IMPACT_KEYWORDS):
            return 1
        return 0

    def load_ipl_scenario(self):
        return {
            "name": "IPL Match",
            "venue": "M. Chinnaswamy Stadium",
            "lat": STADIUM_COORDS["lat"],
            "lng": STADIUM_COORDS["lng"],
            "attendance": 35000,
            "time": "18:30 - 23:30",
            "type": "Large Public Gathering",
            "description": "IPL Cricket match exit surge and arrival peaks."
        }

    def simulate_without_action(self):
        """
        Timeline representations:
        17:30 (5:30 PM): Base evening rush, moderate
        18:30 (6:30 PM): Arrival peak, high
        20:30 (8:30 PM): Stable during match
        23:30 (11:30 PM): Match end exit surge, max
        00:30 (12:30 AM): Slow recovery
        """
        timeline = {
            "timestamps": ["17:30", "18:30", "20:30", "23:30", "00:30"],
            "snapshots": {}
        }
        
        for ts in timeline["timestamps"]:
            timeline["snapshots"][ts] = self._generate_snapshot(ts, interventions=None)
            
        return timeline

    def _generate_snapshot(self, timestamp, interventions=None):
        """
        Generates simulated road states for a given timestamp, applying interventions if present.
        interventions is a dict with keys: 'barricades', 'diversions', 'manpower'
        """
        # Parse active interventions
        barricades = interventions.get("barricades", []) if interventions else []
        diversions = interventions.get("diversions", []) if interventions else []
        manpower = interventions.get("manpower", 0) if interventions else 0

        # Intervention effects
        # 1. Police manpower reduces overall delay and peak congestion near stadium
        manpower_eff = 0.0
        if manpower >= 70:
            manpower_eff = 0.35
        elif manpower >= 45:
            manpower_eff = 0.30
        elif manpower >= 20:
            manpower_eff = 0.15
        elif manpower > 0:
            manpower_eff = 0.08
            
        # 2. Barricading immediate stadium access roads lowers inner vehicle load
        barricade_eff = 0.12 if len(barricades) > 0 else 0.0
        
        # 3. Diversions help spread high impact to alternative lanes
        diversion_eff = 0.15 if len(diversions) > 0 else 0.0

        total_reduction = manpower_eff + barricade_eff + diversion_eff

        snapshot = []
        for r in self.roads:
            impact = self.get_impact_level(r["road_name"])
            
            # Base congestion mapping by time and impact
            base_cong = 0.15
            add_cong = 0.0
            cap_cong = 0.98

            if timestamp == "17:30":
                if impact == 2: add_cong = 0.45
                elif impact == 1: add_cong = 0.30
                else: add_cong = 0.10
            elif timestamp == "18:30":
                if impact == 2: add_cong = 0.60
                elif impact == 1: add_cong = 0.40
                else: add_cong = 0.15
            elif timestamp == "20:30":
                if impact == 2: add_cong = 0.50
                elif impact == 1: add_cong = 0.30
                else: add_cong = 0.10
            elif timestamp == "23:30":
                if impact == 2: add_cong = 0.80
                elif impact == 1: add_cong = 0.55
                else: add_cong = 0.20
            elif timestamp == "00:30":
                if impact == 2: add_cong = 0.50
                elif impact == 1: add_cong = 0.35
                else: add_cong = 0.12

            # Calculate final congestion
            if impact == 2:
                # Apply reduction to the added event congestion
                event_cong = add_cong * (1.0 - total_reduction)
                congestion = base_cong + event_cong
                # Apply custom bad placements if MG Road is fully closed
                is_mg_road = "mg road" in str(r["road_name"]).lower()
                # Check for manually placed closures on major roads
                if is_mg_road and any(d.get("closed_fully") for d in diversions):
                    congestion = min(0.98, congestion + 0.35)  # closing MG road makes things worse
            elif impact == 1:
                # Medium impact might absorb a bit of diverted traffic
                event_cong = add_cong * (1.0 - total_reduction * 0.5)
                # If diversions are active, medium impact corridors absorb 0.08 extra congestion
                if diversion_eff > 0:
                    event_cong += 0.08
                congestion = base_cong + event_cong
            else:
                congestion = base_cong + add_cong

            # Add minor deterministic jitter
            jitter = (sum(ord(c) for c in r["edge_id"]) % 11 - 5) / 100.0
            congestion = max(0.05, min(cap_cong, congestion + jitter))

            # Speed calculation
            speed_limit = r["speed"]
            speed = max(6.0, speed_limit * (1.0 - congestion * 0.62))

            snapshot.append({
                "edge_id": r["edge_id"],
                "road_name": r["road_name"],
                "road_type": r["road_type"],
                "congestion": round(congestion, 3),
                "speed": round(speed, 1),
                "status": "gridlock" if congestion > 0.8 else ("heavy" if congestion > 0.6 else ("moderate" if congestion > 0.35 else "normal"))
            })
            
        return snapshot

    def generate_response_plan(self):
        return {
            "before": {
                "avg_congestion": 95.0,
                "clearance_time_min": 120,
                "critical_roads": 8
            },
            "after": {
                "avg_congestion": 70.0,
                "clearance_time_min": 50,
                "critical_roads": 3
            },
            "suggestions": [
                {
                    "type": "manpower",
                    "title": "Deploy 45 Traffic Officers",
                    "description": "15 officers: Stadium gates & pedestrian flow\n10 officers: Cubbon Road junction\n10 officers: MG Road corridor\n10 officers: Parking exit points."
                },
                {
                    "type": "barricade",
                    "title": "Temporary Pedestrian Barricades",
                    "description": "Place barricades around immediate stadium access roads (Queens Rd/Link Rd) to isolate pedestrian flow from vehicular lanes."
                },
                {
                    "type": "diversion",
                    "title": "Through-Traffic Diversion Route",
                    "description": "Divert heavy traffic through Richmond Road and Infantry Road to prevent stadium approach gridlock."
                },
                {
                    "type": "staged_exit",
                    "title": "Staged Parking Wave Release",
                    "description": "Control outgoing stadium parking exits in waves rather than releasing all vehicles simultaneously."
                }
            ]
        }

    def apply_response_plan(self):
        """
        Returns markers and diversion routes, along with the recalculated after-action timeline.
        """
        response_plan = self.generate_response_plan()
        
        # Build new timeline with standard recommended plan parameters
        timeline = {
            "timestamps": ["17:30", "18:30", "20:30", "23:30", "00:30"],
            "snapshots": {}
        }
        
        interventions = {
            "barricades": BARRICADE_LOCATIONS,
            "diversions": [{"route": "Richmond/Infantry"}],
            "manpower": 45
        }
        
        for ts in timeline["timestamps"]:
            timeline["snapshots"][ts] = self._generate_snapshot(ts, interventions=interventions)

        # Diversion lines (Richmond Road / Infantry Road alternative loops)
        # We define a few coordinates that make a clean bypass around the stadium.
        diversion_routes = [
            # Richmond Road bypass (south-west to east)
            [
                [12.9702, 77.5950],
                [12.9715, 77.6050],
                [12.9730, 77.6110]
            ],
            # Infantry Road bypass (north loop)
            [
                [12.9840, 77.5910],
                [12.9855, 77.6030],
                [12.9830, 77.6100]
            ]
        ]

        return {
            "metrics": response_plan["after"],
            "barricades": BARRICADE_LOCATIONS,
            "police": POLICE_LOCATIONS,
            "diversion_routes": diversion_routes,
            "timeline": timeline
        }

    def simulate_custom_action(self, barricades, diversions, manpower_count):
        """
        Simulates custom manual changes from the frontend.
        """
        interventions = {
            "barricades": barricades,
            "diversions": diversions,
            "manpower": manpower_count
        }

        # Calculate dynamic metrics based on user actions
        # Base clearance is 120 minutes.
        # Manpower effect:
        if manpower_count == 0:
            manpower_min = 120
        elif manpower_count <= 20:
            # Linear improvement from 120 down to 90
            manpower_min = 120 - (manpower_count / 20.0) * 30
        elif manpower_count <= 45:
            # Linear improvement from 90 down to 50
            manpower_min = 90 - ((manpower_count - 20) / 25.0) * 40
        else:
            # Linear improvement from 50 down to max cap of 42
            manpower_min = max(42, 50 - ((manpower_count - 45) / 25.0) * 8)

        # If barricades are placed near stadium, reduce clearance time by 10 minutes
        barricade_reduction = min(15, len(barricades) * 4)
        
        # Diversion penalty rule: if major roads like MG Road are fully closed
        diversion_penalty = 0
        is_mg_road_closed = any(d.get("road_name") and "mg road" in d["road_name"].lower() for d in diversions)
        if is_mg_road_closed:
            diversion_penalty = 35  # BAD: closing MG road adds 35 mins gridlock

        clearance_time = int(manpower_min - barricade_reduction + diversion_penalty)
        clearance_time = max(35, min(160, clearance_time))

        # Peak congestion mapping
        base_peak = 0.95
        reduction = (min(0.35, (manpower_count / 100.0) * 0.5) +
                     min(0.12, len(barricades) * 0.04) +
                     min(0.15, len(diversions) * 0.08))
        
        if is_mg_road_closed:
            reduction -= 0.25 # penalty
            
        peak_congestion = max(0.45, min(0.98, base_peak - reduction))

        # Severe roads count
        severe_roads = max(1, int(8 - (manpower_count / 10) - len(barricades) * 1.2))
        if is_mg_road_closed:
            severe_roads = min(12, severe_roads + 5)

        # Build custom timeline
        timeline = {
            "timestamps": ["17:30", "18:30", "20:30", "23:30", "00:30"],
            "snapshots": {}
        }
        
        for ts in timeline["timestamps"]:
            timeline["snapshots"][ts] = self._generate_snapshot(ts, interventions=interventions)

        return {
            "metrics": {
                "avg_congestion": round(peak_congestion * 100, 1),
                "clearance_time_min": clearance_time,
                "critical_roads": severe_roads
            },
            "timeline": timeline
        }

ipl_engine = IPLScenarioEngine()
