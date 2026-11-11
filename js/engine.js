/* Ciężary · Trener techniki – silnik analizy (© Wojciech Wieczorek)
   Port i rozwinięcie silnika „BikeRc Siła”: filtr One Euro, wybór cech sylwetki, automat licznika powtórzeń,
   skala px→cm, ocena techniki i podsumowanie serii. Czysta logika – bez DOM, więc łatwa do testowania. */
import { r1, f0, median, pct, lvl, worst, sub, dist, angBetween, deg } from './util.js';
import { repBio, annotateSet, ANGLE_NOISE } from './biomech.js';

export const IDX = {
  L: { sh: 11, el: 13, wr: 15, idx: 19, hip: 23, knee: 25, ank: 27, heel: 29, toe: 31 },
  R: { sh: 12, el: 14, wr: 16, idx: 20, hip: 24, knee: 26, ank: 28, heel: 30, toe: 32 }
};
export const BONES = [['sh', 'el'], ['el', 'wr'], ['sh', 'hip'], ['hip', 'knee'], ['knee', 'ank'], ['ank', 'heel'], ['heel', 'toe'], ['ank', 'toe']];
// Proporcje ciała (Drillis i Contini): kostka→kolano 0.246·wzrost, kolano→biodro 0.245, biodro→bark 0.288
export const LEG_RATIO = 0.491, TORSO_RATIO = 0.288;

/* Ćwiczenia: rest = gdzie gryf jest między powtórzeniami (góra / dół) */
export const EX = {
  squat: {
    name: 'Przysiad', full: 'Przysiad ze sztangą', say: 'przysiad', rest: 'top', minAmp: 15, ref: 'foot', step: 5, icon: 'squat',
    desc: 'Gryf nisko na plecach. Oceniamy: <b>głębokość</b> (biodro poniżej kolana), <b>gryf nad środkiem stopy</b>, <b>biodra i barki wstają razem</b>.',
    met: 'Biodro vs kolano', hint: 'Telefon z boku, na wysokości bioder, 3–4 m. Cała sylwetka i talerz w kadrze.',
    intro: ['Gryf nad środkiem stopy.', 'Zejdź tak, żeby biodro było poniżej kolana.', 'Z dołu wypychaj klatkę w górę.']
  },
  deadlift: {
    name: 'Martwy ciąg', full: 'Martwy ciąg klasyczny', say: 'martwy ciąg', rest: 'bottom', minAmp: 15, ref: 'foot', step: 5, icon: 'deadlift',
    desc: 'Oceniamy: <b>gryf nad środkiem stopy na starcie</b>, <b>gryf blisko nóg</b>, <b>biodra nie wstają przed barkami</b>, <b>pełny wyprost bez odchylania</b>.',
    met: 'Tułów od pionu', hint: 'Telefon z boku, na wysokości bioder, 3–4 m. Cała sylwetka i talerz w kadrze.',
    intro: ['Gryf nad środkiem stopy, barki nad gryfem.', 'Pchaj nogami, prowadź gryf po udach.', 'Na górze pełny wyprost, bez odchylania.']
  },
  press: {
    name: 'Wyciskanie żołnierskie', full: 'Wyciskanie żołnierskie (stojąc)', say: 'wyciskanie żołnierskie', rest: 'bottom', minAmp: 15, ref: 'foot', step: 2.5, icon: 'press',
    desc: 'Oceniamy: <b>gryf na górze nad barkami i środkiem stopy</b>, <b>zablokowane łokcie</b>, <b>tułów nie odchyla się za mocno</b>.',
    met: 'Łokieć', hint: 'Telefon z boku, 3–4 m. W kadrze stopy i dłonie nad głową.',
    intro: ['Napnij brzuch i pośladki.', 'Wejdź głową pod gryf.', 'Na górze zablokuj łokcie.']
  },
  bench: {
    name: 'Wyciskanie leżąc', full: 'Wyciskanie leżąc', say: 'wyciskanie leżąc', rest: 'top', minAmp: 8, ref: 'shoulder', step: 2.5, icon: 'bench',
    desc: 'Oceniamy: <b>gryf ląduje na dolnej części klatki</b>, <b>łokcie pod gryfem</b>, <b>na górze gryf nad barkami</b>.',
    met: 'Łokieć', hint: 'Telefon z boku ławki, na jej wysokości. W kadrze barki, łokcie, dłonie i biodra.',
    intro: ['Łopatki ściągnięte, stopy mocno w podłodze.', 'Gryf na dolną część klatki.', 'Łokcie pod gryfem, na górze wyprost.']
  }
};
export const ST_SCORE = { ok: 100, warn: 60, bad: 20 };
export const ST_LABEL = { ok: 'dobrze', warn: 'do poprawy', bad: 'błąd' };

