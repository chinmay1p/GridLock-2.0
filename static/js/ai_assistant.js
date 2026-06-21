// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — AI Police Command Assistant Coordinator
 */

class AIAssistantCoordinator {
    constructor() {
        this.triggerBtn = document.getElementById('btn-toggle-assistant');
        this.alertsContainer = document.getElementById('assistant-alerts-container');
        this.activeEventData = null;
        this.alertInterval = null;
    }

    init() {
        // Instantiate panel renderer
        recommendationPanel = new RecommendationPanel();

        // Bind toggle trigger button
        if (this.triggerBtn) {
            this.triggerBtn.addEventListener('click', () => {
                const sidebar = document.getElementById('assistant-sidebar');
                if (sidebar) {
                    if (sidebar.classList.contains('active')) {
                        recommendationPanel.hidePanel();
                    } else {
                        recommendationPanel.showPanel();
                    }
                }
            });
        }

        // Hook into event simulation success loop from EventManager
        const submitBtn = document.getElementById('btn-submit-simulation');
        if (submitBtn) {
            submitBtn.addEventListener('click', () => {
                // Wait for the simulation results to be calculated, then fetch AI analysis
                setTimeout(() => {
                    this.runAIAnalysis();
                }, 1500);
            });
        }

        // Hook into reset events to clear the assistant state
        const resetBtn = document.getElementById('btn-reset-city');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetAssistant();
            });
        }
    }

    async runAIAnalysis() {
        // Build payload from the active eventManager selected state
        if (typeof eventManager === 'undefined' || !eventManager.selectedCoordinates) {
            console.warn("[AI Assistant] No active coordinates/incident selected to analyze.");
            return;
        }

        // Expose assistant toggle trigger button overlaying map
        if (this.triggerBtn) {
            this.triggerBtn.style.display = 'flex';
        }

        const typeInput = document.getElementById('event-type');
        const durationInput = document.getElementById('event-duration');
        const severityInput = document.getElementById('event-priority');
        const lanesInput = document.getElementById('event-lanes');

        const eventType = typeInput ? typeInput.value : 'vehicle_breakdown';
        const duration = durationInput ? parseInt(durationInput.value) || 60 : 60;
        const severity = severityInput ? severityInput.value.toUpperCase() : 'MEDIUM';
        const roadName = eventManager.selectedRoadName || "Silk Board Outer Ring Road";

        // Dynamic parameters based on type
        const parameters = {};
        if (eventType === 'public_event') {
            const crowdVal = document.getElementById('field-crowd-size');
            parameters.crowd_size = crowdVal ? parseInt(crowdVal.value) || 35000 : 35000;
        }
        parameters.affected_lanes = lanesInput ? lanesInput.value : '1';

        const payload = {
            event_type: eventType,
            road_name: roadName,
            duration_min: duration,
            parameters: parameters
        };

        this.activeEventData = payload;

        try {
            console.log("[AI Assistant] Triggering incident analysis payload:", payload);
            const res = await fetch('/api/assistant/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const analysis = await res.json();
                
                // Load analysis into the view panel
                recommendationPanel.updatePanelData(analysis);
                
                // Open right panel drawer
                recommendationPanel.showPanel();

                // Start active alert warnings generator loop
                this.startAlertMonitoring();
            }
        } catch (e) {
            console.error("AI Analysis retrieval failed:", e);
        }
    }

    startAlertMonitoring() {
        this.clearAlerts();

        // Deploy first warning card after 10 seconds
        this.alertInterval = setTimeout(() => {
            this.triggerWarningAlert(
                "Congestion spreading faster than expected.",
                "Outer Ring Road feed bottleneck is causing secondary queue spillover into Sector 4."
            );

            // Deploy second warning card after another 15 seconds
            this.alertInterval = setTimeout(() => {
                this.triggerWarningAlert(
                    "Alternative route overloaded.",
                    "Diversion pathway via Residency Road is operating at 92% capacity. Manpower override recommended."
                );
            }, 15000);

        }, 10000);
    }

    triggerWarningAlert(title, text) {
        if (!this.alertsContainer) return;

        const alertCard = document.createElement('div');
        alertCard.className = 'assistant-alert-card';
        alertCard.innerHTML = `
            <i class="material-icons">warning</i>
            <div class="assistant-alert-content">
                <div style="font-weight: 800; font-size: 0.8rem; color: #5C4300;">${title}</div>
                <div class="assistant-alert-text">${text}</div>
            </div>
        `;

        this.alertsContainer.appendChild(alertCard);
    }

    clearAlerts() {
        if (this.alertInterval) {
            clearTimeout(this.alertInterval);
        }
        if (this.alertsContainer) {
            this.alertsContainer.innerHTML = '';
        }
    }

    resetAssistant() {
        this.clearAlerts();
        if (this.triggerBtn) {
            this.triggerBtn.style.display = 'none';
        }
        if (recommendationPanel) {
            recommendationPanel.hidePanel();
            // Reset situation text to default
            const sit = document.getElementById('assistant-situation-text');
            if (sit) {
                sit.textContent = "Select or simulate an incident to generate AI analysis.";
            }
            
            // Hide other sub-cards
            const cards = ['card-severity', 'card-recommendations', 'card-improvement', 'card-explanations', 'assistant-export-row'];
            cards.forEach(c => {
                const el = document.getElementById(c);
                if (el) el.style.display = 'none';
            });
        }
        this.activeEventData = null;
    }
}

// Global coordinator instantiator
let aiAssistantCoordinator;
