// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
    selectedRoad:        null,
    selectedEventIds:    new Set(),
    citySimResult:       null,
    cityTimelinePhase:   0,
    focusedEventId:      null,
    activeInterventions: [],
    activeTool:          null,
    overlayMarkers:      [],
    overlayLines:        [],
    commandEvents:              [],
    activeEventTab:             "ACTIVE",
    incidentPickerMode:         false,
    incidentPickerCoords:       null,
    incidentPickerLocationName: null,
    simScenarios: { active: "impact", responseApplied: false, manualApplied: false },
};

const simPlaybackState = { playing: false, speed: 1, timer: null };

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("dashboard-body");

    startClock();
    initRightPaneTabs();
    initIntvTools();
    bindGlobalEvents();
    initDispatchButtons();
    _initTimelineSpeedBar();

    document.getElementById("btn-update-simulation")
        ?.addEventListener("click", _runManualSimulation);

    loadGisEvents();
    refreshBaselineCityOverview();
    setInterval(refreshBaselineCityOverview, 15000);
});

// ─────────────────────────────────────────────────────────────────────────────
// LIVE CLOCK
// ─────────────────────────────────────────────────────────────────────────────
function startClock() {
    function tick() {
        const now = new Date();
        const el  = document.getElementById("cc-clock");
        if (el) el.textContent =
            `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
    }
    tick();
    setInterval(tick, 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// RIGHT PANEL TABS
// ─────────────────────────────────────────────────────────────────────────────
function initRightPaneTabs() {
    document.querySelectorAll(".rp-tab").forEach((btn) => {
        btn.addEventListener("click", () => switchRightPane(btn.dataset.pane));
    });
}

function switchRightPane(paneName) {
    const labels = {
        analysis: "ANALYSIS",
        response: "RESPONSE PLAN",
        units:    "FIELD UNITS",
        tools:    "INTERVENTION TOOLS",
        inspector:"ROAD INSPECTOR",
    };
    document.querySelectorAll(".rp-tab").forEach((t) =>
        t.classList.toggle("active", t.dataset.pane === paneName)
    );
    document.querySelectorAll(".rp-pane").forEach((p) =>
        p.classList.toggle("active", p.id === `rp-${paneName}`)
    );
    const lb = document.getElementById("rp-tab-label-bar");
    if (lb) lb.textContent = labels[paneName] || paneName.toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// LOAD EVENTS → GIS LIST WITH TABS
// ─────────────────────────────────────────────────────────────────────────────
async function loadGisEvents() {
    try {
        const data = await timedJsonFetch("/api/command/events", {}, 10000);
        state.commandEvents = Array.isArray(data.events) ? data.events : [];

        const elMetric = document.getElementById("metric-events");
        if (elMetric) elMetric.textContent = data.total_count ?? 0;

        const elActive = document.getElementById("cs-active-events");
        if (elActive) elActive.textContent = data.active_count ?? "—";

        _updateTabCounts();
        _renderCurrentTab();
    } catch (err) {
        console.error("[CC] loadGisEvents failed:", err);
        const el = document.getElementById("gis-event-list");
        if (el) el.innerHTML = `<div class="gis-loading">Failed to load — ${err.message}</div>`;
    }
}

function switchEventTab(status) {
    state.activeEventTab = status;
    document.getElementById("tab-active")  ?.classList.toggle("active", status === "ACTIVE");
    document.getElementById("tab-upcoming")?.classList.toggle("active", status === "UPCOMING");
    _renderCurrentTab();
}

function _updateTabCounts() {
    const ac = state.commandEvents.filter(e => e.status === "ACTIVE").length;
    const uc = state.commandEvents.filter(e => e.status === "UPCOMING").length;
    const taC = document.getElementById("tab-active-count");
    const tuC = document.getElementById("tab-upcoming-count");
    if (taC) taC.textContent = ac;
    if (tuC) tuC.textContent = uc;
}

function _renderCurrentTab() {
    const filtered = state.commandEvents.filter(e => e.status === state.activeEventTab);
    renderGisEventList(filtered);
}

function _fmtEventTime(ev) {
    const fmt = (s) => {
        if (!s) return "";
        try {
            const d = new Date(s.replace(" ", "T"));
            if (isNaN(d)) return s.slice(11, 16) || "";
            return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
        } catch { return ""; }
    };
    const start = fmt(ev.start_datetime);
    const end   = fmt(ev.end_datetime);
    if (!start) return "";
    return end ? `${start}–${end}` : start;
}

function renderGisEventList(events) {
    const container = document.getElementById("gis-event-list");
    if (!container) return;

    const label = state.activeEventTab === "ACTIVE" ? "active" : "upcoming";
    if (!events || !events.length) {
        container.innerHTML = `<div class="gis-loading">No ${label} events</div>`;
        return;
    }

    container.innerHTML = "";
    events.forEach((ev) => {
        const item = document.createElement("div");
        item.className = "gis-event-item";
        if (state.selectedEventIds.has(ev.id)) item.classList.add("checked");
        item.dataset.id = ev.id;

        const sevClass = { HIGH: "sev-high", MEDIUM: "sev-med", LOW: "sev-low" }[ev.severity] || "sev-med";
        const isActive = ev.status === "ACTIVE";
        const activateBtn = !isActive
            ? `<button class="evt-action-btn evt-activate-btn" title="Mark Active" onclick="activateEvent(${ev.id},event)">▶</button>`
            : "";

        const timeStr = _fmtEventTime(ev);
        item.innerHTML = `
            <label class="gis-evt-checkbox-label">
                <input type="checkbox" class="gis-evt-checkbox" data-id="${ev.id}" ${state.selectedEventIds.has(ev.id) ? "checked" : ""}>
                <span class="gis-evt-check-box"></span>
            </label>
            <div class="gis-evt-body">
                <div class="gis-evt-top">
                    <span class="gis-evt-name">${ev.event_name}</span>
                    <span class="event-item-sev ${sevClass}">${ev.severity || "MED"}</span>
                </div>
                <span class="gis-evt-sub">${ev.location_name || "—"}${timeStr ? `<span class="evt-time-tag"> · ${timeStr}</span>` : ""}</span>
            </div>
            <div class="gis-evt-actions">
                ${activateBtn}
                <button class="evt-action-btn evt-remove-btn" title="Remove" onclick="removeEvent(${ev.id},event)">×</button>
            </div>
        `;

        item.querySelector(".gis-evt-checkbox").addEventListener("change", (e) => {
            const id = parseInt(item.dataset.id, 10);
            if (e.target.checked) { state.selectedEventIds.add(id); item.classList.add("checked"); }
            else                  { state.selectedEventIds.delete(id); item.classList.remove("checked"); }
            updateSelectedCount();
        });

        item.querySelector(".gis-evt-body").addEventListener("click", () => {
            const ev2 = state.commandEvents.find(e => e.id === parseInt(item.dataset.id, 10));
            if (ev2?.latitude && ev2?.longitude && window.mapEngine) {
                window.mapEngine.getMap().flyTo([ev2.latitude, ev2.longitude], 14, { duration: 0.9 });
                placeTypedEventMarker(ev2, 0, ev2.severity);
            }
        });

        container.appendChild(item);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT CRUD ACTIONS
// ─────────────────────────────────────────────────────────────────────────────
async function removeEvent(id, evt) {
    evt.stopPropagation();
    try {
        const res = await fetch(`/api/events/delete/${id}`, { method: "DELETE" });
        if (!res.ok) return;
        state.commandEvents = state.commandEvents.filter(e => e.id !== id);
        state.selectedEventIds.delete(id);
        _updateTabCounts();
        _renderCurrentTab();
        updateSelectedCount();
        logAction("Event removed", `ID ${id}`);
    } catch (e) { console.error(e); }
}

async function activateEvent(id, evt) {
    evt.stopPropagation();
    try {
        const res = await fetch(`/api/events/update/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "ACTIVE" }),
        });
        if (!res.ok) return;
        const idx = state.commandEvents.findIndex(e => e.id === id);
        if (idx >= 0) state.commandEvents[idx].status = "ACTIVE";
        _updateTabCounts();
        _renderCurrentTab();
        logAction("Event activated", `ID ${id}`);
    } catch (e) { console.error(e); }
}

function toggleAddEventForm() {
    const form = document.getElementById("add-event-form");
    if (!form) return;
    const visible = form.style.display !== "none";
    if (visible) {
        cancelIncidentPick();
    } else {
        form.style.display = "flex";
        _resetIncidentForm();
    }
}

function _resetIncidentForm() {
    state.incidentPickerMode  = false;
    state.incidentPickerCoords = null;
    const s1 = document.getElementById("incident-step-1");
    const s2 = document.getElementById("incident-step-2");
    if (s1) s1.style.display = "";
    if (s2) s2.style.display = "none";
    const prev = document.getElementById("evt-location-preview");
    if (prev) prev.style.display = "none";
    const btn = document.getElementById("btn-pin-location");
    if (btn) { btn.classList.remove("active"); btn.innerHTML = '<i class="material-icons">place</i> Click map to pin location'; }
    const desc = document.getElementById("evt-input-desc");
    if (desc) desc.value = "";
    const tip = document.getElementById("map-tip");
    if (tip) tip.textContent = "Operational road network loaded. Select events to analyze city impact.";
}

function startIncidentLocationPick() {
    state.incidentPickerMode = true;
    const btn = document.getElementById("btn-pin-location");
    if (btn) { btn.classList.add("active"); btn.innerHTML = '<i class="material-icons">my_location</i> Click anywhere on map…'; }
    const tip = document.getElementById("map-tip");
    if (tip) tip.textContent = "📍 Incident report mode — click the road or location on the map";
    if (window.mapEngine) window.mapEngine.getMap().getContainer().style.cursor = "crosshair";
}

function cancelIncidentPick() {
    const form = document.getElementById("add-event-form");
    if (form) form.style.display = "none";
    _resetIncidentForm();
    if (window.mapEngine) window.mapEngine.getMap().getContainer().style.cursor = "";
}

async function submitAddEvent() {
    const coords = state.incidentPickerCoords;
    if (!coords) { startIncidentLocationPick(); return; }

    const type     = document.getElementById("evt-input-type")?.value || "Accident";
    const severity = document.getElementById("evt-input-severity")?.value || "MEDIUM";
    const desc     = document.getElementById("evt-input-desc")?.value.trim() || "";
    const location = state.incidentPickerLocationName || `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
    const now      = new Date();
    const iso      = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:00`;
    const name     = type === "Others" ? "Incident Report" : type;

    try {
        const res = await fetch("/api/events/add", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                event_name:     name,
                event_type:     type,
                event_category: "INCIDENT",
                location_name:  location,
                latitude:       coords.lat,
                longitude:      coords.lng,
                severity,
                status:         "ACTIVE",
                description:    desc,
                start_datetime: iso,
            }),
        });
        if (!res.ok) return;
        const data = await res.json();
        state.commandEvents.push(data.event);
        _updateTabCounts();
        cancelIncidentPick();
        switchEventTab("ACTIVE");
        placeTypedEventMarker(data.event, 0, severity);
        logAction("Incident reported", `${name} · ${location}`);
    } catch (e) { console.error(e); }
}