/* ---------- filtr One Euro ---------- */
export class OneEuro {
  constructor(minCut, beta = 0.004, dCut = 1) { this.minCut = minCut; this.beta = beta; this.dCut = dCut; this.x = null; }
  static a(dt, c) { const tau = 1 / (2 * Math.PI * c); return 1 / (1 + tau / dt); }
  f(x, t) {
    if (this.x == null || t <= this.t || t - this.t > 0.5) { this.x = x; this.dx = 0; this.t = t; return x; }
    const dt = t - this.t, ad = OneEuro.a(dt, this.dCut), dx = (x - this.x) / dt;
    this.dx = ad * dx + (1 - ad) * this.dx;
    const a = OneEuro.a(dt, this.minCut + this.beta * Math.abs(this.dx));
    this.x = a * x + (1 - a) * this.x; this.t = t; return this.x;
  }
}
export const makeFilters = mc => Array.from({ length: 33 }, () => [new OneEuro(mc), new OneEuro(mc)]);

/* ---------- wybór ćwiczącego, gdy w kadrze jest kilka osób ---------- */
export function pickPerson(L, t, person) {
  const info = L.map(lm => {
    const vis = lm.filter(p => (p.visibility ?? 1) > .4);
    const ys = vis.map(p => p.y), xs = vis.map(p => p.x);
    return { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2, size: ys.length ? (Math.max(...ys) - Math.min(...ys)) * (1 + .3 * (Math.max(...xs) - Math.min(...xs))) : 0 };
  });
  let k = -1;
  if (person && (person.pick || t - person.t < 1.5 || t < person.t)) {
    let bd = Infinity;
    info.forEach((p, i) => { const d = Math.hypot(p.x - person.x, p.y - person.y); if (d < bd) { bd = d; k = i; } });
    if (bd > (person.pick ? .35 : .2)) k = -1;
  }
  if (k < 0 && !(person && t >= person.t && t - person.t < (person.pick ? 1.5 : 1))) info.forEach((p, i) => { if (k < 0 || p.size > info[k].size) k = i; });
  const next = k >= 0 ? { x: info[k].x, y: info[k].y, t, pick: !!(person?.pick && Math.hypot(info[k].x - person.x, info[k].y - person.y) < .35) } : person;
  return { k, person: next };
}

