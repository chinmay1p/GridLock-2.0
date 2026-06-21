/**
 * Traffic Twin Bengaluru — System Status Coordinator
 * Controls the bottom status bar and displays ML Fallback warnings.
 */

class SystemStatusCoordinator {
    constructor() {
        this.statusBar = null;
        this.init();
    }

    init() {
        // Create status bar if not in DOM
        this.statusBar = document.getElementById('system-status-bar');
        if (!this.statusBar) {
            this.statusBar = document.createElement('div');
            this.statusBar.id = 'system-status-bar';
            this.statusBar.className = 'system-status-bar';
            document.body.appendChild(this.statusBar);
        }
        
        this.renderStatus(false); // Default to online
    }

    renderStatus(usingFallback = false) {
        if (!this.statusBar) return;

        const aiStatusText = usingFallback ? 'Fallback Model' : 'Online';
        const aiStatusClass = usingFallback ? 'status-warning' : 'status-online';
        const aiIcon = usingFallback ? 'warning' : 'check_circle';

        this.statusBar.innerHTML = `
            <div class="status-item">
                <span class="status-indicator ${aiStatusClass}"></span>
                <span class="status-label">Traffic AI:</span>
                <span class="status-val">${aiStatusText}</span>
            </div>
            <div class="status-item">
                <span class="status-indicator status-online"></span>
                <span class="status-label">ST-GNN:</span>
                <span class="status-val">Online</span>
            </div>
            <div class="status-item">
                <span class="status-indicator status-online"></span>
                <span class="status-label">Signal AI:</span>
                <span class="status-val">Online</span>
            </div>
            <div class="status-item">
                <span class="status-indicator status-online"></span>
                <span class="status-label">Simulator:</span>
                <span class="status-val">Running</span>
            </div>
        `;

        if (usingFallback && window.notifications) {
            window.notifications.show("System using simulation fallback model.", "warning");
        }
    }

    setFallbackMode(enabled) {
        this.renderStatus(enabled);
    }
}

// Instantiate on load
document.addEventListener('DOMContentLoaded', () => {
    window.systemStatus = new SystemStatusCoordinator();
});
