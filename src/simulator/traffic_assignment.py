from __future__ import annotations

import math
import logging
import networkx as nx
from typing import List, Dict, Tuple, Any

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

def calculate_edge_cost(data: Dict[str, Any], penalty: float = 100.0) -> float:
    """
    Calculates the generalized cost of traversing an edge.
    
    Formula:
      cost = travel_time + (congestion_score * penalty) + capacity_usage
      
      where:
        travel_time = data["travel_time_seconds"] (in seconds)
        congestion_score = data.get("congestion_score", 0.0) (bounded 0.0 to 1.0)
        capacity_usage = current_flow / capacity (if capacity > 0, else a very high penalty)
        
    Args:
      data: The edge data dictionary.
      penalty: Congestion penalty coefficient.
      
    Returns:
      The float cost value.
    """
    travel_time = data.get("travel_time_seconds", 60.0)
    # If the road is fully closed, the travel time will be infinity, making cost infinity.
    if travel_time == float("inf") or math.isinf(travel_time):
        return float("inf")
        
    congestion = data.get("congestion_score", 0.0)
    flow = data.get("current_flow", 0.0)
    capacity = data.get("capacity", 1800)
    
    if capacity > 0:
        capacity_usage = flow / capacity
    else:
        capacity_usage = 1e6  # High penalty for 0 capacity
        
    cost = travel_time + (congestion * penalty) + capacity_usage
    return float(cost)

def get_alternative_paths(
    G: nx.MultiDiGraph,
    source: int,
    target: int,
    K: int = 5,
    radius: int = 15
) -> List[List[int]]:
    """
    Finds the top K shortest paths between source and target using Yen's K-Shortest Paths.
    To ensure high performance on the large Bangalore graph, we extract a local ego subgraph.
    
    Args:
      G: The full NetworkX MultiDiGraph.
      source: The source node ID.
      target: The target node ID.
      K: Number of alternative paths to generate.
      radius: Bounding step size (radius) to construct a local ego network.
      
    Returns:
      A list of paths, where each path is a list of node IDs.
    """
    # 1. Update edge weights (costs)
    for _, _, _, data in G.edges(keys=True, data=True):
        data["cost"] = calculate_edge_cost(data)
        
    # 2. Extract local ego subgraph to handle large graph search efficiently
    try:
        logging.info("Extracting local ego subgraph around source node %s with radius %d", source, radius)
        # Combine neighbors from both source and target to make sure path exists in subgraph
        nodes_src = set(nx.ego_graph(G, source, radius=radius, undirected=True).nodes)
        nodes_tgt = set(nx.ego_graph(G, target, radius=radius, undirected=True).nodes)
        local_nodes = nodes_src.union(nodes_tgt)
        subG = G.subgraph(local_nodes).copy()
    except Exception as e:
        logging.warning("Failed to construct ego subgraph: %s. Falling back to full graph.", e)
        subG = G
        
    # 3. Convert subG (MultiDiGraph) to a simple DiGraph to support Yen's algorithm in NetworkX
    simple_subG = nx.DiGraph()
    for u, v, k, data in subG.edges(keys=True, data=True):
        cost = data.get("cost", 0.0)
        # We only keep the minimum cost edge between node u and v
        if simple_subG.has_edge(u, v):
            if cost < simple_subG[u][v]["cost"]:
                # Keep all attributes of the cheaper edge
                simple_subG[u][v].update(data)
        else:
            simple_subG.add_edge(u, v, **data)
            
    # 4. Compute Yen's shortest paths on simple directed subgraph
    paths = []
    try:
        path_generator = nx.shortest_simple_paths(simple_subG, source, target, weight="cost")
        for path in path_generator:
            # Verify path is simple and doesn't contain closed edges (infinity cost)
            has_closed_edge = False
            for i in range(len(path) - 1):
                u, v = path[i], path[i+1]
                cost = simple_subG[u][v].get("cost", 0.0)
                if math.isinf(cost):
                    has_closed_edge = True
                    break
            if not has_closed_edge:
                paths.append(path)
            if len(paths) >= K:
                break
    except nx.NetworkXNoPath:
        logging.warning("No alternative paths found between %s and %s", source, target)
    except Exception as e:
        logging.error("Error running Yen's path search: %s", e)
        
    return paths

