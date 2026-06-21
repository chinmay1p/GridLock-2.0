// [ignoring loop detection]
/**
 * Traffic Twin Bengaluru — Event Animation & Marker Systems
 */

class EventAnimationEngine {
    constructor(mapInstance) {
        this.map = mapInstance;
        this.markers = {};        // Map of eventId -> Leaflet Marker
        this.pulses = {};         // Map of eventId -> Array of active pulse circles
        this.pulseIntervals = {}; // Map of eventId -> setInterval ID
    }

    /**
     * Creates and adds a styled incident marker onto the map.
     */
    addEventMarker(eventId, lat, lng, type, detailsCallback) {
        // Remove existing if any
        this.removeEvent(eventId);

        let iconClass = 'event-icon-wrapper';
        let iconName = 'report_problem'; // default warning

        const t = type.toLowerCase();
        if (t.includes('accident') || t.includes('crash')) {
            iconClass += ' accident';
            iconName = 'car_crash';
        } else if (t.includes('construction') || t.includes('road_work')) {
            iconClass += ' construction';
            iconName = 'construction';
        } else if (t.includes('public_event') || t.includes('crowd')) {
            iconClass += ' public_event';
            iconName = 'groups';
        } else if (t.includes('water') || t.includes('flood')) {
            iconClass += ' weather';
            iconName = 'water_drop';
        } else if (t.includes('breakdown')) {
            iconClass += ' breakdown';
            iconName = 'car_repair';
        } else if (t.includes('vip')) {
            iconClass += ' vip';
            iconName = 'shield_person';
        }

        // Custom Leaflet DivIcon
        const customIcon = L.divIcon({
            html: `<div class="${iconClass}">
                     <i class="material-icons">${iconName}</i>
                   </div>`,
            className: 'custom-event-marker',
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });

        const marker = L.marker([lat, lng], { icon: customIcon }).addTo(this.map);
        
        if (detailsCallback) {
            marker.on('click', () => detailsCallback(eventId));
        }

        this.markers[eventId] = marker;

        // Add radiating shock wave pulse animation
        const pulseColor = t.includes('public_event') ? '#2D82B7' : '#E21C1C';
        this.startPulseAnimation(eventId, lat, lng, pulseColor);
    }

    /**
     * Spawns expanding wave circles at the event location
     */
    startPulseAnimation(eventId, lat, lng, color) {
        const pulseCircle = L.circle([lat, lng], {
            radius: 10,
            color: color,
            fillColor: color,
            fillOpacity: 0.4,
            weight: 1.5,
            interactive: false
        }).addTo(this.map);

        this.pulses[eventId] = pulseCircle;

        let radius = 10;
        let opacity = 0.4;

        const animInterval = setInterval(() => {
            radius += 20;
            opacity -= 0.012;

            if (radius > 600) {
                radius = 10;
                opacity = 0.4;
            }

            pulseCircle.setRadius(radius);
            pulseCircle.setStyle({
                opacity: opacity,
                fillOpacity: opacity * 0.8
            });
        }, 40);

        this.pulseIntervals[eventId] = animInterval;
    }

    /**
     * Removes event markers and cancels animation intervals
     */
    removeEvent(eventId) {
        if (this.markers[eventId]) {
            this.map.removeLayer(this.markers[eventId]);
            delete this.markers[eventId];
        }

        if (this.pulses[eventId]) {
            this.map.removeLayer(this.pulses[eventId]);
            delete this.pulses[eventId];
        }

        if (this.pulseIntervals[eventId]) {
            clearInterval(this.pulseIntervals[eventId]);
            delete this.pulseIntervals[eventId];
        }
    }

    /**
     * Clears all simulated events from the map
     */
    clearAll() {
        Object.keys(this.markers).forEach(eid => this.removeEvent(eid));
    }
}
