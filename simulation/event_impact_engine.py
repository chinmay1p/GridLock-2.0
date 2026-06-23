"""
Traffic impact timeline engine for Traffic Twin Bengaluru.

Translates ML predictions into a 4-step simulation timeline.
Road-level congestion is computed on the frontend using the event's coordinates
and the congestion_multiplier + impact_radius_km returned here.
"""

# ── Timeline curves ───────────────────────────────────────────────────────────
# (time_fraction_of_clearance, congestion_multiplier, label_base)
# PUBLIC_EVENT: builds before event, peaks at event time, fades after close
# INCIDENT:     instant hit, active response phase, gradual clear

_CURVES = {
    "PUBLIC_EVENT": [
        (0.00, 0.14, "Pre-Event"),
        (0.20, 0.70, "Event Start"),
        (0.55, 1.00, "Peak Impact"),
        (1.00, 0.15, "Recovery"),
    ],
    "INCIDENT": [
        (0.00, 0.10, "Baseline"),
        (0.06, 1.00, "Incident Active"),
        (0.40, 0.52, "Response Underway"),
        (1.00, 0.12, "Cleared"),
    ],
}

_SEVERITY_RADIUS_KM = {
    "LOW":      1.5,
    "MEDIUM":   3.0,
    "HIGH":     5.0,
    "CRITICAL": 7.5,
}

_BASELINE_CONGESTION_PCT = 22.0
_BASELINE_SPEED_KMH      = 36.0


def build_timeline(event: dict, ml_prediction: dict) -> dict:
    """
    Build a 4-step simulation timeline from a DB event and ML predictions.

    Returns dict with: timeline, suggestions, tactical_plan, impact_radius_km.
    event and ml_prediction are merged in by the caller.
    """
    category      = event.get("event_category", "INCIDENT")
    clearance_min = max(5, int(ml_prediction.get("clearance_time", 60)))
    impact_score  = float(ml_prediction.get("impact_score", 50))
    severity      = ml_prediction.get("severity_level", "MEDIUM")

    curve     = _CURVES.get(category, _CURVES["INCIDENT"])
    radius_km = _SEVERITY_RADIUS_KM.get(severity, 3.0)

    timeline = []
    for i, (time_frac, cong_mult, label_base) in enumerate(curve):
        minutes   = int(time_frac * clearance_min)
        avg_cong  = _avg_congestion(impact_score, cong_mult, severity)
        avg_speed = max(4.0, _BASELINE_SPEED_KMH * (1.0 - (avg_cong / 100.0) * 0.88))
        critical  = _critical_road_count(impact_score, cong_mult)
        label     = label_base if minutes == 0 else f"{label_base} (T+{minutes} min)"

        timeline.append({
            "step":                  i,
            "label":                 label,
            "minutes":               minutes,
            "congestion_multiplier": round(cong_mult, 3),
            "avg_congestion":        round(avg_cong, 1),
            "avg_speed":             round(avg_speed, 1),
            "critical_roads":        critical,
        })

    try:
        from simulation.tactical_planner import generate_tactical_plan
        tactical_plan = generate_tactical_plan(event, ml_prediction)
    except Exception:
        tactical_plan = None

    return {
        "impact_radius_km": radius_km,
        "timeline":         timeline,
        "suggestions":      _build_suggestions(ml_prediction),
        "tactical_plan":    tactical_plan,
    }


def _avg_congestion(impact_score: float, cong_mult: float, severity: str) -> float:
    """Compute city-average congestion percent at a given timeline step."""
    spread = {"LOW": 0.06, "MEDIUM": 0.14, "HIGH": 0.24, "CRITICAL": 0.36}.get(severity, 0.14)
    delta  = (impact_score / 100.0) * cong_mult * spread * 100.0
    return min(94.0, _BASELINE_CONGESTION_PCT + delta)


def _critical_road_count(impact_score: float, cong_mult: float) -> int:
    return max(0, int(impact_score / 100.0 * cong_mult * 20))


def _build_suggestions(ml: dict) -> list:
    """Build ordered list of suggested response actions from ML predictions."""
    impact    = float(ml.get("impact_score", 50))
    manpower  = int(ml.get("manpower_required", 10))
    barricade = float(ml.get("barricade_percentage", 0))
    closure   = bool(ml.get("closure_required", False))
    diversion = bool(ml.get("diversion_required", False))
    clearance = int(ml.get("clearance_time", 60))
    with_plan = int(clearance * 0.65)

    suggestions = []

    suggestions.append({
        "type":     "manpower",
        "title":    "Police Deployment",
        "value":    f"{manpower} officers",
        "detail":   (
            f"Deploy {manpower} officers at the event site and on all primary "
            f"approach corridors to manage vehicle flow."
        ),
        "priority": "HIGH" if (manpower >= 25 or impact >= 70) else "MEDIUM",
    })

    if barricade > 0:
        suggestions.append({
            "type":     "barricade",
            "title":    "Traffic Channelization",
            "value":    f"{barricade:.0f}% barricading",
            "detail":   (
                f"Establish barricade coverage on {barricade:.0f}% of the event "
                f"perimeter to channel vehicle movement away from congested nodes."
            ),
            "priority": "HIGH" if barricade >= 60 else "MEDIUM",
        })

    if closure:
        suggestions.append({
            "type":     "closure",
            "title":    "Road Closure",
            "value":    "Mandatory",
            "detail":   (
                "Close primary approach road and activate full diversion. "
                "Redirect all inbound traffic via alternate arterial corridors."
            ),
            "priority": "HIGH",
        })

    if diversion:
        suggestions.append({
            "type":     "diversion",
            "title":    "Traffic Diversion",
            "value":    "Activate",
            "detail":   (
                "Redirect inbound traffic via ring roads and arterial bypasses. "
                "Coordinate signal timings at key junctions with the control room."
            ),
            "priority": "HIGH" if closure else "MEDIUM",
        })

    suggestions.append({
        "type":     "info",
        "title":    "Estimated Recovery",
        "value":    f"{with_plan} min with plan",
        "detail":   (
            f"Implementing this response plan reduces estimated clearance from "
            f"{clearance} min to approximately {with_plan} min."
        ),
        "priority": "INFO",
    })

    return suggestions
