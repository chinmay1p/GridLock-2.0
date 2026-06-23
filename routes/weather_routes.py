"""
Weather Risk Intelligence API — Traffic Twin Bengaluru
=======================================================
Manages weather alerts with predicted traffic impact for Bengaluru.

Routes:
    GET  /api/weather/alerts              — active + monitoring alerts (ordered by severity)
    GET  /api/weather/alerts/summary      — aggregate counts for UI badges
    POST /api/weather/alerts              — create a new alert
    PUT  /api/weather/alerts/<id>         — update fields or status
    DELETE /api/weather/alerts/<id>       — delete alert
    POST /api/weather/alerts/<id>/convert — convert alert → INCIDENT in events table
"""

import logging
from datetime import datetime

from flask import Blueprint, jsonify, request

from database.db import get_connection, row_to_dict, rows_to_list

logger = logging.getLogger(__name__)

weather_bp = Blueprint("weather", __name__)

VALID_SEVERITIES = {"CRITICAL", "HIGH", "MEDIUM", "WATCH"}
VALID_STATUSES   = {"ACTIVE", "MONITORING", "EXPIRED", "DISMISSED"}
VALID_TYPES      = {
    "HEAVY_RAINFALL", "WATERLOGGING", "FLOODING",
    "LOW_VISIBILITY", "STORM", "HIGH_WINDS", "FOG", "HEATWAVE",
}

# Map weather type → closest events.event_type value
_TO_EVENT_TYPE = {
    "HEAVY_RAINFALL": "Water Logging",
    "WATERLOGGING":   "Water Logging",
    "FLOODING":       "Flooding",
    "LOW_VISIBILITY": "Other",
    "STORM":          "Other",
    "HIGH_WINDS":     "Other",
    "FOG":            "Other",
    "HEATWAVE":       "Other",
}

# Map weather severity → events.severity (events only have LOW/MEDIUM/HIGH)
_TO_EVENT_SEV = {
    "CRITICAL": "HIGH",
    "HIGH":     "HIGH",
    "MEDIUM":   "MEDIUM",
    "WATCH":    "LOW",
}


# ─────────────────────────────────────────────
# READ
# ─────────────────────────────────────────────