def redistribute_traffic(
    G: nx.MultiDiGraph,
    u_closed: int,
    v_closed: int,
    blocked_flow: float,
    K: int = 5
) -> Dict[str, Any]:
    """
    Redistributes the flow of a blocked edge across the top K alternative paths.
    
    Formula:
      1. For each path p, calculate the path's bottleneck available capacity:
         path_cap_avail = max(0, min(capacity_i - flow_i for edge_i in path))
      2. If total_avail > 0, distribute flow proportionally:
         flow_to_path_p = blocked_flow * (path_cap_avail_p / total_avail)
      3. Update flow, density, and congestion score on each edge in the path:
         new_flow = current_flow + flow_to_path_p
         new_speed = speed_orig / (1 + 0.15 * (new_flow / capacity) ^ 4) [BPR Formula]
         new_density = new_flow / new_speed
         new_congestion = min(1.0, new_flow / capacity)
         
    Args:
      G: The NetworkX MultiDiGraph.
      u_closed: Start node of the closed road.
      v_closed: End node of the closed road.
      blocked_flow: Flow value (vehicles/hour) to redistribute.
      K: Number of alternative routes.
      
    Returns:
      A dictionary summarizing the redistribution outcome.
    """
    # 1. Generate paths
    paths = get_alternative_paths(G, u_closed, v_closed, K=K)
    if not paths:
        return {"status": "failed", "reason": "No alternative paths found"}
        
    # Calculate available capacity for each path
    path_capacities = []
    for path in paths:
        min_avail_cap = float("inf")
        # Trace path edges
        for i in range(len(path) - 1):
            u, v = path[i], path[i+1]
            # Find the best capacity edge between u and v
            edge_avail = 0.0
            for k, data in G[u][v].items():
                cap = data.get("capacity", 1800)
                flow = data.get("current_flow", 0.0)
                edge_avail = max(edge_avail, float(cap - flow))
            min_avail_cap = min(min_avail_cap, edge_avail)
            
        path_capacities.append(max(0.0, min_avail_cap))
        
    total_avail = sum(path_capacities)
    
    # 2. Distribute flows
    redistributed_data = []
    for idx, path in enumerate(paths):
        if total_avail > 0:
            share = path_capacities[idx] / total_avail
        else:
            share = 1.0 / len(paths)
            
        assigned_flow = blocked_flow * share
        
        # Apply to edges
        path_road_names = []
        for i in range(len(path) - 1):
            u, v = path[i], path[i+1]
            # Find the lowest cost edge to update
            best_k = None
            best_cost = float("inf")
            for k, data in G[u][v].items():
                cost = calculate_edge_cost(data)
                if cost < best_cost:
                    best_cost = cost
                    best_k = k
                    
            if best_k is not None:
                data = G[u][v][best_k]
                road_name = data.get("road_name", "Unknown")
                if road_name and road_name != "Unknown" and road_name not in path_road_names:
                    path_road_names.append(road_name)
                    
                # Update traffic state metrics
                orig_flow = data.get("current_flow", 0.0)
                new_flow = orig_flow + assigned_flow
                data["current_flow"] = float(new_flow)
                
                capacity = max(1, data.get("capacity", 1800))
                free_speed = data.get("speed_kmph", 30.0)
                
                # BPR (Bureau of Public Roads) congestion speed-reduction formula
                # speed = free_flow_speed / (1.0 + 0.15 * (flow / capacity) ** 4)
                ratio = new_flow / capacity
                new_speed = free_speed / (1.0 + 0.15 * (ratio ** 4))
                data["current_speed"] = float(max(1.0, new_speed))
                
                # Update density (density = flow / speed)
                data["current_density"] = float(new_flow / data["current_speed"])
                
                # Congestion score is normalized ratio of flow to capacity (capped at 1.0)
                data["congestion_score"] = float(min(1.0, new_flow / capacity))
                
        redistributed_data.append({
            "path_index": idx,
            "flow_assigned": float(assigned_flow),
            "share_percentage": float(share * 100.0),
            "roads_traversed": path_road_names,
            "nodes": path
        })
        
    logging.info("Redistributed %.1f vehicles/hour across %d alternative paths", blocked_flow, len(paths))
    return {
        "status": "success",
        "blocked_flow": blocked_flow,
        "redistribution": redistributed_data
    }
