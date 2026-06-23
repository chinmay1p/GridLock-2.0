"""
Tactical Response Planner — Traffic Twin Bengaluru
===================================================
Converts ML predictions into location-specific operational action plans.

  generate_tactical_plan(event, ml_prediction) -> dict

Output structure:
  manpower  : total + per-junction deployment list
  barricades: intensity % + specific road points
  closures  : required flag + road segments with duration
  diversions: required flag + alternate route descriptions
"""
from __future__ import annotations
import math
from datetime import datetime


# ── City road-graph nodes ─────────────────────────────────────────────────────
# type: "junction" | "gate" | "area" | "interchange"
# importance: 1 (local) … 5 (arterial / NH)

CITY_NODES: list[dict] = [
    # Central / CBD ─────────────────────────────────────────────────────────
    {"name": "M. Chinnaswamy Stadium — Main Gate",  "lat": 12.9788, "lng": 77.5996, "type": "gate",       "importance": 4, "zone": "CBD"},
    {"name": "M. Chinnaswamy Stadium — North Gate", "lat": 12.9800, "lng": 77.5990, "type": "gate",       "importance": 3, "zone": "CBD"},
    {"name": "MG Road Junction",                    "lat": 12.9750, "lng": 77.6095, "type": "junction",   "importance": 5, "zone": "CBD"},
    {"name": "Brigade Road Junction",               "lat": 12.9720, "lng": 77.6070, "type": "junction",   "importance": 4, "zone": "CBD"},
    {"name": "Cubbon Road — Kasturba Jn.",          "lat": 12.9763, "lng": 77.5929, "type": "junction",   "importance": 4, "zone": "CBD"},
    {"name": "Residency Road Junction",             "lat": 12.9728, "lng": 77.6041, "type": "junction",   "importance": 4, "zone": "CBD"},
    {"name": "Richmond Circle",                     "lat": 12.9623, "lng": 77.5980, "type": "junction",   "importance": 4, "zone": "CBD"},
    {"name": "Trinity Circle",                      "lat": 12.9748, "lng": 77.6091, "type": "junction",   "importance": 4, "zone": "CBD"},
    {"name": "Museum Road Junction",                "lat": 12.9758, "lng": 77.6048, "type": "junction",   "importance": 3, "zone": "CBD"},
    {"name": "Lavelle Road Junction",               "lat": 12.9695, "lng": 77.5993, "type": "junction",   "importance": 3, "zone": "CBD"},
    {"name": "St. Mark's Road Junction",            "lat": 12.9700, "lng": 77.6012, "type": "junction",   "importance": 3, "zone": "CBD"},
    {"name": "Vidhana Soudha Gate",                 "lat": 12.9795, "lng": 77.5908, "type": "gate",       "importance": 3, "zone": "CBD"},
    # KR Circle / Shivajinagar ──────────────────────────────────────────────
    {"name": "K.R. Circle",                         "lat": 12.9764, "lng": 77.5770, "type": "junction",   "importance": 5, "zone": "CBD"},
    {"name": "Shivajinagar Bus Stand",              "lat": 12.9826, "lng": 77.5926, "type": "area",       "importance": 3, "zone": "CBD"},
    {"name": "Palace Road Junction",                "lat": 12.9903, "lng": 77.5821, "type": "junction",   "importance": 4, "zone": "CBD"},
    {"name": "Queen's Road — Cubbon Park Gate",     "lat": 12.9775, "lng": 77.5917, "type": "gate",       "importance": 3, "zone": "CBD"},
    # West / Majestic ───────────────────────────────────────────────────────
    {"name": "Kempegowda Bus Terminal",             "lat": 12.9769, "lng": 77.5713, "type": "area",       "importance": 5, "zone": "West"},
    {"name": "Chord Road Junction",                 "lat": 12.9845, "lng": 77.5526, "type": "junction",   "importance": 3, "zone": "West"},
    {"name": "Rajajinagar 1st Block",               "lat": 12.9919, "lng": 77.5547, "type": "junction",   "importance": 3, "zone": "West"},
    {"name": "Freedom Park — Main Entrance",        "lat": 12.9762, "lng": 77.5697, "type": "gate",       "importance": 3, "zone": "West"},
    {"name": "Seshadri Road Junction",              "lat": 12.9778, "lng": 77.5729, "type": "junction",   "importance": 4, "zone": "West"},
    {"name": "Mysore Road — Sirsi Circle",          "lat": 12.9561, "lng": 77.5272, "type": "junction",   "importance": 4, "zone": "West"},
    # North ─────────────────────────────────────────────────────────────────
    {"name": "Palace Grounds — Main Gate",          "lat": 13.0067, "lng": 77.5843, "type": "gate",       "importance": 4, "zone": "North"},
    {"name": "Palace Grounds — South Gate",         "lat": 13.0049, "lng": 77.5860, "type": "gate",       "importance": 3, "zone": "North"},
    {"name": "Bellary Road — Palace Road Jn.",      "lat": 13.0020, "lng": 77.5840, "type": "junction",   "importance": 4, "zone": "North"},
    {"name": "Mekhri Circle",                       "lat": 13.0172, "lng": 77.5817, "type": "junction",   "importance": 5, "zone": "North"},
    {"name": "Hebbal Flyover Junction",             "lat": 13.0453, "lng": 77.5962, "type": "interchange", "importance": 5, "zone": "North"},
    {"name": "Yeshwanthpur Circle",                 "lat": 13.0240, "lng": 77.5481, "type": "junction",   "importance": 4, "zone": "North"},
    {"name": "Jalahalli Cross",                     "lat": 13.0354, "lng": 77.5378, "type": "junction",   "importance": 3, "zone": "North"},
    {"name": "Sadashivanagar — Sankey Road Jn.",    "lat": 13.0001, "lng": 77.5799, "type": "junction",   "importance": 3, "zone": "North"},
    # South ─────────────────────────────────────────────────────────────────
    {"name": "Silk Board Junction",                 "lat": 12.9177, "lng": 77.6238, "type": "junction",   "importance": 5, "zone": "South"},
    {"name": "Hosur Road — Agara Junction",         "lat": 12.9350, "lng": 77.6257, "type": "junction",   "importance": 4, "zone": "South"},
    {"name": "Electronic City Toll",                "lat": 12.8453, "lng": 77.6602, "type": "junction",   "importance": 4, "zone": "South"},
    {"name": "JP Nagar 6th Phase Junction",         "lat": 12.9063, "lng": 77.5857, "type": "junction",   "importance": 3, "zone": "South"},
    {"name": "Bannerghatta Road — Dairy Circle",    "lat": 12.9280, "lng": 77.5975, "type": "junction",   "importance": 4, "zone": "South"},
    {"name": "Jayanagar 4th T Block",               "lat": 12.9252, "lng": 77.5938, "type": "junction",   "importance": 3, "zone": "South"},
    {"name": "Kanakapura Road — Ring Road Jn.",     "lat": 12.8832, "lng": 77.5699, "type": "junction",   "importance": 3, "zone": "South"},
    {"name": "Hosur Road — Bommanahalli Jn.",       "lat": 12.8990, "lng": 77.6249, "type": "junction",   "importance": 3, "zone": "South"},
    {"name": "Koramangala 5th Block Jn.",           "lat": 12.9352, "lng": 77.6245, "type": "junction",   "importance": 3, "zone": "South"},
    {"name": "Basavanagudi — National College Jn.", "lat": 12.9428, "lng": 77.5741, "type": "junction",   "importance": 3, "zone": "South"},
    # East ──────────────────────────────────────────────────────────────────
    {"name": "Indiranagar 100 Feet Road — CMH Jn.","lat": 12.9784, "lng": 77.6408, "type": "junction",   "importance": 4, "zone": "East"},
    {"name": "Old Madras Road — HAL Junction",      "lat": 12.9912, "lng": 77.6602, "type": "junction",   "importance": 4, "zone": "East"},
    {"name": "Marathahalli Junction",               "lat": 12.9591, "lng": 77.6968, "type": "junction",   "importance": 5, "zone": "East"},
    {"name": "ORR — Marathahalli Interchange",      "lat": 12.9569, "lng": 77.7011, "type": "interchange", "importance": 5, "zone": "East"},
    {"name": "Sarjapur Road — ORR Junction",        "lat": 12.9072, "lng": 77.6835, "type": "junction",   "importance": 4, "zone": "East"},
    {"name": "Whitefield — ITPL Junction",          "lat": 12.9698, "lng": 77.7500, "type": "junction",   "importance": 4, "zone": "East"},
    {"name": "Nagavara Junction",                   "lat": 13.0432, "lng": 77.6256, "type": "junction",   "importance": 3, "zone": "East"},
    {"name": "HAL Old Airport Road",                "lat": 12.9590, "lng": 77.6478, "type": "junction",   "importance": 3, "zone": "East"},
    {"name": "Ulsoor Lake Road Junction",           "lat": 12.9818, "lng": 77.6147, "type": "junction",   "importance": 2, "zone": "East"},
]


