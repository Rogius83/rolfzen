// Festplanung für das Schützenfest in Rolfzen. Wird von Karte und Rundgang gelesen.
// Zelt, Asphaltfläche und Bäume nach einem Luftbild von 2026 eingemessen.
// Ausrichtung: Längsachse in Grad im Uhrzeigersinn von Norden.
// Positionen auf dem Festplatz in Metern relativ zur Zeltmitte:
//   laengs = entlang der Längsachse (positiv Richtung Süden), quer = positiv Richtung Osten.
const ROLFZEN_FEST = {
    zelt: {
        name: 'Schützenzelt',
        lat: 51.8456594,
        lon: 9.1419388,
        laenge: 28,
        breite: 13,
        ausrichtung: 147.9,
        eingang: 'ost',     // Mitte der östlichen Längsseite, zum Asphaltplatz
    },
    // Asphaltierte Fläche vor dem Eingang (laengs, quer)
    platz: [[-13.9, 6.6], [-10.6, 14.3], [-5.0, 23.4], [0.6, 27.6], [4.9, 23.7], [8.1, 15.5], [13.3, 7.8], [14.0, 6.7]],
    // Buden am Rand des Platzes; der Weg vom Weg An der Lehmkuhle zum Eingang bleibt frei
    buden: [
        { name: 'Bierbude', laengs: -11.3, quer: 9.4, breite: 3.5, farbe: '#c8102e' },
        { name: 'Wok', laengs: -4.5, quer: 19.2, breite: 3.5, farbe: '#d4380d' },
        { name: 'Pizza', laengs: -0.7, quer: 23.2, breite: 3.5, farbe: '#2e7d32' },
        { name: 'Pommes & Bratwurst', laengs: 3.4, quer: 21.6, breite: 3.5, farbe: '#f9a825' },
        { name: 'Schießbude', laengs: 8.6, quer: 9.8, breite: 5, farbe: '#1565c0' },
    ],
    karussell: { name: 'Kinderkarussell', laengs: -6.3, quer: 12.2, radius: 2.6 },
    // Bäume rund um den Schützenplatz aus dem Luftbild: [lat, lon, Kronenradius in m]
    baeume: [
        [51.8456208, 9.1418254, 8.4], [51.8460017, 9.1420289, 5.4], [51.8459532, 9.142074, 6.1],
        [51.8458849, 9.1421424, 6.9], [51.8458193, 9.1421889, 4.3], [51.8456944, 9.1423474, 7.7],
        [51.8457501, 9.142503, 6.9], [51.845813, 9.1425903, 5.4], [51.8456396, 9.1424827, 6.9],
        [51.8455696, 9.1423052, 6.9], [51.8454995, 9.1421744, 6.9], [51.8454573, 9.1420188, 6.1],
        [51.8454285, 9.1418632, 6.1], [51.8454546, 9.1417294, 6.9], [51.8454806, 9.1415825, 6.9],
        [51.8454249, 9.1414618, 6.1], [51.8453414, 9.1413964, 6.9], [51.8452857, 9.1412757, 6.1],
        [51.8453432, 9.1415971, 6.9], [51.8461292, 9.1417367, 5.4], [51.8460286, 9.1411812, 3.8],
    ],
    // Erzeugte Bäume in diesem Umkreis (m) um die Zeltmitte werden durch die eingemessenen ersetzt
    baumUmkreis: 55,
    umzug: {
        treffpunkt: 'Gaststätte Zum Körter',
        koenigStandard: 'Rosenstraße 5',
        fahnentraeger: 2,
        musiker: 12,
        schuetzen: 36,
        reihenBreite: 3,
    },
};

// Achsen des Zelts in lokalen Metern (x = Osten, z = Süden): u längs, o quer nach Osten
function festAchsen(ausrichtung) {
    const w = ausrichtung * Math.PI / 180;
    const ux = Math.sin(w), uz = -Math.cos(w);
    return { ux, uz, ox: uz, oz: -ux };
}

// Punkt (laengs, quer) relativ zur Zeltmitte in lokale Meter-Abstände
function festVersatz(laengs, quer) {
    const a = festAchsen(ROLFZEN_FEST.zelt.ausrichtung);
    return [laengs * a.ux + quer * a.ox, laengs * a.uz + quer * a.oz];
}

// Ecken eines ausgerichteten Rechtecks in lokalen Metern um die Mitte
function festRechteck(laenge, breite, ausrichtung) {
    const a = festAchsen(ausrichtung);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) =>
        [s * laenge / 2 * a.ux + t * breite / 2 * a.ox, s * laenge / 2 * a.uz + t * breite / 2 * a.oz]);
}
