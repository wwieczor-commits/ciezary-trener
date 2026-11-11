// Testy jednostkowe obliczeń v2.2 (model obciążeń, strefy, zmęczenie, wpływ ciężaru). © Wojciech Wieczorek
// Uruchom:  node --test tests/test_biomech.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { lumbarAt, LUMBAR, G, shearZone, compZone, kneeZone, bodyMass, fatigueStatus, annotateSet, lighterBaseline, loadEffect, confidenceOf, trunkOf, gripStatus, repBio, SOURCES } from '../js/biomech.js';
import { buildSetData, bioCtx, applyBio, summarize } from '../js/engine.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b} ± ${tol}`);

test('L4/L5: tułów pionowo, gryf nad L4/L5 → brak momentu, ściskanie = ciężar, brak ścinania', () => {
  // 1 px = 1 cm; biodro (0,100), bark (0,50) – tułów pionowo; gryf dokładnie nad L4/L5
  const L = lumbarAt({ bx: 0, shx: 0, shy: 50, hipx: 0, hipy: 100, f: 1, torso: 0 }, 1, 100, 80);
  near(L.moment, 0, 1e-9, 'moment');
  near(L.comp, (100 + .55 * 80) * G, 1e-6, 'ściskanie');
  near(L.shear, 0, 1e-9, 'ścinanie');
});

test('L4/L5: tułów poziomo (90°), znane ramiona – wynik zgodny z ręcznym rachunkiem (Cholewicki 1991)', () => {
  // biodro (0,0), bark (50,0): L4/L5 w x = 6 cm, środek masy górnej części ciała w x = 6 + 0,55·44 = 30,2 cm
  const L = lumbarAt({ bx: 50, shx: 50, shy: 0, hipx: 0, hipy: 0, f: 1, torso: 90 }, 1, 100, 80);
  const Wb = 100 * G, Wu = .55 * 80 * G;
  const M = Wb * .44 + Wu * .242;                        // 431,6 + 104,5 = 536,1 N·m
  near(L.moment, M, 1e-6, 'moment');
  near(L.moment, 536.1, .5, 'moment liczbowo');
  const Fm = M / .06;                                     // ok. 8935 N siły prostowników
  near(L.comp, Fm * Math.cos(5 * Math.PI / 180), 1e-6, 'ściskanie (cos 90° = 0)');
  near(L.comp, 8901, 2, 'ściskanie liczbowo');
  near(L.shear, Math.abs((Wb + Wu) * 1 - Fm * Math.sin(5 * Math.PI / 180)), 1e-6, 'ścinanie');
  near(L.shear, 634, 2, 'ścinanie liczbowo');
});

test('L4/L5: odwrócony kierunek patrzenia (f = −1) daje ten sam wynik', () => {
  const a = lumbarAt({ bx: 50, shx: 50, shy: 0, hipx: 0, hipy: 0, f: 1, torso: 90 }, 1, 100, 80);
  const b = lumbarAt({ bx: -50, shx: -50, shy: 0, hipx: 0, hipy: 0, f: -1, torso: 90 }, 1, 100, 80);
  near(a.moment, b.moment, 1e-9); near(a.shear, b.shear, 1e-9); near(a.comp, b.comp, 1e-9);
});

test('L4/L5: skala px/cm – 2 px/cm daje to samo co 1 px/cm przy podwojonych współrzędnych', () => {
  const a = lumbarAt({ bx: 30, shx: 35, shy: 60, hipx: 0, hipy: 100, f: 1, torso: 41.2 }, 1, 120, 90);
  const b = lumbarAt({ bx: 60, shx: 70, shy: 120, hipx: 0, hipy: 200, f: 1, torso: 41.2 }, 2, 120, 90);
  near(a.moment, b.moment, 1e-9); near(a.comp, b.comp, 1e-9);
});

test('L4/L5: większy ciężar i dalszy gryf zwiększają moment i ściskanie', () => {
  const p = { bx: 40, shx: 40, shy: 60, hipx: 0, hipy: 100, f: 1, torso: 45 };
  const a = lumbarAt(p, 1, 100, 80), b = lumbarAt(p, 1, 140, 80), c = lumbarAt({ ...p, bx: 55 }, 1, 100, 80);
  assert.ok(b.moment > a.moment && b.comp > a.comp);
  assert.ok(c.moment > a.moment);
});

test('L4/L5: brak ciężaru lub skali → null', () => {
  const p = { bx: 40, shx: 40, shy: 60, hipx: 0, hipy: 100, f: 1, torso: 45 };
  assert.equal(lumbarAt(p, 1, 0, 80), null); assert.equal(lumbarAt(p, null, 100, 80), null); assert.equal(lumbarAt(p, 1, 100, 0), null);
});

