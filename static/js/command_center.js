const SCENARIOS = {
    upcoming: [
        {
            key: "ipl_match",
            title: "IPL Match",
            subtitle: "Chinnaswamy Stadium",
            meta: "Crowd 35,000",
            event_type: "public_event",
        },
        {
            key: "concert",
            title: "South India Property Expo",
            subtitle: "Palace Grounds",
            meta: "Crowd 15,000",
            event_type: "public_event",
        },
        {
            key: "public_gathering",
            title: "Bangalore Death Fest 4",
            subtitle: "Koramangala",
            meta: "Crowd 2,500",
            event_type: "public_event",
        },
    ],
    reported: [
        {
            key: "truck_breakdown",
            title: "Vehicle Breakdown",
            subtitle: "Silk Board Junction",
            meta: "Reported 20m ago",
            event_type: "vehicle_breakdown",
        },
        {
            key: "tree_fall",
            title: "Tree Fall",
            subtitle: "Indiranagar 100 Ft Rd",
            meta: "Reported 45m ago",
            event_type: "tree_fall",
        },
        {
            key: "water_logging",
            title: "Water Logging",
            subtitle: "ORR",
            meta: "Reported 1h ago",
            event_type: "water_logging",
        },
    ],
};

const state = {
    selectedRoad: null,
    activeEvent: null,
    activeInterventions: [],
    recommendationPack: null,
    activeTool: null,
    iplActive: false,
    iplTimeline: null,
    iplIndex: 0,
    // Custom map layers for IPL Match
    iplMarkers: [],
    iplDiversionLines: []
};

// Map of IPL index to display time
const IPL_TIME_LABELS = {
    0: "5:30 PM",
    1: "6:30 PM",
    2: "8:30 PM",
    3: "11:30 PM",
    4: "12:30 AM"
};

document.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("dashboard-body");
    initSections();
    initEventTabs();
    renderScenarioLists();
    bindTooling();
    bindGlobalEvents();
    refreshCityOverview();
    setInterval(refreshCityOverview, 12000);

    // Bind the new Update Simulation button
    const btnUpdateSim = document.getElementById("btn-update-simulation");
    if (btnUpdateSim) {
        btnUpdateSim.addEventListener("click", runCustomSimulationUpdate);
    }
});

function initSections() {
    document.querySelectorAll("[data-section] .section-toggle").forEach((button) => {
        button.addEventListener("click", () => {
            button.closest("[data-section]").classList.toggle("collapsed");
        });
    });
}

function initEventTabs() {
    document.querySelectorAll("[data-event-tab]").forEach((button) => {
        button.addEventListener("click", () => {
            document.querySelectorAll("[data-event-tab]").forEach((item) => item.classList.remove("active"));
            document.querySelectorAll(".event-panel").forEach((panel) => panel.classList.remove("active"));
            button.classList.add("active");
            document.getElementById(`event-tab-${button.dataset.eventTab}`).classList.add("active");
        });
    });
    document.getElementById("btn-run-custom-scenario").addEventListener("click", () => {
        runScenario(document.getElementById("custom-scenario").value);
    });
    document.getElementById("btn-reset-simulation").addEventListener("click", resetSimulation);
}

function renderScenarioLists() {
    renderScenarioGroup("upcoming-events-list", SCENARIOS.upcoming);
    renderScenarioGroup("reported-events-list", SCENARIOS.reported);
}

function renderScenarioGroup(containerId, scenarios) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    scenarios.forEach((scenario) => {
        const row = document.createElement("div");
        row.className = "event-row";
        if (scenario.key === "ipl_match") {
            row.innerHTML = `
                <div class="event-row-head" style="flex-direction: column; gap: 4px; align-items: flex-start; width: 100%;">
                    <h4 style="font-size: 15px; margin: 0; color: #ffd28a;">${scenario.title}</h4>
                    <div style="font-size: 12px; color: #9eb3c8; margin-top: 4px; display: grid; gap: 2px;">
                        <div><strong>Venue:</strong> M. Chinnaswamy Stadium</div>
                        <div><strong>Time:</strong> 18:30 - 23:30</div>
                        <div><strong>Expected crowd:</strong> 35,000</div>
                    </div>
                </div>
                <button class="primary-btn" type="button" style="width: 100%; margin-top: 10px; padding: 8px;">Analyze Impact</button>
            `;
            row.querySelector("button").addEventListener("click", () => startIPLScenarioFlow());
        } else {
            row.innerHTML = `
                <div class="event-row-head">
                    <div>
                        <h4>${scenario.title}</h4>
                        <p>${scenario.subtitle}</p>
                    </div>
                    <span class="chip">${scenario.meta}</span>
                </div>
                <button class="mini-btn" type="button">Analyze Impact</button>
            `;
            row.querySelector("button").addEventListener("click", () => runScenario(scenario.key));
        }
        container.appendChild(row);
    });
}

