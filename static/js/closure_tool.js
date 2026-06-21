// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Road Closure Tool
 */

class ClosureTool {
    constructor(manager) {
        this.manager = manager;
    }

    activate() {
        this.manager.setMapCursor('crosshair');
        map.once('click', (e) => this.handleMapClick(e));
    }

    async handleMapClick(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        
        this.manager.setMapCursor('');

        try {
            const res = await fetch(`/api/roads/nearest?lat=${lat}&lng=${lng}`);
            if (res.ok) {
                const road = await res.json();
                this.promptConfig(road, lat, lng);
            } else {
                throw new Error("Unable to snap road segment");
            }
        } catch (err) {
            console.error(err);
            alert("Please click closer to a road segment corridor.");
        }
    }

    promptConfig(road, lat, lng) {
        const popover = document.getElementById('intervention-config-popover');
        const title = document.getElementById('popover-title');
        const formBox = document.getElementById('popover-form-content');

        if (!popover || !formBox) return;

        title.textContent = "Road Closure Setup";
        formBox.innerHTML = `
            <div style="font-size: 0.8rem; font-weight: 600; color: #2D2A26; margin-bottom: 8px;">
                Road Corridor: ${road.road_name || "Custom Segment"}
            </div>
            <div class="event-form-group">
                <label for="closure-type">Closure Level</label>
                <select id="closure-type" class="event-form-select">
                    <option value="Complete closure" selected>Complete Closure (Full Blockage)</option>
                    <option value="One side closure">One Side Closure (One-Way)</option>
                    <option value="Emergency lane open">Emergency Lane Operational Only</option>
                </select>
            </div>
            <input type="hidden" id="target-edge-id" value="${road.edge_id}">
            <input type="hidden" id="target-lat" value="${lat}">
            <input type="hidden" id="target-lng" value="${lng}">
        `;

        popover.style.display = 'block';
    }

    saveIntervention() {
        const edgeId = document.getElementById('target-edge-id').value;
        const lat = parseFloat(document.getElementById('target-lat').value);
        const lng = parseFloat(document.getElementById('target-lng').value);
        const cType = document.getElementById('closure-type').value;

        const config = {
            type: "closure",
            edge_id: edgeId,
            coordinates: { lat, lng },
            parameters: {
                closure_type: cType
            }
        };

        this.manager.addInterventionToSandbox(config);
        
        // Draw professional closure "no entry" icon
        const closureHtml = `
            <div style="width: 32px; height: 32px; background: #FF3B30; border: 2px solid #FFFFFF; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.25);">
                <span class="material-icons" style="font-size: 18px; color: #FFFFFF;">do_not_disturb_on</span>
            </div>
        `;

        const icon = L.divIcon({
            html: closureHtml,
            className: 'custom-closure-marker',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        const marker = L.marker([lat, lng], { icon }).addTo(map)
            .bindTooltip(`Closure: ${cType}`, { direction: 'top' });

        this.manager.registerMapOverlay(marker);
    }
}
