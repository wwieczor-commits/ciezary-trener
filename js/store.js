/* Ciężary · Trener techniki – ustawienia i historia w localStorage (© Wojciech Wieczorek)
   Dane są zgodne ze starą aplikacją „BikeRc Siła” (ci-ary): przy pierwszym uruchomieniu historia i ustawienia
   są kopiowane z kluczy bikerc_sila_*_v1 (stare klucze zostają nietknięte). */
import { VOICE_DEFAULTS } from './coach.js';
import { EX } from './engine.js';
import { FATIGUE_DEFAULTS } from './biomech.js';

export const KEYS = { hist: 'ciezary_trener_history_v2', set: 'ciezary_trener_settings_v2', oldHist: 'bikerc_sila_history_v1', oldSet: 'bikerc_sila_settings_v1', migrated: 'ciezary_trener_migrated_v2' };
export const MAX_HIST = 300;
const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

export const DEFAULTS = {
  model: 'lite', dev: 'GPU', smooth: '1', height: '178', plateD: '45', blur: true, mirror: null, swap: false,
  ex: 'squat', weights: {}, vrate: '1', name: '', plan: '', coach: { ...VOICE_DEFAULTS },
  mass: '', thr: { vloss: { ...FATIGUE_DEFAULTS.vloss }, lean: FATIGUE_DEFAULTS.lean }
};

const validHist = e => e && typeof e === 'object' && e.ex && EX[e.ex] && e.summary && Array.isArray(e.reps) && typeof e.date === 'string';

/** jednorazowa, nieniszcząca migracja ze starej wersji */
export function migrate() {
  const out = { settings: false, hist: 0 };
  if (localStorage.getItem(KEYS.migrated)) return out;
  try {
    if (!localStorage.getItem(KEYS.set)) {
      const o = read(KEYS.oldSet, null);
      if (o && typeof o === 'object') {
        const s = { ...DEFAULTS, coach: { ...VOICE_DEFAULTS } };
        for (const k of ['model', 'dev', 'smooth', 'height', 'plateD', 'ex']) if (o[k] != null) s[k] = o[k];
        if (!EX[s.ex]) s.ex = 'squat';
        if (o.blur === false) s.blur = false;
        if (o.weights && typeof o.weights === 'object') s.weights = { ...o.weights };
        if (o.rate) s.vrate = String(o.rate);
        if (o.voice === false) s.coach.on = false;
        if (o.countdown === false) s.coach.countdown = 0;
        write(KEYS.set, s); out.settings = true;
      }
    }
    if (!localStorage.getItem(KEYS.hist)) {
      const o = read(KEYS.oldHist, []);
      if (Array.isArray(o)) { const a = o.filter(validHist); if (a.length) { write(KEYS.hist, a.slice(0, MAX_HIST)); out.hist = a.length; } }
    }
    localStorage.setItem(KEYS.migrated, new Date().toISOString());
  } catch (e) { console.warn('migracja', e); }
  return out;
}

export function loadSettings() {
  const s = read(KEYS.set, {});
  const m = { ...DEFAULTS, ...s, weights: { ...(s.weights || {}) }, coach: { ...VOICE_DEFAULTS, ...(s.coach || {}) },
    thr: { lean: s.thr?.lean ?? FATIGUE_DEFAULTS.lean, vloss: { ...FATIGUE_DEFAULTS.vloss, ...(s.thr?.vloss || {}) } } };
  if (!EX[m.ex]) m.ex = 'squat';
  return m;
}
export const saveSettings = s => write(KEYS.set, s);

export const loadHist = () => { const a = read(KEYS.hist, []); return Array.isArray(a) ? a.filter(validHist) : []; };
export function saveHistArr(a) { return write(KEYS.hist, a.slice(0, MAX_HIST)); }
/** wpis historii bez zdjęć i próbek – żeby zmieścić się w pamięci przeglądarki */
export const histEntry = set => ({ ...set, samples: undefined, reps: set.reps.map(r => ({ ...r, snap: null })) });
export function addHist(set) {
  const a = loadHist(); a.unshift(histEntry(set)); return saveHistArr(a) ? a : null;
}
export function removeHist(id) { const a = loadHist().filter(e => e.id !== id); saveHistArr(a); return a; }
export function clearHist() { saveHistArr([]); }

/** scala wpisy z obcej tablicy (import pliku lub stary klucz); zwraca liczbę dodanych */
export function mergeHist(inc) {
  if (!Array.isArray(inc)) throw new Error('not array');
  const a = loadHist(), ids = new Set(a.map(x => x.id)); let add = 0;
  for (const x of inc) if (validHist(x) && !ids.has(x.id)) { a.push(x); ids.add(x.id); add++; }
  a.sort((x, y) => y.date.localeCompare(x.date));
  saveHistArr(a); return add;
}
/** ile wpisów ze starej aplikacji nie ma jeszcze w nowej historii */
export function oldPending() {
  const o = read(KEYS.oldHist, []); if (!Array.isArray(o)) return 0;
  const ids = new Set(loadHist().map(x => x.id)); return o.filter(x => validHist(x) && !ids.has(x.id)).length;
}
export const importOld = () => mergeHist(read(KEYS.oldHist, []));