function updateSelectedCount() {
    const n   = state.selectedEventIds.size;
    const el  = document.getElementById("gis-selected-count");
    const btn = document.getElementById("btn-run-city-sim");
    if (el)  el.textContent = n === 0 ? "Select events above" : `${n} event${n > 1 ? "s" : ""} selected`;
    if (btn) btn.disabled   = n === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// CITY SIMULATION
// ─────────────────────────────────────────────────────────────────────────────
async function runCitySimulation() {
    if (!state.selectedEventIds.size) return;

    const btn = document.getElementById("btn-run-city-sim");
    const statusEl = document.getElementById("gis-sim-status");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="material-icons">hourglass_top</i> Running…'; }
    if (statusEl) statusEl.textContent = "Analyzing city impact…";

    const tip = document.getElementById("map-tip");
    if (tip) tip.textContent = "Running multi-event city simulation…";

    // Show brief loading state in analysis pane
    const loadingEl = document.getElementById("sim-city-loading");
    const emptyEl   = document.getElementById("simulation-empty");
    const resultsEl = document.getElementById("simulation-results");
    if (emptyEl)   emptyEl.classList.add("hidden");
    if (resultsEl) resultsEl.classList.add("hidden");
    if (loadingEl) loadingEl.classList.remove("hidden");
    switchRightPane("analysis");

    try {
        const result = await timedJsonFetch(
            "/api/simulation/run-city",
            {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ events: Array.from(state.selectedEventIds) }),
            },
            45000
        );

        state.citySimResult     = result;
        state.cityTimelinePhase = 0;

        // Populate city overview
        updateCityOverviewPanel(result.city_status);

        // Place typed event markers for all selected events
        clearOverlays();
        result.event_impacts.forEach((imp) => {
            const ev = state.commandEvents.find((e) => e.id === imp.event_id);
            if (ev) placeTypedEventMarker(ev, imp.impact_score, imp.severity_level);
        });

        // Show Results section
        const secResults = document.getElementById("sec-results");
        if (secResults) secResults.classList.remove("gis-section-hidden");

        // Render results
        renderEventImpactList(result.event_impacts);
        renderResponsePlan(result.response_plan);

        // Hide loading state, show results
        if (loadingEl) loadingEl.classList.add("hidden");

        // Update right panel Analysis with city overview
        renderCityAnalysisPane(result);
        _injectScenarioToggle();

        // Setup and show city-wide timeline
        setupCityTimeline(result.city_timeline);
        setCityTimelinePhase(0);
        applyTimelineVisibility(true);

        // Show reset button, hide run button
        const resetBtn = document.getElementById("btn-reset-city-sim");
        if (btn)      btn.style.display = "none";
        if (resetBtn) resetBtn.style.display = "flex";
        if (statusEl) statusEl.textContent = `${result.event_impacts.length} events analysed`;

        switchRightPane("analysis");
        if (tip) tip.textContent =
            `City simulation complete · Avg congestion: ${result.city_status.avg_congestion_pct}% · `+
            `${result.event_impacts.length} events · Click impact items for per-event details`;

    } catch (err) {
        console.error("[CC] runCitySimulation failed:", err);
        if (loadingEl) loadingEl.classList.add("hidden");
        if (emptyEl)   emptyEl.classList.remove("hidden");
        const errMsg = err.message || "Unknown error";
        if (statusEl) statusEl.textContent = `Simulation failed: ${errMsg}`;
        if (tip) tip.textContent = `Simulation failed — ${errMsg}`;
    } finally {
        if (btn && btn.style.display !== "none") {
            btn.disabled  = false;
            btn.innerHTML = '<i class="material-icons">play_circle</i> Run City Simulation';
        }
    }
}

function resetCitySimulation() {
    state.citySimResult     = null;
    state.cityTimelinePhase = 0;
    state.focusedEventId    = null;
    state.selectedEventIds.clear();
    state.activeInterventions = [];
    state.simScenarios = { active: "impact", responseApplied: false, manualApplied: false };
    _stopAutoPlay();
    document.getElementById("scenario-toggle-bar")?.remove();
    document.getElementById("plan-effect")?.classList.add("hidden");

    // Reset checkboxes
    document.querySelectorAll(".gis-evt-checkbox").forEach((cb) => { cb.checked = false; });
    document.querySelectorAll(".gis-event-item").forEach((el) => el.classList.remove("checked"));
    updateSelectedCount();

    // Clear map
    clearOverlays();
    if (window.mapEngine) window.mapEngine.clearScenario();
    applyTimelineVisibility(false);

    // Hide results
    const secResults = document.getElementById("sec-results");
    if (secResults) secResults.classList.add("gis-section-hidden");

    // Reset city overview
    const ids = ["cs-active-events", "cs-avg-congestion", "cs-critical-roads", "cs-officers", "cs-recovery"];
    ids.forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = "—"; });

    // Reset header metrics
    ["metric-congestion", "metric-speed", "metric-critical", "metric-flow"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = "--";
    });

    // Reset right panel
    const simEmpty = document.getElementById("simulation-empty");
    const simRes   = document.getElementById("simulation-results");
    if (simEmpty) simEmpty.classList.remove("hidden");
    if (simRes)   simRes.classList.add("hidden");

    // Toggle buttons
    const runBtn   = document.getElementById("btn-run-city-sim");
    const resetBtn = document.getElementById("btn-reset-city-sim");
    if (runBtn)   { runBtn.style.display = "flex"; runBtn.disabled = true; runBtn.innerHTML = '<i class="material-icons">play_circle</i> Run City Simulation'; }
    if (resetBtn) resetBtn.style.display = "none";

    const statusEl = document.getElementById("gis-sim-status");
    if (statusEl) statusEl.textContent = "";

    const tip = document.getElementById("map-tip");
    if (tip) tip.textContent = "Operational road network loaded. Select events to analyze city impact.";

    switchRightPane("analysis");
    refreshBaselineCityOverview();
}

// ─────────────────────────────────────────────────────────────────────────────
// CITY OVERVIEW PANEL
// ─────────────────────────────────────────────────────────────────────────────
function updateCityOverviewPanel(cs) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("cs-active-events", cs.active_event_count);
    set("cs-avg-congestion", `${cs.avg_congestion_pct}%`);
    set("cs-critical-roads", cs.critical_road_count);
    set("cs-officers", cs.officers_required);
    set("cs-recovery", `${cs.recovery_est_min} min`);

    // Also update header metrics
    const elCong = document.getElementById("metric-congestion");
    const elCrit = document.getElementById("metric-critical");
    const elEvts = document.getElementById("metric-events");
    if (elCong) elCong.textContent = `${cs.avg_congestion_pct}%`;
    if (elCrit) elCrit.textContent = cs.critical_road_count;
    if (elEvts) elEvts.textContent = cs.active_event_count;
}

