// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Local Junction & Cycle Simulator
 *
 * Integrations:
 *   - Event-based signal response (Task 3 hook)
 *   - Road closure response (Task 4 hook)
 *   - Timeline slider integration
 */

class JunctionSimulator {
    constructor() {
        this.activeJunctions = [];
        this.adaptiveMode = true;
        this.timerInterval = null;
        this.onTickCallback = null;

        // Event & closure surge modifiers per signal_id
        // { signal_id: { incoming_boost: 0-100, blocked_dirs: ["North"], reason: "..." } }
        this.surgeModifiers = {};

        // Timeline multiplier (1.0 = present, higher = more congestion from future prediction)
        this.timelineQueueMultiplier = 1.0;
    }

    init(junctions) {
        this.activeJunctions = junctions;

        // Start simulation cycle loop
        this.startCycleLoop();
        this.bindEvents();
    }

    bindEvents() {
        const toggle = document.getElementById('toggle-adaptive-ai');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                this.adaptiveMode = e.target.checked;
                console.log("Adaptive AI mode changed to:", this.adaptiveMode);
            });
        }
    }

    startCycleLoop() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }

        this.timerInterval = setInterval(() => {
            this.tickSignals();
        }, 1000);
    }

    async tickSignals() {
        // Send state sync to backend
        try {
            const res = await fetch('/api/signals/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    adaptive_mode: this.adaptiveMode
                })
            });

            if (res.ok) {
                // Fetch latest state to sync
                const updateRes = await fetch('/api/signals');
                if (updateRes.ok) {
                    const signalsList = await updateRes.json();

                    // Update local arrays
                    signalsList.forEach(s => {
                        const target = this.activeJunctions.find(j => j.signal_id === s.signal_id);
                        if (target) {
                            target.current_phase = s.current_phase;
                            target.timer = s.timer;

                            // Apply surge modifiers from events / closures
                            const mod = this.surgeModifiers[s.signal_id];
                            if (mod) {
                                Object.keys(s.queues).forEach(dir => {
                                    // Boost incoming queues from event surges
                                    s.queues[dir] = Math.min(100, s.queues[dir] + (mod.incoming_boost || 0));

                                    // If direction is blocked by closure, cap queue
                                    if (mod.blocked_dirs && mod.blocked_dirs.includes(dir)) {
                                        s.queues[dir] = Math.min(s.queues[dir], 5);
                                    }
                                });
                            }

                            // Apply timeline congestion multiplier
                            if (this.timelineQueueMultiplier !== 1.0) {
                                Object.keys(s.queues).forEach(dir => {
                                    s.queues[dir] = Math.min(100, Math.round(s.queues[dir] * this.timelineQueueMultiplier));
                                });
                            }

                            target.queues = s.queues;
                            target.marker_state = s.marker_state;

                            // Recalculate marker state after modifications
                            const maxQ = Math.max(...Object.values(target.queues));
                            if (maxQ > 40) target.marker_state = 'critical';
                            else if (maxQ > 25) target.marker_state = 'heavy';
                            else target.marker_state = 'normal';

                            // Re-color/animate the leaflet marker
                            if (target.markerRef) {
                                const mEl = target.markerRef.getElement();
                                if (mEl) {
                                    const inner = mEl.querySelector('.signal-map-icon');
                                    if (inner) {
                                        inner.className = `signal-map-icon state-${target.marker_state}`;
                                    }
                                }
                            }
                        }
                    });

                    // Call sidebar callback to animate the selected junction
                    if (this.onTickCallback) {
                        this.onTickCallback();
                    }

                    // Update corresponding road congestion scores on the map
                    this.applyRoadStateChanges();
                }
            }
        } catch (e) {
            console.error("Signal simulation tick error:", e);
        }
    }

    applyRoadStateChanges() {
        // Find roads leading into junctions, modify congestion based on queue size
        this.activeJunctions.forEach(j => {
            const maxQ = Math.max(...Object.values(j.queues));
            const level = maxQ / 100.0;

            // Find roads with coordinates ending near the junction coordinate
            j.connected_roads.forEach(roadName => {
                // Find visible road with roadName
                const matchingRoad = activeRoads.find(r => r.road_name === roadName);
                if (matchingRoad && activePolylines[matchingRoad.edge_id]) {
                    const poly = activePolylines[matchingRoad.edge_id];

                    // Modify color on map based on signal congestion
                    let color = '#41644A';
                    if (level > 0.7) {
                        color = '#E21C1C';
                    } else if (level > 0.35) {
                        color = '#E86A33';
                    }
                    poly.setStyle({ color: color });
                }
            });
        });
    }

    getSignalState(signalId) {
        return this.activeJunctions.find(j => j.signal_id === signalId);
    }

    // ─── EVENT-BASED SIGNAL RESPONSE (Task 3 Integration) ───

    /**
     * Called after an event simulation completes.
     * Finds signals within ~1.5 km of the event epicenter and boosts their
     * incoming queues to simulate crowd/traffic surge.
     *
     * @param {object} eventData  { lat, lng, event_type, crowd_size, ... }
     */
    applyEventSurge(eventData) {
        const eLat = eventData.lat || (eventData.location && eventData.location.lat);
        const eLng = eventData.lng || (eventData.location && eventData.location.lng);
        if (!eLat || !eLng) return;

        // Determine surge intensity based on event type
        let boost = 8; // default moderate boost
        const type = eventData.event_type || eventData.type || '';
        if (type === 'public_event') {
            const crowd = eventData.parameters?.crowd_size || eventData.crowd_size || 10000;
            boost = Math.min(30, Math.round(crowd / 2000));
        } else if (type === 'accident' || type === 'vehicle_breakdown') {
            boost = 12;
        }

        this.activeJunctions.forEach(j => {
            const dx = j.lat - eLat;
            const dy = j.lng - eLng;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 0.015) { // ~1.5 km
                // Scale boost by proximity
                const proximityScale = 1.0 - (dist / 0.015);
                const effectiveBoost = Math.round(boost * proximityScale);

                this.surgeModifiers[j.signal_id] = {
                    ...(this.surgeModifiers[j.signal_id] || {}),
                    incoming_boost: effectiveBoost,
                    reason: `${type} surge (+${effectiveBoost} vehicles/cycle)`
                };
            }
        });

        console.log(`[SignalAI] Event surge applied: ${type} at ${eLat},${eLng}, boost=${boost}`);
    }

    // ─── ROAD CLOSURE SIGNAL RESPONSE (Task 4 Integration) ───

    /**
     * Called when a road closure is applied via the intervention sandbox.
     * Finds signals adjacent to the closed road and blocks the direction
     * that would send traffic into the closed segment.
     *
     * @param {object} closureData  { lat, lng, road_name, signal_ids_nearby }
     */
    applyClosureResponse(closureData) {
        const cLat = closureData.lat;
        const cLng = closureData.lng;

        this.activeJunctions.forEach(j => {
            const dx = j.lat - cLat;
            const dy = j.lng - cLng;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 0.008) { // ~800m — close enough to be affected
                // Calculate which direction from the signal leads toward the closure
                const angle = Math.atan2(cLat - j.lat, cLng - j.lng) * 180 / Math.PI;
                let blockedDir = 'East';
                const a = angle < 0 ? angle + 360 : angle;
                if (a >= 45 && a < 135) blockedDir = 'North';
                else if (a >= 135 && a < 225) blockedDir = 'West';
                else if (a >= 225 && a < 315) blockedDir = 'South';

                const existing = this.surgeModifiers[j.signal_id] || {};
                const existingBlocked = existing.blocked_dirs || [];
                if (!existingBlocked.includes(blockedDir)) {
                    existingBlocked.push(blockedDir);
                }

                this.surgeModifiers[j.signal_id] = {
                    ...existing,
                    blocked_dirs: existingBlocked,
                    reason: `Closure redirect: ${blockedDir} blocked`
                };
            }
        });

        console.log(`[SignalAI] Closure response applied near ${cLat},${cLng}`);
    }

    // ─── TIMELINE INTEGRATION ───

    /**
     * Called when the timeline slider moves.
     * Scales queue sizes based on predicted congestion at the given time step.
     *
     * @param {number} minutes      Timeline offset (0, 15, 30, 45, 60)
     * @param {number} avgCongestion  Average city congestion % from timeline data
     */
    applyTimelineState(minutes, avgCongestion) {
        // T=0 is baseline (multiplier=1.0).  At T=60 with high congestion, queues grow.
        // If AI optimization is active, growth is dampened.
        const baseMult = 1.0 + (minutes / 60.0) * (avgCongestion / 100.0);
        this.timelineQueueMultiplier = this.adaptiveMode
            ? Math.max(1.0, baseMult * 0.65) // AI reduces congestion growth
            : baseMult;

        console.log(`[SignalAI] Timeline T+${minutes}min → queue multiplier ${this.timelineQueueMultiplier.toFixed(2)}`);
    }

    // ─── RESET ───

    clearModifiers() {
        this.surgeModifiers = {};
        this.timelineQueueMultiplier = 1.0;
        console.log("[SignalAI] All surge/closure modifiers cleared.");
    }
}

let junctionSimulator;
