/**
 * Traffic Twin Bengaluru — Events Page
 *
 * Responsibilities:
 *  - Fetch all events from /api/events on load
 *  - Render PUBLIC_EVENT and INCIDENT cards into their columns
 *  - Handle search and category/severity filters on rendered cards
 *  - Add Event form → POST /api/events/add
 *  - Report Incident form → POST /api/events/add (INCIDENT category)
 *  - Delete event → DELETE /api/events/delete/<id>
 *  - Update status → PUT /api/events/update/<id>
 *  - Update summary counts after every mutation
 */

"use strict";

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let allEvents        = [];
let allWeatherAlerts = [];
let currentFilter    = "all";
let searchQuery      = "";

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    loadEvents();
    loadWeatherAlerts();
    setupFilters();
    setupSearch();
    setupModals();
    setupForms();
});

// ─────────────────────────────────────────────
// DATA FETCH
// ─────────────────────────────────────────────
async function loadEvents() {
    try {
        const res  = await fetch("/api/events");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load events.");
        allEvents = data.events || [];
        renderAll();
        updateSummary();
    } catch (err) {
        console.error("loadEvents:", err);
        showColumnError("public-events-list", "Could not load events.");
        showColumnError("reported-incidents-list", "Could not load events.");
    }
}

// ─────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────
function renderAll() {
    const publicList   = document.getElementById("public-events-list");
    const incidentList = document.getElementById("reported-incidents-list");

    const publicEvents = allEvents.filter(e => e.event_category === "PUBLIC_EVENT");
    const incidents    = allEvents.filter(e => e.event_category === "INCIDENT");

    publicList.innerHTML   = publicEvents.length
        ? publicEvents.map(renderPublicCard).join("")
        : emptyState("No public events on record.");

    incidentList.innerHTML = incidents.length
        ? incidents.map(renderIncidentCard).join("")
        : emptyState("No incidents reported.");

    reinitIcons();
    applyFilters();
}

function renderPublicCard(ev) {
    const sev       = (ev.severity || "MEDIUM").toUpperCase();
    const sevClass  = sev.toLowerCase();
    const sevLabel  = titleCase(sev) + " Severity";
    const statusBadge = statusHtml(ev.status);
    const timeLine  = formatTimeRange(ev.start_datetime, ev.end_datetime);
    const crowd     = ev.expected_crowd > 0
        ? `<div class="meta-item"><i data-lucide="users"></i><span>Expected Crowd: ${Number(ev.expected_crowd).toLocaleString()}</span></div>`
        : "";
    const evType    = ev.event_type
        ? `<div class="meta-item"><i data-lucide="tag"></i><span>${esc(ev.event_type)}</span></div>`
        : "";
    const zone      = ev.zone
        ? `<div class="meta-item"><i data-lucide="map"></i><span>${esc(ev.zone)}</span></div>`
        : "";
    const desc      = ev.description
        ? `<p class="card-desc">${esc(ev.description)}</p>`
        : "";
    const nextStatus = nextStatusFor(ev.status);
    const actionLabel = statusActionLabel(ev.status);

    return `
<div class="event-card public-event-type"
     data-id="${ev.id}"
     data-priority="${sevClass}"
     data-category="PUBLIC_EVENT"
     data-search="${esc((ev.event_name + " " + (ev.location_name || "") + " " + (ev.event_type || "")).toLowerCase())}">
  <div class="card-header">
    <span class="badge badge-${sevClass}">${sevLabel}</span>
    ${statusBadge}
  </div>
  <h3 class="card-title">${esc(ev.event_name)}</h3>
  <div class="card-meta">
    ${ev.location_name ? `<div class="meta-item"><i data-lucide="map-pin"></i><span>${esc(ev.location_name)}</span></div>` : ""}
    ${timeLine ? `<div class="meta-item"><i data-lucide="clock"></i><span>${timeLine}</span></div>` : ""}
    ${crowd}
    ${evType}
    ${zone}
  </div>
  ${desc}
  <div class="card-actions">
    ${actionLabel ? `<button class="btn-card btn-status" onclick="updateStatus(${ev.id},'${nextStatus}')">${actionLabel}</button>` : ""}
    <button class="btn-card btn-delete" onclick="deleteEvent(${ev.id})">
      <i data-lucide="trash-2"></i> Delete
    </button>
  </div>
</div>`;
}

