/**
 * Traffic Twin Bengaluru — Mission Control Scenario Manager
 * Implements one-click demo setups, AI pipeline progress bar visualization,
 * and smooth camera movements.
 */

class DemoScenarioManager {
    constructor() {
        this.modal = null;
        this.progressBar = null;
        this.statusText = null;
        this.steps = {};
        
        // Define Scenarios
        this.scenarios = {
            'ipl': {
                name: 'IPL Match Exit Surge',
                event_type: 'public_event',
                location: { lat: 12.9788, lng: 77.5996 },
                edge_id: 'stadium_exit_orr',
                road_name: 'M.G. Road (Chinnaswamy Venue)',
                duration_min: 240,
                parameters: {
                    venue: 'Chinnaswamy Stadium',
                    crowd_size: 35000,
                    arrival_pattern: 'Sudden surge',
                    exit_pattern: 'Mass exit',
                    affected_lanes: 'Full road'
                }
            },
            'breakdown': {
                name: 'ORR Truck Breakdown',
                event_type: 'vehicle_breakdown',
                location: { lat: 12.9176, lng: 77.6244 },
                edge_id: 'silkboard_flyover_u',
                road_name: 'Hosur Road (Silk Board Flyover)',
                duration_min: 90,
                parameters: {
                    vehicle_type: 'truck',
                    blocking: true,
                    affected_lanes: '2'
                }
            },
            'vip': {
                name: 'VIP Movement',
                event_type: 'vip_movement',
                location: { lat: 12.9716, lng: 77.5946 },
                edge_id: 'central_vidhana_soudha',
                road_name: 'Vidhana Soudha Corridor',
                duration_min: 30,
                parameters: {
                    priority: 'High',
                    affected_lanes: 'Full road'
                }
            },
            'rain': {
                name: 'Waterlogging & Flooding',
                event_type: 'water_logging',
                location: { lat: 12.9279, lng: 77.6801 },
                edge_id: 'orr_ibblur_s',
                road_name: 'Outer Ring Road (Ibblur Grid)',
                duration_min: 120,
                parameters: {
                    affected_lanes: '1'
                }
            }
        };

        this.init();
    }

    init() {
        // Find elements
        this.modal = document.getElementById('ai-pipeline-modal');
        this.progressBar = document.getElementById('pipeline-progress-bar');
        this.statusText = document.getElementById('pipeline-status-text');
        
        const ids = ['analysis', 'prediction', 'propagation', 'signals', 'recommendation'];
        ids.forEach(id => {
            this.steps[id] = document.getElementById(`step-${id}`);
        });

        // Bind Mission Control Panel Toggles
        const mcPanel = document.getElementById('mission-control-panel');
        const openBtn = document.getElementById('btn-mission-control');
        const closeBtn = document.getElementById('btn-close-mission');

        if (openBtn && mcPanel) {
            openBtn.addEventListener('click', () => {
                mcPanel.style.display = mcPanel.style.display === 'none' ? 'block' : 'none';
                openBtn.classList.toggle('active');
            });
        }

        if (closeBtn && mcPanel) {
            closeBtn.addEventListener('click', () => {
                mcPanel.style.display = 'none';
                if (openBtn) openBtn.classList.remove('active');
            });
        }

        // Bind Scenario Clicks
        document.addEventListener('click', (e) => {
            const card = e.target.closest('.mission-card');
            if (card) {
                const scenarioKey = card.getAttribute('data-scenario');
                this.triggerScenario(scenarioKey);
                if (mcPanel) {
                    mcPanel.style.display = 'none';
                    if (openBtn) openBtn.classList.remove('active');
                }
            }
        });
    }

    async triggerScenario(key) {
        const scenario = this.scenarios[key];
        if (!scenario) return;

        console.log(`[Mission Control] Running scenario: ${scenario.name}`);
        
        // 1. Show AI Pipeline Modal
        this.showPipelineModal();
        
        // 2. Set eventManager coordinate attributes
        if (typeof eventManager !== 'undefined') {
            eventManager.selectedCoordinates = scenario.location;
            eventManager.selectedEdgeId = scenario.edge_id;
            eventManager.selectedRoadName = scenario.road_name;
        }

        // Formulate API payload
        const payload = {
            event_type: scenario.event_type,
            location: scenario.location,
            edge_id: scenario.edge_id,
            road_name: scenario.road_name,
            duration_min: scenario.duration_min,
            parameters: scenario.parameters
        };

        let simSuccess = false;
        let simResult = null;

        // Perform AJAX request and mock pipeline timeline progress simultaneously
        const apiPromise = fetch('/api/events/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(async (res) => {
            if (res.ok) {
                simSuccess = true;
                return await res.json();
            } else {
                throw new Error("Simulation pipeline error");
            }
        }).catch(err => {
            console.error(err);
            return null;
        });