test('strefy ścinania (Gallagher & Marras 2012) i ściskania (NIOSH 3400 N)', () => {
  assert.equal(shearZone(499), 'ok'); assert.equal(shearZone(500), 'warn'); assert.equal(shearZone(1000), 'warn'); assert.equal(shearZone(1001), 'bad');
  assert.equal(shearZone(750, true), 'bad', '100+ powtórzeń dziennie: czerwony od 700 N'); assert.equal(shearZone(650, true), 'warn');
  assert.equal(shearZone(null), 'na');
  assert.equal(compZone(3400), 'ok'); assert.equal(compZone(3401), 'warn'); assert.equal(compZone(6401), 'bad');
});

test('strefy zgięcia kolana (Escamilla 2001, Hartmann 2013)', () => {
  assert.equal(kneeZone(30).key, 'low'); assert.equal(kneeZone(50).key, 'low'); assert.equal(kneeZone(65).key, 'mid');
  assert.equal(kneeZone(90).key, 'peak'); assert.equal(kneeZone(125).key, 'deep'); assert.equal(kneeZone(null), null);
});

test('masa ciała: wpisana albo szacowana ze wzrostu', () => {
  assert.deepEqual(bodyMass('82,5', 180), { kg: 82.5, est: false });
  assert.deepEqual(bodyMass('', 180), { kg: 78, est: true });
  assert.equal(bodyMass('5', 180).est, true);
});

test('zmęczenie: spadek prędkości + przyrost pochylenia (Sánchez-Medina 2011, Hooper 2014)', () => {
  assert.equal(fatigueStatus(10, 0, 20), 'ok');
  assert.equal(fatigueStatus(20, 0, 20), 'warn');
  assert.equal(fatigueStatus(30, 0, 20), 'bad');
  assert.equal(fatigueStatus(20, 6, 20, 5), 'bad');
  assert.equal(fatigueStatus(10, 6, 20, 5), 'warn');
  assert.equal(fatigueStatus(5, 11, 20, 5), 'warn');
  assert.equal(fatigueStatus(5, 4, 20, 5), 'ok');
});

const mkRep = (vel, trunk, extra = {}) => ({ vel, score: 100, checks: [], bio: { trunk, knee: 100, conf: { pct: 90, label: 'wysoka' }, ...extra } });

test('annotateSet: zmęczenie w serii, różnice < 5° ignorowane, jedna uwaga bezpieczeństwa', () => {
  const reps = [mkRep(.60, 30), mkRep(.58, 31), mkRep(.55, 33), mkRep(.45, 38), mkRep(.40, 40)];
  const bio = annotateSet(reps, { ex: 'squat', weight: 100 });
  assert.equal(reps[2].bio.leanDelta, 2); assert.equal(reps[2].bio.fatigue, 'ok', '2° < 5° → szum');
  assert.equal(reps[3].bio.vloss, 25); assert.equal(reps[3].bio.fatigue, 'bad', '25% + 7,5° pochylenia');
  assert.equal(reps[3].safety.key, 'fatigue');
  assert.equal(bio.fatigue, 'bad'); assert.ok(bio.flags.some(f => f.key === 'fatigue'));
  assert.equal(bio.thrV, 20);
});

test('annotateSet: progi konfigurowalne dla ćwiczenia', () => {
  const reps = [mkRep(.60, 30), mkRep(.60, 30), mkRep(.48, 30)];
  annotateSet(reps, { ex: 'squat', weight: 100, thr: { vloss: { squat: 30 } } });
  assert.equal(reps[2].bio.vloss, 20); assert.equal(reps[2].bio.fatigue, 'ok', '20% < próg 30%');
  annotateSet(reps, { ex: 'squat', weight: 100 });
  assert.equal(reps[2].bio.fatigue, 'warn', '20% = domyślny próg przysiadu');
});

test('annotateSet: ścinanie w strefie czerwonej ma najwyższy priorytet uwagi (kręgosłup)', () => {
  const reps = [mkRep(.6, 30, { load: { shear: 1200, shearSt: 'bad', comp: 9000, moment: 500 } })];
  annotateSet(reps, { ex: 'deadlift', weight: 180 });
  assert.equal(reps[0].safety.key, 'shear'); assert.match(reps[0].safety.cue, /Gryf bliżej/);
});

test('annotateSet: niska pewność pomiaru wycisza uwagi z kątów i obciążeń', () => {
  const reps = [mkRep(.6, 30, { conf: { pct: 30, label: 'niska' }, load: { shear: 1200, shearSt: 'bad', comp: 9000, moment: 500 } })];
  const bio = annotateSet(reps, { ex: 'deadlift', weight: 180 });
  assert.equal(reps[0].safety, null); assert.ok(bio.flags.some(f => f.key === 'conf'));
});

const hist = (w, trunk, knee, vel, score = 90) => ({ ex: 'squat', weight: w, date: '2026-11-01T10:00:00Z', reps: [{ vel }], summary: { n: 5, score, est1rm: w * 1.15, bio: { trunkAvg: trunk, kneeAvg: knee, velAvg: vel } } });

