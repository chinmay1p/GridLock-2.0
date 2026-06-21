"""
Traffic Scenario — Validated input object for the City Simulation Engine.

Stores event type, location, time, affected road, duration, and closure
details.  Provides factory methods for user input parsing and conversion
to ML-model feature dictionaries.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

# Known event types understood by the prediction models
VALID_EVENT_TYPES = {
    "vehicle_breakdown", "accident", "severe_crash",
    "flooding", "waterlogging", "pothole",
    "construction", "road_closure", "public_event",
    "heavy_rain", "protest", "vip_movement",
}


@dataclass
class ClosureDetails:
    """Sub-object describing road-closure parameters."""
    closure: bool = False
    percentage: float = 100.0          # 0-100 scale
    closure_type: str = "full"         # "full" | "partial" | "barricade"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "closure": self.closure,
            "percentage": self.percentage,
            "closure_type": self.closure_type,
        }


@dataclass
class TrafficScenario:
    """
    Immutable description of a traffic event for the simulation pipeline.

    Attributes:
        event_type:    Category string (e.g. "vehicle_breakdown").
        latitude:      WGS-84 latitude of the incident.
        longitude:     WGS-84 longitude of the incident.
        location_name: Human-readable road / area name.
        time:          Incident timestamp.
        duration_min:  Expected duration in minutes (0 = unknown).
        vehicle:       Vehicle involved (e.g. "truck", "car").
        description:   Free-text description for TF-IDF model.
        road_action:   Optional closure / barricade specification.
        edge_id:       Resolved edge identifier (populated after locate step).
    """
    event_type: str = "vehicle_breakdown"
    latitude: float = 12.9716
    longitude: float = 77.5946
    location_name: str = ""
    time: datetime = field(default_factory=datetime.now)
    duration_min: int = 0
    vehicle: str = "truck"
    description: str = ""
    road_action: ClosureDetails = field(default_factory=ClosureDetails)
    edge_id: Optional[str] = None

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------
    @classmethod
    def from_user_input(cls, data: Dict[str, Any]) -> "TrafficScenario":
        """Build a TrafficScenario from a raw user-supplied JSON dict."""
        loc = data.get("location", {})
        if isinstance(loc, dict):
            lat = float(loc.get("lat", loc.get("latitude", 12.9716)))
            lng = float(loc.get("lng", loc.get("longitude", 77.5946)))
        else:
            lat, lng = 12.9716, 77.5946

        # Parse time
        time_raw = data.get("time", "")
        try:
            ts = datetime.fromisoformat(str(time_raw)) if time_raw else datetime.now()
        except (ValueError, TypeError):
            ts = datetime.now()

        # Road action
        ra = data.get("road_action", {})
        if isinstance(ra, dict):
            closure_details = ClosureDetails(
                closure=bool(ra.get("closure", False)),
                percentage=float(ra.get("percentage", 100.0)),
                closure_type=str(ra.get("closure_type", "full" if ra.get("closure") else "none")),
            )
        else:
            closure_details = ClosureDetails()

        event_type = str(data.get("type", data.get("event_type", "vehicle_breakdown")))
        location_name = str(data.get("location_name", data.get("road", "")))

        return cls(
            event_type=event_type,
            latitude=lat,
            longitude=lng,
            location_name=location_name,
            time=ts,
            duration_min=int(data.get("duration_min", 0)),
            vehicle=str(data.get("vehicle", "truck")),
            description=str(data.get("description", "")),
            road_action=closure_details,
            edge_id=data.get("edge_id"),
        )

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------
    def validate(self) -> None:
        """Raise ValueError if the scenario has invalid fields."""
        if not (8.0 <= self.latitude <= 20.0):
            raise ValueError(f"Latitude {self.latitude} is outside India/Bangalore range.")
        if not (72.0 <= self.longitude <= 85.0):
            raise ValueError(f"Longitude {self.longitude} is outside India/Bangalore range.")
        if self.road_action.closure and not (0.0 < self.road_action.percentage <= 100.0):
            raise ValueError(f"Closure percentage must be in (0, 100], got {self.road_action.percentage}")

        norm_type = self.event_type.lower().replace(" ", "_")
        if norm_type not in VALID_EVENT_TYPES:
            logging.warning("Scenario: event_type '%s' is not in the standard set; proceeding anyway.", self.event_type)

    # ------------------------------------------------------------------
    # ML feature conversion
    # ------------------------------------------------------------------
    def convert_to_model_features(self) -> Dict[str, Any]:
        """Convert to the dict expected by ``predict_event_effect``."""
        hour = self.time.hour
        return {
            "event_cause": self.event_type.replace(" ", "_"),
            "location": self.location_name,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "time": f"{hour}:00",
            "vehicle": self.vehicle,
            "description": self.description or f"A {self.vehicle} {self.event_type.replace('_', ' ')} at {self.location_name}",
        }

    def to_dict(self) -> Dict[str, Any]:
        """Serialise to a plain JSON-safe dict."""
        return {
            "event_type": self.event_type,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "location_name": self.location_name,
            "time": self.time.isoformat(),
            "duration_min": self.duration_min,
            "vehicle": self.vehicle,
            "description": self.description,
            "road_action": self.road_action.to_dict(),
            "edge_id": self.edge_id,
        }
