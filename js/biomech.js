/* Ciężary · Trener techniki – obciążenia, zmęczenie, wpływ ciężaru na technikę i jakość pomiaru (v2.2, © Wojciech Wieczorek)
   Czysta logika (bez DOM). Reguły i progi według przeglądu literatury (BikeRc, sekcja F); numery [n] = lista SOURCES.
   WSZYSTKIE wartości są SZACUNKOWE / ORIENTACYJNE: prosty model statyczny z obrazu 2D jednej kamery,
   bez przyspieszeń, bez krzywizny kręgosłupa (kamera jej nie widzi). Nie zastępuje trenera ani badań laboratoryjnych. */
import { r1, median, clamp } from './util.js';

export const G = 9.81;
/** Model odcinka lędźwiowego [5] Cholewicki, McGill, Norman 1991 (uproszczony):
 *  ramię prostowników 6 cm, linia działania 5° (zmniejsza ścinanie do przodu), moment = ciężar × ramię poziome.
 *  hatFrac – masa ciała powyżej L4/L5 (głowa, ręce, tułów); comFrac – środek masy wzdłuż linii L4/L5→bark;
 *  l45Frac – położenie L4/L5 na linii biodro→bark. */
export const LUMBAR = { lever: 0.06, pullDeg: 5, hatFrac: 0.55, comFrac: 0.55, l45Frac: 0.12 };
/** strefy ścinania L4/L5 [6] Gallagher & Marras 2012; ściskanie – punkt odniesienia NIOSH [7] (3400 N; limit 6400 N) */
export const SHEAR = { green: 500, red: 1000, redHighRep: 700, highRepDay: 100 };
export const NIOSH = { ref: 3400, max: 6400 };
/** realny błąd kąta z jednej kamery: różnic < 5° nie oceniamy [17][18] */
export const ANGLE_NOISE = 5;
/** progi zmęczenia – WARTOŚCI STARTOWE DO WALIDACJI [12][11]: spadek prędkości (%) dla ćwiczenia, przyrost pochylenia (°) */
export const FATIGUE_DEFAULTS = { vloss: { squat: 20, deadlift: 20, press: 25, bench: 30 }, lean: 5 };
/** strefy zgięcia kolana [1][2] (0° = wyprost) */
export const KNEE_ZONES = [
  { max: 50, key: 'low', label: 'niskie', tip: 'Zgięcie do ok. 50° – najmniejsze siły w stawie kolanowym.' },
  { max: 80, key: 'mid', label: 'umiarkowane', tip: 'Siły w kolanie rosną wraz ze zgięciem.' },
  { max: 100, key: 'peak', label: 'szczyt rzepki', tip: 'Ok. 90° – największy nacisk w stawie rzepkowo-udowym. Przy dobrej technice to normalne.' },
  { max: 999, key: 'deep', label: 'głęboko', tip: 'Pełny przysiad – nacisk rzepki rozkłada się na większą powierzchnię; z dobrą techniką to nie błąd.' }
];
export const kneeZone = deg => deg == null || !isFinite(deg) ? null : KNEE_ZONES.find(z => deg <= z.max);
export const shearZone = (n, highRep) => n == null || !isFinite(n) ? 'na' : n < SHEAR.green ? 'ok' : n <= (highRep ? SHEAR.redHighRep : SHEAR.red) ? 'warn' : 'bad';
export const compZone = n => n == null || !isFinite(n) ? 'na' : n <= NIOSH.ref ? 'ok' : n <= NIOSH.max ? 'warn' : 'bad';
export const ZONE_LABEL = { ok: 'zielona', warn: 'żółta', bad: 'czerwona', na: '—' };
export const FAT_LABEL = { ok: 'brak', warn: 'umiarkowane', bad: 'wyraźne', na: '—' };
/** masa ciała: wpisana albo szacowana ze wzrostu (BMI 24) */
export function bodyMass(mass, height) {
  const m = parseFloat(String(mass ?? '').replace(',', '.'));
  if (isFinite(m) && m >= 30 && m <= 250) return { kg: m, est: false };
  const h = (+height || 178) / 100; return { kg: Math.round(24 * h * h), est: true };
}

