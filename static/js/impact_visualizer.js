// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — AI Impact Visualizer
 */

class ImpactVisualizer {
    constructor() {
        this.analysisPanel = document.getElementById('incident-analysis-panel');
        this.badge = document.getElementById('analysis-impact-badge');
        this.confidence = document.getElementById('analysis-confidence');
        this.delay = document.getElementById('analysis-delay');
        this.duration = document.getElementById('analysis-duration');
        this.roadsCount = document.getElementById('analysis-roads-count');
        this.recsList = document.getElementById('analysis-recommendations');
    }

    /**
     * Updates the right sidebar widget with simulated event impact metrics.
     */
    showImpact(result) {
        if (!result || !this.analysisPanel) return;

        // Show panel
        this.analysisPanel.style.display = 'block';

        // Set values
        this.confidence.textContent = `${result.confidence || 85}%`;
        this.delay.textContent = `+${result.expected_delay || 15}m`;
        this.duration.textContent = `${result.expected_duration || 60} min`;
        this.roadsCount.textContent = `${result.affected_roads_count || 5} Roads`;

        // Style the impact badge
        const impact = (result.impact || 'MEDIUM').toUpperCase();
        this.badge.textContent = impact;
        if (impact === 'HIGH' || impact === 'CRITICAL') {
            this.badge.style.background = '#E21C1C';
        } else if (impact === 'MEDIUM') {
            this.badge.style.background = '#E86A33';
        } else {
            this.badge.style.background = '#41644A'; // green
        }

        // Render AI Action Plan Recommendations
        this.recsList.innerHTML = '';
        if (result.recommendations && result.recommendations.length > 0) {
            result.recommendations.forEach(rec => {
                const li = document.createElement('li');
                li.style.marginBottom = '6px';
                li.textContent = rec;
                this.recsList.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.textContent = "Monitor adjacent corridor flow patterns.";
            this.recsList.appendChild(li);
        }

        // Draw dynamic recovery sparkline chart
        this.drawRecoveryChart(result.expected_duration, result.expected_delay);
    }

    /**
     * Dynamically draws a Bezier curve representing traffic congestion decay.
     */
    drawRecoveryChart(duration, delay) {
        const pathEl = document.getElementById('recovery-trend-path');
        if (!pathEl) return;

        // Peak congestion corresponds to lower Y values in SVG (height=40)
        // Normal base flow is Y=35. Let peak scale up with delay severity.
        const peakY = Math.max(4, 32 - (delay * 0.8));
        
        // Construct a cubic Bezier curve that peaks in the first half and clears in the second half
        const pathD = `M 0 35 C 15 35, 25 ${peakY}, 45 ${peakY} C 65 ${peakY}, 80 35, 100 35`;
        pathEl.setAttribute('d', pathD);
    }

    /**
     * Hides the incident analysis panel
     */
    hide() {
        if (this.analysisPanel) {
            this.analysisPanel.style.display = 'none';
        }
    }
}