# ── Diversion routes ──────────────────────────────────────────────────────────
# Keyed by zone; multiple routes per zone for variety based on event cause.

DIVERSION_ROUTES: list[dict] = [
    # CBD / Stadium area
    {
        "affected_road": "Cubbon Road",
        "via": ["MG Road", "Residency Road", "Richmond Circle"],
        "waypoints": [[12.9748, 77.6095], [12.9728, 77.6041], [12.9623, 77.5980]],
        "distance_added_km": 1.8,
        "reason": "Avoids stadium pedestrian zone; MG Road carries controlled flow",
        "zones": ["CBD"],
    },
    {
        "affected_road": "Brigade Road",
        "via": ["Residency Road", "St. Mark's Road", "Lavelle Road"],
        "waypoints": [[12.9728, 77.6041], [12.9700, 77.6012], [12.9695, 77.5993]],
        "distance_added_km": 1.2,
        "reason": "Parallel arterial — controlled signal timing available",
        "zones": ["CBD"],
    },
    {
        "affected_road": "MG Road (eastbound)",
        "via": ["Old Airport Road", "HAL Road", "100 Feet Road Indiranagar"],
        "waypoints": [[12.9748, 77.6095], [12.9590, 77.6478], [12.9784, 77.6408]],
        "distance_added_km": 3.5,
        "reason": "Bypasses CBD via east corridor during event congestion",
        "zones": ["CBD"],
    },
    {
        "affected_road": "Seshadri Road",
        "via": ["K.R. Circle", "Cubbon Road", "MG Road"],
        "waypoints": [[12.9764, 77.5770], [12.9763, 77.5929], [12.9748, 77.6095]],
        "distance_added_km": 2.1,
        "reason": "KR Circle controlled junction; lower vehicle density on Cubbon Road",
        "zones": ["CBD", "West"],
    },
    # Silk Board / South
    {
        "affected_road": "Hosur Road",
        "via": ["Sarjapur Road", "ORR", "Marathahalli"],
        "waypoints": [[12.9072, 77.6835], [12.9569, 77.7011], [12.9591, 77.6968]],
        "distance_added_km": 4.2,
        "reason": "ORR carries lower load; avoids Silk Board saturation",
        "zones": ["South"],
    },
    {
        "affected_road": "Bannerghatta Road",
        "via": ["Kanakapura Road", "JP Nagar 24th Main", "Ring Road"],
        "waypoints": [[12.8832, 77.5699], [12.9063, 77.5857], [12.9280, 77.5975]],
        "distance_added_km": 2.6,
        "reason": "Parallel corridor with adequate capacity during incidents",
        "zones": ["South"],
    },
    {
        "affected_road": "Koramangala approach",
        "via": ["Sarjapur Road", "BTM Layout", "Silk Board outer"],
        "waypoints": [[12.9072, 77.6835], [12.9166, 77.6101], [12.9177, 77.6238]],
        "distance_added_km": 2.8,
        "reason": "Sarjapur corridor bypass avoids Koramangala core",
        "zones": ["South"],
    },
    # ORR East / Marathahalli
    {
        "affected_road": "ORR near Marathahalli",
        "via": ["Sarjapur Road", "Bellandur Road", "HSR Layout"],
        "waypoints": [[12.9072, 77.6835], [12.9200, 77.6700], [12.9116, 77.6389]],
        "distance_added_km": 5.1,
        "reason": "Sarjapur corridor avoids ORR flood zone near underpass",
        "zones": ["East"],
    },
    {
        "affected_road": "Old Madras Road",
        "via": ["Indiranagar 100 Feet Road", "CMH Road", "Airport Road"],
        "waypoints": [[12.9784, 77.6408], [12.9800, 77.6480], [12.9590, 77.6478]],
        "distance_added_km": 2.0,
        "reason": "Secondary arterial with lower heavy-vehicle mix",
        "zones": ["East"],
    },
    {
        "affected_road": "100 Feet Road Indiranagar",
        "via": ["CMH Road", "Domlur Flyover", "Airport Road"],
        "waypoints": [[12.9800, 77.6480], [12.9680, 77.6490], [12.9590, 77.6478]],
        "distance_added_km": 1.6,
        "reason": "Parallel road; lower congestion during Indiranagar incidents",
        "zones": ["East"],
    },
    # North / Palace Grounds / Bellary Road
    {
        "affected_road": "Bellary Road",
        "via": ["Mekhri Circle", "Sankey Road", "Sadashivanagar"],
        "waypoints": [[13.0172, 77.5817], [13.0001, 77.5799], [12.9919, 77.5800]],
        "distance_added_km": 2.4,
        "reason": "Avoids Palace Grounds crowd; Sankey Road lighter load",
        "zones": ["North"],
    },
    {
        "affected_road": "Tumkur Road",
        "via": ["Yeshwanthpur Circle", "Chord Road", "Rajajinagar"],
        "waypoints": [[13.0240, 77.5481], [12.9845, 77.5526], [12.9919, 77.5547]],
        "distance_added_km": 1.9,
        "reason": "Chord road inner bypass during north corridor congestion",
        "zones": ["North", "West"],
    },
    # Generic fallback
    {
        "affected_road": "Primary approach road",
        "via": ["Outer Ring Road", "Alternate arterial", "Reconnect at nearest junction"],
        "waypoints": [[12.9569, 77.7011], [12.9350, 77.6500], [12.9300, 77.6000]],
        "distance_added_km": 3.0,
        "reason": "ORR default bypass for unspecified corridor events",
        "zones": ["ANY"],
    },
]


