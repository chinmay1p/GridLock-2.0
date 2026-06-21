// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Manpower Deployment Tool
 */

class ManpowerTool {
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

        title.textContent = "Deploy Officers";
        formBox.innerHTML = `
            <div style="font-size: 0.8rem; font-weight: 600; color: #2D2A26; margin-bottom: 8px;">
                Location: ${road.road_name || "Custom Segment"}
            </div>
            <div class="event-form-group">
                <label for="officers-count">Officers Count: <span id="officers-val" style="font-weight: 700;">8</span></label>
                <input type="range" id="officers-count" min="1" max="50" step="1" value="8" style="accent-color: #E86A33; width: 100%;">
            </div>
            <div class="event-form-group">
                <label for="manpower-purpose">Purpose</label>
                <select id="manpower-purpose" class="event-form-select">
                    <option value="Traffic regulation" selected>Traffic Regulation & Clearance</option>
                    <option value="Manual signal control">Manual Signal Green Override</option>
                    <option value="Crowd management">Venue Crowd Control</option>
                    <option value="Diversion assistance">Diversion Directing</option>
                </select>
            </div>
            <input type="hidden" id="target-edge-id" value="${road.edge_id}">
            <input type="hidden" id="target-lat" value="${lat}">
            <input type="hidden" id="target-lng" value="${lng}">
        `;

        // Bind live slider count
        const slider = document.getElementById('officers-count');
        const valSpan = document.getElementById('officers-val');
        slider.addEventListener('input', () => {
            valSpan.textContent = slider.value;
        });

        popover.style.display = 'block';
    }

    saveIntervention() {
        const edgeId = document.getElementById('target-edge-id').value;
        const lat = parseFloat(document.getElementById('target-lat').value);
        const lng = parseFloat(document.getElementById('target-lng').value);
        const count = parseInt(document.getElementById('officers-count').value);
        const purpose = document.getElementById('manpower-purpose').value;

        const config = {
            type: "manpower",
            edge_id: edgeId,
            coordinates: { lat, lng },
            parameters: {
                officers_count: count,
                purpose: purpose
            }
        };

        this.manager.addInterventionToSandbox(config);
        
        // Draw professional officer placement icon
        const officerHtml = `
            <div style="width: 32px; height: 32px; background: #007AFF; border: 2px solid #FFFFFF; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.25);">
                <span class="material-icons" style="font-size: 18px; color: #FFFFFF;">local_police</span>
            </div>
        `;

        const icon = L.divIcon({
            html: officerHtml,
            className: 'custom-officer-marker',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        const marker = L.marker([lat, lng], { icon }).addTo(map)
            .bindTooltip(`Officers deployed: ${count} (${purpose})`, { direction: 'top' });

        this.manager.registerMapOverlay(marker);
    }
}
