/* Ciężary · Trener techniki – aplikacja (© Wojciech Wieczorek)
   Kamera / film → MediaPipe Pose → silnik analizy → głosowy trener, raport PDF, historia. Wszystko lokalnie w przeglądarce. */
import { $, $$, esc, f0, f1, f2, kg, rrect, fmtDate, mmss, clamp } from './util.js';
import { IDX, BONES, EX, LEG_RATIO, TORSO_RATIO, makeFilters, pickPerson, FeatureExtractor, RepFSM, scaleOf, analyzeRep, buildSetData } from './engine.js';
import { Voice, Trainer, VOICE_DEFAULTS } from './coach.js';
import { barPathSVG, velSVG, reportHTML, makePdf, loadPdfLib } from './report.js';
import * as store from './store.js';

const TEST = new URLSearchParams(location.search).has('test');
const VIS_MIN = .5;
const MP_VER = '0.10.21';
const CDN = {
  lib: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`,
  wasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`,
  model: m => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m}/float16/latest/pose_landmarker_${m}.task`
};
const LOCAL = {
  lib: new URL('../assets/mediapipe/vision_bundle.mjs', import.meta.url).href,
  wasm: new URL('../assets/mediapipe/wasm', import.meta.url).href,
  model: m => (m === 'lite' || m === 'full') ? new URL(`../assets/mediapipe/pose_landmarker_${m}.task`, import.meta.url).href : null
};
const ICONS = {
  squat: '<circle cx="12" cy="4" r="1.8"/><path d="M5 7h14M12 6v5l-3.5 3.5V20M12 11l3.5 3.5V20"/>',
  deadlift: '<circle cx="15" cy="4" r="1.8"/><path d="M14 6l-5 5 1 4-1 5M9 11l5 0M3 21h18M4 17h3M17 17h3"/>',
  press: '<circle cx="12" cy="7" r="1.8"/><path d="M5 3h14M8 3v4M16 3v4M12 9v6M12 15l-3 6M12 15l3 6"/>',
  bench: '<circle cx="5" cy="11" r="1.8"/><path d="M3 14h16M8 14v5M16 14v5M10 8v3M14 8v3M8 8h8"/>'
};

/* =========================================================
   STAN
   ========================================================= */
const migrated = store.migrate();
const S = store.loadSettings();
const saveS = () => store.saveSettings(S);
let ex = S.ex;
let src = null, fileName = '', fileUrl = null, stream = null, facing = 'environment';
let landmarker = null, PoseLandmarker = null, fileset = null, loadToken = 0;
let running = false, lastVidTime = -1, lastTs = 0, fpsN = 0, fpsT = performance.now(), lastUi = 0;
let pts = null, cur = null, person = null, maskOk = false, maskImg = null, nPeople = 0;
let setup = { ok: false, msg: '' }, setupSince = 0, setupKey = '', lastSeen = 0;
let filters = makeFilters(+S.smooth);
const fx = new FeatureExtractor();
let detEma = 0, lastRateAdj = 0;
let recording = false, cdEnd = 0, cdTotal = 0, cdLast = 0, recStart = 0, recBegan = 0;
let samples = [], fsm = new RepFSM(), liveReps = [], snaps = [], snapBest = -1, snapPending = false, snapCanvas = null;
let planDoneAt = 0, planDoneNote = 0;
let lastSet = null, cueText = '', cueClass = '', cueUntil = 0;
let wakeLock = null;
let sess = { setNo: 1, done: [], finished: false, introDone: false };
let rest = null;           // {end, total, last}
const plate = { on: false, mode: 0, ppc: null, tpl: null, r: 0, cx: 0, cy: 0, k: 1, half: 16, lost: 0, vx: 0, vy: 0, off: null };

const video = $('#video'), canvas = $('#view'), ctx = canvas.getContext('2d');
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const planN = () => Math.max(0, parseInt(S.plan) || 0);
const setsN = () => clamp(parseInt(S.coach.sets) || 1, 1, 20);
const weightN = () => { const v = parseFloat(String(S.weights[ex] ?? '').replace(',', '.')); return isFinite(v) && v > 0 ? v : null; };
const lvlOfStatus = s => s === 'ok' || s === 'warn' || s === 'bad' ? s : '';

function toast(t, ms = 2600, err) {
  const el = $('#toast'); el.textContent = t; el.className = 'show' + (err ? ' err' : '');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), ms);
}
function setStatus(t, cls) { $('#statusTxt').textContent = t; $('#status').className = 'pill ' + (cls || ''); }

/* =========================================================
   GŁOS TRENERA
   ========================================================= */
let capTimer = 0;
function onSay(text) {
  if (!text) return;
  const cap = $('#caption'); cap.textContent = text; cap.hidden = false;
  cap.style.animation = 'none'; void cap.offsetWidth; cap.style.animation = '';
  clearTimeout(capTimer); capTimer = setTimeout(() => { cap.hidden = true; }, 2500 + text.length * 45);
  const ol = $('#spokenLog'); if (ol.firstElementChild?.classList.contains('muted')) ol.innerHTML = '';
  const li = document.createElement('li');
  li.innerHTML = `<time>${new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>${esc(text)}`;
  ol.prepend(li); while (ol.children.length > 25) ol.lastChild.remove();
}
const voice = new Voice(() => S.coach, {
  onSay,
  onSpeaking: b => $('#voicePill').classList.toggle('speaking', !!b),
  onVoices: () => { try { renderVoices(); } catch (e) { /* konstruktor wywołuje to przed inicjalizacją */ } }
});
const trainer = new Trainer(voice, () => ({ level: S.coach.level, ex, plan: planN(), weight: weightN(), setNo: sess.setNo, sets: setsN() }));

function renderVoices() {
  const sel = $('#voiceSel'); if (!sel) return;
  const pl = voice.plVoices, other = voice.voices.filter(v => !pl.includes(v));
  const auto = voice.pick();
  const opt = v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})${v.localService ? '' : ' · online'}</option>`;
  sel.innerHTML = `<option value="">Automatycznie${auto ? ' – ' + esc(auto.name) : ''}</option>` +
    (pl.length ? `<optgroup label="Polskie">${pl.map(opt).join('')}</optgroup>` : '') +
    (other.length ? `<optgroup label="Pozostałe języki">${other.map(opt).join('')}</optgroup>` : '');
  sel.value = S.coach.voiceURI && voice.voices.some(v => v.voiceURI === S.coach.voiceURI) ? S.coach.voiceURI : '';
  const st = voice.status(), el = $('#voiceInfo');
  el.textContent = st.text; el.className = 'voiceinfo ' + (st.ok ? (st.warn ? 'warn' : 'ok') : 'warn');
}
const LEVEL_DESC = {
  1: 'Minimum: tylko odliczanie, numer powtórzenia, koniec serii i przerwa.',
  2: 'Normalny: przedstawienie serii, uwagi do techniki, tempo, wskazówki ustawienia kadru i ocena po serii.',
  3: 'Rozmowny: do tego pochwały, motywacja w trakcie serii, porady na przerwie i szacowany maksymalny ciężar.'
};
function syncCoachUI() {
  const c = S.coach;
  $('#vOn').checked = c.on; $('#vBeep').checked = c.beep;
  $('#vVol').value = c.volume; $('#vRate').value = c.rate; $('#vPitch').value = c.pitch;
  $('#volV').textContent = Math.round(c.volume * 100) + '%'; $('#rateV').textContent = c.rate.toFixed(2).replace('.', ',') + '×'; $('#pitchV').textContent = c.pitch.toFixed(2).replace('.', ',');
  $$('#segLevel button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.l === c.level)));
  $('#levelDesc').textContent = LEVEL_DESC[c.level];
  $('#cCount').value = String(c.countdown); $('#cRest').value = String(c.rest);
  $('#cAutoEnd').checked = c.autoEnd; $('#cAutoNext').checked = c.autoNext;
  $('#voiceState').textContent = c.on ? 'włączony' : 'wyciszony';
  const vp = $('#voicePill'); vp.setAttribute('aria-pressed', String(c.on));
  vp.setAttribute('aria-label', c.on ? 'Głos trenera: włączony. Dotknij, aby wyciszyć' : 'Głos trenera: wyciszony. Dotknij, aby włączyć');
  $('#voicePillT').textContent = c.on ? 'Trener' : 'Cisza';
  $('#sMute').textContent = c.on ? '🔊' : '🔇'; $('#sMute').classList.toggle('off', !c.on);
}
function setVoiceOn(on, fromTap = true) {
  if (fromTap) voice.unlock();
  S.coach.on = on; saveS(); syncCoachUI();
  if (!on) voice.cancel(); else trainer.muteToggled(true);
}
function initCoachUI() {
  const opts = (sel, arr, fmt) => { $(sel).innerHTML = arr.map(v => `<option value="${v}">${fmt(v)}</option>`).join(''); };
  opts('#cCount', [0, 5, 8, 10, 15, 20], v => v ? v + ' s' : 'bez odliczania');
  opts('#cRest', [0, 30, 45, 60, 90, 120, 180, 240], v => v ? (v >= 60 ? (v / 60).toString().replace('.', ',') + ' min' + (v % 60 ? ' (' + v + ' s)' : '') : v + ' s') : 'bez przerwy');
  const upd = () => { saveS(); syncCoachUI(); };
  $('#vOn').onchange = e => setVoiceOn(e.target.checked);
  $('#voicePill').onclick = () => setVoiceOn(!S.coach.on);
  $('#sMute').onclick = () => setVoiceOn(!S.coach.on);
  $('#vBeep').onchange = e => { voice.unlock(); S.coach.beep = e.target.checked; upd(); if (S.coach.beep) voice.beep(880, 150); };
  $('#vVol').oninput = e => { S.coach.volume = +e.target.value; upd(); };
  $('#vRate').oninput = e => { S.coach.rate = +e.target.value; upd(); };
  $('#vPitch').oninput = e => { S.coach.pitch = +e.target.value; upd(); };
  ['vVol', 'vRate', 'vPitch'].forEach(id => $('#' + id).onchange = () => voice.test());
  $('#voiceSel').onchange = e => { S.coach.voiceURI = e.target.value; upd(); renderVoices(); voice.test(); };
  $$('#segLevel button').forEach(b => b.onclick = () => { S.coach.level = +b.dataset.l; upd(); });
  $('#cCount').onchange = e => { S.coach.countdown = +e.target.value; upd(); };
  $('#cRest').onchange = e => { S.coach.rest = +e.target.value; upd(); };
  $('#cAutoEnd').onchange = e => { S.coach.autoEnd = e.target.checked; upd(); };
  $('#cAutoNext').onchange = e => { S.coach.autoNext = e.target.checked; upd(); };
  $('#vTest').onclick = () => { voice.test(); };
  $('#vStop').onclick = () => voice.cancel();
  syncCoachUI(); renderVoices();
}

/* ---------- ekran nie gaśnie ---------- */
async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {} }
function releaseWake() { try { wakeLock?.release(); } catch (e) {} wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && src) keepAwake(); });

