"""Erzeugt das Hoehenraster fuer den 3D-Rundgang aus dem DGM1 von Geobasis NRW.

Aufruf:
    python hoehen_aufbereiten.py <rolfzen-3d-daten.js> <kachel-ordner> <ausgabe.js>

Die benoetigten DGM1-Kacheln (1 x 1 km, GeoTIFF, ETRS89/UTM32) werden in <kachel-ordner>
heruntergeladen, falls sie dort noch fehlen. Quelle: https://www.opengeodata.nrw.de/produkte/geobasis/hm/dgm1_tiff/
Lizenz: Datenlizenz Deutschland - Zero - Version 2.0 (Geobasis NRW).

Das Raster liegt in denselben lokalen Metern wie rolfzen-3d-daten.js (x = Osten, z = Sueden)
und wird als Int16 in Dezimetern, Base64-kodiert, ausgegeben.
"""

import base64
import json
import math
import os
import struct
import sys
import urllib.request

SCHRITT = 10          # Rasterweite in Metern
RAND = 400            # Gelaende ausserhalb der Ortsgrenze in Metern
KACHEL_URL = 'https://www.opengeodata.nrw.de/produkte/geobasis/hm/dgm1_tiff/dgm1_tiff/'
KACHEL_INDEX = KACHEL_URL + 'index.json'
KEIN_WERT = -9999


# ---------- Koordinaten ----------

def utm32(lat, lon):
    """Geographische Koordinaten (ETRS89) nach UTM Zone 32N."""
    a, f, k0 = 6378137.0, 1 / 298.257222101, 0.9996
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    phi, dl = math.radians(lat), math.radians(lon - 9)
    n = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    t = math.tan(phi) ** 2
    c = ep2 * math.cos(phi) ** 2
    aa = math.cos(phi) * dl
    e4, e6 = e2 * e2, e2 * e2 * e2
    m = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
             - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi)
             + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi)
             - (35 * e6 / 3072) * math.sin(6 * phi))
    ost = 500000 + k0 * n * (aa + (1 - t + c) * aa ** 3 / 6
                             + (5 - 18 * t + t * t + 72 * c - 58 * ep2) * aa ** 5 / 120)
    nord = k0 * (m + n * math.tan(phi) * (aa ** 2 / 2 + (5 - t + 9 * c + 4 * c * c) * aa ** 4 / 24
                                          + (61 - 58 * t + t * t + 600 * c - 330 * ep2) * aa ** 6 / 720))
    return ost, nord


# ---------- TIFF lesen (LZW, Float32, Streifen) ----------

def lzw_entpacken(daten):
    ergebnis = bytearray()
    tabelle = [bytes([i]) for i in range(256)] + [b'', b'']
    breite, puffer, bits, alt = 9, 0, 0, None
    for byte in daten:
        puffer = (puffer << 8) | byte
        bits += 8
        while bits >= breite:
            bits -= breite
            code = (puffer >> bits) & ((1 << breite) - 1)
            if code == 256:
                tabelle = tabelle[:258]
                breite, alt = 9, None
                continue
            if code == 257:
                return bytes(ergebnis)
            if alt is None:
                eintrag = tabelle[code]
            else:
                eintrag = tabelle[code] if code < len(tabelle) else alt + alt[:1]
                tabelle.append(alt + eintrag[:1])
            ergebnis += eintrag
            alt = eintrag
            # TIFF-LZW erhoeht die Codebreite einen Code frueher ("early change")
            if len(tabelle) + 1 >= (1 << breite) and breite < 12:
                breite += 1
    return bytes(ergebnis)


class Kachel:
    def __init__(self, pfad):
        self.b = open(pfad, 'rb').read()
        if self.b[:2] != b'II':
            raise ValueError('Nur Little-Endian-TIFF wird unterstuetzt')
        tags = {}
        off = struct.unpack('<I', self.b[4:8])[0]
        for i in range(struct.unpack('<H', self.b[off:off + 2])[0]):
            tag, typ, anzahl = struct.unpack('<HHI', self.b[off + 2 + 12 * i:off + 10 + 12 * i])
            groesse = {3: 2, 4: 4, 12: 8}.get(typ, 1) * anzahl
            roh = self.b[off + 10 + 12 * i:off + 14 + 12 * i]
            if groesse > 4:
                p = struct.unpack('<I', roh)[0]
                roh = self.b[p:p + groesse]
            fmt = {3: 'H', 4: 'I', 12: 'd'}.get(typ)
            tags[tag] = struct.unpack('<' + fmt * anzahl, roh[:groesse]) if fmt else roh
        if tags[259][0] != 5 or tags[258][0] != 32 or tags.get(317, (1,))[0] != 1:
            raise ValueError('Erwartet LZW, Float32, ohne Praediktor')
        self.breite, self.hoehe = tags[256][0], tags[257][0]
        self.zeilen_pro_streifen = tags[278][0]
        self.versaetze, self.laengen = tags[273], tags[279]
        self.ost0, self.nord0 = tags[33922][3], tags[33922][4]
        self.zelle = tags[33550][0]
        self.streifen = {}

    def wert(self, ost, nord):
        spalte = int((ost - self.ost0) / self.zelle)
        zeile = int((self.nord0 - nord) / self.zelle)
        if not (0 <= spalte < self.breite and 0 <= zeile < self.hoehe):
            return None
        nr = zeile // self.zeilen_pro_streifen
        if nr not in self.streifen:
            p, l = self.versaetze[nr], self.laengen[nr]
            self.streifen[nr] = lzw_entpacken(self.b[p:p + l])
        i = ((zeile % self.zeilen_pro_streifen) * self.breite + spalte) * 4
        return struct.unpack('<f', self.streifen[nr][i:i + 4])[0]


