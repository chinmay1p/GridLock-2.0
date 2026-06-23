"""
Citizen Dashboard API — Traffic Twin Bengaluru
==============================================
Citizen-facing endpoints that surface traffic intelligence for daily commuters.

Routes:
    GET  /api/citizen/city-summary  — aggregated city situation
    GET  /api/citizen/locations     — known locations for autocomplete
    POST /api/citizen/route         — smart route with dynamic disruption weights
"""

import heapq
import logging
import math
from datetime import datetime

from flask import Blueprint, jsonify, request

from database.db import get_connection, rows_to_list

logger = logging.getLogger(__name__)
citizen_bp = Blueprint("citizen", __name__)

# ─────────────────────────────────────────────
# CITY LOCATION GRAPH
# ─────────────────────────────────────────────

# Major Bengaluru locations with (lat, lng)
LOCATIONS: dict[str, tuple[float, float]] = {
    # Central
    "mg road":          (12.9756, 77.6097),
    "cubbon park":      (12.9763, 77.5929),
    "majestic":         (12.9775, 77.5713),
    "richmond circle":  (12.9604, 77.6067),
    "freedom park":     (12.9762, 77.5697),
    "ulsoor":           (12.9826, 77.6198),
    "cunningham road":  (12.9855, 77.5881),
    "shivajinagar":     (12.9854, 77.5990),
    "kkr circle":       (12.9924, 77.5671),
    # North
    "hebbal":           (13.0358, 77.5970),
    "yeshwanthpur":     (13.0247, 77.5483),
    "jalahalli":        (13.0504, 77.5230),
    "yelahanka":        (13.0998, 77.5964),
    "airport":          (13.1986, 77.7066),
    "sadashivanagar":   (13.0050, 77.5736),
    "rajajinagar":      (12.9908, 77.5545),
    "nagarbhavi":       (12.9585, 77.5070),
    "malleshwaram":     (13.0035, 77.5706),
    # East
    "indiranagar":      (12.9784, 77.6408),
    "domlur":           (12.9602, 77.6403),
    "old airport road": (12.9694, 77.6478),
    "cv raman nagar":   (12.9848, 77.6626),
    "kr puram":         (13.0067, 77.6943),
    "marathahalli":     (12.9566, 77.7011),
    "whitefield":       (12.9698, 77.7499),
    "varthur":          (12.9407, 77.7509),
    "hbr layout":       (13.0218, 77.6367),
    "banaswadi":        (13.0106, 77.6531),
    # South
    "silk board":       (12.9177, 77.6238),
    "koramangala":      (12.9352, 77.6245),
    "hsr layout":       (12.9081, 77.6476),
    "bommanahalli":     (12.9003, 77.6388),
    "electronic city":  (12.8399, 77.6770),
    "sarjapur road":    (12.9010, 77.6710),
    "btm layout":       (12.9165, 77.6101),
    "jayanagar":        (12.9299, 77.5832),
    "jp nagar":         (12.9063, 77.5846),
    "bannerghatta road":(12.8931, 77.5975),
    "bellandur":        (12.9256, 77.6762),
    "outer ring road":  (12.9569, 77.7011),
    "tumkur road":      (13.0612, 77.5121),
}

