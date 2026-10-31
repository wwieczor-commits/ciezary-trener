/* Ciężary · Trener techniki – głos trenera (© Wojciech Wieczorek)
   Voice  – silnik mowy: Web Speech API (speechSynthesis), wybór polskiego głosu z awaryjnym wariantem,
            kolejka z priorytetami, odblokowanie na iOS po dotknięciu, głośność / tempo / wysokość, wyciszenie.
   Trainer – „scenariusz” trenera: start, odliczanie, numer powtórzenia, uwagi do techniki, tempo, motywacja,
            odpoczynek z odliczaniem i podsumowanie serii, w trzech poziomach rozmowności. */
import { plInt, plIntG, plOrd, plOrdAcc, plGen, plReps, plSec, plKg, plDuration, plural } from './util.js';
import { EX } from './engine.js';

export const VOICE_DEFAULTS = { on: true, volume: 1, rate: 1.05, pitch: 1, voiceURI: '', level: 2, beep: false, countdown: 10, rest: 90, autoEnd: true, autoNext: true, sets: 3 };

const PREFERRED = [/zosia/i, /ewa\b/i, /paulina/i, /agnieszka/i, /marek/i, /krzysztof/i, /zofia/i, /google.*(polski|polish)|polish.*google/i];
const isPl = v => /^pl([-_]|$)/i.test(v.lang || '');

export class Voice {
  /** getSettings: () => {on, volume, rate, pitch, voiceURI, beep}; hooks: {onSay(text), onSpeaking(bool), onVoices()} */
  constructor(getSettings, hooks = {}) {
    this.get = getSettings; this.hooks = hooks;
    this.synth = (typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') ? speechSynthesis : null;
    this.supported = !!this.synth;
    this.voices = []; this.queue = []; this.current = null; this.unlocked = false;
    this.lastKey = {}; this.log = []; this.audio = null; this._pollN = 0;
    if (this.supported) {
      this.refresh();
      try { this.synth.addEventListener('voiceschanged', () => this.refresh()); } catch (e) { this.synth.onvoiceschanged = () => this.refresh(); }
      // część przeglądarek (iOS, Chrome) ładuje głosy z opóźnieniem i nie zawsze zgłasza zdarzenie
      this._poll = setInterval(() => { this.refresh(); if (this.voices.length || ++this._pollN > 24) clearInterval(this._poll); }, 500);
    }
  }
  refresh() {
    try { this.voices = this.synth.getVoices() || []; } catch (e) { this.voices = []; }
    this.hooks.onVoices?.();
  }
  get plVoices() { return this.voices.filter(isPl); }
  /** wybrany głos: ręczny wybór → najlepszy polski → null (wtedy lang = pl-PL, przeglądarka dobierze sama) */
  pick() {
    const s = this.get();
    if (s.voiceURI) { const v = this.voices.find(v => v.voiceURI === s.voiceURI); if (v) return v; }
    const pl = this.plVoices;
    if (!pl.length) return null;
    const score = v => {
      let sc = 0; const i = PREFERRED.findIndex(r => r.test(v.name)); if (i >= 0) sc += 50 - i;
      if (v.localService) sc += 20; if (/premium|enhanced|natural|neural/i.test(v.name)) sc += 15; if (/pl[-_]PL/i.test(v.lang)) sc += 5;
      return sc;
    };
    return [...pl].sort((a, b) => score(b) - score(a))[0];
  }
  status() {
    if (!this.supported) return { ok: false, text: 'Ta przeglądarka nie obsługuje mowy (speechSynthesis). Trener będzie pokazywał napisy.' };
    const v = this.pick();
    if (v) return { ok: true, voice: v, text: `Głos: ${v.name} (${v.lang})${v.localService ? '' : ' · online'}` };
    if (this.voices.length) return { ok: true, warn: true, text: 'Brak polskiego głosu na tym urządzeniu – użyję domyślnego (może mówić z obcym akcentem). iPhone: Ustawienia → Dostępność → Treść mówiona → Głosy → Polski. Android: Ustawienia → Zarządzanie ogólne → Zamiana tekstu na mowę.' };
    return { ok: true, warn: true, text: 'Szukam głosów… (jeśli lista się nie pojawi, trener użyje głosu domyślnego)' };
  }

  /** wywołaj w reakcji na dotknięcie – iOS odblokowuje mowę i dźwięk dopiero po geście użytkownika */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    try { if (this.supported) { this.synth.resume?.(); const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'pl-PL'; this.synth.speak(u); } } catch (e) {}
    try { this._ctx(); } catch (e) {}
  }
  _ctx() {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    if (!this.audio) this.audio = new AC();
    if (this.audio.state === 'suspended') this.audio.resume().catch(() => {});
    return this.audio;
  }
  beep(freq = 880, ms = 120, vol = .25) {
    if (!this.get().beep || !this.get().on) return;
    try {
      const a = this._ctx(); if (!a) return;
      const o = a.createOscillator(), g = a.createGain(); o.frequency.value = freq; o.type = 'sine';
      g.gain.value = 0; o.connect(g); g.connect(a.destination);
      const t = a.currentTime, v = vol * (this.get().volume ?? 1);
      g.gain.linearRampToValueAtTime(v, t + .01); g.gain.linearRampToValueAtTime(0, t + ms / 1000); o.start(t); o.stop(t + ms / 1000 + .02);
    } catch (e) {}
  }