/** obciążenie L4/L5 w jednej klatce (model statyczny).
 *  p: {bx, shx, shy, hipx, hipy, f, torso} w pikselach; ppc – piksele na cm; barKg, bodyKg.
 *  Zwraca {moment N·m, comp N, shear N, theta °} albo null. */
export function lumbarAt(p, ppc, barKg, bodyKg, M = LUMBAR) {
  if (!p || !ppc || !(barKg > 0) || !(bodyKg > 0)) return null;
  if (![p.bx, p.shx, p.shy, p.hipx, p.hipy, p.torso].every(isFinite)) return null;
  const f = p.f >= 0 ? 1 : -1;
  const lx = p.hipx + M.l45Frac * (p.shx - p.hipx);
  const cx = lx + M.comFrac * (p.shx - lx);
  const dBar = f * (p.bx - lx) / ppc / 100, dUb = f * (cx - lx) / ppc / 100;   // m, + = przed L4/L5
  const Wb = barKg * G, Wu = M.hatFrac * bodyKg * G, W = Wb + Wu;
  const moment = Math.max(0, Wb * dBar + Wu * dUb);
  const Fm = moment / M.lever, a = M.pullDeg * Math.PI / 180, th = p.torso * Math.PI / 180;
  const comp = Fm * Math.cos(a) + W * Math.abs(Math.cos(th));
  const shear = Math.abs(W * Math.sin(th) - Fm * Math.sin(a));
  return { moment, comp, shear, theta: p.torso, dBar };
}

/** metryka pochylenia tułowia dla ćwiczenia (°): przysiad/martwy – max pochylenie do przodu, OHP – max odchylenie do tyłu */
export function trunkOf(R, exk) {
  const t = R.map(r => r.torso).filter(isFinite);
  if (!t.length || exk === 'bench') return null;
  return exk === 'press' ? Math.max(0, -Math.min(...t)) : Math.max(...t);
}

/** jakość pomiaru 0–100: widoczność punktów, ustawienie z boku, skala (talerz / wzrost), gęstość klatek */
export function confidenceOf(R, { plate } = {}) {
  if (!R.length) return { pct: 0, label: 'niska', parts: {} };
  const q = median(R.map(r => r.q)) ?? .5;
  const sgv = R.map(r => r.sg).filter(v => v != null && isFinite(v));
  const side = sgv.length ? clamp(1 - (median(sgv) - .15) / .35, 0, 1) : .8;
  const dur = R[R.length - 1].t - R[0].t, fps = dur > 0 ? (R.length - 1) / dur : 30;
  const fq = clamp((fps - 8) / 17, 0, 1);
  const pct = Math.round(100 * (.35 * clamp(q, 0, 1) + .35 * side + .15 * (plate ? 1 : .7) + .15 * fq));
  return { pct, label: pct >= 75 ? 'wysoka' : pct >= 50 ? 'średnia' : 'niska', parts: { vis: r1(q), side: r1(side), fps: Math.round(fps), plate: !!plate } };
}

/** szerokość chwytu / szerokość barków – tylko gdy da się zmierzyć (kamera nie dokładnie z boku) [8] */
export function gripOf(R) {
  const g = R.map(r => r.grip).filter(v => v != null && isFinite(v));
  return g.length >= Math.max(3, R.length * .5) ? median(g) : null;
}
export const gripStatus = g => g == null ? 'na' : g <= 1.5 ? 'ok' : g <= 1.7 ? 'warn' : 'bad';

/** biomechanika jednego powtórzenia (wołane z analyzeRep) */
export function repBio(S, seg, exk, ppc, ctx = {}) {
  const R = S.slice(seg.s, seg.e + 1);
  const bm = bodyMass(ctx.mass, ctx.height);
  const out = { trunk: r1(trunkOf(R, exk)), knee: null, kneeZone: null, load: null, conf: confidenceOf(R, { plate: ctx.plate }), grip: null, gripSt: 'na', mass: bm.kg, massEst: bm.est };
  if (exk === 'squat' || exk === 'deadlift') {
    const k = R.map(r => r.kneeFlex).filter(isFinite);
    if (k.length) { out.knee = r1(Math.max(...k)); out.kneeZone = kneeZone(out.knee)?.key || null; }
  }
  if (exk !== 'bench' && ctx.weight > 0) {
    let best = null;
    for (const r of R) { const L = lumbarAt(r, ppc, ctx.weight, bm.kg); if (L && (!best || L.moment > best.moment)) best = L; }
    if (best) out.load = { moment: Math.round(best.moment), comp: Math.round(best.comp), shear: Math.round(best.shear), theta: r1(best.theta), shearSt: shearZone(best.shear, ctx.highRep), compSt: compZone(best.comp), compRatio: r1(best.comp / NIOSH.ref) };
  }
  if (exk === 'bench' || exk === 'press') { out.grip = r1(gripOf(R)); out.gripSt = gripStatus(out.grip); }
  return out;
}