# ── Deployment rules by event cause ──────────────────────────────────────────
# weight: fraction of total officers; node_pref: preferred node type for this role

DEPLOYMENT_RULES: dict[str, list[dict]] = {
    "public_event": [
        {"role": "Entry / exit gate control",       "weight": 0.30, "node_pref": "gate"},
        {"role": "Crowd flow — approach roads",      "weight": 0.25, "node_pref": "junction"},
        {"role": "Parking area management",          "weight": 0.20, "node_pref": "area"},
        {"role": "Adjacent junction diversion",      "weight": 0.15, "node_pref": "junction"},
        {"role": "Mobile reserve",                   "weight": 0.10, "node_pref": "any"},
    ],
    "procession": [
        {"role": "Procession head management",       "weight": 0.30, "node_pref": "junction"},
        {"role": "Procession tail / dispersal",      "weight": 0.20, "node_pref": "junction"},
        {"role": "Cross-traffic blocking point",     "weight": 0.25, "node_pref": "junction"},
        {"role": "Crowd containment",                "weight": 0.15, "node_pref": "any"},
        {"role": "Mobile rapid response",            "weight": 0.10, "node_pref": "any"},
    ],
    "protest": [
        {"role": "Perimeter control",                "weight": 0.30, "node_pref": "junction"},
        {"role": "Entry restriction point",          "weight": 0.25, "node_pref": "gate"},
        {"role": "Traffic diversion control",        "weight": 0.25, "node_pref": "junction"},
        {"role": "Rapid response reserve",           "weight": 0.20, "node_pref": "any"},
    ],
    "accident": [
        {"role": "Accident scene management",        "weight": 0.30, "node_pref": "any"},
        {"role": "Upstream traffic block",           "weight": 0.25, "node_pref": "junction"},
        {"role": "Diversion point control",          "weight": 0.25, "node_pref": "junction"},
        {"role": "Downstream clearance assist",      "weight": 0.20, "node_pref": "junction"},
    ],
    "vehicle_breakdown": [
        {"role": "Scene protection",                 "weight": 0.40, "node_pref": "any"},
        {"role": "Lane management",                  "weight": 0.35, "node_pref": "junction"},
        {"role": "Advisory / flow control",          "weight": 0.25, "node_pref": "junction"},
    ],
    "water_logging": [
        {"role": "Flood zone entry restriction",     "weight": 0.35, "node_pref": "junction"},
        {"role": "Diversion management",             "weight": 0.35, "node_pref": "junction"},
        {"role": "Emergency response assist",        "weight": 0.20, "node_pref": "any"},
        {"role": "Recovery monitoring point",        "weight": 0.10, "node_pref": "junction"},
    ],
    "tree_fall": [
        {"role": "Scene protection",                 "weight": 0.40, "node_pref": "any"},
        {"role": "Traffic diversion point",          "weight": 0.35, "node_pref": "junction"},
        {"role": "Clearance team support",           "weight": 0.25, "node_pref": "any"},
    ],
    "construction": [
        {"role": "Construction zone control",        "weight": 0.45, "node_pref": "any"},
        {"role": "Approach lane management",         "weight": 0.30, "node_pref": "junction"},
        {"role": "Slow-moving traffic control",      "weight": 0.25, "node_pref": "junction"},
    ],
    "congestion": [
        {"role": "Signal override — key junction",   "weight": 0.40, "node_pref": "junction"},
        {"role": "Alternate route guidance",         "weight": 0.35, "node_pref": "junction"},
        {"role": "Bottleneck relief point",          "weight": 0.25, "node_pref": "junction"},
    ],
    "others": [
        {"role": "Scene assessment & control",       "weight": 0.50, "node_pref": "any"},
        {"role": "Traffic flow management",          "weight": 0.30, "node_pref": "junction"},
        {"role": "Reserve deployment",               "weight": 0.20, "node_pref": "any"},
    ],
}

