// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Signal Timing Optimizer UI
 */

class SignalOptimizerUI {
    constructor() {
        this.btnOptimize = document.getElementById('btn-optimize-signal');
        this.comparisonBox = document.getElementById('timing-comparison-box');
        this.changesList = document.getElementById('timing-changes-list');
        
        // Recommendation card
        this.recsCard = document.getElementById('signal-recommendation-card');
        this.recsTitle = document.getElementById('sig-recs-title');
        this.recsDesc = document.getElementById('sig-recs-desc');
    }

    init(manager) {
        this.manager = manager;

        if (this.btnOptimize) {
            this.btnOptimize.addEventListener('click', () => this.optimizeTimings());
        }
    }

    async optimizeTimings() {
        if (!this.manager.selectedSignalId) {
            alert("Please select a junction first.");
            return;
        }

        this.btnOptimize.disabled = true;
        this.btnOptimize.innerHTML = `<i class="material-icons" style="animation: spin 1s infinite linear;">restart_alt</i> Optimizing...`;

        try {
            const res = await fetch('/api/signals/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    signal_id: this.manager.selectedSignalId
                })
            });

            if (res.ok) {
                const report = await res.json();
                
                // Show sliding animation list of changes
                this.renderTimingChanges(report.before, report.after);

                // Update recommendation card
                if (this.recsCard) {
                    this.recsCard.style.display = 'block';
                    this.recsTitle.textContent = `Reason: ${report.reason}`;
                    this.recsDesc.textContent = `Expected waiting reduction: ${report.expected_reduction_pct}%`;
                }

                // Force update on simulator state
                const activeSig = junctionSimulator.getSignalState(this.manager.selectedSignalId);
                if (activeSig) {
                    activeSig.timer = 90; // Extend active green phase
                }
            }
        } catch (e) {
            console.error("Optimization failed:", e);
        } finally {
            this.btnOptimize.disabled = false;
            this.btnOptimize.innerHTML = `<i class="material-icons">bolt</i> Optimize Signal Timing`;
        }
    }

    renderTimingChanges(before, after) {
        if (!this.comparisonBox || !this.changesList) return;

        this.comparisonBox.style.display = 'block';
        this.changesList.innerHTML = '';

        Object.keys(before).forEach(dir => {
            const bVal = before[dir];
            const aVal = after[dir];

            const row = document.createElement('div');
            row.style.marginBottom = '8px';
            row.innerHTML = `
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 2px;">
                    <strong>${dir} approach</strong>
                    <span>${bVal}s → <strong style="color: #E86A33;">${aVal}s</strong></span>
                </div>
                <div style="background: #EAE5DF; height: 6px; border-radius: 3px; position: relative; overflow: hidden;">
                    <div class="before-bar" style="position: absolute; left: 0; top: 0; height: 100%; background: #8C847E; width: 0%; transition: width 0.6s ease;"></div>
                    <div class="after-bar" style="position: absolute; left: 0; top: 0; height: 100%; background: #E86A33; width: 0%; transition: width 0.6s ease; opacity: 0.85;"></div>
                </div>
            `;

            this.changesList.appendChild(row);

            // Trigger sliding width animation
            setTimeout(() => {
                const bBar = row.querySelector('.before-bar');
                const aBar = row.querySelector('.after-bar');
                if (bBar) bBar.style.width = `${(bVal / 180) * 100}%`;
                if (aBar) aBar.style.width = `${(aVal / 180) * 100}%`;
            }, 50);
        });
    }

    clear() {
        if (this.comparisonBox) this.comparisonBox.style.display = 'none';
        if (this.recsCard) this.recsCard.style.display = 'none';
    }
}