async function refreshBaselineCityOverview() {
    if (state.citySimResult) return;
    try {
        const data = await timedJsonFetch("/api/city/state", {}, 8000);
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set("metric-flow",        `${Math.round(data.city_flow)}%`);
        set("metric-congestion",  `${Math.round(data.avg_congestion)}%`);
        set("metric-critical",    data.critical_roads);
        set("metric-speed",       `${data.avg_speed} km/h`);
        set("metric-state",
            data.avg_congestion > 60 ? "Critical" : data.avg_congestion > 35 ? "Heavy" : "Monitoring");
        set("cs-avg-congestion",  `${Math.round(data.avg_congestion)}%`);
        set("cs-critical-roads",  data.critical_roads);
    } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// RIGHT PANEL — ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────
function renderCityAnalysisPane(result) {
    const cs  = result.city_status;
    const tl  = result.city_timeline || [];
    const pln = result.response_plan;

    const simEmpty = document.getElementById("simulation-empty");
    const simRes   = document.getElementById("simulation-results");
    if (simEmpty) simEmpty.classList.add("hidden");
    if (simRes)   simRes.classList.remove("hidden");

    // Reuse ml-metrics-grid to show city-level overview
    const impEl  = document.getElementById("ml-impact");
    const sevEl  = document.getElementById("ml-severity");
    const clrEl  = document.getElementById("ml-clearance");
    const mpEl   = document.getElementById("ml-manpower");
    if (impEl) impEl.textContent  = `${cs.avg_congestion_pct}%`;
    if (sevEl) { sevEl.textContent = `${cs.active_event_count} events`; sevEl.className = "tile-val"; }
    if (clrEl) clrEl.textContent  = `${cs.recovery_est_min} min`;
    if (mpEl)  mpEl.textContent   = cs.officers_required;

    // Update labels to reflect city context
    const labels = document.querySelectorAll("#simulation-results .tile-label");
    const labelTexts = ["Avg Congestion", "Active Events", "Recovery Est.", "Officers Req."];
    labels.forEach((l, i) => { if (labelTexts[i]) l.textContent = labelTexts[i]; });

    // Flags: closures & diversions
    const closures   = pln.closures_required;
    const diversions = pln.diversions_required;
    const avgBarricade = pln.avg_barricade_pct ?? 0;
    const flagBarricade = document.getElementById("flag-barricade");
    if (flagBarricade) {
        flagBarricade.classList.toggle("flag-required",     avgBarricade > 0);
        flagBarricade.classList.toggle("flag-not-required", avgBarricade === 0);
        const v = document.getElementById("flag-barricade-val");
        if (v) v.textContent = avgBarricade > 0 ? `${Math.round(avgBarricade)}%` : "None";
    }
    const flagClosure   = document.getElementById("flag-closure");
    const flagDiversion = document.getElementById("flag-diversion");
    if (flagClosure) {
        flagClosure.classList.toggle("flag-required",     closures > 0);
        flagClosure.classList.toggle("flag-not-required", closures === 0);
        const v = document.getElementById("flag-closure-val");
        if (v) v.textContent = closures > 0 ? `${closures} site${closures > 1 ? "s" : ""}` : "None";
    }
    if (flagDiversion) {
        flagDiversion.classList.toggle("flag-required",     diversions > 0);
        flagDiversion.classList.toggle("flag-not-required", diversions === 0);
        const v = document.getElementById("flag-diversion-val");
        if (v) v.textContent = diversions > 0 ? `${diversions} route${diversions > 1 ? "s" : ""}` : "None";
    }

    // Timeline phases
    renderCityTimelinePhases(tl);

    // Reset button
    const resetBtn = document.getElementById("btn-reset-simulation");
    if (resetBtn) resetBtn.onclick = resetCitySimulation;
}

function renderCityTimelinePhases(tl) {
    const el = document.getElementById("timeline-phase-list");
    if (!el || !tl?.length) return;
    el.innerHTML = tl.map((phase, i) => {
        const ts  = phase.timestamp || phase.label;
        const min = phase.minutes_from_start ?? phase.minutes ?? 0;
        const sub = min === 0 ? "Event Start" : `+${min} min`;
        return `
        <div class="tl-phase-row${i === 0 ? " active-phase" : ""}" data-phase="${i}"
             onclick="setCityTimelinePhase(${i})">
            <span class="tl-phase-dot"></span>
            <div class="tl-phase-label-group">
                <span class="tl-phase-label">${ts}</span>
                <span class="tl-phase-sublabel">${sub}</span>
            </div>
            <span class="tl-phase-stats">${phase.avg_congestion}% · ${phase.critical_roads} crit.</span>
        </div>`;
    }).join("");
}

function renderFocusedEventDetails(imp) {
    const simEmpty = document.getElementById("simulation-empty");
    const simRes   = document.getElementById("simulation-results");
    if (simEmpty) simEmpty.classList.add("hidden");
    if (simRes)   simRes.classList.remove("hidden");

    const impEl  = document.getElementById("ml-impact");
    const sevEl  = document.getElementById("ml-severity");
    const clrEl  = document.getElementById("ml-clearance");
    const mpEl   = document.getElementById("ml-manpower");
    const labels = document.querySelectorAll("#simulation-results .tile-label");

    if (impEl) impEl.textContent  = `${Math.round(imp.impact_score)} / 100`;
    if (sevEl) {
        sevEl.textContent = imp.severity_level;
        sevEl.className   = `tile-val sev-text--${(imp.severity_level||"medium").toLowerCase()}`;
    }
    if (clrEl) clrEl.textContent  = `${imp.clearance_time} min`;
    if (mpEl)  mpEl.textContent   = imp.manpower_required;

    const labelTexts = ["Impact Score", "Severity", "Clearance", "Officers Req."];
    labels.forEach((l, i) => { if (labelTexts[i]) l.textContent = labelTexts[i]; });

    const barricadePct = imp.barricade_percentage ?? 0;
    const flagBarricade2 = document.getElementById("flag-barricade");
    if (flagBarricade2) {
        flagBarricade2.classList.toggle("flag-required",     barricadePct > 0);
        flagBarricade2.classList.toggle("flag-not-required", barricadePct === 0);
        const v = document.getElementById("flag-barricade-val"); if (v) v.textContent = barricadePct > 0 ? `${Math.round(barricadePct)}%` : "None";
    }
    const flagClosure2   = document.getElementById("flag-closure");
    const flagDiversion2 = document.getElementById("flag-diversion");
    if (flagClosure2) {
        flagClosure2.classList.toggle("flag-required",     !!imp.closure_required);
        flagClosure2.classList.toggle("flag-not-required", !imp.closure_required);
        const v = document.getElementById("flag-closure-val"); if (v) v.textContent = imp.closure_required ? "Required" : "None";
    }
    if (flagDiversion2) {
        flagDiversion2.classList.toggle("flag-required",     !!imp.diversion_required);
        flagDiversion2.classList.toggle("flag-not-required", !imp.diversion_required);
        const v = document.getElementById("flag-diversion-val"); if (v) v.textContent = imp.diversion_required ? "Required" : "None";
    }

    // Also populate the Response tab with per-event recommendations
    _renderSingleEventRecommendations(imp);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT IMPACT LIST
// ─────────────────────────────────────────────────────────────────────────────
function renderEventImpactList(impacts) {
    const el = document.getElementById("event-impact-list");
    if (!el) return;
    el.innerHTML = impacts.map((imp, i) => {
        const sevClass = { HIGH: "sev-high", CRITICAL: "sev-high", MEDIUM: "sev-med", LOW: "sev-low" }[imp.severity_level] || "sev-med";
        const scoreBar = Math.round(imp.impact_score);
        const overlapBadge = imp.overlap_detected ? `<span class="overlap-badge">⚠ overlap</span>` : "";
        return `
        <div class="impact-item" data-impact-id="${imp.event_id}" onclick="focusImpactEvent(${imp.event_id})">
            <div class="impact-item-rank">${i + 1}</div>
            <div class="impact-item-body">
                <div class="impact-item-top">
                    <span class="impact-item-name">${imp.event_name}</span>
                    <span class="event-item-sev ${sevClass}">${imp.severity_level}</span>
                </div>
                <div class="impact-item-meta">${imp.location_name || "—"} ${overlapBadge}</div>
                <div class="impact-score-bar"><div class="impact-score-fill" style="width:${scoreBar}%"></div></div>
                <div class="impact-item-stats">
                    <span>${scoreBar}/100 impact</span>
                    <span>${imp.manpower_required} officers</span>
                    <span>${imp.clearance_time} min</span>
                </div>
            </div>
        </div>`;
    }).join("");
}

function _renderSingleEventRecommendations(imp) {
    const rpEmpty   = document.getElementById("rp-response-empty");
    const rpContent = document.getElementById("rp-response-content");
    if (rpEmpty)   rpEmpty.classList.add("hidden");
    if (rpContent) rpContent.classList.remove("hidden");

    const suggList = document.getElementById("suggestions-list");
    if (suggList) {
        const tp   = imp.tactical_plan || {};
        const rows = [];

        // ── MANPOWER ──────────────────────────────────────────────────────
        const mp = tp.manpower;
        if (mp && mp.deployment && mp.deployment.length) {
            rows.push(`<div class="sugg-section-label">MANPOWER — ${mp.total} Officers</div>`);
            mp.deployment.forEach(d => {
                rows.push(`<div class="suggestion-item">
                    <span class="sugg-bullet" style="color:#f59e0b;">▸</span>
                    <div><strong>${d.officers} off.</strong> — ${d.location}
                    <br><span class="sugg-detail">${d.role}${d.distance_km > 0 ? ` · ${d.distance_km} km` : ""}</span></div>
                </div>`);
            });
        } else {
            rows.push(`<div class="suggestion-item"><span class="sugg-bullet" style="color:#f59e0b;">▸</span><div><strong>${imp.manpower_required} officers</strong> at ${imp.location_name || "event site"}</div></div>`);
        }

        // ── BARRICADES ────────────────────────────────────────────────────
        const bar = tp.barricades;
        if (bar && bar.intensity_pct > 0) {
            rows.push(`<div class="sugg-section-label">BARRICADING — ${Math.round(bar.intensity_pct)}% Intensity</div>`);
            (bar.points || []).forEach(p => {
                rows.push(`<div class="suggestion-item">
                    <span class="sugg-bullet" style="color:#e1862d;">▸</span>
                    <div><strong>${p.location}</strong> — ${p.control_pct}% control
                    <br><span class="sugg-detail">${p.reason}</span></div>
                </div>`);
            });
        } else if (!bar || bar.intensity_pct === 0) {
            rows.push(`<div class="suggestion-item"><span class="sugg-bullet" style="color:#3d5a72;">▸</span><div><strong>Barricading:</strong> Not required</div></div>`);
        }

        // ── CLOSURE ───────────────────────────────────────────────────────
        const cl = tp.closures;
        if (cl && cl.required && cl.segments && cl.segments.length) {
            rows.push(`<div class="sugg-section-label">ROAD CLOSURE</div>`);
            cl.segments.forEach(s => {
                rows.push(`<div class="suggestion-item">
                    <span class="sugg-bullet" style="color:#ef4444;">▸</span>
                    <div><strong>${s.road}</strong>
                    <br><span class="sugg-detail">${s.from_junction} → ${s.to_junction}</span>
                    <br><span class="sugg-detail">${s.reason}</span>
                    ${s.duration ? `<br><span class="sugg-detail" style="color:#94a3b8;">${s.duration}</span>` : ""}</div>
                </div>`);
            });
        } else {
            rows.push(`<div class="suggestion-item"><span class="sugg-bullet" style="color:#3d5a72;">▸</span><div><strong>Road Closure:</strong> Not required</div></div>`);
        }

        // ── DIVERSION ─────────────────────────────────────────────────────
        const dv = tp.diversions;
        if (dv && dv.required && dv.routes && dv.routes.length) {
            rows.push(`<div class="sugg-section-label">DIVERSION ROUTES</div>`);
            dv.routes.forEach(r => {
                rows.push(`<div class="suggestion-item">
                    <span class="sugg-bullet" style="color:#38bdf8;">▸</span>
                    <div><strong>${r.affected_road}</strong>
                    <br><span class="sugg-detail">Via: ${r.via.join(" → ")}</span>
                    <br><span class="sugg-detail">${r.reason}</span>
                    ${r.distance_added_km ? `<br><span class="sugg-detail" style="color:#94a3b8;">+${r.distance_added_km} km</span>` : ""}</div>
                </div>`);
            });
        } else {
            rows.push(`<div class="suggestion-item"><span class="sugg-bullet" style="color:#3d5a72;">▸</span><div><strong>Diversion:</strong> Not required</div></div>`);
        }

        suggList.innerHTML = rows.join("");
    }

    const woTime = document.getElementById("without-action-time");
    const wTime  = document.getElementById("with-plan-time");
    if (woTime) woTime.textContent = `${imp.clearance_time} min`;
    if (wTime)  wTime.textContent  = `${Math.round(imp.clearance_time * 0.65)} min`;
}

function focusImpactEvent(eventId) {
    state.focusedEventId = eventId;

    // Highlight in list
    document.querySelectorAll(".impact-item").forEach((el) => {
        el.classList.toggle("active", parseInt(el.dataset.impactId, 10) === eventId);
    });

    // Show per-event ML details in right panel
    const imp = state.citySimResult?.event_impacts?.find((i) => i.event_id === eventId);
    if (imp) {
        renderFocusedEventDetails(imp);
        switchRightPane("analysis");
    }

    // Fly to event on map
    const ev = state.commandEvents.find((e) => e.id === eventId);
    if (ev && ev.latitude && window.mapEngine) {
        window.mapEngine.getMap().flyTo([ev.latitude, ev.longitude], 14, { duration: 0.9 });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE PLAN
// ─────────────────────────────────────────────────────────────────────────────
function renderResponsePlan(plan) {
    const el = document.getElementById("response-plan-summary");
    if (!el) return;

    const distHtml = plan.officer_distribution.map((d) => `
        <div class="officer-row">
            <div class="officer-row-left">
                <div class="officer-row-name">${d.location_name}</div>
                <div class="officer-row-meta">${d.severity} severity${d.closure ? " · Closure req." : ""}${d.diversion ? " · Diversion" : ""}${d.barricade_percentage > 0 ? ` · ${Math.round(d.barricade_percentage)}% barricade` : ""}</div>
            </div>
            <div class="officer-count">${d.officers}<small>off.</small></div>
        </div>
    `).join("");

    el.innerHTML = `
        <div class="rp-plan-total">
            <span>Total Officers</span><strong>${plan.total_officers}</strong>
        </div>
        <div class="officer-distribution">${distHtml}</div>
        <div class="plan-improvement">
            <i class="material-icons">trending_down</i>
            Est. improvement: <strong>${plan.improvement_pct}%</strong> with full response
        </div>
    `;

    // Populate right-panel response pane with tactical plans from all events
    const rpEmpty   = document.getElementById("rp-response-empty");
    const rpContent = document.getElementById("rp-response-content");
    if (rpEmpty)   rpEmpty.classList.add("hidden");
    if (rpContent) rpContent.classList.remove("hidden");

    const suggList = document.getElementById("suggestions-list");
    if (suggList) {
        const impacts = state.citySimResult?.event_impacts || [];
        const rows = [];

        // ── CITY-LEVEL MANPOWER SUMMARY ───────────────────────────────────
        rows.push(`<div class="sugg-section-label">MANPOWER — ${plan.total_officers} Officers Total</div>`);

        // Flatten all per-junction deployments from all events
        const allDeployments = [];
        impacts.forEach(imp => {
            const mp = imp.tactical_plan?.manpower;
            if (mp && mp.deployment) {
                mp.deployment.forEach(d => allDeployments.push({ ...d, event_name: imp.event_name }));
            }
        });

        if (allDeployments.length) {
            // Group by location name to avoid repeats
            const seen = new Set();
            allDeployments.forEach(d => {
                if (seen.has(d.location)) return;
                seen.add(d.location);
                rows.push(`<div class="suggestion-item">
                    <span class="sugg-bullet" style="color:#f59e0b;">▸</span>
                    <div><strong>${d.officers} off.</strong> — ${d.location}
                    <br><span class="sugg-detail">${d.role}</span></div>
                </div>`);
            });
        } else {
            // Fallback: per-site totals
            plan.officer_distribution.slice(0, 6).forEach(d => {
                const tags = [d.closure ? "Closure" : null, d.diversion ? "Diversion" : null].filter(Boolean).join(" · ");
                rows.push(`<div class="suggestion-item">
                    <span class="sugg-bullet" style="color:#f59e0b;">▸</span>
                    <div><strong>${d.officers} off.</strong> — ${d.location_name}
                    ${tags ? `<br><span class="sugg-detail">${tags}</span>` : ""}</div>
                </div>`);
            });
        }

        // ── BARRICADES ────────────────────────────────────────────────────
        const avgBar = plan.avg_barricade_pct ?? 0;
        const barricadePoints = impacts.flatMap(imp => imp.tactical_plan?.barricades?.points || []);
        if (avgBar > 0 || barricadePoints.length) {
            rows.push(`<div class="sugg-section-label">BARRICADING — ${Math.round(avgBar)}% Avg Intensity</div>`);
            const seenB = new Set();
            barricadePoints.slice(0, 5).forEach(p => {
                if (seenB.has(p.location)) return;
                seenB.add(p.location);
                rows.push(`<div class="suggestion-item">
                    <span class="sugg-bullet" style="color:#e1862d;">▸</span>
                    <div><strong>${p.location}</strong> — ${p.control_pct}% control
                    <br><span class="sugg-detail">${p.reason}</span></div>
                </div>`);
            });
        }

        // ── CLOSURES ──────────────────────────────────────────────────────
        const closureSegments = impacts.flatMap(imp => imp.tactical_plan?.closures?.required ? (imp.tactical_plan.closures.segments || []) : []);
        if (closureSegments.length > 0) {
            rows.push(`<div class="sugg-section-label">ROAD CLOSURES — ${plan.closures_required} Site${plan.closures_required !== 1 ? "s" : ""}</div>`);
            closureSegments.slice(0, 4).forEach(s => {
                rows.push(`<div class="suggestion-item">
                    <span class="sugg-bullet" style="color:#ef4444;">▸</span>
                    <div><strong>${s.road}</strong>
                    <br><span class="sugg-detail">${s.from_junction} → ${s.to_junction}</span>
                    <br><span class="sugg-detail">${s.reason}</span>
                    ${s.duration ? `<br><span class="sugg-detail" style="color:#94a3b8;">${s.duration}</span>` : ""}</div>
                </div>`);
            });
        } else {
            rows.push(`<div class="suggestion-item"><span class="sugg-bullet" style="color:#3d5a72;">▸</span><div><strong>Road Closure:</strong> Not required for any active event</div></div>`);
        }

        // ── DIVERSIONS ────────────────────────────────────────────────────
        const divRoutes = impacts.flatMap(imp => imp.tactical_plan?.diversions?.required ? (imp.tactical_plan.diversions.routes || []) : []);
        if (divRoutes.length > 0) {
            rows.push(`<div class="sugg-section-label">DIVERSION ROUTES</div>`);
            const seenD = new Set();
            divRoutes.slice(0, 4).forEach(r => {
                if (seenD.has(r.affected_road)) return;
                seenD.add(r.affected_road);
                rows.push(`<div class="suggestion-item">
                    <span class="sugg-bullet" style="color:#38bdf8;">▸</span>
                    <div><strong>${r.affected_road}</strong>
                    <br><span class="sugg-detail">Via: ${r.via.join(" → ")}</span>
                    <br><span class="sugg-detail">${r.reason}</span></div>
                </div>`);
            });
        } else {
            rows.push(`<div class="suggestion-item"><span class="sugg-bullet" style="color:#3d5a72;">▸</span><div><strong>Diversion:</strong> Not required</div></div>`);
        }

        suggList.innerHTML = rows.join("");
    }

    const woTime = document.getElementById("without-action-time");
    const wTime  = document.getElementById("with-plan-time");
    const maxClear = state.citySimResult?.city_status?.recovery_est_min || 0;
    if (woTime) woTime.textContent = `${maxClear} min`;
    if (wTime)  wTime.textContent  = `${Math.round(maxClear * (1 - plan.improvement_pct / 100))} min`;

    const applyBtn = document.getElementById("btn-apply-plan");
    if (applyBtn) applyBtn.onclick = () => applyFullResponsePlan(plan);
}

function applyFullResponsePlan(plan) {
    if (!window.mapEngine) return;
    clearOverlays();

    // Re-place typed event markers
    state.citySimResult?.event_impacts?.forEach((imp) => {
        const ev = state.commandEvents.find((e) => e.id === imp.event_id);
        if (ev) placeTypedEventMarker(ev, imp.impact_score, imp.severity_level);
    });

    const impacts = state.citySimResult?.event_impacts || [];
    const logLines = [];
    const seenPolice    = new Set();
    const seenBarricade = new Set();
    const seenClosure   = new Set();
    const seenDiversion = new Set();

    impacts.forEach((imp) => {
        const tp = imp.tactical_plan;
        if (!tp) return;

        // 1. Police deployment — per junction
        (tp.manpower?.deployment || []).forEach((d) => {
            if (seenPolice.has(d.location)) return;
            seenPolice.add(d.location);
            _addPlanPoliceMarker(d.lat, d.lng, d.officers, d.location, d.role);
            logLines.push(`${d.officers} officers → ${d.location}`);
        });

        // 2. Barricades
        if ((tp.barricades?.intensity_pct || 0) > 0) {
            (tp.barricades?.points || []).forEach((p) => {
                if (seenBarricade.has(p.location)) return;
                seenBarricade.add(p.location);
                _addPlanBarricadeMarker(p.lat, p.lng, p.location, p.control_pct, p.reason);
                logLines.push(`Barricade ${p.control_pct}% → ${p.location}`);
            });
        }

        // 3. Road closures
        if (tp.closures?.required) {
            (tp.closures?.segments || []).forEach((s) => {
                if (seenClosure.has(s.road)) return;
                seenClosure.add(s.road);
                _addPlanClosureMarker(s.lat, s.lng, s.road, s.from_junction, s.to_junction, s.reason, s.duration);
                logLines.push(`Closure → ${s.road}`);
            });
        }

        // 4. Diversion routes
        if (tp.diversions?.required) {
            (tp.diversions?.routes || []).forEach((r) => {
                if (seenDiversion.has(r.affected_road)) return;
                seenDiversion.add(r.affected_road);
                if (r.via_coords && r.via_coords.length >= 2) {
                    _addPlanDiversionRoute(r.affected_road, r.via, r.via_coords, r.reason);
                    logLines.push(`Diversion → ${r.affected_road} via ${r.via.slice(0, 2).join(", ")}`);
                }
            });
        }
    });

    // Action log — summary first, then first few lines
    logAction("Response plan applied", `${plan.total_officers} officers · ${logLines.length} actions`);
    logLines.slice(0, 6).forEach((l) => logAction(l));

    // Capture event-impact stats (before response) from current phase
    const curPhase    = state.citySimResult?.city_timeline?.[state.cityTimelinePhase] || {};
    const impactCong  = curPhase.avg_congestion ?? 0;
    const impactCrit  = curPhase.critical_roads  ?? 0;
    const impactSpeed = curPhase.avg_speed        ?? 0;

    // Enable and switch to response scenario
    state.simScenarios.responseApplied = true;
    state.simScenarios.active = "response";
    const responseBtn = document.querySelector('[data-scen="response"]');
    if (responseBtn) responseBtn.disabled = false;
    document.querySelectorAll(".scen-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.scen === "response")
    );

    // Re-render current phase with response modifiers to get real stats
    _applyCitySnapshotToMap(state.cityTimelinePhase, curPhase);

    // Estimate response improvement for comparison display
    const responseCong  = Math.max(5,  Math.round(impactCong  * (1 - plan.improvement_pct / 100 * 0.8)));
    const responseCrit  = Math.max(0,  Math.round(impactCrit  * (1 - plan.improvement_pct / 100)));
    const responseSpeed = Math.min(55, Math.round(impactSpeed * (1 + plan.improvement_pct / 100 * 0.5)));

    const planEffect = document.getElementById("plan-effect");
    if (planEffect) {
        planEffect.classList.remove("hidden");
        planEffect.innerHTML = `
            <div class="scenario-compare">
                <div class="sc-header">
                    <div class="sc-col-head sc-col-head--before">EVENT IMPACT</div>
                    <div class="sc-col-head sc-col-head--after">WITH RESPONSE</div>
                </div>
                <div class="sc-row">
                    <div class="sc-cell sc-cell--before"><div class="sc-label">CONGESTION</div><div class="sc-val">${impactCong.toFixed(0)}%</div></div>
                    <div class="sc-cell sc-cell--after"><div class="sc-label">CONGESTION</div><div class="sc-val">${responseCong}%</div><div class="sc-delta">▼ ${(impactCong - responseCong).toFixed(0)}%</div></div>
                </div>
                <div class="sc-row">
                    <div class="sc-cell sc-cell--before"><div class="sc-label">CRITICAL</div><div class="sc-val">${impactCrit}</div></div>
                    <div class="sc-cell sc-cell--after"><div class="sc-label">CRITICAL</div><div class="sc-val">${responseCrit}</div><div class="sc-delta">▼ ${impactCrit - responseCrit}</div></div>
                </div>
                <div class="sc-row">
                    <div class="sc-cell sc-cell--before"><div class="sc-label">AVG SPEED</div><div class="sc-val">${impactSpeed.toFixed(0)} km/h</div></div>
                    <div class="sc-cell sc-cell--after"><div class="sc-label">AVG SPEED</div><div class="sc-val">${responseSpeed} km/h</div><div class="sc-delta" style="color:#22c55e;">▲ ${responseSpeed - Math.round(impactSpeed)} km/h</div></div>
                </div>
            </div>
        `;
    }

    const tip = document.getElementById("map-tip");
    if (tip) tip.textContent = `Response plan active — ${plan.total_officers} officers · ${seenBarricade.size} barricades · ${seenClosure.size} closures · ${seenDiversion.size} diversions. Map shows post-response congestion.`;
}

// ── Plan marker helpers ───────────────────────────────────────────────────────

function _addPlanPoliceMarker(lat, lng, officers, location, role) {
    const mapObj = window.mapEngine.getMap();
    const icon = L.divIcon({
        html: `<div class="map-plan-chip map-plan-chip--police"><i class="material-icons">local_police</i><span>${officers} off.</span></div>`,
        className: "map-plan-chip-wrap",
        iconSize:   [72, 26],
        iconAnchor: [36, 13],
    });
    const m = L.marker([lat, lng], { icon }).addTo(mapObj);
    m.bindPopup(
        `<div class="map-plan-popup">
            <div class="mpp-title"><i class="material-icons" style="color:#7dd3fc;">local_police</i>${location}</div>
            <div class="mpp-stat">${officers} Officers</div>
            <div class="mpp-role">${role}</div>
        </div>`,
        { className: "plan-popup", maxWidth: 220 }
    );
    state.overlayMarkers.push(m);
}

function _addPlanBarricadeMarker(lat, lng, location, controlPct, reason) {
    const mapObj = window.mapEngine.getMap();
    const icon = L.divIcon({
        html: `<div class="map-plan-chip map-plan-chip--barricade"><i class="material-icons">safety_divider</i><span>${controlPct}%</span></div>`,
        className: "map-plan-chip-wrap",
        iconSize:   [66, 26],
        iconAnchor: [33, 13],
    });
    const m = L.marker([lat, lng], { icon }).addTo(mapObj);
    m.bindPopup(
        `<div class="map-plan-popup">
            <div class="mpp-title"><i class="material-icons" style="color:#fcd38d;">safety_divider</i>Barricade</div>
            <div class="mpp-stat">${location}</div>
            <div class="mpp-stat">${controlPct}% traffic control</div>
            <div class="mpp-role">${reason}</div>
        </div>`,
        { className: "plan-popup", maxWidth: 220 }
    );
    state.overlayMarkers.push(m);
}

function _addPlanClosureMarker(lat, lng, road, fromJn, toJn, reason, duration) {
    const mapObj = window.mapEngine.getMap();
    const icon = L.divIcon({
        html: `<div class="map-plan-chip map-plan-chip--closure"><i class="material-icons">block</i><span>CLOSED</span></div>`,
        className: "map-plan-chip-wrap",
        iconSize:   [72, 26],
        iconAnchor: [36, 13],
    });
    const m = L.marker([lat, lng], { icon }).addTo(mapObj);
    m.bindPopup(
        `<div class="map-plan-popup">
            <div class="mpp-title"><i class="material-icons" style="color:#fca5a5;">block</i>Road Closed</div>
            <div class="mpp-stat">${road}</div>
            <div class="mpp-role">${fromJn} → ${toJn}</div>
            <div class="mpp-role">${reason}</div>
            ${duration ? `<div class="mpp-time">${duration}</div>` : ""}
        </div>`,
        { className: "plan-popup", maxWidth: 240 }
    );
    // Draw a short barred line at the closure point
    const d = 0.0015;
    const closureLine = L.polyline(
        [[lat - d, lng - d * 0.6], [lat + d, lng + d * 0.6]],
        { color: "#ef4444", weight: 7, dashArray: "8 5", opacity: 0.92, lineCap: "round" }
    ).addTo(mapObj);
    const crossLine = L.polyline(
        [[lat - d, lng + d * 0.6], [lat + d, lng - d * 0.6]],
        { color: "#ef4444", weight: 7, dashArray: "8 5", opacity: 0.92, lineCap: "round" }
    ).addTo(mapObj);
    state.overlayMarkers.push(m);
    state.overlayLines.push(closureLine, crossLine);
}

function _addPlanDiversionRoute(affectedRoad, via, viaCoords, reason) {
    const mapObj = window.mapEngine.getMap();

    // Draw the alternate route polyline
    const line = L.polyline(viaCoords, {
        color:     "#38bdf8",
        weight:    4,
        dashArray: "14 7",
        opacity:   0.88,
        lineCap:   "round",
    }).addTo(mapObj);
    line.bindPopup(
        `<div class="map-plan-popup">
            <div class="mpp-title"><i class="material-icons" style="color:#7dd3fc;">alt_route</i>Diversion Active</div>
            <div class="mpp-stat">Affects: ${affectedRoad}</div>
            <div class="mpp-role">Via: ${via.join(" → ")}</div>
            <div class="mpp-role">${reason}</div>
        </div>`,
        { className: "plan-popup", maxWidth: 260 }
    );
    state.overlayLines.push(line);

    // Arrow-direction chip at the midpoint of the route
    const midIdx  = Math.floor(viaCoords.length / 2);
    const midPt   = viaCoords[midIdx];
    const divIcon = L.divIcon({
        html: `<div class="map-plan-chip map-plan-chip--diversion"><i class="material-icons">alt_route</i><span>DIVERT</span></div>`,
        className: "map-plan-chip-wrap",
        iconSize:   [72, 26],
        iconAnchor: [36, 13],
    });
    const m = L.marker(midPt, { icon: divIcon }).addTo(mapObj);
    m.bindPopup(
        `<div class="map-plan-popup">
            <div class="mpp-title"><i class="material-icons" style="color:#7dd3fc;">alt_route</i>Diversion</div>
            <div class="mpp-stat">${affectedRoad}</div>
            <div class="mpp-role">Via: ${via.join(" → ")}</div>
        </div>`,
        { className: "plan-popup", maxWidth: 240 }
    );
    state.overlayMarkers.push(m);
}

// ─────────────────────────────────────────────────────────────────────────────
// CITY TIMELINE
// ─────────────────────────────────────────────────────────────────────────────
const CITY_CURVES = {
    "PUBLIC_EVENT": [[0.00, 0.14], [0.20, 0.70], [0.55, 1.00], [1.00, 0.15]],
    "INCIDENT":     [[0.00, 0.10], [0.06, 1.00], [0.40, 0.52], [1.00, 0.12]],
};
const SEVERITY_SPREAD = { LOW: 0.06, MEDIUM: 0.14, HIGH: 0.24, CRITICAL: 0.36 };

function setupCityTimeline(phases) {
    const slider = document.getElementById("timeline-slider");
    const ticks  = document.getElementById("timeline-ticks");
    if (!slider || !ticks) return;

    slider.min   = "0";
    slider.max   = String(phases.length - 1);
    slider.step  = "1";
    slider.value = "0";
    slider.oninput = (e) => setCityTimelinePhase(parseInt(e.target.value, 10));

    // Show every-other tick label when there are many phases, to avoid crowding
    const showAll = phases.length <= 6;
    ticks.innerHTML = phases.map((p, i) => {
        const showLabel = showAll || i === 0 || i === phases.length - 1 || i % 2 === 0;
        return `<span class="tick-label${i === 0 ? " active" : ""}" data-val="${i}" style="${showLabel ? "" : "opacity:0;pointer-events:none;"}">${p.timestamp || p.label}</span>`;
    }).join("");

    ticks.querySelectorAll(".tick-label").forEach((t) => {
        t.addEventListener("click", () => setCityTimelinePhase(parseInt(t.dataset.val, 10)));
    });
}

function setCityTimelinePhase(phase) {
    if (!state.citySimResult?.city_timeline) return;
    const phases = state.citySimResult.city_timeline;
    if (phase < 0 || phase >= phases.length) return;

    state.cityTimelinePhase = phase;
    const snap = phases[phase];

    const slider = document.getElementById("timeline-slider");
    if (slider) slider.value = phase;

    document.querySelectorAll(".tick-label").forEach((t) =>
        t.classList.toggle("active", parseInt(t.dataset.val, 10) === phase)
    );
    document.querySelectorAll(".tl-phase-row").forEach((r) =>
        r.classList.toggle("active-phase", parseInt(r.dataset.phase, 10) === phase)
    );

    const simTimeEl = document.getElementById("current-sim-time");
    if (simTimeEl) {
        const ts  = snap.timestamp || snap.label;
        const min = snap.minutes_from_start ?? snap.minutes ?? 0;
        simTimeEl.textContent = min === 0
            ? `${ts} — Event Start`
            : `${ts}  (+${min} min)`;
    }

    _applyCitySnapshotToMap(phase, snap);
}

function _applyCitySnapshotToMap(phaseIndex, snap) {
    const impacts = state.citySimResult?.event_impacts || [];
    const phases  = state.citySimResult?.city_timeline || [];
    const timeOffset = phases[phaseIndex]?.minutes ?? 0;

    const roads    = window.mapEngine?.getRoads?.() || [];
    const roadsMap = {};

    roads.forEach((road) => {
        const geo = road.geometry;
        if (!geo?.length) return;
        const mid = geo[Math.floor(geo.length / 2)];
        const lat = Array.isArray(mid) ? mid[0] : (mid?.lat ?? 0);
        const lng = Array.isArray(mid) ? mid[1] : (mid?.lng ?? 0);

        const baseline = road.congestion_score || 0.12;
        let density    = baseline;

        impacts.forEach((imp) => {
            const dist    = haversineKm(imp.latitude, imp.longitude, lat, lng);
            const falloff = Math.max(0, 1 - dist / Math.max(imp.impact_radius_km || 3.0, 0.3));
            if (falloff <= 0) return;

            const curve     = CITY_CURVES[imp.event_category] || CITY_CURVES.INCIDENT;
            const clearance = Math.max(5, imp.clearance_time);
            const mult      = _interpolateMult(timeOffset, clearance, curve);
            const spread    = SEVERITY_SPREAD[imp.severity_level] || 0.14;
            const importance= _roadImportance(road.road_type);
            const delta     = (imp.impact_score / 100.0) * mult * spread * falloff * importance;
            density = 1.0 - (1.0 - density) * (1.0 - delta);
        });

        density = Math.min(0.97, density);
        const speed = Math.max(4, (road.current_speed || 30) * (1 - Math.min(density - baseline, 0.8) * 0.88));
        roadsMap[road.edge_id] = { congestion_score: density, current_speed: speed };
    });

    // Scenario-specific modifiers
    if (state.simScenarios.active === "response" && state.simScenarios.responseApplied) {
        _applyResponseModifiers(roadsMap);
    } else if (state.simScenarios.active === "manual" && state.simScenarios.manualApplied) {
        _applyResponseModifiers(roadsMap);
        _applyManualModifiers(roadsMap);
    }

    // Recompute summary stats from roadsMap for the scenario
    let sumCong = 0, sumSpeed = 0, n = 0, critCount = 0;
    Object.values(roadsMap).forEach(r => {
        sumCong  += r.congestion_score;
        sumSpeed += r.current_speed;
        if (r.congestion_score >= 0.7) critCount++;
        n++;
    });
    const sceneAvgCong  = n > 0 ? Math.round((sumCong  / n) * 100) : snap.avg_congestion;
    const sceneAvgSpeed = n > 0 ? Math.round(sumSpeed  / n)         : snap.avg_speed;
    const sceneCrit     = critCount > 0                              ? critCount : snap.critical_roads;

    // Update live stats box header to reflect active scenario
    const statsBoxHdr = document.querySelector("#map-live-stats-box .stats-box-header");
    if (statsBoxHdr) {
        const scLabel = { impact: "EVENT IMPACT", response: "RESPONSE APPLIED", manual: "MANUAL INTV." }[state.simScenarios.active] || "SIMULATION";
        statsBoxHdr.textContent = scLabel;
    }

    applyTimelineState({
        roads:          roadsMap,
        avg_congestion: state.simScenarios.active === "impact" ? snap.avg_congestion : sceneAvgCong,
        avg_speed:      state.simScenarios.active === "impact" ? snap.avg_speed      : sceneAvgSpeed,
        critical_roads: state.simScenarios.active === "impact" ? snap.critical_roads : sceneCrit,
    });
}

function _interpolateMult(timeOffset, clearanceMin, curve) {
    const frac = clearanceMin > 0 ? Math.min(1.0, timeOffset / clearanceMin) : 1.0;
    for (let i = 0; i < curve.length - 1; i++) {
        const [t0, m0] = curve[i], [t1, m1] = curve[i + 1];
        if (frac >= t0 && frac <= t1) {
            const span = t1 - t0;
            return span === 0 ? m1 : m0 + ((frac - t0) / span) * (m1 - m0);
        }
    }
    return curve[curve.length - 1][1];
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPED EVENT MARKERS
// ─────────────────────────────────────────────────────────────────────────────
const EVENT_TYPE_ICONS = {
    "IPL Match":            { icon: "sports_cricket", color: "#f59e0b" },
    "Cricket Match":        { icon: "sports_cricket", color: "#f59e0b" },
    "Football Match":       { icon: "sports_soccer",  color: "#f59e0b" },
    "Concert":              { icon: "music_note",      color: "#a855f7" },
    "Music Festival":       { icon: "music_note",      color: "#a855f7" },
    "Exhibition / Expo":    { icon: "store",           color: "#06b6d4" },
    "Marathon / Run":       { icon: "directions_run",  color: "#22c55e" },
    "Cultural Event":       { icon: "celebration",     color: "#f59e0b" },
    "Accident":             { icon: "warning",         color: "#ef4444" },
    "Debris on Road":       { icon: "warning",         color: "#ef4444" },
    "Vehicle Breakdown":    { icon: "car_repair",      color: "#fbbf24" },
    "Tree Fall":            { icon: "forest",          color: "#84cc16" },
    "Water Logging":        { icon: "water",           color: "#38bdf8" },
    "Flooding":             { icon: "water",           color: "#38bdf8" },
    "Road Construction":    { icon: "construction",    color: "#f97316" },
    "Pothole":              { icon: "construction",    color: "#f97316" },
    "Protest":              { icon: "groups",          color: "#c084fc" },
    "Political Rally":      { icon: "groups",          color: "#c084fc" },
    "Religious Procession": { icon: "groups",          color: "#c084fc" },
    "VIP Movement":         { icon: "star",            color: "#d4b800" },
};

function _getEventTypeConfig(eventType) {
    return EVENT_TYPE_ICONS[eventType] || { icon: "location_on", color: "#8aa9be" };
}

function _eventTypeIconHtml(eventType) {
    const cfg = _getEventTypeConfig(eventType);
    return `<i class="material-icons" style="font-size:11px;color:${cfg.color};">${cfg.icon}</i>`;
}

function placeTypedEventMarker(ev, impactScore = 0, severityLevel = "MEDIUM") {
    if (!window.mapEngine || !ev.latitude) return;
    const mapObj = window.mapEngine.getMap();
    const cfg    = _getEventTypeConfig(ev.event_type);

    const pulseSize  = ev.event_category === "PUBLIC_EVENT" ? 42 : 34;
    const innerSize  = pulseSize * 0.52;
    const pulseColor = cfg.color + "55";

    const icon = L.divIcon({
        html: `
            <div style="position:relative;width:${pulseSize}px;height:${pulseSize}px;">
                <div style="position:absolute;top:0;left:0;width:${pulseSize}px;height:${pulseSize}px;
                     border-radius:50%;background:${pulseColor};
                     animation:ping 1.8s cubic-bezier(0,0,.2,1) infinite;"></div>
                <div style="position:absolute;
                     top:${(pulseSize-innerSize)/2}px;left:${(pulseSize-innerSize)/2}px;
                     width:${innerSize}px;height:${innerSize}px;border-radius:50%;
                     background:${cfg.color};border:2px solid rgba(255,255,255,0.6);
                     display:flex;align-items:center;justify-content:center;">
                    <i class="material-icons" style="font-size:${Math.round(innerSize*0.55)}px;color:#fff;">${cfg.icon}</i>
                </div>
            </div>`,
        className: "event-pulse-wrap",
        iconSize:  [pulseSize, pulseSize],
        iconAnchor:[pulseSize / 2, pulseSize / 2],
    });

    const m = L.marker([ev.latitude, ev.longitude], { icon }).addTo(mapObj);
    const impactText = impactScore > 0 ? ` · Impact ${Math.round(impactScore)}/100` : "";
    m.bindTooltip(`${ev.event_name}${impactText}`, { permanent: false, direction: "top", offset: [0, -pulseSize/2] });
    m.on("click", () => {
        if (state.citySimResult) {
            const imp = state.citySimResult.event_impacts?.find((i) => i.event_id === ev.id);
            if (imp) { renderFocusedEventDetails(imp); switchRightPane("analysis"); }
        }
    });
    state.overlayMarkers.push(m);
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION HISTORY LOG
// ─────────────────────────────────────────────────────────────────────────────
function logAction(label, detail = "") {
    const container = document.getElementById("action-history");
    if (!container) return;

    const now  = new Date();
    const time = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

    const item = document.createElement("div");
    item.className = "action-log-item";
    item.innerHTML = `
        <span class="action-log-time">${time}</span>
        <div class="action-log-body">
            <span class="action-log-label">${label}</span>
            ${detail ? `<span class="action-log-detail">${detail}</span>` : ""}
        </div>
    `;
    container.insertBefore(item, container.firstChild);

    // Keep last 8 entries
    while (container.children.length > 8) container.removeChild(container.lastChild);
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERVENTION TOOLS (left panel compact toolbar)
// ─────────────────────────────────────────────────────────────────────────────
function initIntvTools() {
    document.querySelectorAll(".intv-tool").forEach((btn) => {
        btn.addEventListener("click", () => {
            const wasSame = btn.classList.contains("active");
            document.querySelectorAll(".intv-tool").forEach((b) => b.classList.remove("active"));
            state.activeTool = wasSame ? null : btn.dataset.tool;
            if (!wasSame) btn.classList.add("active");

            const hint = document.getElementById("intv-mode-hint");
            if (hint) {
                hint.textContent = state.activeTool
                    ? `${capitalize(state.activeTool)} mode — click map to place`
                    : "Click tool → click map to place";
                hint.classList.toggle("intv-hint-active", !!state.activeTool);
            }
        });
    });

    // Also keep right-panel tool buttons in sync
    document.querySelectorAll(".tool-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tool-btn").forEach((b) => b.classList.remove("active"));
            state.activeTool = btn.dataset.tool;
            btn.classList.add("active");
            renderToolConfig();
        });
    });

    document.getElementById("btn-clear-actions")?.addEventListener("click", () => {
        state.activeInterventions = [];
        clearOverlays();
        if (state.citySimResult) {
            state.citySimResult.event_impacts.forEach((imp) => {
                const ev = state.commandEvents.find((e) => e.id === imp.event_id);
                if (ev) placeTypedEventMarker(ev, imp.impact_score, imp.severity_level);
            });
        }
        renderActiveActions();
        logAction("All interventions cleared");
    });
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ""; }

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL EVENTS
// ─────────────────────────────────────────────────────────────────────────────
function bindGlobalEvents() {
    window.addEventListener("road:selected", (e) => {
        state.selectedRoad = e.detail;
        renderSelectedRoad(e.detail);
        if (state.activeTool) renderToolConfig();
        switchRightPane("inspector");
    });

    window.addEventListener("timeline:changed", (e) => {
        const d = e.detail;
        if (d?.avg_congestion === undefined) return;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set("metric-flow",       `${Math.max(0, Math.round(100 - d.avg_congestion))}%`);
        set("metric-congestion", `${Math.round(d.avg_congestion)}%`);
        set("metric-critical",   d.critical_roads);
        set("metric-speed",      `${d.avg_speed} km/h`);
        set("metric-state",
            d.avg_congestion > 65 ? "Critical" : d.avg_congestion > 35 ? "Heavy" : "Monitoring");
        set("cs-avg-congestion", `${Math.round(d.avg_congestion)}%`);
        set("cs-critical-roads", d.critical_roads);
    });

    window.addEventListener("map:clicked", async (e) => {
        const latlng = e.detail;

        // Incident location picker takes priority
        if (state.incidentPickerMode) {
            state.incidentPickerMode  = false;
            state.incidentPickerCoords = { lat: latlng.lat, lng: latlng.lng };
            if (window.mapEngine) window.mapEngine.getMap().getContainer().style.cursor = "";

            // Try reverse geocode via Nominatim
            let locName = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
            try {
                const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}&zoom=17&addressdetails=1`, { headers: { "Accept-Language": "en" } });
                if (r.ok) {
                    const gd = await r.json();
                    const a  = gd.address || {};
                    locName  = a.road || a.suburb || a.neighbourhood || a.city_district || gd.display_name?.split(",")[0] || locName;
                }
            } catch (_) {}
            state.incidentPickerLocationName = locName;

            // Show location preview + reveal confirm step
            const prev = document.getElementById("evt-location-preview");
            const locText = document.getElementById("evt-location-text");
            if (prev) prev.style.display = "flex";
            if (locText) locText.textContent = locName;

            const btn = document.getElementById("btn-pin-location");
            if (btn) { btn.classList.remove("active"); btn.innerHTML = `<i class="material-icons">edit_location</i> Re-pin location`; }

            document.getElementById("incident-step-2").style.display = "";
            document.getElementById("evt-input-desc")?.focus();

            const tip = document.getElementById("map-tip");
            if (tip) tip.textContent = `📍 Location set: ${locName} — fill details and click Report Incident`;
            return;
        }

        if (!state.activeTool) return;
        const road   = state.selectedRoad || { road_name: "Map Point", edge_id: `custom_${Date.now()}` };

        if (state.activeTool === "barricade") {
            const id = `b_${Date.now()}`;
            addCustomBarricadeMarker({ id, lat: latlng.lat, lng: latlng.lng, name: `Barricade (${road.road_name})` });
            state.activeInterventions.push({ type:"barricade", id, edge_id:road.edge_id, road_name:road.road_name, lat:latlng.lat, lng:latlng.lng, parameters:{reduction_pct:50} });
            renderActiveActions();
            logAction("Barricade placed", road.road_name);
        } else if (state.activeTool === "manpower") {
            const id = `p_${Date.now()}`;
            addCustomPoliceMarker({ id, lat: latlng.lat, lng: latlng.lng, officers: 10, name: `Officers (${road.road_name})` });
            state.activeInterventions.push({ type:"manpower", id, edge_id:road.edge_id, road_name:road.road_name, lat:latlng.lat, lng:latlng.lng, parameters:{officers_count:10} });
            renderActiveActions();
            logAction("Officers deployed", `10 officers · ${road.road_name}`);
        } else if (state.activeTool === "diversion") {
            state.activeInterventions.push({ type:"diversion", edge_id:road.edge_id, road_name:road.road_name });
            if (window.mapEngine && road.geometry) {
                const line = L.polyline(road.geometry, { color:"#ff3b30", weight:6, dashArray:"5 10", opacity:0.9 }).addTo(window.mapEngine.getMap());
                state.overlayLines.push(line);
            }
            renderActiveActions();
            logAction("Diversion route set", road.road_name);
        } else if (state.activeTool === "closure") {
            state.activeInterventions.push({ type:"closure", edge_id:road.edge_id, road_name:road.road_name, parameters:{closure_type:"Partial closure"} });
            if (window.mapEngine && road.geometry) {
                const line = L.polyline(road.geometry, { color:"#ef4444", weight:6, dashArray:"10 8", opacity:0.95 }).addTo(window.mapEngine.getMap());
                state.overlayLines.push(line);
            }
            renderActiveActions();
            logAction("Closure activated", road.road_name);
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// ROAD INSPECTOR + TOOL CONFIG (right panel)
// ─────────────────────────────────────────────────────────────────────────────
function renderSelectedRoad(road) {
    const card = document.getElementById("selected-road-card");
    if (!card) return;
    card.innerHTML = `
        <div class="road-info-card">
            <div class="road-info-name">${road.road_name}</div>
            <div class="road-info-row"><span>Type</span><strong>${road.road_type || "—"}</strong></div>
            <div class="road-info-row"><span>Congestion</span><strong>${Math.round((road.congestion_score||0)*100)}%</strong></div>
            <div class="road-info-row"><span>Speed</span><strong>${Math.round(road.current_speed||0)} km/h</strong></div>
            ${road.edge_id ? `<div class="road-info-row"><span>ID</span><strong>${road.edge_id}</strong></div>` : ""}
        </div>
    `;
}

function renderToolConfig() {
    const container = document.getElementById("tool-config");
    const ts = document.getElementById("tool-status");
    if (!container) return;

    const target = state.selectedRoad;
    if (!state.activeTool || !target) {
        container.classList.add("hidden");
        if (ts) ts.textContent = "Select a road corridor on the map, then choose a tool.";
        return;
    }

    const targetName = target.road_name || "—";
    if (ts) ts.textContent = `Target: ${targetName}`;

    if (state.activeTool === "barricade") {
        container.innerHTML = `<div class="form-stack"><label><span>Restriction</span><select id="tool-reduction"><option value="25">25%</option><option value="50" selected>50%</option><option value="75">75%</option></select></label></div><div class="tool-config-actions"><button class="tool-apply-btn" id="tool-apply">Apply Barricade</button></div>`;
    } else if (state.activeTool === "closure") {
        container.innerHTML = `<div class="form-stack"><label><span>Closure Type</span><select id="tool-closure-type"><option>Complete closure</option><option>One side closure</option></select></label></div><div class="tool-config-actions"><button class="tool-apply-btn" id="tool-apply">Apply Closure</button></div>`;
    } else if (state.activeTool === "diversion") {
        container.innerHTML = `<p class="rp-empty-msg" style="margin-bottom:8px;">Activate diversion on selected corridor.</p><div class="tool-config-actions"><button class="tool-apply-btn" id="tool-apply">Apply Diversion</button></div>`;
    } else if (state.activeTool === "manpower") {
        container.innerHTML = `<div class="form-stack"><label><span>Officers</span><input id="tool-officers" type="number" min="0" value="12"></label></div><div class="tool-config-actions"><button class="tool-apply-btn" id="tool-apply">Deploy Officers</button></div>`;
    }

    container.classList.remove("hidden");
    document.getElementById("tool-apply")?.addEventListener("click", () => {
        const intv = buildToolIntervention();
        if (!intv) return;
        upsertIntervention(intv);
        logAction(`${capitalize(state.activeTool)} applied`, targetName);
    });
}

function buildToolIntervention() {
    const target = state.selectedRoad;
    if (!target) return null;
    const base = { type: state.activeTool, edge_id: target.edge_id, road_name: target.road_name, parameters: {} };
    if (state.activeTool === "barricade")  base.parameters.reduction_pct  = parseInt(document.getElementById("tool-reduction")?.value, 10);
    if (state.activeTool === "closure")    base.parameters.closure_type   = document.getElementById("tool-closure-type")?.value;
    if (state.activeTool === "manpower")   base.parameters.officers_count = parseInt(document.getElementById("tool-officers")?.value, 10) || 0;
    return base;
}

function upsertIntervention(intervention) {
    const key = `${intervention.type}:${intervention.edge_id}`;
    const idx = state.activeInterventions.findIndex((x) => `${x.type}:${x.edge_id}` === key);
    if (idx >= 0) state.activeInterventions[idx] = intervention;
    else state.activeInterventions.push(intervention);
    renderActiveActions();
}

function renderActiveActions() {
    const list = document.getElementById("active-actions-list");
    if (!list) return;
    if (!state.activeInterventions.length) {
        list.className = "action-list empty"; list.textContent = "No active interventions"; return;
    }
    list.className = "action-list";
    list.innerHTML = "";
    state.activeInterventions.forEach((item, i) => {
        const row = document.createElement("div");
        row.className = "action-row";
        row.innerHTML = `<div><strong>${formatIntervention(item)}</strong><p>${item.road_name || "—"}</p></div><button class="mini-btn" type="button">Remove</button>`;
        row.querySelector("button").addEventListener("click", () => {
            state.activeInterventions.splice(i, 1);
            renderActiveActions();
        });
        list.appendChild(row);
    });
}

function formatIntervention(item) {
    if (item.type === "barricade") return `Barricade ${item.parameters?.reduction_pct || 0}%`;
    if (item.type === "manpower")  return `${item.parameters?.officers_count || 0} officers`;
    if (item.parameters?.closure_type) return item.parameters.closure_type;
    return item.type;
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERLAY HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function clearOverlays() {
    if (window.mapEngine) {
        const mapObj = window.mapEngine.getMap();
        state.overlayMarkers.forEach((m) => mapObj.removeLayer(m));
        state.overlayLines.forEach((l)   => mapObj.removeLayer(l));
        window.mapEngine.clearInterventions();
    }
    state.overlayMarkers = [];
    state.overlayLines   = [];
}

function addCustomBarricadeMarker(b) {
    if (!window.mapEngine) return;
    const mapObj = window.mapEngine.getMap();
    const icon   = L.divIcon({
        html: `<div class="map-overlay-chip" style="background:#e1862d;border-color:#ffd28a;padding:4px 6px;font-size:10px;"><i class="material-icons" style="font-size:11px;vertical-align:middle;margin-right:2px;">block</i>Barricade</div>`,
        className: "map-overlay-chip-wrap", iconSize: [80, 22], iconAnchor: [40, 11],
    });
    const m = L.marker([b.lat, b.lng], { icon }).addTo(mapObj);
    m.bindTooltip(b.name, { sticky: true });
    state.overlayMarkers.push(m);
}

function addCustomPoliceMarker(p) {
    if (!window.mapEngine) return;
    const mapObj = window.mapEngine.getMap();
    const icon   = L.divIcon({
        html: `<div class="map-overlay-chip" style="background:#2ea3ff;border-color:#93c5fd;padding:4px 6px;font-size:10px;"><i class="material-icons" style="font-size:11px;vertical-align:middle;margin-right:2px;">groups</i>${p.officers} Officers</div>`,
        className: "map-overlay-chip-wrap", iconSize: [90, 22], iconAnchor: [45, 11],
    });
    const m = L.marker([p.lat, p.lng], { icon }).addTo(mapObj);
    m.bindTooltip(p.name, { sticky: true });
    state.overlayMarkers.push(m);
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2
               + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
}

function _roadImportance(roadType) {
    const t = String(roadType || "").toLowerCase();
    if (t.includes("motorway")) return 1.00;
    if (t.includes("trunk"))    return 0.88;
    if (t.includes("primary"))  return 0.75;
    if (t.includes("secondary"))return 0.55;
    if (t.includes("tertiary")) return 0.35;
    return 0.25;
}

async function timedJsonFetch(url, options = {}, timeoutMs = 5000) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: ctrl.signal });
        if (!res.ok) {
            let detail = "";
            try { const j = await res.json(); detail = j.error || ""; } catch (_) {}
            throw new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
        }
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMELINE PLAYBACK + SPEED CONTROL
// ─────────────────────────────────────────────────────────────────────────────
function _initTimelineSpeedBar() {
    const btn = document.getElementById("btn-play");
    if (!btn) return;
    btn.innerHTML = '<i class="material-icons">play_arrow</i>';
    btn.addEventListener("click", _togglePlay);

    if (document.getElementById("tl-speed-bar")) return;
    const bar = document.createElement("div");
    bar.id = "tl-speed-bar";
    bar.className = "tl-speed-bar";
    [["0.5×", 0.5], ["1×", 1], ["2×", 2], ["5×", 5]].forEach(([label, val]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tl-speed-btn" + (val === 1 ? " active" : "");
        b.dataset.speed = val;
        b.textContent = label;
        b.addEventListener("click", () => {
            simPlaybackState.speed = val;
            document.querySelectorAll(".tl-speed-btn").forEach(x => x.classList.remove("active"));
            b.classList.add("active");
            if (simPlaybackState.playing) { _stopAutoPlay(false); _startAutoPlay(); }
        });
        bar.appendChild(b);
    });
    btn.after(bar);
}

function _togglePlay() {
    if (simPlaybackState.playing) _stopAutoPlay(true);
    else _startAutoPlay();
}

function _startAutoPlay() {
    if (!state.citySimResult?.city_timeline?.length) return;
    simPlaybackState.playing = true;
    const btn = document.getElementById("btn-play");
    if (btn) btn.innerHTML = '<i class="material-icons">pause</i>';
    const interval = Math.round(2000 / simPlaybackState.speed);
    simPlaybackState.timer = setInterval(() => {
        const phases = state.citySimResult.city_timeline;
        setCityTimelinePhase((state.cityTimelinePhase + 1) % phases.length);
    }, interval);
}

function _stopAutoPlay(resetIcon = true) {
    simPlaybackState.playing = false;
    if (simPlaybackState.timer) { clearInterval(simPlaybackState.timer); simPlaybackState.timer = null; }
    if (resetIcon) {
        const btn = document.getElementById("btn-play");
        if (btn) btn.innerHTML = '<i class="material-icons">play_arrow</i>';
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO TOGGLE — EVENT IMPACT / RESPONSE APPLIED / MANUAL INTERVENTIONS
// ─────────────────────────────────────────────────────────────────────────────
function _injectScenarioToggle() {
    const simRes = document.getElementById("simulation-results");
    if (!simRes || document.getElementById("scenario-toggle-bar")) return;

    const bar = document.createElement("div");
    bar.id = "scenario-toggle-bar";
    bar.className = "scenario-toggle";

    const defs = [
        ["impact",   "EVENT IMPACT",   "scen-btn",                    false],
        ["response", "RESPONSE",       "scen-btn scen-btn--response", true ],
        ["manual",   "MANUAL INTV.",   "scen-btn scen-btn--manual",   true ],
    ];
    defs.forEach(([name, label, cls, disabled]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = cls + (name === "impact" ? " active" : "");
        b.dataset.scen = name;
        b.textContent  = label;
        b.disabled     = disabled;
        b.addEventListener("click", () => _switchScenario(name));
        bar.appendChild(b);
    });

    simRes.insertBefore(bar, simRes.firstChild);
}

function _switchScenario(name) {
    if (name === "response" && !state.simScenarios.responseApplied) return;
    if (name === "manual"   && !state.simScenarios.manualApplied)   return;
    state.simScenarios.active = name;
    document.querySelectorAll(".scen-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.scen === name)
    );
    if (state.citySimResult?.city_timeline) {
        const snap = state.citySimResult.city_timeline[state.cityTimelinePhase];
        if (snap) _applyCitySnapshotToMap(state.cityTimelinePhase, snap);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO ROAD MODIFIERS
// ─────────────────────────────────────────────────────────────────────────────
function _applyResponseModifiers(roadsMap) {
    const impacts = state.citySimResult?.event_impacts || [];
    const roads   = window.mapEngine?.getRoads?.() || [];

    impacts.forEach(imp => {
        const tp = imp.tactical_plan;
        if (!tp) return;

        // Police deployment: reduce congestion within 0.4 km of each junction
        (tp.manpower?.deployment || []).forEach(dep => {
            if (!dep.lat || !dep.lng) return;
            const relief = Math.min(0.30, (dep.officers / 100) * 0.25 + 0.08);
            roads.forEach(road => {
                const rm = roadsMap[road.edge_id];
                if (!rm) return;
                const geo = road.geometry;
                const mid = geo?.[Math.floor(geo.length / 2)];
                if (!mid) return;
                const lat = Array.isArray(mid) ? mid[0] : mid.lat;
                const lng = Array.isArray(mid) ? mid[1] : mid.lng;
                const dist = haversineKm(dep.lat, dep.lng, lat, lng);
                if (dist < 0.4) {
                    const f = 1 - dist / 0.4;
                    rm.congestion_score = Math.max(0.05, rm.congestion_score * (1 - relief * f));
                    rm.current_speed    = Math.min(58,  rm.current_speed    * (1 + relief * f * 0.5));
                }
            });
        });

        // Barricades: channel traffic, slight congestion relief
        (tp.barricades?.points || []).forEach(pt => {
            if (!pt.lat || !pt.lng) return;
            const relief = Math.min(0.20, (pt.control_pct / 100) * 0.18);
            roads.forEach(road => {
                const rm = roadsMap[road.edge_id];
                if (!rm) return;
                const geo = road.geometry;
                const mid = geo?.[Math.floor(geo.length / 2)];
                if (!mid) return;
                const lat = Array.isArray(mid) ? mid[0] : mid.lat;
                const lng = Array.isArray(mid) ? mid[1] : mid.lng;
                const dist = haversineKm(pt.lat, pt.lng, lat, lng);
                if (dist < 0.25) {
                    const f = 1 - dist / 0.25;
                    rm.congestion_score = Math.max(0.05, rm.congestion_score * (1 - relief * f));
                }
            });
        });

        // Closures: zero out the closed road; diverted traffic spills onto parallel roads.
        // Police modifiers (applied above) then relieve those parallel roads.
        (tp.closures?.required ? (tp.closures.segments || []) : []).forEach(seg => {
            if (!seg.lat || !seg.lng) return;
            roads.forEach(road => {
                const rm = roadsMap[road.edge_id];
                if (!rm) return;
                const geo = road.geometry;
                const mid = geo?.[Math.floor(geo.length / 2)];
                if (!mid) return;
                const lat = Array.isArray(mid) ? mid[0] : mid.lat;
                const lng = Array.isArray(mid) ? mid[1] : mid.lng;
                const dist = haversineKm(seg.lat, seg.lng, lat, lng);
                if (dist < 0.12) {
                    // This IS the closed road — clear it completely, particles will stop
                    rm.congestion_score = 0.04;
                    rm.current_speed    = 0;
                } else if (dist < 0.30) {
                    // Parallel roads absorb diverted traffic
                    const f = 1 - (dist - 0.12) / 0.18;
                    rm.congestion_score = Math.min(0.88, rm.congestion_score + 0.10 * f);
                    rm.current_speed    = Math.max(5, rm.current_speed * (1 - 0.20 * f));
                } else if (dist < 0.55) {
                    // Outer band — lighter secondary spillover
                    const f = 1 - (dist - 0.30) / 0.25;
                    rm.congestion_score = Math.min(0.75, rm.congestion_score + 0.04 * f);
                    rm.current_speed    = Math.max(8, rm.current_speed * (1 - 0.08 * f));
                }
            });
        });
    });
}

function _applyManualModifiers(roadsMap) {
    const allRoads = window.mapEngine?.getRoads?.() || [];

    // Helper: get midpoint lat/lng of a road's geometry
    function _midLatLng(road) {
        const geo = road.geometry;
        const mid = geo?.[Math.floor(geo.length / 2)];
        if (!mid) return null;
        return { lat: Array.isArray(mid) ? mid[0] : mid.lat, lng: Array.isArray(mid) ? mid[1] : mid.lng };
    }

    state.activeInterventions.forEach(intv => {
        const rm = roadsMap[intv.edge_id];

        if (intv.type === "closure") {
            // Zero out the closed road — particles will disappear
            if (rm) { rm.congestion_score = 0.04; rm.current_speed = 0; }

            // Spillover: diverted traffic backs up onto nearby roads
            const closedRoad = allRoads.find(r => r.edge_id === intv.edge_id);
            const cMid = closedRoad ? _midLatLng(closedRoad) : null;
            if (!cMid) return;

            allRoads.forEach(road => {
                if (road.edge_id === intv.edge_id) return;
                const other = roadsMap[road.edge_id];
                if (!other) return;
                const oMid = _midLatLng(road);
                if (!oMid) return;
                const dist = haversineKm(cMid.lat, cMid.lng, oMid.lat, oMid.lng);

                if (dist < 0.15) {
                    // Immediately adjacent — severe spillover
                    other.congestion_score = Math.min(0.95, other.congestion_score * 1.55 + 0.18);
                    other.current_speed    = Math.max(3, other.current_speed * 0.45);
                } else if (dist < 0.40) {
                    const f = 1 - (dist - 0.15) / 0.25;
                    other.congestion_score = Math.min(0.90, other.congestion_score + 0.14 * f);
                    other.current_speed    = Math.max(5, other.current_speed * (1 - 0.30 * f));
                } else if (dist < 0.80) {
                    const f = 1 - (dist - 0.40) / 0.40;
                    other.congestion_score = Math.min(0.82, other.congestion_score + 0.06 * f);
                    other.current_speed    = Math.max(8, other.current_speed * (1 - 0.12 * f));
                }
            });

        } else if (intv.type === "barricade") {
            if (!rm) return;
            const pct = (intv.parameters?.reduction_pct || 50) / 100;
            rm.congestion_score = Math.max(0.08, rm.congestion_score * (1 - pct * 0.35));
            rm.current_speed    = Math.min(50, rm.current_speed * (1 + pct * 0.28));

            // Partial spillover — barricade pushes overflow to side streets
            const barricadeRoad = allRoads.find(r => r.edge_id === intv.edge_id);
            const bMid = barricadeRoad ? _midLatLng(barricadeRoad) : null;
            if (!bMid) return;
            allRoads.forEach(road => {
                if (road.edge_id === intv.edge_id) return;
                const other = roadsMap[road.edge_id];
                if (!other) return;
                const oMid = _midLatLng(road);
                if (!oMid) return;
                const dist = haversineKm(bMid.lat, bMid.lng, oMid.lat, oMid.lng);
                if (dist < 0.22) {
                    const f = 1 - dist / 0.22;
                    other.congestion_score = Math.min(0.86, other.congestion_score + 0.07 * pct * f);
                    other.current_speed    = Math.max(6, other.current_speed * (1 - 0.12 * pct * f));
                }
            });

        } else if (intv.type === "manpower") {
            if (!rm) return;
            const officers = intv.parameters?.officers_count || 10;
            const relief   = Math.min(0.25, officers / 100 * 0.15 + 0.05);
            rm.congestion_score = Math.max(0.08, rm.congestion_score * (1 - relief));
            rm.current_speed    = Math.min(55, rm.current_speed * (1 + relief * 0.5));

        } else if (intv.type === "diversion") {
            if (!rm) return;
            rm.congestion_score = Math.max(0.08, rm.congestion_score * 0.70);
        }
    });
}

function _runManualSimulation() {
    if (!state.citySimResult?.city_timeline?.length) {
        logAction("No simulation active", "Run city simulation first");
        return;
    }
    if (!state.activeInterventions.length) {
        logAction("No interventions placed", "Place barricades, police, or closures on the map first");
        return;
    }
    state.simScenarios.manualApplied = true;
    const manualBtn = document.querySelector('[data-scen="manual"]');
    if (manualBtn) manualBtn.disabled = false;
    _switchScenario("manual");
    logAction("Manual simulation updated", `${state.activeInterventions.length} intervention${state.activeInterventions.length > 1 ? "s" : ""} applied`);
    const tip = document.getElementById("map-tip");
    if (tip) tip.textContent = "Manual intervention mode — congestion updated based on placed barricades, officers, and closures";
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERT LEVEL
// ─────────────────────────────────────────────────────────────────────────────
const alertLevels = [
    { cls: "alert-green",  icon: "shield",                 text: "NORMAL",   banner: false },
    { cls: "alert-yellow", icon: "warning",                text: "ELEVATED", banner: false },
    { cls: "alert-red",    icon: "notification_important", text: "CRITICAL", banner: true  },
];
let currentAlertLevel = 0;

function cycleAlertLevel() {
    currentAlertLevel = (currentAlertLevel + 1) % alertLevels.length;
    const lvl  = alertLevels[currentAlertLevel];
    const chip = document.getElementById("alert-level-chip");
    const icon = document.getElementById("alert-icon");
    const text = document.getElementById("alert-level-text");
    if (chip) chip.className = `cc-alert-chip ${lvl.cls}`;
    if (icon) icon.textContent = lvl.icon;
    if (text) text.textContent = lvl.text;
    if (lvl.banner) {
        const banner = document.getElementById("emergency-banner");
        const bt     = document.getElementById("emergency-banner-text");
        if (banner) banner.classList.remove("hidden");
        if (bt) bt.textContent = "ALERT LEVEL CRITICAL — ALL UNITS STAND BY";
    }
}

function dismissAlertBanner() {
    document.getElementById("emergency-banner")?.classList.add("hidden");
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPATCH CONSOLE
// ─────────────────────────────────────────────────────────────────────────────
const dispatchToastColors = {
    emergency: "#ef2222", ambulance: "#0ea5e9", fire: "#f97316", vip: "#d4b800",
    traffic: "#00c9a7", roadblock: "#a855f7", advisory: "#14b8a6", allclear: "#22c55e",
};

function showDispatchToast(label, color) {
    const toast = document.getElementById("dispatch-toast");
    if (!toast) return;
    toast.textContent      = label;
    toast.style.background = color || "#e1862d";
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2800);
}

function initDispatchButtons() {
    document.querySelectorAll(".dispatch-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const action   = btn.dataset.action;
            const label    = btn.dataset.label || action.toUpperCase();
            const color    = dispatchToastColors[action] || "#e1862d";
            const wasActive = btn.classList.contains("active");

            btn.classList.toggle("active", !wasActive);

            if (!wasActive) {
                showDispatchToast(label, color);
                logAction(label.replace("dispatched","").replace("active","").trim(), "Dispatch console");

                if (action === "emergency") {
                    const chip = document.getElementById("alert-level-chip");
                    const icon = document.getElementById("alert-icon");
                    const text = document.getElementById("alert-level-text");
                    if (chip) chip.className = "cc-alert-chip alert-red";
                    if (icon) icon.textContent = "notification_important";
                    if (text) text.textContent = "CRITICAL";
                    currentAlertLevel = 2;
                    document.getElementById("emergency-banner")?.classList.remove("hidden");
                    const bt = document.getElementById("emergency-banner-text");
                    if (bt) bt.textContent = "EMERGENCY ALERT ACTIVE — ALL UNITS RESPOND";
                }

                if (action === "allclear") {
                    const chip = document.getElementById("alert-level-chip");
                    const icon = document.getElementById("alert-icon");
                    const text = document.getElementById("alert-level-text");
                    if (chip) chip.className = "cc-alert-chip alert-green";
                    if (icon) icon.textContent = "shield";
                    if (text) text.textContent = "NORMAL";
                    currentAlertLevel = 0;
                    document.getElementById("emergency-banner")?.classList.add("hidden");
                    document.querySelectorAll(".dispatch-btn").forEach((b) => {
                        if (b.dataset.action !== "allclear") b.classList.remove("active");
                    });
                }
            }
        });
    });
}