/* ---------- punkty → cechy klatki ---------- */
export class FeatureExtractor {
  constructor() { this.reset(); }
  reset() { this.nearSide = 'L'; this.nearVotes = 0; this.faceBuf = []; }
  /** opt: {ex, swap, plate:{on,track(bar)}} */
  extract(P, w, h, t, Praw, opt) {
    const ex = opt.ex, swap = !!opt.swap;
    const side = s => IDX[swap ? (s === 'L' ? 'R' : 'L') : s];
    const zAvg = s => { const I = side(s); return (P[I.sh].z + P[I.hip].z + P[I.knee].z) / 3; };
    const vSum = s => { const I = side(s); return P[I.sh].v + P[I.hip].v + P[I.knee].v + P[I.ank].v + P[I.wr].v; };
    const zl = zAvg('L'), zr = zAvg('R');
    const pref = zl < zr - .05 ? 'L' : zr < zl - .05 ? 'R' : (vSum('L') >= vSum('R') ? 'L' : 'R');
    if (pref !== this.nearSide) { if (++this.nearVotes > 8) { this.nearSide = pref; this.nearVotes = 0; } } else this.nearVotes = 0;
    const nearSide = this.nearSide;
    const I = side(nearSide), O = side(nearSide === 'L' ? 'R' : 'L');
    const pick = k => (P[I[k]].v >= .5 || P[O[k]].v <= P[I[k]].v) ? P[I[k]] : P[O[k]];
    const sh = pick('sh'), el = pick('el'), wr = pick('wr'), hip = pick('hip'), knee = pick('knee'), ank = pick('ank'), heel = pick('heel'), toe = pick('toe');

    let fr;
    if (ex === 'bench') fr = Math.sign(sh.x - hip.x) || 1;
    else { const fx = (P[I.toe].x - P[I.heel].x) + (P[O.toe].x - P[O.heel].x); fr = Math.sign(Math.abs(fx) > 4 ? fx : P[0].x - (P[7].x + P[8].x) / 2) || 1; }
    this.faceBuf.push(fr); if (this.faceBuf.length > 45) this.faceBuf.shift();
    const f = this.faceBuf.reduce((a, b) => a + b, 0) >= 0 ? 1 : -1;

    const barOf = Q => {
      const pk = k => (Q[I[k]].v >= .5 || Q[O[k]].v <= Q[I[k]].v) ? Q[I[k]] : Q[O[k]];
      if (ex === 'squat') { const a = pk('sh'), b = pk('hip'); return { x: a.x + .08 * (b.x - a.x), y: a.y + .08 * (b.y - a.y), v: Math.min(a.v, b.v) }; }
      const hand = s => { const S = side(s); const a = Q[S.wr], b = Q[S.idx]; return { x: a.x + .35 * (b.x - a.x), y: a.y + .35 * (b.y - a.y), v: Math.min(a.v, b.v) }; };
      const hn = hand(nearSide), hf = hand(nearSide === 'L' ? 'R' : 'L');
      return (hn.v > .5 && hf.v > .5) ? { x: (hn.x + hf.x) / 2, y: (hn.y + hf.y) / 2, v: Math.min(hn.v, hf.v) } : (hn.v >= hf.v ? hn : hf);
    };
    let bar = barOf(P), barRaw = Praw ? barOf(Praw) : bar, barSrc = ex === 'squat' ? 's' : 'h';
    const handPt = bar;
    if (opt.plate?.on) {
      const p = opt.plate.track(bar);
      if (p) { bar = { x: p.x, y: p.y, v: 1 }; barRaw = bar; barSrc = 'p'; }
    }

    const feetOk = heel.v > .5 && toe.v > .5;
    const mfx = feetOk && P[O.heel].v > .5 && P[O.toe].v > .5 ? (heel.x + toe.x + P[O.heel].x + P[O.toe].x) / 4 : (heel.x + toe.x) / 2;
    const kneeFlex = 180 - angBetween(sub(hip, knee), sub(ank, knee));
    const hipAng = angBetween(sub(sh, hip), sub(knee, hip));
    const torso = deg(Math.atan2(f * (sh.x - hip.x), hip.y - sh.y));
    const elbow = angBetween(sub(sh, el), sub(wr, el));
    const forearm = deg(Math.atan2(Math.abs(wr.x - el.x), Math.abs(el.y - wr.y)));
    const leg = dist(ank, knee) + dist(knee, hip), trunk = dist(sh, hip);

    // kontrola ustawienia
    const need = ex === 'bench' ? ['sh', 'el', 'wr', 'hip'] : ex === 'press' ? ['sh', 'el', 'wr', 'hip', 'knee', 'ank', 'heel', 'toe'] : ['sh', 'hip', 'knee', 'ank', 'heel', 'toe', 'wr'];
    const inside = p => p.x > w * .01 && p.x < w * .99 && p.y > h * .005 && p.y < h * .995;
    const miss = need.filter(k => { const p = pick(k); return p.v < .5 || !inside(p); });
    const shoulderGap = Math.abs(P[11].x - P[12].x) / Math.max(1, trunk);
    // szerokość chwytu / barków – mierzalna tylko, gdy kamera nie stoi dokładnie z boku (barki rozsunięte na obrazie)
    const grip = shoulderGap >= .3 && P[15].v > .5 && P[16].v > .5 && P[11].v > .5 && P[12].v > .5 ? Math.abs(P[15].x - P[16].x) / Math.max(1, Math.abs(P[11].x - P[12].x)) : null;
    let msg = '', code = '';
    if (miss.some(k => ['ank', 'heel', 'toe'].includes(k))) { msg = 'Nie widać stóp – odsuń telefon albo obniż go'; code = 'feet'; }
    else if (miss.includes('wr') || miss.includes('el')) { msg = ex === 'press' ? 'Nie widać dłoni nad głową – odsuń telefon' : 'Nie widać rąk – popraw kadr'; code = 'hands'; }
    else if (miss.length) { msg = 'Cała sylwetka musi być w kadrze'; code = 'frame'; }
    else if (ex !== 'bench' && shoulderGap > .45) { msg = 'Ustaw telefon dokładnie z boku – inaczej kąty są zaniżone'; code = 'side'; }
    const setup = { ok: !msg, msg: msg || 'Ustawienie OK – widać całą sylwetkę', code };

    const q = Math.min(...need.map(k => pick(k).v));
    return { t, w, h, P, I, near: nearSide, f, bar, barRaw, barSrc, handPt, mfx, sh, el, wr, hip, knee, ank, heel, toe,
      kneeFlex, hipAng, torso, elbow, forearm, leg, trunk, q, shoulderGap, grip, setup };
  }
}

