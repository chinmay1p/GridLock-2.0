"use strict";

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    loadDashboard();
    loadLocationsForAutocomplete();
    setupReportModal();
});

// ─────────────────────────────────────────────
// FETCH EVERYTHING
// ─────────────────────────────────────────────
async function loadDashboard() {
    try {
        const res  = await fetch("/api/citizen/city-summary");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load city summary");

        renderHero(data.congestion, data.updated_at);
        renderPulseStrip(data.incidents, data.events, data.weather, data.updated_at);
        renderEvents(data.events.list);
        renderIncidents(data.incidents.list);
        renderWeather(data.weather.alerts);
    } catch (err) {
        console.error("loadDashboard:", err);
        setEl("events-list",    errorState("Could not load events."));
        setEl("incidents-list", errorState("Could not load incidents."));
        setEl("weather-list",   errorState("Could not load weather alerts."));
    }
}

// ─────────────────────────────────────────────
// HERO
// ─────────────────────────────────────────────
function renderHero(congestion, updatedAt) {
    const chip  = document.getElementById("city-status-chip");
    const label = document.getElementById("city-status-label");
    if (!chip || !label) return;

    const level = (congestion.level || "CLEAR").toUpperCase();
    label.textContent = congestion.label || "Traffic Normal";

    chip.className = "city-status-chip";
    if (level === "HIGH")   chip.classList.add("status-high");
    if (level === "MEDIUM") chip.classList.add("status-medium");
}

// ─────────────────────────────────────────────
// PULSE STRIP
// ─────────────────────────────────────────────
function renderPulseStrip(incidents, events, weather, updatedAt) {
    const incEl  = document.getElementById("pulse-inc-count");
    const evEl   = document.getElementById("pulse-ev-count");
    const wxEl   = document.getElementById("pulse-wx-count");
    const tsEl   = document.getElementById("pulse-updated");

    if (incEl) {
        incEl.textContent = incidents.total;
        if (incidents.high > 0) incEl.classList.add("has-high");
    }
    if (evEl) evEl.textContent = events.total;
    if (wxEl) wxEl.textContent = weather.total;
    if (tsEl) tsEl.textContent = updatedAt || "—";
}

// ─────────────────────────────────────────────
// RENDER — PUBLIC EVENTS
// ─────────────────────────────────────────────
function renderEvents(list) {
    const container = document.getElementById("events-list");
    if (!container) return;

    if (!list || !list.length) {
        container.innerHTML = emptyState("No upcoming events disrupting traffic.");
        reinitIcons();
        return;
    }

    container.innerHTML = list.map(ev => {
        const sev  = (ev.severity || "MEDIUM").toUpperCase();
        const time = formatEventTime(ev.start_datetime, ev.end_datetime);
        const crowd = ev.expected_crowd > 0
            ? `<div class="citizen-card-meta-item"><i data-lucide="users"></i>${Number(ev.expected_crowd).toLocaleString()} expected</div>`
            : "";
        const impactClass = sev === "HIGH" ? "impact-high" : sev === "MEDIUM" ? "impact-medium" : "";
        const impactText  = sev === "HIGH"
            ? "Expect heavy traffic disruption"
            : sev === "MEDIUM" ? "Moderate traffic impact" : "Minor traffic impact";

        return `
<div class="citizen-card">
  <div class="citizen-card-header">
    <span class="citizen-card-title">${esc(ev.event_name)}</span>
    <span class="citizen-badge badge-${sev.toLowerCase()}">${titleCase(sev)}</span>
  </div>
  <div class="citizen-card-meta">
    ${ev.location_name ? `<div class="citizen-card-meta-item"><i data-lucide="map-pin"></i>${esc(ev.location_name)}</div>` : ""}
    ${time             ? `<div class="citizen-card-meta-item"><i data-lucide="clock"></i>${time}</div>`                    : ""}
    ${ev.event_type    ? `<div class="citizen-card-meta-item"><i data-lucide="tag"></i>${esc(ev.event_type)}</div>`        : ""}
    ${crowd}
  </div>
  <div class="citizen-card-impact ${impactClass}">
    <i data-lucide="triangle-alert"></i> ${impactText}
  </div>
</div>`;
    }).join("");

    reinitIcons();
}

