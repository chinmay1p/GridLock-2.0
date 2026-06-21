/**
 * Traffic Twin Bengaluru — Custom Notifications System
 * Replaces standard browser alerts with professional operations-room style toast cards.
 */

class NotificationManager {
    constructor() {
        this.container = null;
        this.init();
    }

    init() {
        // Create container if not exists
        this.container = document.getElementById('toast-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    }

    show(message, type = 'info', duration = 5000) {
        if (!this.container) this.init();

        const toast = document.createElement('div');
        toast.className = `toast-card toast-${type} fade-in-toast`;
        
        let icon = 'info';
        if (type === 'success') icon = 'check_circle';
        else if (type === 'warning') icon = 'warning';
        else if (type === 'error') icon = 'error_outline';
        else if (type === 'ai') icon = 'psychology';

        toast.innerHTML = `
            <i class="material-icons toast-icon">${icon}</i>
            <div class="toast-content">
                <span class="toast-message">${message}</span>
            </div>
            <button class="toast-close-btn">&times;</button>
        `;

        // Close button listener
        toast.querySelector('.toast-close-btn').addEventListener('click', () => {
            this.dismiss(toast);
        });

        this.container.appendChild(toast);

        // Auto dismiss
        setTimeout(() => {
            this.dismiss(toast);
        }, duration);
    }

    dismiss(toast) {
        toast.classList.remove('fade-in-toast');
        toast.classList.add('fade-out-toast');
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    }
}

// Instantiate globally
window.notifications = new NotificationManager();

// Overwrite window.alert with custom notifications
window.alert = function(msg) {
    if (msg.includes('applied') || msg.includes('complete') || msg.includes('success')) {
        window.notifications.show(msg, 'success');
    } else if (msg.includes('failed') || msg.includes('error')) {
        window.notifications.show(msg, 'error');
    } else {
        window.notifications.show(msg, 'info');
    }
};