/** status zmęczenia z dwóch sygnałów: spadek prędkości (%) i przyrost pochylenia (°) */
export function fatigueStatus(vloss, lean, thrV, thrL = FATIGUE_DEFAULTS.lean) {
  const v = vloss ?? 0, l = lean ?? 0;
  if (v >= thrV * 1.5 || (v >= thrV && l >= thrL)) return 'bad';
  if (v >= thrV || (l >= thrL && v >= thrV / 2) || l >= 2 * thrL) return 'warn';
  return 'ok';
}

const avg = a => { const b = a.filter(v => v != null && isFinite(v)); return b.length ? b.reduce((x, y) => x + y, 0) / b.length : null; };

/** porównanie z lżejszymi seriami tej samej osoby (historia) [9][10][2] */
export function lighterBaseline(history, exk, weight) {
  if (!(weight > 0)) return null;
  const L = (history || []).filter(h => h.ex === exk && h.weight > 0 && h.weight < weight - .01 && h.summary?.bio?.trunkAvg != null);
  if (!L.length) return null;
  return { n: L.length, weight: r1(median(L.map(h => h.weight))), trunk: median(L.map(h => h.summary.bio.trunkAvg)), knee: median(L.map(h => h.summary.bio.kneeAvg).filter(v => v != null)), vel: median(L.map(h => h.summary.bio.velAvg).filter(v => v != null)) };
}

/** adnotacja serii: zmęczenie w serii (vs pierwsze powtórzenia), porównanie z lżejszymi seriami, flaga półprzysiadu,
 *  jedna najważniejsza uwaga bezpieczeństwa dla każdego powtórzenia (priorytet: kręgosłup → bark → kolano [15]).
 *  ctx: {ex, weight, thr, history, best1rm, mass, height}. Modyfikuje reps[i].bio i zwraca podsumowanie serii. */