  /** prio: 0 – tło (pomijane, gdy trener mówi), 1 – zwykły (kolejka), 2 – pilny (przerywa); group – nowszy zastępuje starszy z kolejki */
  say(text, o = {}) {
    const s = this.get(), prio = o.prio ?? 1;
    if (!text) return false;
    const now = Date.now();
    if (o.key && o.minGap && this.lastKey[o.key] && now - this.lastKey[o.key] < o.minGap) return false;
    if (o.key) this.lastKey[o.key] = now;
    this.log.push({ t: now, text, prio, spoken: !!(s.on || o.force) }); if (this.log.length > 300) this.log.shift();
    this.hooks.onSay?.(text, o);       // napisy – także przy wyciszeniu
    if (!s.on && !o.force) return false;
    if (!this.supported) return false;
    const item = { text, prio, ttl: o.ttl ?? 6000, t: now, group: o.group, force: !!o.force, rate: o.rate };
    if (prio >= 2) { this.queue = []; this._cancelCurrent(); this.queue.push(item); this._pump(true); return true; }
    if (prio === 0 && (this.current || this.queue.length)) return false;
    if (item.group) this.queue = this.queue.filter(q => q.group !== item.group);
    this.queue.push(item);
    while (this.queue.length > 3) { const i = this.queue.findIndex(q => q.prio === 0); this.queue.splice(i >= 0 ? i : 0, 1); }
    this._pump(false);
    return true;
  }
  _cancelCurrent() {
    const c = this.current; this.current = null; clearTimeout(this._guard);
    if (c && c.u) { c.u.onend = c.u.onerror = null; c.u.onstart = null; }
    try { this.synth.cancel(); } catch (e) {}
  }
  cancel() { this.queue = []; this._cancelCurrent(); this.hooks.onSpeaking?.(false); }
  _pump(afterCancel) {
    if (this.current || !this.queue.length) return;
    let item; const now = Date.now();
    while ((item = this.queue.shift())) { if (now - item.t <= item.ttl) break; item = null; }
    if (!item) { this.hooks.onSpeaking?.(false); return; }
    const cur = { u: null, item };
    const go = () => { if (this.current === cur) this._speak(item); };
    this.current = cur;           // zajmij kolejkę od razu (speak() może ruszyć z opóźnieniem po cancel)
    if (afterCancel) setTimeout(go, 40); else go();
  }
  _speak(item) {
    const s = this.get();
    let u;
    try {
      u = new SpeechSynthesisUtterance(item.text);
      u.lang = 'pl-PL';
      const v = this.pick(); if (v) { u.voice = v; if (v.lang) u.lang = v.lang; }
      u.volume = Math.max(0, Math.min(1, s.volume ?? 1)); u.rate = Math.max(.5, Math.min(2, item.rate || s.rate || 1)); u.pitch = Math.max(.5, Math.min(2, s.pitch || 1));
    } catch (e) { this.current = null; return; }
    const done = () => { if (this.current?.u !== u) return; this.current = null; clearTimeout(this._guard); this.hooks.onSpeaking?.(false); this._pump(false); };
    u.onstart = () => this.hooks.onSpeaking?.(true);
    u.onend = done; u.onerror = done;
    this.current = { u, item };
    // zabezpieczenie: niektóre przeglądarki (iOS, Chrome po uśpieniu) nie zgłaszają końca wypowiedzi
    clearTimeout(this._guard);
    this._guard = setTimeout(done, Math.min(25000, 2500 + item.text.length * 110 / (u.rate || 1)));
    try { this.synth.resume?.(); this.synth.speak(u); this.hooks.onSpeaking?.(true); } catch (e) { done(); }
  }
  test() {
    this.unlock();
    return this.say('Cześć! Jestem Twoim trenerem. Powtórzenie trzy. Głębiej, biodro pod kolano. Dobra robota!', { prio: 2, force: true });
  }
}

