/* Ciężary · Trener techniki – raport HTML (do podglądu i udostępniania) oraz raport PDF (© Wojciech Wieczorek) */
import { EX, ST_LABEL } from './engine.js';
import { esc, f0, f1, f2, kg, fmtDate } from './util.js';
import { SOURCES, ZONE_LABEL, FAT_LABEL, kneeZone, loadEffect, NIOSH } from './biomech.js';

const tag = st => `<span class="tag t-${st}">${ST_LABEL[st] || '—'}</span>`;
const valTxt = c => c.value == null ? '—' : `${f0(c.value)} ${c.unit}`;
export const sourceTxt = s => s.src === 'file' ? 'film' + (s.fileName ? ': ' + s.fileName : '') : 'kamera na żywo';
export const barSrcTxt = s => s.barSrc === 'p' ? 'śledzenie talerza' : s.barSrc === 's' ? 'z sylwetki (barki) – przybliżenie' : 'z sylwetki (dłonie) – przybliżenie';
export const scaleTxt = s => s.plateScale ? 'z talerza' : `ze wzrostu (${s.height} cm)`;
const tempoTxt = r => (r.tDown != null && r.tUp != null) ? `${f1(r.tDown)} / ${f1(r.tUp)} s` : '—';

/* ---------- wykres toru gryfu (SVG, cm) ---------- */
export function barPathSVG(reps, exk, dark) {
  const all = reps.flatMap(r => r.path).filter(p => p[0] != null && p[1] != null);
  if (!all.length) return '';
  const xm = Math.ceil((Math.max(12, ...all.map(p => Math.abs(p[0]))) + 3) / 5) * 5;
  const y0 = Math.floor(Math.min(0, ...all.map(p => p[1])) / 10) * 10, y1 = Math.ceil((Math.max(...all.map(p => p[1])) + 4) / 10) * 10;
  const W = 320, pl = 34, pr = 14, pt = 22, pb = 26;
  const k = Math.min((W - pl - pr) / (2 * xm), 300 / (y1 - y0));
  const pw = 2 * xm * k, ph = (y1 - y0) * k, H = ph + pt + pb, ox = pl + ((W - pl - pr) - pw) / 2;
  const X = x => (ox + (x + xm) * k).toFixed(1), Y = y => (pt + (y1 - y) * k).toFixed(1);
  const C = dark ? { g: '#454343', t: '#a3a09f', ref: '#2ec4b6', ok: '#4ade80', warn: '#fbbf24', bad: '#f87171' } : { g: '#e3e7ec', t: '#7a8594', ref: '#1fa597', ok: '#16a34a', warn: '#d97706', bad: '#dc2626' };
  let s = `<svg viewBox="0 0 ${W} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,Arial" font-size="10">`;
  for (let x = -xm; x <= xm; x += 5) if (x % 10 === 0) s += `<line x1="${X(x)}" y1="${pt}" x2="${X(x)}" y2="${(pt + ph).toFixed(1)}" stroke="${C.g}" stroke-width="1"/><text x="${X(x)}" y="${(pt + ph + 14).toFixed(1)}" fill="${C.t}" text-anchor="middle">${x}</text>`;
  for (let y = y0; y <= y1; y += 10) s += `<line x1="${X(-xm)}" y1="${Y(y)}" x2="${X(xm)}" y2="${Y(y)}" stroke="${C.g}" stroke-width="1"/><text x="${(ox - 4).toFixed(1)}" y="${(+Y(y) + 3).toFixed(1)}" fill="${C.t}" text-anchor="end">${y}</text>`;
  s += `<line x1="${X(0)}" y1="${pt - 6}" x2="${X(0)}" y2="${(pt + ph).toFixed(1)}" stroke="${C.ref}" stroke-width="2" stroke-dasharray="5 4"/>`;
  s += `<text x="${X(0)}" y="${pt - 9}" fill="${C.ref}" text-anchor="middle" font-weight="700">${exk === 'bench' ? 'linia barków' : 'środek stopy'}</text>`;
  s += `<text x="${X(xm)}" y="${pt - 9}" fill="${C.t}" text-anchor="end">${exk === 'bench' ? 'głowa →' : 'przód →'}</text>`;
  s += `<text x="${X(-xm)}" y="${pt - 9}" fill="${C.t}">cm</text>`;
  reps.forEach(r => {
    const p = r.path.filter(q => q[0] != null && q[1] != null); if (!p.length) return;
    s += `<polyline fill="none" stroke="${C[r.status]}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" opacity=".9" points="${p.map(q => X(q[0]) + ',' + Y(q[1])).join(' ')}"/>`;
    const top = p.reduce((a, q) => q[1] > a[1] ? q : a, p[0]);
    s += `<text x="${(+X(top[0]) + 5).toFixed(1)}" y="${(+Y(top[1]) - 3).toFixed(1)}" fill="${C[r.status]}" font-weight="700">${r.n}</text>`;
  });
  return s + '</svg>';
}
export function velSVG(reps) {
  const v = reps.map(r => r.vel);
  if (!v.some(x => x != null)) return '';
  const W = 320, H = 180, pl = 30, pb = 22, pt = 14, vm = Math.max(.3, ...v.filter(x => x != null)) * 1.15;
  const bw = (W - pl - 10) / reps.length;
  const C = { ok: '#16a34a', warn: '#d97706', bad: '#dc2626' };
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,Arial" font-size="10">`;
  for (let g = 0; g <= vm; g += vm > 1 ? .25 : .1) { const y = H - pb - (g / vm) * (H - pb - pt); s += `<line x1="${pl}" y1="${y.toFixed(1)}" x2="${W - 6}" y2="${y.toFixed(1)}" stroke="#e3e7ec"/><text x="${pl - 4}" y="${(y + 3).toFixed(1)}" fill="#7a8594" text-anchor="end">${g.toFixed(2).replace('.', ',')}</text>`; }
  reps.forEach((r, i) => {
    const x = pl + i * bw + bw * .18, w = bw * .64;
    if (r.vel != null) { const h = r.vel / vm * (H - pb - pt); s += `<rect x="${x.toFixed(1)}" y="${(H - pb - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${C[r.status]}"/><text x="${(x + w / 2).toFixed(1)}" y="${(H - pb - h - 3).toFixed(1)}" text-anchor="middle" fill="#222">${f2(r.vel)}</text>`; }
    s += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle" fill="#7a8594">${r.n}</text>`;
  });
  return s + `<text x="${W - 6}" y="${pt - 3}" text-anchor="end" fill="#7a8594">m/s</text></svg>`;
}

