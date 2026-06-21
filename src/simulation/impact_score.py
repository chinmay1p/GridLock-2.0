"""
City Impact Score — Global metric summarising the severity of a traffic event.

Formula:
    city_impact = 0.4 * avg_congestion_increase
               + 0.3 * affected_roads_percent
               + 0.2 * delay_added_norm
               + 0.1 * duration_norm

Categories:
    0.00 – 0.25   LOW
    0.25 – 0.50   MEDIUM
    0.50 – 0.75   HIGH
    0.75 – 1.00   CRITICAL
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")


def calculate_city_impact(
    gnn_timeline: List[Dict[str, Any]],
    event_prediction: Dict[str, Any],
    total_roads: int,
    closure_report: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """
    Compute the global city-impact metric.

    Args:
        gnn_timeline:     ST-GNN output rows (edge_id, current, 15min, 30min, 60min).
        event_prediction: Output of ``predict_event_effect``.
        total_roads:      Total number of road segments in the network.
        closure_report:   Optional output from ``analyze_impact``.

    Returns:
        Dict with ``city_impact_score`` (0-1), ``impact_category``, and component breakdowns.
    """

    # --- Component 1: average congestion increase ---
    increases = []
    for row in gnn_timeline:
        curr = float(row.get("current", 0.0))
        fut = float(row.get("60min", 0.0))
        delta = max(0.0, fut - curr)
        if delta > 0.01:
            increases.append(delta)

    avg_cong_increase = sum(increases) / len(increases) if increases else 0.0
    avg_cong_increase = min(1.0, avg_cong_increase)  # cap at 1.0

    # --- Component 2: affected roads percentage ---
    affected_count = len(increases)  # edges that saw >0.01 increase
    if closure_report and closure_report.get("affected_roads"):
        affected_count = max(affected_count, len(closure_report["affected_roads"]))

    affected_pct = min(1.0, affected_count / max(1, total_roads))

    # --- Component 3: delay added (normalised to 0-1, 60 min = 1.0) ---
    delay_min = 0.0
    if closure_report:
        delay_min = float(closure_report.get("total_delay_added_min", 0.0))
    delay_norm = min(1.0, delay_min / 60.0)

    # --- Component 4: duration (normalised to 0-1, 120 min = 1.0) ---
    duration = float(event_prediction.get("expected_duration", 30))
    duration_norm = min(1.0, duration / 120.0)

    # --- Weighted sum ---
    score = (
        0.4 * avg_cong_increase
        + 0.3 * affected_pct
        + 0.2 * delay_norm
        + 0.1 * duration_norm
    )
    score = round(min(1.0, max(0.0, score)), 4)

    # --- Category ---
    if score >= 0.75:
        category = "CRITICAL"
    elif score >= 0.50:
        category = "HIGH"
    elif score >= 0.25:
        category = "MEDIUM"
    else:
        category = "LOW"

    return {
        "city_impact_score": score,
        "impact_category": category,
        "components": {
            "avg_congestion_increase": round(avg_cong_increase, 4),
            "affected_roads_percent": round(affected_pct, 4),
            "delay_added_norm": round(delay_norm, 4),
            "duration_norm": round(duration_norm, 4),
        },
        "affected_road_count": affected_count,
        "expected_duration_min": int(duration),
    }