function renderIncidentCard(ev) {
    const sev       = (ev.severity || "MEDIUM").toUpperCase();
    const sevClass  = sev.toLowerCase();
    const sevLabel  = "Severity: " + titleCase(sev);
    const statusBadge = statusHtml(ev.status);
    const reported  = ev.start_datetime
        ? `<div class="meta-item"><i data-lucide="clock"></i><span>Reported: ${relativeTime(ev.start_datetime)}</span></div>`
        : `<div class="meta-item"><i data-lucide="clock"></i><span>Reported: ${relativeTime(ev.created_at)}</span></div>`;
    const evType    = ev.event_type
        ? `<div class="meta-item"><i data-lucide="tag"></i><span>${esc(ev.event_type)}</span></div>`
        : "";
    const corridor  = ev.corridor
        ? `<div class="meta-item"><i data-lucide="navigation"></i><span>${esc(ev.corridor)}</span></div>`
        : "";
    const desc      = ev.description
        ? `<p class="card-desc">${esc(ev.description)}</p>`
        : "";
    const nextStatus = nextStatusFor(ev.status);
    const actionLabel = statusActionLabel(ev.status);

    return `
<div class="event-card report-type"
     data-id="${ev.id}"
     data-priority="${sevClass}"
     data-category="INCIDENT"
     data-search="${esc((ev.event_name + " " + (ev.location_name || "") + " " + (ev.event_type || "")).toLowerCase())}">
  <div class="card-header">
    <span class="badge badge-${sevClass}">${sevLabel}</span>
    ${statusBadge}
  </div>
  <h3 class="card-title">${esc(ev.event_name)}</h3>
  <div class="card-meta">
    ${ev.location_name ? `<div class="meta-item"><i data-lucide="map-pin"></i><span>${esc(ev.location_name)}</span></div>` : ""}
    ${reported}
    ${evType}
    ${corridor}
  </div>
  ${desc}
  <div class="card-actions">
    ${actionLabel ? `<button class="btn-card btn-status" onclick="updateStatus(${ev.id},'${nextStatus}')">${actionLabel}</button>` : ""}
    <button class="btn-card btn-delete" onclick="deleteEvent(${ev.id})">
      <i data-lucide="trash-2"></i> Delete
    </button>
  </div>
</div>`;
}

function emptyState(msg) {
    return `<div class="empty-state"><i data-lucide="inbox"></i><p>${msg}</p></div>`;
}

function showColumnError(listId, msg) {
    const el = document.getElementById(listId);
    if (el) el.innerHTML = `<div class="empty-state error-state"><p>${msg}</p></div>`;
}

// ─────────────────────────────────────────────
// SUMMARY COUNTS
// ─────────────────────────────────────────────
function updateSummary() {
    const publicCount   = allEvents.filter(e => e.event_category === "PUBLIC_EVENT").length;
    const incidentCount = allEvents.filter(e => e.event_category === "INCIDENT").length;
    const highCount     = allEvents.filter(e => e.severity === "HIGH" && e.status !== "RESOLVED").length;

    setText("summary-public",    publicCount);
    setText("summary-incidents", incidentCount);
    setText("summary-high",      highCount);
}

// ─────────────────────────────────────────────
// FILTER & SEARCH
// ─────────────────────────────────────────────
function setupFilters() {
    document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentFilter = btn.getAttribute("data-filter");
            applyFilters();
        });
    });
}

function setupSearch() {
    const input = document.getElementById("event-search");
    if (!input) return;
    input.addEventListener("input", e => {
        searchQuery = e.target.value.toLowerCase().trim();
        applyFilters();
    });
}

