"""
Multi-event city-level simulation engine for Traffic Twin Bengaluru.

Combines individual event ML predictions using saturation-based congestion combination:
  new_density = 1 - ((1 - current) * (1 - delta1) * (1 - delta2) * ...)
"""
from __future__ import annotations
import math
from datetime import datetime, timedelta

_BASELINE_CONGESTION = 0.22   # 22% base city density (0–1 scale)
_BASELINE_SPEED_KMH  = 36.0

_SEVERITY_SPREAD: dict[str, float] = {
    "LOW":      0.06,
    "MEDIUM":   0.14,
    "HIGH":     0.24,
    "CRITICAL": 0.36,
}

_SEVERITY_RADIUS_KM: dict[str, float] = {
    "LOW":      1.5,
    "MEDIUM":   3.0,
    "HIGH":     5.0,
    "CRITICAL": 7.5,
}

_SEVERITY_ORDER   = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
_SEVERITY_UPGRADE = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]

_CURVES: dict[str, list[tuple[float, float]]] = {
    "PUBLIC_EVENT": [(0.00, 0.14), (0.20, 0.70), (0.55, 1.00), (1.00, 0.15)],
    "INCIDENT":     [(0.00, 0.10), (0.06, 1.00), (0.40, 0.52), (1.00, 0.12)],
}

OVERLAP_DISTANCE_KM = 2.5
CITY_PHASE_LABELS   = ["Current", "+30 min", "+1 hr", "Recovery"]


def run_city_simulation(event_ml_pairs: list[dict], reference_dt: str | None = None) -> dict:
    """
    Combine multiple events into a city-level simulation.

    Parameters
    ----------
    event_ml_pairs : list[{"event": dict, "ml": dict, "timeline": dict}]
    reference_dt   : ISO datetime string for T=0 (earliest event start or now)

    Returns
    -------
    dict with city_status, event_impacts, city_timeline, response_plan
    """
    if not event_ml_pairs:
        return _empty_result()

    pairs         = _detect_overlaps(event_ml_pairs)
    event_impacts = sorted(_build_event_impacts(pairs), key=lambda x: x["impact_score"], reverse=True)
    max_clearance = max(max(1, p["ml"]["clearance_time"]) for p in pairs)
    city_timeline = _build_city_timeline(pairs, max_clearance, reference_dt)

    total_officers = int(sum(
        _adj_manpower(p["ml"]["manpower_required"], p.get("overlap_boost", 1.0))
        for p in pairs
    ))
    current = city_timeline[0]

    return {
        "city_status": {
            "active_event_count": len(pairs),
            "avg_congestion_pct": round(current["avg_congestion"], 1),
            "critical_road_count": current["critical_roads"],
            "officers_required":   total_officers,
            "recovery_est_min":    int(max_clearance),
        },
        "event_impacts": event_impacts,
        "city_timeline": city_timeline,
        "response_plan": _build_response_plan(event_impacts),
    }


def _detect_overlaps(pairs: list[dict]) -> list[dict]:
    out = []
    for i, pa in enumerate(pairs):
        overlapping = [
            pb["event"].get("id")
            for j, pb in enumerate(pairs)
            if i != j and _haversine_km(
                pa["event"].get("latitude",  12.9716), pa["event"].get("longitude", 77.5946),
                pb["event"].get("latitude",  12.9716), pb["event"].get("longitude", 77.5946),
            ) <= OVERLAP_DISTANCE_KM
        ]
        has_overlap = bool(overlapping)
        out.append({
            **pa,
            "overlap_detected":   has_overlap,
            "overlap_event_ids":  overlapping,
            "overlap_boost":      1.5 if has_overlap else 1.0,
            "effective_severity": _upgrade_severity(pa["ml"]["severity_level"]) if has_overlap else pa["ml"]["severity_level"],
        })
    return out


def _build_event_impacts(pairs: list[dict]) -> list[dict]:
    from simulation.tactical_planner import generate_tactical_plan
    result = []
    for p in pairs:
        ev = p["event"]
        ml = p["ml"]
        # Adjust manpower for overlap before passing to tactical planner
        adj_manpower = int(_adj_manpower(ml["manpower_required"], p.get("overlap_boost", 1.0)))
        ml_adj = {**ml, "manpower_required": adj_manpower}
        try:
            tactical_plan = generate_tactical_plan(ev, ml_adj)
        except Exception:
            tactical_plan = None
        result.append({
            "event_id":             ev.get("id"),
            "event_name":           ev.get("event_name", "Unknown"),
            "event_type":           ev.get("event_type", ""),
            "event_category":       ev.get("event_category", "INCIDENT"),
            "location_name":        ev.get("location_name", ""),
            "latitude":             ev.get("latitude",  12.9716),
            "longitude":            ev.get("longitude", 77.5946),
            "impact_score":         ml["impact_score"],
            "severity_level":       p.get("effective_severity", ml["severity_level"]),
            "clearance_time":       ml["clearance_time"],
            "manpower_required":    adj_manpower,
            "barricade_percentage": ml["barricade_percentage"],
            "closure_required":     ml["closure_required"],
            "diversion_required":   ml["diversion_required"],
            "affected_area_score":  ml["affected_area_score"],
            "impact_radius_km":     _SEVERITY_RADIUS_KM.get(ml["severity_level"], 3.0),
            "overlap_detected":     p.get("overlap_detected", False),
            "overlap_event_ids":    p.get("overlap_event_ids", []),
            "tactical_plan":        tactical_plan,
        })
    return result


