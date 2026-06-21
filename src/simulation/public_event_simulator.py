# [ignoring loop detection]
"""
Public Event Simulator — Rules-based traffic load generator for crowds and stadium events.
"""
from datetime import datetime
import logging
from typing import Any, Dict, List
import networkx as nx

# Local imports
from src.simulation.state_manager import get_city_state
from src.graph_utils import get_neighbors

logger = logging.getLogger(__name__)

def simulate_public_event(
    event_type: str,
    edge_id: str,
    crowd_size: int,
    arrival_pattern: str,
    exit_pattern: str,
    duration_min: int
) -> Dict[str, Any]:
    """
    Simulates traffic propagation waves caused by large public crowd events.
    Computes time-varying congestion factors for the target edge and adjacent roads.
    """
    logger.info("Running public event simulation: crowd size=%d, target=%s", crowd_size, edge_id)
    
    city_state = get_city_state()
    
    # 1. Compute crowd factor
    crowd_factor = min(1.0, crowd_size / 50000.0)
    
    # 2. Get surrounding roads using BFS neighbors
    affected_edges = [edge_id]
    
    # Gather immediate and second-degree neighbors to form impact zone
    try:
        neighbors_1 = get_neighbors(edge_id, radius=1)
        neighbors_2 = get_neighbors(edge_id, radius=2)
        affected_edges.extend(neighbors_1)
        affected_edges.extend(neighbors_2)
        affected_edges = list(set(affected_edges))
    except Exception as e:
        logger.warning("Could not gather neighbors: %s", e)

    # 3. Define time curve multiplier for different prediction horizons
    # T=0: Before Event arrival surge (T-30m)
    # T=15: During Event start (T+15m)
    # T=30: During Event stable phase (T+30m)
    # T=45: After Event mass exit spike (T+45m)
    # T=60: Post event dispersing phase (T+60m)
    # T=120: Near normal flow recovery (T+120m)
    
    time_multipliers = {
        0: 0.65 if arrival_pattern.lower() == "sudden surge" else 0.45,  # BEFORE event surge
        15: 0.35,                                                        # DURING event starts
        30: 0.30,                                                        # DURING event mid-phase
        45: 0.90 if exit_pattern.lower() == "mass exit" else 0.60,      # EXIT peak spike
        60: 0.50,                                                        # EXIT dispersing
        120: 0.15                                                        # RECOVERY phase
    }

    timeline_states = {}
    
    for t_offset, mult in time_multipliers.items():
        road_states = {}
        for eid in city_state.roads.keys():
            baseline = city_state.roads[eid]
            cong = baseline["congestion_score"]
            speed = baseline["current_speed"]
            
            # If the road is in the affected impact zone, apply time-varying crowd load
            if eid in affected_edges:
                # Target road gets maximum impact, neighbors get decaying impact
                distance_factor = 1.0 if eid == edge_id else (0.6 if eid in neighbors_1 else 0.3)
                
                # Settle road importance weight
                rtype = baseline["road_type"].lower()
                imp_factor = 1.4 if ("motorway" in rtype or "trunk" in rtype) else (1.1 if "primary" in rtype else 0.8)
                
                extra_cong = crowd_factor * imp_factor * mult * distance_factor
                cong = min(0.98, baseline["congestion_score"] + extra_cong)
                
                # Speed drops proportionally
                speed = max(5.0, baseline["current_speed"] * (1.0 - (cong * 0.85)))
                
            road_states[eid] = {
                "congestion_score": round(float(cong), 3),
                "current_speed": round(float(speed), 1)
            }
            
        # Compute average metrics for the timeline snapshot
        avg_congestion = int(sum(r["congestion_score"] for r in road_states.values()) / len(road_states) * 100)
        avg_speed = int(sum(r["current_speed"] for r in road_states.values()) / len(road_states))
        critical_roads = sum(1 for r in road_states.values() if r["congestion_score"] > 0.70)
        
        timeline_states[t_offset] = {
            "avg_congestion": avg_congestion,
            "avg_speed": avg_speed,
            "critical_roads": critical_roads,
            "roads": road_states
        }
        
    return {
        "impact": "HIGH" if crowd_size > 20000 else "MEDIUM",
        "expected_duration": duration_min,
        "affected_roads_count": len(affected_edges),
        "timeline": timeline_states,
        "recommendations": [
            "Deploy 15 Traffic Wardens around venue perimeter",
            "Establish diversion route via Outer Ring Road",
            "Set traffic signals on venue approaches to manual green override",
            "Inform BMTC to deploy additional transit shuttle buses post-event"
        ]
    }
