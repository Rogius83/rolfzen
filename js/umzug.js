// Schützenumzug: Fahnenträger, Blaskapelle und Schützen treffen sich beim Körter, holen König und
// Königin an ihrer Adresse ab und marschieren zum Schützenzelt. Hängt sich über window.rundgang ein.

(function () {
    'use strict';

    const R = window.rundgang;
    const { D, HANDY, zelt, hoehe, szene } = R;
    const U = ROLFZEN_FEST.umzug;

    // Eigener Zufall, damit Häuser und Bäume im Dorf unverändert bleiben
    let saat = 1907;
    const zufall = () => { saat = (saat * 16807) % 2147483647; return (saat - 1) / 2147483646; };

    const TEMPO = 1.4;        // Marschtempo in m/s
    const SCHRITT = 0.75;     // Schrittlänge in m
    const ZEITRAFFER = 4;

    // ---------- Wegenetz aus den Straßen ----------

    const knoten = new Map();      // Schlüssel -> { x, z, nachbarn: [{ k, d }] }
    const segmente = [];
    const unbefestigt = s => s.t === 'track' || s.t === 'path' || s.t === 'footway' || s.t === 'steps';
    const schluessel = ([x, z]) => x + ',' + z;

    for (const s of D.strassen) {
        const faktor = unbefestigt(s) ? 2.5 : 1;
        for (let i = 0; i < s.p.length - 1; i++) {
            const a = schluessel(s.p[i]), b = schluessel(s.p[i + 1]);
            if (a === b) continue;
            for (const [k, p] of [[a, s.p[i]], [b, s.p[i + 1]]]) {
                if (!knoten.has(k)) knoten.set(k, { x: p[0], z: p[1], nachbarn: [] });
            }
            const d = Math.hypot(s.p[i + 1][0] - s.p[i][0], s.p[i + 1][1] - s.p[i][1]) * faktor;
            knoten.get(a).nachbarn.push({ k: b, d });
            knoten.get(b).nachbarn.push({ k: a, d });
            segmente.push({ a, b, ax: s.p[i][0], az: s.p[i][1], bx: s.p[i + 1][0], bz: s.p[i + 1][1], s, faktor });
        }
    }

    // Punkt auf das nächste Straßenstück setzen; mit Straßenname bevorzugt auf diese Straße (bis 40 m)
    function andocken(x, z, strassenName) {
        let beste = null;
        for (const seg of segmente) {
            if (strassenName && seg.s.n !== strassenName) continue;
            const r = R.naechsterPunktAufStrecke(x, z, seg.ax, seg.az, seg.bx, seg.bz);
            if (!beste || r.d < beste.d) beste = { ...r, seg };
        }
        if (strassenName && (!beste || beste.d > 40)) return andocken(x, z, null);
        const { seg } = beste;
        return {
            x: beste.qx, z: beste.qz, seg,
            da: Math.hypot(beste.qx - seg.ax, beste.qz - seg.az) * seg.faktor,
            db: Math.hypot(beste.qx - seg.bx, beste.qz - seg.bz) * seg.faktor,
        };
    }

    // Kürzester Weg (Dijkstra) zwischen zwei angedockten Punkten; liefert die Punktfolge
    function wegSuchen(start, ziel) {
        const extra = new Map();
        const verbinden = (k1, k2, d) => {
            if (!extra.has(k1)) extra.set(k1, []);
            extra.get(k1).push({ k: k2, d });
        };
        const virtuell = { S: start, Z: ziel };
        for (const [name, p] of Object.entries(virtuell)) {
            verbinden(name, p.seg.a, p.da); verbinden(p.seg.a, name, p.da);
            verbinden(name, p.seg.b, p.db); verbinden(p.seg.b, name, p.db);
        }
        if (start.seg === ziel.seg) {
            const d = Math.hypot(start.x - ziel.x, start.z - ziel.z) * start.seg.faktor;
            verbinden('S', 'Z', d); verbinden('Z', 'S', d);
        }
        const nachbarn = k => (knoten.has(k) ? knoten.get(k).nachbarn : []).concat(extra.get(k) || []);
        const ort = k => virtuell[k] || knoten.get(k);

        const abstand = new Map([['S', 0]]), vorher = new Map();
        const haufen = [[0, 'S']];
        const hinein = e => {
            haufen.push(e);
            let i = haufen.length - 1;
            while (i > 0) {
                const j = (i - 1) >> 1;
                if (haufen[j][0] <= haufen[i][0]) break;
                [haufen[i], haufen[j]] = [haufen[j], haufen[i]];
                i = j;
            }
        };
        const heraus = () => {
            const oben = haufen[0], letzter = haufen.pop();
            if (haufen.length) {
                haufen[0] = letzter;
                let i = 0;
                for (;;) {
                    const l = 2 * i + 1, r = l + 1;
                    let m = i;
                    if (l < haufen.length && haufen[l][0] < haufen[m][0]) m = l;
                    if (r < haufen.length && haufen[r][0] < haufen[m][0]) m = r;
                    if (m === i) break;
                    [haufen[i], haufen[m]] = [haufen[m], haufen[i]];
                    i = m;
                }
            }
            return oben;
        };
        while (haufen.length) {
            const [d, k] = heraus();
            if (k === 'Z') break;
            if (d > abstand.get(k)) continue;
            for (const n of nachbarn(k)) {
                const nd = d + n.d;
                if (!abstand.has(n.k) || nd < abstand.get(n.k)) {
                    abstand.set(n.k, nd);
                    vorher.set(n.k, k);
                    hinein([nd, n.k]);
                }
            }
        }
        if (!abstand.has('Z')) return null;
        const punkte = [];
        for (let k = 'Z'; k !== undefined; k = vorher.get(k)) {
            const o = ort(k);
            punkte.unshift([o.x, o.z]);
        }
        return punkte;
    }

    // Linie mit Bogenlänge: Punkt und geglättete Richtung bei Strecke s (auch vor dem Anfang)
    class Pfad {
        constructor(punkte) {
            this.p = [];
            for (const q of punkte) {
                const l = this.p[this.p.length - 1];
                if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 0.01) this.p.push(q);
            }
            if (this.p.length < 2) this.p.push([this.p[0][0] + 0.5, this.p[0][1]]);
            this.s = [0];
            for (let i = 1; i < this.p.length; i++) {
                this.s.push(this.s[i - 1] + Math.hypot(this.p[i][0] - this.p[i - 1][0], this.p[i][1] - this.p[i - 1][1]));
            }
            this.gesamt = this.s[this.s.length - 1];
        }
        punkt(s) {
            const p = this.p, n = p.length;
            let i;
            if (s <= 0) i = 0;
            else if (s >= this.gesamt) i = n - 2;
            else {
                let lo = 0, hi = n - 1;
                while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] <= s) lo = m; else hi = m; }
                i = lo;
            }
            const l = this.s[i + 1] - this.s[i];
            const t = (s - this.s[i]) / l;
            return [p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t];
        }
        richtung(s) {
            const a = this.punkt(s - 2.5), b = this.punkt(s + 2.5);
            const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (l > 1e-6) return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
            return [1, 0];
        }
    }

    // ---------- Orte ----------

    const koerter = D.orte.find(o => o.n.includes('Körter')).p;
    const koerterAndock = andocken(koerter[0], koerter[1], null);
    const zeltAndock = andocken(zelt.eingang[0], zelt.eingang[1], null);
    // Treffpunkt vor dem Zelt: 3 m außerhalb des Eingangs
    const zeltVorplatz = [zelt.eingang[0] + zelt.ux * 3, zelt.eingang[1] + zelt.uz * 3];

    const adressen = D.adressen.map(a => ({ ...a, name: `${a.s} ${a.h}` }));

    // Stelle vor der Haustür: vom Gebäude Richtung Straße, außerhalb des Gebäudes
    function koenigsHaus(adresse) {
        const strasse = andocken(adresse.p[0], adresse.p[1], adresse.s);
        let dx = adresse.p[0] - strasse.x, dz = adresse.p[1] - strasse.z;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        const breite = strasse.seg.s.w / 2 + 1.5;
        let d = Math.min(breite, Math.max(0, l - 2));
        let tuer = [strasse.x + dx * d, strasse.z + dz * d];
        while (d > 0 && R.inGebaeude(tuer[0], tuer[1])) {
            d -= 0.5;
            tuer = [strasse.x + dx * d, strasse.z + dz * d];
        }
        return { strasse, tuer, blick: Math.atan2(-dx, -dz), quer: [-dz, dx] };
    }

    // null, wenn die Adresse innerhalb der Ortsgrenze nicht über Straßen erreichbar ist
    // (einzelne Höfe, deren Zufahrt außerhalb von Rolfzen verläuft)
    function routePlanen(adresse) {
        const haus = koenigsHaus(adresse);
        const weg1 = wegSuchen(koerterAndock, haus.strasse);
        const weg2 = weg1 && wegSuchen(haus.strasse, zeltAndock);
        if (!weg1 || !weg2) return null;
        const pfad = new Pfad(weg1.concat(weg2.slice(1), [zeltVorplatz]));
        const sKoenig = new Pfad(weg1).gesamt;
        return { haus, pfad, sKoenig: Math.min(sKoenig, pfad.gesamt) };
    }

    // ---------- Teilnehmer und Formation ----------

    const personen = [{ rolle: 'koenig' }, { rolle: 'koenigin' }];
    personen.push({ rolle: 'fahne', ab: 0, q: -0.9, fahne: '#1f6b34' }, { rolle: 'fahne', ab: 0, q: 0.9, fahne: '#f2f2f2' });
    const kapelle = [['trommel_klein', 'trommel_gross', 'trommel_klein'], ['trompete', 'trompete', 'trompete'],
        ['horn', 'horn', 'horn'], ['tuba', 'tuba', 'tuba']];
    const SPALTEN = [-1.2, 0, 1.2];
    kapelle.forEach((reihe, r) => reihe.forEach((rolle, c) => personen.push({ rolle, ab: 2.2 + r * 1.6, q: SPALTEN[c] })));
    const AB_KOENIG = 2.2 + 3 * 1.6 + 2.6;
    personen[0].ab = AB_KOENIG; personen[0].q = -0.8;
    personen[1].ab = AB_KOENIG; personen[1].q = 0.8;
    const schuetzenReihen = U.schuetzen / U.reihenBreite;
    for (let r = 0; r < schuetzenReihen; r++) {
        for (let c = 0; c < U.reihenBreite; c++) {
            personen.push({ rolle: 'schuetze', ab: AB_KOENIG + 2.6 + r * 1.6, q: SPALTEN[c] });
        }
    }
    for (const p of personen) Object.assign(p, { x: 0, z: 0, richtung: 0, geht: false, phase: zufall() * 6 });
    const koenigspaar = personen.slice(0, 2);
    const MUSIKER = new Set(['trommel_klein', 'trommel_gross', 'trompete', 'horn', 'tuba']);

    // ---------- Figuren als Instanzen je Körperteil ----------

    const JACKE = { schuetze: '#2f5a34', fahne: '#2f5a34', koenig: '#2f5a34', koenigin: '#8b1e3f' };
    const jacke = p => JACKE[p.rolle] || '#24365e';            // Kapelle in Dunkelblau
    const hut = p => MUSIKER.has(p.rolle) ? '#1b2742' : '#22442a';
    const GOLD = '#d4af37';

    const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
    const zyl = (r1, r2, h, n) => new THREE.CylinderGeometry(r1, r2, h, n);
    const alle = () => true;
    const ausser = (...rollen) => p => !rollen.includes(p.rolle);
    const nur = (...rollen) => p => rollen.includes(p.rolle);

    // Winkel der Glieder; Gehen schwingt Beine und freie Arme im Gleichschritt
    const schwung = p => p.geht ? Math.sin(p.phase) * 0.55 : 0;
    const armWinkel = (p, seite) => {
        if (MUSIKER.has(p.rolle)) return p.rolle === 'tuba' ? -0.9 : -1.1;
        if (seite > 0 && p.rolle === 'fahne') return -0.5;
        if (seite > 0 && p.rolle === 'schuetze') return -0.6;
        return -schwung(p) * seite * (p.rolle === 'koenigin' ? 0.3 : 0.7);
    };

    const TEILE = [
        { geo: box(0.5, 0.65, 0.28), pos: [0, 1.18, 0], fuer: alle, farbe: jacke },
        { geo: new THREE.SphereGeometry(0.14, 10, 8), pos: [0, 1.65, 0], fuer: alle, farbe: () => '#e8bf9a' },
        { geo: zyl(0.2, 0.2, 0.03, 14), pos: [0, 1.77, 0], fuer: ausser('koenigin'), farbe: hut },
        { geo: zyl(0.11, 0.13, 0.13, 12), pos: [0, 1.84, 0], fuer: ausser('koenigin'), farbe: hut },
        { geo: new THREE.ConeGeometry(0.05, 0.3, 6), pos: [0.08, 2.0, 0], fuer: nur('koenig'), farbe: () => '#ffffff' },
        { geo: box(0.18, 0.85, 0.2).translate(0, -0.425, 0), pos: [-0.12, 0.86, 0], winkel: p => schwung(p), fuer: alle, farbe: () => '#2b2b33' },
        { geo: box(0.18, 0.85, 0.2).translate(0, -0.425, 0), pos: [0.12, 0.86, 0], winkel: p => -schwung(p), fuer: alle, farbe: () => '#2b2b33' },
        { geo: box(0.13, 0.62, 0.15).translate(0, -0.31, 0), pos: [-0.32, 1.48, 0], winkel: p => armWinkel(p, -1), fuer: alle, farbe: jacke },
        { geo: box(0.13, 0.62, 0.15).translate(0, -0.31, 0), pos: [0.32, 1.48, 0], winkel: p => armWinkel(p, 1), fuer: alle, farbe: jacke },
        { geo: zyl(0.16, 0.46, 0.95, 14).translate(0, 0.475, 0), pos: [0, 0, 0], fuer: nur('koenigin'), farbe: () => '#8b1e3f' },
        { geo: new THREE.TorusGeometry(0.09, 0.025, 6, 14), pos: [0, 1.79, 0], rot: [Math.PI / 2, 0, 0], fuer: nur('koenigin'), farbe: () => GOLD },
        { geo: new THREE.TorusGeometry(0.15, 0.02, 6, 16), pos: [0, 1.36, 0.15], rot: [-0.25, 0, 0], skala: [1, 1.3, 1], fuer: nur('koenig'), farbe: () => '#dcdcdc' },
        { geo: zyl(0.025, 0.025, 3.2, 6).translate(0, 1.6, 0), pos: [0.38, 0.4, 0.2], fuer: nur('fahne'), farbe: () => GOLD },
        { geo: box(0.03, 0.8, 1.2), pos: [0.38, 3.1, -0.42], fuer: nur('fahne'), farbe: p => p.fahne },
        { geo: zyl(0.18, 0.18, 0.16, 14), pos: [0.12, 0.95, 0.25], fuer: nur('trommel_klein'), farbe: () => '#e9e4d8' },
        { geo: zyl(0.38, 0.38, 0.32, 18), pos: [0, 1.15, 0.38], rot: [0, 0, Math.PI / 2], fuer: nur('trommel_gross'), farbe: () => '#e9e4d8' },
        { geo: new THREE.ConeGeometry(0.08, 0.45, 10), pos: [0, 1.6, 0.42], rot: [-Math.PI / 2, 0, 0], fuer: nur('trompete'), farbe: () => GOLD },
        { geo: new THREE.ConeGeometry(0.12, 0.6, 10), pos: [0, 1.55, 0.45], rot: [-Math.PI / 2, 0, 0], fuer: nur('horn'), farbe: () => GOLD },
        { geo: zyl(0.3, 0.1, 0.85, 12), pos: [0.05, 1.45, 0.28], fuer: nur('tuba'), farbe: () => GOLD },
        { geo: box(0.05, 0.06, 1.15), pos: [0.26, 1.55, -0.05], rot: [-0.9, 0, 0], fuer: nur('schuetze'), farbe: () => '#3b2a1e' },
    ];

    const m = new THREE.Matrix4(), mp = new THREE.Matrix4(), ml = new THREE.Matrix4();
    const v = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), s1 = new THREE.Vector3(1, 1, 1);
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff });

    for (const teil of TEILE) {
        teil.personen = personen.filter(teil.fuer);
        teil.mesh = new THREE.InstancedMesh(teil.geo, material, teil.personen.length);
        teil.mesh.frustumCulled = false;  // der Umzug bewegt sich durchs ganze Dorf
        teil.mesh.castShadow = !HANDY;
        teil.personen.forEach((p, i) => teil.mesh.setColorAt(i, new THREE.Color(teil.farbe(p))));
        // König und Königin stehen vorn in der Liste und bleiben auch ohne Umzug sichtbar
        teil.anzahlPaar = teil.personen.filter(p => koenigspaar.includes(p)).length;
        szene.add(teil.mesh);
    }

    function figurenZeichnen(alleSichtbar) {
        const zeilen = new Map();
        for (const p of personen) {
            mp.compose(v.set(p.x, hoehe(p.x, p.z), p.z), q.setFromEuler(e.set(0, p.richtung, 0)), s1);
            zeilen.set(p, mp.clone());
        }
        for (const teil of TEILE) {
            teil.mesh.count = alleSichtbar ? teil.personen.length : teil.anzahlPaar;
            for (let i = 0; i < teil.mesh.count; i++) {
                const p = teil.personen[i];
                const rot = teil.rot || [0, 0, 0];
                e.set(rot[0] + (teil.winkel ? teil.winkel(p) : 0), rot[1], rot[2]);
                ml.compose(v.set(...teil.pos), q.setFromEuler(e), teil.skala ? v.clone().set(...teil.skala) : s1);
                m.multiplyMatrices(zeilen.get(p), ml);
                teil.mesh.setMatrixAt(i, m);
            }
            teil.mesh.instanceMatrix.needsUpdate = true;
        }
    }

    // Schild über dem König
    const schild = (() => {
        const leinwand = document.createElement('canvas');
        leinwand.width = 512; leinwand.height = 96;
        const ctx = leinwand.getContext('2d');
        ctx.fillStyle = 'rgba(120, 90, 10, 0.85)';
        ctx.fillRect(0, 0, 512, 96);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 40px Segoe UI, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Schützenkönigspaar', 256, 50, 490);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(leinwand) }));
        sprite.scale.set(6, 1.1, 1);
        szene.add(sprite);
        return sprite;
    })();

    // ---------- Ablauf ----------

    const zustand = {
        phase: 'aus', zeit: 0, sKopf: 0, route: null, adresse: null, schrittPhase: 0,
        zeitraffer: false, musik: true,
    };
    const STATUS = {
        aus: 'Bereit', treffen: 'Treffen beim Körter', antreten: 'Antreten', marsch1: 'Marsch zum Schützenkönig',
        abholen: 'Königspaar wird abgeholt', marsch2: 'Marsch zum Schützenplatz', angekommen: 'Am Schützenzelt angekommen',
    };

    function koenigspaarAnDieTuer() {
        const { tuer, blick, quer } = zustand.haus;
        koenigspaar.forEach((p, i) => {
            const seite = i === 0 ? -0.5 : 0.5;
            p.x = tuer[0] + quer[0] * seite;
            p.z = tuer[1] + quer[1] * seite;
            p.richtung = blick;
            p.geht = false;
        });
    }

    function adresseWaehlen(adresse) {
        zustand.adresse = adresse;
        zustand.haus = koenigsHaus(adresse);
        koenigspaarAnDieTuer();
    }

    function slot(p, sKopf) {
        const pfad = zustand.route.pfad;
        const s = sKopf - p.ab;
        const [x, z] = pfad.punkt(s);
        const [dx, dz] = pfad.richtung(s);
        return { x: x - dz * p.q, z: z + dx * p.q, richtung: Math.atan2(dx, dz) };
    }

    // Person ein Stück auf ein Ziel zugehen lassen; true, wenn angekommen
    function hingehen(p, ziel, weg) {
        const dx = ziel.x - p.x, dz = ziel.z - p.z, d = Math.hypot(dx, dz);
        if (d <= weg) {
            p.x = ziel.x; p.z = ziel.z;
            p.richtung = ziel.richtung;
            p.geht = false;
            return true;
        }
        p.x += dx / d * weg; p.z += dz / d * weg;
        p.richtung = Math.atan2(dx, dz);
        p.geht = true;
        return false;
    }

    function starten() {
        const route = routePlanen(zustand.adresse);
        if (!route) {
            statusSetzen('Kein Weg zu dieser Adresse gefunden');
            return false;
        }
        zustand.route = route;
        zustand.sKopf = 0;
        zustand.zeit = 0;
        zustand.phase = 'treffen';
        // Lose Gruppe rund um den Körter
        const mitte = [koerterAndock.x, koerterAndock.z];
        for (const p of personen) {
            if (koenigspaar.includes(p)) continue;
            let x = mitte[0], z = mitte[1];
            for (let versuch = 0; versuch < 20; versuch++) {
                const w = zufall() * Math.PI * 2, r = 3 + zufall() * 10;
                const cx = mitte[0] + Math.cos(w) * r, cz = mitte[1] + Math.sin(w) * r;
                if (!R.inGebaeude(cx, cz)) { x = cx; z = cz; break; }
            }
            Object.assign(p, { x, z, richtung: zufall() * Math.PI * 2, geht: false });
        }
        musikStarten();
        return true;
    }

    function stoppen() {
        zustand.phase = 'aus';
        zustand.route = null;
        koenigspaarAnDieTuer();
        musikStoppen();
    }

    function aktualisieren(dtEcht) {
        const dt = dtEcht * (zustand.zeitraffer ? ZEITRAFFER : 1);
        const route = zustand.route;
        zustand.zeit += dt;

        if (zustand.phase === 'treffen') {
            if (zustand.zeit > 8) { zustand.phase = 'antreten'; zustand.zeit = 0; }
        } else if (zustand.phase === 'antreten') {
            let alleDa = true;
            for (const p of personen) {
                if (koenigspaar.includes(p)) continue;
                if (!hingehen(p, slot(p, 0), TEMPO * 1.2 * dt)) alleDa = false;
            }
            if (alleDa) {
                zustand.wartet = (zustand.wartet || 0) + dt;
                if (zustand.wartet > 1.5) { zustand.phase = 'marsch1'; zustand.zeit = 0; zustand.wartet = 0; }
            }
        } else if (zustand.phase === 'marsch1' || zustand.phase === 'marsch2') {
            const ende = zustand.phase === 'marsch1' ? route.sKoenig + AB_KOENIG : route.pfad.gesamt;
            zustand.sKopf = Math.min(ende, zustand.sKopf + TEMPO * dt);
            if (zustand.sKopf >= ende) {
                zustand.phase = zustand.phase === 'marsch1' ? 'abholen' : 'angekommen';
                zustand.zeit = 0;
            }
        } else if (zustand.phase === 'abholen') {
            let beideDa = true;
            for (const p of koenigspaar) {
                if (!hingehen(p, slot(p, zustand.sKopf), 1.2 * dt)) beideDa = false;
            }
            if (beideDa) {
                zustand.wartet = (zustand.wartet || 0) + dt;
                if (zustand.wartet > 3) { zustand.phase = 'marsch2'; zustand.zeit = 0; zustand.wartet = 0; }
            }
        }

        // Formation entlang des Weges
        const marschiert = zustand.phase === 'marsch1' || zustand.phase === 'marsch2';
        if (['marsch1', 'abholen', 'marsch2', 'angekommen'].includes(zustand.phase)) {
            for (const p of personen) {
                const abgeholt = !koenigspaar.includes(p) || zustand.phase === 'marsch2' || zustand.phase === 'angekommen';
                if (!abgeholt) continue;
                Object.assign(p, slot(p, zustand.sKopf), { geht: marschiert });
            }
        }
        // Gleichschritt: alle Marschierer in derselben Phase
        zustand.schrittPhase += dt * TEMPO / (2 * SCHRITT) * Math.PI * 2;
        for (const p of personen) {
            if (marschiert && p.geht) p.phase = zustand.schrittPhase;
            else if (p.geht) p.phase += dt * 5;
        }

        figurenZeichnen(zustand.phase !== 'aus');
        const k = koenigspaar[0];
        schild.position.set((k.x + koenigspaar[1].x) / 2, hoehe(k.x, k.z) + 3.2, (k.z + koenigspaar[1].z) / 2);
        statusSetzen(STATUS[zustand.phase]);
        musikLautstaerke();
    }

    // ---------- Blasmusik (im Browser erzeugt) ----------

    const musik = { ctx: null, haupt: null, timer: null, naechste: 0, takt: 0 };
    const BPM = 112;
    const AKKORDE = [[48, 52, 55], [43, 47, 50], [48, 52, 55], [43, 47, 50], [48, 52, 55], [41, 45, 48], [43, 47, 50], [48, 52, 55]];
    const MELODIE = [
        [67, 64, 67, 72], [71, 67, 74, 71], [72, 67, 64, 67], [62, 67, 71, 67],
        [64, 67, 72, 76], [77, 72, 69, 72], [74, 71, 67, 71], [72, 72, 67, 60],
    ];
    const hz = n => 440 * Math.pow(2, (n - 69) / 12);

    function ton(art, frequenz, zeit, dauer, lautstaerke) {
        const c = musik.ctx;
        const o = c.createOscillator(), g = c.createGain();
        o.type = art;
        o.frequency.setValueAtTime(frequenz, zeit);
        g.gain.setValueAtTime(0, zeit);
        g.gain.linearRampToValueAtTime(lautstaerke, zeit + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, zeit + dauer);
        let ziel = g;
        if (art === 'sawtooth') {
            const f = c.createBiquadFilter();
            f.type = 'lowpass';
            f.frequency.value = 1600;
            o.connect(f); f.connect(g);
        } else {
            o.connect(g);
        }
        ziel.connect(musik.haupt);
        o.start(zeit);
        o.stop(zeit + dauer + 0.05);
    }

    function trommel(gross, zeit) {
        const c = musik.ctx;
        if (gross) {
            const o = c.createOscillator(), g = c.createGain();
            o.frequency.setValueAtTime(110, zeit);
            o.frequency.exponentialRampToValueAtTime(45, zeit + 0.25);
            g.gain.setValueAtTime(0.9, zeit);
            g.gain.exponentialRampToValueAtTime(0.001, zeit + 0.3);
            o.connect(g); g.connect(musik.haupt);
            o.start(zeit); o.stop(zeit + 0.35);
        } else {
            const puffer = c.createBuffer(1, c.sampleRate * 0.15, c.sampleRate);
            const daten = puffer.getChannelData(0);
            for (let i = 0; i < daten.length; i++) daten[i] = (Math.random() * 2 - 1) * (1 - i / daten.length);
            const quelle = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
            quelle.buffer = puffer;
            f.type = 'highpass'; f.frequency.value = 1200;
            g.gain.value = 0.35;
            quelle.connect(f); f.connect(g); g.connect(musik.haupt);
            quelle.start(zeit);
        }
    }

    // Takt für Takt im Voraus planen: Tuba auf 1 und 3, Begleitung auf 2 und 4, Melodie in Vierteln
    function planen() {
        const viertel = 60 / BPM;
        while (musik.naechste < musik.ctx.currentTime + 0.3) {
            const t = musik.naechste, nr = musik.takt % 8;
            const akkord = AKKORDE[nr];
            for (let schlag = 0; schlag < 4; schlag++) {
                const z = t + schlag * viertel;
                if (schlag % 2 === 0) {
                    ton('triangle', hz(akkord[0] - 12 + (schlag === 2 ? 7 : 0)), z, viertel * 0.8, 0.5);
                    trommel(true, z);
                } else {
                    for (const n of akkord) ton('square', hz(n + 12), z, viertel * 0.4, 0.05);
                    trommel(false, z);
                }
                ton('sawtooth', hz(MELODIE[nr][schlag]), z, viertel * 0.9, 0.16);
            }
            musik.naechste += 4 * viertel;
            musik.takt++;
        }
    }

    // Muss direkt im Klick erfolgen, sonst spielt iOS nichts
    function musikStarten() {
        if (!zustand.musik) return;
        try {
            if (!musik.ctx) {
                musik.ctx = new (window.AudioContext || window.webkitAudioContext)();
                musik.haupt = musik.ctx.createGain();
                musik.haupt.connect(musik.ctx.destination);
            }
            musik.ctx.resume();
            musik.haupt.gain.value = 0;
            musik.naechste = musik.ctx.currentTime + 0.1;
            musik.takt = 0;
            clearInterval(musik.timer);
            musik.timer = setInterval(() => { try { planen(); } catch (fehler) { musikStoppen(); } }, 50);
        } catch (fehler) {
            musik.ctx = null;
        }
    }

    function musikStoppen() {
        clearInterval(musik.timer);
        musik.timer = null;
        if (musik.haupt) musik.haupt.gain.value = 0;
    }

    // Lautstärke nach Entfernung zur Kapelle; gespielt wird beim Marschieren und beim Abholen
    function musikLautstaerke() {
        if (!musik.haupt || !musik.timer) return;
        const spielt = ['marsch1', 'abholen', 'marsch2'].includes(zustand.phase) && zustand.musik;
        const kapellmeister = personen[5];
        const d = Math.hypot(kapellmeister.x - R.spieler.x, kapellmeister.z - R.spieler.z);
        const ziel = spielt ? 0.35 * Math.max(0, 1 - d / 300) : 0;
        musik.haupt.gain.setTargetAtTime(ziel, musik.ctx.currentTime, 0.3);
    }

    // ---------- Bedienfeld ----------

    const auswahl = document.getElementById('koenig-adresse');
    const knopf = document.getElementById('umzug-knopf');
    const hinKnopf = document.getElementById('umzug-hin');
    const statusFeld = document.getElementById('umzug-status');
    const fest = document.getElementById('fest');

    function statusSetzen(text) {
        if (statusFeld.textContent !== text) statusFeld.textContent = text;
    }

    let gruppe = null;
    adressen.forEach((a, i) => {
        if (!gruppe || gruppe.label !== a.s) {
            gruppe = document.createElement('optgroup');
            gruppe.label = a.s;
            auswahl.appendChild(gruppe);
        }
        const option = document.createElement('option');
        option.value = i;
        option.textContent = a.name;
        if (!routePlanen(a)) {
            option.disabled = true;
            option.textContent += ' (kein Weg in Rolfzen)';
        }
        gruppe.appendChild(option);
    });
    const standard = Math.max(0, adressen.findIndex(a => a.name === U.koenigStandard));
    auswahl.value = standard;
    adresseWaehlen(adressen[standard]);

    auswahl.addEventListener('change', () => {
        adresseWaehlen(adressen[auswahl.value]);
        auswahl.blur();
    });

    knopf.addEventListener('click', () => {
        if (zustand.phase === 'aus') {
            if (starten()) {
                knopf.textContent = 'Umzug stoppen';
                auswahl.disabled = true;
            }
        } else {
            stoppen();
            knopf.textContent = 'Umzug starten';
            auswahl.disabled = false;
        }
        knopf.blur();
    });

    hinKnopf.addEventListener('click', () => {
        const ziel = zustand.phase === 'aus' ? koenigspaar[0] : personen[2];
        // Seitlich neben den Umzug stellen und zu ihm schauen
        const w = ziel.richtung + Math.PI / 2;
        R.zuOrtSpringen({ p: [ziel.x + Math.sin(w) * 8, ziel.z + Math.cos(w) * 8] });
        R.kam.gier = w;
        hinKnopf.blur();
    });

    document.getElementById('zeitraffer').addEventListener('change', e => {
        zustand.zeitraffer = e.target.checked;
        e.target.blur();
    });
    document.getElementById('musik').addEventListener('change', e => {
        zustand.musik = e.target.checked;
        if (zustand.musik && zustand.phase !== 'aus') musikStarten();
        if (!zustand.musik) musikStoppen();
        e.target.blur();
    });

    // Handy: Festfeld über einen Knopf ein- und ausblenden, nicht gleichzeitig mit der Hilfe
    if (HANDY) {
        fest.hidden = true;
        document.getElementById('fest-knopf').addEventListener('click', () => {
            fest.hidden = !fest.hidden;
            if (!fest.hidden) document.getElementById('hilfe').hidden = true;
        });
        document.getElementById('hilfe-knopf').addEventListener('click', () => {
            if (!document.getElementById('hilfe').hidden) fest.hidden = true;
        });
    }

    // ---------- Einhängen in den Rundgang ----------

    R.erweiterungen.proBild.push(aktualisieren);
    R.erweiterungen.minikarte.push((ctx, massstab) => {
        const sichtbar = zustand.phase === 'aus' ? koenigspaar : personen;
        for (const p of sichtbar) {
            ctx.fillStyle = koenigspaar.includes(p) ? GOLD : MUSIKER.has(p.rolle) ? '#24365e' : p.rolle === 'fahne' ? '#ffffff' : '#2f5a34';
            ctx.beginPath();
            ctx.arc(p.x, p.z, 2.2 / massstab, 0, Math.PI * 2);
            ctx.fill();
        }
    });
    figurenZeichnen(false);

    // Für Tests
    window.umzug = { zustand, personen, adressen, routePlanen, starten, stoppen, aktualisieren, adresseWaehlen, wegSuchen };
})();
