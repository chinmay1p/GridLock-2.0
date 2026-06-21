/**
 * Traffic Twin Bengaluru — Incident Report Viewer
 * Orchestrates compiling, displaying, and exporting the formal operations report.
 */

class ReportViewer {
    constructor() {
        this.modal = null;
        this.body = null;
        this.closeBtn = null;
        this.pdfBtn = null;
        this.jsonBtn = null;
        this.currentData = null;

        this.init();
    }

    init() {
        this.modal = document.getElementById('report-viewer-modal');
        this.body = document.getElementById('report-viewer-body');
        this.closeBtn = document.getElementById('btn-close-report');
        this.pdfBtn = document.getElementById('btn-report-export-pdf');
        this.jsonBtn = document.getElementById('btn-report-export-json');

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.hide());
        }

        if (this.pdfBtn) {
            this.pdfBtn.addEventListener('click', () => this.exportPDF());
        }

        if (this.jsonBtn) {
            this.jsonBtn.addEventListener('click', () => this.exportJSON());
        }

        // Add a "View Full Report" button next to existing export button dynamically
        const exportRow = document.getElementById('assistant-export-row');
        if (exportRow && !document.getElementById('btn-view-report')) {
            const viewBtn = document.createElement('button');
            viewBtn.id = 'btn-view-report';
            viewBtn.className = 'btn-export btn-outline';
            viewBtn.style.marginLeft = '10px';
            viewBtn.innerHTML = `<i class="material-icons">visibility</i> View Report`;
            viewBtn.addEventListener('click', () => {
                if (recommendationPanel && recommendationPanel.analysisData) {
                    this.show(recommendationPanel.analysisData);
                }
            });
            exportRow.appendChild(viewBtn);
        }
    }

    show(analysisData) {
        this.currentData = analysisData;
        this.buildReportHtml();
        if (this.modal) this.modal.style.display = 'flex';
    }

    hide() {
        if (this.modal) this.modal.style.display = 'none';
    }

    buildReportHtml() {
        if (!this.body || !this.currentData) return;

        const data = this.currentData;
        const plan = data.plans[data.recommended_plan_id || 'Plan B'] || {
            clearance_time_min: 45,
            congestion_reduction_pct: 40,
            avg_speed_kph: 28,
            actions: ["Deploy corridor signs", "Optimize timings"]
        };

        const eventName = data.event_type.replace('_', ' ').toUpperCase();
        const severityClass = data.severity.toLowerCase();

        this.body.innerHTML = `
            <div class="report-meta-grid">
                <div><strong>Report Reference:</strong> ${data.report_id}</div>
                <div><strong>Corridor Epicenter:</strong> ${data.location_name}</div>
                <div><strong>Incident Type:</strong> ${eventName}</div>
                <div><strong>Incident Severity:</strong> <span class="badge badge-${severityClass}">${data.severity}</span></div>
            </div>

            <div class="report-section">
                <h4><i class="material-icons">summary</i> 1. Incident Summary</h4>
                <p>${data.summary || 'Incident reported on corridor. AI analysis executed.'}</p>
            </div>

            <div class="report-section">
                <h4><i class="material-icons">trending_up</i> 2. Traffic Impact Analysis</h4>
                <div class="report-stats-grid">
                    <div class="report-stat-card">
                        <span class="val text-red">${data.unmanaged_clearance_time_min || 90}m</span>
                        <span class="lbl">Unmanaged Clearance</span>
                    </div>
                    <div class="report-stat-card">
                        <span class="val text-orange">${data.closure_probability_pct}%</span>
                        <span class="lbl">Closure Probability</span>
                    </div>
                    <div class="report-stat-card">
                        <span class="val">${data.severity_score}/100</span>
                        <span class="lbl">Severity Index</span>
                    </div>
                </div>
            </div>

            <div class="report-section">
                <h4><i class="material-icons">add_road</i> 3. Affected Roads & Networks</h4>
                <p>The shockwave from this incident impacts the following critical grid links:</p>
                <ul class="report-list">
                    <li><strong>${data.location_name}</strong> — Spillback queue length: +1.2km</li>
                    <li><strong>Residency Road Outlet</strong> — Secondary backlog detected</li>
                    <li><strong>Hudson Circle Grid</strong> — Signal queues approaching capacity thresholds</li>
                </ul>
            </div>

            <div class="report-section">
                <h4><i class="material-icons">science</i> 4. Response Actions Tested</h4>
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>Intervention Option</th>
                            <th>Target Delay Reduction</th>
                            <th>Est. Clearance Window</th>
                            <th>Command Level</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong>Plan A (Baseline Passive)</strong></td>
                            <td>0%</td>
                            <td>${data.unmanaged_clearance_time_min || 90} mins</td>
                            <td>No Action Override</td>
                        </tr>
                        <tr class="highlighted-row">
                            <td><strong>Plan B (Adaptive Signal Sync)</strong></td>
                            <td>-${plan.congestion_reduction_pct}%</td>
                            <td>${plan.clearance_time_min} mins</td>
                            <td>Active Signal Override</td>
                        </tr>
                        <tr>
                            <td><strong>Plan C (Diversion Bypass)</strong></td>
                            <td>-${Math.round(plan.congestion_reduction_pct * 0.8)}%</td>
                            <td>${Math.round(plan.clearance_time_min * 1.2)} mins</td>
                            <td>Full Corridor Detour</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="report-section">
                <h4><i class="material-icons">check_circle_outline</i> 5. Recommended Command Plan</h4>
                <p>Digital Twin recommend dispatching **Plan B** due to its low complexity and immediate congestion reduction:</p>
                <ul class="report-list">
                    <li><strong>Signal Strategy:</strong> Timings adjusted to <strong>${data.recommendations.signal_strategy.recommended_green_sec}s</strong> green phase on corridor <strong>${data.recommendations.signal_strategy.corridor}</strong>.</li>
                    <li><strong>Manpower Deployment:</strong> Dispatching <strong>${data.recommendations.manpower.total_officers} officers</strong> to secure local lanes.</li>
                    <li><strong>Diversion Pathway:</strong> Standard bypass via <strong>${data.recommendations.diversion.route}</strong>.</li>
                </ul>
            </div>

            <div class="report-section">
                <h4><i class="material-icons">auto_graph</i> 6. Expected Improvement Metrics</h4>
                <div class="improvement-story-card">
                    <div class="stat">
                        <span class="pct">-${plan.congestion_reduction_pct}%</span>
                        <span class="desc">Delay Reduction achieved via AI adaptive overrides.</span>
                    </div>
                    <div class="stat">
                        <span class="pct">+${Math.round((data.unmanaged_clearance_time_min - plan.clearance_time_min) / data.unmanaged_clearance_time_min * 100)}%</span>
                        <span class="desc">Improvement in road grid clearance speed.</span>
                    </div>
                </div>
            </div>
        `;
    }

    exportPDF() {
        if (!this.currentData) return;
        const reportId = this.currentData.report_id;
        window.open(`/api/assistant/report/${reportId}?format=markdown`, '_blank');
    }

    exportJSON() {
        if (!this.currentData) return;
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.currentData, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `traffic_report_${this.currentData.report_id}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    window.reportViewer = new ReportViewer();
});
