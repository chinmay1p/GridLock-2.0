// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Timeline Slider and Simulation Control
 */

class TimelineSimulator {
    constructor(onStateChangeCallback) {
        this.onStateChangeCallback = onStateChangeCallback;
        
        // DOM Elements
        this.slider = document.getElementById('timeline-slider');
        this.playBtn = document.getElementById('btn-play');
        this.display = document.getElementById('current-sim-time');
        this.ticks = document.querySelectorAll('.tick-label');
        
        // State
        this.currentTime = 0;
        this.isPlaying = false;
        this.playInterval = null;
        this.timelineCache = {}; // Cache of step state: minutes -> data

        this.initEvents();
    }

    initEvents() {
        if (!this.slider || !this.playBtn || !this.display) {
            return;
        }
        // Slider drag input
        this.slider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            this.setSimTime(val);
        });

        // Play/Pause button
        this.playBtn.addEventListener('click', () => {
            if (this.isPlaying) {
                this.pause();
            } else {
                this.play();
            }
        });

        // Clickable tick labels
        this.ticks.forEach(tick => {
            tick.addEventListener('click', () => {
                const val = parseInt(tick.getAttribute('data-val'));
                this.setSimTime(val);
            });
        });
    }

    async setSimTime(minutes) {
        this.currentTime = minutes;
        this.slider.value = minutes;
        this.display.textContent = `T + ${minutes} min`;
        
        // Highlight active tick label
        this.ticks.forEach(tick => {
            const val = parseInt(tick.getAttribute('data-val'));
            if (val === minutes) {
                tick.classList.add('active');
            } else {
                tick.classList.remove('active');
            }
        });

        // Fetch new states for this timestamp
        const data = await this.fetchTimelineState(minutes);
        if (data) {
            this.updateStatsPanel(data);
            this.onStateChangeCallback(data);

            // Sync signal queues to predicted congestion at this time step
            if (typeof junctionSimulator !== 'undefined' && junctionSimulator) {
                const avgCong = parseFloat(data.avg_congestion) || 30;
                junctionSimulator.applyTimelineState(minutes, avgCong);
            }
        }
    }

    async fetchTimelineState(minutes) {
        if (this.timelineCache[minutes]) {
            return this.timelineCache[minutes];
        }
        
        try {
            const response = await fetch(`/api/traffic/timeline?time=${minutes}`);
            if (!response.ok) throw new Error('Timeline fetch failed');
            
            const data = await response.json();
            this.timelineCache[minutes] = data;
            return data;
        } catch (error) {
            console.error('Error fetching timeline state:', error);
            return null;
        }
    }

    updateStatsPanel(data) {
        const congestionEl = document.getElementById('metric-congestion');
        const speedEl = document.getElementById('metric-speed');
        const criticalEl = document.getElementById('metric-critical');
        if (congestionEl) congestionEl.textContent = `${data.avg_congestion}%`;
        if (speedEl) speedEl.textContent = `${data.avg_speed} km/h`;
        if (criticalEl) criticalEl.textContent = data.critical_roads;
        
        // Highlight critical count card if count > 0
        if (!criticalEl) return;
        if (data.critical_roads > 5) {
            criticalEl.className = "metric-val text-red";
        } else {
            criticalEl.className = "metric-val text-orange";
        }
    }

    play() {
        this.isPlaying = true;
        this.playBtn.innerHTML = '<i data-lucide="pause"></i>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        
        this.playInterval = setInterval(() => {
            const step = parseInt(this.slider.step || '15', 10);
            const maxVal = parseInt(this.slider.max || '120', 10);
            let nextVal = this.currentTime + step;
            if (nextVal > maxVal) {
                nextVal = 0; // Loop back
            }
            this.setSimTime(nextVal);
        }, 3000); // 3 seconds per step
    }

    pause() {
        this.isPlaying = false;
        this.playBtn.innerHTML = '<i data-lucide="play"></i>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        
        if (this.playInterval) {
            clearInterval(this.playInterval);
            this.playInterval = null;
        }
    }

    clearCache() {
        this.timelineCache = {};
    }
}
