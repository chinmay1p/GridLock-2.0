# [ignoring loop detection]
import logging
from flask import Blueprint, jsonify

logger = logging.getLogger(__name__)

demo_bp = Blueprint("demo_routes", __name__)

@demo_bp.route("/api/demo/scenarios", methods=["GET"])
def get_demo_scenarios():
    """
    Returns standard demo scenarios configured for Bangalore Traffic Twin.
    """
    presets = {
        "ipl": {
            "name": "IPL Match Exit Surge",
            "description": "Monitors prep surge and outbound gridlocks around Chinnaswamy Stadium.",
            "location": {"lat": 12.9788, "lng": 77.5996},
            "edge_id": "stadium_exit_orr",
            "road_name": "M.G. Road (Chinnaswamy Venue)",
            "duration_min": 240,
            "severity": "HIGH"
        },
        "breakdown": {
            "name": "ORR Truck Breakdown",
            "description": "Simulates lane blockages, queue backlogs and AI detour routing near Silk Board.",
            "location": {"lat": 12.9176, "lng": 77.6244},
            "edge_id": "silkboard_flyover_u",
            "road_name": "Hosur Road (Silk Board Flyover)",
            "duration_min": 90,
            "severity": "HIGH"
        },
        "vip": {
            "name": "VIP Movement",
            "description": "Coordinates signal overrides to create a temporary green wave priority corridor.",
            "location": {"lat": 12.9716, "lng": 77.5946},
            "edge_id": "central_vidhana_soudha",
            "road_name": "Vidhana Soudha Corridor",
            "duration_min": 30,
            "severity": "MEDIUM"
        },
        "rain": {
            "name": "Waterlogging & Flooding",
            "description": "Monitors monsoon rainfall speed degradation and road network recovery timings.",
            "location": {"lat": 12.9279, "lng": 77.6801},
            "edge_id": "orr_ibblur_s",
            "road_name": "Outer Ring Road (Ibblur Grid)",
            "duration_min": 120,
            "severity": "HIGH"
        }
    }
    return jsonify(presets)
