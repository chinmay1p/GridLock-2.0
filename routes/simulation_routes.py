"""
Command center and simulation API routes for Traffic Twin Bengaluru.

    GET  /api/command/events   — active + upcoming events for command center panel
    POST /api/simulation/run   — run ML impact simulation for a DB event
"""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
import sys

from flask import Blueprint, request, jsonify

_BASE = Path(__file__).resolve().parents[1]
if str(_BASE) not in sys.path:
    sys.path.insert(0, str(_BASE))

from database.db import get_connection, row_to_dict, rows_to_list

log = logging.getLogger(__name__)

simulation_bp = Blueprint("simulation_bp", __name__)

_TYPE_TO_CAUSE: dict[str, str] = {
    "Vehicle Breakdown":    "vehicle_breakdown",
    "Accident":             "accident",
    "Tree Fall":            "tree_fall",
    "Water Logging":        "water_logging",
    "Flooding":             "water_logging",
    "Road Construction":    "construction",
    "Pothole":              "construction",
    "Debris on Road":       "accident",
    "Protest":              "protest",
    "Political Rally":      "procession",
    "IPL Match":            "public_event",
    "Cricket Match":        "public_event",
    "Football Match":       "public_event",
    "Concert":              "public_event",
    "Music Festival":       "public_event",
    "Exhibition / Expo":    "public_event",
    "Religious Procession": "procession",
    "Marathon / Run":       "public_event",
    "Cultural Event":       "public_event",
    "VIP Movement":         "procession",
}


@simulation_bp.route("/api/command/events", methods=["GET"])
def command_events():
    """Return active and upcoming events for the command center event panel."""
    try:
        with get_connection() as conn:
            rows = conn.execute(
                """
                SELECT id, event_name, event_category, event_type,
                       location_name, latitude, longitude, zone, corridor,
                       start_datetime, end_datetime, expected_crowd,
                       severity, status, description
                FROM   events
                WHERE  status IN ('ACTIVE', 'UPCOMING')
                ORDER BY
                    CASE severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
                    CASE status  WHEN 'ACTIVE' THEN 0 ELSE 1 END,
                    start_datetime ASC
                """
            ).fetchall()

        events         = rows_to_list(rows)
        active_count   = sum(1 for e in events if e["status"] == "ACTIVE")
        upcoming_count = sum(1 for e in events if e["status"] == "UPCOMING")

        return jsonify({
            "events":         events,
            "active_count":   active_count,
            "upcoming_count": upcoming_count,
            "total_count":    len(events),
        })
    except Exception as exc:
        log.error("command_events: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


@simulation_bp.route("/api/simulation/run", methods=["POST"])
def run_simulation():
    """
    Run ML-backed impact simulation for a database event.

    Body:    { "event_id": <int> }
    Returns: { event, ml_prediction, timeline, suggestions, impact_radius_km }
    """
    try:
        body     = request.get_json(silent=True) or {}
        event_id = body.get("event_id")
        if not event_id:
            return jsonify({"error": "event_id is required"}), 400

        with get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM events WHERE id = ?", (int(event_id),)
            ).fetchone()

        if not row:
            return jsonify({"error": f"Event {event_id} not found"}), 404

        event = row_to_dict(row)

        ml_input = _event_to_ml_input(event)

        from ml_engine import predict_event_response
        ml_pred = predict_event_response(ml_input)

        from simulation.event_impact_engine import build_timeline
        result = build_timeline(event, ml_pred)
        result["event"]         = event
        result["ml_prediction"] = ml_pred

        log.info(
            "Simulation [%s | impact=%.1f | severity=%s | clearance=%d min]",
            event.get("event_name", "?"),
            ml_pred.get("impact_score", 0),
            ml_pred.get("severity_level", "?"),
            ml_pred.get("clearance_time", 0),
        )

        return jsonify(result)

    except Exception as exc:
        log.error("run_simulation: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


@simulation_bp.route("/api/simulation/run-city", methods=["POST"])
def run_city_simulation():
    """
    Run combined city simulation for multiple events.

    Body:    { "events": [<int>, ...] }
    Returns: { city_status, event_impacts, city_timeline, response_plan }
    """
    try:
        body      = request.get_json(silent=True) or {}
        event_ids = body.get("events", [])
        if not event_ids:
            return jsonify({"error": "events list is required"}), 400

        from ml_engine import predict_event_response
        from simulation.event_impact_engine import build_timeline
        from simulation.multi_event_engine import run_city_simulation as _combine

        pairs = []
        with get_connection() as conn:
            for eid in event_ids:
                row = conn.execute("SELECT * FROM events WHERE id = ?", (int(eid),)).fetchone()
                if not row:
                    continue
                event    = row_to_dict(row)
                ml_input = _event_to_ml_input(event)
                ml_pred  = predict_event_response(ml_input)
                tl_data  = build_timeline(event, ml_pred)
                pairs.append({"event": event, "ml": ml_pred, "timeline": tl_data})

        if not pairs:
            return jsonify({"error": "No valid events found"}), 404

        # Derive reference time = earliest event start_datetime, fallback to now
        ref_dt = None
        for p in pairs:
            raw = p["event"].get("start_datetime", "")
            if raw:
                try:
                    dt = datetime.fromisoformat(str(raw))
                    if ref_dt is None or dt < ref_dt:
                        ref_dt = dt
                except Exception:
                    pass
        reference_dt = (ref_dt or datetime.now()).isoformat()

        result = _combine(pairs, reference_dt=reference_dt)
        log.info("City simulation: %d events · avg_cong=%.1f%%", len(pairs), result["city_status"]["avg_congestion_pct"])
        return jsonify(result)

    except Exception as exc:
        log.error("run_city_simulation: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


def _event_to_ml_input(event: dict) -> dict:
    """Map a DB event row to the dict expected by ml_engine.predict_event_response."""
    event_type  = event.get("event_type") or "Others"
    event_cause = _TYPE_TO_CAUSE.get(event_type, "others")
    severity    = event.get("severity", "MEDIUM")
    priority    = {"HIGH": "High", "MEDIUM": "Medium", "LOW": "Low"}.get(severity, "Medium")
    crowd       = event.get("expected_crowd") or 0
    description = event.get("description") or ""
    if crowd > 0:
        description = f"crowd {crowd} " + description

    return {
        "event_cause":    event_cause,
        "priority":       priority,
        "description":    description,
        "zone":           event.get("zone") or "",
        "corridor":       event.get("corridor") or "",
        "latitude":       event.get("latitude") or 12.9716,
        "longitude":      event.get("longitude") or 77.5946,
        "expected_crowd": crowd,
        "event_category": event.get("event_category", "INCIDENT"),
    }