function applyFilters() {
    const cards = document.querySelectorAll(".event-card");
    let publicVisible   = 0;
    let incidentVisible = 0;

    // ── Weather section visibility ─────────────────────────────────────────
    const weatherSection = document.getElementById("weather-risk-section");
    const eventsMain     = document.querySelector(".events-main-section");
    const isWeatherOnly  = currentFilter === "weather";

    if (weatherSection) {
        weatherSection.classList.toggle("visible", currentFilter === "all" || isWeatherOnly);
    }
    if (eventsMain) {
        eventsMain.style.display = isWeatherOnly ? "none" : "";
    }

    // ── Weather card filtering ─────────────────────────────────────────────
    document.querySelectorAll(".weather-card").forEach(wCard => {
        const sev        = (wCard.getAttribute("data-severity") || "").toLowerCase();
        const searchData = (wCard.getAttribute("data-search") || "").toLowerCase();

        let passFilter = true;
        if (currentFilter === "high") {
            passFilter = sev === "critical" || sev === "high";
        } else if (currentFilter === "public" || currentFilter === "incidents") {
            passFilter = false; // hide weather cards for non-weather category filters
        }

        let passSearch = true;
        if (searchQuery) passSearch = searchData.includes(searchQuery);

        wCard.style.display = (passFilter && passSearch) ? "" : "none";
    });

    // ── Event card filtering ───────────────────────────────────────────────
    cards.forEach(card => {
        if (isWeatherOnly) { card.style.display = "none"; return; }

        const isPublic   = card.classList.contains("public-event-type");
        const isIncident = card.classList.contains("report-type");
        const priority   = card.getAttribute("data-priority");
        const searchData = card.getAttribute("data-search") || "";
        const titleText  = card.querySelector(".card-title")?.textContent.toLowerCase() || "";
        const descText   = card.querySelector(".card-desc")?.textContent.toLowerCase() || "";

        let passFilter = true;
        if (currentFilter === "high")       passFilter = priority === "high";
        else if (currentFilter === "public")    passFilter = isPublic;
        else if (currentFilter === "incidents") passFilter = isIncident;
        else if (currentFilter === "weather")   passFilter = false;

        let passSearch = true;
        if (searchQuery) {
            passSearch = searchData.includes(searchQuery)
                      || titleText.includes(searchQuery)
                      || descText.includes(searchQuery);
        }

        const visible = passFilter && passSearch;
        card.style.display = visible ? "block" : "none";
        if (visible && isPublic)   publicVisible++;
        if (visible && isIncident) incidentVisible++;
    });

    // Toggle column visibility
    const publicCol   = document.getElementById("public-events-col");
    const incidentCol = document.getElementById("reported-incidents-col");

    if (publicCol) {
        const hidePublic = currentFilter === "incidents" && incidentVisible > 0;
        publicCol.style.display = hidePublic ? "none" : "flex";
    }
    if (incidentCol) {
        const hideIncident = currentFilter === "public" && publicVisible > 0;
        incidentCol.style.display = hideIncident ? "none" : "flex";
    }
}

// ─────────────────────────────────────────────
// MODAL MANAGEMENT
// ─────────────────────────────────────────────
function setupModals() {
    // Open buttons
    document.getElementById("btn-open-event-modal")
        ?.addEventListener("click", () => openModal("modal-add-event"));
    document.getElementById("btn-open-incident-modal")
        ?.addEventListener("click", () => openModal("modal-report-incident"));

    // Close buttons (modal-close and Cancel buttons share data-modal attribute)
    document.querySelectorAll(".modal-close, .btn-cancel").forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.getAttribute("data-modal");
            if (target) closeModal(target);
        });
    });

    // Click outside to close
    document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
        backdrop.addEventListener("click", e => {
            if (e.target === backdrop) closeModal(backdrop.id);
        });
    });
}

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add("active");
        clearFormError(id === "modal-add-event" ? "ev-error" : "inc-error");
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove("active");
    const form = modal.querySelector("form");
    if (form) form.reset();
    clearFormError(id === "modal-add-event" ? "ev-error" : "inc-error");
}

// ─────────────────────────────────────────────
// FORM SUBMISSION
// ─────────────────────────────────────────────
function setupForms() {
    document.getElementById("form-add-event")?.addEventListener("submit", handleAddEvent);
    document.getElementById("form-report-incident")?.addEventListener("submit", handleReportIncident);
}