# Closure context per cause
CLOSURE_CONTEXT: dict[str, str] = {
    "public_event":      "High pedestrian and vehicle density near venue",
    "procession":        "Procession route requires exclusive road access",
    "protest":           "Crowd safety requires road exclusion zone",
    "accident":          "Scene preservation and emergency vehicle access",
    "vehicle_breakdown": "Partial lane closure; carriageway remains passable",
    "water_logging":     "Flooded section — vehicle entry is hazardous",
    "tree_fall":         "Road blocked by fallen debris",
    "construction":      "Construction zone lane restriction",
    "congestion":        "Signal override — no full closure required",
    "others":            "Ground assessment required before closure decision",
}


# ── Haversine ─────────────────────────────────────────────────────────────────

def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


# ── Spatial query ─────────────────────────────────────────────────────────────

def _nearby_nodes(lat: float, lng: float, radius_km: float, max_n: int = 10) -> list[dict]:
    """Return up to max_n nodes within radius_km, sorted by distance."""
    results = []
    for node in CITY_NODES:
        d = _haversine(lat, lng, node["lat"], node["lng"])
        if d <= radius_km:
            results.append({**node, "_dist_km": round(d, 2)})
    results.sort(key=lambda x: x["_dist_km"])
    return results[:max_n]


def _zone_of(lat: float, lng: float) -> str:
    """Estimate the city zone for a coordinate by nearest node."""
    best, best_d = "CBD", float("inf")
    for node in CITY_NODES:
        d = _haversine(lat, lng, node["lat"], node["lng"])
        if d < best_d:
            best_d = d
            best = node["zone"]
    return best


