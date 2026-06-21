let map;
let particleSystem;
let timelineSimulator;
let eventAnimation;

let activeRoads = [];
let activePolylines = {};
let currentTimelineState = null;
let selectedRoadId = null;
let overlayLayers = [];

document.addEventListener("DOMContentLoaded", () => {
    initMap();
});

function initMap() {
    map = L.map("leaflet-map", {
        center: [12.9716, 77.5946],
        zoom: 12,
        minZoom: 10,
        maxZoom: 18,
        preferCanvas: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 20,
    }).addTo(map);

    particleSystem = new TrafficParticleSystem(map);
    eventAnimation = new EventAnimationEngine(map);
    timelineSimulator = new TimelineSimulator(applyTimelineState);

    map.on("moveend", fetchRoadsInView);
    map.on("zoomend", fetchRoadsInView);
    map.on("click", (e) => {
        window.dispatchEvent(new CustomEvent("map:clicked", { detail: e.latlng }));
    });

    window.mapEngine = {
        getMap: () => map,
        getSelectedRoad: () => activeRoads.find((road) => road.edge_id === selectedRoadId) || null,
        getTimelineSimulator: () => timelineSimulator,
        focusRoad,
        addEventMarker,
        clearScenario,
        renderInterventions,
        clearInterventions,
    };

    fetchRoadsInView();
    applyTimelineVisibility(false);
}

async function fetchRoadsInView() {
    if (!map) return;
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const params = new URLSearchParams({
        zoom,
        min_lat: bounds.getSouth(),
        max_lat: bounds.getNorth(),
        min_lng: bounds.getWest(),
        max_lng: bounds.getEast(),
    });

    try {
        const response = await fetch(`/api/roads?${params.toString()}`);
        if (!response.ok) throw new Error("Unable to load roads");
        renderRoads(await response.json());
    } catch (error) {
        console.error(error);
    }
}

function renderRoads(roads) {
    const zoom = map ? map.getZoom() : 12;
    activeRoads = roads.filter(road => {
        const roadType = String(road.road_type || "").toLowerCase();
        if (roadType.includes("residential") || roadType.includes("service") || roadType.includes("living_street") || roadType.includes("unclassified")) {
            return false;
        }
        if (zoom <= 12) {
            return roadType.includes("motorway") || roadType.includes("trunk") || roadType.includes("primary");
        }
        return true;
    });

    const nextIds = new Set(activeRoads.map((road) => road.edge_id));

    Object.keys(activePolylines).forEach((edgeId) => {
        if (!nextIds.has(edgeId)) {
            map.removeLayer(activePolylines[edgeId]);
            delete activePolylines[edgeId];
        }
    });

    activeRoads.forEach((road) => {
        const state = getRoadStateData(road.edge_id, road);
        road.congestion_score = state.congestion_score;
        road.current_speed = state.current_speed;
        const isSelected = road.edge_id === selectedRoadId;
        const style = {
            color: isSelected ? "#f6efe3" : getRoadColor(state.congestion_score),
            weight: isSelected ? getRoadWeight(road.road_type) + 2.2 : getRoadWeight(road.road_type),
            opacity: 0.92,
            lineCap: "round",
            lineJoin: "round",
        };

        if (activePolylines[road.edge_id]) {
            activePolylines[road.edge_id].setStyle(style);
        } else {
            const polyline = L.polyline(road.geometry, style).addTo(map);
            polyline.baselineWeight = getRoadWeight(road.road_type);
            polyline.bindTooltip(road.road_name, { sticky: true });
            polyline.on("click", () => inspectRoad(road));
            activePolylines[road.edge_id] = polyline;
        }
    });

    particleSystem.setRoads(activeRoads);
    particleSystem.updateRoadStates(currentTimelineState?.roads || {});
}

function getRoadColor(congestion) {
    if (congestion >= 0.7) return "#df3b31";
    if (congestion >= 0.35) return "#f2a43a";
    return "#2fa3ff";
}

function getRoadWeight(type) {
    const roadType = String(type || "").toLowerCase();
    if (roadType.includes("motorway") || roadType.includes("trunk")) return 5.5;
    if (roadType.includes("primary")) return 4.5;
    if (roadType.includes("secondary")) return 2.5;
    if (roadType.includes("tertiary")) return 1.5;
    return 1.0;
}

function getRoadStateData(edgeId, baselineRoad) {
    const timelineRoad = currentTimelineState?.roads?.[edgeId];
    if (timelineRoad) {
        return {
            congestion_score: timelineRoad.congestion_score,
            current_speed: timelineRoad.current_speed,
        };
    }
    return {
        congestion_score: baselineRoad?.congestion_score ?? 0.08,
        current_speed: baselineRoad?.current_speed ?? 30,
    };
}