async function handleAddEvent(e) {
    e.preventDefault();
    const name = document.getElementById("ev-name").value.trim();
    if (!name) { showFormError("ev-error", "Event name is required."); return; }

    const date      = document.getElementById("ev-start-date").value;
    const startTime = document.getElementById("ev-start-time").value;
    const endTime   = document.getElementById("ev-end-time").value;
    const crowdVal  = document.getElementById("ev-crowd").value;

    const payload = {
        event_category: "PUBLIC_EVENT",
        event_name:     name,
        event_type:     document.getElementById("ev-type").value,
        location_name:  document.getElementById("ev-location").value.trim(),
        zone:           document.getElementById("ev-zone").value,
        corridor:       document.getElementById("ev-corridor").value.trim(),
        start_datetime: date && startTime ? `${date} ${startTime}:00` : "",
        end_datetime:   date && endTime   ? `${date} ${endTime}:00`   : "",
        expected_crowd: crowdVal ? parseInt(crowdVal, 10) : 0,
        severity:       document.getElementById("ev-severity").value,
        description:    document.getElementById("ev-description").value.trim(),
    };

    await submitEventPayload(payload, "modal-add-event", "ev-error");
}

async function handleReportIncident(e) {
    e.preventDefault();
    const name = document.getElementById("inc-name").value.trim();
    if (!name) { showFormError("inc-error", "Incident name is required."); return; }

    const payload = {
        event_category: "INCIDENT",
        event_name:     name,
        event_type:     document.getElementById("inc-type").value,
        location_name:  document.getElementById("inc-location").value.trim(),
        zone:           document.getElementById("inc-zone").value,
        corridor:       document.getElementById("inc-corridor").value.trim(),
        start_datetime: new Date().toISOString().slice(0, 19).replace("T", " "),
        severity:       document.getElementById("inc-severity").value,
        description:    document.getElementById("inc-description").value.trim(),
        status:         "ACTIVE",
    };

    await submitEventPayload(payload, "modal-report-incident", "inc-error");
}

