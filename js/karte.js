// Kartenansicht des Dorfes Rolfzen (32839 Steinheim) auf Basis von OpenStreetMap

const karte = L.map('karte');

// Grundkarten
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
}).addTo(karte);

const luftbild = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Luftbild &copy; Esri, Maxar, Earthstar Geographics'
});

const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: '&copy; OpenStreetMap-Mitwirkende, SRTM | Darstellung: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
});

// Ortsgrenze
const grenze = L.geoJSON(ROLFZEN_GRENZE, {
    style: { color: '#1f5130', weight: 3, fillOpacity: 0.05, dashArray: '6 4' }
}).addTo(karte);

// Hat der Kartenbereich beim Start noch keine Größe (z. B. verstecktes Fenster),
// kann fitBounds keine Zoomstufe berechnen – dann festen Ausschnitt verwenden
if (karte.getSize().y > 0) {
    karte.fitBounds(grenze.getBounds());
} else {
    karte.setView(grenze.getBounds().getCenter(), 14);
}

// Wichtige Orte im Dorf (Positionen aus OpenStreetMap)
const orte = [
    { name: 'Kath. Kirche St. Marien', lat: 51.84788, lon: 9.1450246 },
    { name: 'Gaststätte Zum Körter', lat: 51.8475511, lon: 9.1454061 },
    { name: 'Freiwillige Feuerwehr, LG Rolfzen', lat: 51.8459925, lon: 9.1429903 },
    { name: 'Schützenplatz', lat: 51.84569, lon: 9.141994 },
    { name: 'Offizierhaus', lat: 51.8457537, lon: 9.1423532 },
    { name: 'Sportplatz SpVg. Grün-Weiß 94 Rolfzen/Sommersell', lat: 51.8420031, lon: 9.1401349 }
];

const orteEbene = L.layerGroup(
    orte.map(o => L.marker([o.lat, o.lon], { title: o.name }).bindPopup(o.name))
).addTo(karte);

// Schützenfest-Planung (Daten aus js/festplanung.js)
const festplanung = L.layerGroup().addTo(karte);
{
    const z = ROLFZEN_FEST.zelt;
    const mProGradLat = 111320, mProGradLon = 111320 * Math.cos(z.lat * Math.PI / 180);
    const ecken = festRechteck(z.laenge, z.breite, z.ausrichtung)
        .map(([x, zs]) => [z.lat - zs / mProGradLat, z.lon + x / mProGradLon]);
    L.polygon(ecken, { color: '#b8860b', weight: 2, fillColor: '#fffbe8', fillOpacity: 0.8 })
        .bindPopup(`<b>${z.name}</b><br>${z.laenge} × ${z.breite} m`)
        .addTo(festplanung);
}

L.control.layers(
    { 'Straßenkarte': osm, 'Luftbild': luftbild, 'Topografisch': topo },
    { 'Ortsgrenze': grenze, 'Orte im Dorf': orteEbene, 'Festplanung': festplanung },
    { collapsed: false }
).addTo(karte);

L.control.scale({ imperial: false }).addTo(karte);

// Klick ins Dorf: von dort aus im 3D-Rundgang loslaufen
function startPopup(e) {
    const url = `rundgang.html?lat=${e.latlng.lat.toFixed(6)}&lon=${e.latlng.lng.toFixed(6)}`;
    L.popup()
        .setLatLng(e.latlng)
        .setContent(`<b>Rolfzen</b><br>32839 Steinheim<br><a href="${url}">Hier loslaufen</a>`)
        .openOn(karte);
}
grenze.on('click', startPopup);

// Koordinatenanzeige unter dem Mauszeiger
const koordinatenAnzeige = L.control({ position: 'bottomright' });
koordinatenAnzeige.onAdd = function () {
    this._div = L.DomUtil.create('div', 'koordinaten');
    return this._div;
};
koordinatenAnzeige.addTo(karte);

karte.on('mousemove', e => {
    koordinatenAnzeige._div.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
});