function bindTooling() {
    document.querySelectorAll(".tool-btn").forEach((button) => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".tool-btn").forEach((item) => item.classList.remove("active"));
            state.activeTool = button.dataset.tool;
            button.classList.add("active");
            renderToolConfig();
        });
    });

    document.getElementById("btn-clear-actions").addEventListener("click", () => {
        state.activeInterventions = [];
        clearIPLOverlays();
        if (window.mapEngine) window.mapEngine.clearInterventions();
        renderActiveActions();
        updatePlanEffect(null);
        if (state.iplActive) {
            runCustomSimulationUpdate();
        }
    });
}

function bindGlobalEvents() {
    window.addEventListener("road:selected", (event) => {
        state.selectedRoad = event.detail;
        renderSelectedRoad(event.detail);
        if (state.activeTool) renderToolConfig();
    });

    window.addEventListener("timeline:changed", (event) => {
        const detail = event.detail;
        if (detail?.avg_congestion !== undefined) {
            const elFlow = document.getElementById("metric-flow");
            const elCong = document.getElementById("metric-congestion");
            const elCritical = document.getElementById("metric-critical");
            const elSpeed = document.getElementById("metric-speed");
            const elState = document.getElementById("metric-state");

            if (elFlow) elFlow.textContent = `${Math.max(0, Math.round(100 - detail.avg_congestion))}%`;
            if (elCong) elCong.textContent = `${Math.round(detail.avg_congestion)}%`;
            if (elCritical) elCritical.textContent = detail.critical_roads;
            if (elSpeed) elSpeed.textContent = `${detail.avg_speed} km/h`;
            if (elState) elState.textContent = detail.avg_congestion > 65 ? "Critical" : (detail.avg_congestion > 35 ? "Heavy" : "Monitoring");
        }
    });

    // Handle map clicks to place custom barricades or deployments
    window.addEventListener("map:clicked", (e) => {
        const latlng = e.detail;
        if (!state.iplActive || !state.activeTool) return;
        
        const road = state.selectedRoad || { road_name: "Selected Point", edge_id: `custom_${Date.now()}` };
        
        if (state.activeTool === "barricade") {
            const id = `b_custom_${Date.now()}`;
            const newBarricade = {
                id: id,
                lat: latlng.lat,
                lng: latlng.lng,
                name: `Manual Barricade (${road.road_name})`,
                road_name: road.road_name,
                edge_id: road.edge_id
            };
            addCustomBarricadeMarker(newBarricade);
            state.activeInterventions.push({
                type: "barricade",
                id: id,
                edge_id: road.edge_id,
                road_name: road.road_name,
                lat: latlng.lat,
                lng: latlng.lng
            });
            renderActiveActions();
        } else if (state.activeTool === "manpower") {
            const id = `p_custom_${Date.now()}`;
            const newPolice = {
                id: id,
                lat: latlng.lat,
                lng: latlng.lng,
                officers: 10,
                name: `Deploy Officers (${road.road_name})`
            };
            addCustomPoliceMarker(newPolice);
            state.activeInterventions.push({
                type: "manpower",
                id: id,
                edge_id: road.edge_id,
                road_name: road.road_name,
                lat: latlng.lat,
                lng: latlng.lng,
                parameters: { officers_count: 10 }
            });
            renderActiveActions();
        } else if (state.activeTool === "diversion") {
            // Draw a temporary closure/diversion highlight
            state.activeInterventions.push({
                type: "diversion",
                edge_id: road.edge_id,
                road_name: road.road_name,
                closed_fully: true
            });
            renderActiveActions();
            // Trigger visual feedback in Leaflet
            if (window.mapEngine && road.geometry) {
                const line = L.polyline(road.geometry, {
                    color: "#ff3b30",
                    weight: 6,
                    dashArray: "5 10",
                    opacity: 0.9
                }).addTo(window.mapEngine.getMap());
                state.iplDiversionLines.push(line);
            }
        }
    });
}

async function refreshCityOverview() {
    if (state.iplActive) return; // Keep simulation stats focused
    try {
        const response = await fetch("/api/city/state");
        if (!response.ok) return;
        const data = await response.json();
        const elFlow = document.getElementById("metric-flow");
        const elCong = document.getElementById("metric-congestion");
        const elEvents = document.getElementById("metric-events");
        const elCritical = document.getElementById("metric-critical");
        const elSpeed = document.getElementById("metric-speed");
        const elState = document.getElementById("metric-state");

        if (elFlow) elFlow.textContent = `${Math.round(data.city_flow)}%`;
        if (elCong) elCong.textContent = `${Math.round(data.avg_congestion)}%`;
        if (elEvents) elEvents.textContent = data.active_events ?? (state.activeEvent ? 1 : 0);
        if (elCritical) elCritical.textContent = data.critical_roads;
        if (elSpeed) elSpeed.textContent = `${data.avg_speed} km/h`;
        if (elState) elState.textContent = data.avg_congestion > 60 ? "Critical" : (data.avg_congestion > 35 ? "Heavy" : "Monitoring");
        
        const elTip = document.getElementById("map-tip");
        if (elTip && data.time_desc && !state.activeEvent) {
            elTip.textContent = `${data.time_desc} traffic state. Select an event to analyze traffic impact.`;
        }
    } catch (error) {
        console.error(error);
    }
}

