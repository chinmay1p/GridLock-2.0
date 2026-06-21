// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Barricade Tool
 */

class BarricadeTool {
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
            // Snaps coordinate to nearest road segment
            const res = await fetch(`/api/roads/nearest?lat=${lat}&lng=${lng}`);
            if (res.ok) {
                const road = await res.json();
                this.promptConfig(road, lat, lng);
            } else {
                throw new Error("Unable to snapping road segment");
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

        title.textContent = "Barricade Setup";
        formBox.innerHTML = `
            <div style="font-size: 0.8rem; font-weight: 600; color: #2D2A26; margin-bottom: 8px;">
                Road: ${road.road_name || "Custom Segment"}
            </div>
            <div class="event-form-group">
                <label for="barricade-type">Barricade Type</label>
                <select id="barricade-type" class="event-form-select">
                    <option value="Soft barricade">Soft Barricade (Cones/Tape)</option>
                    <option value="Hard barricade" selected>Hard Barricade (Concrete/Metal)</option>
                </select>
            </div>
            <div class="event-form-group">
                <label>Lane Reduction</label>
                <div style="display: flex; gap: 10px; margin-top: 4px;">
                    <label style="font-size: 0.8rem; display: flex; align-items: center; gap: 4px; font-weight: 500;">
                        <input type="radio" name="barricade-reduction" value="25" checked> 25%
                    </label>
                    <label style="font-size: 0.8rem; display: flex; align-items: center; gap: 4px; font-weight: 500;">
                        <input type="radio" name="barricade-reduction" value="50"> 50%
                    </label>
                    <label style="font-size: 0.8rem; display: flex; align-items: center; gap: 4px; font-weight: 500;">
                        <input type="radio" name="barricade-reduction" value="75"> 75%
                    </label>
                </div>
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
        const bType = document.getElementById('barricade-type').value;
        
        const checkedReduction = document.querySelector('input[name="barricade-reduction"]:checked');
        const reduction = checkedReduction ? parseInt(checkedReduction.value) : 50;

        const config = {
            type: "barricade",
            edge_id: edgeId,
            coordinates: { lat, lng },
            parameters: {
                barricade_type: bType,
                reduction_pct: reduction
            }
        };

        this.manager.addInterventionToSandbox(config);
        
        // Draw professional barricade SVG icon on Leaflet map
        const barrierHtml = `
            <div style="width: 32px; height: 32px; background: #FFC93C; border: 2px solid #E21C1C; border-radius: 6px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.25);">
                <span class="material-icons" style="font-size: 18px; color: #E21C1C;">fence</span>
            </div>
        `;

        const icon = L.divIcon({
            html: barrierHtml,
            className: 'custom-barrier-marker',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        const marker = L.marker([lat, lng], { icon }).addTo(map)
            .bindTooltip(`Barricade (${reduction}% Lane Reduction)`, { direction: 'top' });

        this.manager.registerMapOverlay(marker);
    }
}