# ---------- Hauptprogramm ----------

def main(daten_pfad, ordner, ausgabe_pfad):
    text = open(daten_pfad, encoding='utf8').read()
    daten = json.loads(text[text.index('{'):text.rindex('}') + 1])
    u = daten['ursprung']
    xs = [p[0] for p in daten['grenze']]
    zs = [p[1] for p in daten['grenze']]
    x0 = math.floor((min(xs) - RAND) / SCHRITT) * SCHRITT
    z0 = math.floor((min(zs) - RAND) / SCHRITT) * SCHRITT
    spalten = int((max(xs) + RAND - x0) / SCHRITT) + 1
    zeilen = int((max(zs) + RAND - z0) / SCHRITT) + 1

    def zu_utm(x, z):
        return utm32(u['lat'] - z / u['mProGradLat'], u['lon'] + x / u['mProGradLon'])

    # Benoetigte Kacheln bestimmen und laden
    utm_punkte = [[zu_utm(x0 + s * SCHRITT, z0 + r * SCHRITT) for s in range(spalten)] for r in range(zeilen)]
    benoetigt = {(int(e // 1000), int(n // 1000)) for zeile in utm_punkte for e, n in zeile}
    os.makedirs(ordner, exist_ok=True)
    with urllib.request.urlopen(KACHEL_INDEX) as antwort:
        index = json.load(antwort)
    namen = {}
    for f in index['datasets'][0]['files']:
        teile = f['name'].split('_')
        namen[(int(teile[2]), int(teile[3]))] = f['name']

    kacheln = {}
    for schluessel in sorted(benoetigt):
        name = namen.get(schluessel)
        if not name:
            continue  # ausserhalb von NRW
        pfad = os.path.join(ordner, name)
        if not os.path.exists(pfad):
            print('Lade', name)
            urllib.request.urlretrieve(KACHEL_URL + name, pfad)
        kacheln[schluessel] = Kachel(pfad)

    werte = []
    for zeile in utm_punkte:
        for e, n in zeile:
            k = kacheln.get((int(e // 1000), int(n // 1000)))
            h = k.wert(e, n) if k else None
            werte.append(h if h is not None and h > KEIN_WERT + 1 else None)

    # Luecken (ausserhalb NRW) mit dem Mittel der gueltigen Nachbarn auffuellen
    gueltig = [h for h in werte if h is not None]
    luecken = sum(h is None for h in werte)
    for _ in range(200):
        if None not in werte:
            break
        neu = werte[:]
        for i, h in enumerate(werte):
            if h is not None:
                continue
            r, s = divmod(i, spalten)
            nachbarn = [werte[j] for j in (i - 1 if s > 0 else -1, i + 1 if s < spalten - 1 else -1,
                                           i - spalten, i + spalten)
                        if 0 <= j < len(werte) and werte[j] is not None]
            if nachbarn:
                neu[i] = sum(nachbarn) / len(nachbarn)
        werte = neu
    werte = [h if h is not None else sum(gueltig) / len(gueltig) for h in werte]

    roh = struct.pack('<%dh' % len(werte), *[round(h * 10) for h in werte])
    ergebnis = {
        'x0': x0, 'z0': z0, 'schritt': SCHRITT, 'spalten': spalten, 'zeilen': zeilen,
        'hoehen': base64.b64encode(roh).decode('ascii'),
    }
    with open(ausgabe_pfad, 'w', encoding='utf8') as f:
        f.write('// Hoehenraster fuer Rolfzen in Dezimetern (Int16, Base64), erzeugt mit tools/hoehen_aufbereiten.py\n')
        f.write('// Quelle: DGM1 (c) Geobasis NRW, Datenlizenz Deutschland - Zero - Version 2.0\n')
        f.write('const ROLFZEN_HOEHEN = ')
        json.dump(ergebnis, f, separators=(',', ':'))
        f.write(';\n')

    print(f'{spalten} x {zeilen} Punkte, {len(kacheln)} Kacheln, {luecken} Luecken aufgefuellt, '
          f'Hoehe {min(werte):.1f} - {max(werte):.1f} m')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