/* =========================================================
   MODEL (MediaPipe Pose) – najpierw pliki lokalne, potem CDN
   ========================================================= */
async function loadModel() {
  const my = ++loadToken, kind = S.model;
  setStatus(`Ładowanie modelu ${kind}…`, 'busy');
  try {
    if (!fileset) {
      let m, wasm;
      try { m = await import(LOCAL.lib); wasm = LOCAL.wasm; }
      catch (e) { console.warn('lokalna biblioteka niedostępna, CDN', e); m = await import(CDN.lib); wasm = CDN.wasm; }
      PoseLandmarker = m.PoseLandmarker; fileset = await m.FilesetResolver.forVisionTasks(wasm);
    }
    const mk = (path, delegate) => PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: path, delegate }, runningMode: 'VIDEO', numPoses: 3, outputSegmentationMasks: true, minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .5 });
    const paths = [LOCAL.model(kind), CDN.model(kind)].filter(Boolean);
    let lm = null, dev = S.dev, err;
    for (const path of paths) {
      try { lm = await mk(path, dev); break; }
      catch (e) { err = e; if (dev !== 'CPU') { try { dev = 'CPU'; lm = await mk(path, 'CPU'); break; } catch (e2) { err = e2; } } }
    }
    if (!lm) throw err || new Error('model');
    if (my !== loadToken) { lm.close(); return; }
    const old = landmarker; landmarker = lm; if (old) try { old.close(); } catch (e) {}
    setStatus(`Pose ${kind} · ${dev}`, 'ok');
  } catch (e) {
    console.error(e);
    if (my === loadToken) { setStatus('Błąd modelu – sprawdź internet', 'err'); toast('Nie udało się załadować modelu pozy. Spróbuj odświeżyć stronę.', 5000, true); }
  }
}

/* =========================================================
   KAMERA I FILM
   ========================================================= */
