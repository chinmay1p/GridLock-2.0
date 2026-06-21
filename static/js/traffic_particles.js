// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Particle Animation System
 * Draws animated vehicle particles on a Canvas overlay synchronized with Leaflet.
 */

class TrafficParticleSystem {
    constructor(map) {
        this.map = map;
        this.roads = [];
        this.particles = [];
        this.animationFrameId = null;
        this.isRunning = true;
        this.lastTime = performance.now();

        // Create Canvas element
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '400'; // draw over tiles, under popups
        
        // Add canvas to Leaflet's overlay pane
        this.map.getPanes().overlayPane.appendChild(this.canvas);
        
        // Bind Leaflet events
        this.map.on('move', this.resetCanvasPosition, this);
        this.map.on('resize', this.resizeCanvas, this);
        
        this.resizeCanvas();
        this.start();
    }

    setRoads(roads) {
        this.roads = roads;
        this.initParticles();
    }

    initParticles() {
        this.particles = [];
        const zoom = this.map ? this.map.getZoom() : 12;
        
        // Dynamic zoom-based density scaling
        let zoomFactor = 1.0;
        if (zoom <= 11) {
            zoomFactor = 0.25;
        } else if (zoom === 12) {
            zoomFactor = 0.45;
        } else if (zoom === 13) {
            zoomFactor = 0.7;
        } else if (zoom === 14) {
            zoomFactor = 1.0;
        } else {
            zoomFactor = 1.3;
        }

        this.roads.forEach(road => {
            if (!road.geometry || road.geometry.length < 2) return;
            
            const baseDensity = 1 + Math.floor(road.capacity / 1000);
            const congestionFactor = road.congestion_score;
            
            let densityScale = 1.0;
            if (congestionFactor > 0.7) {
                densityScale = 2.5; // clustered particles
            } else if (congestionFactor > 0.35) {
                densityScale = 1.5; // medium density
            } else {
                densityScale = 0.75; // more spacing
            }
            
            const particleCount = Math.max(1, Math.round(baseDensity * densityScale * zoomFactor * 1.8));
            
            for (let i = 0; i < particleCount; i++) {
                const baseSpeed = 0.015 + Math.random() * 0.01;
                const speedMultiplier = (road.current_speed / 40.0) * (0.8 + (road.capacity / 5000.0) * 0.4);
                const scale = congestionFactor > 0.7 ? 0.25 : (congestionFactor > 0.35 ? 0.7 : 1.3);
                
                this.particles.push({
                    roadId: road.edge_id,
                    road: road,
                    progress: Math.random(),
                    speed: baseSpeed * speedMultiplier * scale,
                    color: this.getParticleColor(congestionFactor)
                });
            }
        });
    }

    getParticleColor(congestion) {
        if (congestion > 0.7) {
            return '#E21C1C'; // Red / Gridlock
        } else if (congestion > 0.35) {
            return '#E86A33'; // Orange / Saffron / Moderate
        } else {
            return '#00B4D8'; // Bright smart-city blue / Free Flow
        }
    }

    updateRoadStates(roadUpdateMap) {
        this.particles.forEach(p => {
            const update = roadUpdateMap[p.roadId];
            if (update) {
                p.road.congestion_score = update.congestion_score;
                p.road.current_speed = update.current_speed;
            }
            const cong = p.road.congestion_score;
            const currentSpeed = p.road.current_speed;
            
            const baseSpeed = 0.015 + Math.random() * 0.01;
            const speedMultiplier = (currentSpeed / 40.0) * (0.8 + (p.road.capacity / 5000.0) * 0.4);
            const scale = cong > 0.7 ? 0.25 : (cong > 0.35 ? 0.7 : 1.3);
            
            p.speed = baseSpeed * speedMultiplier * scale;
            p.color = this.getParticleColor(cong);
        });
    }

    resizeCanvas() {
        const size = this.map.getSize();
        this.canvas.width = size.x;
        this.canvas.height = size.y;
        this.resetCanvasPosition();
    }