async function runScenario(scenarioKey) {
    if (scenarioKey === "ipl_match") {
        startIPLScenarioFlow();
        return;
    }
    const payload = { scenario_key: scenarioKey };
    document.getElementById("map-tip").textContent = "Running simulation engine...";
    try {
        const result = await timedJsonFetch("/api/events/simulate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        state.activeEvent = result;
        state.activeInterventions = [];
        state.recommendationPack = null;
        document.getElementById("simulation-empty").classList.add("hidden");
        document.getElementById("simulation-summary").classList.remove("hidden");
        document.getElementById("summary-event-name").textContent = `${result.location_name} | ${result.road_name}`;
        document.getElementById("summary-impact").textContent = result.impact;
        document.getElementById("summary-delay").textContent = `+${result.expected_delay} min`;
        document.getElementById("summary-recovery").textContent = result.time_to_clear;
        document.getElementById("suggestion-severity").textContent = result.impact;
        document.getElementById("suggestion-duration").textContent = `${result.expected_duration} min`;
        document.getElementById("map-tip").textContent = "Timeline active. Test interventions and response plans.";
        document.getElementById("suggestions-section").classList.remove("hidden");
        if (window.mapEngine) {
            window.mapEngine.clearScenario();
            window.mapEngine.addEventMarker(result);
            if (result.edge_id) {
                window.mapEngine.focusRoad(result.edge_id);
            }
        }
        renderActiveActions();
        const timeline = window.mapEngine?.getTimelineSimulator();
        if (timeline) {
            document.getElementById("timeline-panel").style.display = "flex";
            timeline.clearCache();
            await timeline.setSimTime(0);
        }
        await refreshCityOverview();
        await loadSuggestions();
    } catch (error) {
        console.error(error);
        document.getElementById("map-tip").textContent = "Simulation could not be completed.";
    }
}

// =========================================================================
// IPL CHINNASWAMY STADIUM DEMO FLOW
// =========================================================================

async function startIPLScenarioFlow() {
    state.iplActive = true;
    state.activeInterventions = [];
    clearIPLOverlays();
    
    document.getElementById("map-tip").textContent = "Initializing Chinnaswamy Stadium IPL simulation...";
    
    try {
        // 1. Fetch metadata and initialize timeline curve
        const loadRes = await timedJsonFetch("/api/ipl/load");
        state.activeEvent = loadRes;
        
        await timedJsonFetch("/api/ipl/simulate/baseline", { method: "POST" });

        // 2. Prepare timeline panel ticks
        const slider = document.getElementById("timeline-slider");
        slider.min = "0";
        slider.max = "4";
        slider.step = "1";
        slider.value = "0";
        
        const ticksContainer = document.querySelector(".timeline-ticks");
        ticksContainer.innerHTML = `
            <span class="tick-label active" data-val="0">17:30</span>
            <span class="tick-label" data-val="1">18:30</span>
            <span class="tick-label" data-val="2">20:30</span>
            <span class="tick-label" data-val="3">23:30</span>
            <span class="tick-label" data-val="4">00:30</span>
        `;
        
        // Rebind click listeners to new ticks
        ticksContainer.querySelectorAll(".tick-label").forEach(tick => {
            tick.addEventListener("click", () => {
                const val = parseInt(tick.getAttribute("data-val"), 10);
                setIPLTimeIndex(val);
            });
        });

        // Override slider input
        slider.oninput = (e) => {
            const val = parseInt(e.target.value, 10);
            setIPLTimeIndex(val);
        };

        // 3. Render Leaflet marker for the Stadium
        if (window.mapEngine) {
            window.mapEngine.clearScenario();
            const mapObj = window.mapEngine.getMap();
            
            // Add a large pulsing custom DivIcon stadium marker
            const stadiumMarker = L.marker([12.9788, 77.5996], {
                icon: L.divIcon({
                    html: `
                        <div style="position: relative; width: 44px; height: 44px;">
                            <div style="position: absolute; top: 12px; left: 12px; width: 20px; height: 20px; border-radius: 50%; background: #e1862d; border: 2px solid #fff; box-shadow: 0 0 10px rgba(0,0,0,0.5); z-index: 10;"></div>
                            <div style="position: absolute; top: 2px; left: 2px; width: 40px; height: 40px; border-radius: 50%; background: rgba(225, 134, 45, 0.4); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
                        </div>
                    `,
                    className: "stadium-pulse-marker",
                    iconSize: [44, 44],
                    iconAnchor: [22, 22]
                })
            }).addTo(mapObj);
            
            stadiumMarker.bindTooltip("M. Chinnaswamy Stadium (IPL Match)", { permanent: true, direction: "top", className: "stadium-tooltip" });
            
            // Add impact radius circle
            const circle = L.circle([12.9788, 77.5996], {
                radius: 650,
                color: "#e1862d",
                fillColor: "#e1862d",
                fillOpacity: 0.1,
                weight: 1.5
            }).addTo(mapObj);
            
            state.iplMarkers.push(stadiumMarker);
            state.iplMarkers.push(circle);
            
            mapObj.flyTo([12.9788, 77.5996], 14, { duration: 1.2 });
        }

        // 4. Update UI details
        document.getElementById("simulation-empty").classList.add("hidden");
        document.getElementById("simulation-summary").classList.remove("hidden");
        document.getElementById("summary-event-name").textContent = "M. Chinnaswamy Stadium | IPL Match";
        document.getElementById("summary-impact").textContent = "HIGH";
        document.getElementById("summary-delay").textContent = "+120 min";
        document.getElementById("summary-recovery").textContent = "120 min";

        document.getElementById("timeline-panel").style.display = "flex";
        
        // Show suggestions section but insert a big primary button to generate suggestions
        const suggestionSec = document.getElementById("suggestions-section");
        suggestionSec.classList.remove("hidden");
        
        // Setup initial display inside suggestions list
        const listContainer = document.getElementById("suggestions-list");
        listContainer.innerHTML = `
            <div style="text-align: center; padding: 10px 0;">
                <button class="primary-btn" type="button" id="btn-trigger-suggestions" style="width: 100%; padding: 10px;">Generate Suggestions</button>
            </div>
        `;
        
        document.getElementById("btn-trigger-suggestions").addEventListener("click", triggerModelProcessingModal);
        
        // Set metrics to baseline
        document.getElementById("suggestion-severity").textContent = "HIGH";
        document.getElementById("suggestion-duration").textContent = "300 min";
        document.getElementById("without-action-time").textContent = "120 min";
        document.getElementById("with-plan-time").textContent = "--";

        // Load initial time index
        await setIPLTimeIndex(0);
        document.getElementById("map-tip").textContent = "Timeline loaded. Select Upcoming Events or Click 'Generate Suggestions'.";

    } catch (e) {
        console.error(e);
        document.getElementById("map-tip").textContent = "Failed to initialize IPL scenario.";
    }
}

async function setIPLTimeIndex(index) {
    state.iplIndex = index;
    const slider = document.getElementById("timeline-slider");
    slider.value = index;
    
    // Highlight ticks
    const ticks = document.querySelectorAll(".timeline-ticks .tick-label");
    ticks.forEach(tick => {
        if (parseInt(tick.getAttribute("data-val"), 10) === index) {
            tick.classList.add("active");
        } else {
            tick.classList.remove("active");
        }
    });

    const label = IPL_TIME_LABELS[index] || "5:30 PM";
    document.getElementById("current-sim-time").textContent = label;

    // Load road states from backend
    if (window.mapEngine) {
        const timelineSim = window.mapEngine.getTimelineSimulator();
        timelineSim.clearCache();
        await timelineSim.setSimTime(index);
    }
}

function triggerModelProcessingModal() {
    // Inject custom modal html
    const modal = document.createElement("div");
    modal.id = "model-processing-modal";
    modal.style = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(4, 8, 12, 0.85);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        font-family: inherit;
    `;
    
    modal.innerHTML = `
        <div style="background: linear-gradient(135deg, #09131d, #0d1a29); border: 1px solid rgba(255,255,255,0.08); padding: 30px; border-radius: 12px; width: 420px; box-shadow: 0 20px 50px rgba(0,0,0,0.5);">
            <h3 style="margin: 0 0 16px; color: #f5f7fb; font-size: 18px; text-align: center;">Running traffic impact models...</h3>
            <div id="modal-steps-list" style="display: grid; gap: 12px; color: #9eb3c8; font-size: 14px;">
                <div id="step-1" style="display: flex; align-items: center; gap: 10px;"><span class="loader-dot" style="width: 8px; height: 8px; background: #e1862d; border-radius: 50%;"></span> Analyzing event characteristics</div>
                <div id="step-2" style="display: flex; align-items: center; gap: 10px;"><span class="loader-dot" style="width: 8px; height: 8px; background: #555; border-radius: 50%;"></span> Estimating crowd movement</div>
                <div id="step-3" style="display: flex; align-items: center; gap: 10px;"><span class="loader-dot" style="width: 8px; height: 8px; background: #555; border-radius: 50%;"></span> Predicting congestion propagation</div>
                <div id="step-4" style="display: flex; align-items: center; gap: 10px;"><span class="loader-dot" style="width: 8px; height: 8px; background: #555; border-radius: 50%;"></span> Testing response strategies</div>
                <div id="step-5" style="display: flex; align-items: center; gap: 10px;"><span class="loader-dot" style="width: 8px; height: 8px; background: #555; border-radius: 50%;"></span> Generating response plan</div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);

    let currentStep = 1;
    const interval = setInterval(() => {
        const prevEl = document.getElementById(`step-${currentStep}`);
        if (prevEl) {
            prevEl.querySelector(".loader-dot").style.background = "#38d169";
            prevEl.querySelector(".loader-dot").innerHTML = "";
            prevEl.style.color = "#f3f7fb";
            prevEl.insertAdjacentHTML("afterbegin", `<i class="material-icons" style="color: #38d169; font-size: 18px; margin-right: 4px; vertical-align: middle;">check_circle</i>`);
            prevEl.removeChild(prevEl.querySelector(".loader-dot"));
        }
        
        currentStep++;
        if (currentStep <= 5) {
            const nextEl = document.getElementById(`step-${currentStep}`);
            if (nextEl) {
                nextEl.querySelector(".loader-dot").style.background = "#e1862d";
            }
        } else {
            clearInterval(interval);
            setTimeout(() => {
                document.body.removeChild(modal);
                displayIPLResponsePlan();
            }, 600);
        }
    }, 450);
}