export function annotateSet(reps, ctx = {}) {
  const exk = ctx.ex, thr = { ...FATIGUE_DEFAULTS, ...(ctx.thr || {}), vloss: { ...FATIGUE_DEFAULTS.vloss, ...(ctx.thr?.vloss || {}) } };
  const thrV = +thr.vloss[exk] || 20, thrL = Math.max(ANGLE_NOISE, +thr.lean || 5);
  const v0 = reps.slice(0, 2).map(r => r.vel).filter(v => v != null);
  const vRef = v0.length ? Math.max(...v0) : null;
  const t0 = reps.slice(0, 2).map(r => r.bio?.trunk).filter(v => v != null);
  const tRef = t0.length ? median(t0) : null;
  const base = lighterBaseline(ctx.history, exk, ctx.weight);
  reps.forEach((r, i) => {
    const b = r.bio || (r.bio = {});
    b.vloss = vRef && r.vel != null && i >= 1 ? r1(Math.max(0, (vRef - r.vel) / vRef * 100)) : (i === 0 ? 0 : null);
    const dl = tRef != null && b.trunk != null && i >= 2 ? b.trunk - tRef : null;
    b.leanDelta = dl != null ? r1(dl) : null;
    const dEff = dl != null && dl >= ANGLE_NOISE ? dl : 0;            // < 5° = szum pomiaru
    b.fatigue = i >= 1 ? fatigueStatus(b.vloss, dEff, thrV, thrL) : 'ok';
    b.vsLighter = base && b.trunk != null ? r1(b.trunk - base.trunk) : null;
    // jedna uwaga bezpieczeństwa
    const low = b.conf?.label === 'niska';
    let s = null;
    if (!low && b.load?.shearSt === 'bad') s = { key: 'shear', status: 'bad', cue: 'Gryf bliżej ciała, odciąż plecy', tip: `Szacowane ścinanie L4/L5 ok. ${b.load.shear} N (czerwona strefa) – trzymaj gryf bliżej ciała i mniej pochylaj tułów albo zmniejsz ciężar.` };
    else if (b.fatigue === 'bad') s = { key: 'fatigue', status: 'bad', cue: b.leanDelta >= ANGLE_NOISE ? 'Zmęczenie, plecy się pochylają, kończ serię' : 'Duży spadek prędkości, kończ serię', tip: `Prędkość spadła o ${Math.round(b.vloss || 0)}%${b.leanDelta >= ANGLE_NOISE ? ` i tułów pochyla się o ${Math.round(b.leanDelta)}° bardziej niż na początku` : ''} – to dobry moment na koniec serii.` };
    else if (!low && b.vsLighter != null && b.vsLighter >= 2 * ANGLE_NOISE && exk !== 'press') s = { key: 'heavier', status: 'warn', cue: 'Przy tym ciężarze pochylasz się bardziej', tip: `Tułów pochylony o ${Math.round(b.vsLighter)}° bardziej niż przy lżejszych seriach (${String(base.weight).replace('.', ',')} kg) – technika zaczyna się zmieniać pod ciężarem.` };
    else if (!low && (exk === 'bench' || exk === 'press') && b.gripSt === 'bad') s = { key: 'grip', status: 'warn', cue: 'Węższy chwyt', tip: `Chwyt ok. ${String(b.grip).replace('.', ',')}× szerokości barków – zalecane najwyżej 1,5× (mniejsze obciążenie barku).` };
    else if (b.fatigue === 'warn') s = { key: 'fatigue', status: 'warn', cue: 'Prędkość spada', tip: `Prędkość spadła o ${Math.round(b.vloss || 0)}% – zbliżasz się do progu zmęczenia (${thrV}%).` };
    else if (!low && b.load?.shearSt === 'warn') s = { key: 'shear', status: 'warn', cue: 'Gryf bliżej ciała', tip: `Szacowane ścinanie L4/L5 ok. ${b.load.shear} N (żółta strefa 500–1000 N).` };
    r.safety = s;
  });
  // podsumowanie serii
  const bio = {
    trunkAvg: r1(avg(reps.map(r => r.bio?.trunk))), trunkMax: r1(Math.max(...reps.map(r => r.bio?.trunk ?? -Infinity))),
    kneeAvg: r1(avg(reps.map(r => r.bio?.knee))), kneeMax: r1(Math.max(...reps.map(r => r.bio?.knee ?? -Infinity))),
    velAvg: avg(reps.map(r => r.vel)) != null ? Math.round(avg(reps.map(r => r.vel)) * 100) / 100 : null,
    shearPeak: null, compPeak: null, momentPeak: null, shearSt: 'na', compSt: 'na',
    vlossMax: r1(Math.max(0, ...reps.map(r => r.bio?.vloss || 0))), leanMax: r1(Math.max(0, ...reps.map(r => r.bio?.leanDelta || 0))),
    fatigue: reps.length ? (reps.some(r => r.bio?.fatigue === 'bad') ? 'bad' : reps.some(r => r.bio?.fatigue === 'warn') ? 'warn' : 'ok') : 'na',
    conf: reps.length ? Math.round(avg(reps.map(r => r.bio?.conf?.pct))) : null,
    mass: reps[0]?.bio?.mass ?? null, massEst: reps[0]?.bio?.massEst ?? null,
    grip: r1(median(reps.map(r => r.bio?.grip))), thrV, thrL, base, flags: []
  };
  ['trunkMax', 'kneeMax'].forEach(k => { if (!isFinite(bio[k])) bio[k] = null; });
  bio.confLabel = bio.conf == null ? '—' : bio.conf >= 75 ? 'wysoka' : bio.conf >= 50 ? 'średnia' : 'niska';
  const ld = reps.map(r => r.bio?.load).filter(Boolean);
  if (ld.length) {
    const pk = ld.reduce((a, b) => b.shear > a.shear ? b : a);
    bio.shearPeak = pk.shear; bio.shearSt = pk.shearSt;
    bio.compPeak = Math.max(...ld.map(l => l.comp)); bio.compSt = compZone(bio.compPeak); bio.momentPeak = Math.max(...ld.map(l => l.moment));
  }
  const w = ctx.weight;
  if (base && bio.trunkAvg != null) {
    const d = bio.trunkAvg - base.trunk;
    if (d >= ANGLE_NOISE && exk !== 'press') bio.flags.push({ key: 'heavier', status: d >= 2 * ANGLE_NOISE ? 'bad' : 'warn', tip: `Przy ${String(w).replace('.', ',')} kg tułów pochyla się średnio o ${Math.round(d)}° bardziej niż przy lżejszych seriach (${String(base.weight).replace('.', ',')} kg). ${exk === 'deadlift' ? 'Od ok. 80–90% maksimum plecy zwykle bardziej się zaokrąglają – ' : ''}rozważ zostanie przy tym ciężarze, aż technika się ustabilizuje.` });
  }
  if (exk === 'squat' && bio.kneeAvg != null && w > 0) {
    const heavy = (ctx.best1rm && w >= .8 * ctx.best1rm) || (bio.mass && w >= 1.2 * bio.mass);
    const shorter = base && base.knee != null && base.knee - bio.kneeAvg >= ANGLE_NOISE;
    if (bio.kneeAvg < 80 && (heavy || shorter)) bio.flags.push({ key: 'half', status: 'warn', tip: `Półprzysiad z dużym ciężarem: kolano zgięte tylko do ok. ${Math.round(bio.kneeAvg)}°${shorter ? ` (przy lżejszych seriach ${Math.round(base.knee)}°)` : ''}. Duży ciężar w niepełnym zakresie mocno obciąża kręgosłup i ścięgno rzepki – zmniejsz ciężar i schodź głębiej.` });
  }
  if (bio.fatigue === 'bad') bio.flags.push({ key: 'fatigue', status: 'bad', tip: `Zmęczenie: spadek prędkości do ${Math.round(bio.vlossMax)}%${bio.leanMax >= ANGLE_NOISE ? ` i przyrost pochylenia tułowia o ${Math.round(bio.leanMax)}°` : ''} (próg startowy ${thrV}% / ${thrL}°).` });
  if (bio.shearSt === 'bad') bio.flags.push({ key: 'shear', status: 'bad', tip: `Szacowane ścinanie L4/L5 do ok. ${bio.shearPeak} N – powyżej ${ctx.highRep ? SHEAR.redHighRep : SHEAR.red} N (strefa czerwona, orientacyjnie).` });
  if (bio.conf != null && bio.conf < 50) bio.flags.push({ key: 'conf', status: 'warn', tip: 'Niska pewność pomiaru – ustaw telefon dokładnie z boku, na wysokości bioder, z całą sylwetką w kadrze. Wartości obciążeń i kątów traktuj bardzo ostrożnie.' });
  return bio;
}