# Road network: (node_a, node_b, road_name, distance_km)
ROAD_NETWORK: list[tuple[str, str, str, float]] = [
    # ── Central corridors ──────────────────────────────────────────────────
    ("mg road",         "ulsoor",           "Ulsoor Road",              1.5),
    ("mg road",         "cubbon park",      "MG Road",                  1.2),
    ("mg road",         "richmond circle",  "Residency Road",           2.0),
    ("mg road",         "cunningham road",  "Brigade Road",             1.8),
    ("mg road",         "shivajinagar",     "Museum Road",              1.5),
    ("cubbon park",     "majestic",         "Cubbon Road",              2.0),
    ("cubbon park",     "shivajinagar",     "Cubbon Road Inner",        1.2),
    ("cubbon park",     "sadashivanagar",   "Palace Road",              3.5),
    ("cubbon park",     "freedom park",     "Lalbagh Road Inner",       1.8),
    ("majestic",        "kkr circle",       "Seshadri Road",            1.5),
    ("majestic",        "rajajinagar",      "Mysore Road",              3.0),
    ("majestic",        "yeshwanthpur",     "Tumkur Road South",        5.0),
    ("majestic",        "freedom park",     "Queens Road",              1.5),
    ("richmond circle", "freedom park",     "Lalbagh Road",             2.5),
    ("richmond circle", "koramangala",      "Hosur Road North",         5.0),
    ("richmond circle", "jayanagar",        "Ashoka Pillar Road",       4.0),
    ("cunningham road", "sadashivanagar",   "Palace Road Inner",        2.0),
    ("shivajinagar",    "ulsoor",           "Ulsoor Lake Road",         1.0),
    ("kkr circle",      "rajajinagar",      "Racecourse Road",          3.0),
    # ── North corridors ────────────────────────────────────────────────────
    ("sadashivanagar",  "hebbal",           "Bellary Road South",       4.0),
    ("sadashivanagar",  "malleshwaram",     "Sankey Road",              2.5),
    ("malleshwaram",    "yeshwanthpur",     "Margosa Road",             2.5),
    ("malleshwaram",    "rajajinagar",      "Chord Road West",          2.0),
    ("rajajinagar",     "yeshwanthpur",     "Chord Road",               3.5),
    ("rajajinagar",     "nagarbhavi",       "Magadi Road",              5.0),
    ("yeshwanthpur",    "jalahalli",        "Tumkur Road",              6.0),
    ("yeshwanthpur",    "hebbal",           "Outer Ring Road West",     8.0),
    ("yeshwanthpur",    "tumkur road",      "NH48 North",               4.0),
    ("jalahalli",       "tumkur road",      "Tumkur Road Outer",        5.0),
    ("hebbal",          "yelahanka",        "Bellary Road",            10.0),
    ("hebbal",          "kr puram",         "Outer Ring Road North",   12.0),
    ("hebbal",          "banaswadi",        "Outer Ring Road East",     6.0),
    ("yelahanka",       "airport",          "NH 44",                   20.0),
    # ── East corridors ─────────────────────────────────────────────────────
    ("ulsoor",          "indiranagar",      "CMH Road",                 2.5),
    ("indiranagar",     "old airport road", "Old Airport Road",         1.8),
    ("indiranagar",     "domlur",           "Domlur Flyover",           1.5),
    ("indiranagar",     "cv raman nagar",   "100 Feet Road",            3.2),
    ("indiranagar",     "hbr layout",       "Banaswadi Road",           4.0),
    ("domlur",          "old airport road", "Airport Road",             2.0),
    ("domlur",          "koramangala",      "Intermediate Ring Road",   3.5),
    ("old airport road","cv raman nagar",   "HRBR Layout Road",         3.0),
    ("cv raman nagar",  "kr puram",         "Old Madras Road",          5.5),
    ("cv raman nagar",  "banaswadi",        "Banaswadi Main Road",      3.0),
    ("banaswadi",       "kr puram",         "Old Madras Road Inner",    4.0),
    ("banaswadi",       "hbr layout",       "HRBR Main Road",           3.0),
    ("hbr layout",      "kr puram",         "KR Puram Road",            5.0),
    ("kr puram",        "whitefield",       "Whitefield Road",          8.5),
    ("kr puram",        "marathahalli",     "ORR East",                 7.0),
    ("marathahalli",    "whitefield",       "Whitefield Main Road",     5.5),
    ("marathahalli",    "outer ring road",  "ORR Marathahalli",         0.5),
    ("marathahalli",    "bellandur",        "Outer Ring Road",          4.5),
    ("whitefield",      "varthur",          "Varthur Main Road",        3.2),
    ("outer ring road", "silk board",       "Outer Ring Road",          8.2),
    ("outer ring road", "bellandur",        "ORR South",                4.0),
    # ── South corridors ────────────────────────────────────────────────────
    ("koramangala",     "silk board",       "Hosur Road",               3.5),
    ("koramangala",     "hsr layout",       "Sarjapur Road Inner",      3.0),
    ("koramangala",     "btm layout",       "80 Feet Road",             2.1),
    ("koramangala",     "indiranagar",      "Old Airport Road South",   4.5),
    ("hsr layout",      "silk board",       "Hosur Road Inner",         2.8),
    ("hsr layout",      "sarjapur road",    "Sarjapur Road",            4.0),
    ("hsr layout",      "bommanahalli",     "HSR Connector",            3.0),
    ("hsr layout",      "bellandur",        "ORR Bellandur",            3.5),
    ("silk board",      "bommanahalli",     "Hosur Road South",         2.5),
    ("silk board",      "btm layout",       "Hosur Road West",          3.2),
    ("bommanahalli",    "electronic city",  "Hosur Road",               6.0),
    ("bommanahalli",    "sarjapur road",    "Sarjapur Connector",       3.0),
    ("sarjapur road",   "electronic city",  "Sarjapur Road SE",         8.0),
    ("sarjapur road",   "bellandur",        "ORR Sarjapur",             2.5),
    ("bellandur",       "varthur",          "Varthur Road",             4.0),
    ("electronic city", "bannerghatta road","EC Road South",            7.0),
    ("btm layout",      "jayanagar",        "14th Cross",               2.5),
    ("btm layout",      "jp nagar",         "Kanakapura Road North",    3.0),
    ("jayanagar",       "jp nagar",         "JP Nagar Main Road",       3.5),
    ("jayanagar",       "richmond circle",  "Ashoka Pillar Road",       4.0),
    ("jp nagar",        "bannerghatta road","Bannerghatta Road",        4.0),
    ("nagarbhavi",      "jp nagar",         "Kanakapura Road",          8.0),
    ("nagarbhavi",      "rajajinagar",      "Magadi Road Inner",        6.0),
]


