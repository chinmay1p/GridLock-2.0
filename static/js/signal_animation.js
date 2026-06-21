// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Signal Animation Engine
 */

class SignalAnimationEngine {
    constructor() {
        this.bulbs = {
            North: document.getElementById('light-north'),
            South: document.getElementById('light-south'),
            East: document.getElementById('light-east'),
            West: document.getElementById('light-west')
        };
        this.timers = {
            North: document.getElementById('timer-north'),
            South: document.getElementById('timer-south'),
            East: document.getElementById('timer-east'),
            West: document.getElementById('timer-west')
        };
        this.queues = {
            North: document.getElementById('queue-north'),
            South: document.getElementById('queue-south'),
            East: document.getElementById('queue-east'),
            West: document.getElementById('queue-west')
        };
    }

    updateIntersection(currentPhase, timer, queues) {
        const directions = ["North", "South", "East", "West"];

        directions.forEach(dir => {
            const bulb = this.bulbs[dir];
            const timerEl = this.timers[dir];
            const queueEl = this.queues[dir];

            if (!bulb || !timerEl || !queueEl) return;

            // 1. Update queue count with scale animations on change
            const oldQ = parseInt(queueEl.textContent) || 0;
            const newQ = queues[dir] || 0;
            queueEl.textContent = newQ;
            
            // Style queue color severity
            queueEl.className = 'queue-badge';
            if (newQ > 40) {
                queueEl.classList.add('critical-load');
            } else if (newQ > 25) {
                queueEl.classList.add('high-load');
            }

            if (oldQ !== newQ) {
                queueEl.style.transform = 'scale(1.25)';
                setTimeout(() => queueEl.style.transform = 'scale(1)', 150);
            }

            // 2. Update bulb light state
            bulb.className = 'traffic-light-bulb';
            if (dir === currentPhase) {
                // Active phase gets GREEN
                if (timer <= 3) {
                    bulb.classList.add('yellow'); // Yellow warning in final seconds
                } else {
                    bulb.classList.add('green');
                }
                timerEl.textContent = `${timer}s`;
                timerEl.style.color = '#41644A';
            } else {
                // Inactive phases get RED
                bulb.classList.add('red');
                timerEl.textContent = 'RED';
                timerEl.style.color = '#E21C1C';
            }
        });
    }
}
