"""
Event Management CRUD API — Traffic Twin Bengaluru
===================================================
Provides persistent event storage via SQLite.
Does NOT touch the simulation event_routes.py blueprint.

Routes:
    GET  /api/events                 — all events
    GET  /api/events/public          — PUBLIC_EVENT category only
    GET  /api/events/incidents       — INCIDENT category only
    GET  /api/events/summary         — aggregate counts
    POST /api/events/add             — create event
    PUT  /api/events/update/<id>     — update event fields or status
    DELETE /api/events/delete/<id>   — remove event
"""

import logging
from datetime import datetime

from flask import Blueprint, jsonify, request

from database.db import get_connection, row_to_dict, rows_to_list
from database.location_mapper import get_coordinates

logger = logging.getLogger(__name__)

events_manager_bp = Blueprint("events_manager", __name__)

VALID_CATEGORIES = {"PUBLIC_EVENT", "INCIDENT"}
VALID_SEVERITIES = {"LOW", "MEDIUM", "HIGH"}
VALID_STATUSES   = {"UPCOMING", "ACTIVE", "RESOLVED"}


# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────

def _validate_event(data: dict, require_name: bool = True) -> list[str]:
    errors = []
    if require_name and not str(data.get("event_name", "")).strip():
        errors.append("event_name is required.")
    cat = data.get("event_category", "INCIDENT").upper()
    if cat not in VALID_CATEGORIES:
        errors.append(f"event_category must be one of {VALID_CATEGORIES}.")
    sev = data.get("severity", "MEDIUM").upper()
    if sev not in VALID_SEVERITIES:
        errors.append(f"severity must be one of {VALID_SEVERITIES}.")
    crowd = data.get("expected_crowd", 0)
    if crowd is not None:
        try:
            if int(crowd) < 0:
                errors.append("expected_crowd cannot be negative.")
        except (TypeError, ValueError):
            errors.append("expected_crowd must be an integer.")
    return errors


def _resolve_coords(data: dict) -> tuple[float | None, float | None]:
    """Use provided coords or look up by location name."""
    lat = data.get("latitude")
    lng = data.get("longitude")
    if lat is not None and lng is not None:
        try:
            return float(lat), float(lng)
        except (TypeError, ValueError):
            pass
    location = data.get("location_name", "")
    if location:
        return get_coordinates(location)
    return None, None


# ─────────────────────────────────────────────
# READ ENDPOINTS
# ─────────────────────────────────────────────