@weather_bp.route("/api/weather/alerts", methods=["GET"])
def get_weather_alerts():
    """Return active and monitoring alerts ordered by severity."""
    try:
        with get_connection() as conn:
            rows = conn.execute(
                """SELECT * FROM weather_alerts
                   WHERE status IN ('ACTIVE', 'MONITORING')
                   ORDER BY
                       CASE severity
                           WHEN 'CRITICAL' THEN 0
                           WHEN 'HIGH'     THEN 1
                           WHEN 'MEDIUM'   THEN 2
                           WHEN 'WATCH'    THEN 3
                           ELSE 4
                       END,
                       created_at DESC"""
            ).fetchall()
        return jsonify({"alerts": rows_to_list(rows), "count": len(rows)})
    except Exception as exc:
        logger.error("get_weather_alerts error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


@weather_bp.route("/api/weather/alerts/summary", methods=["GET"])
def get_weather_summary():
    """Aggregate counts for summary badges."""
    try:
        with get_connection() as conn:
            active   = conn.execute(
                "SELECT COUNT(*) FROM weather_alerts WHERE status IN ('ACTIVE','MONITORING')"
            ).fetchone()[0]
            critical = conn.execute(
                "SELECT COUNT(*) FROM weather_alerts WHERE severity='CRITICAL' AND status IN ('ACTIVE','MONITORING')"
            ).fetchone()[0]
            high     = conn.execute(
                "SELECT COUNT(*) FROM weather_alerts WHERE severity='HIGH' AND status IN ('ACTIVE','MONITORING')"
            ).fetchone()[0]
        return jsonify({"active": active, "critical": critical, "high": high})
    except Exception as exc:
        logger.error("get_weather_summary error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


# ─────────────────────────────────────────────
# CREATE
# ─────────────────────────────────────────────

@weather_bp.route("/api/weather/alerts", methods=["POST"])
def create_weather_alert():
    data = request.get_json(silent=True) or {}

    errors = []
    if not str(data.get("condition_name", "")).strip():
        errors.append("condition_name is required.")
    if not str(data.get("affected_area", "")).strip():
        errors.append("affected_area is required.")
    sev = str(data.get("severity", "HIGH")).upper()
    if sev not in VALID_SEVERITIES:
        errors.append(f"severity must be one of {sorted(VALID_SEVERITIES)}.")
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400

    alert_type = str(data.get("alert_type", "HEAVY_RAINFALL")).upper()
    if alert_type not in VALID_TYPES:
        alert_type = "HEAVY_RAINFALL"

    try:
        with get_connection() as conn:
            cursor = conn.execute(
                """INSERT INTO weather_alerts
                   (alert_type, condition_name, affected_area, zone,
                    latitude, longitude, severity,
                    rainfall_mm, wind_speed_kmh, visibility_m,
                    valid_from, valid_until,
                    traffic_impact, affected_roads, recommended_action, source, status)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    alert_type,
                    str(data.get("condition_name", "")).strip(),
                    str(data.get("affected_area",  "")).strip(),
                    data.get("zone", ""),
                    data.get("latitude"),
                    data.get("longitude"),
                    sev,
                    float(data.get("rainfall_mm",     0) or 0),
                    float(data.get("wind_speed_kmh",  0) or 0),
                    float(data.get("visibility_m",    0) or 0),
                    data.get("valid_from",  ""),
                    data.get("valid_until", ""),
                    data.get("traffic_impact",      ""),
                    data.get("affected_roads",      ""),
                    data.get("recommended_action",  ""),
                    data.get("source", "Manual Entry"),
                    str(data.get("status", "ACTIVE")).upper(),
                ),
            )
            conn.commit()
            new_id = cursor.lastrowid
            row    = conn.execute(
                "SELECT * FROM weather_alerts WHERE id = ?", (new_id,)
            ).fetchone()

        logger.info("Created weather alert id=%d: %s", new_id, data.get("condition_name"))
        return jsonify({"alert": row_to_dict(row), "created": True}), 201

    except Exception as exc:
        logger.error("create_weather_alert error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


# ─────────────────────────────────────────────
# UPDATE
# ─────────────────────────────────────────────

@weather_bp.route("/api/weather/alerts/<int:alert_id>", methods=["PUT"])
def update_weather_alert(alert_id: int):
    data = request.get_json(silent=True) or {}
    try:
        with get_connection() as conn:
            existing = conn.execute(
                "SELECT id FROM weather_alerts WHERE id = ?", (alert_id,)
            ).fetchone()
            if existing is None:
                return jsonify({"error": f"Alert {alert_id} not found."}), 404

            allowed = {
                "alert_type", "condition_name", "affected_area", "zone",
                "latitude", "longitude", "severity",
                "rainfall_mm", "wind_speed_kmh", "visibility_m",
                "valid_from", "valid_until",
                "traffic_impact", "affected_roads", "recommended_action", "source", "status",
            }
            updates = {}
            for key in allowed:
                if key not in data:
                    continue
                val = data[key]
                if key == "severity":
                    val = str(val).upper()
                    if val not in VALID_SEVERITIES:
                        return jsonify({"error": f"Invalid severity: {val}"}), 400
                elif key == "status":
                    val = str(val).upper()
                    if val not in VALID_STATUSES:
                        return jsonify({"error": f"Invalid status: {val}"}), 400
                updates[key] = val

            if not updates:
                return jsonify({"message": "No fields to update."}), 200

            set_clause = ", ".join(f"{k} = ?" for k in updates)
            conn.execute(
                f"UPDATE weather_alerts SET {set_clause} WHERE id = ?",
                list(updates.values()) + [alert_id],
            )
            conn.commit()
            updated = conn.execute(
                "SELECT * FROM weather_alerts WHERE id = ?", (alert_id,)
            ).fetchone()

        logger.info("Updated weather alert id=%d fields=%s", alert_id, list(updates.keys()))
        return jsonify({"alert": row_to_dict(updated), "updated": True})

    except Exception as exc:
        logger.error("update_weather_alert error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


# ─────────────────────────────────────────────
# DELETE
# ─────────────────────────────────────────────

@weather_bp.route("/api/weather/alerts/<int:alert_id>", methods=["DELETE"])
def delete_weather_alert(alert_id: int):
    try:
        with get_connection() as conn:
            existing = conn.execute(
                "SELECT id FROM weather_alerts WHERE id = ?", (alert_id,)
            ).fetchone()
            if existing is None:
                return jsonify({"error": f"Alert {alert_id} not found."}), 404
            conn.execute("DELETE FROM weather_alerts WHERE id = ?", (alert_id,))
            conn.commit()

        logger.info("Deleted weather alert id=%d", alert_id)
        return jsonify({"deleted": True, "id": alert_id})

    except Exception as exc:
        logger.error("delete_weather_alert error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


# ─────────────────────────────────────────────
# CONVERT → INCIDENT
# ─────────────────────────────────────────────

@weather_bp.route("/api/weather/alerts/<int:alert_id>/convert", methods=["POST"])
def convert_to_incident(alert_id: int):
    """
    Promote a weather alert to an INCIDENT in the events table so it can be
    analysed in the Command Center simulation pipeline.
    """
    try:
        with get_connection() as conn:
            alert_row = conn.execute(
                "SELECT * FROM weather_alerts WHERE id = ?", (alert_id,)
            ).fetchone()
            if alert_row is None:
                return jsonify({"error": f"Alert {alert_id} not found."}), 404

            alert = row_to_dict(alert_row)

            ev_type = _TO_EVENT_TYPE.get(alert["alert_type"], "Other")
            ev_sev  = _TO_EVENT_SEV.get(alert["severity"], "MEDIUM")
            ev_name = alert["condition_name"]
            ev_loc  = alert["affected_area"]
            ev_desc = (
                f"[Weather Alert] {alert.get('traffic_impact', '')} "
                f"| Action: {alert.get('recommended_action', '')}"
            ).strip(" |")
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            cursor = conn.execute(
                """INSERT INTO events
                   (event_name, event_category, event_type, location_name,
                    latitude, longitude, zone,
                    start_datetime, severity, status, description)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    ev_name, "INCIDENT", ev_type, ev_loc,
                    alert.get("latitude"), alert.get("longitude"),
                    alert.get("zone", ""),
                    now_str,
                    ev_sev, "ACTIVE",
                    ev_desc,
                ),
            )
            new_event_id = cursor.lastrowid

            # Mark alert as MONITORING so it's not re-converted
            conn.execute(
                "UPDATE weather_alerts SET status = 'MONITORING' WHERE id = ?",
                (alert_id,),
            )
            conn.commit()

            new_event = conn.execute(
                "SELECT * FROM events WHERE id = ?", (new_event_id,)
            ).fetchone()

        logger.info(
            "Weather alert id=%d converted to incident id=%d", alert_id, new_event_id
        )
        return jsonify({
            "event":      row_to_dict(new_event),
            "alert_id":   alert_id,
            "converted":  True,
        }), 201

    except Exception as exc:
        logger.error("convert_to_incident error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500
