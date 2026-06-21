// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Signal Manager
 */

class SignalManager {
    constructor() {
        this.signals = [];
        this.selectedSignalId = null;

        this.animationEngine = new SignalAnimationEngine();
        this.optimizerUI = new SignalOptimizerUI();
        this.greenWave = new GreenWaveVisualizer();

        // UI references
        this.btnToggleNetwork = document.getElementById('btn-toggle-signals');
        
        this.init();
    }

    async init() {
        this.optimizerUI.init(this);
        
        // Fetch all signals and draw markers
        await this.loadSignals();

        // Setup coordination network toggle listener
        if (this.btnToggleNetwork) {
            this.btnToggleNetwork.addEventListener('click', () => {
                this.greenWave.toggleNetworkView();
            });
        }

        // Initialize simulator coordination tick updates
        junctionSimulator = new JunctionSimulator();
        junctionSimulator.init(this.signals);
        junctionSimulator.onTickCallback = () => this.syncSelectedJunctionUI();
    }

    async loadSignals() {
        try {
            const res = await fetch('/api/signals');
            if (res.ok) {
                this.signals = await res.json();
                
                // Set green wave target reference list
                this.greenWave.init(map, this.signals);

                // Add to Leaflet map
                this.signals.forEach(sig => {
                    // Create professional Leaflet icon with glow class
                    const markerHtml = `
                        <div class="signal-map-icon state-${sig.marker_state}">
                            <span class="material-icons" style="font-size: 16px; color: #4A4642;">traffic</span>
                        </div>
                    `;

                    const icon = L.divIcon({
                        html: markerHtml,
                        className: 'leaflet-signal-marker',
                        iconSize: [32, 32],
                        iconAnchor: [16, 16]
                    });

                    const marker = L.marker([sig.lat, sig.lng], { icon })
                        .addTo(map)
                        .bindTooltip(sig.junction_name, { sticky: true });

                    // Keep marker reference to update styles dynamically
                    sig.markerRef = marker;

                    marker.on('click', () => {
                        this.inspectJunction(sig.signal_id);
                    });
                });
            }
        } catch (e) {
            console.error("Failed to load traffic signals:", e);
        }
    }

    async inspectJunction(signalId) {
        this.selectedSignalId = signalId;

        // Hide other inspector boxes
        const placeholder = document.getElementById('inspector-placeholder');
        const roadCard = document.getElementById('inspector-road');
        const juncCard = document.getElementById('inspector-junction');

        if (placeholder) placeholder.style.display = 'none';
        if (roadCard) roadCard.style.display = 'none';
        if (juncCard) juncCard.style.display = 'block';

        // Clear previous timing slides
        this.optimizerUI.clear();

        // Fetch detailed state
        try {
            const res = await fetch(`/api/signals/${signalId}/state`);
            if (res.ok) {
                const data = await res.json();

                // Update text elements
                document.getElementById('inspect-junc-name').textContent = data.junction_name;
                
                const signalStatus = document.getElementById('inspect-junc-status');
                if (signalStatus) {
                    signalStatus.textContent = data.adaptive_mode ? "Adaptive AI Active" : "Fixed Control Mode";
                }

                // Update connected corridors
                const list = document.getElementById('inspect-junc-roads');
                if (list) {
                    list.innerHTML = '';
                    data.connected_roads.forEach(r => {
                        const li = document.createElement('li');
                        li.textContent = r;
                        list.appendChild(li);
                    });
                }

                // Update wait times comparison cards
                const fWait = document.getElementById('wait-fixed');
                const aWait = document.getElementById('wait-ai');
                const improvement = document.getElementById('perf-improvement-lbl');

                if (fWait) fWait.textContent = `${data.evaluation.fixed.average_wait_sec}s`;
                if (aWait) aWait.textContent = `${data.evaluation.ai.average_wait_sec}s`;
                if (improvement) {
                    improvement.textContent = `AI wait reduction: ${data.evaluation.metrics.waiting_time_reduction_pct}% faster`;
                }

                // Update Adaptive switch state
                const aiToggle = document.getElementById('toggle-adaptive-ai');
                if (aiToggle) {
                    aiToggle.checked = data.adaptive_mode;
                }

                // Update 4-way visualizer
                this.animationEngine.updateIntersection(data.current_phase, data.timer, data.queues);
            }
        } catch (e) {
            console.error("Inspect junction state error:", e);
        }
    }

    syncSelectedJunctionUI() {
        if (!this.selectedSignalId) return;

        const state = junctionSimulator.getSignalState(this.selectedSignalId);
        if (state) {
            this.animationEngine.updateIntersection(state.current_phase, state.timer, state.queues);
        }
    }
}

// Global instantiator inside map_engine.js
let signalCoordinator;