/* ---------- automat licznika: d = 0 przy pozycji spoczynkowej, 1 w drugim końcu ruchu ---------- */
export class RepFSM {
  constructor() { this.state = null; this.lo = Infinity; this.hi = -Infinity; this.hist = []; this.lastEnd = -1; this.ret = null; }
  feed(i, d, t) {
    this.justAway = false;
    this.hist.push([i, d, t]);
    if (this.hist.length > 4000) this.hist.shift();
    let out = null;
    if (this.state === 'returning') {
      if (d < this.ret.minD) { this.ret.minD = d; this.ret.minI = i; this.ret.minT = t; }
      if (d < .06 || d > this.ret.minD + .1 || t - this.ret.minT > .5) { out = this.close(); }
    }
    if (this.state === null || this.state === 'rest') {
      if (d < .3) this.state = 'rest';
      if (this.state === 'rest' && d > .7) {
        let k = this.hist.length - 1, best = k;
        const t0 = this.hist[k][2];
        while (k > 0 && this.hist[k - 1][0] > this.lastEnd && this.hist[k - 1][1] <= this.hist[k][1] + .02 && t0 - this.hist[k - 1][2] < 6) { k--; if (this.hist[k][1] < this.hist[best][1] - .01) best = k; }
        this.start = this.hist[best][0]; this.state = 'away'; this.justAway = true; this.peak = { d, i };
      }
    } else if (this.state === 'away') {
      if (d >= this.peak.d) this.peak = { d, i };
      if (d < .3) { this.state = 'returning'; this.ret = { minD: d, minI: i, minT: t }; }
    }
    return out;
  }
  close() {
    const seg = { s: this.start, turn: this.peak.i, e: this.ret.minI };
    this.lastEnd = seg.e; this.state = 'rest'; this.ret = null;
    return seg;
  }
  flush() { return this.state === 'returning' ? this.close() : null; }
}

/* ---------- skala: px na cm ---------- */
export function scaleOf(S, exk, height, platePpc) {
  if (platePpc) return platePpc;
  const H = +height || 178;
  const good = S.filter(s => s.q > .5);
  if (good.length < 5) return null;
  if (exk === 'bench') return pct(good.map(s => s.trunk), .75) / (TORSO_RATIO * H);
  return pct(good.map(s => s.leg), .75) / (LEG_RATIO * H);
}

/* =========================================================
   ANALIZA POWTÓRZENIA
   ========================================================= */
