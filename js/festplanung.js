// Festplanung für das Schützenfest in Rolfzen. Wird von Karte und Rundgang gelesen.
// Ausrichtung: Längsachse in Grad im Uhrzeigersinn von Norden.
const ROLFZEN_FEST = {
    zelt: {
        name: 'Schützenzelt',
        // 12 m nördlich des Schützenplatz-Punkts, damit es den Weg An der Lehmkuhle nicht überdeckt
        lat: 51.8457968,
        lon: 9.1419568,
        laenge: 30,
        breite: 15,
        // parallel zum Offizierhaus
        ausrichtung: 158.4,
    },
    umzug: {
        treffpunkt: 'Gaststätte Zum Körter',
        koenigStandard: 'Rosenstraße 5',
        fahnentraeger: 2,
        musiker: 12,
        schuetzen: 36,
        reihenBreite: 3,
    },
};

// Ecken eines ausgerichteten Rechtecks in lokalen Metern (x = Osten, z = Süden) um die Mitte
function festRechteck(laenge, breite, ausrichtung) {
    const w = ausrichtung * Math.PI / 180;
    const ux = Math.sin(w), uz = -Math.cos(w);   // Längsachse
    const vx = -uz, vz = ux;                      // Querachse
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) =>
        [a * laenge / 2 * ux + b * breite / 2 * vx, a * laenge / 2 * uz + b * breite / 2 * vz]);
}
