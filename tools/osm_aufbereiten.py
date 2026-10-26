"""Bereitet OpenStreetMap-Daten fuer den 3D-Rundgang durch Rolfzen auf.

Aufruf:
    python osm_aufbereiten.py <osm.json> <grenze.js> <ausgabe.js>

<osm.json> ist die Antwort einer Overpass-Abfrage (out geom) ueber das Rechteck um Rolfzen:

    [out:json][timeout:90];
    (way["building"](51.8400,9.1022,51.8751,9.1644);
     way["highway"](...); way["landuse"](...); way["natural"](...);
     way["waterway"](...); way["leisure"](...); way["amenity"="parking"](...);
     way["barrier"="hedge"](...); node["natural"="tree"](...);
     relation["landuse"](...); relation["natural"](...););
    out geom tags;

<grenze.js> ist js/rolfzen-grenze.js (Gemeindegrenze). Alles wird auf diese Grenze
zugeschnitten und in lokale Meter umgerechnet (x = Osten, z = -Norden).
"""

import json
import math
import sys

# Ursprung: Parkplatz an der Kirche (OSM-Knoten 3740214594)
URSPRUNG_LAT = 51.8485358
URSPRUNG_LON = 9.1452456
M_PRO_GRAD_LAT = 111_320.0
M_PRO_GRAD_LON = 111_320.0 * math.cos(math.radians(URSPRUNG_LAT))

STRASSEN_BREITE = {
    'primary': 7.5, 'primary_link': 6, 'secondary': 7, 'secondary_link': 6,
    'tertiary': 6.5, 'tertiary_link': 5.5, 'unclassified': 5, 'residential': 5.5,
    'living_street': 4.5, 'service': 3.5, 'track': 3, 'path': 1.5,
    'footway': 2, 'steps': 2, 'emergency_bay': 3,
}
GEWAESSER_BREITE = {'river': 6, 'stream': 2, 'ditch': 1.2, 'drain': 1.2}

FLAECHEN = {
    ('landuse', 'farmland'): 'acker', ('landuse', 'meadow'): 'wiese',
    ('landuse', 'grass'): 'rasen', ('natural', 'grassland'): 'wiese',
    ('landuse', 'forest'): 'wald', ('natural', 'wood'): 'wald',
    ('natural', 'scrub'): 'gebuesch', ('natural', 'water'): 'wasser',
    ('landuse', 'residential'): 'wohngebiet', ('landuse', 'farmyard'): 'hof',
    ('landuse', 'commercial'): 'gewerbe', ('landuse', 'cemetery'): 'friedhof',
    ('landuse', 'construction'): 'baustelle', ('leisure', 'pitch'): 'sportplatz',
    ('leisure', 'playground'): 'spielplatz', ('leisure', 'swimming_pool'): 'wasser',
    ('amenity', 'parking'): 'parkplatz',
}

ORTE = [
    ('Kath. Kirche St. Marien', 51.84788, 9.1450246),
    ('Gaststätte Zum Körter', 51.8475511, 9.1454061),
    ('Freiwillige Feuerwehr, LG Rolfzen', 51.8459925, 9.1429903),
    # Nicht in OSM; Lage nach Angabe aus dem Dorf (westlich der Kreuzung Rosenstraße/Stoppelbergstraße)
    ('Schützenplatz', 51.84569, 9.141994),
    # Kleines Gebäude östlich des Schützenplatzes (Mitte des OSM-Grundrisses)
    ('Offizierhaus', 51.8457537, 9.1423532),
    ('Sportplatz Grün-Weiß 94', 51.8420031, 9.1401349),
]


def natuerlich(text):
    """Sortierschlüssel, damit 5 < 5a < 10."""
    zahl = ''.join(z for z in text if z.isdigit())
    return (int(zahl) if zahl else 0, text)


def projizieren(lat, lon):
    x = (lon - URSPRUNG_LON) * M_PRO_GRAD_LON
    z = -(lat - URSPRUNG_LAT) * M_PRO_GRAD_LAT
    return [round(x, 1), round(z, 1)]


