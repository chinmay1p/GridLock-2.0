// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Recommendation Panel Controller
 */

class RecommendationPanel {
    constructor() {
        this.container = document.getElementById('assistant-sidebar');
        this.situationText = document.getElementById('assistant-situation-text');
        this.severityBadge = document.getElementById('assistant-severity-badge');
        this.closureProb = document.getElementById('assistant-closure-prob');
        this.factorsList = document.getElementById('assistant-factors-list');
        this.strategyList = document.getElementById('assistant-strategy-list');
        this.improvementVal = document.getElementById('assistant-improvement-val');
        this.clearanceVal = document.getElementById('assistant-clearance-val');
        this.explanationsList = document.getElementById('assistant-explanations-list');
        
        // Hide/Show containers
        this.severityCard = document.getElementById('card-severity');
        this.recommendationsCard = document.getElementById('card-recommendations');
        this.improvementCard = document.getElementById('card-improvement');
        this.explanationsCard = document.getElementById('card-explanations');
        this.exportRow = document.getElementById('assistant-export-row');

        // Current analysis data reference
        this.analysisData = null;
        
        this.bindEvents();
    }

    bindEvents() {
        // Close sidebar btn
        const closeBtn = document.getElementById('btn-close-assistant');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hidePanel());
        }

        // Strategy tab switches
        document.querySelectorAll('.plan-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const planId = tab.getAttribute('data-plan');
                this.selectPlanTab(planId);
            });
        });

        // Simulate Plan Button
        const simBtn = document.getElementById('btn-assistant-simulate');
        if (simBtn) {
            simBtn.addEventListener('click', () => {
                if (typeof actionPlanner !== 'undefined') actionPlanner.simulatePlan();
            });
        }

        // Apply Plan Button
        const applyBtn = document.getElementById('btn-assistant-apply');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                if (typeof actionPlanner !== 'undefined') actionPlanner.applyPlan();
            });
        }

        // Export Buttons
        const pdfBtn = document.getElementById('btn-export-pdf');
        if (pdfBtn) {
            pdfBtn.addEventListener('click', () => this.exportPDFReport());
        }

        const jsonBtn = document.getElementById('btn-export-json');
        if (jsonBtn) {
            jsonBtn.addEventListener('click', () => this.exportJSONReport());
        }
    }

    showPanel() {
        if (this.container) {
            this.container.classList.add('active');
        }
    }

    hidePanel() {
        if (this.container) {
            this.container.classList.remove('active');
        }
    }

    updatePanelData(analysis) {
        this.analysisData = analysis;
        actionPlanner.init(analysis);

        // 1. Situation Summary
        if (this.situationText) {
            this.situationText.textContent = analysis.summary || "No active summary.";
        }

        // 2. Severity Badge & Risk
        if (this.severityBadge) {
            this.severityBadge.className = `severity-badge ${analysis.severity.toLowerCase()}`;
            this.severityBadge.textContent = analysis.severity;
        }

        if (this.closureProb) {
            this.closureProb.textContent = `${analysis.closure_probability_pct}%`;
        }

        // Contributing Factors
        if (this.factorsList) {
            this.factorsList.innerHTML = '';
            analysis.severity_factors.forEach(factor => {
                const li = document.createElement('li');
                li.className = 'factor-item';
                li.innerHTML = `<i class="material-icons">chevron_right</i> <span>${factor}</span>`;
                this.factorsList.appendChild(li);
            });
        }

        // Show cards that were hidden
        this.severityCard.style.display = 'block';
        this.recommendationsCard.style.display = 'block';
        this.improvementCard.style.display = 'block';
        this.explanationsCard.style.display = 'block';
        this.exportRow.style.display = 'flex';

        // 3. Explanations List
        if (this.explanationsList) {
            this.explanationsList.innerHTML = '';
            analysis.explanations.forEach(exp => {
                const li = document.createElement('li');
                li.textContent = exp;
                this.explanationsList.appendChild(li);
            });
        }

        // 4. Default to Plan B (Recommended)
        this.selectPlanTab(analysis.recommended_plan_id || "Plan B");
        
        // Show panel if not visible
        this.showPanel();
    }

    selectPlanTab(planId) {
        if (!this.analysisData) return;

        // Update active class on tabs
        document.querySelectorAll('.plan-tab').forEach(tab => {
            if (tab.getAttribute('data-plan') === planId) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        const planData = this.analysisData.plans[planId];
        if (!planData) return;

        // Initialize action planner current plan context
        actionPlanner.setActivePlan(planId, planData);

        // Update Expected Improvements card values
        if (this.improvementVal) {
            this.improvementVal.textContent = `-${planData.congestion_reduction_pct}%`;
        }
        if (this.clearanceVal) {
            this.clearanceVal.textContent = `${planData.clearance_time_min}m`;
        }

        // Populate strategy-list details
        if (this.strategyList) {
            this.strategyList.innerHTML = '';
            
            // Map plan items into visually appealing elements
            const manpower = this.analysisData.recommendations.manpower;
            const diversion = this.analysisData.recommendations.diversion;
            const signals = this.analysisData.recommendations.signal_strategy;

            // Render manpower item
            const itemMan = document.createElement('div');
            itemMan.className = 'strategy-item';
            itemMan.innerHTML = `
                <h4>Manpower Deployment</h4>
                <p>${manpower.description}</p>
            `;
            this.strategyList.appendChild(itemMan);

            // Render diversion item
            const itemDiv = document.createElement('div');
            itemDiv.className = 'strategy-item';
            itemDiv.innerHTML = `
                <h4>Traffic Diversion Route</h4>
                <p>Redirect: <strong>${diversion.route}</strong></p>
                <p style="font-size:0.7rem; color:#8C847E; margin-top:2px;">Reason: ${diversion.reason}</p>
            `;
            this.strategyList.appendChild(itemDiv);

            // Render signals override item
            const itemSig = document.createElement('div');
            itemSig.className = 'strategy-item';
            itemSig.innerHTML = `
                <h4>Signal Override Override</h4>
                <p>Increase outgoing green phase to <strong>${signals.recommended_green_sec}s</strong> (previously ${signals.current_green_sec}s) on corridor ${signals.corridor}.</p>
            `;
            this.strategyList.appendChild(itemSig);

            // Append specific actions listed under the plan
            planData.actions.forEach(action => {
                const itemAct = document.createElement('div');
                itemAct.className = 'strategy-item';
                itemAct.style.borderLeftColor = '#8C847E';
                itemAct.innerHTML = `
                    <h4>Tactical Command Detail</h4>
                    <p>${action}</p>
                `;
                this.strategyList.appendChild(itemAct);
            });
        }
    }

    exportPDFReport() {
        if (!this.analysisData) return;
        
        // Open the markdown report endpoint in a new tab for easy printing/saving
        const reportId = this.analysisData.report_id;
        window.open(`/api/assistant/report/${reportId}?format=markdown`, '_blank');
    }

    exportJSONReport() {
        if (!this.analysisData) return;
        
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.analysisData, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `traffic_report_${this.analysisData.report_id}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    }
}

let recommendationPanel;
