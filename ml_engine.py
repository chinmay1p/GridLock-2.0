"""
Traffic Twin Bengaluru — ML Inference Engine
=============================================
Single public function:

    predict_event_response(event_json: dict) -> dict

Returns operational recommendations for any traffic event.
"""

from __future__ import annotations

import os
import logging
from datetime import datetime
from typing import Any

import numpy as np
import joblib

logger = logging.getLogger(__name__)

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

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
# MODEL LOADER — ONNX Runtime (no libgomp needed)
# ─────────────────────────────────────────────
_SESSIONS: dict[str, Any] = {}
_ENCODER:  dict[str, Any] = {}


def _load_models() -> None:
    if _SESSIONS:
        return

    import onnxruntime as ort

    model_names = [
        "clearance_model", "impact_model", "barricade_model",
        "closure_model", "manpower_model", "diversion_model",
    ]
    for name in model_names:
        path = os.path.join(MODELS_DIR, f"{name}.onnx")
        if not os.path.exists(path):
            raise FileNotFoundError(
                f"ONNX model not found: {path}\n"
                "Run  python train_ml_engine.py  to retrain."
            )
        _SESSIONS[name] = ort.InferenceSession(
            path, providers=["CPUExecutionProvider"]
        )

    enc_path = os.path.join(MODELS_DIR, "feature_encoder.pkl")
    if not os.path.exists(enc_path):
        raise FileNotFoundError(f"Encoder not found: {enc_path}")
    _ENCODER.update(joblib.load(enc_path))

    logger.info("ML engine: 6 ONNX models loaded from %s", MODELS_DIR)


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
    classes = _ENCODER.get("label_encoders", {}).get(col)
    if classes is None:
        return 0
    val = str(val).strip()
    try:
        return classes.index(val)
    except ValueError:
        return 0


def _build_feature_row(event: dict) -> np.ndarray:
    now        = datetime.now()
    hour       = int(event.get("hour", now.hour))
    day        = int(event.get("day",  now.weekday()))

    event_cause = str(event.get("event_cause",   "others")).strip()
    event_type  = str(event.get("event_type",    "unplanned")).strip()
    priority    = str(event.get("priority",      "High")).strip()
    veh_type    = str(event.get("veh_type",      "others")).strip()
    zone        = str(event.get("zone",          "unknown")).strip()
    corridor    = str(event.get("corridor",      "Non-corridor")).strip()
    junction    = str(event.get("junction",      "unknown")).strip()
    police_stn  = str(event.get("police_station","unknown")).strip()
    description = str(event.get("description",   "")).strip()
    lat         = float(event.get("latitude",    12.9716))
    lon         = float(event.get("longitude",   77.5946))

    category = CAUSE_CATEGORY.get(event_cause, "others")

    row: dict[str, float] = {
        "event_type_enc":       _encode("event_type",     event_type),
        "event_cause_enc":      _encode("event_cause",    event_cause),
        "event_category_enc":   _encode("event_category", category),
        "priority_enc":         _encode("priority",       priority),
        "priority_high":        1 if priority.lower() == "high" else 0,
        "veh_type_enc":         _encode("veh_type",       veh_type),
        "veh_is_heavy":         1 if veh_type in HEAVY_VEH else 0,
        "latitude":             lat,
        "longitude":            lon,
        "zone_enc":             _encode("zone",           zone),
        "corridor_enc":         _encode("corridor",       corridor),
        "corridor_is_major":    0 if corridor.lower() == "non-corridor" else 1,
        "junction_enc":         _encode("junction",       junction),
        "police_station_enc":   _encode("police_station", police_stn),
        "hour":                 hour,
        "dayofweek":            day,
        "is_weekend":           1 if day >= 5 else 0,
        "is_morning_peak":      1 if 7 <= hour <= 10 else 0,
        "is_evening_peak":      1 if 17 <= hour <= 21 else 0,
        "is_night":             1 if hour >= 22 or hour <= 5 else 0,
        "description_severity": _description_severity(description),
    }

    feature_cols = _ENCODER.get("feature_cols", list(row.keys()))
    return np.array([[row[c] for c in feature_cols]], dtype=np.float32)


# ─────────────────────────────────────────────
# POST-PROCESSING HELPERS
# ─────────────────────────────────────────────
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
    floor = _CLEARANCE_FLOOR.get(event_cause, 20)
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
    base = impact * 0.7
    if corridor_is_major:
        base = min(100, base * 1.2)
    return round(min(100.0, max(0.0, base)), 1)


def _run(name: str, X: np.ndarray) -> float:
    result = _SESSIONS[name].run(None, {"input": X})
    return float(result[0].flatten()[0])


# ─────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────
def predict_event_response(event_json: dict) -> dict:
    _load_models()

    X = _build_feature_row(event_json)

    clearance = _run("clearance_model", X)
    impact    = _run("impact_model",    X)
    barricade = _run("barricade_model", X)
    closure   = bool(round(_run("closure_model",  X)))
    manpower  = _run("manpower_model",  X)
    diversion = bool(round(_run("diversion_model", X)))

    event_cause = str(event_json.get("event_cause", "others"))
    clearance = _apply_clearance_floor(clearance, event_cause, impact)
    clearance = round(max(1.0, clearance), 0)
    impact    = round(min(100.0, max(0.0, impact)), 1)
    barricade = round(min(100.0, max(0.0, barricade)), 1)
    manpower  = round(max(5.0, manpower), 0)

    if impact >= 88 and barricade >= 85 and not closure:
        closure = True
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


if __name__ == "__main__":
    import json

    cases = [
        {"event_cause": "vehicle_breakdown", "priority": "Low",  "corridor": "Non-corridor", "zone": "Central Zone 1", "latitude": 12.9716, "longitude": 77.5946, "hour": 14, "description": "Car stalled. Minor blockage."},
        {"event_cause": "public_event",      "priority": "High", "corridor": "CBD 2",        "zone": "Central Zone 1", "latitude": 12.9792, "longitude": 77.5913, "hour": 18, "description": "Large crowd for IPL match."},
        {"event_cause": "accident",          "priority": "High", "veh_type": "heavy_vehicle", "corridor": "Hosur Road", "zone": "South Zone 2", "latitude": 12.9176, "longitude": 77.6244, "hour": 8, "description": "Truck overturned. Road blocked. Major accident."},
    ]
    for case in cases:
        result = predict_event_response(case)
        print(json.dumps(result, indent=2))
