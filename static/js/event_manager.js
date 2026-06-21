// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Event Manager & Scenario Coordinator
 */

class EventManager {
    constructor() {
        this.activeEventMode = false;
        this.selectedCoordinates = null;
        this.selectedEdgeId = null;
        this.selectedRoadName = "";
        this.animationEngine = null;
        this.visualizer = null;
        
        // Element references
        this.btnAddEvent = document.getElementById('btn-add-event');
        this.btnResetCity = document.getElementById('btn-reset-city');
        this.modeIndicator = document.getElementById('event-mode-indicator');
        this.drawer = document.getElementById('event-creation-drawer');
        this.btnCloseDrawer = document.getElementById('btn-close-event-drawer');
        
        this.selectType = document.getElementById('event-type');
        this.inputDuration = document.getElementById('event-duration');
        this.selectPriority = document.getElementById('event-priority');
        this.selectLanes = document.getElementById('event-lanes');
        
        this.lblRoadName = document.getElementById('event-road-name');
        this.lblCoords = document.getElementById('event-coords');
        this.dynamicBox = document.getElementById('dynamic-fields-box');
        this.btnSimulate = document.getElementById('btn-submit-simulation');
        
        this.init();
    }

    init() {
        // Bind UI triggers
        if (this.btnAddEvent) {
            this.btnAddEvent.addEventListener('click', () => this.toggleEventMode());
        }
        if (this.btnCloseDrawer) {
            this.btnCloseDrawer.addEventListener('click', () => this.closeDrawer());
        }
        if (this.selectType) {
            this.selectType.addEventListener('change', () => this.renderDynamicFields());
        }
        if (this.btnSimulate) {
            this.btnSimulate.addEventListener('click', () => this.submitSimulation());
        }
        if (this.btnResetCity) {
            this.btnResetCity.addEventListener('click', () => this.resetCity());
        }

        // Setup Presets
        document.querySelectorAll('.preset-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const presetType = card.getAttribute('data-preset');
                this.loadPreset(presetType);
            });
        });

        // Load Event Types
        this.fetchEventTypes();
    }

    setEngines(animationEngine, visualizer) {
        this.animationEngine = animationEngine;
        this.visualizer = visualizer;
    }

    async fetchEventTypes() {
        try {
            const res = await fetch('/api/events/types');
            if (res.ok) {
                const types = await res.json();
                this.selectType.innerHTML = '';
                types.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = t.name;
                    this.selectType.appendChild(opt);
                });
                this.renderDynamicFields();
            }
        } catch (e) {
            console.error("Failed to load event types:", e);
        }
    }

    toggleEventMode() {
        this.activeEventMode = !this.activeEventMode;
        if (this.activeEventMode) {
            this.btnAddEvent.classList.add('active');
            this.btnAddEvent.style.background = '#2D2A26';
            this.modeIndicator.style.display = 'flex';
            
            // Change map cursor
            document.getElementById('leaflet-map').style.cursor = 'crosshair';
            
            // Register click listener once
            map.once('click', (e) => this.handleMapClick(e));
        } else {
            this.deactivateEventMode();
        }
    }

    deactivateEventMode() {
        this.activeEventMode = false;
        this.btnAddEvent.classList.remove('active');
        this.btnAddEvent.style.background = '#E86A33';
        this.modeIndicator.style.display = 'none';
        document.getElementById('leaflet-map').style.cursor = '';
    }

    async handleMapClick(e) {
        if (!this.activeEventMode) return;
        
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        this.selectedCoordinates = { lat, lng };

        this.deactivateEventMode();

        // Query nearest road
        this.lblRoadName.textContent = "Locating nearest corridor...";
        this.lblCoords.textContent = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
        this.drawer.style.display = 'flex';

        try {
            const res = await fetch(`/api/roads/nearest?lat=${lat}&lng=${lng}`);
            if (res.ok) {
                const road = await res.json();
                this.selectedEdgeId = road.edge_id;
                this.selectedRoadName = road.road_name || "Unknown Road";
                this.lblRoadName.textContent = this.selectedRoadName;
            } else {
                throw new Error("Failed to resolve nearest road");
            }
        } catch (err) {
            this.lblRoadName.textContent = "Custom Location Coordinate";
            this.selectedEdgeId = "custom_node_" + Math.floor(Math.random() * 100000);
            this.selectedRoadName = "Custom Location";
        }
    }

    closeDrawer() {
        this.drawer.style.display = 'none';
    }

    renderDynamicFields() {
        const type = this.selectType.value;
        this.dynamicBox.innerHTML = '';

        if (type === 'vehicle_breakdown') {
            this.dynamicBox.innerHTML = `
                <div class="event-form-group">
                    <label for="v-type">Vehicle Type</label>
                    <select id="v-type" class="event-form-select">
                        <option value="car">Car</option>
                        <option value="bus">BMTC Bus</option>
                        <option value="truck" selected>Heavy Truck</option>
                        <option value="heavy vehicle">Construction Carrier</option>
                    </select>
                </div>
                <div class="event-form-group" style="flex-direction: row; gap: 10px; align-items: center;">
                    <input type="checkbox" id="v-blocking" checked style="width: 18px; height: 18px;">
                    <label for="v-blocking" style="margin: 0;">Blocking active lane?</label>
                </div>
            `;
        } else if (type === 'accident') {
            this.dynamicBox.innerHTML = `
                <div class="event-form-group">
                    <label for="acc-severity">Accident Severity</label>
                    <select id="acc-severity" class="event-form-select">
                        <option value="minor">Minor Fender Bender</option>
                        <option value="moderate" selected>Moderate Crash</option>
                        <option value="major">Major Pileup</option>
                    </select>
                </div>
                <div class="event-form-group">
                    <label for="acc-vehicles">Vehicles Involved</label>
                    <input type="number" id="acc-vehicles" class="event-form-input" value="2" min="1" max="10">
                </div>
            `;
        } else if (type === 'construction') {
            this.dynamicBox.innerHTML = `
                <div class="event-form-group">
                    <label for="const-len">Affected Area Length (meters)</label>
                    <input type="number" id="const-len" class="event-form-input" value="200" min="50" max="1000">
                </div>
            `;
        } else if (type === 'public_event') {
            this.dynamicBox.innerHTML = `
                <div class="event-form-group">
                    <label for="pub-venue">Venue / Event Center</label>
                    <select id="pub-venue" class="event-form-select">
                        <option value="Chinnaswamy Stadium">Chinnaswamy Stadium</option>
                        <option value="Kanteerava Stadium">Kanteerava Stadium</option>
                        <option value="Palace Grounds">Palace Grounds</option>
                        <option value="Freedom Park">Freedom Park</option>
                        <option value="Custom Location">Custom Stadium/Hub</option>
                    </select>
                </div>
                <div class="event-form-group">
                    <label for="pub-crowd">Expected Crowd Size</label>
                    <input type="range" id="pub-crowd-slider" min="5000" max="50000" step="5000" value="35000" style="accent-color: #E86A33;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: 600; color: #2D2A26;">
                        <span id="pub-crowd-val">35,000 people</span>
                    </div>
                </div>
                <div class="event-form-group">
                    <label for="pub-arrival">Arrival Surge</label>
                    <select id="pub-arrival" class="event-form-select">
                        <option value="Normal">Normal flow-in</option>
                        <option value="Sudden surge" selected>Sudden surge before start</option>
                    </select>
                </div>
            `;

            // Bind slider update
            const slider = document.getElementById('pub-crowd-slider');
            const display = document.getElementById('pub-crowd-val');
            slider.addEventListener('input', () => {
                display.textContent = `${parseInt(slider.value).toLocaleString()} people`;
            });
        }
    }

    loadPreset(presetType) {
        this.closeDrawer();
        
        // Define preset properties and mock coords if none selected
        if (presetType === 'ipl') {
            // Chinnaswamy coordinates
            this.selectedCoordinates = { lat: 12.9788, lng: 77.5996 };
            this.selectedEdgeId = "stadium_exit_orr";
            this.selectedRoadName = "M.G. Road (Chinnaswamy Venue)";
            
            this.lblRoadName.textContent = this.selectedRoadName;
            this.lblCoords.textContent = `Lat: 12.9788, Lng: 77.5996`;
            
            this.selectType.value = 'public_event';
            this.renderDynamicFields();
            
            document.getElementById('pub-venue').value = "Chinnaswamy Stadium";
            document.getElementById('pub-crowd-slider').value = 35000;
            document.getElementById('pub-crowd-val').textContent = "35,000 people";
            this.inputDuration.value = 240;
            this.selectPriority.value = "High";
            this.selectLanes.value = "Full road";
            
        } else if (presetType === 'breakdown') {
            // Silk board coordinates
            this.selectedCoordinates = { lat: 12.9176, lng: 77.6244 };
            this.selectedEdgeId = "silkboard_flyover_u";
            this.selectedRoadName = "Hosur Road (Silk Board Flyover)";
            
            this.lblRoadName.textContent = this.selectedRoadName;
            this.lblCoords.textContent = `Lat: 12.9176, Lng: 77.6244`;
            
            this.selectType.value = 'vehicle_breakdown';
            this.renderDynamicFields();
            
            document.getElementById('v-type').value = "truck";
            document.getElementById('v-blocking').checked = true;
            this.inputDuration.value = 90;
            this.selectPriority.value = "High";
            this.selectLanes.value = "2";
            
        } else if (presetType === 'waterlogging') {
            // Outer Ring Road coordinates
            this.selectedCoordinates = { lat: 12.9279, lng: 77.6801 };
            this.selectedEdgeId = "orr_ibblur_s";
            this.selectedRoadName = "Outer Ring Road (Ibblur Grid)";
            
            this.lblRoadName.textContent = this.selectedRoadName;
            this.lblCoords.textContent = `Lat: 12.9279, Lng: 77.6801`;
            
            this.selectType.value = 'water_logging';
            this.renderDynamicFields();
            
            this.inputDuration.value = 120;
            this.selectPriority.value = "High";
            this.selectLanes.value = "1";
        }
        
        this.drawer.style.display = 'flex';
    }

    async submitSimulation() {
        if (!this.selectedCoordinates) return;

        // Gather params based on selected type
        const type = this.selectType.value;
        const duration = parseInt(this.inputDuration.value);
        const priority = this.selectPriority.value;
        const lanes = this.selectLanes.value;

        const params = {
            priority,
            affected_lanes: lanes
        };

        if (type === 'vehicle_breakdown') {
            params.vehicle_type = document.getElementById('v-type').value;
            params.blocking = document.getElementById('v-blocking').checked;
        } else if (type === 'accident') {
            params.severity = document.getElementById('acc-severity').value;
            params.vehicles = parseInt(document.getElementById('acc-vehicles').value);
        } else if (type === 'public_event') {
            params.venue = document.getElementById('pub-venue').value;
            params.crowd_size = parseInt(document.getElementById('pub-crowd-slider').value);
            params.arrival_pattern = document.getElementById('pub-arrival').value;
            params.exit_pattern = "Mass exit";
        }

        const payload = {
            event_type: type,
            location: this.selectedCoordinates,
            edge_id: this.selectedEdgeId,
            road_name: this.selectedRoadName,
            duration_min: duration,
            parameters: params
        };

        // UI loading state
        this.btnSimulate.disabled = true;
        this.btnSimulate.textContent = "Running AI Prediction...";

        try {
            const res = await fetch('/api/events/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const result = await res.json();
                
                // Add marker & pulses onto map
                this.animationEngine.addEventMarker(
                    result.simulation_id,
                    this.selectedCoordinates.lat,
                    this.selectedCoordinates.lng,
                    type,
                    (simId) => this.inspectActiveEvent(simId)
                );

                // Show AI analysis sidebar
                this.visualizer.showImpact(result);

                // Trigger timeline cache refresh & force reset to NOW (T=0)
                timelineSimulator.clearCache();
                timelineSimulator.setSimTime(0);

                // Notify signal AI about the event surge
                if (typeof junctionSimulator !== 'undefined' && junctionSimulator) {
                    junctionSimulator.applyEventSurge(payload);
                }
                
                // Display reset button
                this.btnResetCity.style.display = 'flex';
                this.closeDrawer();
            } else {
                throw new Error("Simulation endpoint failed");
            }
        } catch (e) {
            console.error(e);
            alert("Error running simulation pipeline: " + e.message);
        } finally {
            this.btnSimulate.disabled = false;
            this.btnSimulate.innerHTML = `<i class="material-icons">play_arrow</i> <span>Run Simulation</span>`;
        }
    }

    async inspectActiveEvent(simulationId) {
        try {
            const res = await fetch(`/api/events/result/${simulationId}`);
            if (res.ok) {
                const result = await res.json();
                this.visualizer.showImpact(result);
            }
        } catch (e) {
            console.error("Failed to inspect active event:", e);
        }
    }

    async resetCity() {
        this.btnResetCity.disabled = true;
        
        try {
            const res = await fetch('/api/events/reset', { method: 'POST' });
            if (res.ok) {
                // Clear map symbols
                this.animationEngine.clearAll();
                
                // Hide sidebar report
                this.visualizer.hide();
                
                // Reset timeline to T=0
                timelineSimulator.clearCache();
                timelineSimulator.setSimTime(0);

                // Clear signal surge/closure modifiers
                if (typeof junctionSimulator !== 'undefined' && junctionSimulator) {
                    junctionSimulator.clearModifiers();
                }
                
                // Hide reset btn
                this.btnResetCity.style.display = 'none';
            }
        } catch (e) {
            console.error("Reset city failed:", e);
        } finally {
            this.btnResetCity.disabled = false;
        }
    }
}
