"use strict";

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let cMap          = null;
let routeLayer    = null;
let markerLayers  = [];
let fromMarker    = null;
let toMarker      = null;
let currentRoute  = null;

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    initCitizenMap();
    loadRouteLocations();
    setupRouteBar();
    loadMapMarkers();

    // Pre-fill from query string e.g. /citizen/map?from=Indiranagar&to=Electronic+City
    const params = new URLSearchParams(window.location.search);
    if (params.get("from")) document.getElementById("route-from").value = params.get("from");
    if (params.get("to"))   document.getElementById("route-to").value   = params.get("to");
    if (params.get("from") && params.get("to")) getRoute();
});

// ─────────────────────────────────────────────
// MAP INIT
// ─────────────────────────────────────────────
function initCitizenMap() {
    cMap = L.map("citizen-leaflet-map", {
        center: [12.9716, 77.5946],
        zoom: 12,
        minZoom: 10,
        maxZoom: 17,
        zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 20,
    }).addTo(cMap);
}

// ─────────────────────────────────────────────
// LOAD CONTEXT MARKERS (incidents, events, weather)
// ─────────────────────────────────────────────
async function loadMapMarkers() {
    try {
        const [incRes, evRes, wxRes] = await Promise.all([
            fetch("/api/events/incidents"),
            fetch("/api/events/public"),
            fetch("/api/weather/alerts"),
        ]);
        const incData = incRes.ok ? await incRes.json() : {};
        const evData  = evRes.ok  ? await evRes.json()  : {};
        const wxData  = wxRes.ok  ? await wxRes.json()  : {};

        clearMarkers();

        (incData.events || []).forEach(inc => {
            if (!inc.latitude || !inc.longitude) return;
            const icon = createDotIcon("#ef4444", "I");
            const m = L.marker([inc.latitude, inc.longitude], { icon })
                .bindPopup(incidentPopup(inc))
                .addTo(cMap);
            markerLayers.push(m);
        });

        (evData.events || []).forEach(ev => {
            if (!ev.latitude || !ev.longitude) return;
            const icon = createDotIcon("#f97316", "E");
            const m = L.marker([ev.latitude, ev.longitude], { icon })
                .bindPopup(eventPopup(ev))
                .addTo(cMap);
            markerLayers.push(m);
        });

        (wxData.alerts || []).forEach(w => {
            if (!w.latitude || !w.longitude) return;
            const icon = createDotIcon("#38bdf8", "W");
            const m = L.marker([w.latitude, w.longitude], { icon })
                .bindPopup(weatherPopup(w))
                .addTo(cMap);
            markerLayers.push(m);
        });
    } catch (err) {
        console.error("loadMapMarkers:", err);
    }
}

function clearMarkers() {
    markerLayers.forEach(m => cMap.removeLayer(m));
    markerLayers = [];
}

function createDotIcon(color, letter) {
    return L.divIcon({
        html: `<div style="
            width:26px;height:26px;border-radius:50%;
            background:${color};
            border:2px solid #fff;
            display:flex;align-items:center;justify-content:center;
            font-size:10px;font-weight:800;color:#fff;
            box-shadow:0 2px 8px rgba(0,0,0,0.4);
            font-family:'Outfit',sans-serif;
        ">${letter}</div>`,
        className: "",
        iconSize:   [26, 26],
        iconAnchor: [13, 13],
    });
}

function incidentPopup(inc) {
    const sev = (inc.severity || "MEDIUM");
    return `<div style="min-width:180px">
        <strong style="font-size:0.9rem">${esc(inc.event_name)}</strong><br>
        <span style="color:#888;font-size:0.78rem">${esc(inc.location_name || "")}</span><br>
        <span style="color:#ef4444;font-size:0.75rem;font-weight:700">${sev} SEVERITY</span>
    </div>`;
}

function eventPopup(ev) {
    return `<div style="min-width:180px">
        <strong style="font-size:0.9rem">${esc(ev.event_name)}</strong><br>
        <span style="color:#888;font-size:0.78rem">${esc(ev.location_name || "")}</span><br>
        <span style="color:#f97316;font-size:0.75rem;font-weight:700">PUBLIC EVENT</span>
    </div>`;
}

function weatherPopup(w) {
    return `<div style="min-width:180px">
        <strong style="font-size:0.9rem">${esc(w.condition_name)}</strong><br>
        <span style="color:#888;font-size:0.78rem">${esc(w.affected_area || "")}</span><br>
        <span style="color:#38bdf8;font-size:0.75rem;font-weight:700">${w.severity} WEATHER</span>
    </div>`;
}