async function displayIPLResponsePlan() {
    try {
        const plan = await timedJsonFetch("/api/ipl/suggestions");
        state.recommendationPack = plan;
        
        document.getElementById("without-action-time").textContent = `${plan.before.clearance_time_min} min`;
        document.getElementById("with-plan-time").textContent = `${plan.after.clearance_time_min} min`;

        const container = document.getElementById("suggestions-list");
        container.innerHTML = "";

        plan.suggestions.forEach(item => {
            const row = document.createElement("div");
            row.className = "suggestion-row";
            row.style.marginBottom = "8px";
            row.innerHTML = `
                <div style="margin-bottom: 6px;">
                    <strong style="color: #ffd28a; font-size: 13px;">${item.title}</strong>
                    <p style="margin: 3px 0 0; font-size: 12px; color: #9eb3c8; white-space: pre-line;">${item.description}</p>
                </div>
            `;
            container.appendChild(row);
        });

        // Add the Apply Suggested Plan button
        const applyBtnDiv = document.createElement("div");
        applyBtnDiv.style.marginTop = "14px";
        applyBtnDiv.innerHTML = `
            <button class="primary-btn" type="button" id="btn-apply-ipl-plan" style="width: 100%; padding: 10px;">Apply Suggested Plan</button>
        `;
        container.appendChild(applyBtnDiv);

        document.getElementById("btn-apply-ipl-plan").addEventListener("click", applyIPLResponsePlan);

    } catch (e) {
        console.error(e);
    }
}

