"""
SQLite connection factory and table initializer for Traffic Twin Bengaluru.

Usage inside a route:
    from database.db import get_connection, rows_to_list, row_to_dict

    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM events").fetchall()
    return jsonify(rows_to_list(rows))
"""

import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
DB_PATH  = BASE_DIR / "traffic_twin.db"

CREATE_EVENTS_TABLE = """
CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name      TEXT    NOT NULL,
    event_category  TEXT    NOT NULL DEFAULT 'INCIDENT',
    event_type      TEXT,
    location_name   TEXT,
    latitude        REAL,
    longitude       REAL,
    zone            TEXT,
    corridor        TEXT,
    start_datetime  TEXT,
    end_datetime    TEXT,
    expected_crowd  INTEGER DEFAULT 0,
    severity        TEXT    NOT NULL DEFAULT 'MEDIUM',
    status          TEXT    NOT NULL DEFAULT 'UPCOMING',
    description     TEXT,
    created_at      TEXT    DEFAULT (datetime('now', 'localtime')),
    updated_at      TEXT    DEFAULT (datetime('now', 'localtime'))
);
"""

UPDATE_TRIGGER = """
CREATE TRIGGER IF NOT EXISTS events_updated_at
AFTER UPDATE ON events
FOR EACH ROW
BEGIN
    UPDATE events SET updated_at = datetime('now', 'localtime') WHERE id = OLD.id;
END;
"""

CREATE_WEATHER_TABLE = """
CREATE TABLE IF NOT EXISTS weather_alerts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_type          TEXT    NOT NULL DEFAULT 'HEAVY_RAINFALL',
    condition_name      TEXT    NOT NULL,
    affected_area       TEXT    NOT NULL,
    zone                TEXT,
    latitude            REAL,
    longitude           REAL,
    severity            TEXT    NOT NULL DEFAULT 'HIGH',
    rainfall_mm         REAL    DEFAULT 0,
    wind_speed_kmh      REAL    DEFAULT 0,
    visibility_m        REAL    DEFAULT 0,
    valid_from          TEXT,
    valid_until         TEXT,
    traffic_impact      TEXT,
    affected_roads      TEXT,
    recommended_action  TEXT,
    source              TEXT    DEFAULT 'IMD Forecast',
    status              TEXT    NOT NULL DEFAULT 'ACTIVE',
    created_at          TEXT    DEFAULT (datetime('now', 'localtime'))
);
"""


# ─────────────────────────────────────────────
# DATETIME HELPERS  (must be defined before SEED_DATA)
# ─────────────────────────────────────────────

def _today_at(time_str: str) -> str:
    """Return today's ISO date + a HH:MM time string as a full datetime."""
    return f"{date.today().isoformat()} {time_str}:00"


def _minutes_ago(minutes: int) -> str:
    """Return a datetime string N minutes before now."""
    return (datetime.now() - timedelta(minutes=minutes)).strftime("%Y-%m-%d %H:%M:%S")


