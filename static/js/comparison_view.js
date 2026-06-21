// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Police Sandbox Comparison View & Strategy History
 */

class ComparisonView {
    constructor() {
        this.beforeVal = document.getElementById('sandbox-before-delay');
        this.afterVal = document.getElementById('sandbox-after-delay');
        this.historyBox = document.getElementById('sandbox-strategy-history');
        this.btnAutoRecommend = document.getElementById('btn-auto-recommend');
        this.historyList = [];
    }

    init(manager) {
        this.manager = manager;

        if (this.btnAutoRecommend) {
            this.btnAutoRecommend.addEventListener('click', () => this.generateAIPlan());
        }
    }

    updateComparison(data) {
        if (!data) return;

        // Update delay comparison
        const beforeDelay = data.before.clearance_time_min;
        const afterDelay = data.after.clearance_time_min;
        const improvement = data.metrics.congestion_reduction_pct;

        if (this.beforeVal) this.beforeVal.textContent = `${beforeDelay} min`;
        if (this.afterVal) {
            this.afterVal.textContent = `${afterDelay} min`;
            this.afterVal.style.color = afterDelay < beforeDelay ? '#41644A' : '#E21C1C';
        }

        // Add to history log list
        const attemptNum = this.historyList.length + 1;
        const desc = this.manager.getLastInterventionDescription() || `Strategy #${attemptNum}`;
        const item = {
            id: `attempt_${attemptNum}`,
            name: `Attempt ${attemptNum}: ${desc}`,
            score: `${improvement}% Better`,
            payload: JSON.parse(JSON.stringify(this.manager.activeInterventions))
        };

        this.historyList.push(item);
        this.renderHistory();
    }

    renderHistory() {
        if (!this.historyBox) return;

        if (this.historyList.length === 0) {
            this.historyBox.innerHTML = `<div style="font-size: 0.75rem; color: #8C847E; text-align: center; padding: 10px;">No sandboxed plans run yet</div>`;
            return;
        }

        this.historyBox.innerHTML = '';
        this.historyList.forEach(h => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <span class="history-name">${h.name}</span>
                <span class="history-score">${h.score}</span>
            `;
            
            // Allow clicking to re-apply that strategy
            div.addEventListener('click', () => {
                this.manager.loadInterventionPayload(h.payload);
            });
            this.historyBox.appendChild(div);
        });
    }

    async generateAIPlan() {
        if (!this.manager.activeEventEdgeId) {
            alert("Please trigger a traffic event first before generating an AI plan.");
            return;
        }

        this.btnAutoRecommend.disabled = true;
        this.btnAutoRecommend.textContent = "AI Calculating Best Plan...";

        try {
            const res = await fetch('/api/intervention/recommend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    edge_id: this.manager.activeEventEdgeId,
                    road_name: this.manager.activeEventRoadName
                })
            });

            if (res.ok) {
                const plan = await res.json();
                
                // Alert the recommendations plan nicely
                let message = `${plan.plan_title}:\n`;
                plan.recommendations.forEach((r, idx) => {
                    message += `${idx + 1}. ${r}\n`;
                });
                alert(message);

                // Load recommendation payload directly into active sandbox and run simulation!
                this.manager.loadInterventionPayload(plan.interventions);
                this.manager.simulateInterventions();
            } else {
                throw new Error("Failed to query AI recommendation");
            }
        } catch (e) {
            console.error("AI recommendation failure:", e);
            alert("Error generating plan: " + e.message);
        } finally {
            this.btnAutoRecommend.disabled = false;
            this.btnAutoRecommend.innerHTML = `<i class="material-icons">psychology</i> Generate AI Plan`;
        }
    }

    clear() {
        this.historyList = [];
        this.renderHistory();
        if (this.beforeVal) this.beforeVal.textContent = '--';
        if (this.afterVal) this.afterVal.textContent = '--';
    }
}