async function applyIPLResponsePlan() {
    document.getElementById("map-tip").textContent = "Applying response plan... Recalculating timeline.";
    try {
        const response = await timedJsonFetch("/api/ipl/apply", { method: "POST" });
        
        // 1. Place barricades on map
        response.barricades.forEach(b => {
            addCustomBarricadeMarker(b);
            state.activeInterventions.push({
                type: "barricade",
                id: b.id,
                edge_id: "edge_stadium_env",
                road_name: b.name,
                lat: b.lat,
                lng: b.lng
            });
        });

        // 2. Place police deployments on map
        response.police.forEach(p => {
            addCustomPoliceMarker(p);
            state.activeInterventions.push({
                type: "manpower",
                id: p.id,
                edge_id: "edge_stadium_env",
                road_name: p.name,
                lat: p.lat,
                lng: p.lng,
                parameters: { officers_count: p.officers }
            });
        });

        // 3. Draw diversion routes
        if (window.mapEngine) {
            const mapObj = window.mapEngine.getMap();
            response.diversion_routes.forEach(route => {
                const line = L.polyline(route, {
                    color: "#38d169",
                    weight: 5,
                    dashArray: "10 6",
                    opacity: 0.85
                }).addTo(mapObj);
                line.bindTooltip("Recommended Diversion Bypass", { sticky: true });
                state.iplDiversionLines.push(line);
            });
            
            // Add diversion active intervention
            state.activeInterventions.push({
                type: "diversion",
                edge_id: "edge_stadium_env",
                road_name: "Infantry / Richmond Road bypass",
                closed_fully: false
            });
        }

        renderActiveActions();

        // 4. Update timeline index 3 (23:30) immediately to show changes
        await setIPLTimeIndex(3);

        // Update recovery stats
        updateCustomMetricsDisplay(response.metrics);
        document.getElementById("map-tip").textContent = "Suggested plan applied successfully! Traffic recovery improved.";

    } catch (e) {
        console.error(e);
        document.getElementById("map-tip").textContent = "Error applying plan.";
    }
}