/* ---------- zdania trenera ---------- */
const PRAISE = ['Dobrze', 'Czysto', 'Świetnie', 'Tak trzymaj', 'Dobra technika', 'Ładnie', 'Mocno', 'Znakomicie'];
const PUSH = ['Dasz radę', 'Jeszcze trochę', 'Mocno, nie odpuszczaj', 'Trzymaj napięcie', 'Oddychaj i pchaj'];
const REST_TIPS = ['Oddychaj spokojnie i rozluźnij ramiona.', 'Napij się wody.', 'Przemyśl poprzednią serię i poprawiaj jedną rzecz naraz.', 'Chodź powoli, nie siadaj na długo.'];
const lc = t => t ? t.charAt(0).toLowerCase() + t.slice(1) : t;

export class Trainer {
  /** getCtx: () => {level, ex, plan, weight, setNo, sets} */
  constructor(voice, getCfg) { this.v = voice; this.cfg = getCfg; this.rot = {}; this.setupState = null; this.reset(); }
  reset() { this.vels = []; this.lastMot = 0; this.noMotionSaid = false; this.goodStreak = 0; }
  get L() { return this.cfg().level ?? 2; }
  pickFrom(key, arr) { const i = ((this.rot[key] ?? -1) + 1 + Math.floor(Math.random() * 2)) % arr.length; this.rot[key] = i; return arr[i]; }
  say(t, o) { return this.v.say(t, o); }

  /* --- ustawienie kadru --- */
  setup(ok, msg) {
    if (this.L < 2) return;
    if (ok) {
      if (this.setupState !== true) { this.setupState = true; this.say('Ustawienie dobre. Możesz zaczynać.', { key: 'setupok', minGap: 20000, prio: 1, ttl: 3000 }); }
    } else {
      this.setupState = false;
      this.say(msg.replace(/ – /g, ', ').replace(/\./g, ''), { key: 'setupbad', minGap: 9000, prio: 1, ttl: 3000 });
    }
  }
  resetSetup() { this.setupState = null; }

  /* --- start serii --- */
  intro(first) {
    const c = this.cfg(), E = EX[c.ex];
    if (this.L < 2) return '';
    let t = `${(c.setNo || 1) <= 10 ? 'Seria ' + plOrd(c.setNo || 1) : 'Seria ' + plOrd(c.setNo)}${c.sets && c.sets <= 10 ? ' z ' + plGen(c.sets) : ''}. ${E.say[0].toUpperCase() + E.say.slice(1)}`;
    if (c.weight) t += `, ${plKg(c.weight)}`;
    if (c.plan) t += `, ${plReps(c.plan)}`;
    t += '.';
    if (this.L >= 3 && first) t += ' ' + E.intro[0];
    return t;
  }
  countdown(n, total, first) {
    if (n === total) {
      const t = this.intro(first);
      this.say((t ? t + ' ' : '') + (this.L >= 2 ? `Start za ${plSec(total)}.` : `${plSec(total)}.`), { prio: 2, force: false });
    } else if (n <= 3 && n >= 1) { this.say(plInt(n), { prio: 2, ttl: 900 }); this.v.beep(660, 90); }
    else if (n === 5 && total > 6 && this.L >= 2) this.say('Pięć', { prio: 1, ttl: 1200 });
  }
  go() { this.reset(); this.v.beep(1100, 280); this.say('Start!', { prio: 2 }); }
  /** nagrywanie rozpoczęte bez odliczania (np. film) */
  goSilent() { this.reset(); }

  /* --- powtórzenie --- */
  rep(rep, n, plan, vBest) {
    const c = this.cfg(), L = this.L, E = EX[c.ex];
    const parts = [plInt(n)];
    if (rep.vel) this.vels.push(rep.vel);
    const left = plan ? plan - n : null;
    if (plan && n === plan && L >= 2) parts.push('To ostatnie!');
    else if (plan && left === 1 && L >= 2) parts.push('Jeszcze jedno');
    else if (plan && plan >= 6 && n === Math.ceil(plan / 2) && L >= 2) parts.push('Połowa');
    const corr = rep.main?.cue;
    let tempo = null;
    if (L >= 2) {
      if ((c.ex === 'squat' || c.ex === 'bench') && rep.tDown != null && rep.tDown < 0.7) tempo = 'Wolniej w dół, kontroluj opuszczanie';
      else if (vBest && rep.vel && n >= 3 && rep.vel < vBest * 0.7) tempo = 'Prędkość spada';
    }
    if (corr && L >= 2) { parts.push(corr); if (tempo && L >= 3) parts.push(tempo); this.goodStreak = 0; }
    else if (tempo) { parts.push(tempo); this.goodStreak = 0; }
    else if (!corr) {
      this.goodStreak++;
      if (L >= 3 && !(plan && n === plan)) parts.push(this.goodStreak >= 3 ? 'Seria czystych powtórzeń' : this.pickFrom('praise', PRAISE));
      else if (L === 2 && this.goodStreak >= 2 && n % 2 === 0 && !(plan && n === plan)) parts.push(this.pickFrom('praise', PRAISE.slice(0, 5)));
    }
    this.say(parts.join('. ') + '.', { prio: 1, group: 'rep', ttl: 4000 });
    // motywacja w trakcie serii (tylko poziom „dużo”, nie za często)
    if (L >= 3 && plan && left >= 2 && Date.now() - this.lastMot > 14000 && Math.random() < .5) { this.lastMot = Date.now(); this.say(this.pickFrom('push', PUSH), { prio: 0 }); }
  }
  lost() { if (this.L >= 2) this.say('Nie widzę Cię. Wróć do kadru.', { key: 'lost', minGap: 12000, prio: 1, ttl: 2500 }); }
  noMotion() { if (this.L >= 2 && !this.noMotionSaid) { this.noMotionSaid = true; this.say('Czekam na pierwsze powtórzenie.', { prio: 1, ttl: 3000 }); } }
  planDone(auto) { if (this.L >= 1) this.say(auto ? 'Seria zrobiona. Odłóż sztangę.' : 'Seria zrobiona.', { prio: 1, ttl: 4000 }); }

