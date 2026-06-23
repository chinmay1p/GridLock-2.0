"""
Maps known Bengaluru location names to (latitude, longitude) coordinates.
Used when adding events without explicit GPS coordinates.
"""

from __future__ import annotations

# Keys are lowercase for case-insensitive matching
BENGALURU_LOCATIONS: dict[str, tuple[float, float]] = {
    # ── Stadiums / Large Venues ────────────────────────────────────────────
    "m. chinnaswamy stadium":     (12.9788, 77.5996),
    "chinnaswamy stadium":        (12.9788, 77.5996),
    "palace grounds":             (13.0067, 77.5843),
    "kanteerava stadium":         (12.9739, 77.5684),
    "national games village":     (12.9834, 77.6271),

    # ── Freedom Park / Government ──────────────────────────────────────────
    "freedom park":               (12.9762, 77.5697),
    "vidhana soudha":             (12.9795, 77.5908),
    "town hall":                  (12.9762, 77.5754),
    "cubbon park":                (12.9763, 77.5929),

    # ── Major Junctions ────────────────────────────────────────────────────
    "silk board":                 (12.9177, 77.6238),
    "silk board junction":        (12.9177, 77.6238),
    "hebbal flyover":             (13.0453, 77.5962),
    "hebbal":                     (13.0453, 77.5962),
    "kr circle":                  (12.9764, 77.5770),
    "k r circle":                 (12.9764, 77.5770),
    "majestic":                   (12.9769, 77.5713),
    "kempegowda bus terminal":    (12.9769, 77.5713),
    "mekhri circle":              (13.0172, 77.5817),
    "yeshwanthpur circle":        (13.0240, 77.5481),
    "yeshwanthpur":               (13.0240, 77.5481),
    "jalahalli cross":            (13.0354, 77.5378),
    "nagavara junction":          (13.0432, 77.6256),
    "sarjapur road orr junction": (12.9072, 77.6835),

    # ── Residential / Commercial Areas ────────────────────────────────────
    "indiranagar":                (12.9784, 77.6408),
    "indiranagar 100 feet road":  (12.9784, 77.6408),
    "100 feet road indiranagar":  (12.9784, 77.6408),
    "koramangala":                (12.9352, 77.6245),
    "hsr layout":                 (12.9116, 77.6389),
    "btm layout":                 (12.9166, 77.6101),
    "jp nagar":                   (12.9063, 77.5857),
    "jayanagar":                  (12.9252, 77.5938),
    "marathahalli":               (12.9591, 77.6968),
    "whitefield":                 (12.9698, 77.7500),
    "whitefield itpl":            (12.9698, 77.7500),
    "itpl":                       (12.9698, 77.7500),
    "electronic city":            (12.8453, 77.6602),
    "electronic city phase 1":    (12.8453, 77.6602),
    "rajajinagar":                (12.9919, 77.5547),
    "basavanagudi":               (12.9428, 77.5741),
    "malleswaram":                (13.0061, 77.5681),
    "jayanagar 4th block":        (12.9252, 77.5938),
    "mg road":                    (12.9748, 77.6095),
    "brigade road":               (12.9719, 77.6070),
    "residency road":             (12.9728, 77.6041),
    "richmond road":              (12.9623, 77.5980),

    # ── Major Corridors / Roads ────────────────────────────────────────────
    "outer ring road":            (12.9569, 77.7011),
    "orr":                        (12.9569, 77.7011),
    "orr underpass":              (12.9569, 77.7011),
    "hosur road":                 (12.9176, 77.6244),
    "mysore road":                (12.9543, 77.5138),
    "tumkur road":                (13.0313, 77.5450),
    "bellary road":               (13.0067, 77.5843),
    "old madras road":            (12.9912, 77.6602),
    "bannerghatta road":          (12.8953, 77.5976),
    "sarjapur road":              (12.9072, 77.6835),
    "kanakapura road":            (12.8832, 77.5699),
    "nh 44":                      (12.9176, 77.6244),
    "nh 75":                      (12.9543, 77.5138),
    "100 feet road":              (12.9784, 77.6408),
}

DEFAULT_COORDS = (12.9716, 77.5946)  # Bengaluru city centre


def get_coordinates(location_name: str) -> tuple[float, float]:
    """
    Return (lat, lng) for a Bengaluru location name.
    Falls back to city centre if not found.
    """
    if not location_name:
        return DEFAULT_COORDS

    key = location_name.strip().lower()

    # 1. Direct match
    if key in BENGALURU_LOCATIONS:
        return BENGALURU_LOCATIONS[key]

    # 2. Substring match — location name contains a known key
    for known, coords in BENGALURU_LOCATIONS.items():
        if known in key:
            return coords

    # 3. Substring match — known key contains the search term
    for known, coords in BENGALURU_LOCATIONS.items():
        if key in known:
            return coords

    return DEFAULT_COORDS