export function analyzeRep(S, seg, exk, ppc, n, ctx = {}) {
  const { s, turn, e } = seg;
  const R = S.slice(s, e + 1);
  const f = (median(R.map(r => r.f)) ?? 1) >= 0 ? 1 : -1;
  const refX = exk === 'bench'
    ? median([...S.slice(s, Math.min(e + 1, s + 4)), ...S.slice(Math.max(s, e - 3), e + 1)].map(r => r.shx))
    : median(R.map(r => r.mfx));
  const X = r => (r.bx - refX) * f / ppc;
  const yRef = exk === 'bench' ? Math.max(...R.map(r => r.by)) : median(R.map(r => r.ay));
  const Y = r => (yRef - r.by) / ppc;
  const step = Math.max(1, Math.round(R.length / 60));
  const path = R.filter((_, i) => i % step === 0 || i === R.length - 1).map(r => [r1(X(r)), r1(Y(r))]);
  const restTop = EX[exk].rest === 'top';
  const [cs, ce] = restTop ? [turn, e] : [s, turn];
  const rom = Math.abs(S[turn].by - S[s].by) / ppc;
  const around = (i, k, fn) => S.slice(Math.max(s, i - k), Math.min(e, i + k) + 1).map(fn);

  // prędkość w fazie podnoszenia (5–95% drogi) – z surowych punktów, bo filtr opóźnia start ruchu
  const ry = r => r.ry ?? r.by;
  const y0 = ry(S[cs]), dy = y0 - ry(S[ce]);
  let ta = null, tb = null;
  if (dy > 0) for (let i = cs; i <= ce; i++) { const p = (y0 - ry(S[i])) / dy; if (ta == null && p > .05) ta = S[i].t; if (p >= .95) { tb = S[i].t; break; } }
  const vel = (ta != null && tb != null && tb > ta) ? (dy * .9 / ppc / 100) / (tb - ta) : null;
  const concT = (ta != null && tb != null) ? tb - ta : null;
  // tempo: czas fazy opuszczania (ekscentrycznej) i podnoszenia (koncentrycznej), w sekundach
  const tDown = restTop ? S[turn].t - S[s].t : S[e].t - S[turn].t;
  const tUp = restTop ? S[e].t - S[turn].t : S[turn].t - S[s].t;

  const checks = [];
  const C = (key, label, value, unit, status, tip, cue, pri) => checks.push({ key, label, value: r1(value), unit, status, tip: status === 'ok' ? '' : tip, cue: status === 'ok' ? '' : cue, pri });
  const maxAbs = list => list.reduce((m, v) => Math.abs(v) > Math.abs(m) ? v : m, 0);
  const metrics = {};

  if (exk === 'squat') {
    const dev = maxAbs(R.map(X));
    C('bar', 'Gryf nad środkiem stopy', Math.abs(dev), 'cm', lvl(Math.abs(dev), 5, 8),
      dev > 0 ? `Gryf odjechał do przodu o ${f0(dev)} cm – trzymaj go nad środkiem stopy, ciężar na całej stopie.` : `Gryf uciekł za środek stopy o ${f0(-dev)} cm – ciężar za bardzo na piętach.`,
      dev > 0 ? 'Gryf nad środek stopy' : 'Ciężar na środek stopy', 2);
    const depth = Math.max(...around(turn, 3, r => (r.hipy - r.ky) / ppc));
    metrics.depth = depth;
    C('depth', 'Głębokość (biodro vs kolano)', depth, 'cm', depth >= 0 ? 'ok' : depth >= -5 ? 'warn' : 'bad',
      `Za płytko o ${f0(-depth)} cm – zejdź, aż biodro będzie poniżej kolana.`, 'Głębiej, biodro pod kolano', 3);
    const tTurn = S[turn].torso, h0 = S[turn].by;
    let maxT = tTurn;
    for (let i = turn; i <= e; i++) { if ((h0 - S[i].by) / ppc > rom * .3) break; maxT = Math.max(maxT, S[i].torso); }
    const fold = maxT - tTurn;
    metrics.fold = fold; metrics.torsoBottom = tTurn;
    C('hips', 'Biodra i barki wstają razem', fold, '°', lvl(fold, 10, 18),
      `Z dołu tułów pochylił się o ${f0(fold)}° – biodra uciekają w górę. Wypchnij biodra w górę i trzymaj klatkę.`, 'Klatka w górę', 2);
  }
  if (exk === 'deadlift') {
    const xs = X(S[s]);
    metrics.startX = xs;
    C('start', 'Gryf nad środkiem stopy na starcie', Math.abs(xs), 'cm', lvl(Math.abs(xs), 4, 7),
      xs > 0 ? `Na starcie gryf był ${f0(xs)} cm przed środkiem stopy – podejdź bliżej, gryf nad środkiem stopy.` : `Na starcie gryf był ${f0(-xs)} cm za środkiem stopy – za blisko piszczeli.`,
      'Gryf nad środek stopy', 3);
    const shOver = (S[s].shx - S[s].bx) * f / ppc;
    metrics.shOver = shOver;
    C('shoulders', 'Barki nad gryfem na starcie', shOver, 'cm', shOver >= -2 ? 'ok' : shOver >= -6 ? 'warn' : 'bad',
      'Barki za gryfem na starcie – łopatki powinny być nad gryfem.', 'Barki nad gryf', 4);
    const dev = maxAbs(S.slice(s, turn + 1).map(X));
    C('bar', 'Gryf blisko nóg', Math.abs(dev), 'cm', lvl(Math.abs(dev), 5, 8),
      dev > 0 ? `Gryf odjechał od nóg o ${f0(dev)} cm – prowadź go po udach.` : `Gryf uciekł za środek stopy o ${f0(-dev)} cm.`, 'Gryf bliżej nóg', 2);
    const t0 = S[s].torso, kneeY = S[s].ky;
    let maxT = t0;
    for (let i = s; i <= turn; i++) { if (S[i].by < kneeY) break; maxT = Math.max(maxT, S[i].torso); }
    const shoot = maxT - t0;
    metrics.shoot = shoot;
    C('hips', 'Biodra i barki wstają razem', shoot, '°', lvl(shoot, 6, 12),
      `Biodra wstały przed barkami (tułów pochylił się o ${f0(shoot)}°) – pchaj nogami, klatka w górę.`, 'Biodra razem z barkami', 1);
    const hipTop = Math.max(...around(turn, 3, r => r.hipAng)), kneeTop = Math.min(...around(turn, 3, r => r.kneeFlex));
    const lean = Math.min(...around(turn, 3, r => r.torso));
    metrics.hipTop = hipTop; metrics.lean = lean;
    C('lockout', 'Pełny wyprost na górze', hipTop, '°', (hipTop >= 165 && kneeTop <= 15) ? 'ok' : (hipTop >= 155 ? 'warn' : 'bad'),
      'Dokończ ruch – na górze pełny wyprost bioder i kolan.', 'Dokończ wyprost', 4);
    C('lean', 'Bez odchylania na górze', -lean, '°', lean >= -10 ? 'ok' : lean >= -16 ? 'warn' : 'bad',
      `Na górze odchylasz się do tyłu o ${f0(-lean)}° – stań prosto, nie przeginaj pleców.`, 'Nie odchylaj się', 3);
  }
  if (exk === 'press') {
    const xt = median(around(turn, 2, X));
    C('bar', 'Gryf nad środkiem stopy na górze', Math.abs(xt), 'cm', lvl(Math.abs(xt), 5, 9),
      xt > 0 ? `Na górze gryf jest ${f0(xt)} cm przed środkiem stopy – wejdź pod gryf, gryf nad barki.` : `Na górze gryf jest ${f0(-xt)} cm za środkiem stopy.`, 'Wejdź pod gryf', 2);
    const elb = Math.max(...around(turn, 3, r => r.elbow));
    metrics.elbowTop = elb;
    C('lockout', 'Łokcie zablokowane na górze', 180 - elb, '°', elb >= 165 ? 'ok' : elb >= 150 ? 'warn' : 'bad',
      'Zablokuj łokcie na górze – wypchnij gryf do końca.', 'Zablokuj łokcie', 3);
    const lean = Math.min(...S.slice(s, turn + 1).map(r => r.torso));
    metrics.lean = lean;
    C('lean', 'Tułów bez nadmiernego odchylenia', -lean, '°', lean >= -12 ? 'ok' : lean >= -20 ? 'warn' : 'bad',
      `Odchylasz tułów do tyłu o ${f0(-lean)}° – napnij brzuch i pośladki.`, 'Napnij brzuch', 1);
  }
  if (exk === 'bench') {
    const T = S[turn], tl2 = (T.hipx - T.shx) ** 2 + (T.hipy - T.shy) ** 2;
    const touch = tl2 ? ((T.bx - T.shx) * (T.hipx - T.shx) + (T.by - T.shy) * (T.hipy - T.shy)) / tl2 : null;
    metrics.touch = touch;
    const tSt = touch == null ? 'na' : touch < 0 ? 'bad' : touch < .1 ? 'warn' : touch <= .4 ? 'ok' : touch <= .55 ? 'warn' : 'bad';
    C('touch', 'Gryf na dolnej części klatki', touch == null ? null : touch * 100, '% tułowia', tSt,
      touch != null && touch < .1 ? 'Gryf ląduje za wysoko – opuszczaj na dolną część klatki.' : 'Gryf ląduje za nisko – celuj w dolną część mostka.',
      touch != null && touch < .1 ? 'Niżej na klatkę' : 'Wyżej na klatkę', 2);
    const fa = median(around(turn, 2, r => r.forearm));
    C('elbows', 'Łokcie pod gryfem', fa, '°', lvl(fa, 12, 22),
      `Na dole przedramiona odchylone o ${f0(fa)}° – łokcie pod gryfem, przedramiona pionowo.`, 'Łokcie pod gryf', 2);
    const xt = median(S.slice(Math.max(s, e - 3), e + 1).map(X));
    C('bar', 'Gryf nad barkami na górze', Math.abs(xt), 'cm', lvl(Math.abs(xt), 5, 9),
      'Na górze gryf powinien być nad barkami.', 'Gryf nad barki', 3);
    const elb = Math.max(...S.slice(Math.max(s, e - 3), e + 1).map(r => r.elbow));
    C('lockout', 'Łokcie zablokowane na górze', 180 - elb, '°', elb >= 160 ? 'ok' : elb >= 145 ? 'warn' : 'bad',
      'Zablokuj łokcie na górze.', 'Zablokuj łokcie', 4);
  }

  const valid = checks.filter(c => c.status !== 'na');
  const status = worst(valid.map(c => c.status));
  const score = valid.length ? Math.round(valid.reduce((a, c) => a + ST_SCORE[c.status], 0) / valid.length) : null;
  const issues = valid.filter(c => c.status !== 'ok').sort((a, b) => (a.status === 'bad' ? 0 : 1) - (b.status === 'bad' ? 0 : 1) || a.pri - b.pri);
  const live = exk === 'bench' ? null : X(S[turn]);
  // v2.2: obciążenia kręgosłupa i kolan, pochylenie tułowia, jakość pomiaru (szacunkowo – biomech.js)
  const bio = repBio(S, seg, exk, ppc, ctx);
  return { n, s, turn, e, tTurn: S[turn].t, tStart: S[s].t, tEnd: S[e].t, status, score, rom, vel, concT, tDown: r1(tDown), tUp: r1(tUp),
    path, checks, main: issues[0] || null, metrics, devTurn: live, bio, safety: null };
}