  /* --- podsumowanie serii --- */
  summaryText(set, setNo, sets) {
    const S = set.summary, L = this.L;
    if (!S.n) return 'Koniec serii. Nie wykryłam powtórzeń. Sprawdź ustawienie telefonu.'.replace('wykryłam', 'wykryto');
    let t = `Koniec serii. ${plReps(S.n)}.`;
    if (L >= 2) {
      t += ` Ocena techniki: ${plInt(S.score)} na sto.`;
      t += S.mainIssue ? ` Najważniejsze do poprawy: ${lc(S.mainIssue.cue)}.` : ' Technika bardzo dobra.';
      if (S.nextWeight && set.weight) {
        if (S.verdict === 'up') t += ` Następnym razem ${plKg(S.nextWeight)}.`;
        else if (S.verdict === 'down') t += ` Zmniejsz ciężar do ${plKg(S.nextWeight)}.`;
        else t += ` Zostań przy ${plKg(S.nextWeight)}.`;
      }
    }
    if (L >= 3) {
      if (S.loss != null && S.loss > 15) t += ` Prędkość spadła o ${plInt(Math.round(S.loss))} procent.`;
      if (S.est1rm) t += ` Szacowany maksymalny ciężar: ${plKg(S.est1rm)}.`;
      if (!S.mainIssue && S.score >= 90) t += ' Świetna robota!';
    }
    return t;
  }
  setEnd(set, setNo, sets) { const t = this.summaryText(set, setNo, sets); this.say(t, { prio: 2 }); return t; }

  /* --- odpoczynek --- */
  restStart(sec, setNo, sets) {
    if (this.L < 1) return;
    this.say(`Odpoczynek, ${plDuration(sec)}.`, { prio: 1, ttl: 15000 });
    this._tips = [...REST_TIPS]; this._tipDone = false;
  }
  restTick(left, total) {
    const L = this.L;
    if (left <= 3 && left >= 1) { if (L >= 2) this.say(plInt(left), { prio: 2, ttl: 900 }); this.v.beep(660, 90); }
    else if (left === 60 && total > 75 && L >= 2) this.say('Minuta do końca przerwy.', { prio: 1, ttl: 2500 });
    else if (left === 30 && total > 40 && L >= 2) this.say('Trzydzieści sekund.', { prio: 1, ttl: 2500 });
    else if (left === 10 && total > 15 && L >= 2) this.say('Dziesięć sekund. Przygotuj się.', { prio: 1, ttl: 2500 });
    else if (L >= 3 && total >= 60 && left === Math.round(total * 0.6) && !this._tipDone) { this._tipDone = true; this.say(this.pickFrom('rest', REST_TIPS), { prio: 0 }); }
  }
  restEnd(setNo, sets) {
    this.v.beep(1100, 300);
    const done = sets && setNo > sets;
    this.say(this.L >= 2 ? `Czas na ${setNo <= 10 ? plOrdAcc(setNo) + ' serię' : 'serię ' + plOrdAcc(setNo)}. Podejdź do sztangi.` : 'Czas na kolejną serię.', { prio: 2 });
  }
  sessionDone(setsDone, avgScore) {
    let t = `Trening zakończony. ${plIntG(setsDone, 'f')} ${plural(setsDone, 'seria', 'serie', 'serii')}.`;
    if (avgScore != null && this.L >= 2) t += ` Średnia ocena techniki: ${plInt(avgScore)} na sto.`;
    t += ' Dobra robota!';
    this.say(t, { prio: 1, ttl: 20000 });
  }
  muteToggled(on) { this.v.say(on ? 'Głos trenera włączony.' : '', { prio: 2, force: true }); }
}