// Visual helpers for placing barricades & police
function addCustomBarricadeMarker(b) {
    if (!window.mapEngine) return;
    const mapObj = window.mapEngine.getMap();
    const icon = L.divIcon({
        html: `<div class="map-overlay-chip" style="background: #e1862d; border-color: #ffd28a; padding: 4px 6px; font-size: 10px;"><i class="material-icons" style="font-size: 11px; vertical-align: middle; margin-right: 2px;">block</i>Barricade</div>`,
        className: "map-overlay-chip-wrap",
        iconSize: [75, 22],
        iconAnchor: [37, 11],
    });
    
    const m = L.marker([b.lat, b.lng], { icon }).addTo(mapObj);
    m.bindTooltip(b.name, { sticky: true });
    m.on("click", () => {
        // Clicking removes barricade
        mapObj.removeLayer(m);
        state.iplMarkers = state.iplMarkers.filter(item => item !== m);
        state.activeInterventions = state.activeInterventions.filter(item => item.id !== b.id);
        renderActiveActions();
        runCustomSimulationUpdate();
    });
    state.iplMarkers.push(m);
}

function addCustomPoliceMarker(p) {
    if (!window.mapEngine) return;
    const mapObj = window.mapEngine.getMap();
    const icon = L.divIcon({
        html: `<div class="map-overlay-chip" style="background: #2ea3ff; border-color: #ffd28a; padding: 4px 6px; font-size: 10px;"><i class="material-icons" style="font-size: 11px; vertical-align: middle; margin-right: 2px;">groups</i>${p.officers} Police</div>`,
        className: "map-overlay-chip-wrap",
        iconSize: [85, 22],
        iconAnchor: [42, 11],
    });
    
    const m = L.marker([p.lat, p.lng], { icon }).addTo(mapObj);
    m.bindTooltip(p.name, { sticky: true });
    m.on("click", () => {
        // Let police officer deployment be edited
        const val = prompt(`Change officer deployment count for ${p.name}:`, p.officers);
        if (val !== null) {
            const count = parseInt(val, 10) || 0;
            p.officers = count;
            mapObj.removeLayer(m);
            state.iplMarkers = state.iplMarkers.filter(item => item !== m);
            addCustomPoliceMarker(p);
            
            // Update activeInterventions count
            const act = state.activeInterventions.find(item => item.id === p.id);
            if (act) {
                act.parameters.officers_count = count;
            }
            renderActiveActions();
            runCustomSimulationUpdate();
        }
    });
    state.iplMarkers.push(m);
}