// ─────────────────────────────────────────────
// RENDER — INCIDENTS
// ─────────────────────────────────────────────
function renderIncidents(list) {
    const container = document.getElementById("incidents-list");
    if (!container) return;

    if (!list || !list.length) {
        container.innerHTML = emptyState("No active incidents reported.");
        reinitIcons();
        return;
    }

    container.innerHTML = list.map(inc => {
        const sev  = (inc.severity || "MEDIUM").toUpperCase();
        const when = relTime(inc.start_datetime || inc.created_at);
        const icon = incidentIcon(inc.event_type);
        const desc = inc.description
            ? `<p class="citizen-card-desc">${esc(inc.description)}</p>` : "";

        return `
<div class="citizen-card">
  <div class="citizen-card-header">
    <span class="citizen-card-title">${esc(inc.event_name)}</span>
    <span class="citizen-badge badge-${sev.toLowerCase()}">${titleCase(sev)}</span>
  </div>
  <div class="citizen-card-meta">
    ${inc.location_name ? `<div class="citizen-card-meta-item"><i data-lucide="map-pin"></i>${esc(inc.location_name)}</div>` : ""}
    <div class="citizen-card-meta-item"><i data-lucide="clock"></i>${when}</div>
    ${inc.event_type ? `<div class="citizen-card-meta-item"><i data-lucide="${icon}"></i>${esc(inc.event_type)}</div>` : ""}
    ${inc.corridor   ? `<div class="citizen-card-meta-item"><i data-lucide="navigation"></i>${esc(inc.corridor)}</div>` : ""}
  </div>
  ${desc}
</div>`;
    }).join("");

    reinitIcons();
}

// ─────────────────────────────────────────────
// RENDER — WEATHER
// ─────────────────────────────────────────────
function renderWeather(list) {
    const container = document.getElementById("weather-list");
    if (!container) return;

    if (!list || !list.length) {
        container.innerHTML = emptyState("No active weather alerts.");
        reinitIcons();
        return;
    }

    container.innerHTML = list.map(w => {
        const sev  = (w.severity || "HIGH").toUpperCase();
        const badgeCls = sev === "CRITICAL" ? "badge-critical"
                       : sev === "WATCH"    ? "badge-watch"
                       : `badge-${sev.toLowerCase()}`;

        const metrics = [];
        if (w.rainfall_mm    > 0) metrics.push({ label: "Rain",       val: `${w.rainfall_mm} mm/hr` });
        if (w.wind_speed_kmh > 0) metrics.push({ label: "Wind",       val: `${w.wind_speed_kmh} km/h` });
        if (w.visibility_m   > 0) metrics.push({ label: "Visibility", val: `${w.visibility_m} m` });

        const metricsHtml = metrics.length
            ? `<div class="citizen-card-weather-metrics">
                 ${metrics.map(m => `
                   <div class="weather-metric-mini">
                     <span class="label">${m.label}</span>
                     <span class="value">${m.val}</span>
                   </div>`).join("")}
               </div>` : "";

        const timeHtml = w.valid_from
            ? `<div class="citizen-card-meta-item"><i data-lucide="clock"></i>${fmtTime(w.valid_from)}${w.valid_until ? ` — ${fmtTime(w.valid_until)}` : ""}</div>`
            : "";

        return `
<div class="citizen-card">
  <div class="citizen-card-header">
    <span class="citizen-card-title">${esc(w.condition_name)}</span>
    <span class="citizen-badge ${badgeCls}">${sev}</span>
  </div>
  <div class="citizen-card-meta">
    <div class="citizen-card-meta-item"><i data-lucide="map-pin"></i>${esc(w.affected_area)}</div>
    ${timeHtml}
  </div>
  ${metricsHtml}
  ${w.affected_roads ? `<div class="citizen-card-desc">${esc(w.affected_roads)}</div>` : ""}
</div>`;
    }).join("");

    reinitIcons();
}

// ─────────────────────────────────────────────
// REPORT INCIDENT MODAL
// ─────────────────────────────────────────────
function setupReportModal() {
    document.getElementById("btn-open-report-modal")?.addEventListener("click", openModal);
    document.getElementById("btn-close-report-modal")?.addEventListener("click", closeModal);
    document.getElementById("btn-cancel-report")?.addEventListener("click", closeModal);
    document.getElementById("form-citizen-report")?.addEventListener("submit", submitReport);

    document.getElementById("modal-report")?.addEventListener("click", e => {
        if (e.target === document.getElementById("modal-report")) closeModal();
    });
}