/* ---------- cała seria ---------- */
export function segmentAll(S, exk, ppc) {
  if (!S.length || !ppc) return [];
  const ys = S.map(s => s.by);
  const lo = pct(ys, .02), hi = pct(ys, .98), amp = hi - lo;
  if (amp < EX[exk].minAmp * ppc * .8) return [];
  const m = new RepFSM(), segs = [];
  S.forEach((s, i) => {
    const d = EX[exk].rest === 'top' ? (s.by - lo) / amp : (hi - s.by) / amp;
    const seg = m.feed(i, Math.max(-.2, Math.min(1.2, d)), s.t); if (seg) segs.push(seg);
  });
  const last = m.flush(); if (last) segs.push(last);
  return segs.filter(g => Math.abs(S[g.turn].by - S[g.s].by) / ppc >= EX[exk].minAmp * .6 && g.e > g.turn && g.turn > g.s);
}

const kgTxt = v => String(v).replace('.', ',');
export function summarize(reps, exk, weight) {
  const n = reps.length;
  const cnt = { ok: 0, warn: 0, bad: 0 };
  reps.forEach(r => cnt[r.status]++);
  const vels = reps.map(r => r.vel).filter(v => v != null);
  const vBest = vels.length ? Math.max(...vels.slice(0, Math.min(2, vels.length))) : null;
  const vLast = vels.length ? vels[vels.length - 1] : null;
  const loss = vels.length >= 3 && vBest ? Math.max(0, (vBest - vLast) / vBest * 100) : null;
  const tally = {};
  reps.forEach(r => r.checks.forEach(c => { if (c.status === 'warn' || c.status === 'bad') { const t = tally[c.key] ||= { w: 0, pri: c.pri, label: c.label, tip: c.tip, cue: c.cue, key: c.key }; t.w += c.status === 'bad' ? 2 : 1; } }));
  const mainIssue = Object.values(tally).sort((a, b) => b.w - a.w || a.pri - b.pri)[0] || null;
  const score = n ? Math.round(reps.reduce((a, r) => a + (r.score || 0), 0) / n) : null;
  const w = +weight || null, stepKg = EX[exk].step;
  let advice, nextWeight = w, verdict = 'up';
  if (!n) { advice = 'Nie wykryto powtórzeń. Sprawdź ustawienie telefonu (z boku, cała sylwetka w kadrze).'; verdict = 'none'; }
  else if (cnt.bad >= Math.max(1, n / 3)) { nextWeight = w ? Math.round(w * .9 / 2.5) * 2.5 : null; verdict = 'down'; advice = `Za dużo błędów technicznych${w ? ` – zmniejsz ciężar do ok. ${kgTxt(nextWeight)} kg` : ' – zmniejsz ciężar'} i popraw: ${mainIssue ? mainIssue.label.toLowerCase() : 'technikę'}.`; }
  else if (cnt.bad || cnt.warn >= n / 2) { verdict = 'stay'; advice = `Zostań przy tym ciężarze${w ? ` (${kgTxt(w)} kg)` : ''} i popraw technikę.`; }
  else if (loss != null && loss > 30) { verdict = 'stay'; advice = `Technika dobra, ale prędkość spadła o ${f0(loss)}% – zostań przy tym ciężarze.`; }
  else { nextWeight = w ? w + stepKg : null; advice = w ? `Technika i prędkość w porządku – następnym razem ${kgTxt(nextWeight)} kg.` : 'Technika i prędkość w porządku – możesz dołożyć ciężaru.'; }
  const est1rm = w && n ? Math.round(w * (1 + Math.min(n, 10) / 30) * 2) / 2 : null;
  const tips = [];
  if (mainIssue?.tip) tips.push(mainIssue.tip);
  const seen = new Set([mainIssue?.label]);
  reps.forEach(r => r.checks.forEach(c => { if (c.tip && !seen.has(c.label)) { seen.add(c.label); tips.push(c.tip); } }));
  if (loss != null && loss > 30) tips.push(`Prędkość spadła o ${f0(loss)}% – to dobry moment, żeby skończyć serię.`);
  const dn = reps.map(r => r.tDown).filter(v => v != null), up = reps.map(r => r.tUp).filter(v => v != null);
  const avg = a => a.length ? r1(a.reduce((x, y) => x + y, 0) / a.length) : null;
  return { n, cnt, score, vBest, vLast, loss, mainIssue, advice, nextWeight, verdict, est1rm, tips, tempoDown: avg(dn), tempoUp: avg(up) };
}