async function runCustomSimulationUpdate() {
    if (!state.iplActive) return;
    document.getElementById("map-tip").textContent = "Running custom simulation model update...";
    
    // Gather all barricades, diversions, manpower from state.activeInterventions
    const barricades = state.activeInterventions.filter(item => item.type === "barricade");
    const diversions = state.activeInterventions.filter(item => item.type === "diversion");
    const manpowerItems = state.activeInterventions.filter(item => item.type === "manpower");
    
    // Total count of officers
    const totalOfficers = manpowerItems.reduce((acc, curr) => {
        return acc + (curr.parameters?.officers_count || 10);
    }, 0);

    try {
        const payload = {
            barricades,
            diversions,
            manpower: totalOfficers
        };

        const res = await timedJsonFetch("/api/ipl/simulate/custom", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        // Update stats panel
        updateCustomMetricsDisplay(res.metrics);

        // Force Leaflet to refresh map state for the current active time step
        await setIPLTimeIndex(state.iplIndex);
        
        document.getElementById("map-tip").textContent = "Simulation updated successfully.";

    } catch (e) {
        console.error(e);
        document.getElementById("map-tip").textContent = "Error updating simulation state.";
    }
}

function updateCustomMetricsDisplay(metrics) {
    document.getElementById("summary-delay").textContent = `--`;
    document.getElementById("summary-recovery").textContent = `${metrics.clearance_time_min} min`;
    document.getElementById("with-plan-time").textContent = `${metrics.clearance_time_min} min`;
    
    // Update system status overview if visible
    const elCong = document.getElementById("metric-congestion");
    const elCritical = document.getElementById("metric-critical");
    const elFlow = document.getElementById("metric-flow");
    
    if (elCong) elCong.textContent = `${metrics.avg_congestion}%`;
    if (elCritical) elCritical.textContent = metrics.critical_roads;
    if (elFlow) elFlow.textContent = `${Math.max(0, Math.round(100 - metrics.avg_congestion))}%`;
}

function clearIPLOverlays() {
    if (window.mapEngine) {
        const mapObj = window.mapEngine.getMap();
        state.iplMarkers.forEach(m => mapObj.removeLayer(m));
        state.iplDiversionLines.forEach(l => mapObj.removeLayer(l));
    }
    state.iplMarkers = [];
    state.iplDiversionLines = [];
}

// =========================================================================
// STANDARD SCRIPTS END
// =========================================================================

function renderSelectedRoad(road) {
    const card = document.getElementById("selected-road-card");
    card.innerHTML = `
        <h3>${road.road_name}</h3>
        <div class="selected-road-meta">
            <div>Type: ${road.road_type}</div>
            <div>Congestion: ${Math.round(road.congestion_score * 100)}%</div>
            <div>Current speed: ${Math.round(road.current_speed)} km/h</div>
        </div>
    `;
}

function renderToolConfig() {
    const container = document.getElementById("tool-config");
    const target = state.selectedRoad || state.activeEvent;
    if (!state.activeTool || !target) {
        container.classList.add("hidden");
        document.getElementById("tool-status").textContent = "Select a simulated road corridor, then choose a tool.";
        return;
    }

    const targetName = target.road_name || target.location_name;
    document.getElementById("tool-status").textContent = `Target corridor: ${targetName}`;

    if (state.activeTool === "barricade") {
        container.innerHTML = `
            <div class="form-stack">
                <label><span>Restriction</span><select id="tool-reduction"><option value="25">25%</option><option value="50" selected>50%</option><option value="75">75%</option></select></label>
            </div>
            <div class="tool-config-actions">
                <button class="primary-btn" type="button" id="tool-apply">Apply Barricade</button>
            </div>
        `;
    } else if (state.activeTool === "closure") {
        container.innerHTML = `
            <div class="form-stack">
                <label><span>Closure Type</span><select id="tool-closure-type"><option value="Complete closure">Complete closure</option><option value="One side closure">One side closure</option></select></label>
            </div>
            <div class="tool-config-actions">
                <button class="primary-btn" type="button" id="tool-apply">Apply Closure</button>
            </div>
        `;
    } else if (state.activeTool === "diversion") {
        container.innerHTML = `
            <p class="empty-panel">Diversion will create an emergency-lane routing response on the selected corridor.</p>
            <div class="tool-config-actions">
                <button class="primary-btn" type="button" id="tool-apply">Apply Diversion</button>
            </div>
        `;
    } else if (state.activeTool === "manpower") {
        container.innerHTML = `
            <div class="form-stack">
                <label><span>Number of officers</span><input id="tool-officers" type="number" min="0" value="12"></label>
            </div>
            <div class="tool-config-actions">
                <button class="primary-btn" type="button" id="tool-apply">Deploy Officers</button>
            </div>
        `;
    }

    container.classList.remove("hidden");
    document.getElementById("tool-apply").addEventListener("click", () => {
        const intervention = buildToolIntervention();
        if (!intervention) return;
        upsertIntervention(intervention);
        if (state.iplActive) {
            runCustomSimulationUpdate();
        } else {
            rerunInterventionSimulation();
        }
    });
}

function buildToolIntervention() {
    const base = withTarget({ type: state.activeTool, parameters: {} });
    if (!base) return null;
    if (state.activeTool === "barricade") {
        base.parameters.reduction_pct = parseInt(document.getElementById("tool-reduction").value, 10);
    } else if (state.activeTool === "closure") {
        base.type = "closure";
        base.parameters.closure_type = document.getElementById("tool-closure-type").value;
    } else if (state.activeTool === "diversion") {
        base.type = "closure";
        base.parameters.closure_type = "Emergency lane open";
    } else if (state.activeTool === "manpower") {
        base.type = "manpower";
        base.parameters.officers_count = parseInt(document.getElementById("tool-officers").value, 10) || 0;
        base.parameters.purpose = "Traffic regulation";
    }
    return base;
}

function withTarget(intervention) {
    const target = state.selectedRoad || state.activeEvent;
    if (!target) return null;
    const coordinates = target === state.selectedRoad ? null : (state.activeEvent?.location || null);
    return {
        ...intervention,
        edge_id: target.edge_id,
        road_name: target.road_name,
        coordinates,
    };
}

function upsertIntervention(intervention) {
    const key = `${intervention.type}:${intervention.edge_id}`;
    const existingIndex = state.activeInterventions.findIndex((item) => `${item.type}:${item.edge_id}` === key);
    if (existingIndex >= 0) {
        state.activeInterventions[existingIndex] = intervention;
    } else {
        state.activeInterventions.push(intervention);
    }
    renderActiveActions();
}

function renderActiveActions() {
    const list = document.getElementById("active-actions-list");
    if (!state.activeInterventions.length) {
        list.className = "action-list empty";
        list.textContent = "No active interventions";
        return;
    }
    list.className = "action-list";
    list.innerHTML = "";
    state.activeInterventions.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "action-row";
        row.innerHTML = `
            <div>
                <strong>${formatIntervention(item)}</strong>
                <p>${item.road_name || state.activeEvent?.road_name || "Selected corridor"}</p>
            </div>
            <button class="mini-btn" type="button">Remove</button>
        `;
        row.querySelector("button").addEventListener("click", () => {
            state.activeInterventions.splice(index, 1);
            renderActiveActions();
            if (state.iplActive) {
                runCustomSimulationUpdate();
            } else {
                rerunInterventionSimulation();
            }
        });
        list.appendChild(row);
    });
}

