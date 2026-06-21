// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Action Planner (Simulate and Apply Modes)
 */

class ActionPlanner {
    constructor() {
        this.activePlan = null;
        this.analysisData = null;
    }

    init(analysisData) {
        this.analysisData = analysisData;
    }

    setActivePlan(planId, planData) {
        this.activePlan = {
            id: planId,
            data: planData
        };
    }

    async simulatePlan() {
        if (!this.activePlan) return;
        
        console.log(`[AI Assistant] Simulating response strategy: ${this.activePlan.id}`);
        const btn = document.getElementById('btn-assistant-simulate');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<i class="material-icons" style="animation: spin 1s infinite linear;">restart_alt</i> Simulating...`;
        }

        try {
            // Mock-simulate the timeline impact: scale timeline cache to demonstrate faster recovery
            if (typeof timelineSimulator !== 'undefined' && timelineSimulator) {
                // Clear cache & set simulator to T+0, then trigger timeline progress speed-up
                timelineSimulator.clearCache();
                
                // Adjust the timeline cached congestion scores downwards to show visual improvement!
                const origFetch = timelineSimulator.fetchTimelineState;
                timelineSimulator.fetchTimelineState = async function(minutes) {
                    const data = await origFetch.call(this, minutes);
                    if (data && data.roads) {
                        const improvedData = JSON.parse(JSON.stringify(data));
                        // Dampen congestion scores based on plan effectiveness
                        const reduction = 1.0 - (actionPlanner.activePlan.data.congestion_reduction_pct / 100.0);
                        
                        Object.keys(improvedData.roads).forEach(eid => {
                            improvedData.roads[eid].congestion_score = Math.max(0.1, improvedData.roads[eid].congestion_score * reduction);
                        });
                        improvedData.avg_congestion = Math.round(improvedData.avg_congestion * reduction);
                        improvedData.critical_roads = Math.max(0, Math.round(improvedData.critical_roads * reduction));
                        
                        return improvedData;
                    }
                    return data;
                };

                // Play the timeline to show dynamic relief of roads
                timelineSimulator.setSimTime(0);
                setTimeout(() => {
                    timelineSimulator.play();
                }, 500);

                // Restore original fetch after 15 seconds so other operations aren't permanently modified
                setTimeout(() => {
                    timelineSimulator.fetchTimelineState = origFetch;
                }, 15000);
            }

            // Temporarily show diversion route flow on map
            const diversion = this.analysisData.recommendations.diversion;
            if (diversion && typeof map !== 'undefined') {
                // silk board or MG Road mock coordination polyline route coords
                let coords = [
                    [12.9716, 77.5946],
                    [12.9788, 77.5996],
                    [12.9822, 77.6110]
                ];
                if (this.analysisData.location_name.toLowerCase().includes("silk board")) {
                    coords = [
                        [12.9176, 77.6244],
                        [12.9220, 77.6320],
                        [12.9279, 77.6401]
                    ];
                }

                if (typeof interventionCoordinator !== 'undefined') {
                    // Remove old glows/diversions
                    interventionCoordinator.clearGlows();
                    
                    const flowLine = L.polyline(coords, {
                        color: '#007AFF',
                        weight: 6,
                        dashArray: '10, 15',
                        className: 'animated-flow-line',
                        opacity: 0.95
                    }).addTo(map);
                    
                    interventionCoordinator.registerMapOverlay(flowLine);
                }
            }

            if (window.notifications) {
                window.notifications.show(`Simulation completed. Plan clearance: ${this.activePlan.data.clearance_time_min} minutes. Visualizing timeline improvement...`, 'success');
            } else {
                alert(`Simulation completed. Plan clearance: ${this.activePlan.data.clearance_time_min} minutes. Visualizing timeline improvement...`);
            }
        } catch (e) {
            console.error("Plan simulation failed:", e);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="material-icons">play_circle</i> Simulate`;
            }
        }
    }

    async applyPlan() {
        if (!this.activePlan || !this.analysisData) return;

        console.log(`[AI Assistant] Applying response strategy: ${this.activePlan.id}`);
        const btn = document.getElementById('btn-assistant-apply');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<i class="material-icons" style="animation: spin 1s infinite linear;">restart_alt</i> Applying...`;
        }

        try {
            // 1. Apply Manpower deployment
            const manpower = this.analysisData.recommendations.manpower;
            if (manpower && typeof interventionCoordinator !== 'undefined') {
                // Add police icon marker at epicenter
                const mockCoord = eventManager.selectedCoordinates || { lat: 12.9716, lng: 77.5946 };
                interventionCoordinator.addInterventionToSandbox({
                    type: 'manpower',
                    coordinates: mockCoord,
                    road_name: this.analysisData.location_name,
                    parameters: {
                        officers_count: manpower.total_officers
                    }
                });
            }

            // 2. Apply Signal strategy timing adjustments
            const signals = this.analysisData.recommendations.signal_strategy;
            if (signals && typeof signalCoordinator !== 'undefined') {
                // Find signal and force-set green phase time to recommended seconds
                const sigName = this.analysisData.location_name;
                const match = signalCoordinator.signals.find(s => 
                    s.junction_name.toLowerCase().includes(sigName.toLowerCase()) ||
                    sigName.toLowerCase().includes(s.junction_name.toLowerCase())
                );
                
                if (match) {
                    // Update timing in local simulator
                    const localSig = junctionSimulator.getSignalState(match.signal_id);
                    if (localSig) {
                        localSig.timer = signals.recommended_green_sec;
                    }
                    
                    // Call backend optimize route with timing changes payload
                    await fetch('/api/signals/optimize', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            signal_id: match.signal_id,
                            duration_override: signals.recommended_green_sec
                        })
                    });
                }
            }

            // 3. Post to backend apply interventions
            if (typeof interventionCoordinator !== 'undefined') {
                await interventionCoordinator.applyInterventionChanges();
            }

            if (window.notifications) {
                window.notifications.show(`AI Strategic Plan Applied: Deployments added to command sandbox.`, 'success');
            } else {
                alert(`AI Strategic Plan Applied: Deployments added to command sandbox.`);
            }
        } catch (e) {
            console.error("Plan application failed:", e);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="material-icons">done_all</i> Apply`;
            }
        }
    }
}

const actionPlanner = new ActionPlanner();
