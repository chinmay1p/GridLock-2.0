"""
Traffic Twin Bengaluru — ML Inference Engine
=============================================
Single public function:

    predict_event_response(event_json: dict) -> dict

Returns operational recommendations for any traffic event.

Input fields (all optional except event_cause):
    event_type      str   "planned" | "unplanned"
    event_cause     str   e.g. "accident", "vehicle_breakdown", "public_event"
    priority        str   "High" | "Low"
    latitude        float
    longitude       float
    zone            str   e.g. "South Zone 2"
    corridor        str   e.g. "Hosur Road"  (use "Non-corridor" if unknown)
    junction        str
    police_station  str
    veh_type        str   e.g. "heavy_vehicle", "private_car"
    hour            int   0-23  (current hour; default: current time)
    day             int   0=Monday … 6=Sunday
    description     str   free-text incident description

Output:
    clearance_time        int   minutes until road clears
    impact_score          float 0-100 road impact intensity
    barricade_percentage  float 0-100 % barricading required
    closure_required      bool  road closure needed
    diversion_required    bool  traffic diversion needed
    manpower_required     int   total police officers
    severity_level        str   "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    affected_area_score   float 0-100 estimated spatial impact
"""

from __future__ import annotations

import os
import logging
from datetime import datetime
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd
import joblib

logger = logging.getLogger(__name__)

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

# ─────────────────────────────────────────────
# CAUSE → CATEGORY MAP (mirrors training)
# ─────────────────────────────────────────────
CAUSE_CATEGORY: dict[str, str] = {
    "accident":             "accident",
    "water_logging":        "weather",
    "Fog / Low Visibility": "weather",
    "public_event":         "public",
    "procession":           "public",
    "vip_movement":         "public",
    "protest":              "public",
    "construction":         "infrastructure",
    "pot_holes":            "infrastructure",
    "road_conditions":      "infrastructure",
    "Debris":               "infrastructure",
    "debris":               "infrastructure",
    "vehicle_breakdown":    "breakdown",
    "congestion":           "congestion",
    "tree_fall":            "tree_fall",
    "others":               "others",
    "test_demo":            "others",
}

HEAVY_VEH = {"heavy_vehicle", "truck", "bmtc_bus", "private_bus", "ksrtc_bus"}

SEVERITY_KEYWORDS: dict[str, float] = {
    "fatal": 10, "death": 10, "died": 10,
    "injury": 8, "injured": 8, "hurt": 7,
    "fire": 8, "blast": 8,
    "overturned": 7, "collision": 7, "major accident": 7,
    "blocked": 6, "full block": 8, "complete block": 9,
    "flood": 6, "waterlog": 6, "heavy rain": 5,
    "crowd": 4, "procession": 4, "rally": 5,
    "breakdown": 3, "stuck": 3, "stranded": 4,
    "heavy traffic": 5, "severe": 5, "major": 4,
    "construction": 2, "pothole": 2, "minor": 1, "slow": 1,
}


# ─────────────────────────────────────────────
# MODEL LOADER (lazy, cached)
# ─────────────────────────────────────────────
_MODELS: dict[str, Any] = {}
_ENCODER: dict[str, Any] = {}


def _load_models() -> None:
    """Load all models from disk exactly once."""
    if _MODELS:
        return

    required = [
        "clearance_model", "impact_model", "barricade_model",
        "closure_model", "manpower_model", "diversion_model",
        "feature_encoder",
    ]
    for name in required:
        path = os.path.join(MODELS_DIR, f"{name}.pkl")
        if not os.path.exists(path):
            raise FileNotFoundError(
                f"Model file not found: {path}\n"
                "Run  python train_ml_engine.py  first to build the models."
            )
        obj = joblib.load(path)
        if name == "feature_encoder":
            _ENCODER.update(obj)
        else:
            _MODELS[name] = obj

    logger.info("ML engine: all 6 models loaded from %s", MODELS_DIR)


# ─────────────────────────────────────────────
# PREPROCESSING
# ─────────────────────────────────────────────
def _description_severity(text: str) -> float:
    text = str(text).lower()
    score = 0.0
    for kw, weight in SEVERITY_KEYWORDS.items():
        if kw in text:
            score += weight
    return min(10.0, score)