# ── Manpower planner ─────────────────────────────────────────────────────────

def _plan_manpower(event: dict, ml: dict, nearby: list[dict]) -> dict:
    total       = max(1, int(ml.get("manpower_required", 10)))
    event_cause = str(event.get("event_cause", "others"))
    rules       = DEPLOYMENT_RULES.get(event_cause, DEPLOYMENT_RULES["others"])
    event_lat   = float(event.get("latitude",  12.9716))
    event_lng   = float(event.get("longitude", 77.5946))
    event_loc   = event.get("location_name") or "event site"

    # Build role → candidate nodes mapping
    deployment = []
    used_node_names: set[str] = set()
    remaining = total

    for i, rule in enumerate(rules):
        is_last = i == len(rules) - 1
        pref = rule["node_pref"]
        weight = rule["weight"]
        officers = max(1, round(total * weight)) if not is_last else max(1, remaining)

        # Pick best node matching preference (not yet used)
        node = None
        for n in nearby:
            if n["name"] in used_node_names:
                continue
            if pref == "any":
                node = n
                break
            if pref == "gate" and n["type"] in ("gate",):
                node = n
                break
            if pref == "area" and n["type"] in ("area",):
                node = n
                break
            if pref == "junction" and n["type"] in ("junction", "interchange"):
                node = n
                break

        # Fall back to any unused nearby node, then use event coords directly
        if node is None:
            for n in nearby:
                if n["name"] not in used_node_names:
                    node = n
                    break

        if node:
            used_node_names.add(node["name"])
            deployment.append({
                "location":    node["name"],
                "officers":    officers,
                "role":        rule["role"],
                "lat":         node["lat"],
                "lng":         node["lng"],
                "distance_km": node["_dist_km"],
            })
        else:
            # No nearby node left — deploy at event location
            deployment.append({
                "location":    event_loc,
                "officers":    officers,
                "role":        rule["role"],
                "lat":         event_lat,
                "lng":         event_lng,
                "distance_km": 0.0,
            })

        remaining -= officers

    # Trim to match exact total (rounding can drift ±1)
    actual = sum(d["officers"] for d in deployment)
    if actual != total and deployment:
        deployment[-1]["officers"] = max(1, deployment[-1]["officers"] + (total - actual))

    return {"total": total, "deployment": deployment}


