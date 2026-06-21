# [ignoring loop detection]
"""
Resource Effect Model — Rule engine to calculate road state modifications under police interventions.
"""
import logging
from typing import Any, Dict, List, Optional, Tuple
import networkx as nx

# Local imports
from src.simulation.state_manager import get_city_state

logger = logging.getLogger(__name__)

def calculate_manpower_effect(officers_count: int) -> float:
    """
    Returns the capacity improvement multiplier based on deployed officer counts:
    - 1-3 officers: +5% (+0.05)
    - 4-10 officers: +15% (+0.15)
    - 10+ officers: +30% (+0.30)
    """
    if officers_count <= 0:
        return 0.0
    elif officers_count <= 3:
        return 0.05
    elif officers_count <= 10:
        return 0.15
    else:
        return 0.30


def get_alternative_routes_for_closure(closed_edge_id: str, max_paths: int = 3) -> List[List[str]]:
    """
    Finds alternative paths bypassing a closed road segment.
    Uses NetworkX shortest paths excluding the closed edge.
    """
    try:
        from src.simulator.scenario_engine import get_base_graph
        G = get_base_graph()
    except Exception:
        # Fallback if base graph builder is not importable
        city_state = get_city_state()
        if hasattr(city_state, '_graph') and city_state._graph is not None:
            G = city_state._graph
        else:
            return []

    # Locate source and target nodes of the closed edge
    u, v = None, None
    for un, vn, data in G.edges(data=True):
        if data.get("edge_id") == closed_edge_id:
            u, v = un, vn
            break

    if u is None or v is None:
        return []

    # Temp copy graph to remove the edge and find alternatives
    G_temp = G.copy()
    if G_temp.has_edge(u, v):
        G_temp.remove_edge(u, v)

    alternative_paths = []
    try:
        # Get k-shortest paths
        paths = list(nx.shortest_simple_paths(G_temp, u, v, weight='length'))[:max_paths]
        for p in paths:
            # Map node path back to list of edge IDs
            edge_ids = []
            for i in range(len(p) - 1):
                edge_data = G_temp.get_edge_data(p[i], p[i+1])
                if edge_data:
                    # In MultiDiGraph, edge_data is a dict of keys
                    if isinstance(edge_data, dict):
                        first_key = list(edge_data.keys())[0]
                        eid = edge_data[first_key].get("edge_id")
                    else:
                        eid = edge_data.get("edge_id")
                    if eid:
                        edge_ids.append(eid)
            if edge_ids:
                alternative_paths.append(edge_ids)
    except Exception as e:
        logger.warning(f"Could not compute alternative path: {e}")

    return alternative_paths


def apply_interventions(
    baseline_roads: Dict[str, Dict[str, Any]],
    interventions: List[Dict[str, Any]]
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Any]]:
    """
    Applies the set of police interventions onto the road state.
    Returns:
      1. Updated road states dict.
      2. Intervention impact summary metrics.
    """
    updated_roads = {}
    
    # Deep copy baseline to prevent mutations
    for eid, rd in baseline_roads.items():
        updated_roads[eid] = {
            "edge_id": eid,
            "road_name": rd.get("road_name", "Unknown"),
            "road_type": rd.get("road_type", "unclassified"),
            "capacity": rd.get("capacity", 1800),
            "current_speed": rd.get("current_speed", rd.get("speed_limit", 30.0)),
            "congestion_score": rd.get("congestion_score", rd.get("congestion", 0.0)),
            "speed_limit": rd.get("speed_limit", 30.0)
        }

    spillover_edges = []
    spillover_mult = 1.05
    
    # 1. Parse active closures & diversions first to determine spillovers
    closures = [i for i in interventions if i["type"] == "closure"]
    barricades = [i for i in interventions if i["type"] == "barricade"]
    manpower = [i for i in interventions if i["type"] == "manpower"]
    
    # Apply closures
    for c in closures:
        eid = c.get("edge_id")
        if eid not in updated_roads:
            continue
            
        ctype = c.get("parameters", {}).get("closure_type", "Complete closure")
        rd = updated_roads[eid]
        
        if ctype == "Complete closure":
            rd["capacity"] = 0
            rd["congestion_score"] = 0.98
            rd["current_speed"] = 0.0
            
            # Find spillovers (alternatives get more traffic)
            alts = get_alternative_routes_for_closure(eid)
            for path in alts:
                spillover_edges.extend(path)
                
        elif ctype == "One side closure":
            rd["capacity"] = int(rd["capacity"] * 0.50)
            rd["congestion_score"] = min(0.98, rd["congestion_score"] + 0.35)
            rd["current_speed"] = max(5.0, rd["current_speed"] * 0.50)
        elif ctype == "Emergency lane open":
            rd["capacity"] = int(rd["capacity"] * 0.15)
            rd["congestion_score"] = min(0.98, rd["congestion_score"] + 0.45)
            rd["current_speed"] = max(5.0, rd["current_speed"] * 0.30)

    # Apply barricades
    for b in barricades:
        eid = b.get("edge_id")
        if eid not in updated_roads:
            continue
            
        reduction = int(b.get("parameters", {}).get("reduction_pct", 50))
        rd = updated_roads[eid]
        
        capacity_factor = 1.0 - (reduction / 100.0)
        rd["capacity"] = int(rd["capacity"] * capacity_factor)
        
        # Increase congestion proportionally
        added_congestion = 0.15 + (reduction / 200.0)
        rd["congestion_score"] = min(0.98, rd["congestion_score"] + added_congestion)
        rd["current_speed"] = max(4.0, rd["current_speed"] * capacity_factor)

    # Apply manpower deployments
    for m in manpower:
        eid = m.get("edge_id")
        if eid not in updated_roads:
            continue
            
        count = int(m.get("parameters", {}).get("officers_count", 5))
        rd = updated_roads[eid]
        
        effect = calculate_manpower_effect(count)
        rd["capacity"] = int(rd["capacity"] * (1.0 + effect))
        
        # Manpower decreases congestion & helps vehicles move faster
        rd["congestion_score"] = max(0.05, rd["congestion_score"] - (effect * 0.8))
        rd["current_speed"] = min(rd["speed_limit"], rd["current_speed"] * (1.0 + effect))

    # Apply spillovers (roads nearby receiving diverted flows)
    # Filter unique spillovers and exclude closed roads themselves
    spillover_edges = list(set(spillover_edges))
    for eid in spillover_edges:
        if eid in updated_roads and updated_roads[eid]["capacity"] > 0:
            rd = updated_roads[eid]
            rd["congestion_score"] = min(0.95, rd["congestion_score"] + 0.20)
            rd["current_speed"] = max(6.0, rd["current_speed"] * 0.75)

    # Compute comparative improvements
    improved_roads = []
    worse_roads = []
    
    for eid, rd in updated_roads.items():
        base_cong = baseline_roads[eid].get("congestion_score", baseline_roads[eid].get("congestion", 0.0))
        diff = rd["congestion_score"] - base_cong
        if diff < -0.05:
            improved_roads.append(eid)
        elif diff > 0.05:
            worse_roads.append(eid)

    summary = {
        "improved_roads": improved_roads,
        "worse_roads": worse_roads,
        "spillover_roads_count": len(spillover_edges)
    }

    return updated_roads, summary