def _encode(col: str, val: str) -> int:
    """Label-encode a value; return 0 for unseen categories."""
    encoders = _ENCODER.get("label_encoders", {})
    le = encoders.get(col)
    if le is None:
        return 0
    val = str(val).strip()
    if val in le.classes_:
        return int(le.transform([val])[0])
    return 0


def _build_feature_row(event: dict) -> pd.DataFrame:
    """Convert raw event dict to a single-row feature DataFrame."""
    now        = datetime.now()
    hour       = int(event.get("hour", now.hour))
    day        = int(event.get("day",  now.weekday()))

    event_cause  = str(event.get("event_cause",  "others")).strip()
    event_type   = str(event.get("event_type",   "unplanned")).strip()
    priority     = str(event.get("priority",     "High")).strip()
    veh_type     = str(event.get("veh_type",     "others")).strip()
    zone         = str(event.get("zone",         "unknown")).strip()
    corridor     = str(event.get("corridor",     "Non-corridor")).strip()
    junction     = str(event.get("junction",     "unknown")).strip()
    police_stn   = str(event.get("police_station","unknown")).strip()
    description  = str(event.get("description",  "")).strip()
    lat          = float(event.get("latitude",   12.9716))
    lon          = float(event.get("longitude",  77.5946))

    category = CAUSE_CATEGORY.get(event_cause, "others")

    row: dict[str, float] = {
        "event_type_enc":      _encode("event_type",     event_type),
        "event_cause_enc":     _encode("event_cause",    event_cause),
        "event_category_enc":  _encode("event_category", category),
        "priority_enc":        _encode("priority",       priority),
        "priority_high":       1 if priority.lower() == "high" else 0,
        "veh_type_enc":        _encode("veh_type",       veh_type),
        "veh_is_heavy":        1 if veh_type in HEAVY_VEH else 0,
        "latitude":            lat,
        "longitude":           lon,
        "zone_enc":            _encode("zone",           zone),
        "corridor_enc":        _encode("corridor",       corridor),
        "corridor_is_major":   0 if corridor.lower() == "non-corridor" else 1,
        "junction_enc":        _encode("junction",       junction),
        "police_station_enc":  _encode("police_station", police_stn),
        "hour":                hour,
        "dayofweek":           day,
        "is_weekend":          1 if day >= 5 else 0,
        "is_morning_peak":     1 if 7 <= hour <= 10 else 0,
        "is_evening_peak":     1 if 17 <= hour <= 21 else 0,
        "is_night":            1 if hour >= 22 or hour <= 5 else 0,
        "description_severity":_description_severity(description),
    }

    feature_cols = _ENCODER.get("feature_cols", list(row.keys()))
    return pd.DataFrame([row])[feature_cols]


# ─────────────────────────────────────────────
# POST-PROCESSING HELPERS
# ─────────────────────────────────────────────

# Minimum clearance floors by event cause (minutes).
# The ASTRAM `closed_datetime` reflects report closure, not physical road
# clearance, so raw model output can be unrealistically short for severe
# events.  These floors enforce operational realism.
_CLEARANCE_FLOOR: dict[str, int] = {
    "accident":          60,
    "water_logging":     90,
    "public_event":     180,
    "procession":       120,
    "protest":          120,
    "vip_movement":      60,
    "construction":      60,
    "tree_fall":         45,
    "vehicle_breakdown": 20,
    "congestion":        30,
    "pot_holes":         15,
    "road_conditions":   15,
    "others":            20,
}


def _apply_clearance_floor(clearance: float, event_cause: str, impact: float) -> float:
    """Ensure clearance time is operationally realistic."""
    floor = _CLEARANCE_FLOOR.get(event_cause, 20)
    # High-impact events get a proportional boost on the floor
    if impact >= 80:
        floor = max(floor, 90)
    elif impact >= 60:
        floor = max(floor, 45)
    return max(clearance, float(floor))