async function submitEventPayload(payload, modalId, errorId) {
    const btn = document.querySelector(`#${modalId} .btn-submit`);
    if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }

    try {
        const res  = await fetch("/api/events/add", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to save.");

        closeModal(modalId);
        await loadEvents();
    } catch (err) {
        showFormError(errorId, err.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Save"; }
    }
}

// ─────────────────────────────────────────────
// STATUS UPDATE
// ─────────────────────────────────────────────
async function updateStatus(eventId, newStatus) {
    try {
        const res  = await fetch(`/api/events/update/${eventId}`, {
            method:  "PUT",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ status: newStatus }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Update failed.");

        // Update local state
        const idx = allEvents.findIndex(e => e.id === eventId);
        if (idx !== -1) allEvents[idx] = data.event;
        renderAll();
        updateSummary();
    } catch (err) {
        console.error("updateStatus:", err);
        alert("Could not update status: " + err.message);
    }
}

// ─────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────
async function deleteEvent(eventId) {
    const ev = allEvents.find(e => e.id === eventId);
    const name = ev ? ev.event_name : `Event #${eventId}`;
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    try {
        const res  = await fetch(`/api/events/delete/${eventId}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Delete failed.");

        allEvents = allEvents.filter(e => e.id !== eventId);
        renderAll();
        updateSummary();
    } catch (err) {
        console.error("deleteEvent:", err);
        alert("Could not delete event: " + err.message);
    }
}

// ─────────────────────────────────────────────
// WEATHER ALERTS
// ─────────────────────────────────────────────

async function loadWeatherAlerts() {
    try {
        const res  = await fetch("/api/weather/alerts");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load weather alerts.");
        allWeatherAlerts = data.alerts || [];
        renderWeatherSection();
        updateWeatherSummary();
    } catch (err) {
        console.error("loadWeatherAlerts:", err);
        const list = document.getElementById("weather-alerts-list");
        if (list) list.innerHTML = `<div class="weather-empty-state"><p>Could not load weather alerts.</p></div>`;
    }
}

function renderWeatherSection() {
    const list = document.getElementById("weather-alerts-list");
    if (!list) return;

    if (!allWeatherAlerts.length) {
        list.innerHTML = `
            <div class="weather-empty-state">
                <i data-lucide="sun"></i>
                <p>No active weather alerts for Bengaluru.</p>
            </div>`;
        reinitIcons();
        return;
    }

    list.innerHTML = allWeatherAlerts.map(renderWeatherCard).join("");

    // Last-updated timestamp
    const ts = document.getElementById("weather-last-updated");
    if (ts) {
        const now = new Date();
        ts.textContent = `Updated: ${now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
    }

    reinitIcons();
    applyFilters();
}

function renderWeatherCard(alert) {
    const sev     = (alert.severity || "HIGH").toUpperCase();
    const status  = (alert.status   || "ACTIVE").toUpperCase();
    const badgeCls = `weather-badge-${sev.toLowerCase()}`;

    // Metrics row — only show non-zero values
    const metrics = [];
    if (alert.rainfall_mm   > 0) metrics.push({ label: "Rainfall",    val: `${alert.rainfall_mm} mm/hr` });
    if (alert.wind_speed_kmh > 0) metrics.push({ label: "Wind",       val: `${alert.wind_speed_kmh} km/h` });
    if (alert.visibility_m  > 0) metrics.push({ label: "Visibility", val: `${alert.visibility_m} m` });

    const metricsHtml = metrics.length ? `
        <div class="weather-metrics-row">
            ${metrics.map(m => `
                <div class="weather-metric">
                    <span class="weather-metric-label">${m.label}</span>
                    <span class="weather-metric-value">${m.val}</span>
                </div>`).join("")}
        </div>` : "";

    // Time window
    const timeHtml = (alert.valid_from || alert.valid_until) ? `
        <div class="weather-time-chip">
            <i data-lucide="clock"></i>
            ${alert.valid_from ? fmtWeatherTime(alert.valid_from) : "Now"}
            ${alert.valid_until ? ` — ${fmtWeatherTime(alert.valid_until)}` : ""}
        </div>` : "";

    // Affected roads tags
    const roadsHtml = alert.affected_roads ? `
        <div class="weather-roads-row">
            ${alert.affected_roads.split(",").map(r => `<span class="weather-road-tag">${esc(r.trim())}</span>`).join("")}
        </div>` : "";

    const impactHtml = "";
    const actionHtml = "";

    // Convert button — disabled if already MONITORING (converted)
    const alreadyConverted = status === "MONITORING";
    const convertBtn = alreadyConverted
        ? `<span class="weather-converted-tag"><i data-lucide="check-circle-2"></i> Logged as Incident</span>`
        : `<button class="btn-convert-incident" onclick="convertToIncident(${alert.id})">
               <i data-lucide="arrow-up-right"></i> Log as Incident
           </button>`;

    const sourceHtml = alert.source
        ? `<span class="weather-source-tag"><i data-lucide="radio"></i>${esc(alert.source)}</span>`
        : "";

    const statusChip = status === "ACTIVE"
        ? `<span class="weather-status-chip status-active">Active</span>`
        : `<span class="weather-status-chip">${titleCase(status)}</span>`;

    const searchText = [
        alert.condition_name, alert.affected_area, alert.zone || "",
        alert.alert_type, sev, alert.traffic_impact || "", alert.affected_roads || "",
    ].join(" ").toLowerCase();

    return `
<div class="weather-card ${alreadyConverted ? "status-monitoring" : ""}"
     data-id="${alert.id}"
     data-severity="${sev}"
     data-search="${esc(searchText)}">
  <div class="weather-card-header">
    <div class="weather-card-title-block">
      <span class="weather-card-name">${esc(alert.condition_name)}</span>
      <span class="weather-card-area">
        <i data-lucide="map-pin"></i>${esc(alert.affected_area)}${alert.zone ? ` &bull; ${esc(alert.zone)}` : ""}
      </span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;">
      <span class="weather-badge ${badgeCls}">${sev}</span>
      ${statusChip}
    </div>
  </div>
  ${metricsHtml}
  ${timeHtml}
  ${roadsHtml}
  ${impactHtml}
  ${actionHtml}
  <div class="weather-card-footer">
    ${sourceHtml}
    ${convertBtn}
    <button class="btn-dismiss-alert" onclick="dismissAlert(${alert.id})">
      <i data-lucide="x"></i> Dismiss
    </button>
  </div>
</div>`;
}

function updateWeatherSummary() {
    const active = allWeatherAlerts.length;
    setText("summary-weather", active || "0");

    const countEl = document.getElementById("weather-alert-count");
    if (countEl) {
        const critical = allWeatherAlerts.filter(a => a.severity === "CRITICAL").length;
        countEl.textContent = critical > 0
            ? `${active} Active Alerts (${critical} Critical)`
            : `${active} Active Alert${active !== 1 ? "s" : ""}`;
    }
}

async function convertToIncident(alertId) {
    const btn = document.querySelector(`.weather-card[data-id="${alertId}"] .btn-convert-incident`);
    if (btn) { btn.disabled = true; btn.textContent = "Logging..."; }

    try {
        const res  = await fetch(`/api/weather/alerts/${alertId}/convert`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Conversion failed.");

        // Refresh both lists
        await Promise.all([loadEvents(), loadWeatherAlerts()]);
    } catch (err) {
        console.error("convertToIncident:", err);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="arrow-up-right"></i> Log as Incident'; reinitIcons(); }
        alert("Could not log as incident: " + err.message);
    }
}

async function dismissAlert(alertId) {
    const card = document.querySelector(`.weather-card[data-id="${alertId}"]`);
    const name = card?.querySelector(".weather-card-name")?.textContent || `Alert #${alertId}`;
    if (!confirm(`Dismiss "${name}"?`)) return;

    try {
        const res  = await fetch(`/api/weather/alerts/${alertId}`, {
            method:  "PUT",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ status: "DISMISSED" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Dismiss failed.");

        allWeatherAlerts = allWeatherAlerts.filter(a => a.id !== alertId);
        renderWeatherSection();
        updateWeatherSummary();
    } catch (err) {
        console.error("dismissAlert:", err);
        alert("Could not dismiss alert: " + err.message);
    }
}

function fmtWeatherTime(dtStr) {
    if (!dtStr) return "";
    const d = new Date(dtStr);
    if (isNaN(d)) return dtStr;
    return d.toLocaleString("en-IN", {
        day: "numeric", month: "short",
        hour: "2-digit", minute: "2-digit",
    });
}

// ─────────────────────────────────────────────
// UTILITY HELPERS
// ─────────────────────────────────────────────
function esc(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
}

function titleCase(str) {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function statusHtml(status) {
    const map = {
        UPCOMING: "status-upcoming",
        ACTIVE:   "status-active",
        RESOLVED: "status-resolved",
    };
    const cls   = map[status] || "status-upcoming";
    const label = titleCase(status || "UPCOMING");
    return `<span class="status-badge ${cls}">${label}</span>`;
}

function nextStatusFor(status) {
    if (status === "UPCOMING") return "ACTIVE";
    if (status === "ACTIVE")   return "RESOLVED";
    return "ACTIVE";
}

function statusActionLabel(status) {
    if (status === "UPCOMING") return "Mark Active";
    if (status === "ACTIVE")   return "Resolve";
    if (status === "RESOLVED") return "Reopen";
    return "";
}

function formatTimeRange(start, end) {
    if (!start) return "";
    const s = new Date(start);
    if (isNaN(s)) return start;
    const startStr = s.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const dateStr  = s.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    if (end) {
        const e = new Date(end);
        if (!isNaN(e)) {
            const endStr = e.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
            return `${dateStr}, ${startStr} – ${endStr}`;
        }
    }
    return `${dateStr}, ${startStr}`;
}

function relativeTime(dtStr) {
    if (!dtStr) return "Unknown";
    const dt   = new Date(dtStr);
    if (isNaN(dt)) return dtStr;
    const diff = Math.floor((Date.now() - dt.getTime()) / 1000);
    if (diff < 60)   return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function showFormError(errorId, msg) {
    const el = document.getElementById(errorId);
    if (el) { el.textContent = msg; el.style.display = "block"; }
}

function clearFormError(errorId) {
    const el = document.getElementById(errorId);
    if (el) { el.textContent = ""; el.style.display = "none"; }
}

function reinitIcons() {
    if (typeof lucide !== "undefined") {
        lucide.createIcons();
    }
}