test('porównanie z lżejszymi seriami (Shoji 2025, Dolan & Adams 1998) i półprzysiad z dużym ciężarem (Hartmann 2013)', () => {
  const H = [hist(60, 30, 110, .8), hist(80, 32, 105, .65), hist(120, 45, 70, .3)];
  const base = lighterBaseline(H, 'squat', 100);
  assert.equal(base.n, 2); assert.equal(base.trunk, 32); assert.equal(base.knee, 110);
  const reps = [mkRep(.5, 42, { knee: 72 }), mkRep(.5, 43, { knee: 73 })];
  const bio = annotateSet(reps, { ex: 'squat', weight: 100, history: H, best1rm: 120 });
  assert.ok(bio.flags.some(f => f.key === 'heavier' && f.status === 'bad'), 'tułów +10° vs lżejsze serie');
  assert.ok(bio.flags.some(f => f.key === 'half'), 'kolano 72° przy większym ciężarze');
  assert.equal(reps[0].safety.key, 'heavier');
});

test('brak reguły „kolana nie za palce” (Fry 2003)', () => {
  const r = repBio([{ t: 0, torso: 20, kneeFlex: 110, q: 1, bx: 0, shx: 0, shy: 0, hipx: 0, hipy: 50, f: 1 }, { t: .1, torso: 20, kneeFlex: 112, q: 1, bx: 0, shx: 0, shy: 0, hipx: 0, hipy: 50, f: 1 }], { s: 0, e: 1 }, 'squat', 1, { weight: 100, mass: 80 });
  assert.ok(!JSON.stringify(r).match(/palc/i));
  assert.equal(r.kneeZone, 'deep');
});

test('wpływ ciężaru na technikę: grupowanie wg ciężaru', () => {
  const H = [hist(60, 30, 110, .8, 95), hist(60, 32, 108, .78, 85), hist(100, 40, 95, .5, 70)];
  const t = loadEffect(H, 'squat');
  assert.equal(t.length, 2); assert.equal(t[0].kg, 60); assert.equal(t[0].sets, 2); assert.equal(t[0].score, 90); assert.equal(t[0].trunk, 31); assert.equal(t[1].vel, .5);
});

test('pewność pomiaru i metryka tułowia', () => {
  const R = Array.from({ length: 31 }, (_, i) => ({ t: i / 30, q: .95, sg: .05, torso: i % 2 ? 20 : -15 }));
  const c = confidenceOf(R, { plate: true }); assert.ok(c.pct >= 90 && c.label === 'wysoka', JSON.stringify(c));
  const c2 = confidenceOf(R.map(r => ({ ...r, sg: .6, q: .5 })), {}); assert.equal(c2.label, 'niska');
  assert.equal(trunkOf(R, 'squat'), 20); assert.equal(trunkOf(R, 'press'), 15); assert.equal(trunkOf(R, 'bench'), null);
  assert.equal(gripStatus(1.4), 'ok'); assert.equal(gripStatus(1.6), 'warn'); assert.equal(gripStatus(2), 'bad'); assert.equal(gripStatus(null), 'na');
});

test('buildSetData: pełna seria syntetyczna z ciężarem → obciążenia i podsumowanie', () => {
  const samples = [];
  for (let i = 0; i <= 5 * 90; i++) {
    const t = i / 30, u = (t % 3) / 3, d = t < 1 || t > 13 ? 0 : (1 - Math.cos(2 * Math.PI * u)) / 2;
    const hipx = 640 - 90 * d, hipy = 360 + 144 * d, shx = hipx + 77 * d, shy = 216 + 137 * d, ky = 497, ay = 634;
    samples.push({ t, bx: shx + .08 * (hipx - shx), by: shy + .08 * (hipy - shy), ry: shy, bs: 's', bq: 1, mfx: 650, f: 1, shx, shy, hipx, hipy, kx: 690, ky, ay,
      kneeFlex: 20 + 100 * d, hipAng: 170 - 90 * d, torso: Math.atan2(shx - hipx, hipy - shy) * 180 / Math.PI, elbow: 90, forearm: 5, leg: 360, trunk: 150, q: .95, sg: .02 });
  }
  const set = buildSetData({ samples, ex: 'squat', weight: 100, plan: 4, height: 178, mass: 80, history: [] });
  assert.ok(set.reps.length >= 3, 'powtórzenia: ' + set.reps.length);
  const r = set.reps[1];
  assert.ok(r.bio.load && r.bio.load.moment > 50 && r.bio.load.comp > 1000 && isFinite(r.bio.load.shear), JSON.stringify(r.bio.load));
  assert.ok(r.bio.knee > 100 && r.bio.kneeZone === 'deep');
  assert.ok(set.summary.bio && set.summary.bio.shearPeak > 0 && ['ok', 'warn', 'bad'].includes(set.summary.bio.shearSt));
  assert.equal(set.summary.bio.mass, 80);
});

test('źródła: lista zawiera kluczowe prace', () => {
  const s = SOURCES.map(x => x[1]).join(' ');
  for (const k of ['Cholewicki', 'Gallagher', 'Waters', 'Escamilla', 'Hartmann', 'Fry', 'Shoji', 'Dolan', 'Sánchez-Medina', 'Hooper', 'Green', 'Iizuka', 'Zhang']) assert.ok(s.includes(k), k);
});
