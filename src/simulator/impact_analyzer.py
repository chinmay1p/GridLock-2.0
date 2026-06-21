from __future__ import annotations

import math
import logging
import torch
import numpy as np
import pandas as pd
import joblib
from pathlib import Path
from typing import Dict, List, Any, Tuple
import networkx as nx

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
MODELS_DIR = BASE_DIR / "models"
MODEL_PATH = MODELS_DIR / "stgnn_model.pt"
ADJACENCY_PATH = DATA_DIR / "adjacency_matrix.npy"
SEQUENCES_PATH = DATA_DIR / "temporal_sequences.npy"
EDGES_PATH = DATA_DIR / "edges.csv"

# Load prediction helper
try:
    from src.stgnn.predict_stgnn import load_prediction_assets
except ImportError:
    # Direct import fallback
    import sys
    sys.path.append(str(BASE_DIR))
    from src.stgnn.predict_stgnn import load_prediction_assets

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Computes the great-circle distance between two points on the sphere.
    
    Formula:
      dlat = lat2 - lat1
      dlon = lon2 - lon1
      a = sin(dlat/2)^2 + cos(lat1) * cos(lat2) * sin(dlon/2)^2
      c = 2 * arcsin(sqrt(a))
      distance = R * c
      
      where R = 6371.0 km (Earth's mean radius)
      
    Args:
      lat1, lon1: Latitude/longitude of first point in decimal degrees.
      lat2, lon2: Latitude/longitude of second point in decimal degrees.
      
    Returns:
      Distance in kilometers.
    """
    # Convert decimal degrees to radians
    r_lat1, r_lon1, r_lat2, r_lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    
    dlat = r_lat2 - r_lat1
    dlon = r_lon2 - r_lon1
    
    a = math.sin(dlat / 2.0)**2 + math.cos(r_lat1) * math.cos(r_lat2) * math.sin(dlon / 2.0)**2
    c = 2.0 * math.asin(math.sqrt(a))
    
    return 6371.0 * c

def run_gnn_propagation(
    G: nx.MultiDiGraph,
    event_edge_id: str,
    impact_score: float
) -> List[Dict[str, Any]]:
    """
    Runs the ST-GNN model using the physically updated road states as baseline.
    
    Args:
      G: The physically updated NetworkX MultiDiGraph.
      event_edge_id: The epicenter edge ID.
      impact_score: GNN impact score (e.g. 0.9).
      
    Returns:
      A timeline dictionary matching ST-GNN outputs.
    """
    # 1. Load assets
    model, unique_edges, edge_index = load_prediction_assets()
    edge_to_idx = {eid: idx for idx, eid in enumerate(unique_edges)}
    
    # 2. Extract current state from Graph physical properties
    # Load default sequence first to get shape and initial values
    data = np.load(SEQUENCES_PATH, allow_pickle=True).item()
    X = data["X"]
    X_init = torch.tensor(X[-1:], dtype=torch.float32) # Shape: (1, 4, 100, 5)
    
    # 3. Overlay physical graph traffic values on GNN baseline input step
    # We find which GNN-mapped edges correspond to edges in G and update their features.
    # We map u, v, key data to edge_id.
    graph_edges = {}
    for u, v, k, edata in G.edges(keys=True, data=True):
        eid = edata.get("edge_id")
        if eid:
            graph_edges[eid] = edata
            
    for idx, eid in enumerate(unique_edges):
        if eid in graph_edges:
            edata = graph_edges[eid]
            cong = edata.get("congestion_score", 0.0)
            flow = edata.get("current_flow", 0.0)
            dens = edata.get("current_density", 0.0)
            spd = edata.get("current_speed", 30.0)
            free_spd = edata.get("speed_kmph", 30.0)
            
            # Normalize speed relative to free speed
            norm_speed = spd / max(1.0, free_spd)
            
            X_init[0, -1, idx, 0] = float(norm_speed)
            X_init[0, -1, idx, 1] = float(min(1.0, dens / 100.0))
            X_init[0, -1, idx, 2] = float(min(1.0, flow / 5000.0))
            X_init[0, -1, idx, 3] = float(cong)
            
    # Inject epicenter impact
    if event_edge_id in edge_to_idx:
        ev_idx = edge_to_idx[event_edge_id]
        X_init[0, -1, ev_idx, 3] = 1.0 # Max congestion at epicenter
        X_init[0, -1, ev_idx, 4] = impact_score
        
    current_congestion = X_init[0, -1, :, 3].clone().numpy()
    
    # 4. Rollout predictions (15, 30, 60 minutes)
    predictions = {}
    steps = ["15min", "30min", "45min", "60min"]
    current_state = X_init.clone()
    
    with torch.no_grad():
        for step in steps:
            pred = model(current_state, edge_index)
            pred = torch.clamp(pred, 0.0, 1.0)
            predictions[step] = pred[0].numpy()
            
            next_state = torch.zeros_like(current_state)
            next_state[0, 0:3] = current_state[0, 1:4]
            next_state[0, 3] = current_state[0, 3].clone()
            next_state[0, 3, :, 3] = pred[0]
            next_state[0, 3, :, 4] = current_state[0, 3, :, 4] * 0.95
            next_state[0, 3, :, 0] = torch.clamp(1.0 - pred[0], 0.0, 1.0)
            next_state[0, 3, :, 1] = pred[0]
            next_state[0, 3, :, 2] = torch.clamp(pred[0] * (1.0 - pred[0]) * 4.0, 0.0, 1.0)
            current_state = next_state
            
    # 5. Format outputs
    timeline_output = []
    for idx, eid in enumerate(unique_edges):
        timeline_output.append({
            "edge_id": eid,
            "current": float(current_congestion[idx]),
            "15min": float(predictions["15min"][idx]),
            "30min": float(predictions["30min"][idx]),
            "60min": float(predictions["60min"][idx])
        })
        
    return timeline_output

def analyze_impact(
    G: nx.MultiDiGraph,
    event_edge_id: str,
    timeline_results: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Analyzes the congestion spread, speed drops, and delay metrics.
    
    Formula:
      - affected_roads: roads where: new_congestion (60min) - old_congestion > 0.25
      - total_delay_added: sum of (travel_time_after - travel_time_before) for affected segments
      - average_speed_drop: mean of (speed_before - speed_after) for affected segments
      - impact_radius: max(haversine_distance(epicenter_coords, affected_road_coords))
      
    Args:
      G: The NetworkX MultiDiGraph.
      event_edge_id: The epicenter edge ID.
      timeline_results: The GNN prediction timeline list.
      
    Returns:
      A dictionary summarizing impact metrics.
    """
    # 1. Map edge IDs to coordinates, road names, and attributes
    road_metadata = {}
    edges_df = pd.read_csv(EDGES_PATH) if EDGES_PATH.exists() else None
    
    # Load coordinates
    for u, v, k, data in G.edges(keys=True, data=True):
        eid = data.get("edge_id")
        if not eid:
            continue
            
        # Get coordinates from geometry
        geom = data.get("geometry")
        if geom:
            coords = list(geom.coords)
            lat, lon = coords[len(coords)//2][1], coords[len(coords)//2][0]
        else:
            # Fallback to node average
            lat = (G.nodes[u].get("y", 12.9) + G.nodes[v].get("y", 12.9)) / 2.0
            lon = (G.nodes[u].get("x", 77.6) + G.nodes[v].get("x", 77.6)) / 2.0
            
        road_metadata[eid] = {
            "road_name": data.get("road_name", "Unknown"),
            "lat": lat,
            "lon": lon,
            "speed_limit": data.get("speed_kmph", 30.0),
            "current_speed": data.get("current_speed", 30.0),
            "travel_time": data.get("travel_time_seconds", 60.0),
            "length": data.get("length_meter", data.get("length", 100.0))
        }
        
    # Get epicenter coords
    epi_meta = road_metadata.get(event_edge_id, {"lat": 12.9176, "lon": 77.6235, "road_name": "Epicenter Road"})
    epi_lat, epi_lon = epi_meta["lat"], epi_meta["lon"]
    
    # 2. Identify affected roads
    affected_roads = []
    max_dist = 0.0
    total_delay = 0.0
    speed_drops = []
    
    for row in timeline_results:
        eid = row["edge_id"]
        curr_cong = row["current"]
        fut_cong = row["60min"]
        
        increase = fut_cong - curr_cong
        if increase > 0.25:
            meta = road_metadata.get(eid)
            if not meta:
                continue
                
            name = meta["road_name"]
            if name == "Unknown" or name == "nan":
                name = f"Segment {eid[:8]}"
                
            # Distance from epicenter
            dist = haversine_distance(epi_lat, epi_lon, meta["lat"], meta["lon"])
            max_dist = max(max_dist, dist)
            
            # Delay increase calculation
            # Speed drops based on congestion
            free_spd = meta["speed_limit"]
            # After speed
            speed_after = free_spd / (1.0 + 0.15 * (fut_cong ** 4))
            # Before speed
            speed_before = free_spd / (1.0 + 0.15 * (curr_cong ** 4))
            
            len_km = meta["length"] / 1000.0
            tt_before = (len_km / max(1.0, speed_before)) * 3600.0
            tt_after = (len_km / max(1.0, speed_after)) * 3600.0
            
            delay = max(0.0, tt_after - tt_before)
            total_delay += delay
            
            speed_drop = max(0.0, speed_before - speed_after)
            speed_drops.append(speed_drop)
            
            affected_roads.append({
                "road_name": name,
                "congestion_increase": f"+{int(increase * 100)}%",
                "speed_drop_kmph": float(round(speed_drop, 1)),
                "distance_km": float(round(dist, 2))
            })
            
    # Group affected roads to prevent duplicate names and keep maximum congestion increase
    grouped = {}
    for aff in affected_roads:
        name = aff["road_name"]
        inc = int(aff["congestion_increase"].replace("+", "").replace("%", ""))
        if name not in grouped or inc > grouped[name]["increase"]:
            grouped[name] = {
                "road": name,
                "congestion_increase": aff["congestion_increase"],
                "speed_drop_kmph": aff["speed_drop_kmph"],
                "distance_km": aff["distance_km"],
                "increase": inc
            }
            
    unique_affected = [{"road": k, "congestion_increase": v["congestion_increase"]} for k, v in grouped.items()]
    
    avg_speed_drop = sum(speed_drops) / len(speed_drops) if speed_drops else 0.0
    total_delay_min = total_delay / 60.0
    
    return {
        "closed_road": epi_meta["road_name"],
        "affected_roads": unique_affected,
        "impact_radius_km": float(round(max_dist, 2)),
        "total_delay_added_min": float(round(total_delay_min, 1)),
        "average_speed_drop_kmph": float(round(avg_speed_drop, 1)),
        "severity": "HIGH" if total_delay_min > 15.0 or len(unique_affected) > 5 else "MEDIUM" if len(unique_affected) > 0 else "LOW"
    }
