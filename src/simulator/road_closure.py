from __future__ import annotations

import math
import logging
import networkx as nx
from pathlib import Path

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

def close_road(G: nx.MultiDiGraph, edge_id: str) -> int:
    """
    Simulates a full road closure by setting capacity to 0, speed to 0, and travel time to infinity.
    
    Formula:
      capacity = 0
      speed = 0
      travel_time = infinity (float('inf'))
      
    Args:
      G: The NetworkX MultiDiGraph representing the Bangalore road network.
      edge_id: The unique identifier of the road segment.
      
    Returns:
      The number of edges modified.
    """
    modified_count = 0
    for u, v, k, data in G.edges(keys=True, data=True):
        if data.get("edge_id") == edge_id:
            # Save original states if not already done
            if "orig_capacity" not in data:
                data["orig_capacity"] = data.get("capacity", 1800)
                data["orig_speed_kmph"] = data.get("speed_kmph", 30.0)
                data["orig_travel_time_seconds"] = data.get("travel_time_seconds", 60.0)
                data["orig_length_meter"] = data.get("length_meter", data.get("length", 100.0))
            
            # Apply full closure
            data["capacity"] = 0
            data["speed_kmph"] = 0.0
            data["travel_time_seconds"] = float("inf")
            modified_count += 1
            
    if modified_count > 0:
        logging.info("Closed road segment %s (%d graph edges modified)", edge_id, modified_count)
    else:
        logging.warning("Edge ID %s not found in graph for full closure", edge_id)
        
    return modified_count

def partial_closure(G: nx.MultiDiGraph, edge_id: str, percentage: float) -> int:
    """
    Simulates a partial road closure (e.g. lane reduction, barricades).
    
    Formula:
      Let remaining_ratio = 1.0 - (percentage / 100.0)
      capacity_new = capacity_orig * remaining_ratio
      speed_new = speed_orig * remaining_ratio (speed reduces accordingly)
      travel_time_new = (length_meter / 1000.0) / speed_new * 3600.0 (converted to seconds)
      
    Args:
      G: The NetworkX MultiDiGraph.
      edge_id: The unique identifier of the road segment.
      percentage: The closure percentage (e.g. 50 for 50% closure, or 0.5).
      
    Returns:
      The number of edges modified.
    """
    # Normalize percentage to a fraction between 0.0 and 1.0
    if percentage > 1.0:
        pct_fraction = percentage / 100.0
    else:
        pct_fraction = percentage
        
    remaining_ratio = 1.0 - pct_fraction
    remaining_ratio = max(0.0, min(1.0, remaining_ratio))
    
    modified_count = 0
    for u, v, k, data in G.edges(keys=True, data=True):
        if data.get("edge_id") == edge_id:
            # Save original states if not already done
            if "orig_capacity" not in data:
                data["orig_capacity"] = data.get("capacity", 1800)
                data["orig_speed_kmph"] = data.get("speed_kmph", 30.0)
                data["orig_travel_time_seconds"] = data.get("travel_time_seconds", 60.0)
                data["orig_length_meter"] = data.get("length_meter", data.get("length", 100.0))
            
            # Apply partial closure scaling
            data["capacity"] = int(data["orig_capacity"] * remaining_ratio)
            data["speed_kmph"] = float(data["orig_speed_kmph"] * remaining_ratio)
            
            if data["speed_kmph"] > 0:
                length_km = data["orig_length_meter"] / 1000.0
                data["travel_time_seconds"] = (length_km / data["speed_kmph"]) * 3600.0
            else:
                data["travel_time_seconds"] = float("inf")
                
            modified_count += 1
            
    if modified_count > 0:
        logging.info("Partially closed road segment %s by %.1f%% (%d graph edges modified)", 
                     edge_id, pct_fraction * 100.0, modified_count)
    else:
        logging.warning("Edge ID %s not found in graph for partial closure", edge_id)
        
    return modified_count

def restore_network(G: nx.MultiDiGraph) -> int:
    """
    Restores all edges in the graph back to their original state.
    
    Args:
      G: The NetworkX MultiDiGraph.
      
    Returns:
      The number of edges restored.
    """
    restored_count = 0
    for u, v, k, data in G.edges(keys=True, data=True):
        if "orig_capacity" in data:
            data["capacity"] = data.pop("orig_capacity")
            data["speed_kmph"] = data.pop("orig_speed_kmph")
            data["travel_time_seconds"] = data.pop("orig_travel_time_seconds")
            if "orig_length_meter" in data:
                data.pop("orig_length_meter")
            restored_count += 1
            
    if restored_count > 0:
        logging.info("Restored %d road segments to original capacities and speeds", restored_count)
    return restored_count
