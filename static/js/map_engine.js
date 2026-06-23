let map;
let particleSystem;
let timelineSimulator;
let eventAnimation;

let activeRoads = [];
let activePolylines = {};
let currentTimelineState = null;
let selectedRoadId = null;
let overlayLayers = [];
let _congWarnings = [];

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
        getRoads: () => activeRoads,
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
        if (zoom <= 10) {
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
        const isClosed   = state.congestion_score < 0.05;
        const style = {
            color:     isSelected ? "#f6efe3" : getRoadColor(state.congestion_score),
            weight:    isSelected ? getRoadWeight(road.road_type) + 2.2 : getRoadWeight(road.road_type),
            opacity:   isClosed ? 0.65 : 0.92,
            dashArray: isClosed ? "10 7" : null,
            lineCap:   "round",
            lineJoin:  "round",
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
    if (congestion < 0.05)  return "#334155"; // CLOSED — dark slate (no traffic)
    if (congestion >= 0.88) return "#ff1f1f";  // CRITICAL — bright red
    if (congestion >= 0.7)  return "#df3b31";  // HIGH
    if (congestion >= 0.35) return "#f2a43a";  // MEDIUM
    return "#2fa3ff";                           // FREE FLOW
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
        const road     = activeRoads.find((item) => item.edge_id === edgeId);
        const state    = getRoadStateData(edgeId, road);
        const isSelected = edgeId === selectedRoadId;
        const isClosed   = state.congestion_score < 0.05;
        activePolylines[edgeId].setStyle({
            color:     isSelected ? "#f6efe3" : getRoadColor(state.congestion_score),
            weight:    isSelected ? getRoadWeight(road?.road_type) + 2.2 : getRoadWeight(road?.road_type),
            opacity:   isClosed ? 0.65 : 0.92,
            dashArray: isClosed ? "10 7" : null,
        });
    });
    particleSystem.updateRoadStates(timelineData.roads || {});
    _updateCongestionWarnings(timelineData.roads || {});

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
    _congWarnings.forEach(m => map.removeLayer(m));
    _congWarnings = [];
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

function _updateCongestionWarnings(roadsMap) {
    _congWarnings.forEach(m => map.removeLayer(m));
    _congWarnings = [];

    const hot = [];
    activeRoads.forEach(road => {
        const cong = roadsMap[road.edge_id]?.congestion_score ?? (road.congestion_score ?? 0);
        if (cong < 0.72) return;
        const geo = road.geometry;
        if (!geo?.length) return;
        const mid = geo[Math.floor(geo.length / 2)];
        const lat = Array.isArray(mid) ? mid[0] : (mid?.lat ?? 0);
        const lng = Array.isArray(mid) ? mid[1] : (mid?.lng ?? 0);
        hot.push({ cong, lat, lng, name: road.road_name });
    });

    hot.sort((a, b) => b.cong - a.cong);
    hot.slice(0, 14).forEach(({ cong, lat, lng, name }) => {
        const isCritical = cong >= 0.88;
        const size      = isCritical ? 34 : 22;
        const innerSize = isCritical ? 10 : 7;
        const off       = Math.floor((size - innerSize) / 2);
        const color     = isCritical ? "#ff1f1f" : "#f59e0b";
        const anim      = isCritical ? "congPulseRed" : "congPulseAmber";
        const dur       = isCritical ? "1.2s" : "2.0s";

        const icon = L.divIcon({
            html: `<div style="position:relative;width:${size}px;height:${size}px;pointer-events:none;">` +
                  `<div style="position:absolute;inset:0;border-radius:50%;background:${color};` +
                  `animation:${anim} ${dur} ease-out infinite;transform-origin:center;"></div>` +
                  `<div style="position:absolute;top:${off}px;left:${off}px;width:${innerSize}px;height:${innerSize}px;` +
                  `border-radius:50%;background:${color};"></div>` +
                  `</div>`,
            className: "",
            iconSize:   [size, size],
            iconAnchor: [size / 2, size / 2],
        });
        const m = L.marker([lat, lng], { icon, interactive: true, zIndexOffset: 50 }).addTo(map);
        m.bindTooltip(
            `<strong>${name}</strong><br>${Math.round(cong * 100)}% congestion${isCritical ? " — CRITICAL" : ""}`,
            { sticky: true, className: "cong-warn-tip" }
        );
        _congWarnings.push(m);
    });
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