# ─────────────────────────────────────────────
# ROUTING HELPERS
# ─────────────────────────────────────────────

def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance in km between two lat/lng points."""
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (math.sin(d_lat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(d_lng / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _nearest_location(query: str) -> str | None:
    """Fuzzy match a user query to the nearest known location name."""
    q = query.lower().strip()
    if q in LOCATIONS:
        return q
    # Substring match
    for name in LOCATIONS:
        if q in name or name in q:
            return name
    # Word intersection
    q_words = set(q.split())
    best, best_score = None, 0
    for name in LOCATIONS:
        score = len(q_words & set(name.split()))
        if score > best_score:
            best, best_score = name, score
    return best if best_score > 0 else None


def _build_route_graph(
    incidents: list[dict],
    pub_events: list[dict],
    weather:    list[dict],
) -> tuple[dict, dict]:
    """
    Build adjacency graph with travel-time weights adjusted for disruptions.

    Returns:
        graph     — node → [(neighbor, cost)]
        edge_info — (min_node, max_node) → {road, distance_km, congestion, cost, alerts}
    """
    graph: dict[str, list] = {}
    edge_info: dict[tuple, dict] = {}

    for a, b, road_name, dist_km in ROAD_NETWORK:
        lat_a, lng_a = LOCATIONS.get(a, (12.97, 77.59))
        lat_b, lng_b = LOCATIONS.get(b, (12.97, 77.59))
        mid_lat = (lat_a + lat_b) / 2
        mid_lng = (lng_a + lng_b) / 2

        # ── Disruption factors ───────────────────────────────────────────
        incident_factor = 1.0
        event_factor    = 1.0
        weather_factor  = 1.0
        alerts: list[dict] = []

        for inc in incidents:
            if not inc.get("latitude") or not inc.get("longitude"):
                continue
            d = _haversine(mid_lat, mid_lng, float(inc["latitude"]), float(inc["longitude"]))
            if d > 2.5:
                continue
            sev = inc.get("severity", "MEDIUM")
            if sev == "HIGH":
                incident_factor = max(incident_factor, 1.9)
                alerts.append({"type": "INCIDENT", "severity": "HIGH",
                                "message": inc["event_name"],
                                "location": inc.get("location_name", "")})
            elif sev == "MEDIUM":
                incident_factor = max(incident_factor, 1.35)
                alerts.append({"type": "INCIDENT", "severity": "MEDIUM",
                                "message": inc["event_name"],
                                "location": inc.get("location_name", "")})

        for ev in pub_events:
            if not ev.get("latitude") or not ev.get("longitude"):
                continue
            d = _haversine(mid_lat, mid_lng, float(ev["latitude"]), float(ev["longitude"]))
            if d > 3.0:
                continue
            sev = ev.get("severity", "MEDIUM")
            factor = 1.6 if sev == "HIGH" else 1.25
            event_factor = max(event_factor, factor)
            alerts.append({"type": "EVENT", "severity": sev,
                           "message": ev["event_name"],
                           "location": ev.get("location_name", "")})

        for w in weather:
            if not w.get("latitude") or not w.get("longitude"):
                continue
            d = _haversine(mid_lat, mid_lng, float(w["latitude"]), float(w["longitude"]))
            if d > 5.0:
                continue
            wsev = w.get("severity", "HIGH")
            if wsev == "CRITICAL":
                weather_factor = max(weather_factor, 1.7)
                alerts.append({"type": "WEATHER", "severity": "CRITICAL",
                               "message": w["condition_name"],
                               "location": w.get("affected_area", "")})
            elif wsev == "HIGH":
                weather_factor = max(weather_factor, 1.35)
                alerts.append({"type": "WEATHER", "severity": "HIGH",
                               "message": w["condition_name"],
                               "location": w.get("affected_area", "")})

        # ── Travel time (minutes) with disruption penalty ─────────────────
        BASE_SPEED_KMPH = 32.0
        base_time = (dist_km / BASE_SPEED_KMPH) * 60.0
        total_factor = incident_factor * event_factor * weather_factor
        cost = base_time * total_factor

        congestion = "low"
        if total_factor >= 1.6:
            congestion = "high"
        elif total_factor >= 1.25:
            congestion = "medium"

        info = {
            "road":        road_name,
            "distance_km": dist_km,
            "congestion":  congestion,
            "cost":        cost,
            "alerts":      alerts,
        }

        key = (min(a, b), max(a, b))
        edge_info[key] = info

        for src, dst in [(a, b), (b, a)]:
            if src not in graph:
                graph[src] = []
            graph[src].append((dst, cost))

    return graph, edge_info


def _dijkstra(graph: dict, start: str, end: str) -> tuple[list[str], float]:
    """Dijkstra shortest path. Returns (path, cost) or ([], inf) if unreachable."""
    if start not in graph or end not in graph:
        return [], float("inf")

    heap = [(0.0, start, [start])]
    visited: set[str] = set()

    while heap:
        cost, node, path = heapq.heappop(heap)
        if node in visited:
            continue
        visited.add(node)
        if node == end:
            return path, cost
        for neighbor, edge_cost in graph.get(node, []):
            if neighbor not in visited:
                heapq.heappush(heap, (cost + edge_cost, neighbor, path + [neighbor]))

    return [], float("inf")


def _find_avoided(
    path: list[str],
    incidents: list[dict],
    pub_events: list[dict],
    weather: list[dict],
) -> list[dict]:
    """
    Return up to 4 notable road segments that were bypassed due to disruptions.
    A segment is "avoided" if it has a HIGH+ disruption and is NOT in the chosen path.
    """
    path_pairs = {(min(path[i], path[i+1]), max(path[i], path[i+1]))
                  for i in range(len(path) - 1)}
    avoided = []

    for a, b, road_name, dist_km in ROAD_NETWORK:
        key = (min(a, b), max(a, b))
        if key in path_pairs:
            continue

        lat_a, lng_a = LOCATIONS.get(a, (12.97, 77.59))
        lat_b, lng_b = LOCATIONS.get(b, (12.97, 77.59))
        mid_lat = (lat_a + lat_b) / 2
        mid_lng = (lng_a + lng_b) / 2
        reason = None

        for inc in incidents:
            if inc.get("latitude") and inc.get("severity") == "HIGH":
                d = _haversine(mid_lat, mid_lng, float(inc["latitude"]), float(inc["longitude"]))
                if d < 2.5:
                    reason = f"{inc['event_name']}"
                    break

        if not reason:
            for ev in pub_events:
                if ev.get("latitude") and ev.get("severity") == "HIGH":
                    d = _haversine(mid_lat, mid_lng, float(ev["latitude"]), float(ev["longitude"]))
                    if d < 3.0:
                        reason = f"{ev['event_name']} crowd congestion"
                        break

        if not reason:
            for w in weather:
                if w.get("latitude") and w.get("severity") in ("CRITICAL", "HIGH"):
                    d = _haversine(mid_lat, mid_lng, float(w["latitude"]), float(w["longitude"]))
                    if d < 5.0:
                        reason = w["condition_name"]
                        break

        if reason:
            avoided.append({"road": road_name, "reason": reason})
            if len(avoided) >= 4:
                break

    return avoided


# ─────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────

@citizen_bp.route("/api/citizen/city-summary", methods=["GET"])
def city_summary():
    """Aggregated city snapshot for the citizen dashboard hero & stat strip."""
    try:
        with get_connection() as conn:
            incidents  = rows_to_list(conn.execute(
                """SELECT * FROM events
                   WHERE event_category='INCIDENT' AND status IN ('ACTIVE','UPCOMING')
                   ORDER BY
                       CASE severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
                       created_at DESC"""
            ).fetchall())
            pub_events = rows_to_list(conn.execute(
                """SELECT * FROM events
                   WHERE event_category='PUBLIC_EVENT' AND status IN ('UPCOMING','ACTIVE')
                   ORDER BY start_datetime ASC"""
            ).fetchall())
            weather    = rows_to_list(conn.execute(
                """SELECT * FROM weather_alerts
                   WHERE status IN ('ACTIVE','MONITORING')
                   ORDER BY
                       CASE severity
                           WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                           WHEN 'MEDIUM'   THEN 2 ELSE 3 END"""
            ).fetchall())

        high_inc = sum(1 for i in incidents if i["severity"] == "HIGH")
        total_inc = len(incidents)
        critical_w = [w for w in weather if w["severity"] == "CRITICAL"]

        if critical_w or high_inc >= 3:
            level, label, pct = "HIGH",   "Heavy Disruptions",   80
        elif high_inc >= 1 or total_inc >= 3 or len(weather) >= 2:
            level, label, pct = "MEDIUM", "Moderate Disruptions", 50
        elif total_inc >= 1 or pub_events:
            level, label, pct = "LOW",    "Minor Disruptions",    25
        else:
            level, label, pct = "CLEAR",  "Traffic Normal",       10

        return jsonify({
            "congestion": {"level": level, "label": label, "percent": pct},
            "incidents":  {"total": total_inc,       "high": high_inc,        "list": incidents[:5]},
            "events":     {"total": len(pub_events), "next": pub_events[0] if pub_events else None, "list": pub_events[:4]},
            "weather":    {"total": len(weather),    "critical": len(critical_w), "alerts": weather},
            "updated_at": datetime.now().strftime("%H:%M"),
        })
    except Exception as exc:
        logger.error("city_summary error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500


@citizen_bp.route("/api/citizen/locations", methods=["GET"])
def get_locations():
    """Known Bengaluru locations for autocomplete (sorted alphabetically)."""
    return jsonify({
        "locations": sorted(
            [{"name": name.title(), "lat": lat, "lng": lng}
             for name, (lat, lng) in LOCATIONS.items()],
            key=lambda x: x["name"],
        )
    })


@citizen_bp.route("/api/citizen/route", methods=["POST"])
def plan_route():
    """
    Plan a route between two Bengaluru locations.
    Dijkstra on ROAD_NETWORK with weights penalised by active incidents,
    public events and weather alerts.
    """
    data     = request.get_json(silent=True) or {}
    from_raw = str(data.get("from", "")).strip()
    to_raw   = str(data.get("to",   "")).strip()

    if not from_raw or not to_raw:
        return jsonify({"error": "Both 'from' and 'to' locations are required."}), 400

    from_node = _nearest_location(from_raw)
    to_node   = _nearest_location(to_raw)

    if not from_node:
        return jsonify({"error": f"Could not recognise '{from_raw}'. Try a major area like 'Silk Board', 'Indiranagar', 'Whitefield'."}), 404
    if not to_node:
        return jsonify({"error": f"Could not recognise '{to_raw}'. Try a major area like 'Silk Board', 'Indiranagar', 'Whitefield'."}), 404
    if from_node == to_node:
        return jsonify({"error": "Source and destination resolved to the same location."}), 400

    try:
        with get_connection() as conn:
            incidents  = rows_to_list(conn.execute(
                "SELECT * FROM events WHERE event_category='INCIDENT' AND status='ACTIVE'"
            ).fetchall())
            pub_events = rows_to_list(conn.execute(
                "SELECT * FROM events WHERE event_category='PUBLIC_EVENT' AND status IN ('ACTIVE','UPCOMING')"
            ).fetchall())
            weather    = rows_to_list(conn.execute(
                "SELECT * FROM weather_alerts WHERE status IN ('ACTIVE','MONITORING')"
            ).fetchall())

        graph, edge_lookup = _build_route_graph(incidents, pub_events, weather)
        path, _total_cost  = _dijkstra(graph, from_node, to_node)

        if len(path) < 2:
            return jsonify({
                "error": "No route found between these locations in the road network.",
                "hint":  f"Try nearby areas instead of '{from_raw}' or '{to_raw}'.",
            }), 404

        # ── Build response ───────────────────────────────────────────────
        segments      = []
        total_dist    = 0.0
        total_time    = 0.0
        route_alerts: list[dict] = []

        for i in range(len(path) - 1):
            a, b = path[i], path[i + 1]
            key  = (min(a, b), max(a, b))
            info = edge_lookup.get(key, {
                "road": "Local Road", "distance_km": 1.0,
                "congestion": "low", "cost": 2.0, "alerts": [],
            })

            seg_time = info["cost"]
            total_dist += info["distance_km"]
            total_time += seg_time

            seg = {
                "from":        a.title(),
                "to":          b.title(),
                "road":        info["road"],
                "distance_km": round(info["distance_km"], 1),
                "time_min":    max(1, round(seg_time)),
                "congestion":  info["congestion"],
            }
            segments.append(seg)

            for alert in info.get("alerts", []):
                if alert not in route_alerts:
                    route_alerts.append(alert)

        # Route geometry (waypoints for map polyline)
        route_coords = []
        for node in path:
            lat, lng = LOCATIONS.get(node, (0, 0))
            route_coords.append({"lat": lat, "lng": lng, "label": node.title()})

        # Summary
        via_roads = list(dict.fromkeys(s["road"] for s in segments))
        if len(via_roads) <= 2:
            summary = "Via " + " → ".join(via_roads)
        else:
            summary = f"Via {via_roads[0]} → {via_roads[1]} (+{len(via_roads) - 2} more)"

        avoided = _find_avoided(path, incidents, pub_events, weather)

        return jsonify({
            "status":            "success",
            "from":              from_node.title(),
            "to":                to_node.title(),
            "summary":           summary,
            "total_distance_km": round(total_dist, 1),
            "total_time_min":    max(1, round(total_time)),
            "route":             segments,
            "route_coords":      route_coords,
            "alerts":            route_alerts[:6],
            "avoided":           avoided,
        })
    except Exception as exc:
        logger.error("plan_route error: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500
