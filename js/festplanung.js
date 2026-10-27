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
        eingang: 'ost',     // östliche Längsseite, zum Asphaltplatz, mit kleiner Rampe
        eingangLaengs: 7.4, // Mitte des Eingangs, zwischen Pizza und Pommes
        eingangBreite: 3,
        eckOeffnung: 1.5,   // Westseite an beiden Ecken (Band- und Thekenseite) so weit offen, in m
    },
    // Einrichtung im Zelt: Rechtecke als [laengs von, laengs bis, quer von, quer bis], Höhe in m
    innen: {
        buehne: { name: 'Bühne', von: [-14, -10, -5.5, 5.5], hoehe: 0.8 },              // Norden, für die Band
        // Westen mittig, 4 × 6 m: Königspaar in der Mitte, je ein Hofstaatpaar links und rechts
        koenigsbuehne: { name: 'Königspaar', von: [-3, 3, -6.5, -2.5], hoehe: 0.6 },
        // Getränkekühlschränke links und rechts neben der Königsbühne (laengs, quer)
        kuehlschraenke: [[-3.6, -5.9], [3.6, -5.9]],
        theke: { name: 'Getränke', von: [11.6, 12.4, -4.5, 4.5], hoehe: 1.1 },          // Süden
        stehtische: [[8.8, -3.6], [8.8, -1.2], [8.8, 1.2], [8.8, 3.6]],
    },
    // Offizierhaus: Öffnung auf der Westseite (zum Platz) mit zwei Toiletten
    offizierhaus: { toiletten: ['Damen', 'Herren'] },
    // Asphaltierte Fläche vor dem Eingang (laengs, quer); endet im Norden vor der Wiese (Drohnenfoto)
    platz: [[-9.0, 6.6], [-9.0, 15.0], [-5.0, 23.4], [0.6, 27.6], [4.9, 23.7], [8.1, 15.5], [13.3, 7.8], [14.0, 6.7]],
    // Aufstellung nach dem Drohnenfoto; Größen ungefähr, genaue Maße folgen.
    // breite = Länge der Front, tiefe = von der Front nach hinten; die Front zeigt zum Punkt blickZu (laengs, quer).
    buden: [
        // Wok und Pizza auf der Rasenfläche südlich des Asphalts
        { name: 'Wok', laengs: 18.5, quer: 15.5, breite: 3, tiefe: 2.4, farbe: '#d4380d', blickZu: [2, 15.5] },
        { name: 'Pizza', laengs: 16.0, quer: 9.0, breite: 3.5, tiefe: 3, farbe: '#2e7d32', blickZu: [5, 15] },
        { name: 'Pommes & Bratwurst', laengs: 2.8, quer: 8.3, breite: 5.5, tiefe: 2.4, farbe: '#f9a825', blickZu: [2.8, 20] },
        { name: 'Bierbude (Veltins)', laengs: -4.5, quer: 11.5, breite: 6, tiefe: 2.5, farbe: '#1f7a3a', blickZu: [5, 11.5] },
        // Vor den Toiletten, parallel zur Westwand des Offizierhauses, gut 2 m Abstand zur Wand
        { name: 'Schießbude', laengs: 4.85, quer: 22.4, breite: 10, tiefe: 2.8, farbe: '#1565c0', blickZu: [3.05, 12.6] },
        // Vor dem Baum am Nordostrand (Stamm bei laengs -6, quer 24), Front zum Platz
        { name: 'Süßigkeiten', laengs: -5.5, quer: 21.2, breite: 7, tiefe: 2.5, farbe: '#e91e8c', blickZu: [-5.5, 12] },
    ],
    // Zwei Banner „Schützenfest Rolfzen“ auf der Rasenfläche in der Südostecke,
    // südlich des Straßenendes An der Lehmkuhle; jeweils von [laengs, quer] bis [laengs, quer]
    banner: {
        text: 'Schützenfest Rolfzen',
        datum: '',          // Termin hier eintragen, z. B. '4. – 6. Juli 2027'
        liste: [[[19.5, 27.5], [21.3, 24.2]], [[19.8, 22.5], [18.6, 17.8]]],
    },
    // Nicht auf dem Foto; auf die Wiese nördlich des Platzes gesetzt
    karussell: { name: 'Kinderkarussell', laengs: -12, quer: 11, radius: 2.6 },
    // Hinter dem Zelt im Süden, hinter der Pizzahütte: drei Glascontainer und ein Altkleidercontainer
    container: [
        { name: 'Weißglas', laengs: 19.8, quer: 3.2, farbe: '#eeeeee', art: 'glas' },
        { name: 'Grünglas', laengs: 19.8, quer: 5.2, farbe: '#2e7d32', art: 'glas' },
        { name: 'Braunglas', laengs: 19.8, quer: 7.2, farbe: '#6d4c41', art: 'glas' },
        { name: 'Altkleider', laengs: 19.9, quer: 9.4, farbe: '#c62828', art: 'kleider' },
    ],
    // Bäume rund um den Schützenplatz aus dem Luftbild: [lat, lon, Kronenradius in m]
    baeume: [
        [51.8456208, 9.1418254, 8.4], [51.8460017, 9.1420289, 5.4], [51.8459532, 9.142074, 6.1],
        // dritter Baum: Stamm 2 m südlich vor das Offizierhaus gesetzt (die Krone überdeckt das Dach)
        [51.8458849, 9.1421424, 6.9], [51.8458193, 9.1421889, 4.3], [51.84568, 9.142363, 7.7],
        [51.8457501, 9.142503, 6.9], [51.845813, 9.1425903, 5.4], [51.8456396, 9.1424827, 6.9],
        [51.8455696, 9.1423052, 6.9], [51.8454995, 9.1421744, 6.9], [51.8454573, 9.1420188, 6.1],
        [51.8454285, 9.1418632, 6.1], [51.8454546, 9.1417294, 6.9], [51.8454806, 9.1415825, 6.9],
        [51.8454249, 9.1414618, 6.1], [51.8453414, 9.1413964, 6.9], [51.8452857, 9.1412757, 6.1],
        [51.8453432, 9.1415971, 6.9], [51.8461292, 9.1417367, 5.4], [51.8460286, 9.1411812, 3.8],
    ],
    // Erzeugte Bäume in diesem Umkreis (m) um die Zeltmitte werden durch die eingemessenen ersetzt
    baumUmkreis: 55,
    // Adressen, die in OpenStreetMap fehlen: [Straße, Hausnummer, lat, lon]
    // Entruper Weg 7: Gebäude direkt neben Nr. 1 (in OSM ohne Hausnummer), Lage laut Karte aus dem Dorf
    adressenErgaenzt: [['Entruper Weg', '7', 51.8459046, 9.1442902]],
    umzug: {
        treffpunkt: 'Gaststätte Zum Körter',
        koenigStandard: 'Entruper Weg 7',
        // Sperrt die Hauptstraße an beiden Enden des Abschnitts, den der Umzug benutzt
        feuerwehr: { fahrzeuge: 2, leuteJeFahrzeug: 3 },
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
