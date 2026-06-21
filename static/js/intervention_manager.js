// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Police Intervention Manager Coordinator
 */

class InterventionManager {
    constructor() {
        this.activeTool = null;
        this.activeInterventions = [];
        this.mapOverlays = []; // Holds Leaflet markers and route overlays
        
        // Active event targets
        this.activeEventEdgeId = null;
        this.activeEventRoadName = "";

        // Tool Instances
        this.tools = {
            barricade: new BarricadeTool(this),
            closure: new ClosureTool(this),
            lanes: new BarricadeTool(this), // lanes delegates to barricade config
            manpower: new ManpowerTool(this)
        };

        this.comparisonView = new ComparisonView();
        
        // Element references
        this.toolbar = document.getElementById('intervention-toolbar');
        this.popover = document.getElementById('intervention-config-popover');
        this.btnClosePopover = document.getElementById('btn-close-popover');
        this.btnSaveIntervention = document.getElementById('btn-save-intervention');
        
        this.init();
    }

    init() {
        this.comparisonView.init(this);

        // Bind Toolbuttons
        document.querySelectorAll('.intervention-tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const toolName = btn.getAttribute('data-tool');
                this.selectTool(toolName);
            });
        });

        if (this.btnClosePopover) {
            this.btnClosePopover.addEventListener('click', () => this.hidePopover());
        }

        if (this.btnSaveIntervention) {
            this.btnSaveIntervention.addEventListener('click', () => this.saveActiveIntervention());
        }

        // Listen for standard simulations to expose the Intervention Toolbar
        const originalSubmit = document.getElementById('btn-submit-simulation');
        if (originalSubmit) {
            originalSubmit.addEventListener('click', () => {
                // Read input road & coords on submission
                setTimeout(() => {
                    this.activeEventEdgeId = eventManager.selectedEdgeId;
                    this.activeEventRoadName = eventManager.selectedRoadName;
                    this.showToolbar();
                }, 1000);
            });
        }

        // Listen for resets
        const originalReset = document.getElementById('btn-reset-city');
        if (originalReset) {
            originalReset.addEventListener('click', () => {
                this.resetSandbox();
            });
        }
    }

    showToolbar() {
        if (this.toolbar) {
            this.toolbar.style.display = 'flex';
        }
    }

    hideToolbar() {
        if (this.toolbar) {
            this.toolbar.style.display = 'none';
        }
    }

    selectTool(toolName) {
        // Toggle tool compare
        if (toolName === 'compare') {
            this.simulateInterventions();
            return;
        }

        // Clear active status on all tool buttons
        document.querySelectorAll('.intervention-tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        if (this.activeTool === toolName) {
            this.activeTool = null;
            return;
        }

        this.activeTool = toolName;
        const activeBtn = document.querySelector(`.intervention-tool-btn[data-tool="${toolName}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        // Activate tool click listener
        if (this.tools[toolName]) {
            this.tools[toolName].activate();
        }
    }

    setMapCursor(cursor) {
        document.getElementById('leaflet-map').style.cursor = cursor;
    }

    hidePopover() {
        if (this.popover) {
            this.popover.style.display = 'none';
        }
    }

    saveActiveIntervention() {
        if (this.activeTool && this.tools[this.activeTool]) {
            this.tools[this.activeTool].saveIntervention();
            this.hidePopover();
            this.selectTool(this.activeTool); // deselect tool
        }
    }

    addInterventionToSandbox(config) {
        this.activeInterventions.push(config);

        // If a road closure is added, notify signal AI to redirect nearby signals
        if (config.type === 'closure' && typeof junctionSimulator !== 'undefined' && junctionSimulator) {
            junctionSimulator.applyClosureResponse({
                lat: config.coordinates.lat,
                lng: config.coordinates.lng,
                road_name: config.road_name || ''
            });
        }
    }

    registerMapOverlay(layer) {
        this.mapOverlays.push(layer);
    }

    getLastInterventionDescription() {
        if (this.activeInterventions.length === 0) return null;
        const last = this.activeInterventions[this.activeInterventions.length - 1];
        if (last.type === 'barricade') {
            return `Barricade ${last.parameters.reduction_pct}%`;
        } else if (last.type === 'closure') {
            return last.parameters.closure_type;
        } else if (last.type === 'manpower') {
            return `Deploy ${last.parameters.officers_count} Officers`;
        }
        return "Custom Intervention";
    }

    loadInterventionPayload(payload) {
        // Clear old visual markers
        this.clearVisuals();
        this.activeInterventions = payload;

        // Redraw markers on the map
        this.activeInterventions.forEach(item => {
            let markerHtml = '';
            let color = '';
            if (item.type === 'barricade') {
                markerHtml = `<div style="width: 32px; height: 32px; background: #FFC93C; border: 2px solid #E21C1C; border-radius: 6px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.25);"><span class="material-icons" style="font-size: 18px; color: #E21C1C;">fence</span></div>`;
            } else if (item.type === 'closure') {
                markerHtml = `<div style="width: 32px; height: 32px; background: #FF3B30; border: 2px solid #FFFFFF; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.25);"><span class="material-icons" style="font-size: 18px; color: #FFFFFF;">do_not_disturb_on</span></div>`;
            } else if (item.type === 'manpower') {
                markerHtml = `<div style="width: 32px; height: 32px; background: #007AFF; border: 2px solid #FFFFFF; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.25);"><span class="material-icons" style="font-size: 18px; color: #FFFFFF;">local_police</span></div>`;
            }

            const icon = L.divIcon({
                html: markerHtml,
                className: 'custom-sandbox-marker',
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });

            const marker = L.marker([item.coordinates.lat, item.coordinates.lng], { icon }).addTo(map);
            this.mapOverlays.push(marker);
        });
    }

    async simulateInterventions() {
        if (this.activeInterventions.length === 0) {
            alert("Please place at least one police intervention in the sandbox first.");
            return;
        }

        const compareBtn = document.getElementById('tool-compare');
        if (compareBtn) {
            compareBtn.classList.add('active');
        }

        try {
            const res = await fetch('/api/intervention/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    interventions: this.activeInterventions
                })
            });

            if (res.ok) {
                const data = await res.json();
                
                // Clear old comparison line/glow graphics
                this.clearGlows();

                // Update side panel values
                this.comparisonView.updateComparison(data);

                // Highlight improved roads (Green)
                data.metrics.improved_roads.forEach(eid => {
                    const poly = activePolylines[eid];
                    if (poly) {
                        const coords = poly.getLatLngs();
                        const glow = L.polyline(coords, {
                            color: '#41644A',
                            weight: poly.baselineWeight + 4,
                            opacity: 0.85
                        }).addTo(map);
                        this.mapOverlays.push(glow);
                    }
                });

                // Highlight worse roads (Red)
                data.metrics.worse_roads.forEach(eid => {
                    const poly = activePolylines[eid];
                    if (poly) {
                        const coords = poly.getLatLngs();
                        const glow = L.polyline(coords, {
                            color: '#E21C1C',
                            weight: poly.baselineWeight + 4,
                            opacity: 0.85
                        }).addTo(map);
                        this.mapOverlays.push(glow);
                    }
                });

                // Draw animated diversion routes (Blue/Orange flow lines)
                data.alternative_paths.forEach(coords => {
                    const flow = L.polyline(coords, {
                        color: '#00B4D8',
                        weight: 6,
                        dashArray: '10, 15',
                        className: 'animated-flow-line',
                        opacity: 0.9
                    }).addTo(map);
                    
                    this.mapOverlays.push(flow);
                });

                // Trigger apply changes on sandbox
                await this.applyInterventionChanges();
            }
        } catch (e) {
            console.error("Simulation run failed:", e);
        } finally {
            if (compareBtn) {
                setTimeout(() => compareBtn.classList.remove('active'), 1000);
            }
        }
    }

    async applyInterventionChanges() {
        try {
            const res = await fetch('/api/intervention/apply', { method: 'POST' });
            if (res.ok) {
                // Refresh the timeline cache and force T=0 update
                timelineSimulator.clearCache();
                timelineSimulator.setSimTime(0);
            }
        } catch (e) {
            console.error("Apply intervention error:", e);
        }
    }

    clearGlows() {
        // Clear outlines and flows, keep the icons
        this.mapOverlays = this.mapOverlays.filter(layer => {
            if (layer instanceof L.Polyline) {
                map.removeLayer(layer);
                return false;
            }
            return true;
        });
    }

    clearVisuals() {
        this.mapOverlays.forEach(layer => {
            map.removeLayer(layer);
        });
        this.mapOverlays = [];
    }

    resetSandbox() {
        this.clearVisuals();
        this.activeInterventions = [];
        this.comparisonView.clear();
        this.hideToolbar();
        this.hidePopover();
    }
}

// Global instantiator inside map_engine.js
let interventionCoordinator;