def _build_city_timeline(pairs: list[dict], max_clearance: int, reference_dt: str | None = None) -> list[dict]:
    # Parse reference time (T=0)
    ref = None
    if reference_dt:
        try:
            ref = datetime.fromisoformat(str(reference_dt).replace("Z", ""))
        except Exception:
            ref = None
    if ref is None:
        ref = datetime.now()

    # 30-minute intervals from 0 to max_clearance, always include exact endpoint
    interval = 30
    offsets  = list(range(0, max_clearance, interval))
    if not offsets or offsets[-1] < max_clearance:
        offsets.append(max_clearance)

    timeline = []
    for offset in offsets:
        ts       = ref + timedelta(minutes=offset)
        ts_label = f"{ts.hour:02d}:{ts.minute:02d}"

        density      = _BASELINE_CONGESTION
        critical_sum = 0.0
        for p in pairs:
            ml        = p["ml"]
            ev        = p["event"]
            curve     = _CURVES.get(ev.get("event_category", "INCIDENT"), _CURVES["INCIDENT"])
            clearance = max(5, ml["clearance_time"])
            mult      = _interp_mult(offset, clearance, curve)
            spread    = _SEVERITY_SPREAD.get(ml["severity_level"], 0.14)
            delta     = (ml["impact_score"] / 100.0) * mult * spread
            density   = 1.0 - (1.0 - density) * (1.0 - delta)
            critical_sum += (ml["impact_score"] / 100.0) * mult * 10.0

        density   = min(0.94, density)
        avg_cong  = round(density * 100.0, 1)
        avg_speed = round(max(4.0, _BASELINE_SPEED_KMH * (1.0 - density * 0.88)), 1)
        timeline.append({
            "phase":              len(timeline),
            "label":              ts_label,
            "timestamp":          ts_label,
            "minutes_from_start": offset,
            "minutes":            offset,
            "avg_congestion":     avg_cong,
            "avg_speed":          avg_speed,
            "critical_roads":     max(0, int(critical_sum)),
            "combined_density":   round(density, 3),
        })
    return timeline


def _build_response_plan(event_impacts: list[dict]) -> dict:
    dist = [
        {
            "event_id":             imp["event_id"],
            "event_name":           imp["event_name"],
            "location_name":        imp["location_name"] or imp["event_name"],
            "latitude":             imp["latitude"],
            "longitude":            imp["longitude"],
            "officers":             imp["manpower_required"],
            "severity":             imp["severity_level"],
            "closure":              imp["closure_required"],
            "diversion":            imp["diversion_required"],
            "barricade_percentage": round(imp.get("barricade_percentage", 0), 1),
            "clearance_time":       imp.get("clearance_time", 0),
        }
        for imp in event_impacts
        if imp["manpower_required"] > 0
    ]
    priority_zones = [
        {"rank": i + 1, "location_name": imp["location_name"] or imp["event_name"],
         "impact_score": imp["impact_score"], "event_type": imp["event_type"]}
        for i, imp in enumerate(event_impacts[:3])
    ]
    total      = sum(d["officers"] for d in dist)
    avg_impact = sum(i["impact_score"] for i in event_impacts) / max(1, len(event_impacts))
    avg_barricade = (
        sum(d["barricade_percentage"] for d in dist) / len(dist) if dist else 0.0
    )
    return {
        "total_officers":       total,
        "officer_distribution": dist,
        "priority_zones":       priority_zones,
        "improvement_pct":      min(45, int(avg_impact * 0.35)),
        "closures_required":    sum(1 for i in event_impacts if i["closure_required"]),
        "diversions_required":  sum(1 for i in event_impacts if i["diversion_required"]),
        "avg_barricade_pct":    round(avg_barricade, 1),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _interp_mult(time_offset: float, clearance_min: int, curve: list) -> float:
    frac = min(1.0, time_offset / clearance_min) if clearance_min > 0 else 1.0
    for i in range(len(curve) - 1):
        t0, m0 = curve[i]
        t1, m1 = curve[i + 1]
        if t0 <= frac <= t1:
            span = t1 - t0
            return m0 + ((frac - t0) / span) * (m1 - m0) if span else m1
    return curve[-1][1]


def _adj_manpower(base: int, boost: float) -> float:
    return base * boost


def _upgrade_severity(level: str) -> str:
    return _SEVERITY_UPGRADE[min(_SEVERITY_ORDER.get(level, 1) + 1, 3)]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R    = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a    = (math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def _empty_result() -> dict:
    return {
        "city_status": {
            "active_event_count": 0, "avg_congestion_pct": 22.0,
            "critical_road_count": 0, "officers_required": 0, "recovery_est_min": 0,
        },
        "event_impacts": [],
        "city_timeline": [],
        "response_plan": {
            "total_officers": 0, "officer_distribution": [], "priority_zones": [],
            "improvement_pct": 0, "closures_required": 0, "diversions_required": 0,
        },
    }