// ─────────────────────────────────────────────
// ROUTE BAR
// ─────────────────────────────────────────────
function setupRouteBar() {
    document.getElementById("btn-get-route")?.addEventListener("click", getRoute);
    document.getElementById("btn-swap-route")?.addEventListener("click", swapLocations);
    document.getElementById("btn-new-route")?.addEventListener("click",  resetRoute);
    document.getElementById("btn-retry-route")?.addEventListener("click", getRoute);

    document.getElementById("route-from")?.addEventListener("keydown", e => { if (e.key === "Enter") getRoute(); });
    document.getElementById("route-to")?.addEventListener("keydown",   e => { if (e.key === "Enter") getRoute(); });
}

function swapLocations() {
    const fromIn = document.getElementById("route-from");
    const toIn   = document.getElementById("route-to");
    if (!fromIn || !toIn) return;
    [fromIn.value, toIn.value] = [toIn.value, fromIn.value];
}

function resetRoute() {
    showPanel("empty");
    clearRouteLayer();
    if (fromMarker) { cMap.removeLayer(fromMarker); fromMarker = null; }
    if (toMarker)   { cMap.removeLayer(toMarker);   toMarker   = null; }
    document.getElementById("route-from").value = "";
    document.getElementById("route-to").value   = "";
    document.getElementById("route-bar-status").style.display = "none";
    currentRoute = null;
}

// ─────────────────────────────────────────────
// GET ROUTE
// ─────────────────────────────────────────────
async function getRoute() {
    const from = document.getElementById("route-from")?.value.trim();
    const to   = document.getElementById("route-to")?.value.trim();

    if (!from || !to) {
        setBarStatus("Enter both a start and destination location.");
        return;
    }

    showPanel("loading");
    clearRouteLayer();

    const btn = document.getElementById("btn-get-route");
    if (btn) { btn.disabled = true; }

    try {
        const res  = await fetch("/api/citizen/route", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ from, to }),
        });
        const data = await res.json();

        if (!res.ok) {
            showError(data.error || "Could not calculate route.");
            return;
        }

        currentRoute = data;
        drawRouteOnMap(data);
        renderRoutePanel(data);
        showPanel("result");
        setBarStatus(`Route found: ${data.total_distance_km} km · ${data.total_time_min} min`);
    } catch (err) {
        console.error("getRoute:", err);
        showError("Network error — could not reach the route planner.");
    } finally {
        if (btn) { btn.disabled = false; }
    }
}

// ─────────────────────────────────────────────
// DRAW ROUTE ON MAP
// ─────────────────────────────────────────────
function clearRouteLayer() {
    if (routeLayer) { cMap.removeLayer(routeLayer); routeLayer = null; }
    if (fromMarker) { cMap.removeLayer(fromMarker); fromMarker = null; }
    if (toMarker)   { cMap.removeLayer(toMarker);   toMarker   = null; }
}

function drawRouteOnMap(data) {
    if (!data.route_coords || !data.route_coords.length) return;

    const coords = data.route_coords.map(c => [c.lat, c.lng]);

    // Draw polyline
    routeLayer = L.polyline(coords, {
        color:  "#3b82f6",
        weight: 6,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
        dashArray: null,
    }).addTo(cMap);

    // From marker (green)
    const fromCoord = coords[0];
    fromMarker = L.marker(fromCoord, {
        icon: createEndpointIcon("#22c55e", "A"),
    }).bindPopup(`<strong>Start:</strong> ${esc(data.from)}`).addTo(cMap);

    // To marker (red)
    const toCoord = coords[coords.length - 1];
    toMarker = L.marker(toCoord, {
        icon: createEndpointIcon("#ef4444", "B"),
    }).bindPopup(`<strong>Destination:</strong> ${esc(data.to)}`).addTo(cMap);

    // Fit map to route
    const bounds = L.latLngBounds(coords);
    cMap.fitBounds(bounds, { padding: [60, 60] });
}

function createEndpointIcon(color, letter) {
    return L.divIcon({
        html: `<div style="
            width:32px;height:32px;border-radius:50%;
            background:${color};border:3px solid #fff;
            display:flex;align-items:center;justify-content:center;
            font-size:12px;font-weight:900;color:#fff;
            box-shadow:0 3px 10px rgba(0,0,0,0.45);
            font-family:'Outfit',sans-serif;
        ">${letter}</div>`,
        className: "",
        iconSize:   [32, 32],
        iconAnchor: [16, 16],
    });
}