@events_manager_bp.route("/api/events", methods=["GET"])
def get_all_events():
    """Return all events ordered by created_at descending."""
    try:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM events ORDER BY created_at DESC"
            ).fetchall()
        return jsonify({"events": rows_to_list(rows), "count": len(rows)})
    except Exception as exc:
        logger.error("get_all_events error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


@events_manager_bp.route("/api/events/public", methods=["GET"])
def get_public_events():
    """Return planned public events ordered by start_datetime."""
    try:
        with get_connection() as conn:
            rows = conn.execute(
                """SELECT * FROM events
                   WHERE event_category = 'PUBLIC_EVENT'
                   ORDER BY
                       CASE status WHEN 'ACTIVE' THEN 0 WHEN 'UPCOMING' THEN 1 ELSE 2 END,
                       start_datetime ASC"""
            ).fetchall()
        return jsonify({"events": rows_to_list(rows), "count": len(rows)})
    except Exception as exc:
        logger.error("get_public_events error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


@events_manager_bp.route("/api/events/incidents", methods=["GET"])
def get_incidents():
    """Return incident reports ordered by severity then created_at."""
    try:
        with get_connection() as conn:
            rows = conn.execute(
                """SELECT * FROM events
                   WHERE event_category = 'INCIDENT'
                   ORDER BY
                       CASE severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
                       CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END,
                       created_at DESC"""
            ).fetchall()
        return jsonify({"events": rows_to_list(rows), "count": len(rows)})
    except Exception as exc:
        logger.error("get_incidents error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


@events_manager_bp.route("/api/events/summary", methods=["GET"])
def get_events_summary():
    """Return aggregate counts for the dashboard summary cards."""
    try:
        with get_connection() as conn:
            total          = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
            public_count   = conn.execute(
                "SELECT COUNT(*) FROM events WHERE event_category = 'PUBLIC_EVENT'"
            ).fetchone()[0]
            incident_count = conn.execute(
                "SELECT COUNT(*) FROM events WHERE event_category = 'INCIDENT'"
            ).fetchone()[0]
            high_count     = conn.execute(
                "SELECT COUNT(*) FROM events WHERE severity = 'HIGH' AND status != 'RESOLVED'"
            ).fetchone()[0]
            active_count   = conn.execute(
                "SELECT COUNT(*) FROM events WHERE status = 'ACTIVE'"
            ).fetchone()[0]
        return jsonify({
            "total":          total,
            "public_events":  public_count,
            "incidents":      incident_count,
            "high_severity":  high_count,
            "active":         active_count,
        })
    except Exception as exc:
        logger.error("get_events_summary error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


# ─────────────────────────────────────────────
# CREATE
# ─────────────────────────────────────────────

@events_manager_bp.route("/api/events/add", methods=["POST"])
def add_event():
    """Create a new event. Returns the newly created event row."""
    data = request.get_json(silent=True) or {}

    errors = _validate_event(data)
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400

    lat, lng = _resolve_coords(data)
    category = data.get("event_category", "INCIDENT").upper()

    # Incidents are ACTIVE by default; public events start as UPCOMING
    default_status = "ACTIVE" if category == "INCIDENT" else "UPCOMING"
    status = data.get("status", default_status).upper()
    if status not in VALID_STATUSES:
        status = default_status

    try:
        with get_connection() as conn:
            cursor = conn.execute(
                """INSERT INTO events
                   (event_name, event_category, event_type, location_name,
                    latitude, longitude, zone, corridor,
                    start_datetime, end_datetime, expected_crowd,
                    severity, status, description)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    str(data.get("event_name", "")).strip(),
                    category,
                    data.get("event_type", ""),
                    data.get("location_name", ""),
                    lat, lng,
                    data.get("zone", ""),
                    data.get("corridor", ""),
                    data.get("start_datetime", ""),
                    data.get("end_datetime", ""),
                    int(data.get("expected_crowd", 0) or 0),
                    data.get("severity", "MEDIUM").upper(),
                    status,
                    data.get("description", ""),
                ),
            )
            conn.commit()
            new_id = cursor.lastrowid
            row = conn.execute(
                "SELECT * FROM events WHERE id = ?", (new_id,)
            ).fetchone()

        logger.info("Created event id=%d name=%s", new_id, data.get("event_name"))
        return jsonify({"event": row_to_dict(row), "created": True}), 201

    except Exception as exc:
        logger.error("add_event error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


# ─────────────────────────────────────────────
# UPDATE
# ─────────────────────────────────────────────

@events_manager_bp.route("/api/events/update/<int:event_id>", methods=["PUT"])
def update_event(event_id: int):
    """
    Update one or more fields of an event.
    Partial updates are supported — only provided keys are changed.
    """
    data = request.get_json(silent=True) or {}

    if "event_name" in data and not str(data["event_name"]).strip():
        return jsonify({"error": "event_name cannot be empty."}), 400

    try:
        with get_connection() as conn:
            existing = conn.execute(
                "SELECT * FROM events WHERE id = ?", (event_id,)
            ).fetchone()
            if existing is None:
                return jsonify({"error": f"Event {event_id} not found."}), 404

            # Build dynamic SET clause from provided fields
            allowed = {
                "event_name", "event_category", "event_type", "location_name",
                "latitude", "longitude", "zone", "corridor",
                "start_datetime", "end_datetime", "expected_crowd",
                "severity", "status", "description",
            }
            updates = {}
            for key in allowed:
                if key in data:
                    val = data[key]
                    if key == "severity":
                        val = str(val).upper()
                        if val not in VALID_SEVERITIES:
                            return jsonify({"error": f"Invalid severity: {val}"}), 400
                    elif key == "status":
                        val = str(val).upper()
                        if val not in VALID_STATUSES:
                            return jsonify({"error": f"Invalid status: {val}"}), 400
                    elif key == "event_category":
                        val = str(val).upper()
                        if val not in VALID_CATEGORIES:
                            return jsonify({"error": f"Invalid category: {val}"}), 400
                    elif key == "expected_crowd":
                        try:
                            val = int(val or 0)
                        except (TypeError, ValueError):
                            return jsonify({"error": "expected_crowd must be integer"}), 400
                    updates[key] = val

            # Auto-resolve coords if location changed but coords not provided
            if "location_name" in updates and "latitude" not in updates:
                lat, lng = get_coordinates(updates["location_name"])
                updates["latitude"]  = lat
                updates["longitude"] = lng

            if not updates:
                return jsonify({"message": "No fields to update."}), 200

            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values     = list(updates.values()) + [event_id]
            conn.execute(
                f"UPDATE events SET {set_clause} WHERE id = ?", values
            )
            conn.commit()

            updated_row = conn.execute(
                "SELECT * FROM events WHERE id = ?", (event_id,)
            ).fetchone()

        logger.info("Updated event id=%d fields=%s", event_id, list(updates.keys()))
        return jsonify({"event": row_to_dict(updated_row), "updated": True})

    except Exception as exc:
        logger.error("update_event error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


# ─────────────────────────────────────────────
# DELETE
# ─────────────────────────────────────────────

@events_manager_bp.route("/api/events/delete/<int:event_id>", methods=["DELETE"])
def delete_event(event_id: int):
    """Permanently remove an event from the database."""
    try:
        with get_connection() as conn:
            existing = conn.execute(
                "SELECT id FROM events WHERE id = ?", (event_id,)
            ).fetchone()
            if existing is None:
                return jsonify({"error": f"Event {event_id} not found."}), 404

            conn.execute("DELETE FROM events WHERE id = ?", (event_id,))
            conn.commit()

        logger.info("Deleted event id=%d", event_id)
        return jsonify({"deleted": True, "id": event_id})

    except Exception as exc:
        logger.error("delete_event error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500
