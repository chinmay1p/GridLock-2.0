from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Dict, Any, List

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

BASE_DIR = Path(__file__).resolve().parents[2]
OUTPUT_PATH = BASE_DIR / "outputs" / "recommended_actions.json"

from src.simulator.road_closure import close_road, partial_closure
from src.simulator.traffic_assignment import get_alternative_paths, redistribute_traffic, calculate_edge_cost
from src.simulator.impact_analyzer import run_gnn_propagation, analyze_impact
from src.simulator.scenario_engine import get_base_graph

def run_custom_redistribution(
    G: Any,
    path: List[int],
    blocked_flow: float
) -> None:
    """
    Forces 100% of the blocked flow onto a single chosen alternative path.
    """
    path_road_names = []
    for i in range(len(path) - 1):
        u, v = path[i], path[i+1]
        best_k = None
        best_cost = float("inf")
        for k, data in G[u][v].items():
            cost = calculate_edge_cost(data)
            if cost < best_cost:
                best_cost = cost
                best_k = k
                
        if best_k is not None:
            data = G[u][v][best_k]
            orig_flow = data.get("current_flow", 0.0)
            new_flow = orig_flow + blocked_flow
            data["current_flow"] = float(new_flow)
            
            capacity = max(1, data.get("capacity", 1800))
            free_speed = data.get("speed_kmph", 30.0)
            
            ratio = new_flow / capacity
            new_speed = free_speed / (1.0 + 0.15 * (ratio ** 4))
            data["current_speed"] = float(max(1.0, new_speed))
            data["current_density"] = float(new_flow / data["current_speed"])
            data["congestion_score"] = float(min(1.0, new_flow / capacity))

def optimize_diversion(edge_id: str) -> Dict[str, Any]:
    """
    Evaluates multiple diversion strategies and recommends the one with the lowest score.
    
    Strategies evaluated:
      Option 1: Full Closure with 100% diversion through Path A
      Option 2: Full Closure with 100% diversion through Path B (if available)
      Option 3: Partial Closure (50%) with no forced diversion (normal split)
      
    Cost Score Formula:
      score = 0.5 * average_delay + 0.3 * max_congestion + 0.2 * affected_area
      
      where:
        average_delay = total_delay_added_min (overall traffic delay in minutes)
        max_congestion = max(timeline_congestion_60min) (maximum congestion score observed)
        affected_area = impact_radius_km (radius of spread in km)
        
    Args:
      edge_id: The unique identifier of the road being closed.
      
    Returns:
      A recommendation summary dictionary.
    """
    logging.info("Optimizing diversion strategies for edge %s...", edge_id)
    
    # 1. Load base graph copy
    G_base = get_base_graph()
    
    # Find nodes and attributes of epicenter edge
    u_closed, v_closed = None, None
    orig_flow = 1000.0
    for u, v, k, data in G_base.edges(keys=True, data=True):
        if data.get("edge_id") == edge_id:
            u_closed, v_closed = u, v
            orig_flow = float(data.get("current_flow", 1000.0))
            break
            
    if u_closed is None:
        raise ValueError(f"Edge ID {edge_id} was not found in the graph.")
        
    if orig_flow <= 0.0:
        orig_flow = 2500.0
        
    # Get alternative paths
    paths = get_alternative_paths(G_base, u_closed, v_closed, K=2)
    if not paths:
        return {"status": "failed", "reason": "No alternative paths found"}
        
    options = []
    
    # helper function to evaluate a specific graph state
    def evaluate_state(G_run: Any, name: str, desc: str) -> Dict[str, Any]:
        # Run ST-GNN propagation
        timeline = run_gnn_propagation(G_run, edge_id, 1.0)
        report = analyze_impact(G_run, edge_id, timeline)
        
        # Calculate max congestion
        max_cong = max(row["60min"] for row in timeline) if timeline else 0.0
        
        # Calculate cost score
        avg_delay = report["total_delay_added_min"]
        affected_area = report["impact_radius_km"]
        
        score = 0.5 * avg_delay + 0.3 * max_cong + 0.2 * affected_area
        
        return {
            "name": name,
            "description": desc,
            "average_delay_min": avg_delay,
            "max_congestion": float(round(max_cong, 2)),
            "affected_area_radius_km": affected_area,
            "score": float(round(score, 2)),
            "report": report
        }
        
    # Option 1: Divert through Path A
    G_opt1 = G_base.copy()
    close_road(G_opt1, edge_id)
    run_custom_redistribution(G_opt1, paths[0], orig_flow)
    # Get road name of first link in Path 0
    road_a_name = "Alternative Path A"
    for i in range(len(paths[0]) - 1):
        u, v = paths[0][i], paths[0][i+1]
        for k, data in G_opt1[u][v].items():
            rname = data.get("road_name", "Unknown")
            if rname and rname != "Unknown" and rname != "nan":
                road_a_name = rname
                break
        if road_a_name != "Alternative Path A":
            break
            
    opt1_res = evaluate_state(G_opt1, "Option 1", f"Divert all traffic through {road_a_name}")
    options.append(opt1_res)
    
    # Option 2: Divert through Path B (if available)
    if len(paths) > 1:
        G_opt2 = G_base.copy()
        close_road(G_opt2, edge_id)
        run_custom_redistribution(G_opt2, paths[1], orig_flow)
        road_b_name = "Alternative Path B"
        for i in range(len(paths[1]) - 1):
            u, v = paths[1][i], paths[1][i+1]
            for k, data in G_opt2[u][v].items():
                rname = data.get("road_name", "Unknown")
                if rname and rname != "Unknown" and rname != "nan":
                    road_b_name = rname
                    break
            if road_b_name != "Alternative Path B":
                break
                
        opt2_res = evaluate_state(G_opt2, "Option 2", f"Divert all traffic through {road_b_name}")
        options.append(opt2_res)
    else:
        road_b_name = "N/A"
        
    # Option 3: Keep one lane open (50% partial closure, normal multi-path redistribution)
    G_opt3 = G_base.copy()
    partial_closure(G_opt3, edge_id, 50.0)
    redistribute_traffic(G_opt3, u_closed, v_closed, orig_flow * 0.5, K=5)
    opt3_res = evaluate_state(G_opt3, "Option 3", "Partial closure: Keep one lane open")
    options.append(opt3_res)
    
    # Sort options by score (lower score is better)
    options_sorted = sorted(options, key=lambda x: x["score"])
    best_opt = options_sorted[0]
    
    # Formulate reason
    reasons = []
    if best_opt["average_delay_min"] < opt3_res["average_delay_min"]:
        reasons.append("Least delay compared to partial closure")
    else:
        reasons.append("Minimizes queue length and overflow delay")
        
    if best_opt["max_congestion"] < 0.8:
        reasons.append("avoids causing local bottlenecks")
    else:
        reasons.append("distributes traffic spread evenly")
        
    reason_str = ", ".join(reasons)
    
    recommendation = {
        "closed_road": opt3_res["report"]["closed_road"],
        "recommended_strategy": best_opt["name"],
        "strategy_description": best_opt["description"],
        "reason": reason_str,
        "alternatives_compared": [
            {
                "strategy": opt["name"],
                "description": opt["description"],
                "score": opt["score"],
                "average_delay_min": opt["average_delay_min"],
                "max_congestion": opt["max_congestion"],
                "affected_area_radius_km": opt["affected_area_radius_km"]
            }
            for opt in options
        ]
    }
    
    # Save output
    OUTPUT_PATH.parent.mkdir(exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(recommendation, f, indent=2)
        
    logging.info("Saved recommended actions to %s", OUTPUT_PATH)
    return recommendation
