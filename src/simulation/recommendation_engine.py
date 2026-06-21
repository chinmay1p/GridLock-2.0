"""
Recommendation Engine — Generates prioritised police action plans.

Uses all simulation outputs (event AI, GNN timeline, closure analysis,
signal optimisation) and distills them into a ranked list of concrete
actions with urgency levels.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")


def generate_recommendations(
    scenario_dict: Dict[str, Any],
    event_prediction: Dict[str, Any],
    closure_report: Dict[str, Any] | None,
    signal_report: Dict[str, Any] | None,
    city_impact: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Produce a structured recommendation based on rule-based reasoning.

    Rules:
      - HIGH/CRITICAL impact + closure  → recommend diversion + manpower.
      - HIGH congestion                 → optimise signals.
      - Long duration (>60 min)         → deploy additional manpower.
      - Flooding / construction         → lane management plan.
    """
    actions: List[Dict[str, Any]] = []
    impact_label = city_impact.get("impact_category", "MEDIUM")
    impact_score = city_impact.get("city_impact_score", 0.5)
    event_type = scenario_dict.get("event_type", "unknown")
    duration_min = event_prediction.get("expected_duration", 30)
    closure_prob = event_prediction.get("closure_probability", 0.0)
    affected_roads = closure_report.get("affected_roads", []) if closure_report else []
    location = scenario_dict.get("location_name", "the incident area")

    # Rule 1: High impact + closure → diversion
    if impact_label in ("HIGH", "CRITICAL") and closure_prob > 0.4:
        actions.append({
            "priority": 1,
            "type": "diversion",
            "action": f"Open diversion route away from {location}",
            "reason": f"Impact is {impact_label} with {int(closure_prob*100)}% closure probability",
        })
        actions.append({
            "priority": 2,
            "type": "manpower",
            "action": f"Deploy 5 officers to manage diversion at {location}",
            "reason": "High-impact closure requires on-ground traffic management",
        })

    # Rule 2: Many affected roads → signal optimisation
    if len(affected_roads) > 3 or impact_score > 0.6:
        actions.append({
            "priority": 2 if not actions else 3,
            "type": "signal_optimization",
            "action": "Activate adaptive signal timing on surrounding junctions",
            "reason": f"{len(affected_roads)} roads affected; AI signal control reduces delay",
        })

    # Rule 3: Long duration → additional manpower
    if duration_min > 60:
        actions.append({
            "priority": 3,
            "type": "manpower",
            "action": f"Deploy relief patrol — expected duration {duration_min} min",
            "reason": "Long-duration event requires shift-rotation deployment",
        })

    # Rule 4: Flooding / construction → lane management
    if event_type in ("flooding", "waterlogging", "construction", "heavy_rain"):
        actions.append({
            "priority": 2,
            "type": "lane_management",
            "action": "Implement contra-flow lane management on alternate carriageway",
            "reason": f"{event_type.replace('_', ' ').title()} events benefit from lane re-allocation",
        })

    # Rule 5: If closure report has diversion recommendation, surface it
    if closure_report and closure_report.get("recommended_strategy"):
        actions.append({
            "priority": 1,
            "type": "diversion",
            "action": closure_report.get("strategy_description", "Follow recommended diversion strategy"),
            "reason": closure_report.get("reason", "Lowest simulation score"),
        })

    # Signal-specific actions
    if signal_report and signal_report.get("changes"):
        for ch in signal_report["changes"][:3]:
            direction = ch.get("direction", "")
            new_g = ch.get("new_green", 0)
            old_g = ch.get("old_green", 0)
            if new_g != old_g:
                actions.append({
                    "priority": 4,
                    "type": "signal_change",
                    "action": f"Set {direction} green to {new_g}s (was {old_g}s) at primary junction",
                    "reason": "AI pressure-based optimization",
                })

    # Fallback if nothing fired
    if not actions:
        actions.append({
            "priority": 5,
            "type": "monitoring",
            "action": "Continue monitoring; no immediate action required",
            "reason": f"Impact level is {impact_label}",
        })

    # Sort by priority
    actions.sort(key=lambda a: a["priority"])

    return {
        "impact_category": impact_label,
        "total_actions": len(actions),
        "priority_actions": [a["action"] for a in actions],
        "detailed_actions": actions,
    }