/* ---------- v2.2: wpływ ciężaru na technikę (tabela + wykres) ---------- */
export function loadEffectSVG(rows, dark) {
  const R = rows.filter(r => r.score != null || r.trunk != null);
  if (R.length < 2) return '';
  const W = 320, H = 170, pl = 30, pr = 30, pt = 16, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
  const C = dark ? { g: '#454343', t: '#a3a09f', a: '#2ec4b6', b: '#fbbf24' } : { g: '#e3e7ec', t: '#7a8594', a: '#12958A', b: '#d97706' };
  const X = i => pl + (R.length === 1 ? iw / 2 : i * iw / (R.length - 1));
  const tr = R.map(r => r.trunk).filter(v => v != null), tMax = Math.max(10, ...tr) * 1.15;
  const Ys = v => pt + ih - v / 100 * ih, Yt = v => pt + ih - v / tMax * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,Arial" font-size="10">`;
  for (let g = 0; g <= 100; g += 25) s += `<line x1="${pl}" y1="${Ys(g).toFixed(1)}" x2="${W - pr}" y2="${Ys(g).toFixed(1)}" stroke="${C.g}"/><text x="${pl - 4}" y="${(Ys(g) + 3).toFixed(1)}" fill="${C.a}" text-anchor="end">${g}</text><text x="${W - pr + 4}" y="${(Ys(g) + 3).toFixed(1)}" fill="${C.b}">${Math.round(tMax * g / 100)}°</text>`;
  R.forEach((r, i) => { s += `<text x="${X(i).toFixed(1)}" y="${H - 9}" fill="${C.t}" text-anchor="middle">${String(r.kg).replace('.', ',')} kg</text>`; });
  const line = (key, Y, col) => { const P = R.map((r, i) => r[key] != null ? [X(i), Y(r[key])] : null).filter(Boolean); if (!P.length) return ''; return `<polyline fill="none" stroke="${col}" stroke-width="2.4" points="${P.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>` + P.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2" fill="${col}"/>`).join(''); };
  s += line('score', Ys, C.a) + line('trunk', Yt, C.b);
  s += `<text x="${pl}" y="${pt - 5}" fill="${C.a}" font-weight="700">ocena</text><text x="${W - pr}" y="${pt - 5}" fill="${C.b}" font-weight="700" text-anchor="end">pochylenie tułowia</text>`;
  return s + '</svg>';
}
export function loadEffectHTML(rows, exk, dark) {
  if (!rows.length) return '';
  const t = `<div class="tw"><table class="le"><tr><th>Ciężar</th><th>Serie</th><th>Ocena</th><th>${exk === 'press' ? 'Odchyl.' : 'Tułów'}</th>${exk === 'squat' || exk === 'deadlift' ? '<th>Kolano</th>' : ''}<th>Prędkość</th>${exk !== 'bench' ? '<th>L4/L5 ścin.</th>' : ''}</tr>${rows.map(r => `<tr><td>${kg(r.kg)}</td><td>${r.sets}</td><td>${r.score ?? '—'}</td><td>${r.trunk != null ? f0(r.trunk) + '°' : '—'}</td>${exk === 'squat' || exk === 'deadlift' ? `<td>${r.knee != null ? f0(r.knee) + '°' : '—'}</td>` : ''}<td>${r.vel != null ? f2(r.vel) + ' m/s' : '—'}</td>${exk !== 'bench' ? `<td>${r.shear != null ? r.shear + ' N' : '—'}</td>` : ''}</tr>`).join('')}</table></div>`;
  const svg = loadEffectSVG(rows, dark);
  return t + (svg ? `<div class="lechart">${svg}</div>` : '');
}
export function sourcesHTML() {
  return `<ol class="src">${SOURCES.map(([n, t, u]) => `<li value="${n}">${esc(t)} <a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace('https://', ''))}</a></li>`).join('')}</ol>`;
}
const zt = st => `<span class="tag t-${st || 'na'}">${ZONE_LABEL[st] || '—'}</span>`;
const ft = st => `<span class="tag t-${st || 'na'}">${FAT_LABEL[st] || '—'}</span>`;

