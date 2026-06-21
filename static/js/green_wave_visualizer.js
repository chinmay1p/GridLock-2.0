// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Green Wave Coordination Visualizer
 */

class GreenWaveVisualizer {
    constructor() {
        this.coordinationLines = [];
        this.isActive = false;
    }

    init(mapInstance, signals) {
        this.map = mapInstance;
        this.signals = signals;
    }

    toggleNetworkView() {
        this.isActive = !this.isActive;
        const btn = document.getElementById('btn-toggle-signals');
        
        if (this.isActive) {
            if (btn) {
                btn.style.background = '#E86A33';
                btn.style.color = '#FFFFFF';
            }
            this.drawCoordinationNetwork();
        } else {
            if (btn) {
                btn.style.background = 'rgba(255, 255, 255, 0.9)';
                btn.style.color = '#E86A33';
            }
            this.clearNetwork();
        }
    }

    drawCoordinationNetwork() {
        this.clearNetwork();

        // Connect adjacent signals that are within 1.5 km
        for (let i = 0; i < this.signals.length; i++) {
            const sigA = this.signals[i];
            
            // Connect to nearest 2 neighbor signals to construct a nice coordinated network web
            const neighbors = this.signals
                .filter(s => s.signal_id !== sigA.signal_id)
                .map(s => ({
                    signal: s,
                    dist: this.getDistance(sigA.lat, sigA.lng, s.lat, s.lng)
                }))
                .filter(item => item.dist < 0.015) // roughly 1.5km
                .sort((a, b) => a.dist - b.dist)
                .slice(0, 2);

            neighbors.forEach(n => {
                const coords = [
                    [sigA.lat, sigA.lng],
                    [n.signal.lat, n.signal.lng]
                ];

                // Coordinated green wave link: thin blue dashed line with moving dashOffset animation
                const line = L.polyline(coords, {
                    color: '#007AFF',
                    weight: 3,
                    opacity: 0.7,
                    dashArray: '8, 12',
                    className: 'animated-coordination-line'
                }).addTo(this.map);

                // Add coordination wave particle effect (a tiny moving dot)
                const waveMarker = L.circleMarker([sigA.lat, sigA.lng], {
                    radius: 5,
                    color: '#FFF',
                    fillColor: '#00B4D8',
                    fillOpacity: 1,
                    weight: 2
                }).addTo(this.map);

                this.coordinationLines.push(line);
                this.coordinationLines.push(waveMarker);

                // Animate coordination dot back and forth along the path
                this.animateWave(waveMarker, coords);
            });
        }
    }

    animateWave(marker, coords) {
        let percent = 0;
        const start = coords[0];
        const end = coords[1];
        
        const interval = setInterval(() => {
            if (!this.isActive) {
                clearInterval(interval);
                return;
            }
            percent += 0.02;
            if (percent > 1) percent = 0;

            const lat = start[0] + (end[0] - start[0]) * percent;
            const lng = start[1] + (end[1] - start[1]) * percent;
            marker.setLatLng([lat, lng]);
        }, 50);
    }

    getDistance(lat1, lon1, lat2, lon2) {
        // Simple euclidean approximation for local distances
        return Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(lon1 - lon2, 2));
    }

    clearNetwork() {
        this.coordinationLines.forEach(l => this.map.removeLayer(l));
        this.coordinationLines = [];
    }
}
