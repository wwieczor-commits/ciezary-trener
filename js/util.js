/* Ciężary · Trener techniki – narzędzia wspólne (© Wojciech Wieczorek) */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const r1 = v => v == null || !isFinite(v) ? null : Math.round(v * 10) / 10;
export const f0 = v => v == null || !isFinite(v) ? '—' : String(Math.round(v));
export const f1 = v => v == null || !isFinite(v) ? '—' : (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
export const f2 = v => v == null || !isFinite(v) ? '—' : v.toFixed(2).replace('.', ',');
export const kg = v => v == null || !isFinite(v) ? '—' : String(Math.round(v * 10) / 10).replace('.', ',') + ' kg';
export const deg = r => r * 180 / Math.PI;
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function angBetween(a, b) { const d = a.x * b.x + a.y * b.y, m = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y); return m ? deg(Math.acos(Math.max(-1, Math.min(1, d / m)))) : null; }
export const median = a => { const b = a.filter(v => v != null && isFinite(v)).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
export const pct = (a, p) => { const b = a.filter(v => v != null && isFinite(v)).sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.max(0, Math.round(p * (b.length - 1))))] : null; };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lvl = (v, okMax, warnMax) => v == null ? 'na' : v <= okMax ? 'ok' : v <= warnMax ? 'warn' : 'bad';
export const worst = list => list.includes('bad') ? 'bad' : list.includes('warn') ? 'warn' : 'ok';
export function rrect(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
export const fmtDate = iso => { const d = new Date(iso); return d.toLocaleDateString('pl-PL') + ' ' + d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }); };
export const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

/* ---------- liczby słownie po polsku (do głosu trenera) ---------- */
const ONES = ['zero', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć', 'dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
const TENS = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
const HUND = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];
export function plInt(n) {
  n = Math.floor(Math.abs(n));
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[(n / 10) | 0] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return HUND[(n / 100) | 0] + (n % 100 ? ' ' + plInt(n % 100) : '');
  if (n >= 1000000) return String(n);
  const th = (n / 1000) | 0, r = n % 1000;
  const w = th === 1 ? 'tysiąc' : (th % 10 >= 2 && th % 10 <= 4 && !(th % 100 >= 12 && th % 100 <= 14)) ? 'tysiące' : 'tysięcy';
  return (th === 1 ? '' : plInt(th) + ' ') + w + (r ? ' ' + plInt(r) : '');
}
/** liczba (także z .5 i jednym miejscem po przecinku) słownie */
export function plNum(x) {
  if (x == null || !isFinite(x)) return '';
  const a = Math.abs(x), fl = Math.floor(a + 1e-9), fr = Math.round((a - fl) * 10) / 10;
  const sign = x < 0 ? 'minus ' : '';
  if (fr === 0) return sign + plInt(fl);
  if (fr === 0.5) return sign + (fl ? plInt(fl) + ' i pół' : 'pół');
  return sign + plInt(fl) + ' przecinek ' + plInt(Math.round(fr * 10));
}
export function plural(n, one, few, many) {
  n = Math.abs(Math.floor(n));
  if (n === 1) return one;
  const t = n % 10, h = n % 100;
  return (t >= 2 && t <= 4 && !(h >= 12 && h <= 14)) ? few : many;
}
/** liczba z rodzajem: 'f' (jedna/dwie), 'n' (jedno/dwa) */
export function plIntG(n, g) {
  let w = plInt(n);
  if (n >= 100 || n === 0) return w;
  if (g === 'f' && n % 10 === 2 && n % 100 !== 12) w = w.replace(/dwa$/, 'dwie');
  if (n % 100 !== 11 && n % 10 === 1 && n === 1) w = g === 'f' ? 'jedna' : g === 'n' ? 'jedno' : w;
  return w;
}
export const plReps = n => `${plIntG(n, 'n')} ${plural(n, 'powtórzenie', 'powtórzenia', 'powtórzeń')}`;
export const plSec = n => `${plIntG(n, 'f')} ${plural(n, 'sekunda', 'sekundy', 'sekund')}`;
export function plKg(w) {
  if (w == null || !isFinite(w)) return '';
  const fl = Math.floor(w + 1e-9), half = Math.abs(w - fl - 0.5) < 0.05;
  if (half) return (fl ? plInt(fl) + ' i pół' : 'pół') + ' kilograma';
  if (Math.abs(w - Math.round(w)) < 0.05) { const n = Math.round(w); return `${plInt(n)} ${plural(n, 'kilogram', 'kilogramy', 'kilogramów')}`; }
  return plNum(w) + ' kilograma';
}
export function plDuration(sec) {
  sec = Math.round(sec);
  if (sec < 60) return plSec(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  const mw = `${plIntG(m, 'f')} ${plural(m, 'minuta', 'minuty', 'minut')}`;
  return s ? `${mw} ${plSec(s)}` : mw;
}
const ORD_F = ['', 'pierwsza', 'druga', 'trzecia', 'czwarta', 'piąta', 'szósta', 'siódma', 'ósma', 'dziewiąta', 'dziesiąta'];
const ORD_ACC = ['', 'pierwszą', 'drugą', 'trzecią', 'czwartą', 'piątą', 'szóstą', 'siódmą', 'ósmą', 'dziewiątą', 'dziesiątą'];
const GEN = ['', 'jednej', 'dwóch', 'trzech', 'czterech', 'pięciu', 'sześciu', 'siedmiu', 'ośmiu', 'dziewięciu', 'dziesięciu'];
/** „pierwsza” (seria) – mianownik */ export const plOrd = n => ORD_F[n] || `numer ${plInt(n)}`;
/** „pierwszą” (serię) – biernik */ export const plOrdAcc = n => ORD_ACC[n] || `numer ${plInt(n)}`;
/** „trzech” – dopełniacz */ export const plGen = n => GEN[n] || plInt(n);