/** wpływ ciężaru na technikę: grupy serii tego samego ćwiczenia wg ciężaru (z historii + bieżąca) */
export function loadEffect(history, exk) {
  const L = (history || []).filter(h => h.ex === exk && h.weight > 0 && h.summary?.n);
  const by = new Map();
  for (const h of L) { const k = Math.round(h.weight * 2) / 2; if (!by.has(k)) by.set(k, []); by.get(k).push(h); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([kg, a]) => ({
    kg, sets: a.length,
    score: avg(a.map(h => h.summary.score)) != null ? Math.round(avg(a.map(h => h.summary.score))) : null,
    trunk: r1(avg(a.map(h => h.summary.bio?.trunkAvg))),
    knee: r1(avg(a.map(h => h.summary.bio?.kneeAvg))),
    vel: (() => { const v = avg(a.map(h => h.summary.bio?.velAvg ?? avg(h.reps.map(r => r.vel)))); return v != null ? Math.round(v * 100) / 100 : null; })(),
    shear: (() => { const v = avg(a.map(h => h.summary.bio?.shearPeak)); return v != null ? Math.round(v) : null; })()
  }));
}

/** źródła cytowane w aplikacji (z bibliografii przeglądu literatury BikeRc) */
export const SOURCES = [
  [1, 'Escamilla RF. Knee biomechanics of the dynamic squat exercise. Med Sci Sports Exerc. 2001;33(1):127–141.', 'https://doi.org/10.1097/00005768-200101000-00020'],
  [2, 'Hartmann H, Wirth K, Klusemann M. Analysis of the load on the knee joint and vertebral column with changes in squatting depth and weight load. Sports Med. 2013;43(10):993–1008.', 'https://doi.org/10.1007/s40279-013-0073-6'],
  [4, 'Fry AC, Smith JC, Schilling BK. Effect of knee position on hip and knee torques during the barbell squat. J Strength Cond Res. 2003;17(4):629–633.', 'https://doi.org/10.1519/1533-4287(2003)017%3C0629%3Aeokpoh%3E2.0.co%3B2'],
  [5, 'Cholewicki J, McGill SM, Norman RW. Lumbar spine loads during the lifting of extremely heavy weights. Med Sci Sports Exerc. 1991;23(10):1179–1186.', 'https://doi.org/10.1249/00005768-199110000-00012'],
  [6, 'Gallagher S, Marras WS. Tolerance of the lumbar spine to shear: a review and recommended exposure limits. Clin Biomech. 2012;27(10):973–978.', 'https://doi.org/10.1016/j.clinbiomech.2012.08.009'],
  [7, 'Waters TR, Putz-Anderson V, Garg A, Fine LJ. Revised NIOSH equation for the design and evaluation of manual lifting tasks. Ergonomics. 1993;36(7):749–776.', 'https://doi.org/10.1080/00140139308967940'],
  [8, 'Green CM, Comfort P. The affect of grip width on bench press performance and risk of injury. Strength Cond J. 2007;29(5):10–14.', 'https://doi.org/10.1519/00126548-200710000-00001'],
  [9, 'Shoji K, Nakayama K, Shiouchi M, Manabe Y. Load-dependent increase in lumbar kyphosis is associated with posterior pelvic tilt during deadlift. Front Sports Act Living. 2025;7:1682991.', 'https://doi.org/10.3389/fspor.2025.1682991'],
  [10, 'Dolan P, Adams MA. Repetitive lifting tasks fatigue the back muscles and increase the bending moment acting on the lumbar spine. J Biomech. 1998;31(8):713–721.', 'https://doi.org/10.1016/s0021-9290(98)00086-4'],
  [11, 'Hooper DR, Szivak TK, Comstock BA, et al. Effects of fatigue from resistance training on barbell back squat biomechanics. J Strength Cond Res. 2014;28(4):1127–1134.', 'https://doi.org/10.1097/JSC.0000000000000237'],
  [12, 'Sánchez-Medina L, González-Badillo JJ. Velocity loss as an indicator of neuromuscular fatigue during resistance training. Med Sci Sports Exerc. 2011;43(9):1725–1734.', 'https://doi.org/10.1249/MSS.0b013e318213f880'],
  [15, 'Aasa U, Svartholm I, Andersson F, Berglund L. Injuries among weightlifters and powerlifters: a systematic review. Br J Sports Med. 2017;51(4):211–219.', 'https://doi.org/10.1136/bjsports-2016-096037'],
  [17, 'Gilon S, Miller EY, Uhlrich SD. OpenCap Monocular: 3D human kinematics and musculoskeletal dynamics from a single smartphone video. arXiv:2603.24733. 2026 (preprint).', 'https://arxiv.org/abs/2603.24733'],
  [18, 'Iizuka R, Yamada K, Sato M, Gotoda N, Akagi R. Geometry-informed correction of projection bias in browser-based monocular squat assessment. Front Sports Act Living. 2026;8:1831625.', 'https://doi.org/10.3389/fspor.2026.1831625'],
  [19, 'Zhang M, Nieuwenhuys A, Boocock M, Zhang Y. Concurrent validity of markerless motion capture for occupational lifting: kinematics and ergonomic risk assessment. Appl Ergon. 2027;138:104866.', 'https://doi.org/10.1016/j.apergo.2026.104866']
];