/* ---------- raport HTML ---------- */
export function reportHTML(set, opt = {}) {
  const E = EX[set.ex], S = set.summary, reps = set.reps;
  const d = new Date(set.date);
  const keys = reps[0]?.checks.map(c => c.label) || [];
  let h = `<div class="rh"><div class="logo">${opt.logoSvg || ''}<span class="sub">Trener techniki · ćwiczenia ze sztangą</span></div><div style="text-align:right"><h1>Raport techniki · ${esc(E.name)}</h1><div style="color:#5b6676">${d.toLocaleDateString('pl-PL')} ${d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}${opt.name ? ' · ' + esc(opt.name) : ''}</div></div></div>`;
  h += `<h3>Seria</h3><div class="kv">
    <div><span>Ćwiczenie</span>${esc(E.full)}</div>
    <div><span>Ciężar × powtórzenia</span>${set.weight ? kg(set.weight) : '—'} × ${S.n}${set.plan ? ` <small style="color:#7a8594">(plan ${set.plan})</small>` : ''}</div>
    <div><span>Seria w treningu</span>${set.setNo ? set.setNo + (set.sets ? ' z ' + set.sets : '') : '—'}</div>
    <div><span>Źródło</span>${esc(sourceTxt(set))}</div>
    <div><span>Pozycja gryfu</span>${barSrcTxt(set)}</div>
    <div><span>Skala</span>${scaleTxt(set)}</div>
    <div><span>Czas serii</span>${f1(set.duration)} s</div>
    <div><span>Średnie tempo ↓ / ↑</span>${S.tempoDown != null && S.tempoUp != null ? `${f1(S.tempoDown)} / ${f1(S.tempoUp)} s` : '—'}</div></div>`;
  h += `<h3>Ocena</h3><div class="sum">
    <div class="fitc ch"><div class="t">Ocena techniki</div><div class="v">${S.score ?? '—'}<small style="font-size:13px"> / 100</small></div><div class="d">${S.cnt.ok} dobrze · ${S.cnt.warn} do poprawy · ${S.cnt.bad} błąd</div></div>
    <div class="fitc"><div class="t">Prędkość (najlepsza → ostatnia)</div><div class="v">${f2(S.vBest)} → ${f2(S.vLast)}</div><div class="d">m/s w fazie podnoszenia${S.loss != null ? ` · spadek ${f0(S.loss)}%` : ''}</div></div>
    <div class="fitc"><div class="t">Szacowany max (1RM)</div><div class="v">${S.est1rm ? kg(S.est1rm) : '—'}</div><div class="d">wzór Epleya, orientacyjnie</div></div>
    <div class="fitc"><div class="t">Następna seria</div><div class="v">${S.nextWeight ? kg(S.nextWeight) : '—'}</div><div class="d">propozycja</div></div></div>`;
  h += `<div class="main"><b>Najważniejsze</b>${esc(S.mainIssue ? S.mainIssue.tip : (S.n ? 'Wszystkie powtórzenia technicznie poprawne. Tak trzymaj.' : 'Nie wykryto powtórzeń.'))}<div style="margin-top:6px">${esc(S.advice)}</div></div>`;
  if (reps.length) {
    h += `<h3>Tor gryfu i prędkość</h3><div class="charts"><div>${barPathSVG(reps, set.ex, false)}<div style="font-size:11px;color:#5b6676;margin-top:3px">Tor gryfu każdego powtórzenia (cm), widok z boku. Linia przerywana: ${set.ex === 'bench' ? 'barki na górze ruchu' : 'środek stopy'}. Kolor = ocena.</div></div><div>${velSVG(reps)}<div style="font-size:11px;color:#5b6676;margin-top:3px">Średnia prędkość gryfu w fazie podnoszenia. Spadek o ponad 30% to sygnał zmęczenia.</div></div></div>`;
    h += `<h3>Powtórzenia</h3><div class="tw"><table><tr><th>#</th><th class="l">Ocena</th><th>Zakres</th><th>Prędkość</th><th>Tempo ↓/↑</th>${keys.map(k => `<th>${esc(k)}</th>`).join('')}<th class="l">Uwaga</th></tr>`;
    reps.forEach(r => {
      h += `<tr><td><b>${r.n}</b></td><td class="l">${tag(r.status)} <small>${r.score}</small></td><td>${f0(r.rom)} cm</td><td>${f2(r.vel)} m/s</td><td>${tempoTxt(r)}</td>${r.checks.map(c => `<td>${valTxt(c)}<br>${tag(c.status)}</td>`).join('')}<td class="l">${esc(r.main ? r.main.cue : '—')}</td></tr>`;
    });
    h += `</table></div>`;
    const withImg = reps.filter(r => r.snap);
    if (withImg.length) {
      const best = [...withImg].sort((a, b) => b.score - a.score || a.n - b.n)[0], worstR = [...withImg].sort((a, b) => a.score - b.score || b.n - a.n)[0];
      h += `<h3>Najlepsze i najsłabsze powtórzenie</h3><div class="imgs"><figure><img src="${best.snap}" alt=""><figcaption>Najlepsze: nr ${best.n}, ${best.score} pkt${best.snapPriv ? ' · tło rozmyte' : ''}</figcaption></figure>${worstR !== best ? `<figure><img src="${worstR.snap}" alt=""><figcaption>Najsłabsze: nr ${worstR.n}, ${worstR.score} pkt${worstR.snapPriv ? ' · tło rozmyte' : ''}${worstR.main ? ' – ' + esc(worstR.main.cue.toLowerCase()) : ''}</figcaption></figure>` : ''}</div>`;
    }
    const B = S.bio;
    if (B) {
      h += `<h3>Obciążenia i zmęczenie <small style="text-transform:none;letter-spacing:0">(szacunkowo / orientacyjnie)</small></h3><div class="sum">
        ${set.ex !== 'bench' ? `<div class="fitc"><div class="t">Ścinanie L4/L5 (max)</div><div class="v">${B.shearPeak != null ? B.shearPeak + ' N' : '—'}</div><div class="d">${B.shearPeak != null ? zt(B.shearSt) + ' &lt;500 / 500–1000 / &gt;1000 N' : 'wpisz ciężar'}</div></div>
        <div class="fitc"><div class="t">Ściskanie L4/L5 (max)</div><div class="v">${B.compPeak != null ? f1(B.compPeak / 1000) + ' kN' : '—'}</div><div class="d">${B.compPeak != null ? f1(B.compPeak / NIOSH.ref) + '× odniesienia NIOSH 3400 N (skala, nie zakaz)' : '—'}</div></div>` : ''}
        ${B.kneeAvg != null ? `<div class="fitc"><div class="t">Zgięcie kolana (max)</div><div class="v">${f0(B.kneeMax)}°</div><div class="d">${esc(kneeZone(B.kneeMax)?.tip || '')}</div></div>` : ''}
        <div class="fitc"><div class="t">Zmęczenie</div><div class="v">${B.vlossMax != null ? '−' + f0(B.vlossMax) + '%' : '—'}</div><div class="d">${ft(B.fatigue)} spadek prędkości${B.leanMax >= 5 ? `, tułów +${f0(B.leanMax)}°` : ''} · progi ${B.thrV}% / ${B.thrL}° (startowe)</div></div>
        <div class="fitc"><div class="t">Pewność pomiaru</div><div class="v">${B.conf ?? '—'}%</div><div class="d">${esc(B.confLabel)} · różnice &lt;5° pomijane</div></div></div>`;
      h += `<div class="tw"><table class="bt"><tr><th>#</th><th>${set.ex === 'press' ? 'Odchyl.' : 'Tułów'}</th>${set.ex === 'squat' || set.ex === 'deadlift' ? '<th>Kolano</th>' : ''}${set.ex !== 'bench' ? '<th>Moment L4/L5</th><th>Ściskanie</th><th>Ścinanie</th>' : ''}${set.ex === 'bench' || set.ex === 'press' ? '<th>Chwyt/barki</th>' : ''}<th>Spadek v</th><th>Δ tułowia</th><th>Zmęczenie</th><th>Pewność</th><th class="l">Uwaga</th></tr>`;
      reps.forEach(r => { const b = r.bio || {}, L = b.load;
        h += `<tr><td><b>${r.n}</b></td><td>${b.trunk != null ? f0(b.trunk) + '°' : '—'}</td>${set.ex === 'squat' || set.ex === 'deadlift' ? `<td>${b.knee != null ? f0(b.knee) + '°' : '—'}<br><small>${esc(kneeZone(b.knee)?.label || '')}</small></td>` : ''}${set.ex !== 'bench' ? `<td>${L ? L.moment + ' N·m' : '—'}</td><td>${L ? L.comp + ' N' : '—'}</td><td>${L ? L.shear + ' N<br>' + zt(L.shearSt) : '—'}</td>` : ''}${set.ex === 'bench' || set.ex === 'press' ? `<td>${b.grip != null ? f1(b.grip) + '×' : 'n/d z boku'}</td>` : ''}<td>${b.vloss != null ? f0(b.vloss) + '%' : '—'}</td><td>${b.leanDelta != null ? (b.leanDelta > 0 ? '+' : '') + f0(b.leanDelta) + '°' : '—'}</td><td>${ft(b.fatigue)}</td><td>${b.conf ? b.conf.pct + '%' : '—'}</td><td class="l">${esc(r.safety ? r.safety.cue : '—')}</td></tr>`; });
      h += `</table></div><p style="font-size:11px;color:#5b6676;margin:4px 0 0">Model statyczny odcinka L4/L5 (Cholewicki 1991: ramię prostowników 6 cm, linia działania 5°) ze znanego ciężaru sztangi${B.mass ? `, masy ciała ${B.mass} kg${B.massEst ? ' (szacowanej ze wzrostu)' : ''}` : ''} i kąta tułowia z obrazu; bez przyspieszeń i krzywizny kręgosłupa. Strefy ścinania: Gallagher i Marras 2012; ściskanie: odniesienie NIOSH (Waters 1993) – u trójboistów do ok. 17 kN. Brak reguły „kolana nie za palce” (Fry 2003).</p>`;
      const le = loadEffect(opt.history || [], set.ex);
      if (le.length) h += `<h3>Wpływ ciężaru na technikę</h3>${loadEffectHTML(le, set.ex, false)}<p style="font-size:11px;color:#5b6676;margin:4px 0 0">Twoje serie tego ćwiczenia pogrupowane wg ciężaru. Rosnące pochylenie tułowia lub spadek oceny przy większym ciężarze to sygnał, że technika zaczyna się zmieniać (Shoji 2025, Hooper 2014).</p>`;
    }
    h += `<h3>Wskazówki</h3><ul class="tips">${(S.tips.length ? S.tips : ['Technika w porządku. Pilnuj tego samego toru gryfu przy większym ciężarze.']).map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
  }
  h += `<h3>Źródła</h3><div class="srcw">${sourcesHTML()}</div>`;
  h += `<p class="disc">Obciążenia kręgosłupa i kolan, zmęczenie i pewność pomiaru są szacunkowe (model statyczny z obrazu 2D) – orientacyjnie, progi to wartości startowe do walidacji. `;
  h += `Pomiar markerless (obraz 2D z jednej kamery, MediaPipe Pose). Wartości orientacyjne; pozycja gryfu ${set.barSrc === 'p' ? 'ze śledzenia talerza' : 'liczona z sylwetki jest przybliżeniem'}. Kryteria techniki to własne streszczenie zasad metody „Zacznij od siły” (M. Rippetoe), do uzgodnienia z trenerem. Raport pomaga w technice, ale nie gwarantuje ochrony przed kontuzją i nie zastępuje trenera.<br>Ciężary · Trener techniki · ${new Date().toLocaleString('pl-PL')} · © Wojciech Wieczorek</p>`;
  return h;
}

/* =========================================================
   PDF (jsPDF + czcionki Inter/Archivo osadzone jak w pozostałych aplikacjach BikeRc)
   ========================================================= */
const JSPDF_VER = '2.5.2';
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { s.remove(); rej(new Error('script ' + src)); }; document.head.appendChild(s); });
let pdfLibPromise;
export function loadPdfLib() {
  if (window.jspdf?.jsPDF && window.BRC_FONTS) return Promise.resolve();
  return pdfLibPromise || (pdfLibPromise = (async () => {
    if (!window.jspdf?.jsPDF) { try { await loadScript('./assets/vendor/jspdf.umd.min.js'); } catch (e) { await loadScript(`https://cdn.jsdelivr.net/npm/jspdf@${JSPDF_VER}/dist/jspdf.umd.min.js`); } }
    if (!window.BRC_FONTS) await loadScript('./assets/vendor/report-fonts.js');
  })().catch(e => { pdfLibPromise = null; throw e; }));
}
const logoPng = () => new Promise(res => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = 1818; c.height = 468; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/png')); }; img.onerror = () => res(null); img.src = './assets/logo-bikerc.svg'; });
const imgSize = url => new Promise(res => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res([16, 9]); i.src = url; });
const PC = { dark: '#232222', teal: '#2EC4B6', tealD: '#12958A', tealL: '#E6F7F5', grey: '#6B7170', line: '#D5DCDA', bg: '#F2F4F3', ok: '#16A34A', warn: '#D97706', bad: '#DC2626', okL: '#DCFCE7', warnL: '#FEF3C7', badL: '#FEE2E2' };
const SHORT = { bar: 'Gryf', depth: 'Głęb.', hips: 'Biodra', start: 'Start', shoulders: 'Barki', lockout: 'Wyprost', lean: 'Odchyl.', touch: 'Klatka', elbows: 'Łokcie' };