/** budowa serii z zebranych próbek (używane po zakończeniu nagrywania) */
export function buildSetData({ samples, ex, weight, plan, height, platePpc, snaps, src, fileName, setNo, sets, mass, thr, history }) {
  if (!samples || samples.length < 10) return null;
  const ppc = scaleOf(samples, ex, height, platePpc);
  if (!ppc) return null;
  const segs = segmentAll(samples, ex, ppc);
  const ctx = bioCtx({ ex, weight, height, mass, thr, history, plate: !!platePpc });
  const reps = segs.map((g, i) => analyzeRep(samples, g, ex, ppc, i + 1, ctx));
  const bio = annotateSet(reps, ctx);
  reps.forEach(r => { let b = null; for (const sn of snaps || []) if (!b || Math.abs(sn.t - r.tTurn) < Math.abs(b.t - r.tTurn)) b = sn; r.snap = b && Math.abs(b.t - r.tTurn) < 1.5 ? b.url : null; r.snapPriv = !!(r.snap && b.priv); });
  const barSrc = samples.filter(s => s.bs === 'p').length > samples.length / 2 ? 'p' : ex === 'squat' ? 's' : 'h';
  return { id: Date.now(), date: new Date().toISOString(), ex, weight: weight ? +weight : null, plan: plan || null, setNo: setNo || null, sets: sets || null,
    src, fileName, barSrc, ppc, plateScale: !!platePpc, height: +height, duration: samples[samples.length - 1].t - samples[0].t,
    reps, summary: applyBio(summarize(reps, ex, weight), bio, weight, ex), samples };
}