// ─────────────────────────────────────────────
// RENDER ROUTE PANEL
// ─────────────────────────────────────────────
function renderRoutePanel(data) {
    // Header
    setInner("rr-from",    esc(data.from));
    setInner("rr-to",      esc(data.to));
    setInner("rr-time",    `<i data-lucide="clock"></i> ${data.total_time_min} min`);
    setInner("rr-dist",    `<i data-lucide="ruler"></i> ${data.total_distance_km} km`);
    setInner("rr-summary", esc(data.summary));

    // Alerts along route
    const alertsSection = document.getElementById("rr-alerts-section");
    const alertsList    = document.getElementById("rr-alerts-list");
    if (data.alerts && data.alerts.length && alertsSection && alertsList) {
        alertsList.innerHTML = data.alerts.map(a => {
            const cls  = a.type === "WEATHER"  ? "alert-weather"
                       : a.type === "EVENT"    ? "alert-event" : "";
            const icon = a.type === "WEATHER"  ? "cloud-rain"
                       : a.type === "EVENT"    ? "calendar"    : "alert-triangle";
            return `
<div class="rr-alert-item ${cls}">
  <i data-lucide="${icon}" class="rr-alert-icon"></i>
  <div class="rr-alert-text">
    <strong>${esc(a.message)}</strong>
    ${a.location ? `<span>${esc(a.location)}</span>` : ""}
  </div>
</div>`;
        }).join("");
        alertsSection.style.display = "block";
    } else if (alertsSection) {
        alertsSection.style.display = "none";
    }

    // Steps
    const stepsEl = document.getElementById("rr-steps");
    if (stepsEl && data.route) {
        stepsEl.innerHTML = data.route.map((seg, i) => {
            const congCls  = `cong-${seg.congestion}`;
            const chipCls  = `cong-chip-${seg.congestion}`;
            const chipText = seg.congestion === "high"   ? "Heavy"
                           : seg.congestion === "medium" ? "Moderate" : "Clear";
            return `
<div class="rr-step">
  <div class="rr-step-dot ${congCls}"></div>
  <div class="rr-step-body">
    <div class="rr-step-road">${esc(seg.road)}</div>
    <div class="rr-step-meta">
      <span style="display:flex;align-items:center;gap:4px;">
        <i data-lucide="map-pin"></i>${esc(seg.from)} → ${esc(seg.to)}
      </span>
      <span style="display:flex;align-items:center;gap:4px;">
        <i data-lucide="clock"></i>${seg.time_min} min
      </span>
      <span style="display:flex;align-items:center;gap:4px;">
        <i data-lucide="ruler"></i>${seg.distance_km} km
      </span>
      <span class="rr-cong-chip ${chipCls}">${chipText}</span>
    </div>
  </div>
</div>`;
        }).join("");
    }

    // Avoided roads
    const avoidedSection = document.getElementById("rr-avoided-section");
    const avoidedList    = document.getElementById("rr-avoided-list");
    if (data.avoided && data.avoided.length && avoidedSection && avoidedList) {
        avoidedList.innerHTML = data.avoided.map(av => `
<div class="rr-avoided-item">
  <div>
    <span class="rr-avoided-road">${esc(av.road)}</span>
    <span class="rr-avoided-reason">${esc(av.reason)}</span>
  </div>
</div>`).join("");
        avoidedSection.style.display = "block";
    } else if (avoidedSection) {
        avoidedSection.style.display = "none";
    }

    reinitIcons();
}

// ─────────────────────────────────────────────
// PANEL STATE MANAGEMENT
// ─────────────────────────────────────────────
function showPanel(state) {
    const panels = ["empty", "result", "loading", "error"];
    panels.forEach(p => {
        const el = document.getElementById(`route-panel-${p}`);
        if (el) el.style.display = p === state ? "flex" : "none";
    });
    // result panel is a div not flex
    const resultEl = document.getElementById("route-panel-result");
    if (resultEl) resultEl.style.display = state === "result" ? "flex" : "none";
}

function showError(msg) {
    const msgEl = document.getElementById("route-error-msg");
    if (msgEl) msgEl.textContent = msg;
    showPanel("error");
    setBarStatus(msg);
}

function setBarStatus(msg) {
    const bar = document.getElementById("route-bar-status");
    if (bar) { bar.textContent = msg; bar.style.display = "block"; }
}

// ─────────────────────────────────────────────
// AUTOCOMPLETE FOR ROUTE INPUTS
// ─────────────────────────────────────────────
async function loadRouteLocations() {
    try {
        const res  = await fetch("/api/citizen/locations");
        const data = await res.json();
        const dl   = document.getElementById("route-locations");
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

function setInner(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

function reinitIcons() {
    if (typeof lucide !== "undefined") lucide.createIcons();
}