/** history: wszystkie zapisane serie (do tabeli postępów); set: seria do opisania */
export async function makePdf(set, history, opt = {}) {
  await loadPdfLib();
  const logo = await logoPng();
  const { jsPDF } = window.jspdf, F = window.BRC_FONTS, C = PC;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('Inter-Regular.ttf', F.inter); doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
  doc.addFileToVFS('Inter-Bold.ttf', F.interBold); doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
  doc.addFileToVFS('Archivo-BlackItalic.ttf', F.archivoBlackItalic); doc.addFont('Archivo-BlackItalic.ttf', 'Archivo', 'italic');
  doc.addFileToVFS('Archivo-Bold.ttf', F.archivoBold); doc.addFont('Archivo-Bold.ttf', 'Archivo', 'bold');
  const PW = 210, PH = 297, M = 15, CW = PW - 2 * M;
  const E = EX[set.ex], S = set.summary, reps = set.reps;
  const txt = (s, x, y, o) => doc.text(Array.isArray(s) ? s : String(s), x, y, o);
  const font = (f, st, sz, col) => { doc.setFont(f, st); doc.setFontSize(sz); doc.setTextColor(col || C.dark); };
  const stCol = st => ({ ok: C.ok, warn: C.warn, bad: C.bad }[st] || C.grey);
  const section = (title, y) => {
    if (y > PH - 40) { doc.addPage(); y = 20; }
    font('Archivo', 'bold', 10.5, C.dark); txt(title.toUpperCase(), M, y);
    doc.setDrawColor(C.teal); doc.setLineWidth(.7); doc.line(M, y + 1.8, M + 10, y + 1.8);
    doc.setDrawColor(C.line); doc.setLineWidth(.2); doc.line(M + 10, y + 1.8, PW - M, y + 1.8); return y + 7;
  };

  /* nagłówek */
  if (logo) doc.addImage(logo, 'PNG', M, 12, 48, 48 * 468 / 1818); else { font('Archivo', 'italic', 22, C.teal); txt('BikeRc', M, 20); }
  font('Archivo', 'italic', 20, C.dark); txt('Raport techniki', PW - M, 19, { align: 'right' });
  font('Inter', 'normal', 9, C.grey); txt(`${E.full} · analiza z kamery lub filmu`, PW - M, 25.5, { align: 'right' });
  doc.setFillColor(C.teal); doc.rect(M, 32, CW, 1.2, 'F');
  let y = 41;
  const d = new Date(set.date);
  const info = [
    ['Ćwiczący', opt.name || '—'], ['Data serii', d.toLocaleString('pl-PL', { dateStyle: 'long', timeStyle: 'short' })], ['Ćwiczenie', E.full],
    ['Ciężar × powtórzenia', `${set.weight ? kg(set.weight) : '—'} × ${S.n}${set.plan ? ` (plan ${set.plan})` : ''}`], ['Seria w treningu', set.setNo ? `${set.setNo}${set.sets ? ' z ' + set.sets : ''}` : '—'], ['Czas serii', `${f1(set.duration)} s`],
    ['Źródło', sourceTxt(set)], ['Pozycja gryfu', barSrcTxt(set)], ['Skala', scaleTxt(set)]];
  const cw = CW / 3; doc.setFillColor(C.bg); doc.roundedRect(M, y, CW, 47, 2, 2, 'F');
  info.forEach((it, i) => {
    const cx = M + 5 + (i % 3) * cw, cy = y + 8 + Math.floor(i / 3) * 14.5;
    font('Inter', 'bold', 7, C.grey); txt(it[0].toUpperCase(), cx, cy);
    font('Inter', 'bold', 9.2, C.dark); let l = doc.splitTextToSize(it[1], cw - 7); if (l.length > 1) { font('Inter', 'bold', 7.6, C.dark); l = doc.splitTextToSize(it[1], cw - 7); }
    txt(l.slice(0, 2), cx, cy + 5);
  });
  y += 47 + 8;

  /* KPI */
  y = section('Ocena serii', y);
  const kp = [
    ['Ocena techniki', S.score != null ? String(S.score) : '—', S.n ? `${S.cnt.ok} dobrze · ${S.cnt.warn} popraw · ${S.cnt.bad} błąd` : 'brak powtórzeń'],
    ['Prędkość najl. → ost.', `${f2(S.vBest)}→${f2(S.vLast)}`, `m/s${S.loss != null ? ` · spadek ${f0(S.loss)}%` : ''}`],
    ['Szacowany max (1RM)', S.est1rm ? kg(S.est1rm) : '—', 'wzór Epleya'],
    ['Następna seria', S.nextWeight ? kg(S.nextWeight) : '—', 'propozycja']];
  const kw = (CW - 3 * 4) / 4;
  kp.forEach((k, i) => {
    const x0 = M + i * (kw + 4); doc.setFillColor(i === 0 ? C.tealL : '#FFFFFF'); doc.setDrawColor(i === 0 ? C.teal : C.line); doc.setLineWidth(.3); doc.roundedRect(x0, y, kw, 25, 2, 2, 'FD');
    font('Inter', 'bold', 6.4, C.grey); txt(doc.splitTextToSize(k[0].toUpperCase(), kw - 6)[0], x0 + 4, y + 6.2);
    font('Archivo', 'italic', k[1].length > 8 ? 13 : 19, i === 0 ? C.tealD : C.dark); txt(k[1], x0 + 4, y + 15.5);
    font('Inter', 'normal', 7, C.grey); txt(doc.splitTextToSize(k[2], kw - 6)[0], x0 + 4, y + 21.5);
  });
  y += 25 + 6;
  const main = S.mainIssue ? S.mainIssue.tip : (S.n ? 'Wszystkie powtórzenia technicznie poprawne. Tak trzymaj.' : 'Nie wykryto powtórzeń.');
  const ml = doc.splitTextToSize(main, CW - 12), al = doc.splitTextToSize(S.advice, CW - 12), mh = 9 + ml.length * 4.6 + al.length * 4.2 + 3;
  doc.setFillColor(C.tealL); doc.roundedRect(M, y, CW, mh, 2, 2, 'F'); doc.setFillColor(C.teal); doc.rect(M, y, 1.4, mh, 'F');
  font('Inter', 'bold', 7, C.grey); txt('NAJWAŻNIEJSZE', M + 6, y + 5.5); font('Inter', 'bold', 10, C.dark); txt(ml, M + 6, y + 11);
  font('Inter', 'normal', 9, C.dark); txt(al, M + 6, y + 11 + ml.length * 4.6 + 1.5);
  y += mh + 8;

  /* wykresy */
  if (reps.length) {
    y = section('Tor gryfu i prędkość', y);
    const gw = (CW - 8) * 0.56, vw = (CW - 8) - gw, gh = 74;
    // tor gryfu
    const all = reps.flatMap(r => r.path).filter(p => p[0] != null && p[1] != null);
    const xm = Math.ceil((Math.max(12, ...all.map(p => Math.abs(p[0]))) + 3) / 5) * 5;
    const y0 = Math.floor(Math.min(0, ...all.map(p => p[1])) / 10) * 10, y1 = Math.ceil((Math.max(...all.map(p => p[1])) + 4) / 10) * 10;
    const pl = 9, pb = 7, pt = 9, aw = gw - pl - 2, ah = gh - pb - pt;
    const k = Math.min(aw / (2 * xm), ah / (y1 - y0)), pw = 2 * xm * k, ph = (y1 - y0) * k, ox = M + pl + (aw - pw) / 2, oy = y + pt + (ah - ph) / 2;
    const PX = x => ox + (x + xm) * k, PY = yy => oy + (y1 - yy) * k;
    doc.setDrawColor(C.line); doc.setLineWidth(.2); doc.rect(M, y, gw, gh, 'S');
    font('Inter', 'normal', 6.5, C.grey); doc.setLineWidth(.15);
    for (let x = -xm; x <= xm; x += 10) { doc.line(PX(x), oy, PX(x), oy + ph); txt(String(x), PX(x), oy + ph + 3.6, { align: 'center' }); }
    for (let yy = y0; yy <= y1; yy += 10) { doc.line(PX(-xm), PY(yy), PX(xm), PY(yy)); txt(String(yy), PX(-xm) - 1.2, PY(yy) + 1, { align: 'right' }); }
    doc.setDrawColor(C.teal); doc.setLineWidth(.5); doc.setLineDashPattern([1.6, 1.2], 0); doc.line(PX(0), oy - 2, PX(0), oy + ph); doc.setLineDashPattern([], 0);
    font('Inter', 'bold', 6.8, C.tealD); txt(set.ex === 'bench' ? 'linia barków' : 'środek stopy', PX(0), oy - 3.2, { align: 'center' });
    font('Inter', 'normal', 6.5, C.grey); txt('cm', M + 2, y + 4.5); txt(set.ex === 'bench' ? 'głowa →' : 'przód →', M + gw - 2, y + 4.5, { align: 'right' });
    reps.forEach(r => {
      const p = r.path.filter(q => q[0] != null && q[1] != null); if (p.length < 2) return;
      doc.setDrawColor(stCol(r.status)); doc.setLineWidth(.55);
      const l = []; for (let q = 1; q < p.length; q++) l.push([PX(p[q][0]) - PX(p[q - 1][0]), PY(p[q][1]) - PY(p[q - 1][1])]);
      doc.lines(l, PX(p[0][0]), PY(p[0][1]), [1, 1], 'S', false);
      const top = p.reduce((a, q) => q[1] > a[1] ? q : a, p[0]); font('Inter', 'bold', 6.5, stCol(r.status)); txt(String(r.n), PX(top[0]) + 1.2, PY(top[1]) - .8);
    });
    // prędkość
    const vx = M + gw + 8, vm = Math.max(.3, ...reps.map(r => r.vel || 0)) * 1.15, vp = 9, vb = 7, vt = 6;
    doc.setDrawColor(C.line); doc.setLineWidth(.2); doc.rect(vx, y, vw, gh, 'S');
    const bw = (vw - vp - 2) / reps.length, VH = gh - vb - vt;
    font('Inter', 'normal', 6.5, C.grey); doc.setLineWidth(.15);
    for (let g = 0; g <= vm; g += vm > 1 ? .25 : .1) { const yy = y + gh - vb - g / vm * VH; doc.line(vx + vp, yy, vx + vw - 1, yy); txt(g.toFixed(2).replace('.', ','), vx + vp - 1, yy + 1, { align: 'right' }); }
    txt('m/s', vx + vw - 2, y + 4, { align: 'right' });
    reps.forEach((r, i) => {
      const x = vx + vp + i * bw + bw * .18, w = bw * .64;
      if (r.vel != null) { const h = r.vel / vm * VH; doc.setFillColor(stCol(r.status)); doc.roundedRect(x, y + gh - vb - h, w, h, .6, .6, 'F'); font('Inter', 'bold', 6.3, C.dark); txt(f2(r.vel), x + w / 2, y + gh - vb - h - 1, { align: 'center' }); }
      font('Inter', 'normal', 6.5, C.grey); txt(String(r.n), x + w / 2, y + gh - 2.6, { align: 'center' });
    });
    y += gh + 4;
    font('Inter', 'normal', 7.2, C.grey);
    const cap = doc.splitTextToSize('Lewy wykres: tor gryfu każdego powtórzenia (cm), widok z boku; kolor = ocena (zielony dobrze, żółty do poprawy, czerwony błąd). Prawy: średnia prędkość gryfu w fazie podnoszenia – spadek o ponad 30% to sygnał zmęczenia.', CW);
    txt(cap, M, y + 1); y += cap.length * 3.3 + 7;

    /* tabela powtórzeń */
    y = section('Powtórzenia', y);
    const keys = reps[0].checks.map(c => c.key), nk = keys.length;
    const fixed = [['#', 8, 'l'], ['Ocena', 19, 'l'], ['Zakres', 15, 'r'], ['Prędk.', 15, 'r'], ['Tempo ↓/↑', 20, 'r']];
    const remain = CW - fixed.reduce((a, c) => a + c[1], 0) - 30, kc = remain / nk;
    const cols = [...fixed, ...keys.map(kk => [SHORT[kk] || kk, kc, 'r']), ['Uwaga', 30, 'l']];
    const xs = []; let ax = M; cols.forEach(c => { xs.push(ax); ax += c[1]; });
    const right = i => xs[i] + cols[i][1] - 1.6;
    const head = yy => { doc.setFillColor(C.dark); doc.rect(M, yy, CW, 6.2, 'F'); font('Inter', 'bold', 6.6, '#FFFFFF'); cols.forEach((c, i) => c[2] === 'l' ? txt(c[0].toUpperCase(), xs[i] + 1.8, yy + 4.2) : txt(c[0].toUpperCase(), right(i), yy + 4.2, { align: 'right' })); return yy + 6.2; };
    y = head(y);
    reps.forEach((r, ri) => {
      const note = doc.splitTextToSize(r.main ? r.main.cue : '—', 28.5), rh = Math.max(8, 3 + note.length * 3.6);
      if (y + rh > PH - 22) { doc.addPage(); y = head(20); }
      if (ri % 2) { doc.setFillColor('#FAFBFA'); doc.rect(M, y, CW, rh, 'F'); }
      font('Inter', 'bold', 8.4, C.dark); txt(String(r.n), xs[0] + 1.8, y + 5);
      font('Inter', 'bold', 7.6, stCol(r.status)); txt(`${ST_LABEL[r.status]} ${r.score}`, xs[1] + 1.8, y + 5);
      font('Inter', 'normal', 8, C.dark); txt(`${f0(r.rom)} cm`, right(2), y + 5, { align: 'right' }); txt(r.vel != null ? f2(r.vel) : '—', right(3), y + 5, { align: 'right' }); txt(tempoTxt(r).replace(' s', ''), right(4), y + 5, { align: 'right' });
      r.checks.forEach((c, ci) => { font('Inter', 'bold', 7.8, stCol(c.status)); txt(c.value == null ? '—' : `${f0(c.value)}${c.unit.startsWith('%') ? '%' : c.unit}`, right(5 + ci), y + 5, { align: 'right' }); });
      font('Inter', 'normal', 7.2, C.dark); txt(note, xs[cols.length - 1] + 1.8, y + 4.6);
      y += rh;
    });
    doc.setDrawColor(C.line); doc.setLineWidth(.2); doc.line(M, y, PW - M, y);
    font('Inter', 'normal', 7, C.grey); txt('Kolor wartości = ocena kryterium. Tempo: czas opuszczania / podnoszenia w sekundach. Wartości kryteriów w cm lub stopniach.', M, y + 4.5); y += 11;

    /* zdjęcia */
    const withImg = reps.filter(r => r.snap);
    if (withImg.length) {
      const best = [...withImg].sort((a, b) => b.score - a.score || a.n - b.n)[0], worstR = [...withImg].sort((a, b) => a.score - b.score || b.n - a.n)[0];
      const list = worstR !== best ? [[best, 'Najlepsze'], [worstR, 'Najsłabsze']] : [[best, 'Najlepsze']];
      const sz = await Promise.all(list.map(([r]) => imgSize(r.snap)));
      const gap = 6, iw = (CW - gap) / 2, maxH = 62; let hmax = 0;
      const dims = list.map((_, i) => { let w = iw, h = iw * sz[i][1] / sz[i][0]; if (h > maxH) { h = maxH; w = h * sz[i][0] / sz[i][1]; } hmax = Math.max(hmax, h); return [w, h]; });
      if (y + hmax + 22 > PH - 22) { doc.addPage(); y = 20; }
      y = section('Najlepsze i najsłabsze powtórzenie', y);
      list.forEach(([r, t], i) => {
        const x0 = M + i * (iw + gap), [w, h] = dims[i]; doc.setDrawColor(C.line); doc.setLineWidth(.3); doc.addImage(r.snap, 'JPEG', x0, y, w, h, undefined, 'FAST'); doc.rect(x0, y, w, h, 'S');
        font('Inter', 'bold', 8.2, C.dark); txt(`${t}: nr ${r.n}, ${r.score} pkt`, x0, y + h + 4.6);
        if (t === 'Najsłabsze' && r.main) { font('Inter', 'normal', 7.4, C.grey); txt(doc.splitTextToSize(r.main.cue, iw)[0], x0, y + h + 8.6); }
        if (r.snapPriv) { font('Inter', 'normal', 6.8, C.grey); txt('tło rozmyte (prywatność)', x0, y + h + (t === 'Najsłabsze' && r.main ? 12.4 : 8.6)); }
      });
      y += hmax + 14;
    }
    /* wskazówki */
    y = section('Wskazówki', y);
    const tips = S.tips.length ? S.tips : ['Technika w porządku. Pilnuj tego samego toru gryfu przy większym ciężarze.'];
    for (const t of tips) { const lines = doc.splitTextToSize(t, CW - 8), h = lines.length * 4.3; if (y + h > PH - 24) { doc.addPage(); y = 20; } doc.setFillColor(C.teal); doc.circle(M + 1.5, y - 1.1, 1.1, 'F'); font('Inter', 'normal', 9, C.dark); txt(lines, M + 6, y); y += h + 2.6; }
    y += 4;

    /* v2.2: obciążenia i zmęczenie (szacunkowo) */
    const B = S.bio;
    if (B) {
      if (y > PH - 80) { doc.addPage(); y = 20; }
      y = section('Obciążenia i zmęczenie – szacunkowo / orientacyjnie', y);
      const zc = st => ({ ok: C.ok, warn: C.warn, bad: C.bad }[st] || C.grey);
      const kb = [];
      if (set.ex !== 'bench') {
        kb.push(['Ścinanie L4/L5 max', B.shearPeak != null ? `${B.shearPeak} N` : '—', B.shearPeak != null ? `strefa ${ZONE_LABEL[B.shearSt]} (<500/500–1000/>1000)` : 'wpisz ciężar', B.shearSt]);
        kb.push(['Ściskanie L4/L5 max', B.compPeak != null ? `${f1(B.compPeak / 1000)} kN` : '—', B.compPeak != null ? `${f1(B.compPeak / NIOSH.ref)}× odn. NIOSH 3400 N` : '—', null]);
      }
      if (B.kneeAvg != null) kb.push(['Zgięcie kolana max', `${f0(B.kneeMax)}°`, kneeZone(B.kneeMax)?.label || '', null]);
      kb.push(['Zmęczenie', B.vlossMax != null ? `−${f0(B.vlossMax)}%` : '—', `${FAT_LABEL[B.fatigue] || '—'}${B.leanMax >= 5 ? `, tułów +${f0(B.leanMax)}°` : ''} · próg ${B.thrV}%`, B.fatigue]);
      kb.push(['Pewność pomiaru', B.conf != null ? `${B.conf}%` : '—', B.confLabel, B.conf != null && B.conf < 50 ? 'warn' : null]);
      const kw2 = (CW - (kb.length - 1) * 3) / kb.length;
      kb.forEach((k, i) => {
        const x0 = M + i * (kw2 + 3); doc.setFillColor('#FFFFFF'); doc.setDrawColor(k[3] ? zc(k[3]) : C.line); doc.setLineWidth(.3); doc.roundedRect(x0, y, kw2, 22, 2, 2, 'FD');
        font('Inter', 'bold', 6.2, C.grey); txt(doc.splitTextToSize(k[0].toUpperCase(), kw2 - 5)[0], x0 + 3, y + 5.5);
        font('Archivo', 'italic', 14, k[3] ? zc(k[3]) : C.dark); txt(k[1], x0 + 3, y + 13.5);
        font('Inter', 'normal', 6.3, C.grey); txt(doc.splitTextToSize(k[2], kw2 - 5).slice(0, 2), x0 + 3, y + 17.8);
      });
      y += 22 + 5;
      const sq = set.ex === 'squat' || set.ex === 'deadlift', lb = set.ex !== 'bench', gr = set.ex === 'bench' || set.ex === 'press';
      const bc = [['#', 8, r => String(r.n)], [set.ex === 'press' ? 'Odchyl.' : 'Tułów', 15, r => r.bio?.trunk != null ? f0(r.bio.trunk) + '°' : '—']];
      if (sq) bc.push(['Kolano', 26, r => r.bio?.knee != null ? `${f0(r.bio.knee)}° ${kneeZone(r.bio.knee)?.label || ''}` : '—']);
      if (lb) bc.push(['Moment', 19, r => r.bio?.load ? r.bio.load.moment + ' N·m' : '—'], ['Ściskanie', 19, r => r.bio?.load ? r.bio.load.comp + ' N' : '—'], ['Ścinanie', 19, r => r.bio?.load ? r.bio.load.shear + ' N' : '—', r => r.bio?.load?.shearSt]);
      if (gr) bc.push(['Chwyt', 18, r => r.bio?.grip != null ? f1(r.bio.grip) + '×' : 'n/d']);
      bc.push(['Spadek v', 16, r => r.bio?.vloss != null ? f0(r.bio.vloss) + '%' : '—'], ['Δ tułowia', 16, r => r.bio?.leanDelta != null ? (r.bio.leanDelta > 0 ? '+' : '') + f0(r.bio.leanDelta) + '°' : '—'], ['Zmęczenie', 20, r => FAT_LABEL[r.bio?.fatigue] || '—', r => r.bio?.fatigue], ['Pewność', 15, r => r.bio?.conf ? r.bio.conf.pct + '%' : '—']);
      const kk2 = CW / bc.reduce((a, c) => a + c[1], 0), bx = []; let ab = M; bc.forEach(c => { bx.push(ab); ab += c[1] * kk2; });
      const bhead = yy => { doc.setFillColor(C.dark); doc.rect(M, yy, CW, 6, 'F'); font('Inter', 'bold', 6.4, '#FFFFFF'); bc.forEach((c, i) => txt(c[0].toUpperCase(), bx[i] + 1.6, yy + 4.1)); return yy + 6; };
      y = bhead(y);
      reps.forEach((r, ri) => {
        if (y + 6.4 > PH - 22) { doc.addPage(); y = bhead(20); }
        if (ri % 2) { doc.setFillColor('#FAFBFA'); doc.rect(M, y, CW, 6.4, 'F'); }
        bc.forEach((c, i) => { const st = c[3] ? c[3](r) : null; font('Inter', st ? 'bold' : 'normal', 7.6, st ? zc(st) : C.dark); txt(doc.splitTextToSize(c[2](r), c[1] * kk2 - 2)[0], bx[i] + 1.6, y + 4.4); });
        y += 6.4;
      });
      doc.setDrawColor(C.line); doc.setLineWidth(.2); doc.line(M, y, PW - M, y);
      font('Inter', 'normal', 6.8, C.grey);
      const bn = doc.splitTextToSize(`Model statyczny L4/L5 (Cholewicki 1991: ramię prostowników 6 cm, linia działania 5°) ze znanego ciężaru sztangi, masy ciała${B.mass ? ` ${B.mass} kg${B.massEst ? ' (szacowana ze wzrostu)' : ''}` : ''} i kąta tułowia z obrazu – bez przyspieszeń i krzywizny kręgosłupa, więc wartości są orientacyjne. Strefy ścinania wg Gallagher i Marras 2012; ściskanie względem odniesienia NIOSH 3400 N (ergonomia pracy – skala, nie zakaz). Zmęczenie = spadek prędkości + przyrost pochylenia tułowia; różnice kątów < 5° pomijane (błąd jednej kamery). Progi to wartości startowe do walidacji.`, CW);
      txt(bn, M, y + 4); y += bn.length * 3.1 + 8;
    }
  } else {
    font('Inter', 'normal', 10, C.grey); txt(doc.splitTextToSize('Nie wykryto powtórzeń w tej serii. Sprawdź ustawienie telefonu (z boku, cała sylwetka w kadrze).', CW), M, y); y += 14;
  }

  /* postępy: ostatnie serie tego ćwiczenia */
  const prev = (history || []).filter(h => h.ex === set.ex && h.summary?.n).slice(0, 8);
  if (prev.length >= 2) {
    if (y > PH - 70) { doc.addPage(); y = 20; }
    y = section(`Postępy – ostatnie serie: ${E.name}`, y);
    const pc = [['Data', 38, 'l'], ['Ciężar × powt.', 36, 'l'], ['Ocena', 24, 'r'], ['Max 1RM', 28, 'r'], ['Spadek prędk.', 28, 'r'], ['Główna uwaga', 26, 'l']];
    const pw2 = pc.reduce((a, c) => a + c[1], 0), kk = CW / pw2, px = []; let ap = M; pc.forEach(c => { px.push(ap); ap += c[1] * kk; });
    const pr = i => px[i] + pc[i][1] * kk - 2;
    doc.setFillColor(C.dark); doc.rect(M, y, CW, 6, 'F'); font('Inter', 'bold', 6.8, '#FFFFFF'); pc.forEach((c, i) => c[2] === 'l' ? txt(c[0].toUpperCase(), px[i] + 2, y + 4.1) : txt(c[0].toUpperCase(), pr(i), y + 4.1, { align: 'right' })); y += 6;
    prev.forEach((h, ri) => {
      if (y > PH - 24) { doc.addPage(); y = 20; }
      if (ri % 2) { doc.setFillColor('#FAFBFA'); doc.rect(M, y, CW, 6.2, 'F'); }
      const s = h.summary; font('Inter', 'normal', 8.2, C.dark);
      txt(fmtDate(h.date), px[0] + 2, y + 4.4); txt(`${h.weight ? kg(h.weight) : '—'} × ${s.n}`, px[1] + 2, y + 4.4);
      font('Inter', 'bold', 8.2, s.score >= 85 ? C.ok : s.score >= 60 ? C.warn : C.bad); txt(s.score != null ? String(s.score) : '—', pr(2), y + 4.4, { align: 'right' });
      font('Inter', 'normal', 8.2, C.dark); txt(s.est1rm ? kg(s.est1rm) : '—', pr(3), y + 4.4, { align: 'right' }); txt(s.loss != null ? f0(s.loss) + '%' : '—', pr(4), y + 4.4, { align: 'right' });
      txt(doc.splitTextToSize(s.mainIssue ? s.mainIssue.label : '—', pc[5][1] * kk - 3)[0], px[5] + 2, y + 4.4);
      y += 6.2;
    });
    y += 6;
  }

  /* v2.2: wpływ ciężaru na technikę */
  const le = loadEffect(history || [], set.ex);
  if (le.length) {
    if (y > PH - 60) { doc.addPage(); y = 20; }
    y = section(`Wpływ ciężaru na technikę – ${E.name}`, y);
    const sq = set.ex === 'squat' || set.ex === 'deadlift';
    const lc = [['Ciężar', r => kg(r.kg)], ['Serie', r => String(r.sets)], ['Ocena', r => r.score != null ? String(r.score) : '—'], [set.ex === 'press' ? 'Odchylenie' : 'Tułów', r => r.trunk != null ? f0(r.trunk) + '°' : '—'], ...(sq ? [['Kolano', r => r.knee != null ? f0(r.knee) + '°' : '—']] : []), ['Prędkość', r => r.vel != null ? f2(r.vel) + ' m/s' : '—'], ...(set.ex !== 'bench' ? [['L4/L5 ścin.', r => r.shear != null ? r.shear + ' N' : '—']] : [])];
    const tw = le.length >= 2 ? CW * .55 : CW, cw2 = tw / lc.length;
    doc.setFillColor(C.dark); doc.rect(M, y, tw, 6, 'F'); font('Inter', 'bold', 6.4, '#FFFFFF'); lc.forEach((c, i) => txt(c[0].toUpperCase(), M + i * cw2 + 1.6, y + 4.1));
    const ty0 = y; y += 6;
    le.forEach((r, ri) => { if (ri % 2) { doc.setFillColor('#FAFBFA'); doc.rect(M, y, tw, 6, 'F'); } font('Inter', 'normal', 7.8, C.dark); lc.forEach((c, i) => txt(c[1](r), M + i * cw2 + 1.6, y + 4.2)); y += 6; });
    if (le.length >= 2) {
      // wykres: ocena (teal, 0–100) i pochylenie tułowia (pomarańcz) w funkcji ciężaru
      const gx = M + tw + 6, gw = CW - tw - 6, gh = 46, gy = ty0, pl = 7, pr = 8, pt = 5, pb = 7, iw = gw - pl - pr, ih = gh - pt - pb;
      doc.setDrawColor(C.line); doc.setLineWidth(.2); doc.rect(gx, gy, gw, gh, 'S');
      const tMax = Math.max(10, ...le.map(r => r.trunk || 0)) * 1.15, X = i => gx + pl + i * iw / (le.length - 1);
      font('Inter', 'normal', 5.8, C.grey); doc.setLineWidth(.12);
      for (let g = 0; g <= 100; g += 25) { const yy = gy + pt + ih - g / 100 * ih; doc.line(gx + pl, yy, gx + gw - pr, yy); txt(String(g), gx + pl - 1, yy + .8, { align: 'right' }); txt(Math.round(tMax * g / 100) + '°', gx + gw - pr + 1, yy + .8); }
      le.forEach((r, i) => txt(String(r.kg).replace('.', ','), X(i), gy + gh - 2.2, { align: 'center' }));
      const pl2 = (key, sc, col) => { const P = le.map((r, i) => r[key] != null ? [X(i), gy + pt + ih - r[key] / sc * ih] : null).filter(Boolean); doc.setDrawColor(col); doc.setFillColor(col); doc.setLineWidth(.6); for (let q = 1; q < P.length; q++) doc.line(P[q - 1][0], P[q - 1][1], P[q][0], P[q][1]); P.forEach(p => doc.circle(p[0], p[1], .8, 'F')); };
      pl2('score', 100, C.tealD); pl2('trunk', tMax, C.warn);
      font('Inter', 'bold', 6, C.tealD); txt('ocena', gx + pl, gy + 3.4); font('Inter', 'bold', 6, C.warn); txt('tułów °', gx + gw - pr, gy + 3.4, { align: 'right' });
      y = Math.max(y, gy + gh);
    }
    font('Inter', 'normal', 6.8, C.grey); const ln = doc.splitTextToSize('Serie tego ćwiczenia pogrupowane wg ciężaru (kg). Rosnące pochylenie tułowia lub spadek oceny przy większym ciężarze = technika zmienia się pod obciążeniem (Shoji 2025, Hooper 2014).', CW);
    txt(ln, M, y + 4); y += ln.length * 3.1 + 8;
  }

  /* v2.2: źródła */
  if (y > PH - 50) { doc.addPage(); y = 20; }
  y = section('Źródła', y);
  for (const [n, t, u] of SOURCES) {
    const l = doc.splitTextToSize(`[${n}] ${t} ${u}`, CW); if (y + l.length * 3 > PH - 22) { doc.addPage(); y = 20; }
    font('Inter', 'normal', 6.6, C.dark); txt(l, M, y); y += l.length * 3 + 1.2;
  }
  y += 4;

  /* zastrzeżenie + stopka na każdej stronie */
  if (y > PH - 52) { doc.addPage(); y = 20; }
  y = section('Uwagi', y);
  font('Inter', 'normal', 7.6, C.grey);
  const disc = doc.splitTextToSize(`Obciążenia kręgosłupa i kolan, zmęczenie i pewność pomiaru są szacunkowe (model statyczny z obrazu 2D) – orientacyjnie; progi to wartości startowe do walidacji. Pomiar markerless (obraz 2D z jednej kamery, MediaPipe Pose). Wartości orientacyjne; pozycja gryfu ${set.barSrc === 'p' ? 'ze śledzenia talerza' : 'liczona z sylwetki jest przybliżeniem'}. Kryteria techniki to własne streszczenie zasad metody „Zacznij od siły” (M. Rippetoe), do uzgodnienia z trenerem. Raport pomaga w technice, ale nie gwarantuje ochrony przed kontuzją i nie zastępuje trenera.`, CW);
  txt(disc, M, y);
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setDrawColor(C.line); doc.setLineWidth(.2); doc.line(M, PH - 14, PW - M, PH - 14);
    font('Inter', 'bold', 8, C.tealD); txt('© Wojciech Wieczorek', M, PH - 8.5); const w = doc.getTextWidth('© Wojciech Wieczorek');
    font('Inter', 'normal', 8, C.grey); txt('· Ciężary · Trener techniki', M + w + 2.2, PH - 8.5); txt(`Strona ${i} z ${n}`, PW - M, PH - 8.5, { align: 'right' });
  }
  doc.setProperties({ title: `Raport techniki – ${E.name}`, author: 'Wojciech Wieczorek', subject: 'Ciężary · Trener techniki', creator: 'Ciężary · Trener techniki © Wojciech Wieczorek' });
  return doc.output('blob');
}