function openModal() {
    const modal = document.getElementById("modal-report");
    if (modal) {
        modal.classList.add("active");
        clearStatus();
    }
}

function closeModal() {
    const modal = document.getElementById("modal-report");
    if (modal) {
        modal.classList.remove("active");
        document.getElementById("form-citizen-report")?.reset();
        clearStatus();
    }
}

async function submitReport(e) {
    e.preventDefault();
    clearStatus();

    const location = document.getElementById("rep-location").value.trim();
    if (!location) {
        showError("Location is required — please enter where you saw the problem.");
        return;
    }

    const type     = document.getElementById("rep-type").value;
    const severity = document.getElementById("rep-severity").value;
    const desc     = document.getElementById("rep-description").value.trim();

    const btn = document.getElementById("btn-submit-report");
    if (btn) { btn.disabled = true; btn.textContent = "Submitting…"; }

    const payload = {
        event_category: "INCIDENT",
        event_name:     `${type} — ${location}`,
        event_type:     type,
        location_name:  location,
        severity:       severity,
        status:         "ACTIVE",
        description:    `[Citizen Report] ${desc}`.trim(),
    };

    try {
        const res  = await fetch("/api/events/add", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Submission failed.");

        document.getElementById("rep-success").style.display = "flex";
        document.getElementById("form-citizen-report").reset();

        // Auto-close after 3s and refresh dashboard
        setTimeout(async () => {
            closeModal();
            await loadDashboard();
        }, 3000);
    } catch (err) {
        showError(err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="send"></i> Submit Report';
            reinitIcons();
        }
    }
}

function showError(msg) {
    const el = document.getElementById("rep-error");
    if (el) { el.textContent = msg; el.style.display = "block"; }
}

function clearStatus() {
    const errEl = document.getElementById("rep-error");
    const sucEl = document.getElementById("rep-success");
    if (errEl) { errEl.textContent = ""; errEl.style.display = "none"; }
    if (sucEl) sucEl.style.display = "none";
}

// ─────────────────────────────────────────────
// AUTOCOMPLETE FOR REPORT LOCATION
// ─────────────────────────────────────────────
async function loadLocationsForAutocomplete() {
    try {
        const res  = await fetch("/api/citizen/locations");
        const data = await res.json();
        const dl = document.getElementById("location-suggestions");
        if (!dl) return;
        (data.locations || []).forEach(loc => {
            const opt = document.createElement("option");
            opt.value = loc.name;
            dl.appendChild(opt);
        });
    } catch (_) {}
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function esc(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function titleCase(str) {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function setEl(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

function emptyState(msg) {
    return `<div class="citizen-empty"><i data-lucide="inbox"></i><p>${msg}</p></div>`;
}

function errorState(msg) {
    return `<div class="citizen-empty"><p style="color:#ef4444">${msg}</p></div>`;
}

function reinitIcons() {
    if (typeof lucide !== "undefined") lucide.createIcons();
}

function relTime(dtStr) {
    if (!dtStr) return "Unknown";
    const dt   = new Date(dtStr);
    if (isNaN(dt)) return dtStr;
    const diff = Math.floor((Date.now() - dt.getTime()) / 1000);
    if (diff < 60)    return "Just now";
    if (diff < 3600)  return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
    return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function formatEventTime(start, end) {
    if (!start) return "";
    const s = new Date(start);
    if (isNaN(s)) return start;
    const dateStr  = s.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    const startStr = s.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    if (end) {
        const e = new Date(end);
        if (!isNaN(e)) {
            const endStr = e.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
            return `${dateStr}, ${startStr}–${endStr}`;
        }
    }
    return `${dateStr}, ${startStr}`;
}

function fmtTime(dtStr) {
    if (!dtStr) return "";
    const d = new Date(dtStr);
    if (isNaN(d)) return dtStr;
    return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function incidentIcon(type) {
    if (!type) return "alert-circle";
    const t = type.toLowerCase();
    if (t.includes("accident"))         return "car-crash";
    if (t.includes("breakdown"))        return "wrench";
    if (t.includes("water") || t.includes("flood")) return "droplets";
    if (t.includes("tree"))             return "tree-pine";
    if (t.includes("pothole"))          return "triangle-alert";
    if (t.includes("construction"))     return "traffic-cone";
    if (t.includes("jam"))              return "car";
    return "alert-circle";
}
