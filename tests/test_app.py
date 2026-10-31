"""Testy end-to-end (Playwright, Chrome) – Ciężary · Trener techniki. © Wojciech Wieczorek
Uruchomienie:  python3 -m http.server 8099 &  ;  python3 tests/test_app.py
Pliki wideo do testów (testmedia/) są PRYWATNE i nie trafiają do repozytorium.
"""
import os, sys, json, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE', 'http://localhost:8099/')
SHOTS = os.path.join(ROOT, 'screenshots'); PRIV = os.path.join(SHOTS, 'private')
MEDIA = os.environ.get('TESTMEDIA', '/workspace/testmedia')
os.makedirs(SHOTS, exist_ok=True); os.makedirs(PRIV, exist_ok=True)

# Atrapa mowy: zapisuje wypowiedzi, symuluje onstart/onend; jeden polski głos + angielski
SPEECH_MOCK = """
(() => {
  window.__said = [];
  const voices = [
    {name:'Zosia (test)', lang:'pl-PL', voiceURI:'zosia', localService:true, default:false},
    {name:'Samantha', lang:'en-US', voiceURI:'sam', localService:true, default:true}
  ];
  window.SpeechSynthesisUtterance = class { constructor(t){ this.text = t; this.volume=1; this.rate=1; this.pitch=1; this.lang=''; this.voice=null; } };
  const noVoices = location.search.includes('novoices');
  const synth = {
    speaking:false, pending:false, paused:false, _t:null,
    getVoices(){ return noVoices ? [] : voices; },
    addEventListener(){}, removeEventListener(){},
    speak(u){
      window.__said.push({text:u.text, vol:u.volume, rate:u.rate, lang:u.lang, voice:u.voice && u.voice.voiceURI});
      this.speaking = true;
      setTimeout(()=>{ u.onstart && u.onstart({}); }, 5);
      this._t = setTimeout(()=>{ this.speaking=false; u.onend && u.onend({}); }, 40 + u.text.length*14);
    },
    cancel(){ clearTimeout(this._t); this.speaking=false; },
    pause(){}, resume(){}
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
})();
"""

# Syntetyczny szkielet z boku: przysiad (głębokość d: 0 → 1)
SYN = """
window.__sk = function(d, ex){
  const hipx = .5 - .07*d, hipy = .50 + .20*d;
  const shx = hipx + .06*d, shy = .30 + .19*d;
  const kx = .5 + .07*d, ky = .69, ax = .5, ay = .88;
  const P = (x,y)=>({x, y, z:0, visibility:1});
  const lm = Array.from({length:33}, ()=>P(.5,.5));
  const set=(i,x,y)=>{ lm[i]=P(x,y); };
  set(0, shx+.03, shy-.08); set(7, shx+.01, shy-.06); set(8, shx+.02, shy-.06);
  [11,12].forEach((i,k)=>set(i, shx+.004*k, shy)); [13,14].forEach((i,k)=>set(i, shx+.03, shy+.07+.002*k));
  [15,16].forEach((i,k)=>set(i, shx+.02, shy+.01+.002*k));
  [23,24].forEach((i,k)=>set(i, hipx+.004*k, hipy)); [25,26].forEach((i,k)=>set(i, kx+.004*k, ky));
  [27,28].forEach((i,k)=>set(i, ax+.004*k, ay)); [29,30].forEach((i,k)=>set(i, ax-.03, ay+.015)); [31,32].forEach((i,k)=>set(i, ax+.07, ay+.015));
  return lm;
};
window.__rep = function(n, T, t0){  // n powtórzeń po T s; zwraca czas końca
  const fps = 30; let t = t0;
  const frames = (dur, fn)=>{ const k = Math.round(dur*fps); for(let i=0;i<=k;i++){ window.__ct.feed(window.__sk(fn(i/k)), t); t += 1/fps; } };
  frames(1.0, ()=>0);
  for (let r=0;r<n;r++) frames(T, u=>(1-Math.cos(2*Math.PI*u))/2);
  frames(1.0, ()=>0);
  return t;
};
"""

errors = []
results = []
def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info and not cond else ''))