def punkt_in_polygon(p, poly):
    x, z = p
    innen = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            innen = not innen
        j = i
    return innen


def flaeche_vorzeichen(ring):
    return sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1]
               for i in range(len(ring))) / 2


def ring_bereinigen(punkte):
    """Doppelten Endpunkt und doppelte Nachbarn entfernen, Umlaufsinn vereinheitlichen."""
    ring = []
    for p in punkte:
        if not ring or ring[-1] != p:
            ring.append(p)
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring.pop()
    if len(ring) < 3:
        return None
    if flaeche_vorzeichen(ring) < 0:
        ring.reverse()
    return ring


def schwerpunkt(ring):
    return [sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)]


def ringe_verbinden(wege):
    """Fuegt offene Wegstuecke (Multipolygon-Mitglieder) zu geschlossenen Ringen zusammen."""
    offen = [list(w) for w in wege if len(w) > 1]
    ringe = []
    while offen:
        ring = offen.pop(0)
        verlaengert = True
        while ring[0] != ring[-1] and verlaengert:
            verlaengert = False
            for i, w in enumerate(offen):
                if w[0] == ring[-1]:
                    ring += w[1:]
                elif w[-1] == ring[-1]:
                    ring += w[-2::-1]
                elif w[-1] == ring[0]:
                    ring = w[:-1] + ring
                elif w[0] == ring[0]:
                    ring = w[:0:-1] + ring
                else:
                    continue
                offen.pop(i)
                verlaengert = True
                break
        if ring[0] == ring[-1]:
            ringe.append(ring)
    return ringe


def linie_zuschneiden(linie, grenze):
    """Teilt eine Linie in Stuecke, deren Punkte innerhalb der Grenze liegen."""
    stuecke, aktuell = [], []
    for p in linie:
        if punkt_in_polygon(p, grenze):
            aktuell.append(p)
        else:
            if len(aktuell) > 1:
                stuecke.append(aktuell)
            aktuell = []
    if len(aktuell) > 1:
        stuecke.append(aktuell)
    return stuecke


def gebaeude_hoehe(tags):
    if 'height' in tags:
        try:
            return float(tags['height'].replace('m', '').strip())
        except ValueError:
            pass
    if 'building:levels' in tags:
        try:
            return float(tags['building:levels']) * 3 + 0.5
        except ValueError:
            pass
    return {'garage': 2.6, 'shed': 2.6, 'roof': 3, 'carport': 2.6, 'cabin': 2.8,
            'barn': 6, 'chapel': 7, 'church': 12}.get(tags.get('building'), 5.8)


