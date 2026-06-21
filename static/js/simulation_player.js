/**
 * Traffic Twin Bengaluru — Advanced Simulation Player
 * Enhances TimelineSimulator with smooth lerping, play/pause controls, speed levels (1x, 2x, 5x),
 * and +120 min timeline tick marks.
 */

class SimulationPlayer {
    constructor(onStateChangeCallback) {
        this.onStateChangeCallback = onStateChangeCallback;
        
        // DOM Elements
        this.slider = document.getElementById('timeline-slider');
        this.playBtn = document.getElementById('btn-play');
        this.display = document.getElementById('current-sim-time');
        
        // State
        this.currentTime = 0;
        this.isPlaying = false;
        this.playInterval = null;
        this.playbackSpeedMultiplier = 1; // 1x, 2x, 5x
        this.timelineCache = {};
        
        // Interpolation
        this.isInterpolating = false;
        this.interpolationFrameId = null;
        this.currentRenderedState = {
            avg_congestion: 15.0,
            avg_speed: 34.0,
            critical_roads: 0,
            roads: {}
        };
        
        this.init();
    }

    init() {
        // Slider drag input
        if (this.slider) {
            this.slider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                this.setSimTime(val);
            });
        }

        // Play/Pause button
        if (this.playBtn) {
            this.playBtn.addEventListener('click', () => {
                if (this.isPlaying) {
                    this.pause();
                } else {
                    this.play();
                }
            });
        }

        // Clickable tick labels (dynamically handle click events)
        document.addEventListener('click', (e) => {
            const tick = e.target.closest('.tick-label');
            if (tick) {
                const val = parseInt(tick.getAttribute('data-val'));
                this.setSimTime(val);
            }
        });

        // Initialize speed selector if not in html
        this.setupSpeedControls();
    }

    setupSpeedControls() {
        // We'll create or select speed control elements
        let container = document.getElementById('timeline-speed-controls');
        if (!container) {
            container = document.createElement('div');
            container.id = 'timeline-speed-controls';
            container.className = 'timeline-speed-controls';
            container.innerHTML = `
                <button class="btn-speed active" data-speed="1">1x</button>
                <button class="btn-speed" data-speed="2">2x</button>
                <button class="btn-speed" data-speed="5">5x</button>
            `;
            
            // Insert it after the play button
            const playWrapper = this.playBtn?.parentNode;
            if (playWrapper) {
                playWrapper.appendChild(container);
            }
        }

        // Bind clicks
        container.querySelectorAll('.btn-speed').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.btn-speed').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.playbackSpeedMultiplier = parseInt(btn.getAttribute('data-speed'));
                
                // Restart playback interval if playing
                if (this.isPlaying) {
                    this.pause();
                    this.play();
                }
            });
        });
    }

    async setSimTime(minutes, forceImmediate = false) {
        this.currentTime = minutes;
        if (this.slider) this.slider.value = minutes;
        if (this.display) this.display.textContent = `T + ${minutes} min`;
        
        // Highlight active tick label
        document.querySelectorAll('.tick-label').forEach(tick => {
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
            if (forceImmediate || !this.currentRenderedState.roads || Object.keys(this.currentRenderedState.roads).length === 0) {
                this.currentRenderedState = JSON.parse(JSON.stringify(data));
                this.updateStatsPanel(data);
                this.onStateChangeCallback(data);
            } else {
                this.interpolateToState(data);
            }

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

    interpolateToState(targetData) {
        // Cancel any active interpolation
        if (this.interpolationFrameId) {
            cancelAnimationFrame(this.interpolationFrameId);
        }

        const startState = JSON.parse(JSON.stringify(this.currentRenderedState));
        const startTime = performance.now();
        
        // Interpolation duration in ms: scales down at higher playback speeds
        const duration = 800 / this.playbackSpeedMultiplier;

        const animate = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(1.0, elapsed / duration);
            
            // Lerp metrics
            const currentAvgCong = startState.avg_congestion + (targetData.avg_congestion - startState.avg_congestion) * progress;
            const currentAvgSpeed = startState.avg_speed + (targetData.avg_speed - startState.avg_speed) * progress;
            const currentCritical = Math.round(startState.critical_roads + (targetData.critical_roads - startState.critical_roads) * progress);

            const tempState = {
                avg_congestion: Math.round(currentAvgCong),
                avg_speed: Math.round(currentAvgSpeed * 10) / 10,
                critical_roads: currentCritical,
                roads: {}
            };

            // Lerp individual roads
            Object.keys(targetData.roads).forEach(eid => {
                const startRoad = startState.roads[eid] || { congestion_score: 0.15, current_speed: 35.0 };
                const targetRoad = targetData.roads[eid];

                const cong = startRoad.congestion_score + (targetRoad.congestion_score - startRoad.congestion_score) * progress;
                const speed = startRoad.current_speed + (targetRoad.current_speed - startRoad.current_speed) * progress;

                tempState.roads[eid] = {
                    congestion_score: cong,
                    current_speed: speed
                };
            });

            // Update UI metrics
            this.updateStatsPanel(tempState);
            this.onStateChangeCallback(tempState);
            this.currentRenderedState = tempState;

            if (progress < 1.0) {
                this.interpolationFrameId = requestAnimationFrame(animate);
            } else {
                this.currentRenderedState = targetData;
                this.updateStatsPanel(targetData);
                this.onStateChangeCallback(targetData);
                this.interpolationFrameId = null;
            }
        };

        this.interpolationFrameId = requestAnimationFrame(animate);
    }

    updateStatsPanel(data) {
        const congEl = document.getElementById('metric-congestion');
        const speedEl = document.getElementById('metric-speed');
        const critEl = document.getElementById('metric-critical');

        if (congEl) congEl.textContent = `${Math.round(data.avg_congestion)}%`;
        if (speedEl) speedEl.textContent = `${data.avg_speed.toFixed(1)} km/h`;
        if (critEl) {
            critEl.textContent = data.critical_roads;
            if (data.critical_roads > 5) {
                critEl.className = "metric-val text-red";
            } else {
                critEl.className = "metric-val text-orange";
            }
        }
    }

    play() {
        this.isPlaying = true;
        if (this.playBtn) {
            this.playBtn.innerHTML = '<i class="material-icons">pause</i>';
        }
        
        // Base step delay is 3000ms. Scales down as playback speed increase.
        const delay = 3000 / this.playbackSpeedMultiplier;

        this.playInterval = setInterval(() => {
            const steps = [0, 15, 30, 45, 60, 120];
            const currentIndex = steps.indexOf(this.currentTime);
            let nextIndex = currentIndex + 1;
            if (nextIndex >= steps.length) {
                nextIndex = 0; // Loop back
            }
            this.setSimTime(steps[nextIndex]);
        }, delay);

        if (window.notifications) {
            window.notifications.show(`Playback active at ${this.playbackSpeedMultiplier}x speed`, 'info');
        }
    }

    pause() {
        this.isPlaying = false;
        if (this.playBtn) {
            this.playBtn.innerHTML = '<i class="material-icons">play_arrow</i>';
        }
        
        if (this.playInterval) {
            clearInterval(this.playInterval);
            this.playInterval = null;
        }
    }

    reset() {
        this.pause();
        this.setSimTime(0, true);
        if (window.notifications) {
            window.notifications.show('Simulation playback reset to NOW', 'info');
        }
    }

    clearCache() {
        this.timelineCache = {};
    }
}