def overflow(pg):
    return pg.evaluate("document.documentElement.scrollWidth - innerWidth")

def run_profile(p, label, ctx_kwargs, full=False):
    print(f'\n=== {label} ===')
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=[
        '--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
        '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        f'--use-file-for-fake-video-capture={MEDIA}/squat.y4m'])
    ctx = b.new_context(permissions=['camera'], accept_downloads=True, locale='pl-PL', **ctx_kwargs)
    ctx.add_init_script(SPEECH_MOCK)
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errs.append('console.error: ' + m.text) if m.type == 'error' else None)
    pg.goto(BASE + '?test'); pg.wait_for_function("window.__ct", timeout=15000)
    pg.add_script_tag(content=SYN)
    pg.wait_for_function("document.querySelector('#statusTxt').textContent.startsWith('Pose')", timeout=60000)
    check(f'{label}: model wczytany', True)
    check(f'{label}: brak poziomego przewijania (Trening)', overflow(pg) <= 0, overflow(pg))
    pg.screenshot(path=f'{SHOTS}/{label}-trening.png')

    # ---- zakładki ----
    for t in ['coach', 'report', 'hist', 'help', 'train']:
        pg.click(f'#tabs button[data-t="{t}"]'); pg.wait_for_timeout(150)
        check(f'{label}: zakładka {t} otwarta, brak przewijania poziomego', pg.evaluate(f"document.querySelector('#page-{t}').classList.contains('on')") and overflow(pg) <= 0, overflow(pg))

    # ---- ustawienia głosu ----
    pg.click('#tabs button[data-t="coach"]')
    opts = pg.eval_on_selector_all('#voiceSel option', 'o=>o.map(x=>x.textContent)')
    check(f'{label}: lista głosów zawiera polski głos', any('Zosia' in o for o in opts), opts)
    check(f'{label}: wskaźnik głosu', 'Zosia' in pg.inner_text('#voiceInfo') or 'pol' in pg.inner_text('#voiceInfo').lower(), pg.inner_text('#voiceInfo'))
    pg.evaluate("window.__said.length=0")
    pg.click('#vTest'); pg.wait_for_timeout(300)
    said = pg.evaluate("window.__said")
    said = [x for x in said if x['text'].strip()]
    check(f'{label}: test głosu mówi po polsku', len(said) >= 1 and said[0]['lang'].startswith('pl') and said[0]['voice'] == 'zosia', said[:1])
    pg.click('#segLevel button[data-l="3"]') if pg.query_selector('#segLevel button[data-l="3"]') else pg.click('#segLevel button:nth-child(3)')
    check(f'{label}: poziom rozmowności zapisany', pg.evaluate("window.__ct.S.coach.level") == 3)
    pg.fill('#vVol', '0.6'); pg.dispatch_event('#vVol', 'input'); pg.dispatch_event('#vVol', 'change'); pg.wait_for_timeout(200)
    check(f'{label}: głośność zapisana i użyta', abs(pg.evaluate("window.__ct.S.coach.volume") - .6) < .01 and abs(pg.evaluate("window.__said.at(-1).vol") - .6) < .01)
    pg.reload(); pg.wait_for_function("window.__ct"); pg.add_script_tag(content=SYN)
    check(f'{label}: ustawienia trenera po odświeżeniu', pg.evaluate("window.__ct.S.coach.level") == 3 and abs(pg.evaluate("window.__ct.S.coach.volume") - .6) < .01)
    pg.screenshot(path=f'{SHOTS}/{label}-trener.png') if False else None

    # ---- wyciszenie ----
    pg.click('#voicePill'); pg.evaluate("window.__said.length=0")
    pg.evaluate("window.__ct.voice.say('Test wyciszenia', {})")
    check(f'{label}: wyciszony trener milczy', pg.evaluate("window.__said.length") == 0)
    pg.click('#voicePill'); pg.wait_for_timeout(300)
    check(f'{label}: po włączeniu trener mówi', pg.evaluate("window.__said.length") >= 1)

    # ---- seria z syntetycznym szkieletem (4 powtórzenia) ----
    pg.evaluate("window.__ct.S.coach.level = 3"); pg.fill('#plan', '4'); pg.fill('#weight', '100'); pg.dispatch_event('#weight', 'change')
    pg.evaluate("window.__said.length=0")
    pg.evaluate("window.__ct.begin('squat')")
    pg.evaluate("window.__rep(4, 3.0, 0)")
    reps = pg.evaluate("window.__ct.liveReps.length")
    check(f'{label}: policzono 4 powtórzenia', reps == 4, reps)
    pg.wait_for_timeout(500)
    texts = [s['text'] for s in pg.evaluate("window.__ct.voice.log")]
    check(f'{label}: głos podaje numery powtórzeń', any('Jeden' in t or 'Pierwsze' in t or 'jeden' in t for t in texts) and any('Cztery' in t or 'Czwarte' in t or 'cztery' in t for t in texts), texts)
    # auto-koniec serii po zaplanowanej liczbie powtórzeń
    pg.wait_for_function("window.__ct.lastSet && window.__ct.lastSet.reps && window.__ct.lastSet.reps.length>0", timeout=20000)
    set_ = pg.evaluate("({n: window.__ct.lastSet.reps.length, score: window.__ct.lastSet.score, e1rm: window.__ct.lastSet.e1rm, ex: window.__ct.lastSet.ex})")
    check(f'{label}: seria zakończona automatycznie (plan 4)', set_['n'] == 4 and set_['ex'] == 'squat', set_)
    pg.wait_for_timeout(1500)
    texts = [s['text'] for s in pg.evaluate("window.__said")]
    check(f'{label}: głos podsumowuje serię', any(('serii' in t.lower() or 'seria' in t.lower()) and ('powtórz' in t.lower() or 'ocen' in t.lower() or 'wynik' in t.lower()) for t in texts), texts[-6:])
    check(f'{label}: karta podsumowania widoczna', pg.is_visible('#cardSum'))
    check(f'{label}: wpis w historii', pg.evaluate("window.__ct.store.loadHist().length") >= 1)
    pg.wait_for_timeout(300)
    if pg.is_visible('#restOv'):
        pg.screenshot(path=f'{SHOTS}/{label}-odpoczynek.png')
        check(f'{label}: nakładka odpoczynku z odliczaniem', 'Odpoczynek' in pg.inner_text('#restOv') or ':' in pg.inner_text('#restTime'))
        pg.click('#restStop'); pg.wait_for_timeout(200)
    check(f'{label}: brak przewijania po serii', overflow(pg) <= 0, overflow(pg))
    pg.screenshot(path=f'{SHOTS}/{label}-podsumowanie.png', full_page=False)

    # ---- raport + PDF ----
    pg.click('#tabs button[data-t="report"]'); pg.wait_for_timeout(300)
    check(f'{label}: raport wyrenderowany', pg.is_visible('#report') and len(pg.inner_text('#report')) > 200)
    check(f'{label}: raport zawiera © Wojciech Wieczorek', 'Wojciech Wieczorek' in pg.inner_text('#page-report') or 'Wojciech Wieczorek' in pg.inner_html('#report'))
    check(f'{label}: brak przewijania poziomego (raport)', overflow(pg) <= 0, overflow(pg))
    pg.screenshot(path=f'{SHOTS}/{label}-raport.png')
    with pg.expect_download(timeout=40000) as dl:
        pg.click('#pdfBtn')
    path = dl.value.path()
    data = open(path, 'rb').read()
    check(f'{label}: PDF pobrany (%PDF, >10 kB)', data[:4] == b'%PDF' and len(data) > 10000, len(data))
    check(f'{label}: nazwa pliku PDF', dl.value.suggested_filename.endswith('.pdf'), dl.value.suggested_filename)
    with pg.expect_download(timeout=20000) as dl2:
        pg.click('#csvBtn')
    csv = open(dl2.value.path(), encoding='utf-8-sig').read()
    check(f'{label}: CSV pobrany', len(csv.splitlines()) >= 2, csv[:80])

    # ---- historia ----
    pg.click('#tabs button[data-t="hist"]'); pg.wait_for_timeout(300)
    check(f'{label}: historia pokazuje serię', pg.locator('#histList > *').count() >= 1)
    check(f'{label}: brak przewijania poziomego (historia)', overflow(pg) <= 0, overflow(pg))
    pg.screenshot(path=f'{SHOTS}/{label}-historia.png')
    with pg.expect_download(timeout=10000) as dl3:
        pg.click('#histExport')
    j = json.load(open(dl3.value.path(), encoding='utf-8'))
    check(f'{label}: eksport JSON', (isinstance(j, list) and len(j) >= 1) or (isinstance(j, dict) and j), type(j))

    # ---- migracja ze starej wersji ----
    pg.evaluate("(()=>{ const h = JSON.parse(localStorage.getItem('ciezary_trener_history_v2')); const e = {...h[0], id:'old-1', date:'2026-01-02T10:00:00.000Z'}; localStorage.setItem('bikerc_sila_history_v1', JSON.stringify([e])); })()")
    pg.reload(); pg.wait_for_function("window.__ct"); pg.add_script_tag(content=SYN)
    pg.click('#tabs button[data-t="hist"]'); pg.wait_for_timeout(300)
    check(f'{label}: wykryto serie ze starej wersji', pg.evaluate("window.__ct.store.oldPending()") >= 1 and pg.is_visible('#oldBar'))
    pg.click('#oldImport'); pg.wait_for_timeout(300)
    check(f'{label}: import starych serii', pg.evaluate("window.__ct.store.oldPending()") == 0)

    if full:
        # ---- przepływ: odliczanie → seria → przerwa → następna seria ----
        pg.evaluate("localStorage.clear()")
        pg.reload(); pg.wait_for_function("window.__ct"); pg.add_script_tag(content=SYN)
        pg.click('#tabs button[data-t="train"]')
        pg.evaluate("window.__ct.S.coach.level = 3; window.__ct.S.coach.countdown = 5; window.__ct.S.coach.rest = 5; window.__ct.S.coach.autoNext = true; window.__ct.S.coach.autoEnd = true")
        pg.fill('#plan', '2'); pg.fill('#sets', '2'); pg.fill('#weight', '60')
        pg.evaluate("window.__said.length=0; window.__ct.fakeCam(); window.__ct.start()")
        pg.wait_for_timeout(300)
        texts = [s['text'] for s in pg.evaluate("window.__said")]
        check(f'{label}: zapowiedź serii pierwszej', any('Seri' in t and ('pierwsz' in t.lower() or 'jeden' in t.lower() or '1' in t) for t in texts), texts)
        pg.wait_for_function("document.querySelector('#recBtn').textContent === 'Koniec serii'", timeout=15000)
        texts = [s['text'] for s in pg.evaluate("window.__said")]
        check(f'{label}: odliczanie 3-2-1 i start', any(t.strip().lower().startswith('trzy') or 'Trzy' in t for t in texts) and any('Start' in t or 'Rusz' in t or 'Jedziemy' in t or 'start' in t.lower() for t in texts), texts)
        pg.evaluate("window.__rep(2, 3.0, 0)")
        pg.wait_for_function("window.__ct.rest !== null", timeout=25000)
        pg.wait_for_timeout(600)
        check(f'{label}: po serii startuje przerwa', pg.is_visible('#restOv'))
        pg.wait_for_timeout(1500)
        texts = [s['text'] for s in pg.evaluate("window.__ct.voice.log")]
        check(f'{label}: głos zapowiada przerwę', any('przerw' in t.lower() or 'odpocz' in t.lower() for t in texts), texts[-5:])
        pg.screenshot(path=f'{SHOTS}/{label}-przerwa.png')
        pg.wait_for_function("window.__ct.rest === null && window.__ct.sess.setNo === 2", timeout=25000)
        pg.wait_for_function("document.querySelector('#recBtn').textContent === 'Anuluj' || window.__ct.recording", timeout=15000)
        texts = [s['text'] for s in pg.evaluate("window.__said")]
        check(f'{label}: automatycznie startuje seria 2 z 2', any('drug' in t.lower() or 'dwa' in t.lower() or 'ostatni' in t.lower() for t in texts), texts[-6:])
        pg.evaluate("window.__ct.finish()")
        pg.wait_for_timeout(200)

        # ---- film z pliku (prywatny, lokalnie) ----
        vid = f'{MEDIA}/squat.mp4'
        if os.path.exists(vid):
            pg.reload(); pg.wait_for_function("window.__ct")
            pg.wait_for_function("document.querySelector('#statusTxt').textContent.startsWith('Pose')", timeout=60000)
            pg.set_input_files('#fileIn', vid)
            pg.wait_for_selector('#vctl:not([hidden])', timeout=15000)
            check(f'{label}: film wczytany, widoczne sterowanie', pg.is_visible('#vctl'))
            pg.click('#vPlay'); pg.wait_for_timeout(2500)
            t1 = pg.evaluate("document.querySelector('#video').currentTime")
            check(f'{label}: film odtwarza się (postęp > 0)', t1 > 0.3, t1)
            pg.click('#vPlay'); pg.click('#vStart'); pg.click('#vFwd'); pg.click('#vBack')
            check(f'{label}: sterowanie filmem bez błędów', True)
            pg.screenshot(path=f'{PRIV}/{label}-film.png')
            pg.evaluate("window.__said.length=0")
            # analiza całego filmu
            pg.click('#recBtn'); pg.wait_for_function("window.__ct.recording || window.__ct.lastSet", timeout=10000)
            pg.wait_for_function("window.__ct.lastSet && window.__ct.lastSet.reps.length>0", timeout=120000)
            n = pg.evaluate("window.__ct.lastSet.reps.length")
            check(f'{label}: analiza filmu wykryła powtórzenia', n >= 1, n)
            vt = [x['text'] for x in pg.evaluate("window.__ct.voice.log")]
            check(f'{label}: po analizie filmu trener podsumowuje serię', any('Koniec serii' in t for t in vt), vt[-3:])
            pg.screenshot(path=f'{PRIV}/{label}-film-wynik.png')
        else:
            print('(pominięto test filmu – brak testmedia)')

        # ---- kamera (fałszywe urządzenie) ----
        pg.reload(); pg.wait_for_function("window.__ct")
        pg.wait_for_function("document.querySelector('#statusTxt').textContent.startsWith('Pose')", timeout=60000)
        pg.click('#emptyCam')
        try: pg.wait_for_function("(()=>{const t=document.querySelector('#bFps').textContent; return /^[1-9]/.test(t)})()", timeout=20000)
        except Exception: pass
        fps = pg.inner_text('#bFps')
        check(f'{label}: kamera uruchomiona (fps w HUD)', 'fps' in fps and not pg.is_visible('#empty'), fps)
        pg.screenshot(path=f'{PRIV}/{label}-kamera.png')

    bad = [e for e in errs if 'favicon' not in e]
    check(f'{label}: brak błędów JS/konsoli', not bad, bad[:3])
    errors.extend(bad)
    ctx.close(); b.close()

with sync_playwright() as p:
    run_profile(p, 'pixel7', {**p.devices['Pixel 7']}, full=True)
    run_profile(p, 'iphone13', {k: v for k, v in p.devices['iPhone 13'].items() if k not in ('default_browser_type',)})
    run_profile(p, 'desktop', {'viewport': {'width': 1366, 'height': 820}})

    # ---- tryb bez głosów (awaryjny) ----
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--enable-unsafe-swiftshader'])
    ctx = b.new_context(**p.devices['Pixel 7']); ctx.add_init_script(SPEECH_MOCK)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE + '?test&novoices'); pg.wait_for_function("window.__ct"); pg.click('#tabs button[data-t="coach"]'); pg.wait_for_timeout(500)
    check('bez głosów: wskazówka dla użytkownika', len(pg.inner_text('#voiceInfo')) > 10, pg.inner_text('#voiceInfo'))
    check('bez głosów: brak błędów', not errs, errs)
    b.close()

fails = [r for r in results if not r[1]]
print(f'\nWYNIK: {len(results) - len(fails)}/{len(results)} testów zaliczonych')
for f in fails: print('  NIEZALICZONY:', f[0], f[2])
sys.exit(1 if fails else 0)