def _hours_from_now(hours: float) -> str:
    """Return a datetime string N hours in the future."""
    return (datetime.now() + timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")


# ─────────────────────────────────────────────
# SEED DATA
# ─────────────────────────────────────────────

def _build_seed_data() -> list[tuple]:
    """Build seed rows at call time so datetimes are always current."""
    return [
        # ── Public Events ──────────────────────────────────────────────────
        (
            "IPL Match",
            "PUBLIC_EVENT",
            "IPL Match",
            "M. Chinnaswamy Stadium",
            12.9788, 77.5996,
            "Central Zone 1", "CBD 2",
            _today_at("18:30"), _today_at("23:30"),
            35000, "HIGH", "ACTIVE",
            "IPL match at Chinnaswamy Stadium. Heavy crowd expected on all "
            "approach roads — MG Road, Brigade Road, and Cubbon Road.",
        ),
        (
            "South India Property Expo",
            "PUBLIC_EVENT",
            "Exhibition / Expo",
            "Palace Grounds, Jayamahal",
            13.0067, 77.5843,
            "North Zone 1", "Bellary Road 1",
            _today_at("11:00"), _today_at("20:00"),
            15000, "MEDIUM", "UPCOMING",
            "Multi-day property expo at Palace Grounds. Traffic congestion "
            "expected on Bellary Road and Palace Road approaches.",
        ),
        (
            "Political Rally — Freedom Park",
            "PUBLIC_EVENT",
            "Political Rally",
            "Freedom Park, Seshadri Road",
            12.9762, 77.5697,
            "Central Zone 2", "CBD 1",
            _today_at("16:00"), _today_at("20:00"),
            25000, "HIGH", "UPCOMING",
            "Political gathering at Freedom Park. All entrances expected to "
            "see heavy traffic. Diversions may be required on Seshadri Road.",
        ),
        # ── Incidents ──────────────────────────────────────────────────────
        (
            "Vehicle Breakdown — Silk Board",
            "INCIDENT",
            "Vehicle Breakdown",
            "Silk Board Junction",
            12.9177, 77.6238,
            "South Zone 2", "Hosur Road",
            _minutes_ago(20), None,
            0, "HIGH", "ACTIVE",
            "Broken down truck blocking the left lane on Hosur Road near "
            "Silk Board flyover. Lane change advisory issued.",
        ),
        (
            "Tree Fall — Indiranagar",
            "INCIDENT",
            "Tree Fall",
            "Indiranagar 100 Feet Road",
            12.9784, 77.6408,
            "East Zone 1", "Old Madras Road",
            _minutes_ago(45), None,
            0, "MEDIUM", "ACTIVE",
            "Large tree branch fallen on 100 Feet Road near CMH Road "
            "junction. Traffic being managed by manual diversion.",
        ),
        (
            "Water Logging — ORR Underpass",
            "INCIDENT",
            "Water Logging",
            "Outer Ring Road Underpass",
            12.9569, 77.7011,
            "East Zone 2", "ORR East 1",
            _minutes_ago(60), None,
            0, "HIGH", "ACTIVE",
            "Severe water logging at ORR underpass near Marathahalli. "
            "Traffic at a standstill. Heavy vehicles diverted via Sarjapur Road.",
        ),
    ]


# ─────────────────────────────────────────────
# WEATHER ALERT SEED DATA
# ─────────────────────────────────────────────

def _build_weather_seed() -> list[tuple]:
    """
    Realistic Bengaluru monsoon weather alerts seeded at startup.
    Each tuple maps to the INSERT columns below.
    """
    return [
        # ── 1. CRITICAL — Heavy Rainfall, Silk Board / ORR ─────────────────
        (
            "HEAVY_RAINFALL",
            "Heavy Rainfall Warning — Silk Board / ORR Corridor",
            "Silk Board Junction / Electronic City / ORR",
            "South Zone 2",
            12.9177, 77.6238,
            "CRITICAL",
            52.0, 22.0, 0.0,
            _hours_from_now(-0.5), _hours_from_now(7.0),
            "Severe waterlogging expected at Silk Board Junction and below the Hosur Road flyover. "
            "Traffic likely at standstill southbound. ORR Silk Board–Marathahalli stretch at risk of submersion. "
            "Expect 45–90 minute delays on all ORR/Hosur Road approaches.",
            "Hosur Road, Silk Board Junction, ORR East, Sarjapur Road",
            "",
            "IMD Forecast / BBMP Rain Sensors",
            "ACTIVE",
        ),
        # ── 2. HIGH — Waterlogging, Marathahalli Underpass ─────────────────
        (
            "WATERLOGGING",
            "Waterlogging Alert — Marathahalli Underpass",
            "Marathahalli Bridge / ORR East Stretch",
            "East Zone 2",
            12.9569, 77.7011,
            "HIGH",
            35.0, 18.0, 0.0,
            _hours_from_now(0.5), _hours_from_now(8.0),
            "ORR underpass at Marathahalli bridge projected to submerge within 90 minutes of rainfall onset. "
            "Heavy vehicles will need diversion via ITPL Main Road. Old Airport Road approaches will back up significantly.",
            "ORR near Marathahalli, Old Airport Road, ITPL Main Road, Whitefield Road",
            "",
            "BWSSB / IMD",
            "ACTIVE",
        ),
    ]


# ─────────────────────────────────────────────
# CONNECTION
# ─────────────────────────────────────────────

def get_connection() -> sqlite3.Connection:
    """Open and return a SQLite connection with Row factory enabled."""
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None


def rows_to_list(rows) -> list[dict]:
    return [dict(r) for r in rows]


# ─────────────────────────────────────────────
# INITIALIZATION
# ─────────────────────────────────────────────

def initialize_db() -> None:
    """Create tables and seed initial data if the DB is empty."""
    with get_connection() as conn:
        conn.execute(CREATE_EVENTS_TABLE)
        conn.execute(UPDATE_TRIGGER)
        conn.execute(CREATE_WEATHER_TABLE)
        conn.commit()

        # Seed events
        count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        if count == 0:
            seed = _build_seed_data()
            conn.executemany(
                """INSERT INTO events
                   (event_name, event_category, event_type, location_name,
                    latitude, longitude, zone, corridor,
                    start_datetime, end_datetime, expected_crowd,
                    severity, status, description)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                seed,
            )
            conn.commit()
            print(f"[DB] Initialized traffic_twin.db with {len(seed)} seed events.")
        else:
            print(f"[DB] traffic_twin.db already has {count} events — skipping seed.")

        # Seed weather alerts
        w_count = conn.execute("SELECT COUNT(*) FROM weather_alerts").fetchone()[0]
        if w_count == 0:
            w_seed = _build_weather_seed()
            conn.executemany(
                """INSERT INTO weather_alerts
                   (alert_type, condition_name, affected_area, zone,
                    latitude, longitude, severity,
                    rainfall_mm, wind_speed_kmh, visibility_m,
                    valid_from, valid_until,
                    traffic_impact, affected_roads, recommended_action, source, status)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                w_seed,
            )
            conn.commit()
            print(f"[DB] Seeded {len(w_seed)} weather alerts.")
        else:
            print(f"[DB] weather_alerts already has {w_count} rows — skipping seed.")
