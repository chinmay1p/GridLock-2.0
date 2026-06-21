from __future__ import annotations

import json
import logging
import copy
from pathlib import Path
from typing import Dict, Any, List

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

BASE_DIR = Path(__file__).resolve().parents[2]
OUTPUT_PATH = BASE_DIR / "outputs" / "closure_simulation.json"

from src.simulator.road_closure import close_road, partial_closure, restore_network
from src.simulator.traffic_assignment import redistribute_traffic
from src.simulator.impact_analyzer import run_gnn_propagation, analyze_impact

_graph_cache = None

def get_base_graph():
    """
    Retrieves and caches the base road graph from GraphML to optimize subsequent lookups.
    """
    global _graph_cache
    if _graph_cache is None:
        logging.info("Loading baseline Bangalore graph structure...")
        from src.graph_builder import load_bangalore_graph
        _graph_cache = load_bangalore_graph()
        
        # Populate default traffic values if missing
        for u, v, k, data in _graph_cache.edges(keys=True, data=True):
            if "current_flow" not in data or data["current_flow"] is None:
                data["current_flow"] = 1000.0  # Default baseline flow
            if "congestion_score" not in data or data["congestion_score"] is None:
                data["congestion_score"] = 0.15  # Default baseline congestion
            if "current_speed" not in data or data["current_speed"] is None:
                data["current_speed"] = data.get("speed_kmph", 30.0)
                
    return _graph_cache.copy()

def simulate_scenario(config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Executes the complete Road Closure and Traffic Simulation Pipeline.
    
    Pipeline Steps:
      1. Copy/Load base road graph G.
      2. Find u, v nodes for target edge_id.
      3. Apply full/partial closure using road_closure engine.
      4. Compute traffic redistribution across Yen's K alternative routes.
      5. Update physical graph traffic states (speed, flow, density).
      6. Run ST-GNN propagation timeline forecast.
      7. Analyze overall traffic impact and export report.
      
    Args:
      config: Dictionary containing scenario details:
        {
          "edge_id": "32261256___",
          "type": "full" | "partial",
          "closure_percentage": 50 (for partial)
        }
        
    Returns:
      A dictionary formatted as the scenario impact report.
    """
    edge_id = config.get("edge_id")
    closure_type = config.get("type", "full").lower()
    pct = float(config.get("closure_percentage", 100.0))
    
    if not edge_id:
        raise ValueError("Missing parameter: 'edge_id'")
        
    # 1. Load base graph copy
    G = get_base_graph()
    
    # 2. Find nodes and original properties of target edge
    u_closed, v_closed = None, None
    orig_flow = 1000.0
    for u, v, k, data in G.edges(keys=True, data=True):
        if data.get("edge_id") == edge_id:
            u_closed, v_closed = u, v
            orig_flow = float(data.get("current_flow", 1000.0))
            break
            
    if u_closed is None:
        raise ValueError(f"Edge ID {edge_id} was not found in the Bangalore graph database.")
        
    # Ensure baseline flow is non-zero for redistribution
    if orig_flow <= 0.0:
        orig_flow = 2500.0  # Set standard flow for simulation
        
    # 3. Apply closure & determine blocked flow to redistribute
    if closure_type == "full":
        close_road(G, edge_id)
        blocked_flow = orig_flow
        impact_score = 1.0
    elif closure_type == "partial":
        partial_closure(G, edge_id, pct)
        # Blocked flow is proportional to closure percentage
        blocked_flow = orig_flow * (pct / 100.0)
        impact_score = pct / 100.0
    else:
        raise ValueError(f"Invalid closure type: '{closure_type}'")
        
    # 4. Run traffic redirection
    redistribute_traffic(G, u_closed, v_closed, blocked_flow, K=5)
    
    # 5. Run ST-GNN model on updated state
    timeline_results = run_gnn_propagation(G, edge_id, impact_score)
    
    # 6. Analyze impact
    report = analyze_impact(G, edge_id, timeline_results)
    
    # 7. Formulate final report output
    final_output = {
        "closed_road": report["closed_road"],
        "affected_roads": report["affected_roads"],
        "delay_added": f"{int(report['total_delay_added_min'])} min",
        "severity": report["severity"],
        "metrics": {
            "impact_radius_km": report["impact_radius_km"],
            "average_speed_drop_kmph": report["average_speed_drop_kmph"],
            "total_delay_added_min": report["total_delay_added_min"]
        }
    }
    
    # Save output to file
    OUTPUT_PATH.parent.mkdir(exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(final_output, f, indent=2)
        
    logging.info("Saved closure simulation report to %s", OUTPUT_PATH)
    return final_output