        // Run visual checklist progress bar
        await this.runVisualPipelineProgress(apiPromise);
        
        simResult = await apiPromise;

        this.hidePipelineModal();

        if (simSuccess && simResult) {
            // Add marker & pulses onto map
            if (typeof eventManager !== 'undefined' && eventManager.animationEngine) {
                eventManager.animationEngine.addEventMarker(
                    simResult.simulation_id,
                    scenario.location.lat,
                    scenario.location.lng,
                    scenario.event_type,
                    (simId) => eventManager.inspectActiveEvent(simId)
                );
            }

            // Smoothly pan camera to epicenter
            if (typeof map !== 'undefined') {
                map.flyTo([scenario.location.lat, scenario.location.lng], 14, {
                    animate: true,
                    duration: 1.5
                });
            }

            // Trigger AI assistant analysis sidebar panel updates
            if (typeof aiAssistantCoordinator !== 'undefined') {
                aiAssistantCoordinator.triggerBtn.style.display = 'flex';
                // Retrieve analysis
                const analysisPayload = {
                    event_type: scenario.event_type,
                    road_name: scenario.road_name,
                    duration_min: scenario.duration_min,
                    parameters: scenario.parameters
                };
                
                try {
                    const analysisRes = await fetch('/api/assistant/analyze', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(analysisPayload)
                    });
                    if (analysisRes.ok) {
                        const analysis = await analysisRes.json();
                        recommendationPanel.updatePanelData(analysis);
                        recommendationPanel.showPanel();
                        aiAssistantCoordinator.startAlertMonitoring();
                    }
                } catch (e) {
                    console.error("AI assistant update failed in demo:", e);
                }
            }

            // Refresh timeline simulator slider
            if (typeof timelineSimulator !== 'undefined' && timelineSimulator) {
                timelineSimulator.clearCache();
                timelineSimulator.setSimTime(0);
            }

            // Show reset city button
            const resetBtn = document.getElementById('btn-reset-city');
            if (resetBtn) resetBtn.style.display = 'flex';

            if (window.notifications) {
                window.notifications.show(`Demo Scenario Active: ${scenario.name}`, 'success');
            }
        } else {
            if (window.notifications) {
                window.notifications.show('Failed to execute simulation scenario.', 'error');
            }
        }
    }

    showPipelineModal() {
        if (!this.modal) return;
        this.modal.style.display = 'flex';
        this.progressBar.style.width = '0%';
        this.statusText.textContent = 'Initializing digital twin command center...';

        Object.keys(this.steps).forEach(k => {
            const step = this.steps[k];
            if (step) {
                step.classList.remove('completed', 'active');
                const icon = step.querySelector('.step-icon');
                if (icon) icon.textContent = 'pending';
            }
        });
    }

    hidePipelineModal() {
        if (this.modal) this.modal.style.display = 'none';
    }

    async runVisualPipelineProgress(apiPromise) {
        const delays = [500, 600, 600, 700, 500];
        const stepKeys = ['analysis', 'prediction', 'propagation', 'signals', 'recommendation'];
        const stepMsgs = [
            'Analyzing event priority and location buffers...',
            'Forecasting congestion waves via LightGBM models...',
            'Propagating speed shock waves using ST-GNN grids...',
            'Optimizing signal intersection green phase durations...',
            'Compiling police resources action plan recommendations...'
        ];

        for (let i = 0; i < stepKeys.length; i++) {
            const key = stepKeys[i];
            const stepEl = this.steps[key];
            
            if (stepEl) {
                stepEl.classList.add('active');
            }
            
            this.statusText.textContent = stepMsgs[i];
            
            // Wait the delay
            await new Promise(resolve => setTimeout(resolve, delays[i]));
            
            // Set completed
            if (stepEl) {
                stepEl.classList.remove('active');
                stepEl.classList.add('completed');
                const icon = stepEl.querySelector('.step-icon');
                if (icon) icon.textContent = 'check_circle';
            }

            const pct = Math.round(((i + 1) / stepKeys.length) * 100);
            this.progressBar.style.width = `${pct}%`;
        }

        // Just in case backend takes longer, wait for the actual API promise
        await apiPromise;
    }
}

// Instantiate on DOM load
document.addEventListener('DOMContentLoaded', () => {
    window.demoScenarios = new DemoScenarioManager();
});