def _severity_level(impact: float, clearance: float, closure: bool) -> str:
    if closure or impact >= 80 or clearance >= 300:
        return "CRITICAL"
    if impact >= 60 or clearance >= 120:
        return "HIGH"
    if impact >= 35 or clearance >= 45:
        return "MEDIUM"
    return "LOW"


def _affected_area_score(impact: float, corridor_is_major: bool) -> float:
    """Rough 0-100 spatial impact proxy."""
    base = impact * 0.7
    if corridor_is_major:
        base = min(100, base * 1.2)
    return round(min(100.0, max(0.0, base)), 1)


# ─────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────
def predict_event_response(event_json: dict) -> dict:
    """
    Main inference function.

    Parameters
    ----------
    event_json : dict
        Incoming event with any combination of known fields.

    Returns
    -------
    dict
        Operational recommendations from all 6 ML models.
    """
    _load_models()

    X = _build_feature_row(event_json)

    # Run all 6 models
    clearance  = float(_MODELS["clearance_model"].predict(X)[0])
    impact     = float(_MODELS["impact_model"].predict(X)[0])
    barricade  = float(_MODELS["barricade_model"].predict(X)[0])
    closure    = bool(_MODELS["closure_model"].predict(X)[0])
    manpower   = float(_MODELS["manpower_model"].predict(X)[0])
    diversion  = bool(_MODELS["diversion_model"].predict(X)[0])

    # Clip + round
    event_cause = str(event_json.get("event_cause", "others"))
    clearance  = _apply_clearance_floor(clearance, event_cause, impact)
    clearance  = round(max(1.0, clearance), 0)
    impact     = round(min(100.0, max(0.0, impact)), 1)
    barricade  = round(min(100.0, max(0.0, barricade)), 1)
    manpower   = round(max(5.0, manpower), 0)

    # Hard rule: very high impact + heavy barricading → force closure flag
    if impact >= 88 and barricade >= 85 and not closure:
        closure = True

    # Hard rule: closure always implies diversion
    if closure:
        diversion = True

    corridor       = str(event_json.get("corridor", "Non-corridor"))
    corridor_major = corridor.lower() != "non-corridor"

    return {
        "clearance_time":       int(clearance),
        "impact_score":         impact,
        "barricade_percentage": barricade,
        "closure_required":     closure,
        "diversion_required":   diversion,
        "manpower_required":    int(manpower),
        "severity_level":       _severity_level(impact, clearance, closure),
        "affected_area_score":  _affected_area_score(impact, corridor_major),
    }


# ─────────────────────────────────────────────
# QUICK CLI TEST
# ─────────────────────────────────────────────
if __name__ == "__main__":
    import json

    print("=" * 55)
    print("  ML ENGINE — QUICK TEST")
    print("=" * 55)

    cases = [
        {
            "_label": "Case 1: Small vehicle breakdown",
            "event_cause": "vehicle_breakdown",
            "priority": "Low",
            "veh_type": "private_car",
            "corridor": "Non-corridor",
            "zone": "Central Zone 1",
            "latitude": 12.9716, "longitude": 77.5946,
            "hour": 14,
            "description": "Car stalled. Minor blockage.",
        },
        {
            "_label": "Case 2: Large stadium event (IPL)",
            "event_cause": "public_event",
            "priority": "High",
            "veh_type": "others",
            "corridor": "CBD 2",
            "zone": "Central Zone 1",
            "latitude": 12.9792, "longitude": 77.5913,
            "hour": 18,
            "description": "Large crowd for IPL match. Heavy traffic all access roads.",
        },
        {
            "_label": "Case 3: Major truck accident",
            "event_cause": "accident",
            "priority": "High",
            "veh_type": "heavy_vehicle",
            "corridor": "Hosur Road",
            "zone": "South Zone 2",
            "latitude": 12.9176, "longitude": 77.6244,
            "hour": 8,
            "description": "Truck overturned. Road blocked. Injury reported. Major accident.",
        },
    ]

    for case in cases:
        label = case.pop("_label")
        result = predict_event_response(case)
        print(f"\n{label}")
        print(json.dumps(result, indent=2))