    resetCanvasPosition() {
        const topLeft = this.map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this.canvas, topLeft);
        this.draw();
    }

    start() {
        this.isRunning = true;
        const animate = (timestamp) => {
            if (!this.isRunning) return;
            
            const dt = (timestamp - this.lastTime) / 1000.0;
            this.lastTime = timestamp;
            
            this.update(dt);
            this.draw();
            
            this.animationFrameId = requestAnimationFrame(animate);
        };
        this.animationFrameId = requestAnimationFrame(animate);
    }

    stop() {
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
    }

    update(dt) {
        const delta = Math.min(dt, 0.1);
        
        this.particles.forEach(p => {
            let activeSpeed = p.speed;

            if (typeof signalCoordinator !== 'undefined' && signalCoordinator && signalCoordinator.signals) {
                const geom = p.road.geometry;
                if (geom && geom.length >= 2) {
                    const endPoint = geom[geom.length - 1];
                    const signal = signalCoordinator.signals.find(s => {
                        const dx = endPoint[0] - s.lat;
                        const dy = endPoint[1] - s.lng;
                        return (dx*dx + dy*dy) < 0.0003;
                    });

                    if (signal) {
                        const p1 = geom[geom.length - 2];
                        const p2 = geom[geom.length - 1];
                        const sdy = p2[0] - p1[0];
                        const sdx = p2[1] - p1[1];
                        let angle = Math.atan2(sdy, sdx) * 180 / Math.PI;
                        if (angle < 0) angle += 360;

                        let approachDir = "North";
                        if (45 <= angle && angle < 135) approachDir = "South";
                        else if (135 <= angle && angle < 225) approachDir = "East";
                        else if (225 <= angle && angle < 315) approachDir = "North";
                        else approachDir = "West";

                        if (signal.current_phase !== approachDir) {
                            if (p.progress > 0.80) {
                                const factor = Math.max(0.01, (1.0 - p.progress) / 0.20);
                                activeSpeed *= factor;
                            }
                        }
                    }
                }
            }

            p.progress += activeSpeed * delta * 5.0;
            if (p.progress >= 1.0) {
                p.progress = 0.0;
            }
        });
    }

    draw() {
        const ctx = this.canvas.getContext('2d');
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        const w = this.canvas.width;
        const h = this.canvas.height;
        const timeNow = performance.now();
        
        this.particles.forEach(p => {
            const geom = p.road.geometry;
            if (!geom || geom.length < 2) return;
            
            const pt = this.getPositionAlongLine(geom, p.progress);
            if (!pt) return;
            
            const containerPoint = this.map.latLngToContainerPoint([pt[0], pt[1]]);
            const cx = containerPoint.x;
            const cy = containerPoint.y;
            
            // Viewport clipping optimization: only draw if inside visible canvas
            if (cx < 0 || cy < 0 || cx > w || cy > h) {
                return;
            }
            
            const cong = p.road.congestion_score;
            const hasActiveEvent = (typeof state !== 'undefined' && state && state.activeEvent);
            ctx.beginPath();
            
            if (cong > 0.7 && hasActiveEvent) {
                // HIGH Congestion + Active Event: emergency red pulsing glow
                const pulse = Math.sin(timeNow / 120);
                const radius = 2.5 + pulse * 0.8;
                ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
                ctx.fillStyle = '#ff3333';
                ctx.shadowBlur = 8 + pulse * 4;
                ctx.shadowColor = '#ff3333';
            } else {
                // Normal operations: simple, clean, shadow-free solid circles (extremely fast)
                ctx.arc(cx, cy, 1.8, 0, 2 * Math.PI);
                ctx.fillStyle = p.color;
                ctx.shadowBlur = 0;
                ctx.shadowColor = 'transparent';
            }
            ctx.fill();
        });
    }

    getPositionAlongLine(coords, progress) {
        if (coords.length < 2) return null;
        if (progress <= 0) return coords[0];
        if (progress >= 1) return coords[coords.length - 1];
        
        // Calculate total length in simplified distance (since it's a short segment)
        let segmentLengths = [];
        let totalLen = 0;
        
        for (let i = 0; i < coords.length - 1; i++) {
            const dy = coords[i+1][0] - coords[i][0];
            const dx = coords[i+1][1] - coords[i][1];
            const len = Math.sqrt(dx*dx + dy*dy);
            segmentLengths.push(len);
            totalLen += len;
        }
        
        const targetLen = progress * totalLen;
        let currentLen = 0;
        
        for (let i = 0; i < coords.length - 1; i++) {
            const len = segmentLengths[i];
            if (currentLen + len >= targetLen) {
                const segmentProgress = (targetLen - currentLen) / len;
                const p1 = coords[i];
                const p2 = coords[i+1];
                
                // Interpolate latitude and longitude
                const lat = p1[0] + (p2[0] - p1[0]) * segmentProgress;
                const lng = p1[1] + (p2[1] - p1[1]) * segmentProgress;
                return [lat, lng];
            }
            currentLen += len;
        }
        
        return coords[coords.length - 1];
    }
}