# ── Barricade planner ─────────────────────────────────────────────────────────

def _plan_barricades(event: dict, ml: dict, nearby: list[dict]) -> dict:
    intensity = round(float(ml.get("barricade_percentage", 0)), 1)
    event_cause = str(event.get("event_cause", "others"))
    event_loc   = event.get("location_name") or "event site"
    event_lat   = float(event.get("latitude",  12.9716))
    event_lng   = float(event.get("longitude", 77.5946))

    if intensity <= 0:
        return {"intensity_pct": 0, "points": []}

    # Select 2-4 closest nodes as barricade candidate points
    candidates = [n for n in nearby[:6] if n["type"] in ("junction", "gate", "interchange", "area")]
    if not candidates:
        candidates = nearby[:4]

    # Assign decreasing control % based on distance
    points = []
    # First candidate (closest) gets the highest control — near the scene
    control_levels = [min(100, round(intensity * f)) for f in [1.15, 0.90, 0.70, 0.55]]

    # Add scene-level barricade first
    access_reason = {
        "public_event":      "Primary crowd access / exit point",
        "procession":        "Procession route start / end",
        "protest":           "Gathering zone perimeter",
        "accident":          "Scene perimeter — emergency access only",
        "vehicle_breakdown": "Lane restriction zone",
        "water_logging":     "Flood zone entry point",
        "tree_fall":         "Debris zone boundary",
        "construction":      "Construction zone boundary",
        "congestion":        "Congestion bottleneck point",
        "others":            "Incident perimeter",
    }.get(event_cause, "Incident perimeter")

    points.append({
        "location":    event_loc,
        "road":        event_loc.split("—")[0].strip() if "—" in event_loc else event_loc,
        "control_pct": min(100, round(intensity * 1.15)),
        "reason":      access_reason,
        "lat":         event_lat,
        "lng":         event_lng,
    })

    for idx, node in enumerate(candidates[:3]):
        reason = {
            "gate":        "Venue entry / exit — crowd channelization",
            "junction":    "Approach junction — redirect inbound traffic",
            "interchange": "High-flow interchange — early diversion needed",
            "area":        "Parking / staging area — flow management",
        }.get(node["type"], "Traffic control point")
        points.append({
            "location":    node["name"],
            "road":        node["name"].split("—")[0].strip(),
            "control_pct": max(20, min(100, control_levels[idx + 1])),
            "reason":      reason,
            "lat":         node["lat"],
            "lng":         node["lng"],
        })

    return {"intensity_pct": intensity, "points": points[:4]}