function applyTimelineState(timelineData) {
    currentTimelineState = timelineData;
    Object.keys(activePolylines).forEach((edgeId) => {
        const road = activeRoads.find((item) => item.edge_id === edgeId);
        const state = getRoadStateData(edgeId, road);
        const isSelected = edgeId === selectedRoadId;
        activePolylines[edgeId].setStyle({
            color: isSelected ? "#f6efe3" : getRoadColor(state.congestion_score),
            weight: isSelected ? getRoadWeight(road?.road_type) + 2.2 : getRoadWeight(road?.road_type),
        });
    });
    particleSystem.updateRoadStates(timelineData.roads || {});
    
    // Update live simulation stats box overlay on map
    const liveSpeed = document.getElementById("live-stat-speed");
    const liveCongestion = document.getElementById("live-stat-congestion");
    const liveCritical = document.getElementById("live-stat-critical");
    if (liveSpeed && timelineData.avg_speed !== undefined) {
        liveSpeed.textContent = `${timelineData.avg_speed} km/h`;
    }
    if (liveCongestion && timelineData.avg_congestion !== undefined) {
        liveCongestion.textContent = `${timelineData.avg_congestion}%`;
    }
    if (liveCritical && timelineData.critical_roads !== undefined) {
        liveCritical.textContent = timelineData.critical_roads;
    }
    
    window.dispatchEvent(new CustomEvent("timeline:changed", { detail: timelineData }));
}

function inspectRoad(road, shouldFocus = false) {
    selectedRoadId = road.edge_id;
    if (shouldFocus && road.geometry?.length) {
        const midPoint = road.geometry[Math.floor(road.geometry.length / 2)];
        map.flyTo(midPoint, Math.max(map.getZoom(), 14), { duration: 0.8 });
    }
    renderRoads(activeRoads);
    const detail = { ...road, ...getRoadStateData(road.edge_id, road) };
    window.dispatchEvent(new CustomEvent("road:selected", { detail }));
}

function focusRoad(edgeId) {
    const road = activeRoads.find((item) => item.edge_id === edgeId);
    if (road) inspectRoad(road, true);
}

function addEventMarker(payload) {
    if (!payload?.location) return;
    const type = payload.event_type || payload.scenario_key || "event";
    eventAnimation.addEventMarker(
        payload.simulation_id || `event_${Date.now()}`,
        payload.location.lat,
        payload.location.lng,
        type,
        null
    );
}

function clearScenario() {
    if (eventAnimation) eventAnimation.clearAll();
    clearInterventions();
    currentTimelineState = null;
    selectedRoadId = null;
    renderRoads(activeRoads);
    applyTimelineVisibility(false);
}

function renderInterventions(interventions) {
    clearInterventions();
    interventions.forEach((item) => {
        const road = activeRoads.find((r) => r.edge_id === item.edge_id) || null;
        const coords = item.coordinates || (road?.geometry ? road.geometry[Math.floor(road.geometry.length / 2)] : null);
        if (coords) {
            const label = interventionLabel(item);
            const icon = L.divIcon({
                html: `<div class="map-overlay-chip">${label}</div>`,
                className: "map-overlay-chip-wrap",
                iconSize: [82, 28],
                iconAnchor: [41, 14],
            });
            overlayLayers.push(L.marker([coords.lat || coords[0], coords.lng || coords[1]], { icon }).addTo(map));
        }
        if (road?.geometry && (item.type === "closure" || item.type === "barricade")) {
            overlayLayers.push(
                L.polyline(road.geometry, {
                    color: item.type === "closure" ? "#ff5b4d" : "#ffd166",
                    weight: getRoadWeight(road.road_type) + 3,
                    opacity: 0.95,
                    dashArray: item.type === "closure" ? "10 8" : "2 8",
                }).addTo(map)
            );
        }
    });
}

function interventionLabel(item) {
    if (item.type === "manpower") return `Officers ${item.parameters?.officers_count || 0}`;
    if (item.type === "barricade") return `Barricade ${item.parameters?.reduction_pct || 0}%`;
    if (item.type === "closure") return "Closure";
    return "Action";
}

function clearInterventions() {
    overlayLayers.forEach((layer) => map.removeLayer(layer));
    overlayLayers = [];
}

function applyTimelineVisibility(isVisible) {
    const timelinePanel = document.getElementById("timeline-panel");
    const statsBox = document.getElementById("map-live-stats-box");
    if (timelinePanel) {
        timelinePanel.style.display = isVisible ? "flex" : "none";
    }
    if (statsBox) {
        if (isVisible) {
            statsBox.classList.remove("hidden");
        } else {
            statsBox.classList.add("hidden");
        }
    }
}
