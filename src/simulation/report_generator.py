"""
Report Generator — Natural-language summary of the simulation output.

Produces a police-friendly text report covering:
  - Incident summary
  - Impact prediction
  - Affected roads
  - Recommendations
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

BASE_DIR = Path(__file__).resolve().parents[2]
OUTPUT_DIR = BASE_DIR / "outputs"


def generate_report(simulation_result: Dict[str, Any]) -> str:
    """
    Render a multi-section natural-language report from the full
    simulation output dictionary.

    Returns:
        A formatted string suitable for display or file output.
    """
    lines: List[str] = []
    sep = "=" * 60

    # --- Header ---
    lines.append(sep)
    lines.append("  BANGALORE TRAFFIC DIGITAL TWIN — SIMULATION REPORT")
    lines.append(sep)
    lines.append("")

    # --- Incident ---
    scenario = simulation_result.get("scenario", {})
    event_type = scenario.get("event_type", "Unknown event").replace("_", " ").title()
    location = scenario.get("location_name", "Unknown location")
    time_str = scenario.get("time", "N/A")

    lines.append(f"INCIDENT:  {event_type} at {location}")
    lines.append(f"TIME:      {time_str}")
    lines.append("")

    # --- Impact prediction ---
    event_pred = simulation_result.get("event_prediction", {})
    impact_label = event_pred.get("impact", "N/A")
    impact_score = event_pred.get("impact_score", 0)
    duration = event_pred.get("expected_duration", "N/A")
    closure_prob = event_pred.get("closure_probability", 0)

    lines.append("PREDICTION:")
    lines.append(f"  Impact Level     : {impact_label} (score {impact_score})")
    lines.append(f"  Expected Duration: {duration} minutes")
    lines.append(f"  Closure Risk     : {int(closure_prob * 100)}%")
    lines.append("")

    # --- City-wide impact ---
    city = simulation_result.get("city_impact", {})
    city_score = city.get("city_impact_score", 0)
    city_cat = city.get("impact_category", "N/A")
    affected_count = city.get("affected_road_count", 0)

    lines.append(f"CITY IMPACT: {city_cat}  (score {city_score})")
    lines.append(f"  Roads affected: {affected_count}")
    lines.append("")

    # --- Affected roads ---
    affected = simulation_result.get("affected_roads", [])
    if affected:
        lines.append("AFFECTED ROADS:")
        for i, rd in enumerate(affected[:10], 1):
            if isinstance(rd, dict):
                name = rd.get("road", rd.get("road_name", "Unknown"))
                inc = rd.get("congestion_increase", "")
                lines.append(f"  {i}. {name} {inc}")
            else:
                lines.append(f"  {i}. {rd}")
        if len(affected) > 10:
            lines.append(f"  ... and {len(affected) - 10} more")
        lines.append("")

    # --- Congestion timeline ---
    future = simulation_result.get("future_congestion", {})
    if future:
        lines.append("CONGESTION FORECAST (epicenter):")
        for horizon, val in future.items():
            lines.append(f"  {horizon:>8s}: {val}")
        lines.append("")

    # --- Signal changes ---
    signal = simulation_result.get("signal_changes", {})
    if signal and signal.get("changes"):
        lines.append("SIGNAL TIMING ADJUSTMENTS:")
        for ch in signal["changes"][:5]:
            d = ch.get("direction", "")
            og = ch.get("old_green", 0)
            ng = ch.get("new_green", 0)
            lines.append(f"  {d:>6s}: {og}s -> {ng}s")
        lines.append("")

    # --- Recommended actions ---
    recs = simulation_result.get("police_action_plan", {})
    priority_actions = recs.get("priority_actions", [])
    if priority_actions:
        lines.append("RECOMMENDED ACTIONS:")
        for i, act in enumerate(priority_actions, 1):
            lines.append(f"  {i}. {act}")
        lines.append("")

    lines.append(sep)

    report_text = "\n".join(lines)

    # Save to file
    OUTPUT_DIR.mkdir(exist_ok=True)
    report_path = OUTPUT_DIR / "simulation_report.txt"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report_text)
    logging.info("Report saved to %s", report_path)

    # Also save JSON version
    json_path = OUTPUT_DIR / "simulation_report.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(simulation_result, f, indent=2, default=str)
    logging.info("JSON report saved to %s", json_path)

    return report_text