# ── Closure planner ───────────────────────────────────────────────────────────

def _plan_closures(event: dict, ml: dict, nearby: list[dict]) -> dict:
    required    = bool(ml.get("closure_required", False))
    event_cause = str(event.get("event_cause", "others"))
    event_loc   = event.get("location_name") or "event site"
    event_lat   = float(event.get("latitude",  12.9716))
    event_lng   = float(event.get("longitude", 77.5946))

    if not required:
        return {"required": False, "segments": []}

    reason = CLOSURE_CONTEXT.get(event_cause, "Operational safety requirement")

    # Build duration string from event times
    start_str = str(event.get("start_datetime", "") or "")
    end_str   = str(event.get("end_datetime",   "") or "")
    duration  = _fmt_duration(start_str, end_str)

    # Determine closest junction as the "from" boundary of the closure
    junctions = [n for n in nearby if n["type"] in ("junction", "interchange")]
    gates     = [n for n in nearby if n["type"] == "gate"]

    road_label = _infer_road_label(event_loc, event_cause)

    segments = []
    if junctions:
        from_jn = junctions[0]["name"]
        to_jn   = junctions[1]["name"] if len(junctions) > 1 else gates[0]["name"] if gates else event_loc
        segments.append({
            "road":          road_label,
            "from_junction": from_jn,
            "to_junction":   to_jn,
            "reason":        reason,
            "duration":      duration,
            "lat":           event_lat,
            "lng":           event_lng,
        })
    else:
        segments.append({
            "road":          road_label,
            "from_junction": event_loc,
            "to_junction":   "Adjacent junction",
            "reason":        reason,
            "duration":      duration,
            "lat":           event_lat,
            "lng":           event_lng,
        })

    return {"required": True, "segments": segments}


# ── Diversion planner ─────────────────────────────────────────────────────────