function secureOk() { if (window.isSecureContext) return true; toast('Kamera działa tylko na stronie https://. Użyj „Film z galerii”.', 6000, true); return false; }
function resetFilters() { filters = makeFilters(+S.smooth); fx.reset(); }
function showStage(on) { $('#empty').hidden = on; }
function updateRecBtn() {
  const b = $('#recBtn');
  b.disabled = !src;
  $('#plateBtn').disabled = !src;
  $('#personBtn').hidden = !(src && nPeople > 1);
  $('#sFlip').hidden = src !== 'cam';
  if (recording) { b.textContent = src === 'file' ? 'Zatrzymaj analizę' : cdEnd ? 'Anuluj' : 'Koniec serii'; b.classList.add('on'); }
  else { b.textContent = src === 'file' ? 'Analizuj film' : rest ? 'Start teraz' : `Start serii ${sess.finished ? 1 : sess.setNo}`; b.classList.remove('on'); }
  $('#camBtn').textContent = src === 'cam' ? '⏹ Zatrzymaj kamerę' : '📷 Kamera';
  $('#camBtn').classList.toggle('on', src === 'cam');
}
async function startCam() {
  voice.unlock();
  if (!navigator.mediaDevices?.getUserMedia) { if (secureOk()) toast('Ta przeglądarka nie daje dostępu do kamery.', 4000, true); return; }
  stopAll();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } } });
    video.srcObject = stream; video.muted = true; await video.play();
    src = 'cam'; fileName = ''; $('#mirror').checked = facing === 'user';
    $('#vctl').hidden = true; showStage(true);
    keepAwake(); startLoop(); updateRecBtn();
    trainer.resetSetup(); setupKey = ''; setupSince = 0;
  } catch (e) {
    console.error(e);
    if (e.name === 'NotAllowedError') toast('Brak zgody na kamerę. Ustawienia przeglądarki → Kamera → Pozwól.', 6000, true);
    else if (!secureOk()) { /* komunikat już pokazany */ }
    else toast('Nie udało się włączyć kamery: ' + (e.message || e.name), 5000, true);
  }
}
function stopAll() {
  if (recording) finishSet({ silent: true });
  stopRest(true);
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.pause(); video.srcObject = null;
  if (fileUrl) { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(fileUrl); fileUrl = null; }
  $('#vctl').hidden = true;
  src = null; pts = null; cur = null; person = null; maskOk = false; nPeople = 0; plateOff();
  showStage(false); releaseWake(); updateRecBtn();
}
function openFile(f) {
  voice.unlock(); stopAll();
  fileUrl = URL.createObjectURL(f); fileName = f.name;
  video.src = fileUrl; video.loop = false; video.muted = true;
  src = 'file'; $('#mirror').checked = false;
  video.onloadeddata = () => {
    video.onloadeddata = null;
    $('#vctl').hidden = false; $('#vName').textContent = f.name; video.playbackRate = +S.vrate || 1;
    $$('#segSpeed button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.r === (+S.vrate || 1))));
    showStage(true); startLoop(); updateFileBar(); updateRecBtn();
    video.play().then(() => video.pause()).catch(() => {});
    toast('Przewiń do początku serii, ewentualnie zaznacz talerz i dotknij „Analizuj film”.', 5000);
  };
  video.onerror = () => {
    video.onerror = null; if (src !== 'file') return;
    const mov = /\.(mov|hevc)$/i.test(f.name);
    toast(mov ? 'Ta przeglądarka nie odtwarza tego filmu (iPhone nagrywa w HEVC). Zmień format aparatu na „Najbardziej zgodny” albo otwórz aplikację w Safari.' : 'Ta przeglądarka nie odtwarza tego formatu filmu. Spróbuj pliku MP4.', 9000, true);
    stopAll(); running = false;
  };
  video.load();
}
function updateFileBar() {
  if (!video.duration || !isFinite(video.duration)) return;
  $('#vSeek').value = video.currentTime / video.duration * 1000;
  $('#vTime').textContent = `${mmss(video.currentTime)} / ${mmss(video.duration)}`;
}
function initSource() {
  $('#camBtn').onclick = () => { if (src === 'cam') { stopAll(); running = false; } else startCam(); };
  $('#emptyCam').onclick = startCam;
  $('#emptyFile').onclick = () => $('#fileIn').click();
  $('#fileBtn').onclick = () => $('#fileIn').click();
  $('#fileIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openFile(f); };
  ['dragover', 'drop'].forEach(n => $('#stage').addEventListener(n, e => { e.preventDefault(); if (n === 'drop') { const f = e.dataTransfer.files[0]; if (f) openFile(f); } }));
  $('#sFlip').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; toast(facing === 'user' ? 'Kamera przednia' : 'Kamera tylna'); if (src === 'cam') startCam(); };
  $('#vPlay').onclick = () => { if (video.paused) { video.play().catch(() => {}); keepAwake(); } else video.pause(); };
  video.addEventListener('play', () => { $('#vPlay').textContent = '⏸'; });
  video.addEventListener('pause', () => { $('#vPlay').textContent = '▶'; });
  video.addEventListener('ended', () => { $('#vPlay').textContent = '▶'; if (recording && src === 'file') finishSet(); });
  $('#vSeek').oninput = e => { if (video.duration) { video.currentTime = e.target.value / 1000 * video.duration; lastVidTime = -1; } };
  $('#vStart').onclick = () => { video.currentTime = 0; lastVidTime = -1; };
  const step = d => { video.pause(); video.currentTime = clamp(video.currentTime + d / 30, 0, video.duration || 0); lastVidTime = -1; };
  $('#vBack').onclick = () => step(-1); $('#vFwd').onclick = () => step(1);
  $$('#segSpeed button').forEach(b => b.onclick = () => { S.vrate = b.dataset.r; video.playbackRate = +S.vrate; $$('#segSpeed button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); saveS(); });
  $('#personBtn').onclick = () => toast('Dotknij sylwetkę osoby, którą mam śledzić.', 3500);
  // pełny ekran
  const stage = $('#stage');
  const isFs = () => document.fullscreenElement === stage || document.webkitFullscreenElement === stage || stage.classList.contains('fake-fs');
  $('#sFs').onclick = async () => {
    if (isFs()) { stage.classList.remove('fake-fs'); try { await (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } catch (e) {} return; }
    const rq = stage.requestFullscreen || stage.webkitRequestFullscreen;
    try { if (!rq) throw 0; await rq.call(stage); } catch (e) { stage.classList.add('fake-fs'); }
  };
}

/* =========================================================
   PĘTLA ANALIZY
   ========================================================= */
function startLoop() { resetFilters(); lastVidTime = -1; if (!running) { running = true; requestAnimationFrame(loop); } }
function loop() {
  if (!running) return;
  requestAnimationFrame(loop);
  if (document.hidden || video.readyState < 2 || !video.videoWidth) return;
  const w = video.videoWidth, h = video.videoHeight;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  if (landmarker && video.currentTime !== lastVidTime) {
    lastVidTime = video.currentTime;
    let ts = performance.now(); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts;
    let res; const d0 = performance.now();
    try { res = landmarker.detectForVideo(video, ts); } catch (e) { console.warn(e); }
    detEma = detEma ? detEma * .8 + (performance.now() - d0) * .2 : performance.now() - d0;
    const t = src === 'cam' ? ts / 1000 : video.currentTime;
    const L = res?.landmarks || [];
    nPeople = L.length;
    const pk = L.length ? pickPerson(L, t, person) : { k: -1, person };
    person = pk.person;
    if (pk.k >= 0) { lastSeen = performance.now(); updateMask(res.segmentationMasks?.[pk.k]); process(L[pk.k], w, h, t); }
    else { pts = null; cur = null; maskOk = false; setup = { ok: false, msg: 'Nie widzę sylwetki – stań w kadrze' }; }
    res?.segmentationMasks?.forEach(m => { try { m.close(); } catch (e) {} });
    fpsN++;
  }
  // analiza filmu: zwalniaj odtwarzanie, żeby wolniejszy telefon nie gubił klatek (cel ≥ 15 analiz na sekundę filmu)
  if (src === 'file' && recording && !video.paused && detEma && performance.now() - lastRateAdj > 400) {
    lastRateAdj = performance.now();
    const want = Math.max(.1, Math.min(+S.vrate || 1, 1 / (15 * detEma / 1000)));
    if (Math.abs(video.playbackRate - want) > .03) video.playbackRate = want;
  } else if (src === 'file' && !recording && video.playbackRate !== (+S.vrate || 1)) video.playbackRate = +S.vrate || 1;
  draw(w, h);
  if (snapPending) { snapPending = false; grabSnap(); }
  const now = performance.now();
  if (now - fpsT > 1000) { $('#bFps').textContent = Math.round(fpsN * 1000 / (now - fpsT)) + ' fps'; $('#bFps').hidden = false; fpsT = now; fpsN = 0; }
  if (now - lastUi > 120) { lastUi = now; updateUI(); if (src === 'file') updateFileBar(); }
}

/* ---------- maska ćwiczącego (rozmycie tła) ---------- */
const maskCv = document.createElement('canvas'), mctx = maskCv.getContext('2d');
const blurCv = document.createElement('canvas'), bctx = blurCv.getContext('2d');
const personCv = document.createElement('canvas'), pctx = personCv.getContext('2d');
function updateMask(m) {
  maskOk = false;
  if (!m || !S.blur) return;
  try {
    const W = m.width, H = m.height, a = m.getAsFloat32Array(), st = 4;
    const mw = Math.ceil(W / st), mh = Math.ceil(H / st);
    if (maskCv.width !== mw || maskCv.height !== mh) { maskCv.width = mw; maskCv.height = mh; maskImg = mctx.createImageData(mw, mh); }
    const d = maskImg.data;
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const v = a[(y * st) * W + x * st], o = (y * mw + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = v > .5 ? 255 : v > .2 ? (v - .2) / .3 * 255 : 0;
    }
    mctx.putImageData(maskImg, 0, 0); maskOk = true;
  } catch (e) { console.warn(e); }
}
function drawFrame(w, h) {
  const bw = Math.max(16, Math.round(w / 28)), bh = Math.max(9, Math.round(h / 28));
  if (blurCv.width !== bw) { blurCv.width = bw; blurCv.height = bh; }
  bctx.drawImage(video, 0, 0, bw, bh);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(blurCv, 0, 0, w, h);
  ctx.fillStyle = 'rgba(34,33,33,.25)'; ctx.fillRect(0, 0, w, h);
  if (personCv.width !== w || personCv.height !== h) { personCv.width = w; personCv.height = h; }
  pctx.globalCompositeOperation = 'source-over'; pctx.clearRect(0, 0, w, h);
  pctx.drawImage(video, 0, 0, w, h);
  pctx.globalCompositeOperation = 'destination-in'; pctx.drawImage(maskCv, 0, 0, w, h);
  if (plate.on) { pctx.globalCompositeOperation = 'source-over'; pctx.save(); pctx.beginPath(); pctx.arc(plate.cx, plate.cy, plate.r * 1.15, 0, 7); pctx.clip(); pctx.drawImage(video, 0, 0, w, h); pctx.restore(); }
  ctx.drawImage(personCv, 0, 0);
}

/* ---------- punkty → cechy → próbki ---------- */
function process(lm, w, h, t) {
  pts = lm.map((p, i) => ({ x: filters[i][0].f(p.x * w, t), y: filters[i][1].f(p.y * h, t), z: p.z, v: p.visibility ?? 1 }));
  const raw = lm.map(p => ({ x: p.x * w, y: p.y * h, z: p.z, v: p.visibility ?? 1 }));
  const F = fx.extract(pts, w, h, t, raw, { ex, swap: S.swap, plate: { on: plate.on, track: trackPlate } });
  cur = F;
  if (!F) return;
  setup = F.setup;
  if (recording && !cdEnd) record(F);
}
const curPpc = () => scaleOf(samples, ex, S.height, plate.ppc);
function record(F) {
  const s = { t: src === 'cam' ? F.t - recStart : F.t, bx: F.bar.x, by: F.bar.y, ry: F.barRaw.y, bs: F.barSrc, bq: F.bar.v, mfx: F.mfx, f: F.f,
    shx: F.sh.x, shy: F.sh.y, hipx: F.hip.x, hipy: F.hip.y, kx: F.knee.x, ky: F.knee.y, ay: F.ank.y,
    kneeFlex: F.kneeFlex, hipAng: F.hipAng, torso: F.torso, elbow: F.elbow, forearm: F.forearm, leg: F.leg, trunk: F.trunk, q: F.q };
  samples.push(s);
  const i = samples.length - 1;
  const ppc = curPpc();
  const lo = Math.min(fsm.lo, s.by), hi = Math.max(fsm.hi, s.by);
  fsm.lo = lo; fsm.hi = hi;
  const amp = hi - lo;
  if (!ppc || amp < EX[ex].minAmp * ppc * .8) return;
  const dOf = y => EX[ex].rest === 'top' ? (y - lo) / amp : (hi - y) / amp;
  const d = dOf(s.by);
  if (fsm.state === 'away' && d > snapBest) { snapBest = d; snapPending = true; }
  if (!fsm.primed) {
    fsm.primed = true;
    for (let j = 0; j < i; j++) { const g = fsm.feed(j, dOf(samples[j].by), samples[j].t); if (g) onLiveRep(g, ppc); }
  }
  const seg = fsm.feed(i, d, s.t);
  if (fsm.state === 'away' && fsm.justAway) { snapBest = d; snapPending = true; }
  if (seg) onLiveRep(seg, ppc);
}
function grabSnap() {
  if (!snapCanvas) snapCanvas = document.createElement('canvas');
  const sc = Math.min(1, 480 / Math.max(canvas.width, canvas.height));
  snapCanvas.width = Math.round(canvas.width * sc); snapCanvas.height = Math.round(canvas.height * sc);
  snapCanvas.getContext('2d').drawImage(canvas, 0, 0, snapCanvas.width, snapCanvas.height);
}

/* =========================================================
   ŚLEDZENIE TALERZA (dopasowanie wzorca, NCC)
   ========================================================= */
const work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
function grayRegion(x0, y0, size) {
  const k = plate.k, Sz = Math.round(size);
  work.width = Sz; work.height = Sz;
  wctx.drawImage(video, x0, y0, size / k, size / k, 0, 0, Sz, Sz);
  const d = wctx.getImageData(0, 0, Sz, Sz).data, g = new Float32Array(Sz * Sz);
  for (let i = 0; i < Sz * Sz; i++) g[i] = d[i * 4] * .299 + d[i * 4 + 1] * .587 + d[i * 4 + 2] * .114;
  return { g, S: Sz };
}
function normTpl(g) { let m = 0; for (const v of g) m += v; m /= g.length; let s = 0; const o = new Float32Array(g.length); for (let i = 0; i < g.length; i++) { o[i] = g[i] - m; s += o[i] * o[i]; } return { v: o, n: Math.sqrt(s) || 1 }; }
function plateInit(cx, cy, ex_, ey) {
  const r = Math.hypot(ex_ - cx, ey - cy);
  if (r < 8) { toast('Talerz za mały – dotknij jego krawędzi.'); return false; }
  plate.r = r; plate.cx = cx; plate.cy = cy; plate.k = Math.min(1, 26 / r); plate.half = 16;
  const T = grayRegion(cx - plate.half / plate.k, cy - plate.half / plate.k, plate.half * 2 + 1);
  plate.tpl = normTpl(T.g);
  plate.ppc = r * 2 / (parseFloat(String(S.plateD).replace(',', '.')) || 45);
  plate.on = true; plate.off = null; plate.lost = 0; plate.vx = 0; plate.vy = 0;
  return true;
}
function trackPlate(handBar) {
  const k = plate.k, half = plate.half, T = half * 2 + 1, R = 14;
  let px = plate.cx + plate.vx, py = plate.cy + plate.vy;
  if (plate.lost > 3 && plate.off && handBar.v > .5) { px = handBar.x + plate.off.x; py = handBar.y + plate.off.y; }
  const size = T + 2 * R, x0 = px - (half + R) / k, y0 = py - (half + R) / k;
  const { g, S: Sz } = grayRegion(x0, y0, size);
  const tv = plate.tpl.v, tn = plate.tpl.n, N = T * T;
  let best = -2, bx = 0, by = 0;
  for (let oy = 0; oy <= 2 * R; oy++) for (let ox = 0; ox <= 2 * R; ox++) {
    let m = 0;
    for (let j = 0; j < T; j++) { const row = (oy + j) * Sz + ox; for (let i = 0; i < T; i++) m += g[row + i]; }
    m /= N;
    let num = 0, den = 0;
    for (let j = 0; j < T; j++) { const row = (oy + j) * Sz + ox, tr = j * T; for (let i = 0; i < T; i++) { const v = g[row + i] - m; num += v * tv[tr + i]; den += v * v; } }
    const c = num / (Math.sqrt(den) * tn || 1);
    if (c > best) { best = c; bx = ox; by = oy; }
  }
  plate.score = best;
  if (best < .45) { plate.lost++; return plate.off && handBar.v > .5 ? { x: handBar.x + plate.off.x, y: handBar.y + plate.off.y } : null; }
  const nx = x0 + (bx + half) / k, ny = y0 + (by + half) / k;
  plate.vx = .6 * (nx - plate.cx); plate.vy = .6 * (ny - plate.cy); plate.cx = nx; plate.cy = ny; plate.lost = 0;
  if (handBar.v > .5) { const o = { x: nx - handBar.x, y: ny - handBar.y }; plate.off = plate.off ? { x: .9 * plate.off.x + .1 * o.x, y: .9 * plate.off.y + .1 * o.y } : o; }
  return { x: nx, y: ny };
}
function plateOff() { plate.on = false; plate.mode = 0; plate.ppc = null; plate.tpl = null; const b = $('#plateBtn'); b.textContent = '◎ Zaznacz talerz'; b.classList.remove('on'); }
function initPlateAndTap() {
  $('#plateBtn').onclick = () => {
    if (plate.on || plate.mode) { plateOff(); toast('Śledzenie talerza wyłączone – gryf liczony z sylwetki.'); return; }
    if (src === 'file' && !video.paused) video.pause();
    plate.mode = 1; $('#plateBtn').textContent = '✕ Anuluj'; $('#plateBtn').classList.add('on');
    toast('Dotknij środka talerza na obrazie.', 4000);
  };
  canvas.addEventListener('click', e => {
    const r = canvas.getBoundingClientRect();
    // canvas używa object-fit: contain – przelicz współrzędne z uwzględnieniem pasków
    const sc = Math.min(r.width / canvas.width, r.height / canvas.height), ow = canvas.width * sc, oh = canvas.height * sc;
    let x = (e.clientX - r.left - (r.width - ow) / 2) / sc, y = (e.clientY - r.top - (r.height - oh) / 2) / sc;
    if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return;
    if ($('#mirror').checked) x = canvas.width - x;
    if (!plate.mode) {
      if (!src) return;
      person = { x: x / canvas.width, y: y / canvas.height, t: src === 'cam' ? performance.now() / 1000 : video.currentTime, pick: true };
      if (src === 'file' && video.paused) lastVidTime = -1;
      toast('Śledzę wybraną osobę.'); return;
    }
    if (plate.mode === 1) { plate.tx = x; plate.ty = y; plate.mode = 2; toast('Teraz dotknij krawędzi talerza.', 4000); return; }
    if (plate.mode === 2) {
      plate.mode = 0;
      if (plateInit(plate.tx, plate.ty, x, y)) { $('#plateBtn').textContent = '◎ Talerz: wyłącz'; toast(`Talerz zaznaczony (${S.plateD} cm). Śledzę jego środek.`, 3500); }
      else plateOff();
    }
  });
}

/* =========================================================
   SERIA, SESJA, PRZERWA
   ========================================================= */
function resetSet() {
  samples = []; liveReps = []; snaps = []; snapBest = -1; snapPending = false; fsm = new RepFSM();
  planDoneAt = 0; planDoneNote = 0; cueText = ''; cueUntil = 0; trainer.reset();
  $('#cardSum').hidden = true; renderLive();
}
function freshSession() { sess = { setNo: 1, done: [], finished: false, introDone: false }; updateSess(); }
function startSet() {
  if (!src) return;
  if (!landmarker && !TEST) { toast('Model pozy jeszcze się ładuje – chwila…'); return; }
  voice.unlock(); keepAwake();
  if (src === 'cam' && sess.finished) freshSession();
  if (rest) stopRest(true);
  resetSet(); recording = true; lastSet = null;
  if (src === 'file') {
    cdEnd = 0; recStart = 0; recBegan = performance.now(); trainer.goSilent();
    if (video.ended || video.currentTime > (video.duration || 0) - .3) video.currentTime = 0;
    lastVidTime = -1; video.play().catch(() => {});
  } else {
    const cd = S.coach.countdown;
    if (cd > 0) { cdTotal = cd; cdLast = cd; cdEnd = performance.now() + cd * 1000; trainer.countdown(cd, cd, !sess.introDone); sess.introDone = true; }
    else beginRec();
  }
  updateRecBtn(); updateSess();
}
function beginRec() {
  cdEnd = 0; recStart = performance.now() / 1000; recBegan = performance.now(); lastSeen = performance.now();
  samples = []; fsm = new RepFSM(); liveReps = []; snaps = [];
  trainer.go(); updateRecBtn(); renderLive();
}
function onLiveRep(seg, ppc) {
  const vBest = Math.max(0, ...liveReps.map(r => r.vel || 0)) || null;
  const rep = analyzeRep(samples, seg, ex, ppc, liveReps.length + 1);
  liveReps.push(rep);
  if (snapCanvas?.width) try { snaps.push({ t: rep.tTurn, url: snapCanvas.toDataURL('image/jpeg', .72) }); } catch (e) {}
  snapBest = -1;
  const n = liveReps.length;
  cueText = rep.main ? rep.main.tip : `Powtórzenie ${n}: dobrze`; cueClass = rep.main ? rep.main.status : 'ok'; cueUntil = performance.now() + 6000;
  if (src === 'cam') {
    trainer.rep(rep, n, planN(), vBest);
    if (planN() && n === planN()) { if (S.coach.autoEnd) planDoneAt = performance.now() + 1600; else planDoneNote = performance.now() + 1600; }
  }
  renderLive();
}
function finishSet(o = {}) {
  if (!recording) return;
  const wasCd = !!cdEnd;
  recording = false; cdEnd = 0; planDoneAt = 0; planDoneNote = 0;
  $('#bRec').hidden = true;
  if (src === 'file') video.pause();
  updateRecBtn();
  if (wasCd) { voice.cancel(); toast('Odliczanie anulowane'); return; }
  if (o.silent) return;
  const camera = src === 'cam';
  const set = buildSetData({ samples, ex, weight: weightN(), plan: planN(), height: S.height, platePpc: plate.ppc, snaps, src, fileName, setNo: camera ? sess.setNo : null, sets: camera ? setsN() : null });
  if (!set) {
    toast('Za mało danych – nie wykryto ruchu sztangi.', 4500, true);
    voice.say('Za mało danych. Sprawdź ustawienie telefonu i spróbuj jeszcze raz.', { prio: 2 });
    return;
  }
  lastSet = set;
  const n = set.reps.length;
  if (n) {
    if (!store.addHist(set)) toast('Brak miejsca w pamięci – wyeksportuj i usuń starsze serie.', 5000, true);
    if (weightN()) { S.weights[ex] = String(weightN()); saveS(); }
    renderSummary(set);
  } else toast('Nie wykryto powtórzeń. Sprawdź ustawienie telefonu.', 4500);
  trainer.setEnd(set, camera ? sess.setNo : 1, setsN());
  renderLive();
  if (camera && n) {
    sess.done.push({ n, score: set.summary.score });
    if (sess.setNo >= setsN()) finishSession(true);
    else { sess.setNo++; if (S.coach.rest > 0) startRest(S.coach.rest); }
  }
  updateSess(); updateRecBtn();
}
function finishSession(natural) {
  if (!sess.done.length) return;
  const sc = sess.done.map(d => d.score).filter(v => v != null);
  trainer.sessionDone(sess.done.length, sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null);
  sess.finished = true; updateSess();
  toast('Trening zakończony – dobra robota!', 4000);
}
function updateSess() {
  const el = $('#sessLine'), c = S.coach;
  const sc = sess.done.map(d => d.score).filter(v => v != null), avg = sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null;
  let t;
  if (src === 'file') t = 'Analiza filmu – bez odliczania i przerw.';
  else if (sess.finished) t = `Trening zakończony: ${sess.done.length} z ${setsN()} serii${avg != null ? `, średnia ocena ${avg}` : ''}.`;
  else t = `Seria ${sess.setNo} z ${setsN()}${sess.done.length ? ` · zrobione: ${sess.done.length}${avg != null ? `, średnia ocena ${avg}` : ''}` : ''}`;
  el.textContent = t;
  $('#sessHint').textContent = `Odliczanie ${c.countdown ? c.countdown + ' s' : 'wyłączone'} · przerwa ${c.rest ? mmss(c.rest) : 'wyłączona'}${c.autoNext && c.rest ? ' · kolejna seria startuje sama' : ''}. Zmienisz to w zakładce Trener.`;
  const b = $('#bSet'); b.hidden = !(src === 'cam'); b.textContent = `Seria ${sess.finished ? sess.done.length : sess.setNo}/${setsN()}`;
}
function startRest(sec) {
  rest = { end: performance.now() + sec * 1000, total: sec, last: sec + 1 };
  $('#restOv').hidden = false; trainer.restStart(sec, sess.setNo, setsN());
  const l = lastSet?.summary;
  $('#restNext').innerHTML = `Następna: <b>seria ${sess.setNo} z ${setsN()}</b>${l && l.n ? `<br>Poprzednia: ${l.n} powt., ocena ${l.score ?? '—'}${l.mainIssue ? ' · ' + esc(l.mainIssue.label.toLowerCase()) : ''}` : ''}`;
  updateRest(); updateRecBtn();
}
function stopRest(silent) { if (!rest) return; rest = null; $('#restOv').hidden = true; if (!silent) voice.cancel(); updateRecBtn(); }
function updateRest() {
  if (!rest) return;
  const left = Math.max(0, (rest.end - performance.now()) / 1000);
  $('#restTime').textContent = mmss(Math.ceil(left));
  $('#restBar').style.width = (100 * (1 - left / rest.total)) + '%';
}
function endRest() {
  const auto = S.coach.autoNext && src === 'cam';
  stopRest(true);
  if (auto) { voice.beep(1100, 300); startSet(); }
  else trainer.restEnd(sess.setNo, setsN());
}
function tick() {
  const now = performance.now();
  if (recording && cdEnd) {
    if (now >= cdEnd) beginRec();
    else { const n = Math.ceil((cdEnd - now) / 1000); if (n < cdLast) { cdLast = n; trainer.countdown(n, cdTotal); } }
  }
  if (recording && !cdEnd && src === 'cam') {
    if (!TEST && now - lastSeen > 2500) trainer.lost();
    if (!liveReps.length && now - recBegan > 25000) trainer.noMotion();
    if (planDoneAt && (now > planDoneAt + 6000 || (now > planDoneAt && !voice.current))) { planDoneAt = 0; finishSet({ auto: true }); }
    if (planDoneNote && now > planDoneNote) { planDoneNote = 0; trainer.planDone(false); }
  }
  if (rest) {
    updateRest();
    const left = Math.ceil((rest.end - now) / 1000);
    if (left < rest.last) { rest.last = left; if (left > 0) trainer.restTick(left, rest.total); }
    if (now >= rest.end) endRest();
  }
  // wskazówki ustawienia kadru (tylko kamera, bez serii)
  if (src === 'cam' && !recording && !rest && !TEST) {
    const key = setup.ok ? 'ok' : setup.msg;
    if (key !== setupKey) { setupKey = key; setupSince = now; }
    else if (setupSince && now - setupSince > 1500) { setupSince = 0; trainer.setup(setup.ok, setup.msg || ''); }
  }
}
function initSession() {
  $('#recBtn').onclick = () => {
    voice.unlock();
    if (recording) finishSet(); else startSet();
  };
  $('#restPlus').onclick = () => { if (rest) { rest.end += 30000; rest.total += 30; rest.last = Math.ceil((rest.end - performance.now()) / 1000) + 1; updateRest(); } };
  $('#restSkip').onclick = () => { voice.unlock(); if (rest) { stopRest(true); startSet(); } };
  $('#restStop').onclick = () => { stopRest(true); voice.cancel(); finishSession(); sess.finished = true; updateSess(); };
  $('#newSess').onclick = () => { if (recording) finishSet({ silent: true }); stopRest(true); voice.cancel(); freshSession(); $('#cardSum').hidden = true; toast('Nowy trening – seria 1.'); updateRecBtn(); };
  setInterval(tick, 200);
}

/* =========================================================
   RYSOWANIE
   ========================================================= */
function draw(w, h) {
  const mirror = $('#mirror').checked;
  ctx.save(); if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  if (maskOk && S.blur) drawFrame(w, h); else ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();
  const MX = x => mirror ? w - x : x;
  const sc = Math.min(w, h) / 720, lw = 4 * sc, fs = Math.round(20 * sc), font = css('--head') || 'Archivo, sans-serif';
  const acc = css('--teal') || '#2EC4B6', okC = '#4ade80', warnC = '#fbbf24', badC = '#f87171';
  const colOf = s => s === 'ok' ? okC : s === 'warn' ? warnC : s === 'bad' ? badC : '#fff';
  if (cur) {
    const P = cur.P, I = cur.I, O = cur.near === 'L' ? IDX.R : IDX.L;
    const seg = (Sd, c, wid) => { for (const [a, b] of BONES) { const p = P[Sd[a]], q = P[Sd[b]]; if (p.v < VIS_MIN || q.v < VIS_MIN) continue; ctx.strokeStyle = c; ctx.lineWidth = wid; ctx.beginPath(); ctx.moveTo(MX(p.x), p.y); ctx.lineTo(MX(q.x), q.y); ctx.stroke(); } };
    ctx.lineCap = 'round';
    seg(O, 'rgba(255,255,255,.35)', lw * .6); seg(I, acc, lw);
    for (const k of ['sh', 'el', 'wr', 'hip', 'knee', 'ank']) { const p = P[I[k]]; if (p.v < VIS_MIN) continue; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(MX(p.x), p.y, lw * 1.4, 0, 7); ctx.fill(); ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(MX(p.x), p.y, lw * .9, 0, 7); ctx.fill(); }
    const rx = MX(ex === 'bench' ? cur.sh.x : cur.mfx);
    ctx.setLineDash([12 * sc, 9 * sc]); ctx.strokeStyle = 'rgba(46,196,182,.85)'; ctx.lineWidth = 2.5 * sc;
    ctx.beginPath(); ctx.moveTo(rx, 0); ctx.lineTo(rx, h); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `700 ${Math.round(fs * .75)}px ${font}`; ctx.fillStyle = acc;
    const lab = ex === 'bench' ? 'linia barków' : 'środek stopy';
    ctx.fillText(lab, Math.min(w - ctx.measureText(lab).width - 6, rx + 6 * sc), h - 12 * sc);
  }
  if (recording && !cdEnd && samples.length) {
    const lastRep = liveReps[liveReps.length - 1];
    if (lastRep) {
      ctx.strokeStyle = colOf(lastRep.status); ctx.globalAlpha = .55; ctx.lineWidth = lw * .9; ctx.beginPath();
      for (let i = lastRep.s; i <= lastRep.e; i++) { const s = samples[i]; if (!s) break; i === lastRep.s ? ctx.moveTo(MX(s.bx), s.by) : ctx.lineTo(MX(s.bx), s.by); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    const from = lastRep ? lastRep.e : Math.max(0, samples.length - 150);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = lw * .9; ctx.beginPath();
    for (let i = from; i < samples.length; i++) { const s = samples[i]; i === from ? ctx.moveTo(MX(s.bx), s.by) : ctx.lineTo(MX(s.bx), s.by); }
    ctx.stroke();
  }
  if (cur) {
    const b = cur.bar;
    if (plate.on) { ctx.strokeStyle = plate.lost ? warnC : acc; ctx.lineWidth = 3 * sc; ctx.beginPath(); ctx.arc(MX(b.x), b.y, plate.r, 0, 7); ctx.stroke(); }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(MX(b.x), b.y, lw * 2.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(MX(b.x), b.y, lw * 1.1, 0, 7); ctx.fill();
  }
  if (plate.mode === 2) { ctx.strokeStyle = acc; ctx.lineWidth = 3 * sc; ctx.beginPath(); ctx.arc(MX(plate.tx), plate.ty, 10 * sc, 0, 7); ctx.stroke(); }
  const banner = (txt, c) => {
    ctx.font = `700 ${fs}px ${font}`; const tw = Math.min(w - 24 * sc, ctx.measureText(txt).width + 24 * sc);
    ctx.fillStyle = 'rgba(34,33,33,.85)'; rrect(ctx, (w - tw) / 2, 12 * sc, tw, fs * 1.8, 10 * sc); ctx.fill();
    ctx.fillStyle = c; ctx.fillRect((w - tw) / 2, 12 * sc, 5 * sc, fs * 1.8);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(txt, w / 2, 12 * sc + fs * 1.25, tw - 20 * sc); ctx.textAlign = 'left';
  };
  if (plate.mode) banner(plate.mode === 1 ? 'Dotknij środka talerza' : 'Dotknij krawędzi talerza', acc);
  else if (!recording || cdEnd) {
    ctx.strokeStyle = setup.ok ? okC : badC; ctx.lineWidth = 8 * sc; ctx.strokeRect(4 * sc, 4 * sc, w - 8 * sc, h - 8 * sc);
    if (setup.msg) banner(setup.msg, setup.ok ? okC : badC);
  } else if (cueText && performance.now() < cueUntil) banner(cueText.length > 60 ? cueText.split(' – ')[0] : cueText, colOf(cueClass));
  if (recording && !cdEnd) {
    const plan = planN(), txt = String(liveReps.length), big = Math.round(70 * sc);
    ctx.font = `800 ${big}px ${font}`; const tw = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(34,33,33,.8)'; rrect(ctx, 12 * sc, h - big * 1.5 - 40 * sc, tw + (plan ? 60 : 28) * sc, big * 1.35, 14 * sc); ctx.fill();
    ctx.fillStyle = liveReps.length ? colOf(liveReps[liveReps.length - 1].status) : '#fff';
    ctx.fillText(txt, 26 * sc, h - big * .45 - 40 * sc);
    if (plan) { ctx.font = `700 ${Math.round(big * .4)}px ${font}`; ctx.fillStyle = '#ccc'; ctx.fillText('/' + plan, 30 * sc + tw, h - big * .45 - 40 * sc); }
  }
  if (cdEnd) {
    const left = Math.ceil((cdEnd - performance.now()) / 1000), big = Math.round(160 * sc);
    ctx.font = `800 ${big}px ${font}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = acc; ctx.fillText(String(Math.max(1, left)), w / 2, h / 2 + big * .35); ctx.textAlign = 'left';
  }
}

/* =========================================================
   INTERFEJS NA ŻYWO
   ========================================================= */
function setCue(t, c) { const el = $('#cue'); el.textContent = t; el.className = 'cue ' + (c || ''); }
function updateUI() {
  const rb = $('#bRec');
  if (recording && !cdEnd) { rb.hidden = false; rb.textContent = `● SERIA ${f1(samples.length ? samples[samples.length - 1].t - samples[0].t : 0)} s`; } else rb.hidden = true;
  const hgt = +S.height || 178;
  const ppc = recording && samples.length ? curPpc() : (plate.ppc || (cur ? (ex === 'bench' ? cur.trunk / (TORSO_RATIO * hgt) : cur.leg / (LEG_RATIO * hgt)) : null));
  if (cur && ppc) {
    const ref = ex === 'bench' ? cur.sh.x : cur.mfx, dx = (cur.bar.x - ref) * cur.f / ppc;
    $('#vDev').innerHTML = `${dx > 0 ? '+' : ''}${f0(dx)}<span class="u">cm</span>`;
    let m;
    if (ex === 'squat') { const d = (cur.hip.y - cur.knee.y) / ppc; m = `${d > 0 ? '+' : ''}${f0(d)}<span class="u">cm</span>`; }
    else if (ex === 'deadlift') m = `${f0(cur.torso)}<span class="u">°</span>`;
    else m = `${f0(cur.elbow)}<span class="u">°</span>`;
    $('#vMet').innerHTML = m;
  }
  if (!recording && !lastSet && performance.now() > cueUntil) setCue(src ? (setup.msg || '') : '', setup.ok ? 'ok' : 'warn');
}
function renderLive() {
  $('#vReps').textContent = liveReps.length + (planN() ? ' / ' + planN() : '');
  const last = liveReps[liveReps.length - 1];
  $('#kLast').className = 'kpi ' + lvlOfStatus(last?.status);
  $('#vLast').innerHTML = last ? `${last.score}<span class="u">pkt${last.vel ? ' · ' + f2(last.vel) + ' m/s' : ''}</span>` : '—';
  $('#chips').innerHTML = liveReps.map(r => `<span class="${r.status}">${r.n}</span>`).join('');
  if (last) setCue(last.main ? last.main.tip : `Powtórzenie ${last.n}: dobrze`, last.main ? last.main.status : 'ok');
  else if (recording) setCue(cdEnd ? 'Podejdź do sztangi…' : 'Seria trwa – licznik ruszy po pierwszym powtórzeniu.', '');
  $('#livePath').innerHTML = liveReps.length ? barPathSVG(liveReps, ex, true) : '<p class="muted" style="font-size:13px;margin:0">Po pierwszym powtórzeniu pojawi się tu tor gryfu względem środka stopy.</p>';
}
function renderSummary(set) {
  const s = set.summary, cls = s.score == null ? '' : s.score >= 80 ? 'ok' : s.score >= 60 ? 'warn' : 'bad';
  $('#sumBody').innerHTML = `<div class="sumscore ${cls}"><b>${s.score ?? '—'}</b><small>/ 100 · ${s.n} powt. · ${s.cnt.ok} dobrze, ${s.cnt.warn} do poprawy, ${s.cnt.bad} błąd</small></div>
    <div class="chips">${set.reps.map(r => `<span class="${r.status}">${r.n}</span>`).join('')}</div>
    <p class="sumtxt"><b>Najważniejsze:</b> ${esc(s.mainIssue ? s.mainIssue.tip : 'wszystkie powtórzenia poprawne – tak trzymaj.')}</p>
    <p class="sumtxt">${esc(s.advice || '')}${s.est1rm ? ` Szacowane 1RM: <b>${kg(s.est1rm)}</b>.` : ''}${s.nextWeight && set.weight ? ` Następna seria: <b>${kg(s.nextWeight)}</b>.` : ''}</p>`;
  $('#cardSum').hidden = false;
}

/* =========================================================
   ĆWICZENIA, USTAWIENIA ANALIZY
   ========================================================= */
function buildExBar() {
  $('#exBar').innerHTML = Object.keys(EX).map(k => `<button type="button" data-e="${k}" aria-pressed="false"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[EX[k].icon] || ICONS.squat}</svg><span>${esc(EX[k].name)}</span></button>`).join('');
  $$('#exBar button').forEach(b => b.onclick = () => { if (recording || rest) { toast('Najpierw zakończ serię.'); return; } setEx(b.dataset.e); });
}
function setEx(e) {
  ex = e; S.ex = e;
  $$('#exBar button').forEach(x => { const on = x.dataset.e === e; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
  $('#exTitle').textContent = 'Seria · ' + EX[e].name;
  $('#exDesc').innerHTML = EX[e].desc + `<br><span class="muted">${esc(EX[e].hint)}</span>`;
  $('#lblDev').textContent = e === 'bench' ? 'Gryf od linii barków' : 'Gryf od środka stopy';
  $('#lblMet').textContent = EX[e].met;
  const hist = store.loadHist().filter(h => h.ex === e), sug = hist[0]?.summary?.nextWeight;
  $('#weight').value = S.weights[e] ?? '';
  $('#weight').placeholder = sug ? `sugerowane ${String(sug).replace('.', ',')}` : 'np. 100';
  if (sug && !S.weights[e]) $('#weight').value = String(sug).replace('.', ',');
  fx.reset(); saveS(); renderLive(); updateRecBtn();
}
function initSettings() {
  $('#height').value = S.height; $('#plateD').value = S.plateD; $('#modelSel').value = S.model; $('#devSel').value = S.dev; $('#smooth').value = S.smooth;
  $('#pname').value = S.name; $('#blur').checked = !!S.blur; $('#swap').checked = !!S.swap; $('#plan').value = S.plan; $('#sets').value = String(S.coach.sets);
  $('#height').onchange = e => { S.height = e.target.value.replace(/[^\d]/g, '') || '178'; e.target.value = S.height; saveS(); };
  $('#plateD').onchange = e => { S.plateD = e.target.value.replace(',', '.').replace(/[^\d.]/g, '') || '45'; e.target.value = S.plateD; if (plate.on) plate.ppc = plate.r * 2 / (+S.plateD || 45); saveS(); };
  $('#modelSel').onchange = e => { S.model = e.target.value; saveS(); loadModel(); };
  $('#devSel').onchange = e => { S.dev = e.target.value; saveS(); loadModel(); };
  $('#smooth').onchange = e => { S.smooth = e.target.value; saveS(); resetFilters(); };
  $('#pname').onchange = e => { S.name = e.target.value.trim(); saveS(); };
  $('#blur').onchange = e => { S.blur = e.target.checked; saveS(); };
  $('#swap').onchange = e => { S.swap = e.target.checked; saveS(); fx.reset(); };
  $('#plan').onchange = e => { S.plan = e.target.value.replace(/[^\d]/g, ''); e.target.value = S.plan; saveS(); renderLive(); };
  $('#sets').onchange = e => { S.coach.sets = clamp(parseInt(e.target.value) || 1, 1, 20); e.target.value = String(S.coach.sets); saveS(); updateSess(); updateRecBtn(); };
  $('#weight').onchange = e => { const v = e.target.value.replace(/[^\d.,]/g, ''); e.target.value = v; if (v) S.weights[ex] = v; else delete S.weights[ex]; saveS(); };
  const step = d => { const E = EX[ex], cur_ = weightN() ?? 0; const v = Math.max(0, cur_ + d * (E.step || 5)); $('#weight').value = v ? String(v).replace('.', ',') : ''; $('#weight').onchange({ target: $('#weight') }); };
  $('#wMinus').onclick = () => step(-1); $('#wPlus').onclick = () => step(1);
}

/* =========================================================
   RAPORT, EKSPORT
   ========================================================= */
let logoSvg = '', reportCss = '';
async function loadResources() {
  try { logoSvg = await (await fetch('assets/logo-bikerc.svg')).text(); } catch (e) {}
  try { reportCss = await (await fetch('report.css')).text(); } catch (e) {}
}
function renderReport(set) {
  $('#reportEmpty').hidden = !!set; $('#report').hidden = !set;
  if (set) $('#report').innerHTML = reportHTML(set, { logoSvg, name: S.name });
}
async function deliver(name, blob) {
  try {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const fname = (set, ext) => `ciezary-trener-${set.ex}-${set.date.slice(0, 16).replace(/[:T]/g, '-')}.${ext}`;
async function doPdf(set) {
  if (!set) { toast('Brak raportu – zrób serię albo wybierz ją w historii.'); return; }
  toast('Przygotowuję PDF…', 1800);
  try { await deliver(fname(set, 'pdf'), await makePdf(set, store.loadHist(), { name: S.name })); }
  catch (e) { console.error(e); toast('Nie udało się utworzyć PDF. Użyj „Drukuj” i wybierz „Zapisz jako PDF”.', 6000, true); }
}
function initReport() {
  $('#pdfBtn').onclick = () => doPdf(lastSet);
  $('#sumPdf').onclick = () => doPdf(lastSet);
  $('#sumReport').onclick = () => { renderReport(lastSet); openTab('report'); };
  $('#shareBtn').onclick = () => {
    if (!lastSet) { toast('Brak raportu – zrób serię albo wczytaj film.'); return; }
    const doc = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="author" content="Wojciech Wieczorek"><title>Raport techniki – ${esc(EX[lastSet.ex].name)}</title><style>body{margin:0;background:#f4f6f8;padding:12px}${reportCss}</style></head><body><div id="report" style="max-width:900px;margin:0 auto">${reportHTML(lastSet, { logoSvg, name: S.name })}</div></body></html>`;
    deliver(fname(lastSet, 'html'), new Blob([doc], { type: 'text/html' }));
  };
  $('#printBtn').onclick = () => { if (!lastSet) { toast('Brak raportu.'); return; } renderReport(lastSet); setTimeout(() => window.print(), 80); };
  $('#csvBtn').onclick = () => {
    if (!lastSet?.samples) { toast('Dane klatek są tylko dla bieżącej serii.'); return; }
    const set = lastSet, ppc = set.ppc;
    const head = 'czas_s;gryf_x_cm;gryf_y_cm;srodek_stopy_x_cm;kolano_zgiecie;biodro_kat;tulow_od_pionu;lokiec';
    const rows = set.samples.map(s => [s.t.toFixed(3), (s.bx / ppc).toFixed(1), (-s.by / ppc).toFixed(1), (s.mfx / ppc).toFixed(1), s.kneeFlex?.toFixed(1), s.hipAng?.toFixed(1), s.torso?.toFixed(1), s.elbow?.toFixed(1)].map(v => String(v ?? '').replace('.', ',')).join(';'));
    const reps = ['', 'powtorzenie;ocena;punkty;zakres_cm;predkosc_m_s;' + (set.reps[0]?.checks.map(c => c.key).join(';') || ''),
      ...set.reps.map(r => [r.n, r.status, r.score, f1(r.rom), f2(r.vel), ...r.checks.map(c => c.value == null ? '' : String(c.value).replace('.', ','))].join(';'))];
    deliver(fname(set, 'csv'), new Blob(['\ufeff' + [head, ...rows, ...reps].join('\n')], { type: 'text/csv' }));
  };
}

/* =========================================================
   HISTORIA
   ========================================================= */
function renderHist() {
  const a = store.loadHist(), box = $('#histList');
  box.innerHTML = a.length ? '' : '<p class="muted" style="margin:0;font-size:14px">Brak zapisanych serii.</p>';
  a.forEach(e => {
    const d = new Date(e.date), s = e.summary, el = document.createElement('div'); el.className = 'hi';
    el.innerHTML = `<b>${esc(EX[e.ex]?.name || e.ex)}</b> · ${e.weight ? kg(e.weight) + ' × ' : ''}${s.n} · <span class="muted">${fmtDate(e.date)}${e.setNo ? ' · seria ' + e.setNo + (e.sets ? '/' + e.sets : '') : ''}</span>
      <div class="chips" style="margin-top:6px">${e.reps.map(r => `<span class="${r.status}">${r.n}</span>`).join('')}</div>
      <div class="muted" style="font-size:13px;margin-top:6px">Ocena ${s.score ?? '—'}/100${s.mainIssue ? ' · ' + esc(s.mainIssue.label.toLowerCase()) : ''}</div>
      <div class="r"><button class="btn small" data-a="open">Raport</button><button class="btn small" data-a="pdf">PDF</button><button class="btn small" data-a="del">Usuń</button></div>`;
    el.querySelector('[data-a=open]').onclick = () => { lastSet = e; renderReport(e); openTab('report'); };
    el.querySelector('[data-a=pdf]').onclick = () => doPdf(e);
    el.querySelector('[data-a=del]').onclick = () => { if (confirm('Usunąć tę serię?')) { store.removeHist(e.id); renderHist(); } };
    box.append(el);
  });
  const rows = Object.keys(EX).map(k => {
    const l = a.filter(e => e.ex === k); if (!l.length) return '';
    const best = Math.max(0, ...l.map(e => e.summary.est1rm || 0)), sc = l.slice(0, 5).map(e => e.summary.score).filter(v => v != null);
    return `<tr><td>${EX[k].name}</td><td>${l.length}</td><td>${best ? kg(best) : '—'}</td><td>${sc.length ? Math.round(sc.reduce((x, y) => x + y, 0) / sc.length) : '—'}</td></tr>`;
  }).join('');
  $('#prTbl').innerHTML = rows ? `<tr><th>Ćwiczenie</th><th>Serie</th><th>Max 1RM</th><th>Ocena (5 ost.)</th></tr>${rows}` : '<tr><td class="muted">Brak danych – zrób pierwszą serię.</td></tr>';
  const pend = store.oldPending();
  $('#oldBar').hidden = !pend;
  if (pend) $('#oldTxt').textContent = `W tej przeglądarce są serie z poprzedniej aplikacji „BikeRc Siła” (${pend}). Możesz je skopiować tutaj – oryginały zostaną nietknięte.`;
}
function initHist() {
  $('#histExport').onclick = () => deliver(`ciezary-trener-historia-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(store.loadHist())], { type: 'application/json' }));
  $('#histImport').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const n = store.mergeHist(JSON.parse(await f.text())); renderHist(); toast(`Zaimportowano serii: ${n}.`); } catch (err) { toast('To nie jest plik historii.', 3500, true); }
    e.target.value = '';
  };
  $('#histClear').onclick = () => { if (confirm('Usunąć całą historię serii z tej przeglądarki?')) { store.clearHist(); renderHist(); } };
  $('#oldImport').onclick = () => { const n = store.importOld(); renderHist(); toast(`Zaimportowano serii: ${n}.`); };
}

/* =========================================================
   ZAKŁADKI, POMOC, START
   ========================================================= */
function openTab(t) {
  document.body.dataset.tab = t;
  $$('#tabs button').forEach(x => { const on = x.dataset.t === t; x.classList.toggle('on', on); x.setAttribute('aria-current', on ? 'page' : 'false'); });
  $$('.page').forEach(x => x.classList.toggle('on', x.id === 'page-' + t));
  window.scrollTo(0, 0);
  if (t === 'hist') renderHist();
  if (t === 'report' && lastSet) renderReport(lastSet);
  if (t === 'coach') { renderVoices(); }
}
let deferredInstall = null;
function initMisc() {
  $$('#tabs button').forEach(b => b.onclick = () => openTab(b.dataset.t));
  $('#helpEx').innerHTML = Object.keys(EX).map(k => `<li><b>${esc(EX[k].name)}.</b> ${EX[k].desc} <span class="muted">${esc(EX[k].hint)}</span></li>`).join('');
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('#btn-install').hidden = false; });
  $('#btn-install').onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; $('#btn-install').hidden = true; };
  if (!window.isSecureContext) { $('#httpsWarn').hidden = false; }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !TEST) navigator.serviceWorker.register('sw.js').catch(() => {});
  addEventListener('pagehide', () => { try { voice.cancel(); } catch (e) {} });
}

buildExBar(); initSettings(); initCoachUI(); initSource(); initPlateAndTap(); initSession(); initReport(); initHist(); initMisc();
setEx(ex); updateSess(); updateRecBtn(); openTab('train');
loadResources(); loadModel();
if (store.oldPending() && !sessionStorage.getItem('ct_oldtoast') && sessionStorage.setItem('ct_oldtoast', '1') === undefined) setTimeout(() => toast('Znaleziono serie z poprzedniej wersji – importuj je w zakładce Historia.', 5000), 1500);

/* hak do testów automatycznych (?test) */
if (TEST) window.__ct = {
  voice, trainer, S, EX, store, analyzeRep, buildSetData, reportHTML, makePdf,
  get samples() { return samples; }, get liveReps() { return liveReps; }, get sess() { return sess; }, get rest() { return rest; }, get recording() { return recording; }, get lastSet() { return lastSet; },
  fakeCam() { src = 'cam'; updateRecBtn(); updateSess(); },
  start() { startSet(); }, tick, finish() { finishSet(); return lastSet; }, openTab,
  begin(e) { setEx(e); src = 'cam'; resetSet(); recording = true; cdEnd = 0; recStart = 0; recBegan = performance.now(); updateRecBtn(); },
  feed(lm, t) { process(lm, 1280, 720, t + (src === 'cam' ? recStart : 0)); }
};