function formatIntervention(item) {
    if (item.type === "barricade") return `Barricade ${item.parameters?.reduction_pct || 0}%`;
    if (item.type === "manpower") return `${item.parameters?.officers_count || 0} officers`;
    if (item.parameters?.closure_type) return item.parameters.closure_type;
    return item.type;
}

async function rerunInterventionSimulation() {
    if (!window.mapEngine) return;
    window.mapEngine.renderInterventions(state.activeInterventions);
    if (!state.activeInterventions.length) {
        updatePlanEffect(null);
        if (state.activeEvent?.scenario_key) {
            await replayEventTimeline();
        }
        return;
    }

    try {
        const data = await timedJsonFetch("/api/intervention/simulate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ interventions: state.activeInterventions }),
        });
        await timedJsonFetch("/api/intervention/apply", { method: "POST" });
        updatePlanEffect(data);
        const timeline = window.mapEngine.getTimelineSimulator();
        timeline.clearCache();
        await timeline.setSimTime(0);
        await refreshCityOverview();
    } catch (error) {
        console.error(error);
        updatePlanEffect(null, "Intervention simulation took too long. Visual markers were kept, but no recalculated recovery is available yet.");
    }
}

async function replayEventTimeline() {
    if (!state.activeEvent?.scenario_key) return;
    try {
        const refreshed = await timedJsonFetch("/api/events/simulate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scenario_key: state.activeEvent.scenario_key }),
        });
        state.activeEvent = refreshed;
        const timeline = window.mapEngine.getTimelineSimulator();
        timeline.clearCache();
        await timeline.setSimTime(0);
        await refreshCityOverview();
    } catch (error) {
        console.error(error);
    }
}

function updatePlanEffect(data, message = "") {
    const panel = document.getElementById("plan-effect");
    if (!data && !message) {
        panel.classList.add("hidden");
        panel.textContent = "";
        return;
    }
    panel.classList.remove("hidden");
    if (message) {
        panel.textContent = message;
        return;
    }
    panel.innerHTML = `
        Before: ${data.before.clearance_time_min} min | After: ${data.after.clearance_time_min} min<br>
        Congestion reduction: ${data.metrics.congestion_reduction_pct}% | Improved roads: ${data.metrics.improved_roads_count}
    `;
}

async function resetSimulation() {
    try {
        await timedJsonFetch("/api/events/reset", { method: "POST" });
    } catch (error) {
        console.error(error);
    }
    state.selectedRoad = null;
    state.activeEvent = null;
    state.activeInterventions = [];
    state.recommendationPack = null;
    state.activeTool = null;
    state.iplActive = false;
    clearIPLOverlays();
    
    document.getElementById("simulation-empty").classList.remove("hidden");
    document.getElementById("simulation-summary").classList.add("hidden");
    document.getElementById("suggestions-section").classList.add("hidden");
    document.getElementById("selected-road-card").textContent = "Click a road corridor on the map to inspect live flow and target interventions.";
    document.getElementById("map-tip").textContent = "Operational road network loaded. Select an event to analyze traffic impact.";
    document.querySelectorAll(".tool-btn").forEach((button) => button.classList.remove("active"));
    document.getElementById("tool-config").classList.add("hidden");
    document.getElementById("suggestion-severity").textContent = "--";
    document.getElementById("suggestion-duration").textContent = "--";
    
    // Restore default timeline slider parameters
    const slider = document.getElementById("timeline-slider");
    slider.min = "0";
    slider.max = "120";
    slider.step = "15";
    slider.value = "0";

    const ticksContainer = document.querySelector(".timeline-ticks");
    ticksContainer.innerHTML = `
        <span class="tick-label active" data-val="0">0 min</span>
        <span class="tick-label" data-val="15">15</span>
        <span class="tick-label" data-val="30">30</span>
        <span class="tick-label" data-val="45">45</span>
        <span class="tick-label" data-val="60">60</span>
        <span class="tick-label" data-val="120">120</span>
    `;

    // Rebind standard clicks
    ticksContainer.querySelectorAll(".tick-label").forEach(tick => {
        tick.addEventListener("click", () => {
            const val = parseInt(tick.getAttribute("data-val"), 10);
            if (window.mapEngine) {
                window.mapEngine.getTimelineSimulator().setSimTime(val);
            }
        });
    });

    renderActiveActions();
    updatePlanEffect(null);
    if (window.mapEngine) window.mapEngine.clearScenario();
    await refreshCityOverview();
}

async function timedJsonFetch(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}
