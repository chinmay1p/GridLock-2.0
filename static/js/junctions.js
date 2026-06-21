// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Junction Markers Layer Manager
 */

class JunctionManager {
    constructor(map, inspectCallback) {
        this.map = map;
        this.inspectCallback = inspectCallback;
        this.junctions = [];
        this.markers = [];
        this.layerGroup = L.layerGroup().addTo(this.map);
    }

    async loadJunctions(zoom) {
        try {
            const response = await fetch(`/api/junctions?zoom=${zoom}`);
            if (!response.ok) throw new Error('Junctions fetch failed');
            
            this.junctions = await response.json();
            this.renderMarkers();
        } catch (error) {
            console.error('Error loading junctions:', error);
        }
    }

    renderMarkers() {
        // Clear old markers
        this.layerGroup.clearLayers();
        this.markers = [];
        
        this.junctions.forEach(junc => {
            const hasSignal = junc.traffic_signal_available === 1;
            
            // Create a custom DivIcon
            const iconHtml = hasSignal 
                ? `<div class="junction-marker-icon" style="width:28px;height:28px;"><span class="material-icons" style="font-size:18px;color:#41644A;">traffic</span></div>`
                : `<div class="junction-marker-icon signal-off" style="width:20px;height:20px;"><span class="material-icons" style="font-size:12px;color:rgba(45,42,38,0.5);">circle</span></div>`;
                
            const markerIcon = L.divIcon({
                html: iconHtml,
                className: 'custom-junction-icon',
                iconSize: hasSignal ? [28, 28] : [20, 20],
                iconAnchor: hasSignal ? [14, 14] : [10, 10]
            });
            
            const marker = L.marker([junc.lat, junc.lng], { icon: markerIcon })
                .bindTooltip(`Junction #${junc.junction_id.replace('junction_', '')}`, { direction: 'top', offset: [0, -10] });
                
            marker.on('click', () => {
                this.inspectCallback(junc);
            });
            
            this.layerGroup.addLayer(marker);
            this.markers.push(marker);
        });
    }

    clear() {
        this.layerGroup.clearLayers();
        this.markers = [];
    }
}