/** kontekst do obliczeń biomechanicznych: ciężar, masa ciała, progi, historia (lżejsze serie, 1RM, liczba powtórzeń dziś) */
export function bioCtx({ ex, weight, height, mass, thr, history, plate }) {
  const H = (history || []).filter(h => h.ex === ex);
  const best1rm = Math.max(0, ...H.map(h => h.summary?.est1rm || 0)) || null;
  const today = new Date().toISOString().slice(0, 10);
  const repsToday = (history || []).filter(h => (h.date || '').slice(0, 10) === today).reduce((a, h) => a + (h.summary?.n || 0), 0);
  return { ex, weight: +weight || null, height, mass, thr, history: H, best1rm, highRep: repsToday >= 100, plate };
}
/** dopisuje do podsumowania serii wyniki biomechaniczne; ostrzeżenia mogą wstrzymać zwiększanie ciężaru */
export function applyBio(sum, bio, weight, ex) {
  sum.bio = bio;
  if (!sum.n || !bio) return sum;
  const block = bio.flags.filter(f => f.key !== 'conf' && (f.status === 'bad' || f.key === 'half'));
  if (block.length && sum.verdict === 'up') {
    const w = +weight || null;
    sum.verdict = 'stay'; sum.nextWeight = w;
    sum.advice = `Technika w porządku, ale ${block[0].key === 'fatigue' ? 'widać wyraźne zmęczenie' : block[0].key === 'half' ? 'zakres ruchu jest za mały przy tym ciężarze' : block[0].key === 'shear' ? 'szacowane obciążenie kręgosłupa jest wysokie' : 'technika zmienia się pod ciężarem'} – zostań przy ${w ? String(w).replace('.', ',') + ' kg' : 'tym ciężarze'}.`;
  }
  const have = new Set(sum.tips);
  for (const f of bio.flags) if (!have.has(f.tip)) sum.tips.push(f.tip);
  return sum;
}
export { ANGLE_NOISE };
