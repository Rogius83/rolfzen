// 3D-Rundgang durch Rolfzen in Third-Person-Ansicht auf Basis von OpenStreetMap-Daten.
// Koordinaten in Metern: x = Osten, z = Süden, y = Höhe (flaches Gelände).

(function () {
    'use strict';

    const D = ROLFZEN_3D;

    // Handy-Modus: weniger Grafiklast und Touch-Steuerung (mit ?handy am PC erzwingbar)
    const HANDY = new URLSearchParams(location.search).has('handy') ||
        window.matchMedia('(pointer: coarse)').matches;
    document.body.classList.toggle('handy', HANDY);

    // ---------- Hilfsfunktionen ----------

    function zufallsgenerator(seed) {
        return function () {
            seed = seed + 0x6D2B79F5 | 0;
            let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    const zufall = zufallsgenerator(32839);

    function auswahl(liste) {
        return liste[Math.floor(zufall() * liste.length)];
    }

    function punktInPolygon(x, z, poly) {
        let innen = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const [xi, zi] = poly[i];
            const [xj, zj] = poly[j];
            if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) {
                innen = !innen;
            }
        }
        return innen;
    }

    function polygonFlaeche(ring) {
        let summe = 0;
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            summe += a[0] * b[1] - b[0] * a[1];
        }
        return Math.abs(summe) / 2;
    }

    function naechsterPunktAufStrecke(px, pz, ax, az, bx, bz) {
        const dx = bx - ax, dz = bz - az;
        const l2 = dx * dx + dz * dz;
        let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const qx = ax + t * dx, qz = az + t * dz;
        return { qx, qz, d: Math.hypot(px - qx, pz - qz) };
    }

    function begrenzung(ring) {
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const [x, z] of ring) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
        return { minX, minZ, maxX, maxZ };
    }

    // Räumliches Raster für schnelle Abfragen (Kollision, Straßennamen)
    class Raster {
        constructor(zelle) {
            this.zelle = zelle;
            this.zellen = new Map();
        }
        schluessel(ix, iz) {
            return ix * 100000 + iz;
        }
        einfuegen(eintrag, minX, minZ, maxX, maxZ) {
            const z = this.zelle;
            for (let ix = Math.floor(minX / z); ix <= Math.floor(maxX / z); ix++) {
                for (let iz = Math.floor(minZ / z); iz <= Math.floor(maxZ / z); iz++) {
                    const k = this.schluessel(ix, iz);
                    if (!this.zellen.has(k)) this.zellen.set(k, []);
                    this.zellen.get(k).push(eintrag);
                }
            }
        }
        abfragen(x, z) {
            return this.zellen.get(this.schluessel(Math.floor(x / this.zelle), Math.floor(z / this.zelle))) || [];
        }
    }

    // ---------- Höhenraster (DGM1, Geobasis NRW) ----------

    const H = ROLFZEN_HOEHEN;
    const hoehenWerte = (() => {
        const bin = atob(H.hoehen);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Int16Array(bytes.buffer);
    })();
    // Tiefster Punkt wird zu y = 0, damit die Szene nicht bei 130 m schwebt
    const BASIS = Math.floor(hoehenWerte.reduce((m, w) => Math.min(m, w), Infinity) / 10);

    function rasterHoehe(s, r) {
        s = Math.max(0, Math.min(H.spalten - 1, s));
        r = Math.max(0, Math.min(H.zeilen - 1, r));
        return hoehenWerte[r * H.spalten + s] / 10 - BASIS;
    }

    // Höhe an beliebiger Stelle, Dreieck für Dreieck genau wie das gezeichnete Gelände
    // (Diagonale jeder Zelle von links oben nach rechts unten)
    function hoehe(x, z) {
        const fx = Math.max(0, Math.min(H.spalten - 1.0001, (x - H.x0) / H.schritt));
        const fz = Math.max(0, Math.min(H.zeilen - 1.0001, (z - H.z0) / H.schritt));
        const s = Math.floor(fx), r = Math.floor(fz);
        const tx = fx - s, tz = fz - r;
        const h00 = rasterHoehe(s, r), h11 = rasterHoehe(s + 1, r + 1);
        if (tx >= tz) {
            const h10 = rasterHoehe(s + 1, r);
            return h00 + (h10 - h00) * tx + (h11 - h10) * tz;
        }
        const h01 = rasterHoehe(s, r + 1);
        return h00 + (h11 - h01) * tx + (h01 - h00) * tz;
    }

    // Sammelt Dreiecke mit Vertexfarben und erzeugt daraus ein einzelnes Mesh
    class GeometrieBauer {
        constructor() {
            this.pos = [];
            this.farbe = [];
        }
        dreieck(a, b, c, f) {
            this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
            for (let i = 0; i < 3; i++) this.farbe.push(f.r, f.g, f.b);
        }
        viereck(a, b, c, d, f) {
            this.dreieck(a, b, c, f);
            this.dreieck(a, c, d, f);
        }
        flaeche(ring, y, f) {
            const kontur = ring.map(p => new THREE.Vector2(p[0], p[1]));
            for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(kontur, [])) {
                this.dreieck([ring[i][0], y, ring[i][1]], [ring[j][0], y, ring[j][1]], [ring[k][0], y, ring[k][1]], f);
            }
        }
        // Punkt auf dem Gelände, um "anheben" Meter darüber
        static aufGelaende(x, z, anheben) {
            return [x, hoehe(x, z) + anheben, z];
        }
        scheibe(x, z, r, anheben, f) {
            const n = 10, p = GeometrieBauer.aufGelaende;
            for (let i = 0; i < n; i++) {
                const a1 = i / n * Math.PI * 2, a2 = (i + 1) / n * Math.PI * 2;
                this.dreieck(p(x, z, anheben), p(x + Math.cos(a1) * r, z + Math.sin(a1) * r, anheben),
                    p(x + Math.cos(a2) * r, z + Math.sin(a2) * r, anheben), f);
            }
        }
        // Band entlang einer Linie, das dem Gelände folgt (Stücke von höchstens 3 m)
        band(punkte, breite, anheben, f) {
            const h = breite / 2, p = GeometrieBauer.aufGelaende;
            for (let i = 0; i < punkte.length - 1; i++) {
                const [ax, az] = punkte[i], [bx, bz] = punkte[i + 1];
                const l = Math.hypot(bx - ax, bz - az);
                if (l < 0.01) continue;
                const nx = -(bz - az) / l * h, nz = (bx - ax) / l * h;
                const teile = Math.ceil(l / 3);
                for (let k = 0; k < teile; k++) {
                    const px = ax + (bx - ax) * k / teile, pz = az + (bz - az) * k / teile;
                    const qx = ax + (bx - ax) * (k + 1) / teile, qz = az + (bz - az) * (k + 1) / teile;
                    this.viereck(p(px + nx, pz + nz, anheben), p(qx + nx, qz + nz, anheben),
                        p(qx - nx, qz - nz, anheben), p(px - nx, pz - nz, anheben), f);
                }
            }
            for (const [x, z] of punkte) this.scheibe(x, z, h, anheben, f);
        }
        mesh(material) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
            g.setAttribute('color', new THREE.Float32BufferAttribute(this.farbe, 3));
            g.computeVertexNormals();
            return new THREE.Mesh(g, material);
        }
    }

    const farbe = hex => new THREE.Color(hex);
    const vertexMaterial = () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

    // Bänder auf dem Gelände (Bäche, Straßen, Linien) schreiben keine Tiefe, werden nach dem Gelände
    // in fester Reihenfolge gezeichnet und leicht nach vorn versetzt. So überdecken sie sich ohne Flimmern.
    function bodenEbene(mesh, reihenfolge) {
        Object.assign(mesh.material, {
            depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
        });
        mesh.renderOrder = reihenfolge;
        mesh.receiveShadow = true;
        szene.add(mesh);
    }

    // ---------- Szene ----------

    const container = document.getElementById('welt');
    const renderer = new THREE.WebGLRenderer({ antialias: !HANDY });
    renderer.setPixelRatio(HANDY ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = HANDY ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const himmel = 0xa9d3f0;
    const szene = new THREE.Scene();
    szene.background = new THREE.Color(himmel);
    // Das Gelände reicht 400 m über die Ortsgrenze hinaus; sein Rand verschwindet im Nebel
    szene.fog = HANDY ? new THREE.Fog(himmel, 60, 320) : new THREE.Fog(himmel, 120, 480);

    const kamera = new THREE.PerspectiveCamera(65, 1, 0.3, HANDY ? 450 : 900);

    szene.add(new THREE.HemisphereLight(0xe8f2ff, 0x5d6b3f, 0.5));
    const sonne = new THREE.DirectionalLight(0xfff3dd, 0.6);
    sonne.castShadow = true;
    const schattenWeite = HANDY ? 50 : 90;
    sonne.shadow.mapSize.set(HANDY ? 1024 : 2048, HANDY ? 1024 : 2048);
    Object.assign(sonne.shadow.camera, {
        left: -schattenWeite, right: schattenWeite, top: schattenWeite, bottom: -schattenWeite, near: 1, far: 400,
    });
    sonne.shadow.bias = -0.0005;
    sonne.shadow.normalBias = HANDY ? 0.12 : 0.04;
    szene.add(sonne, sonne.target);
    const sonnenVersatz = new THREE.Vector3(70, 120, 50);

    const groesse = { b: 0, h: 0 };
    function groesseAnpassen() {
        const b = container.clientWidth, h = container.clientHeight;
        if (b === 0 || h === 0 || (b === groesse.b && h === groesse.h)) return;
        groesse.b = b;
        groesse.h = h;
        renderer.setSize(b, h);
        kamera.aspect = b / h;
        kamera.updateProjectionMatrix();
    }
    window.addEventListener('resize', groesseAnpassen);

    // ---------- Gelände und Flächen ----------

    const FLAECHEN_FARBEN = {
        acker: ['#c9b87c', '#b8b06a', '#a9b866', '#d2c48a'],
        wiese: ['#8db85e'], rasen: ['#7fb356'], wald: ['#4f7a3a'], gebuesch: ['#6d8f45'],
        wasser: ['#4f8fc0'], wohngebiet: ['#93b46f'], hof: ['#b0a58e'], gewerbe: ['#a9a49a'],
        friedhof: ['#7da35f'], baustelle: ['#b39b78'], sportplatz: ['#5fa64a'],
        spielplatz: ['#c2b280'], parkplatz: ['#8a8a86'],
    };
    // Zeichenreihenfolge der Flächen in der Geländetextur: spätere liegen oben
    const FLAECHEN_EBENE = {
        wohngebiet: 1, acker: 2, wiese: 2, rasen: 2, wald: 2, gebuesch: 2,
        hof: 3, gewerbe: 3, friedhof: 3, baustelle: 3,
        sportplatz: 4, spielplatz: 4, parkplatz: 4, wasser: 5,
    };
    const UMLAND_FARBE = '#8fa36b';

    // Flächen, Ortsgebiet und Straßenränder werden in eine Textur gemalt, die über dem Gelände liegt
    function gelaendeTextur() {
        const groesse = Math.min(HANDY ? 2048 : 4096, renderer.capabilities.maxTextureSize);
        const breite = (H.spalten - 1) * H.schritt, tiefe = (H.zeilen - 1) * H.schritt;
        const leinwand = document.createElement('canvas');
        leinwand.width = leinwand.height = groesse;
        const ctx = leinwand.getContext('2d');
        ctx.fillStyle = UMLAND_FARBE;
        ctx.fillRect(0, 0, groesse, groesse);
        ctx.scale(groesse / breite, groesse / tiefe);
        ctx.translate(-H.x0, -H.z0);

        function umriss(punkte, schliessen) {
            ctx.beginPath();
            punkte.forEach(([x, z], i) => i ? ctx.lineTo(x, z) : ctx.moveTo(x, z));
            if (schliessen) ctx.closePath();
        }
        umriss(D.grenze, true);
        ctx.fillStyle = '#86ad5f';
        ctx.fill();
        const sortiert = D.flaechen.slice().sort((a, b) => FLAECHEN_EBENE[a.t] - FLAECHEN_EBENE[b.t]);
        for (const f of sortiert) {
            umriss(f.p, true);
            ctx.fillStyle = auswahl(FLAECHEN_FARBEN[f.t]);
            ctx.fill();
        }
        // Dunklerer Rand (Bankett) unter jeder Straße
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(70, 60, 40, 0.35)';
        for (const s of D.strassen) {
            ctx.lineWidth = s.w + 1.4;
            umriss(s.p, false);
            ctx.stroke();
        }

        const textur = new THREE.CanvasTexture(leinwand);
        textur.anisotropy = HANDY ? 1 : renderer.capabilities.getMaxAnisotropy();
        return textur;
    }

    function gelaendeBauen() {
        // Ebene unter dem tiefsten Punkt, sichtbar nur jenseits des Höhenrasters
        const aussen = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000),
            new THREE.MeshLambertMaterial({ color: UMLAND_FARBE }));
        aussen.rotation.x = -Math.PI / 2;
        aussen.position.y = -1;
        szene.add(aussen);

        // Gelände in Blöcken von 32 × 32 Zellen, damit Teile außerhalb des Blickfelds entfallen
        const material = new THREE.MeshLambertMaterial({ map: gelaendeTextur() });
        const BLOCK = 32;
        const s = H.schritt;
        for (let r0 = 0; r0 < H.zeilen - 1; r0 += BLOCK) {
            for (let s0 = 0; s0 < H.spalten - 1; s0 += BLOCK) {
                const r1 = Math.min(r0 + BLOCK, H.zeilen - 1), s1 = Math.min(s0 + BLOCK, H.spalten - 1);
                const nS = s1 - s0 + 1, nR = r1 - r0 + 1;
                const pos = new Float32Array(nS * nR * 3), nor = new Float32Array(nS * nR * 3);
                const uv = new Float32Array(nS * nR * 2);
                const n = new THREE.Vector3();
                let k = 0;
                for (let r = r0; r <= r1; r++) {
                    for (let sp = s0; sp <= s1; sp++, k++) {
                        pos[k * 3] = H.x0 + sp * s;
                        pos[k * 3 + 1] = rasterHoehe(sp, r);
                        pos[k * 3 + 2] = H.z0 + r * s;
                        // Normale aus den Nachbarpunkten, damit es an Blockgrenzen keine Kanten gibt
                        n.set(rasterHoehe(sp - 1, r) - rasterHoehe(sp + 1, r), 2 * s,
                            rasterHoehe(sp, r - 1) - rasterHoehe(sp, r + 1)).normalize();
                        nor.set([n.x, n.y, n.z], k * 3);
                        uv[k * 2] = sp / (H.spalten - 1);
                        uv[k * 2 + 1] = 1 - r / (H.zeilen - 1);
                    }
                }
                // Diagonale a–c, passend zu hoehe(); Umlaufsinn so, dass die Oberseite sichtbar ist
                const index = [];
                for (let r = 0; r < nR - 1; r++) {
                    for (let sp = 0; sp < nS - 1; sp++) {
                        const a = r * nS + sp, b = a + 1, d = a + nS, c = d + 1;
                        index.push(a, c, b, a, d, c);
                    }
                }
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
                geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
                geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
                geo.setIndex(index);
                const block = new THREE.Mesh(geo, material);
                block.receiveShadow = true;
                block.renderOrder = -10;  // vor den Bändern auf dem Gelände zeichnen
                szene.add(block);
            }
        }

        // Halbtransparente Wand an der Ortsgrenze, in Stücken von höchstens 10 m dem Gelände folgend
        const wand = new GeometrieBauer();
        const gruen = farbe('#46c35a');
        for (let i = 0; i < D.grenze.length; i++) {
            const [ax, az] = D.grenze[i], [bx, bz] = D.grenze[(i + 1) % D.grenze.length];
            const teile = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 10));
            for (let t = 0; t < teile; t++) {
                const px = ax + (bx - ax) * t / teile, pz = az + (bz - az) * t / teile;
                const qx = ax + (bx - ax) * (t + 1) / teile, qz = az + (bz - az) * (t + 1) / teile;
                const hp = hoehe(px, pz), hq = hoehe(qx, qz);
                wand.viereck([px, hp - 1, pz], [qx, hq - 1, qz], [qx, hq + 4, qz], [px, hp + 4, pz], gruen);
            }
        }
        szene.add(wand.mesh(new THREE.MeshBasicMaterial({
            vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
        })));
    }

    // ---------- Straßen und Gewässer ----------

    const STRASSEN_FARBE = {
        primary: '#505256', primary_link: '#505256', secondary: '#55575b', secondary_link: '#55575b',
        tertiary: '#5a5c60', tertiary_link: '#5a5c60', unclassified: '#606266', residential: '#5d5f63',
        living_street: '#6a6c70', service: '#6e7074', emergency_bay: '#6e7074',
        track: '#a08a63', path: '#b39f7d', footway: '#a7a39b', steps: '#a7a39b',
    };
    const MITTELLINIE = new Set(['primary', 'secondary', 'tertiary']);
    const strassenRaster = new Raster(25);

    // Teile einer Linie außerhalb des Zelts (das Ende der Straße An der Lehmkuhle liegt in OSM darunter).
    // Nur Linien in Zeltnähe werden dafür in 1-m-Schritte zerlegt.
    function ohneZelt(punkte) {
        const nah = punkte.some(([x, z]) => Math.hypot(x - zelt.mx, z - zelt.mz) < 60);
        if (!nah) return [punkte];
        const stuecke = [];
        let aktuell = [], getroffen = false;
        for (let i = 0; i < punkte.length - 1; i++) {
            const [ax, az] = punkte[i], [bx, bz] = punkte[i + 1];
            const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
            for (let k = 0; k <= n; k++) {
                if (k === 0 && i > 0) continue;
                const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
                if (punktInPolygon(x, z, zelt.ring)) {
                    getroffen = true;
                    if (aktuell.length > 1) stuecke.push(aktuell);
                    aktuell = [];
                } else {
                    aktuell.push([x, z]);
                }
            }
        }
        if (aktuell.length > 1) stuecke.push(aktuell);
        // Linien, die das Zelt nicht berühren, bleiben unverändert
        return getroffen ? stuecke : [punkte];
    }

    function strassenBauen() {
        const gewaesser = new GeometrieBauer();
        const blau = farbe('#4f8fc0');
        for (const g of D.gewaesser) gewaesser.band(g.p, g.w, 0.12, blau);
        bodenEbene(gewaesser.mesh(vertexMaterial()), -4);

        // Feldwege zuerst, damit befestigte Straßen an Kreuzungen oben liegen
        const unbefestigt = s => s.t === 'track' || s.t === 'path' || s.t === 'footway';
        const sortiert = D.strassen.slice().sort((a, b) => unbefestigt(b) - unbefestigt(a));
        const bauer = new GeometrieBauer();
        const linien = new GeometrieBauer();
        const weiss = farbe('#f2f2ee');
        for (const s of sortiert) {
            for (const stueck of ohneZelt(s.p)) {
                bauer.band(stueck, s.w, unbefestigt(s) ? 0.15 : 0.18, farbe(STRASSEN_FARBE[s.t]));
            }

            if (MITTELLINIE.has(s.t)) {
                let strecke = 0;
                for (let i = 0; i < s.p.length - 1; i++) {
                    const [ax, az] = s.p[i], [bx, bz] = s.p[i + 1];
                    const l = Math.hypot(bx - ax, bz - az);
                    for (let t = (9 - strecke % 9) % 9; t + 3 <= l; t += 9) {
                        const a = [ax + (bx - ax) * t / l, az + (bz - az) * t / l];
                        const b = [ax + (bx - ax) * (t + 3) / l, az + (bz - az) * (t + 3) / l];
                        const nx = -(bz - az) / l * 0.07, nz = (bx - ax) / l * 0.07;
                        const p = GeometrieBauer.aufGelaende;
                        linien.viereck(p(a[0] + nx, a[1] + nz, 0.22), p(b[0] + nx, b[1] + nz, 0.22),
                            p(b[0] - nx, b[1] - nz, 0.22), p(a[0] - nx, a[1] - nz, 0.22), weiss);
                    }
                    strecke += l;
                }
            }

            for (let i = 0; i < s.p.length - 1; i++) {
                const [ax, az] = s.p[i], [bx, bz] = s.p[i + 1];
                strassenRaster.einfuegen({ ax, az, bx, bz, s },
                    Math.min(ax, bx) - 20, Math.min(az, bz) - 20, Math.max(ax, bx) + 20, Math.max(az, bz) + 20);
            }
        }
        bodenEbene(bauer.mesh(vertexMaterial()), -3);
        if (linien.pos.length) bodenEbene(linien.mesh(vertexMaterial()), -2);
    }

    function naechsteStrasse(x, z, maxAbstand, nurMitNamen) {
        let beste = null;
        for (const e of strassenRaster.abfragen(x, z)) {
            if (nurMitNamen && !e.s.n) continue;
            const r = naechsterPunktAufStrecke(x, z, e.ax, e.az, e.bx, e.bz);
            if (r.d < maxAbstand && (!beste || r.d < beste.d)) beste = { ...r, s: e.s };
        }
        return beste;
    }

    // ---------- Gebäude ----------

    const WAND_FARBEN = ['#efe6d6', '#e8dcc8', '#f3efe7', '#e2d5bf', '#d9c3a5', '#c9b79c', '#b8694a', '#a65a3c'];
    const NEBENGEBAEUDE_FARBEN = ['#c8c4bc', '#9a8f80', '#b5ab9b', '#8a7a68'];
    const DACH_FARBEN = ['#8c3b2a', '#7a3324', '#3d3f44', '#5a2e24', '#9a4a33', '#4a4c52'];
    const NEBENGEBAEUDE = new Set(['garage', 'shed', 'carport', 'roof', 'cabin']);
    const OHNE_SPITZDACH = new Set(['garage', 'shed', 'carport', 'roof', 'commercial', 'retail', 'service']);
    const gebaeudeRaster = new Raster(16);

    // Kleinstes umschließendes Rechteck, ausgerichtet an einer Polygonkante
    function ausgerichtetesRechteck(ring) {
        let beste = null;
        for (let i = 0; i < ring.length; i++) {
            const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
            const l = Math.hypot(bx - ax, bz - az);
            if (l < 0.5) continue;
            const ux = (bx - ax) / l, uz = (bz - az) / l, vx = -uz, vz = ux;
            let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
            for (const [x, z] of ring) {
                const u = x * ux + z * uz, v = x * vx + z * vz;
                u0 = Math.min(u0, u); u1 = Math.max(u1, u);
                v0 = Math.min(v0, v); v1 = Math.max(v1, v);
            }
            const flaeche = (u1 - u0) * (v1 - v0);
            if (!beste || flaeche < beste.flaeche) beste = { ux, uz, vx, vz, u0, u1, v0, v1, flaeche };
        }
        // u soll die Längsachse sein
        if (beste && beste.u1 - beste.u0 < beste.v1 - beste.v0) {
            const b = beste;
            beste = { ux: b.vx, uz: b.vz, vx: -b.ux, vz: -b.uz, u0: b.v0, u1: b.v1, v0: -b.u1, v1: -b.u0, flaeche: b.flaeche };
        }
        return beste;
    }

    function gebaeudeBauen() {
        const bauer = new GeometrieBauer();
        const fensterFarbe = farbe('#3b4a5a');
        const tuerFarbe = farbe('#5b3a24');
        const flachdachFarbe = farbe('#6b6b6b');

        for (const g of D.gebaeude) {
            const ring = g.p;
            const grundflaeche = polygonFlaeche(ring);
            const rechteck = ausgerichtetesRechteck(ring);
            if (!rechteck) continue;
            const istKirche = g.t === 'church';
            const neben = NEBENGEBAEUDE.has(g.t);

            let dach = g.d || (OHNE_SPITZDACH.has(g.t) || grundflaeche < 25 ? 'flat' : 'gabled');
            if (dach !== 'flat' && !istKirche && grundflaeche / rechteck.flaeche < 0.75) dach = 'flat';
            if (!['flat', 'gabled', 'hipped', 'half-hipped', 'pyramidal'].includes(dach)) dach = 'flat';

            const wandFarbe = farbe(istKirche ? '#e9e2d2' : auswahl(neben ? NEBENGEBAEUDE_FARBEN : WAND_FARBEN));
            const sockelFarbe = wandFarbe.clone().multiplyScalar(0.75);
            const dachFarbe = farbe(istKirche ? '#3d3f44' : auswahl(DACH_FARBEN));
            const wandHoehe = istKirche ? 9 : dach === 'flat' ? g.h : Math.max(2.6, g.h - 1.5);

            // Am Hang: Wände reichen unter den tiefsten Geländepunkt, die Etagen beginnen über dem höchsten
            const boden = ring.map(([x, z]) => hoehe(x, z));
            const unten = Math.min(...boden) - 0.5;
            const erdgeschoss = Math.max(...boden);
            const oben = erdgeschoss + wandHoehe;

            // Wände mit Sockel, Fenstern und Tür
            let laengsteKante = -1, laengsteLaenge = 0;
            for (let i = 0; i < ring.length; i++) {
                const j = (i + 1) % ring.length;
                const [ax, az] = ring[i], [bx, bz] = ring[j];
                const sa = boden[i] + 0.5, sb = boden[j] + 0.5;
                bauer.viereck([ax, unten, az], [bx, unten, bz], [bx, sb, bz], [ax, sa, az], sockelFarbe);
                bauer.viereck([ax, sa, az], [bx, sb, bz], [bx, oben, bz], [ax, oben, az], wandFarbe);
                const l = Math.hypot(bx - ax, bz - az);
                if (l > laengsteLaenge) { laengsteLaenge = l; laengsteKante = i; }

                if (neben || l < 3) continue;
                // Außenseite bestimmen
                let nx = -(bz - az) / l, nz = (bx - ax) / l;
                if (punktInPolygon((ax + bx) / 2 + nx * 0.2, (az + bz) / 2 + nz * 0.2, ring)) { nx = -nx; nz = -nz; }
                const ox = nx * 0.04, oz = nz * 0.04;
                const ux = (bx - ax) / l, uz = (bz - az) / l;
                const anzahl = Math.floor((l - 1) / 3);
                const rand = (l - anzahl * 3) / 2 + 1;
                for (let etage = 0; etage * 2.9 + 2.3 < wandHoehe; etage++) {
                    const y0 = erdgeschoss + etage * 2.9 + 1.1, y1 = y0 + 1.2;
                    for (let k = 0; k < anzahl; k++) {
                        const t0 = rand + k * 3 - 0.5, t1 = t0 + 1;
                        if (i === laengsteKante && etage === 0 && k === 0) continue;
                        bauer.viereck(
                            [ax + ux * t0 + ox, y0, az + uz * t0 + oz], [ax + ux * t1 + ox, y0, az + uz * t1 + oz],
                            [ax + ux * t1 + ox, y1, az + uz * t1 + oz], [ax + ux * t0 + ox, y1, az + uz * t0 + oz],
                            fensterFarbe);
                    }
                }
            }
            if (!neben && laengsteKante >= 0 && laengsteLaenge >= 3) {
                const [ax, az] = ring[laengsteKante], [bx, bz] = ring[(laengsteKante + 1) % ring.length];
                const l = laengsteLaenge, ux = (bx - ax) / l, uz = (bz - az) / l;
                let nx = -uz, nz = ux;
                if (punktInPolygon((ax + bx) / 2 + nx * 0.2, (az + bz) / 2 + nz * 0.2, ring)) { nx = -nx; nz = -nz; }
                const t0 = l / 2 - 0.5, t1 = l / 2 + 0.5, ox = nx * 0.05, oz = nz * 0.05;
                // Tür auf dem Gelände vor der Wand
                const y0 = hoehe(ax + ux * l / 2 + nx, az + uz * l / 2 + nz), y1 = y0 + 2.1;
                bauer.viereck(
                    [ax + ux * t0 + ox, y0, az + uz * t0 + oz], [ax + ux * t1 + ox, y0, az + uz * t1 + oz],
                    [ax + ux * t1 + ox, y1, az + uz * t1 + oz], [ax + ux * t0 + ox, y1, az + uz * t0 + oz], tuerFarbe);
            }

            // Dach
            if (dach === 'flat') {
                bauer.flaeche(ring, oben, neben ? dachFarbe.clone().lerp(flachdachFarbe, 0.6) : flachdachFarbe);
            } else {
                spitzdachBauen(bauer, rechteck, oben, dach, wandFarbe, dachFarbe);
            }

            if (istKirche) kirchturmBauen(bauer, rechteck, wandFarbe, dachFarbe);

            // Kollisionskanten
            for (let i = 0; i < ring.length; i++) {
                const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
                gebaeudeRaster.einfuegen({ ax, az, bx, bz, ring },
                    Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1);
            }
        }

        const mesh = bauer.mesh(vertexMaterial());
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        szene.add(mesh);
    }

    function spitzdachBauen(bauer, r, wandHoehe, art, wandFarbe, dachFarbe) {
        const p = (u, v, y) => [u * r.ux + v * r.vx, y, u * r.uz + v * r.vz];
        const breite = r.v1 - r.v0, laenge = r.u1 - r.u0;
        const vm = (r.v0 + r.v1) / 2;
        const hoehe = Math.min(breite * 0.45, 6);
        const neigung = hoehe / (breite / 2);
        const ue = 0.4;
        const traufe = wandHoehe - ue * neigung, first = wandHoehe + hoehe;

        let einzug = 0;
        if (art === 'hipped' || art === 'pyramidal') einzug = breite / 2;
        if (art === 'half-hipped') einzug = breite / 4;
        einzug = Math.min(einzug, laenge / 2);
        const f0 = r.u0 + einzug - (einzug ? 0 : ue), f1 = r.u1 - einzug + (einzug ? 0 : ue);
        const u0 = r.u0 - ue, u1 = r.u1 + ue, v0 = r.v0 - ue, v1 = r.v1 + ue;

        bauer.viereck(p(u0, v0, traufe), p(u1, v0, traufe), p(f1, vm, first), p(f0, vm, first), dachFarbe);
        bauer.viereck(p(u0, v1, traufe), p(u1, v1, traufe), p(f1, vm, first), p(f0, vm, first), dachFarbe);

        if (einzug > 0) {
            bauer.dreieck(p(u0, v0, traufe), p(u0, v1, traufe), p(f0, vm, first), dachFarbe);
            bauer.dreieck(p(u1, v0, traufe), p(u1, v1, traufe), p(f1, vm, first), dachFarbe);
        } else {
            bauer.dreieck(p(r.u0, r.v0, wandHoehe), p(r.u0, r.v1, wandHoehe), p(r.u0, vm, first), wandFarbe);
            bauer.dreieck(p(r.u1, r.v0, wandHoehe), p(r.u1, r.v1, wandHoehe), p(r.u1, vm, first), wandFarbe);
        }
    }

    function kirchturmBauen(bauer, r, wandFarbe, dachFarbe) {
        const p = (u, v, y) => [u * r.ux + v * r.vx, y, u * r.uz + v * r.vz];
        const vm = (r.v0 + r.v1) / 2, s = 2.6;
        // Turm am nördlicheren Ende des Kirchenschiffs
        const nordEnde = p(r.u0, vm, 0)[2] < p(r.u1, vm, 0)[2];
        const um = nordEnde ? r.u0 + s : r.u1 - s;
        const ecken = [[um - s, vm - s], [um + s, vm - s], [um + s, vm + s], [um - s, vm + s]];
        const unten = Math.min(...ecken.map(([u, v]) => { const q = p(u, v, 0); return hoehe(q[0], q[2]); })) - 0.5;
        const traufe = unten + 24, spitze = unten + 34;
        for (let i = 0; i < 4; i++) {
            const [a0, b0] = ecken[i], [a1, b1] = ecken[(i + 1) % 4];
            bauer.viereck(p(a0, b0, unten), p(a1, b1, unten), p(a1, b1, traufe), p(a0, b0, traufe), wandFarbe);
            bauer.dreieck(p(a0, b0, traufe), p(a1, b1, traufe), p(um, vm, spitze), dachFarbe);
        }
        const ring = ecken.map(([u, v]) => { const q = p(u, v, 0); return [q[0], q[2]]; });
        for (let i = 0; i < 4; i++) {
            const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % 4];
            gebaeudeRaster.einfuegen({ ax, az, bx, bz, ring },
                Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1);
        }
    }

    // ---------- Schützenzelt (Daten aus js/festplanung.js) ----------

    function lokal(lat, lon) {
        const u = D.ursprung;
        return [(lon - u.lon) * u.mProGradLon, -(lat - u.lat) * u.mProGradLat];
    }

    // Zelt-Koordinaten: l längs (positiv Richtung Süden), q quer (positiv Richtung Osten)
    const zelt = (() => {
        const z = ROLFZEN_FEST.zelt;
        const [mx, mz] = lokal(z.lat, z.lon);
        const { ux, uz, ox, oz } = festAchsen(z.ausrichtung);
        const ring = festRechteck(z.laenge, z.breite, z.ausrichtung).map(([x, zz]) => [mx + x, mz + zz]);
        const punkt = (l, q) => [mx + l * ux + q * ox, mz + l * uz + q * oz];
        // Eingang in der Mitte der östlichen Längsseite, zum Asphaltplatz
        const eingang = punkt(z.eingangLaengs, z.breite / 2);
        const platz = ROLFZEN_FEST.platz.map(([l, q]) => punkt(l, q));
        return { ...z, mx, mz, ux, uz, ox, oz, ring, punkt, eingang, platz };
    })();
    const hindernisse = [];   // Ringe von Buden und Karussell, für inGebaeude
    let karussell = null;
    const bildschirme = [];   // Werbe-Bildschirme im Zelt, wechseln in der Hauptschleife
    let werbeZeit = 0;

    // Kollisionskanten eines geschlossenen Rings (ohne die Kanten, die ausgelassen werden sollen)
    function kantenEinfuegen(ring, ohne) {
        for (let i = 0; i < ring.length; i++) {
            if (ohne && ohne.includes(i)) continue;
            const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
            gebaeudeRaster.einfuegen({ ax, az, bx, bz, ring },
                Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1);
        }
    }

    // Quader mit beliebiger Ausrichtung: Mitte (x, z), Achsen a (Breite) und b (Tiefe), Unterkante y0
    function quaderBauen(bauer, x, z, a, b, breite, tiefe, y0, h, f, ohneDeckel) {
        const e = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) =>
            [x + a[0] * s * breite / 2 + b[0] * t * tiefe / 2, z + a[1] * s * breite / 2 + b[1] * t * tiefe / 2]);
        for (let i = 0; i < 4; i++) {
            const p = e[i], q = e[(i + 1) % 4];
            bauer.viereck([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y0 + h, q[1]], [p[0], y0 + h, p[1]], f);
        }
        if (!ohneDeckel) bauer.viereck(...e.map(([px, pz]) => [px, y0 + h, pz]), f);
        return e;
    }

    function zeltBauen() {
        const bauer = new GeometrieBauer();
        const { ux, uz, ox, oz, laenge, breite } = zelt;
        const p = (l, q, y) => { const [x, z] = zelt.punkt(l, q); return [x, y, z]; };
        const bodenBei = (l, q) => { const [x, z] = zelt.punkt(l, q); return hoehe(x, z); };
        const weiss = farbe('#f4f3ee'), gruen = farbe('#2f5a34'), holz = farbe('#8a6a45'), theke = farbe('#6b4a2e');
        const boden = zelt.ring.map(([x, z]) => hoehe(x, z));
        const unten = Math.min(...boden) - 0.3, oben = Math.max(...boden) + 3;
        const l2 = laenge / 2, b2 = breite / 2, t2 = zelt.eingangBreite / 2;

        // Wände; an der Ostseite (q = +b2) bleibt der Eingang offen, an der Westseite die beiden
        // Ecken (Band- und Thekenseite) auf je 1,5 m, jeweils bis 2,5 m Höhe
        const wand = (a, b, y0, y1, f) => bauer.viereck(p(a[0], a[1], y0), p(b[0], b[1], y0), p(b[0], b[1], y1), p(a[0], a[1], y1), f);
        const ecke = zelt.eckOeffnung;
        wand([-l2 + ecke, -b2], [l2 - ecke, -b2], unten, oben, weiss);
        wand([-l2, -b2], [-l2 + ecke, -b2], bodenBei(-l2 + ecke / 2, -b2) + 2.5, oben, weiss);
        wand([l2 - ecke, -b2], [l2, -b2], bodenBei(l2 - ecke / 2, -b2) + 2.5, oben, weiss);
        wand([-l2, -b2], [-l2, b2], unten, oben, weiss);
        wand([l2, -b2], [l2, b2], unten, oben, weiss);
        const el = zelt.eingangLaengs;   // Mitte des Eingangs entlang der Ostseite
        wand([-l2, b2], [el - t2, b2], unten, oben, weiss);
        wand([el + t2, b2], [l2, b2], unten, oben, weiss);
        wand([el - t2, b2], [el + t2, b2], bodenBei(el, b2) + 2.5, oben, weiss);
        // Grünes Band an der Traufe
        for (const [a, b] of [[[-l2, -b2], [l2, -b2]], [[-l2, b2], [l2, b2]], [[-l2, -b2], [-l2, b2]], [[l2, -b2], [l2, b2]]]) {
            const f = 1.003;
            wand([a[0] * f, a[1] * f], [b[0] * f, b[1] * f], oben - 0.5, oben, gruen);
        }
        // Dach über dem Rechteck (Längsachse u, Querachse o)
        const uc = zelt.mx * ux + zelt.mz * uz, oc = zelt.mx * ox + zelt.mz * oz;
        spitzdachBauen(bauer, { ux, uz, vx: ox, vz: oz, u0: uc - l2, u1: uc + l2, v0: oc - b2, v1: oc + b2 },
            oben, 'gabled', weiss, weiss);

        const u = [ux, uz], o = [ox, oz];
        const quader = (l, q, lu, lq, h, f, y) => {
            const [x, z] = zelt.punkt(l, q);
            quaderBauen(bauer, x, z, u, o, lu, lq, y !== undefined ? y : bodenBei(l, q), h, f);
        };
        const innen = ROLFZEN_FEST.innen;
        const schwarz = farbe('#1c1c1c'), metall = farbe('#b0b0b0'), rot = farbe('#8b1e3f'), gold = farbe('#d4af37');

        // Podest über einem Rechteck [l von, l bis, q von, q bis]; liefert die Oberkante.
        // Podeste und Theke sind Hindernisse, damit man nicht hindurchläuft.
        function podest([l0, l1, q0, q1], h, f) {
            const ecken = [[l0, q0], [l1, q0], [l1, q1], [l0, q1]];
            const boeden = ecken.map(([l, q]) => bodenBei(l, q));
            const oben = Math.max(...boeden) + h;
            quader((l0 + l1) / 2, (q0 + q1) / 2, l1 - l0, q1 - q0, oben - Math.min(...boeden) + 0.1, f, Math.min(...boeden) - 0.1);
            const ring = ecken.map(([l, q]) => zelt.punkt(l, q));
            hindernisse.push(ring);
            kantenEinfuegen(ring);
            return oben;
        }

        // Norden: Bühne für die Band mit Schlagzeug, Verstärkern, Boxen und Mikrofonständern
        const b = innen.buehne, bo = podest(b.von, b.hoehe, farbe('#4e3b2a'));
        const bl = b.von[0];
        quader(bl + 1.6, 0, 0.6, 0.7, 0.7, rot, bo);                 // große Trommel
        quader(bl + 1.4, -0.8, 0.45, 0.45, 0.6, rot, bo);            // Stand-Tom
        quader(bl + 2.0, 0.6, 0.35, 0.35, 0.85, rot, bo);            // Snare
        for (const q of [-1.1, 1.2]) {                                // Becken
            quader(bl + 2.0, q, 0.05, 0.05, 1.3, metall, bo);
            quader(bl + 2.0, q, 0.6, 0.6, 0.02, gold, bo + 1.3);
        }
        for (const q of [-4.7, 4.7]) quader(bl + 1.0, q, 0.7, 0.9, 1.6, schwarz, bo);   // Boxen
        for (const q of [-2.8, 2.8]) quader(bl + 0.6, q, 0.45, 0.7, 0.6, schwarz, bo);  // Verstärker
        quader(bl + 2.4, 3.3, 0.5, 1.3, 0.85, schwarz, bo);          // Keyboard
        for (const q of [-2.2, 0, 2.2]) quader(bl + 3.4, q, 0.04, 0.04, 1.6, metall, bo); // Mikrofone
        {
            const [x, z] = zelt.punkt(bl + 0.3, 0);
            beschriftung('Schützenfest Rolfzen', x, z, bo + 2.4, 5, 'rgba(31, 81, 48, 0.9)');
        }

        // Westen mittig: Bühne für das Königspaar mit langem Tisch (weiße Decke); in der Mitte die goldenen
        // Stühle des Königspaars, links und rechts je zwei Stühle für die beiden Hofstaatpaare
        const k = innen.koenigsbuehne, ko = podest(k.von, k.hoehe, farbe('#5a4030'));
        const km = (k.von[0] + k.von[1]) / 2, kq = (k.von[2] + k.von[3]) / 2;
        quader(km, kq, k.von[1] - k.von[0] - 0.2, k.von[3] - k.von[2] - 0.2, 0.02, rot, ko);   // roter Teppich
        quader(km, kq + 0.6, 5.6, 0.9, 0.76, farbe('#ffffff'), ko);                             // Tisch mit Decke
        for (const [l, f, lehne] of [[km - 0.4, gold, 1.3], [km + 0.4, gold, 1.3],
            [km - 2.3, rot, 1.0], [km - 1.5, rot, 1.0], [km + 1.5, rot, 1.0], [km + 2.3, rot, 1.0]]) {
            quader(l, kq - 0.4, 0.55, 0.5, 0.48, f, ko);              // Sitz
            quader(l, kq - 0.7, 0.55, 0.1, lehne, f, ko);             // Lehne
        }
        // Getränkekühlschränke neben der Königsbühne: grünes Gehäuse, Glastür zum Zelt
        for (const [l, q] of innen.kuehlschraenke) {
            quader(l, q, 0.7, 0.7, 1.9, farbe('#0b5a2e'));
            quader(l, q + 0.36, 0.55, 0.02, 1.4, farbe('#9fc4d6'), bodenBei(l, q) + 0.3);
            const [x, z] = zelt.punkt(l, q);
            beschriftung('Veltins', x, z, bodenBei(l, q) + 2.2, 1.2, 'rgba(11, 90, 46, 0.95)');
            const ring = [[l - 0.35, q - 0.35], [l + 0.35, q - 0.35], [l + 0.35, q + 0.35], [l - 0.35, q + 0.35]].map(([a, c]) => zelt.punkt(a, c));
            hindernisse.push(ring);
            kantenEinfuegen(ring);
        }
        {
            const [x, z] = zelt.punkt(km, k.von[2] + 0.3);
            beschriftung('Königspaar', x, z, ko + 2.8, 3.2, 'rgba(120, 90, 10, 0.9)');
        }

        // Süden: Getränketheke mit Regal dahinter, davor Stehtische (Beschriftung trägt die Preistafel)
        const t = innen.theke;
        podest(t.von, t.hoehe, theke);
        quader(t.von[1] + 1.1, (t.von[2] + t.von[3]) / 2, 0.4, t.von[3] - t.von[2], 2, holz);
        for (const [l, q] of innen.stehtische) {
            quader(l, q, 0.08, 0.08, 1.1, metall);
            quader(l, q, 0.8, 0.8, 0.04, farbe('#f4f3ee'), bodenBei(l, q) + 1.1);
        }

        // Preistafel über dem Regal hinter der Theke und zwei Werbe-Bildschirme unter der Decke;
        // alle zeigen nach Norden ins Zelt
        const insZelt = Math.atan2(-ux, -uz);
        const tafel = (breite, hoehe, textur, l, q, y) => {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(breite, hoehe), new THREE.MeshBasicMaterial({ map: textur }));
            const [x, z] = zelt.punkt(l, q);
            m.position.set(x, y, z);
            m.rotation.y = insZelt;
            szene.add(m);
            return m;
        };
        {
            const leinwand = document.createElement('canvas');
            leinwand.width = 640; leinwand.height = 512;
            const ctx = leinwand.getContext('2d');
            ctx.fillStyle = '#1d2b22';
            ctx.fillRect(0, 0, 640, 512);
            ctx.strokeStyle = '#c9a227';
            ctx.lineWidth = 10;
            ctx.strokeRect(10, 10, 620, 492);
            ctx.fillStyle = '#ffd23f';
            ctx.font = 'bold 54px Segoe UI, Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Getränke', 320, 72);
            ctx.font = '38px Segoe UI, Arial';
            innen.preise.forEach(([sorte, preis], i) => {
                const y = 140 + i * 52;
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'left';
                ctx.fillText(sorte, 50, y);
                ctx.textAlign = 'right';
                ctx.fillText(preis, 590, y);
            });
            const t = innen.theke;
            tafel(2.4, 1.92, new THREE.CanvasTexture(leinwand), t.von[1] + 0.85, 0, bodenBei(t.von[1] + 1.1, 0) + 3.05);
        }
        {
            const t = innen.theke, l = (t.von[0] + t.von[1]) / 2;
            const texturen = innen.werbung.map(w => {
                const leinwand = document.createElement('canvas');
                leinwand.width = 640; leinwand.height = 360;
                const ctx = leinwand.getContext('2d');
                ctx.fillStyle = w.farbe;
                ctx.fillRect(0, 0, 640, 360);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
                ctx.fillRect(0, 250, 640, 110);
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.font = 'bold 84px Segoe UI, Arial';
                ctx.fillText(w.titel, 320, 160, 600);
                ctx.font = '34px Segoe UI, Arial';
                ctx.fillText(w.text, 320, 315, 600);
                return new THREE.CanvasTexture(leinwand);
            });
            [-5.6, 5.6].forEach((q, i) => {
                const y = bodenBei(l, q) + 2.5;
                quader(l + 0.05, q, 0.08, 1.75, 1.05, schwarz, y - 0.525);
                for (const dq of [-0.6, 0.6]) quader(l + 0.05, q + dq, 0.02, 0.02, 0.9, metall, y + 0.5);
                const bild = tafel(1.6, 0.9, texturen[i % texturen.length], l - 0.01, q, y);
                bildschirme.push({ bild, texturen, index: i });
            });
        }

        // Bierzeltgarnituren quer zur Zeltachse an der Ostwand zwischen Bandbühne und Eingang,
        // je zwei Tische hintereinander von der Wand aus; vor der Königsbühne bleibt eine Tanzfläche frei
        for (let l = b.von[1] + 1.2; l + 0.8 < el - t2; l += 2.4) {
            for (const q of [b2 - 1.3, b2 - 3.55]) {
                const y = bodenBei(l, q);
                quader(l, q, 0.6, 2.2, 0.75, holz, y);
                quader(l - 0.65, q, 0.25, 2.2, 0.45, holz, y);
                quader(l + 0.65, q, 0.25, 2.2, 0.45, holz, y);
            }
        }
        // Kleine Holzrampe vor dem Eingang: 1,5 m lang, steigt zur Zeltwand auf 0,25 m
        {
            const rampe = farbe('#9a7b55');
            const aussen = b2 + 1.5;
            const yI0 = bodenBei(el - t2, b2) + 0.25, yI1 = bodenBei(el + t2, b2) + 0.25;
            const yA0 = bodenBei(el - t2, aussen) + 0.02, yA1 = bodenBei(el + t2, aussen) + 0.02;
            bauer.viereck(p(el - t2, b2, yI0), p(el + t2, b2, yI1), p(el + t2, aussen, yA1), p(el - t2, aussen, yA0), rampe);
            for (const l of [el - t2, el + t2]) {
                const yI = l < el ? yI0 : yI1, yA = l < el ? yA0 : yA1;
                bauer.dreieck(p(l, b2, yI - 0.27), p(l, b2, yI), p(l, aussen, yA), rampe);
            }
        }

        const mesh = bauer.mesh(vertexMaterial());
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        szene.add(mesh);

        // Kollision: alle Wandstücke außer Eingang und den beiden offenen Westecken
        const wandstuecke = [
            [[-l2 + ecke, -b2], [l2 - ecke, -b2]], [[-l2, -b2], [-l2, b2]], [[l2, -b2], [l2, b2]],
            [[-l2, b2], [el - t2, b2]], [[el + t2, b2], [l2, b2]],
        ];
        for (const [a, b] of wandstuecke) kantenEinfuegen([zelt.punkt(...a), zelt.punkt(...b)], [1]);

        festplatzBauen();
    }

    // Asphaltplatz, Buden und Kinderkarussell vor dem Zelteingang
    function festplatzBauen() {
        const F = ROLFZEN_FEST;
        // Asphalt: Dreiecke so lange teilen, bis sie dem Gelände folgen (Kanten unter 2,5 m)
        const asphalt = new GeometrieBauer();
        const grau = farbe('#5b5d61');
        const kontur = zelt.platz.map(([x, z]) => new THREE.Vector2(x, z));
        const teilen = (a, b, c, tiefe) => {
            const lang = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
            if (lang < 2.5 || tiefe > 6) {
                asphalt.dreieck(...[a, b, c].map(([x, z]) => GeometrieBauer.aufGelaende(x, z, 0.17)), grau);
                return;
            }
            const m = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
            const ab = m(a, b), bc = m(b, c), ca = m(c, a);
            teilen(a, ab, ca, tiefe + 1); teilen(ab, b, bc, tiefe + 1); teilen(ca, bc, c, tiefe + 1); teilen(ab, bc, ca, tiefe + 1);
        };
        for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(kontur, [])) {
            teilen(zelt.platz[i], zelt.platz[j], zelt.platz[k], 0);
        }
        bodenEbene(asphalt.mesh(vertexMaterial()), -3);

        // Buden: Rückseite und Seiten, Theke vorn, gestreifte Markise, Schild;
        // Front zur Platzmitte oder zum Punkt blickZu
        const bauer = new GeometrieBauer();
        const weiss = farbe('#f6f4ee'), holz = farbe('#8a6a45');
        for (const b of F.buden) {
            const [x, z] = zelt.punkt(b.laengs, b.quer);
            const mitte = zelt.punkt(...(b.blickZu || [0, 14]));
            let fx = mitte[0] - x, fz = mitte[1] - z;
            const fl = Math.hypot(fx, fz); fx /= fl; fz /= fl;
            const sx = -fz, sz = fx, tiefe = b.tiefe || 2.2;
            const ecken = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [x + sx * s * b.breite / 2 + fx * t * tiefe / 2, z + sz * s * b.breite / 2 + fz * t * tiefe / 2]);
            const y0 = Math.min(...ecken.map(([px, pz]) => hoehe(px, pz))) - 0.2;
            const farbig = farbe(b.farbe);
            quaderBauen(bauer, x, z, [sx, sz], [fx, fz], b.breite, tiefe, y0, 2.6, weiss);
            quaderBauen(bauer, x, z, [sx, sz], [fx, fz], b.breite + 0.1, tiefe + 0.1, y0 + 2.6, 0.25, farbig);
            // Theke vor der offenen Front
            quaderBauen(bauer, x + fx * (tiefe / 2 + 0.25), z + fz * (tiefe / 2 + 0.25), [sx, sz], [fx, fz], b.breite - 0.2, 0.5, y0, 1.05, holz);
            // Markise in sechs Streifen, von der Oberkante schräg nach vorn
            const vorn = tiefe / 2, y1 = y0 + 2.6, streifen = 6;
            for (let i = 0; i < streifen; i++) {
                const s0 = -b.breite / 2 + i * b.breite / streifen, s1 = s0 + b.breite / streifen;
                const pkt = (s, f, y) => [x + sx * s + fx * f, y, z + sz * s + fz * f];
                bauer.viereck(pkt(s0, vorn, y1), pkt(s1, vorn, y1), pkt(s1, vorn + 1.1, y1 - 0.45), pkt(s0, vorn + 1.1, y1 - 0.45),
                    i % 2 ? weiss : farbig);
            }
            beschriftung(b.name, x, z, y0 + 3.6, 4, 'rgba(110, 30, 20, 0.85)');
            hindernisse.push(ecken);
            kantenEinfuegen(ecken);
        }
        toilettenBauen(bauer);

        // Container hinter dem Zelt: Glascontainer mit abgeschrägtem Deckel und Einwurf,
        // Altkleidercontainer höher und schmaler; beide entlang der Zeltachsen ausgerichtet
        const zu = [zelt.ux, zelt.uz], zo = [zelt.ox, zelt.oz];
        for (const c of F.container) {
            const [x, z] = zelt.punkt(c.laengs, c.quer);
            const glas = c.art === 'glas';
            const breite = glas ? 1.5 : 1.6, tiefe = glas ? 1.5 : 1.3, h = glas ? 1.6 : 2.2;
            const ecken = quaderBauen(bauer, x, z, zo, zu, breite, tiefe, hoehe(x, z) - 0.1, h + 0.1, farbe(c.farbe), glas);
            const y1 = hoehe(x, z) + h;
            if (glas) {
                // Deckel als flache Pyramide
                for (let i = 0; i < 4; i++) {
                    const a = ecken[i], b = ecken[(i + 1) % 4];
                    bauer.dreieck([a[0], y1, a[1]], [b[0], y1, b[1]], [x, y1 + 0.35, z], farbe(c.farbe));
                }
            }
            // Einwurf bzw. Klappe auf der Nordseite (zum Zelt)
            const [ex, ez] = zelt.punkt(c.laengs - tiefe / 2 - 0.02, c.quer);
            quaderBauen(bauer, ex, ez, zo, zu, glas ? 0.5 : 0.9, 0.02, hoehe(x, z) + (glas ? 1.15 : 1.2), glas ? 0.2 : 0.45, farbe('#222222'));
            beschriftung(c.name, x, z, y1 + (glas ? 0.8 : 0.5), 1.4, 'rgba(40, 40, 40, 0.85)');
            hindernisse.push(ecken);
            kantenEinfuegen(ecken);
        }

        // Banner „Schützenfest Rolfzen“ zwischen zwei Pfosten; Text auf beiden Seiten lesbar
        const bannerTextur = (() => {
            const leinwand = document.createElement('canvas');
            leinwand.width = 1024; leinwand.height = 256;
            const ctx = leinwand.getContext('2d');
            ctx.fillStyle = '#1f5130';
            ctx.fillRect(0, 0, 1024, 256);
            ctx.strokeStyle = '#ffd23f';
            ctx.lineWidth = 12;
            ctx.strokeRect(12, 12, 1000, 232);
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 96px Segoe UI, Arial';
            const datum = F.banner.datum;
            ctx.fillText(F.banner.text, 512, datum ? 100 : 128, 960);
            if (datum) {
                ctx.font = 'bold 64px Segoe UI, Arial';
                ctx.fillStyle = '#ffd23f';
                ctx.fillText(datum, 512, 190, 960);
            }
            return new THREE.CanvasTexture(leinwand);
        })();
        for (const [a, e] of F.banner.liste) {
            const [ax, az] = zelt.punkt(...a), [ex, ez] = zelt.punkt(...e);
            const laenge = Math.hypot(ex - ax, ez - az);
            const ya = hoehe(ax, az), ye = hoehe(ex, ez);
            for (const [x, z, y] of [[ax, az, ya], [ex, ez, ye]]) {
                quaderBauen(bauer, x, z, [1, 0], [0, 1], 0.1, 0.1, y - 0.2, 2.6, farbe('#dddddd'));
            }
            // Zwei Tücher Rücken an Rücken, damit der Text von beiden Seiten richtig herum steht
            const tuchGeo = new THREE.PlaneGeometry(laenge - 0.15, laenge / 4);
            const tuchMat = new THREE.MeshLambertMaterial({ map: bannerTextur });
            for (const drehung of [0, Math.PI]) {
                const tuch = new THREE.Mesh(tuchGeo, tuchMat);
                tuch.position.set((ax + ex) / 2, (ya + ye) / 2 + 1.0 + laenge / 8, (az + ez) / 2);
                tuch.rotation.y = -Math.atan2(ez - az, ex - ax) + drehung;
                tuch.castShadow = true;
                szene.add(tuch);
            }
            // Als schmales Hindernis, damit niemand hindurchläuft
            const nx = -(ez - az) / laenge * 0.15, nz = (ex - ax) / laenge * 0.15;
            const ring = [[ax + nx, az + nz], [ex + nx, ez + nz], [ex - nx, ez - nz], [ax - nx, az - nz]];
            hindernisse.push(ring);
            kantenEinfuegen(ring);
        }
        const budenMesh = bauer.mesh(vertexMaterial());
        budenMesh.castShadow = true;
        budenMesh.receiveShadow = true;
        szene.add(budenMesh);

        // Kinderkarussell: dreht sich (siehe Hauptschleife)
        const k = F.karussell;
        const [kx, kz] = zelt.punkt(k.laengs, k.quer);
        const ky = hoehe(kx, kz);
        karussell = new THREE.Group();
        karussell.position.set(kx, ky, kz);
        const mat = c => new THREE.MeshLambertMaterial({ color: c });
        const teil = (geo, m, x, y, z) => { const t = new THREE.Mesh(geo, m); t.position.set(x, y, z); t.castShadow = true; karussell.add(t); return t; };
        teil(new THREE.CylinderGeometry(k.radius, k.radius, 0.3, 24), mat(0x8a2be2), 0, 0.15, 0);
        teil(new THREE.CylinderGeometry(0.15, 0.15, 3, 10), mat(0xffd23f), 0, 1.5, 0);
        teil(new THREE.ConeGeometry(k.radius + 0.4, 1.3, 24), mat(0xe53935), 0, 3.6, 0);
        teil(new THREE.SphereGeometry(0.25, 10, 8), mat(0xffd23f), 0, 4.35, 0);
        const sitzFarben = [0xffffff, 0x42a5f5, 0xffca28, 0x66bb6a, 0xef5350, 0xab47bc];
        for (let i = 0; i < 6; i++) {
            const w = i / 6 * Math.PI * 2, r = k.radius - 0.6;
            teil(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 6), mat(0xdddddd), Math.cos(w) * r, 1.6, Math.sin(w) * r);
            const pferd = teil(new THREE.BoxGeometry(0.3, 0.45, 0.8), mat(sitzFarben[i]), Math.cos(w) * r, 0.9, Math.sin(w) * r);
            pferd.rotation.y = -w;
        }
        szene.add(karussell);
        const kring = Array.from({ length: 8 }, (_, i) => [kx + Math.cos(i / 8 * Math.PI * 2) * k.radius, kz + Math.sin(i / 8 * Math.PI * 2) * k.radius]);
        hindernisse.push(kring);
        kantenEinfuegen(kring);
        beschriftung(k.name, kx, kz, ky + 5.2, 4, 'rgba(110, 30, 20, 0.85)');
    }

    // Offizierhaus: Öffnung in der Wand zum Platz mit zwei Toilettentüren
    function toilettenBauen(bauer) {
        const ort = D.orte.find(o => o.n === 'Offizierhaus');
        if (!ort) return;
        const mitte = p => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
        const haus = D.gebaeude.reduce((beste, g) => {
            const [cx, cz] = mitte(g.p);
            const d = Math.hypot(cx - ort.p[0], cz - ort.p[1]);
            return !beste || d < beste.d ? { g, d } : beste;
        }, null).g;
        const ring = haus.p;
        // Wand, deren Außenseite am stärksten zum Zelt zeigt
        let wand = null;
        for (let i = 0; i < ring.length; i++) {
            const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
            const l = Math.hypot(bx - ax, bz - az);
            let nx = (bz - az) / l, nz = -(bx - ax) / l;
            if (punktInPolygon((ax + bx) / 2 + nx * 0.2, (az + bz) / 2 + nz * 0.2, ring)) { nx = -nx; nz = -nz; }
            const zx = zelt.mx - (ax + bx) / 2, zz = zelt.mz - (az + bz) / 2, zl = Math.hypot(zx, zz);
            const wert = (nx * zx + nz * zz) / zl;
            if (l > 3.5 && (!wand || wert > wand.wert)) wand = { ax, az, ux: (bx - ax) / l, uz: (bz - az) / l, nx, nz, l, wert };
        }
        if (!wand) return;
        const { ax, az, ux, uz, nx, nz, l } = wand;
        const m = l / 2;
        const y0 = hoehe(ax + ux * m + nx, az + uz * m + nz);
        const pkt = (t, y, raus) => [ax + ux * t + nx * raus, y, az + uz * t + nz * raus];
        const flaeche = (t0, t1, ya, yb, raus, f) => bauer.viereck(pkt(t0, ya, raus), pkt(t1, ya, raus), pkt(t1, yb, raus), pkt(t0, yb, raus), f);
        // Dunkle Öffnung (3,2 m breit), darin zwei Türen
        flaeche(m - 1.6, m + 1.6, y0 - 0.3, y0 + 2.4, 0.07, farbe('#2a2a2a'));
        const namen = ROLFZEN_FEST.offizierhaus.toiletten;
        [-0.75, 0.75].forEach((versatz, i) => {
            flaeche(m + versatz - 0.45, m + versatz + 0.45, y0, y0 + 2.05, 0.1, farbe(i ? '#3f6fa8' : '#b0476a'));
            const [x, , z] = pkt(m + versatz, 0, 0.6);
            beschriftung(namen[i], x, z, y0 + 2.35, 1.4, i ? 'rgba(40, 80, 140, 0.9)' : 'rgba(150, 50, 90, 0.9)');
        });
        const [x, , z] = pkt(m, 0, 0.6);
        beschriftung('WC', x, z, y0 + 3.0, 1.6, 'rgba(30, 30, 30, 0.85)');
    }

    // Schwebendes Namensschild
    function beschriftung(text, x, z, y, breite, hintergrund) {
        const leinwand = document.createElement('canvas');
        leinwand.width = 512; leinwand.height = 96;
        const ctx = leinwand.getContext('2d');
        ctx.fillStyle = hintergrund;
        ctx.fillRect(0, 0, 512, 96);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 44px Segoe UI, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 50, 490);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(leinwand) }));
        sprite.position.set(x, y, z);
        sprite.scale.set(breite, breite * 96 / 512, 1);
        szene.add(sprite);
    }

    function inGebaeude(x, z) {
        if (punktInPolygon(x, z, zelt.ring)) return true;
        if (hindernisse.some(ring => punktInPolygon(x, z, ring))) return true;
        for (const k of gebaeudeRaster.abfragen(x, z)) {
            if (punktInPolygon(x, z, k.ring)) return true;
        }
        return false;
    }

    // ---------- Bäume und Büsche ----------

    function baeumeBauen() {
        const laub = [], nadel = [], busch = [];

        function streuen(ring, raster, wahrscheinlichkeit, ziel, max, pruefen) {
            const b = begrenzung(ring);
            for (let x = b.minX; x < b.maxX; x += raster) {
                for (let z = b.minZ; z < b.maxZ; z += raster) {
                    if (ziel.length >= max) return;
                    if (zufall() > wahrscheinlichkeit) continue;
                    const px = x + (zufall() - 0.5) * raster, pz = z + (zufall() - 0.5) * raster;
                    if (!punktInPolygon(px, pz, ring) || !punktInPolygon(px, pz, D.grenze)) continue;
                    if (pruefen && (inGebaeude(px, pz) || naechsteStrasse(px, pz, 4, false))) continue;
                    ziel.push([px, pz]);
                }
            }
        }

        // [Rasterabstand in m, Höchstzahl]
        const dichte = HANDY
            ? { wald: [14, 1500], busch: [9, 800], garten: [26, 2000] }
            : { wald: [10, 3500], busch: [6, 3000], garten: [20, 4500] };
        for (const f of D.flaechen) {
            if (f.t === 'wald') {
                streuen(f.p, dichte.wald[0], 0.9, zufall() < 0.5 ? laub : nadel, dichte.wald[1], false);
            } else if (f.t === 'gebuesch') {
                streuen(f.p, dichte.busch[0], 0.7, busch, dichte.busch[1], false);
            } else if (f.t === 'wohngebiet' || f.t === 'friedhof') {
                streuen(f.p, dichte.garten[0], 0.35, laub, dichte.garten[1], true);
            }
        }
        // Bäume entlang der Bäche
        for (const g of D.gewaesser) {
            for (let i = 0; i < g.p.length - 1; i++) {
                if (zufall() < 0.4) laub.push([g.p[i][0] + (zufall() - 0.5) * 6, g.p[i][1] + (zufall() - 0.5) * 6]);
            }
        }
        for (const p of D.baeume) laub.push(p);

        // Rund um den Schützenplatz stehen statt erzeugter die im Luftbild eingemessenen Bäume
        // (dritter Wert: Höhe, aus dem Kronenradius abgeleitet)
        const weitWeg = p => Math.hypot(p[0] - zelt.mx, p[1] - zelt.mz) > ROLFZEN_FEST.baumUmkreis;
        for (const liste of [laub, nadel, busch]) {
            const behalten = liste.filter(weitWeg);
            liste.length = 0;
            liste.push(...behalten);
        }
        for (const [lat, lon, r] of ROLFZEN_FEST.baeume) {
            const [x, z] = lokal(lat, lon);
            laub.push([x, z, Math.min(26, r / 0.32)]);
        }

        const stammMaterial = new THREE.MeshLambertMaterial({ color: 0x5a4030 });
        const kronenMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const stammGeo = new THREE.CylinderGeometry(0.15, 0.22, 1, 5).translate(0, 0.5, 0);
        const laubGeo = new THREE.IcosahedronGeometry(1, 0);
        const nadelGeo = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);

        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
        const gruenToene = ['#3f6b2d', '#4d7a33', '#5a8a3a', '#466f30', '#628f3e'].map(farbe);

        // Bäume in Blöcken von 256 m, damit nur Blöcke im Blickfeld gezeichnet werden.
        // Jeder Block bekommt eine eigene Hüllkugel, denn three.js kennt sonst nur die Grundform am Ursprung.
        function instanzen(geo, material, punkte, setzen) {
            const bloecke = new Map();
            punkte.forEach((p, i) => {
                const k = Math.floor(p[0] / 256) * 1000 + Math.floor(p[1] / 256);
                if (!bloecke.has(k)) bloecke.set(k, []);
                bloecke.get(k).push(i);
            });
            const mitte = new THREE.Vector3();
            for (const indizes of bloecke.values()) {
                const blockGeo = geo.clone();
                const mesh = new THREE.InstancedMesh(blockGeo, material, indizes.length);
                mitte.set(0, 0, 0);
                indizes.forEach((i, n) => {
                    setzen(punkte[i], i);
                    mesh.setMatrixAt(n, m);
                    mitte.add(v.setFromMatrixPosition(m));
                    if (material === kronenMaterial) mesh.setColorAt(n, auswahl(gruenToene));
                });
                mitte.divideScalar(indizes.length);
                let radius = 0;
                for (let n = 0; n < indizes.length; n++) {
                    mesh.getMatrixAt(n, m);
                    radius = Math.max(radius, mitte.distanceTo(v.setFromMatrixPosition(m)));
                }
                blockGeo.boundingSphere = new THREE.Sphere(mitte.clone(), radius + 15);
                mesh.frustumCulled = true;  // bei InstancedMesh in three.js r149 standardmäßig aus
                mesh.castShadow = !HANDY;
                szene.add(mesh);
            }
        }

        const stammPunkte = laub.concat(nadel);
        const hoehen = stammPunkte.map(p => p[2] || 6 + zufall() * 7);
        instanzen(stammGeo, stammMaterial, stammPunkte, (p, i) => {
            // Stamm etwas in den Boden, damit er am Hang nicht schwebt; große Bäume mit dickerem Stamm
            const dick = Math.max(1, hoehen[i] / 10);
            m.compose(v.set(p[0], hoehe(p[0], p[1]) - 0.3, p[1]), q.identity(), s.set(dick, hoehen[i] * 0.45 + 0.3, dick));
        });
        instanzen(laubGeo, kronenMaterial, laub, (p, i) => {
            const r = hoehen[i] * 0.32;
            m.compose(v.set(p[0], hoehe(p[0], p[1]) + hoehen[i] * 0.62, p[1]), q.identity(), s.set(r, r * 0.9, r));
        });
        instanzen(nadelGeo, kronenMaterial, nadel, (p, i) => {
            const h = hoehen[laub.length + i];
            m.compose(v.set(p[0], hoehe(p[0], p[1]) + h * 0.2, p[1]), q.identity(), s.set(h * 0.22, h, h * 0.22));
        });
        instanzen(laubGeo, kronenMaterial, busch, p => {
            const r = 0.8 + zufall() * 0.9;
            m.compose(v.set(p[0], hoehe(p[0], p[1]) + 0.5, p[1]), q.identity(), s.set(r, r * 0.7, r));
        });
    }

    // ---------- Beschriftungen der Orte ----------

    function beschriftungenBauen() {
        for (const o of D.orte) {
            const leinwand = document.createElement('canvas');
            leinwand.width = 512; leinwand.height = 96;
            const ctx = leinwand.getContext('2d');
            ctx.fillStyle = 'rgba(20, 50, 30, 0.8)';
            ctx.fillRect(0, 0, 512, 96);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 40px Segoe UI, Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(o.n, 256, 50, 490);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(leinwand), fog: false }));
            sprite.position.set(o.p[0], hoehe(o.p[0], o.p[1]) + 14, o.p[1]);
            sprite.scale.set(12, 2.25, 1);
            szene.add(sprite);
        }
    }

    // ---------- Spielfigur (Schütze) ----------

    function figurBauen() {
        const figur = new THREE.Group();
        const mat = c => new THREE.MeshLambertMaterial({ color: c });
        const teil = (geo, material, x, y, z) => {
            const m = new THREE.Mesh(geo, material);
            m.position.set(x, y, z);
            m.castShadow = true;
            return m;
        };
        const jacke = mat(0x2f5a34), hose = mat(0x2b2b33), haut = mat(0xe8bf9a), hut = mat(0x22442a);

        figur.add(teil(new THREE.BoxGeometry(0.5, 0.65, 0.28), jacke, 0, 1.18, 0));
        figur.add(teil(new THREE.SphereGeometry(0.14, 12, 10), haut, 0, 1.65, 0));
        figur.add(teil(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 16), hut, 0, 1.77, 0));
        figur.add(teil(new THREE.CylinderGeometry(0.11, 0.13, 0.13, 12), hut, 0, 1.84, 0));
        figur.add(teil(new THREE.BoxGeometry(0.05, 0.12, 0.03), mat(0xffffff), 0.08, 1.9, 0.02));

        function glied(geo, material, x, y) {
            const gelenk = new THREE.Group();
            gelenk.position.set(x, y, 0);
            gelenk.add(teil(geo, material, 0, -geo.parameters.height / 2, 0));
            figur.add(gelenk);
            return gelenk;
        }
        const beinGeo = new THREE.BoxGeometry(0.18, 0.85, 0.2);
        const armGeo = new THREE.BoxGeometry(0.13, 0.62, 0.15);
        figur.userData.glieder = {
            beinL: glied(beinGeo, hose, -0.12, 0.86),
            beinR: glied(beinGeo, hose, 0.12, 0.86),
            armL: glied(armGeo, jacke, -0.32, 1.48),
            armR: glied(armGeo, jacke, 0.32, 1.48),
        };
        szene.add(figur);
        return figur;
    }

    // ---------- Aufbau ----------

    gelaendeBauen();
    strassenBauen();
    gebaeudeBauen();
    zeltBauen();     // vor den Bäumen, damit keine Bäume im Zelt wachsen
    baeumeBauen();
    beschriftungenBauen();
    const figur = figurBauen();

    // ---------- Startposition ----------

    function freiePosition(x, z) {
        if (punktInPolygon(x, z, D.grenze) && !inGebaeude(x, z)) return [x, z];
        let beste = null;
        for (const s of D.strassen) {
            for (let i = 0; i < s.p.length - 1; i++) {
                const r = naechsterPunktAufStrecke(x, z, s.p[i][0], s.p[i][1], s.p[i + 1][0], s.p[i + 1][1]);
                if (!beste || r.d < beste.d) beste = r;
            }
        }
        return [beste.qx, beste.qz];
    }

    const spieler = {
        x: D.start[0], z: D.start[1], y: 0, vy: 0, amBoden: true, richtung: Math.PI, tempo: 0, schritt: 0,
    };
    const parameter = new URLSearchParams(location.search);
    if (parameter.has('lat') && parameter.has('lon')) {
        const u = D.ursprung;
        const x = (parseFloat(parameter.get('lon')) - u.lon) * u.mProGradLon;
        const z = -(parseFloat(parameter.get('lat')) - u.lat) * u.mProGradLat;
        if (isFinite(x) && isFinite(z)) [spieler.x, spieler.z] = freiePosition(x, z);
    }
    spieler.y = hoehe(spieler.x, spieler.z);

    // ---------- Steuerung ----------

    const tasten = new Set();
    const kam = { gier: 0, neigung: 0.32, abstand: 6 };

    window.addEventListener('keydown', e => {
        // In Auswahlfeldern und auf Knöpfen keine Spieltasten (sonst ändert W die Adresse)
        if (['SELECT', 'INPUT', 'BUTTON'].includes(e.target.tagName)) return;
        tasten.add(e.code);
        if (e.code === 'KeyH') document.getElementById('hilfe').hidden = !document.getElementById('hilfe').hidden;
        const nr = parseInt(e.key, 10);
        if (nr >= 1 && nr <= D.orte.length) zuOrtSpringen(D.orte[nr - 1]);
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => tasten.delete(e.code));
    window.addEventListener('blur', () => tasten.clear());

    // Zeiger an ein Element binden, damit Ziehen auch außerhalb weiterläuft (fehlt bei manchen Geräten)
    function festhalten(element, id) {
        try {
            element.setPointerCapture(id);
        } catch (fehler) {
            // ohne Bindung funktioniert die Steuerung weiterhin, nur nicht über den Rand hinaus
        }
    }

    // Umsehen durch Ziehen mit Maus oder Finger; nur der Finger, der zuerst aufgesetzt wurde, zählt
    let ziehen = null;
    container.addEventListener('pointerdown', e => {
        if (ziehen) return;
        ziehen = { id: e.pointerId, x: e.clientX, y: e.clientY };
        festhalten(container, e.pointerId);
    });
    container.addEventListener('pointermove', e => {
        if (!ziehen || e.pointerId !== ziehen.id) return;
        kam.gier -= (e.clientX - ziehen.x) * 0.005;
        kam.neigung = Math.max(-0.1, Math.min(1.3, kam.neigung + (e.clientY - ziehen.y) * 0.004));
        ziehen.x = e.clientX;
        ziehen.y = e.clientY;
    });
    const ziehenEnde = e => { if (ziehen && e.pointerId === ziehen.id) ziehen = null; };
    container.addEventListener('pointerup', ziehenEnde);
    container.addEventListener('pointercancel', ziehenEnde);

    // Touch-Joystick: x = rechts, y = unten, jeweils -1 … 1
    const stick = { x: 0, y: 0 };
    if (HANDY) touchSteuerungEinrichten();

    function touchSteuerungEinrichten() {
        const hilfe = document.getElementById('hilfe');
        hilfe.hidden = true;
        document.getElementById('hilfe-knopf').addEventListener('click', () => { hilfe.hidden = !hilfe.hidden; });

        const feld = document.getElementById('joystick');
        const knopf = document.getElementById('joystick-knopf');
        let finger = null;
        function setzen(e) {
            const r = feld.getBoundingClientRect();
            const radius = r.width / 2;
            let dx = e.clientX - (r.left + radius), dy = e.clientY - (r.top + radius);
            const l = Math.hypot(dx, dy);
            if (l > radius) { dx *= radius / l; dy *= radius / l; }
            stick.x = dx / radius;
            stick.y = dy / radius;
            knopf.style.transform = `translate(${dx}px, ${dy}px)`;
        }
        feld.addEventListener('pointerdown', e => {
            finger = e.pointerId;
            festhalten(feld, finger);
            setzen(e);
        });
        feld.addEventListener('pointermove', e => { if (e.pointerId === finger) setzen(e); });
        const loslassen = e => {
            if (e.pointerId !== finger) return;
            finger = null;
            stick.x = stick.y = 0;
            knopf.style.transform = '';
        };
        feld.addEventListener('pointerup', loslassen);
        feld.addEventListener('pointercancel', loslassen);

        const sprung = document.getElementById('sprung-knopf');
        sprung.addEventListener('pointerdown', () => tasten.add('Space'));
        for (const ereignis of ['pointerup', 'pointercancel', 'pointerleave']) {
            sprung.addEventListener(ereignis, () => tasten.delete('Space'));
        }
    }
    container.addEventListener('wheel', e => {
        kam.abstand = Math.max(2.5, Math.min(30, kam.abstand * (e.deltaY > 0 ? 1.1 : 0.9)));
        e.preventDefault();
    }, { passive: false });

    const ortsliste = document.getElementById('ortsliste');
    D.orte.forEach(o => {
        const li = document.createElement('li');
        li.textContent = o.n;
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => zuOrtSpringen(o));
        ortsliste.appendChild(li);
    });

    function zuOrtSpringen(o) {
        [spieler.x, spieler.z] = freiePosition(o.p[0], o.p[1]);
        spieler.y = hoehe(spieler.x, spieler.z);
        spieler.vy = 0;
        spieler.amBoden = true;
    }

    // ---------- Bewegung und Kollision ----------

    const RADIUS = 0.35;
    let hinweisZeit = 0;

    function gebaeudeKollision(x, z) {
        for (let runde = 0; runde < 3; runde++) {
            let verschoben = false;
            for (const k of gebaeudeRaster.abfragen(x, z)) {
                const r = naechsterPunktAufStrecke(x, z, k.ax, k.az, k.bx, k.bz);
                if (r.d < RADIUS && r.d > 1e-6) {
                    x = r.qx + (x - r.qx) / r.d * RADIUS;
                    z = r.qz + (z - r.qz) / r.d * RADIUS;
                    verschoben = true;
                }
            }
            if (!verschoben) break;
        }
        return [x, z];
    }

    function bewegen(dt) {
        // Joystick mit kleiner Totzone; voll ausgelenkt wird gerannt
        const stickStaerke = Math.hypot(stick.x, stick.y);
        const stickAktiv = stickStaerke > 0.15;
        const vor = (tasten.has('KeyW') || tasten.has('ArrowUp') ? 1 : 0) - (tasten.has('KeyS') || tasten.has('ArrowDown') ? 1 : 0) +
            (stickAktiv ? -stick.y : 0);
        const seit = (tasten.has('KeyD') || tasten.has('ArrowRight') ? 1 : 0) - (tasten.has('KeyA') || tasten.has('ArrowLeft') ? 1 : 0) +
            (stickAktiv ? stick.x : 0);
        if (tasten.has('KeyQ')) kam.gier += 1.8 * dt;
        if (tasten.has('KeyE')) kam.gier -= 1.8 * dt;

        // Richtung relativ zur Kamera
        const fx = -Math.sin(kam.gier), fz = -Math.cos(kam.gier);
        const rx = Math.cos(kam.gier), rz = -Math.sin(kam.gier);
        let dx = fx * vor + rx * seit, dz = fz * vor + rz * seit;
        const laenge = Math.hypot(dx, dz);
        const rennen = tasten.has('ShiftLeft') || tasten.has('ShiftRight') || stickStaerke > 0.9;
        const zielTempo = laenge > 0.01 ? (rennen ? 6.5 : 2.4) * Math.min(1, laenge) : 0;
        spieler.tempo += (zielTempo - spieler.tempo) * Math.min(1, dt * 8);

        if (laenge > 0.01) {
            dx /= laenge; dz /= laenge;
            const zielRichtung = Math.atan2(dx, dz);
            let diff = zielRichtung - spieler.richtung;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            spieler.richtung += diff * Math.min(1, dt * 12);
        }
        const mx = Math.sin(spieler.richtung) * spieler.tempo * dt;
        const mz = Math.cos(spieler.richtung) * spieler.tempo * dt;

        let [nx, nz] = gebaeudeKollision(spieler.x + mx, spieler.z + mz);
        if (!punktInPolygon(nx, nz, D.grenze)) {
            if (punktInPolygon(nx, spieler.z, D.grenze)) nz = spieler.z;
            else if (punktInPolygon(spieler.x, nz, D.grenze)) nx = spieler.x;
            else { nx = spieler.x; nz = spieler.z; }
            hinweisZeit = 2;
        }
        spieler.x = nx;
        spieler.z = nz;

        // Springen und Schwerkraft
        // Gelände, Springen und Schwerkraft. Am Boden haftet die Figur bergab, statt kurz zu schweben.
        const boden = hoehe(spieler.x, spieler.z);
        if (spieler.amBoden && spieler.y - boden < 0.6) spieler.y = boden;
        spieler.amBoden = spieler.y <= boden + 0.01;
        if (spieler.amBoden) {
            spieler.y = boden;
            spieler.vy = 0;
            if (tasten.has('Space')) {
                spieler.vy = 5;
                spieler.amBoden = false;
            }
        }
        if (!spieler.amBoden) {
            spieler.vy -= 15 * dt;
            spieler.y = Math.max(boden, spieler.y + spieler.vy * dt);
        }

        // Figur und Laufanimation
        figur.position.set(spieler.x, spieler.y, spieler.z);
        figur.rotation.y = spieler.richtung;
        spieler.schritt += spieler.tempo * dt * 2.2;
        const schwung = Math.sin(spieler.schritt) * Math.min(1, spieler.tempo / 2.4) * 0.7;
        const gl = figur.userData.glieder;
        gl.beinL.rotation.x = schwung;
        gl.beinR.rotation.x = -schwung;
        gl.armL.rotation.x = -schwung * 0.8;
        gl.armR.rotation.x = schwung * 0.8;

        const hinweis = document.getElementById('hinweis');
        hinweisZeit = Math.max(0, hinweisZeit - dt);
        hinweis.textContent = 'Ortsgrenze Rolfzen – hier geht es nicht weiter';
        hinweis.classList.toggle('sichtbar', hinweisZeit > 0);
    }

    function kameraNachfuehren() {
        const ziel = new THREE.Vector3(spieler.x, spieler.y + 1.6, spieler.z);
        const c = Math.cos(kam.neigung);
        const kx = ziel.x + Math.sin(kam.gier) * c * kam.abstand;
        const kz = ziel.z + Math.cos(kam.gier) * c * kam.abstand;
        // Kamera nicht in einen Hang hinter der Figur tauchen lassen
        kamera.position.set(kx, Math.max(hoehe(kx, kz) + 0.5, ziel.y + Math.sin(kam.neigung) * kam.abstand), kz);
        kamera.lookAt(ziel);

        sonne.target.position.set(spieler.x, spieler.y, spieler.z);
        sonne.position.copy(sonne.target.position).add(sonnenVersatz);
    }

    // ---------- Minikarte und Ortsname ----------

    const minikarte = document.getElementById('minikarte');
    const mk = minikarte.getContext('2d');
    const MK_MASSSTAB = 1.1;
    const MK_RADIUS = 110 / MK_MASSSTAB + 20;
    const flaechenBox = D.flaechen.map(f => begrenzung(f.p));
    const gebaeudeBox = D.gebaeude.map(g => begrenzung(g.p));
    const strassenBox = D.strassen.map(s => begrenzung(s.p));
    const sichtbar = (b, x, z) => b.maxX > x - MK_RADIUS && b.minX < x + MK_RADIUS && b.maxZ > z - MK_RADIUS && b.minZ < z + MK_RADIUS;

    function pfad(punkte, schliessen) {
        mk.beginPath();
        punkte.forEach(([x, z], i) => i ? mk.lineTo(x, z) : mk.moveTo(x, z));
        if (schliessen) mk.closePath();
    }

    function minikarteZeichnen() {
        const x = spieler.x, z = spieler.z;
        mk.save();
        mk.fillStyle = '#8fa36b';
        mk.fillRect(0, 0, 220, 220);
        mk.translate(110, 110);
        mk.rotate(kam.gier);
        mk.scale(MK_MASSSTAB, MK_MASSSTAB);
        mk.translate(-x, -z);

        pfad(D.grenze, true);
        mk.fillStyle = '#9cc271';
        mk.fill();
        D.flaechen.forEach((f, i) => {
            if (!sichtbar(flaechenBox[i], x, z)) return;
            pfad(f.p, true);
            mk.fillStyle = FLAECHEN_FARBEN[f.t][0];
            mk.fill();
        });
        mk.lineCap = mk.lineJoin = 'round';
        mk.strokeStyle = '#4f8fc0';
        for (const g of D.gewaesser) { mk.lineWidth = g.w + 1; pfad(g.p); mk.stroke(); }
        D.strassen.forEach((s, i) => {
            if (!sichtbar(strassenBox[i], x, z)) return;
            mk.strokeStyle = s.t === 'track' || s.t === 'path' ? '#c9b48a' : '#f4f1ea';
            mk.lineWidth = s.w + 1;
            pfad(s.p);
            mk.stroke();
        });
        mk.fillStyle = '#7d7468';
        D.gebaeude.forEach((g, i) => {
            if (!sichtbar(gebaeudeBox[i], x, z)) return;
            pfad(g.p, true);
            mk.fill();
        });
        pfad(zelt.platz, true);
        mk.fillStyle = '#8a8a86';
        mk.fill();
        for (const ring of hindernisse) {
            pfad(ring, true);
            mk.fillStyle = '#c8102e';
            mk.fill();
        }
        pfad(zelt.ring, true);
        mk.fillStyle = '#fbf6e2';
        mk.fill();
        mk.strokeStyle = '#b8860b';
        mk.lineWidth = 1;
        mk.stroke();
        for (const zeichnen of erweiterungen.minikarte) zeichnen(mk, MK_MASSSTAB);
        mk.strokeStyle = '#1f5130';
        mk.lineWidth = 3 / MK_MASSSTAB;
        mk.setLineDash([8, 5]);
        pfad(D.grenze, true);
        mk.stroke();
        mk.setLineDash([]);
        mk.fillStyle = '#ffd23f';
        for (const o of D.orte) {
            mk.beginPath();
            mk.arc(o.p[0], o.p[1], 4 / MK_MASSSTAB, 0, Math.PI * 2);
            mk.fill();
        }

        // Spielerpfeil
        mk.translate(x, z);
        mk.rotate(-spieler.richtung);
        mk.scale(1 / MK_MASSSTAB, 1 / MK_MASSSTAB);
        mk.beginPath();
        mk.moveTo(0, 9); mk.lineTo(6, -6); mk.lineTo(0, -2); mk.lineTo(-6, -6);
        mk.closePath();
        mk.fillStyle = '#e8312f';
        mk.strokeStyle = '#fff';
        mk.lineWidth = 1.5;
        mk.fill();
        mk.stroke();
        mk.restore();

        // Norden
        const nx = 110 + Math.sin(kam.gier) * 96, nz = 110 - Math.cos(kam.gier) * 96;
        mk.fillStyle = 'rgba(20, 30, 20, 0.85)';
        mk.beginPath();
        mk.arc(nx, nz, 10, 0, Math.PI * 2);
        mk.fill();
        mk.fillStyle = '#fff';
        mk.font = 'bold 12px Segoe UI, Arial';
        mk.textAlign = 'center';
        mk.textBaseline = 'middle';
        mk.fillText('N', nx, nz + 1);
    }

    // Erweiterungen wie der Schützenumzug (js/umzug.js) hängen sich hier ein
    const erweiterungen = { proBild: [], minikarte: [] };

    const ortsname = document.getElementById('ortsname');
    let ortsnameZeit = 0;

    function ortsnameAktualisieren(dt) {
        ortsnameZeit -= dt;
        if (ortsnameZeit > 0) return;
        ortsnameZeit = 0.3;
        const ort = D.orte.find(o => Math.hypot(o.p[0] - spieler.x, o.p[1] - spieler.z) < 25);
        const strasse = naechsteStrasse(spieler.x, spieler.z, 20, true);
        ortsname.textContent = ort ? ort.n : strasse ? strasse.s.n : 'Rolfzen';
    }

    // ---------- Hauptschleife ----------

    const uhr = new THREE.Clock();
    let minikarteZeit = 0;
    function schleife() {
        requestAnimationFrame(schleife);
        const dt = Math.min(uhr.getDelta(), 0.05);
        groesseAnpassen();
        bewegen(dt);
        if (karussell) karussell.rotation.y += dt * 0.7;
        // Werbung auf den Bildschirmen weiterschalten
        werbeZeit += dt;
        if (werbeZeit > ROLFZEN_FEST.innen.werbungWechsel) {
            werbeZeit = 0;
            for (const b of bildschirme) {
                b.index = (b.index + 1) % b.texturen.length;
                b.bild.material.map = b.texturen[b.index];
            }
        }
        for (const aktualisieren of erweiterungen.proBild) aktualisieren(dt);
        kameraNachfuehren();
        // Auf dem Handy nur etwa zehnmal pro Sekunde neu zeichnen
        minikarteZeit -= dt;
        if (minikarteZeit <= 0) {
            minikarteZeichnen();
            minikarteZeit = HANDY ? 0.1 : 0;
        }
        ortsnameAktualisieren(dt);
        renderer.render(szene, kamera);
    }

    groesseAnpassen();
    document.getElementById('laden').remove();
    schleife();

    // Für Tests und Erweiterungen (z. B. Schützenumzug)
    window.rundgang = {
        D, HANDY, zelt, erweiterungen, lokal, naechsterPunktAufStrecke,
        spieler, kam, tasten, stick, szene, kamera, renderer, inGebaeude, zuOrtSpringen, hoehe, schritt: bewegen,
        // Ein einzelnes Bild zeichnen, auch wenn die Animationsschleife gerade pausiert
        bild() {
            kameraNachfuehren();
            minikarteZeichnen();
            renderer.render(szene, kamera);
        },
    };
})();