def main(osm_pfad, grenze_pfad, ausgabe_pfad):
    with open(osm_pfad, encoding='utf8') as f:
        osm = json.load(f)
    with open(grenze_pfad, encoding='utf8') as f:
        text = f.read()
    grenze_geo = json.loads(text[text.index('{'):text.rindex('}') + 1])
    grenze = ring_bereinigen([projizieren(lat, lon)
                              for lon, lat in grenze_geo['features'][0]['geometry']['coordinates'][0]])

    gebaeude, strassen, flaechen, gewaesser, baeume, hecken = [], [], [], [], [], []
    adressen = {}

    for e in osm['elements']:
        tags = e.get('tags', {})
        if e['type'] == 'node':
            p = projizieren(e['lat'], e['lon'])
            if tags.get('natural') == 'tree' and punkt_in_polygon(p, grenze):
                baeume.append(p)
            continue

        if e['type'] == 'way':
            linie = [projizieren(g['lat'], g['lon']) for g in e['geometry']]
            ringe = [linie] if len(linie) > 3 and linie[0] == linie[-1] else []
        else:
            linie = None
            ringe = ringe_verbinden([[projizieren(g['lat'], g['lon']) for g in m['geometry']]
                                     for m in e.get('members', [])
                                     if m.get('role') == 'outer' and 'geometry' in m])

        if 'building' in tags:
            if tags['building'] == 'construction':
                continue
            for r in ringe:
                ring = ring_bereinigen(r)
                if ring and punkt_in_polygon(schwerpunkt(ring), grenze):
                    # Adresse; bei mehreren Gebäuden gleicher Adresse (Haus und Garage) zählt das größte
                    strasse = tags.get('addr:street') or tags.get('addr:place')
                    nummer = tags.get('addr:housenumber')
                    if strasse and nummer:
                        groesse = abs(flaeche_vorzeichen(ring))
                        alt = adressen.get((strasse, nummer))
                        if not alt or groesse > alt[0]:
                            m = schwerpunkt(ring)
                            adressen[(strasse, nummer)] = (groesse, [round(m[0], 1), round(m[1], 1)])
                    eintrag = {'p': ring, 'h': round(gebaeude_hoehe(tags), 1), 't': tags['building']}
                    if 'roof:shape' in tags:
                        eintrag['d'] = tags['roof:shape']
                    if 'name' in tags:
                        eintrag['n'] = tags['name']
                    gebaeude.append(eintrag)
            continue

        if 'highway' in tags and linie and tags['highway'] in STRASSEN_BREITE:
            if tags.get('area') == 'yes':
                continue
            for stueck in linie_zuschneiden(linie, grenze):
                eintrag = {'p': stueck, 'w': STRASSEN_BREITE[tags['highway']], 't': tags['highway']}
                if 'name' in tags:
                    eintrag['n'] = tags['name']
                strassen.append(eintrag)
            continue

        if 'waterway' in tags and linie and tags['waterway'] in GEWAESSER_BREITE:
            for stueck in linie_zuschneiden(linie, grenze):
                gewaesser.append({'p': stueck, 'w': GEWAESSER_BREITE[tags['waterway']]})
            continue

        if linie and tags.get('natural') == 'tree_row':
            for stueck in linie_zuschneiden(linie, grenze):
                for p in stueck:
                    baeume.append(p)
            continue

        if linie and tags.get('barrier') == 'hedge':
            for stueck in linie_zuschneiden(linie, grenze):
                hecken.append(stueck)
            continue

        art = next((a for (k, v), a in FLAECHEN.items() if tags.get(k) == v), None)
        if art:
            for r in ringe:
                ring = ring_bereinigen(r)
                if ring and punkt_in_polygon(schwerpunkt(ring), grenze):
                    flaechen.append({'p': ring, 't': art})

    start = projizieren(URSPRUNG_LAT, URSPRUNG_LON)
    if any(punkt_in_polygon(start, g['p']) for g in gebaeude):
        sys.exit('Startpunkt liegt in einem Gebaeude')

    daten = {
        'ursprung': {'lat': URSPRUNG_LAT, 'lon': URSPRUNG_LON,
                     'mProGradLat': M_PRO_GRAD_LAT, 'mProGradLon': round(M_PRO_GRAD_LON, 3)},
        'grenze': grenze,
        'gebaeude': gebaeude,
        'strassen': strassen,
        'flaechen': flaechen,
        'gewaesser': gewaesser,
        'baeume': baeume,
        'hecken': hecken,
        'orte': [{'n': n, 'p': projizieren(lat, lon)} for n, lat, lon in ORTE],
        'adressen': [{'s': s, 'h': h, 'p': adressen[(s, h)][1]}
                     for s, h in sorted(adressen, key=lambda a: (a[0], natuerlich(a[1])))],
        'start': start,
    }
    with open(ausgabe_pfad, 'w', encoding='utf8') as f:
        f.write('// 3D-Daten fuer Rolfzen, erzeugt mit tools/osm_aufbereiten.py\n')
        f.write('// Daten (c) OpenStreetMap-Mitwirkende, ODbL 1.0\n')
        f.write('const ROLFZEN_3D = ')
        json.dump(daten, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')

    print(f'{len(gebaeude)} Gebaeude, {len(strassen)} Strassenstuecke, {len(flaechen)} Flaechen, '
          f'{len(gewaesser)} Gewaesser, {len(baeume)} Baeume, {len(hecken)} Hecken')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