def _plan_diversions(event: dict, ml: dict, nearby: list[dict]) -> dict:
    required    = bool(ml.get("diversion_required", False))
    event_cause = str(event.get("event_cause", "others"))
    event_lat   = float(event.get("latitude",  12.9716))
    event_lng   = float(event.get("longitude", 77.5946))

    if not required:
        return {"required": False, "routes": []}

    zone = _zone_of(event_lat, event_lng)

    # Find matching routes by zone (prefer zone-specific, fall back to ANY)
    zone_routes = [r for r in DIVERSION_ROUTES if zone in r["zones"]]
    if not zone_routes:
        zone_routes = [r for r in DIVERSION_ROUTES if "ANY" in r["zones"]]

    # Pick 1-2 routes; prefer the one whose affected_road is closest to event
    # (simple heuristic: pick the first 2 from zone matches)
    selected = zone_routes[:2]

    # For flooding or water logging, prefer routes that avoid low-lying corridors
    if event_cause == "water_logging" and len(selected) > 1:
        selected = sorted(selected, key=lambda r: r["distance_added_km"])

    routes = []
    for r in selected:
        routes.append({
            "affected_road":     r["affected_road"],
            "via":               r["via"],
            "via_coords":        r.get("waypoints", []),
            "reason":            r["reason"],
            "distance_added_km": r["distance_added_km"],
        })

    return {"required": True, "routes": routes}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt_duration(start: str, end: str) -> str:
    def _hhmm(s: str) -> str:
        s = s.strip()
        if not s:
            return ""
        try:
            d = datetime.fromisoformat(s)
            return f"{d.hour:02d}:{d.minute:02d}"
        except Exception:
            if len(s) >= 16:
                return s[11:16]
            return ""

    s = _hhmm(start)
    e = _hhmm(end)
    if s and e:
        return f"{s}–{e}"
    if s:
        return f"From {s} until cleared"
    return "Duration under assessment"


def _infer_road_label(location_name: str, event_cause: str) -> str:
    """Derive a short road label from the event's location name."""
    loc = location_name or "Event location"
    # Strip junction qualifiers to get the road/area name
    for sep in (" — ", " - ", " near ", " at ", " junction", " Junction"):
        if sep.lower() in loc.lower():
            loc = loc.split(sep)[0].strip()
            break
    cause_suffix = {
        "public_event":      "approach road",
        "procession":        "procession route",
        "protest":           "gathering area road",
        "accident":          "accident site road",
        "vehicle_breakdown": "breakdown lane",
        "water_logging":     "flooded road section",
        "tree_fall":         "road blockage section",
        "construction":      "construction zone road",
    }.get(event_cause, "road segment")
    return f"{loc} — {cause_suffix}"


# ── Public API ────────────────────────────────────────────────────────────────

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


def _resolve_event_cause(event: dict) -> str:
    """Derive event_cause from event dict (type mapping, fallback to category)."""
    cause = event.get("event_cause")
    if cause:
        return str(cause)
    event_type = str(event.get("event_type") or "")
    cause = _TYPE_TO_CAUSE.get(event_type)
    if cause:
        return cause
    category = str(event.get("event_category") or "INCIDENT").upper()
    return "public_event" if category == "PUBLIC_EVENT" else "others"


def generate_tactical_plan(event: dict, ml_prediction: dict) -> dict:
    """
    Generate a location-specific tactical response plan.

    Parameters
    ----------
    event          : DB event dict (needs latitude, longitude, event_type, location_name, etc.)
    ml_prediction  : output from predict_event_response()

    Returns
    -------
    dict with: manpower, barricades, closures, diversions
    """
    lat  = float(event.get("latitude",  12.9716))
    lng  = float(event.get("longitude", 77.5946))
    sev  = ml_prediction.get("severity_level", "MEDIUM")

    # Resolve event_cause without circular import
    event_cause = _resolve_event_cause(event)
    event = {**event, "event_cause": event_cause}

    # Impact radius determines search zone
    radius_km = {"LOW": 2.0, "MEDIUM": 4.0, "HIGH": 6.0, "CRITICAL": 8.0}.get(sev, 4.0)
    nearby = _nearby_nodes(lat, lng, radius_km, max_n=10)

    return {
        "manpower":   _plan_manpower(event,   ml_prediction, nearby),
        "barricades": _plan_barricades(event, ml_prediction, nearby),
        "closures":   _plan_closures(event,   ml_prediction, nearby),
        "diversions": _plan_diversions(event, ml_prediction, nearby),
    }
