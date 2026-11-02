"""Testy trybu prywatności (rozmycie tła) – Playwright + kamera testowa / film stockowy.
Uruchom:  python3 -m http.server 8099 &  ;  python3 tests/test_privacy.py http://localhost:8099/ [chromium|webkit]
Kamera: --use-file-for-fake-video-capture=$FAKE_VIDEO (domyślnie /workspace/testmedia/squat.y4m – klip stockowy, NIE nagranie klienta).
Film z pliku: $FILE_VIDEO (domyślnie /workspace/testmedia/squat.mp4). Żadne media nie są częścią repozytorium."""
import sys, os, json, subprocess, tempfile, glob
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8099/'
ENGINE = sys.argv[2] if len(sys.argv) > 2 else 'chromium'
FAKE = os.environ.get('FAKE_VIDEO', '/workspace/testmedia/squat.y4m')
FILEV = os.environ.get('FILE_VIDEO', '/workspace/testmedia/squat.mp4')
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'screenshots')
KEY = 'ciezary_trener_settings_v2'
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', f'--use-file-for-fake-video-capture={FAKE}',
        '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader']
res = []
def check(name, ok, info=''):
    res.append(bool(ok)); print(('PASS' if ok else 'FAIL'), name, info, flush=True)

# średni gradient (ostrość) regionu [x0,x1]×[y0,y1] (ułamki kadru) – płótno vs. surowa klatka wideo
JS_SHARP = """([x0,x1,y0,y1])=>{
  const c=document.getElementById('view'),v=document.getElementById('video'),w=c.width,h=c.height;
  const t=document.createElement('canvas');t.width=w;t.height=h;t.getContext('2d').drawImage(v,0,0,w,h);
  const mir=document.getElementById('mirror').checked;
  const g=(cv)=>{const X0=Math.max(0,Math.round(x0*w)),X1=Math.min(w,Math.round(x1*w)),Y0=Math.max(0,Math.round(y0*h)),Y1=Math.min(h,Math.round(y1*h));
    const d=cv.getContext('2d').getImageData(X0,Y0,X1-X0,Y1-Y0);const W=d.width,H=d.height;let s=0,n=0;
    for(let y=0;y<H-1;y++)for(let x=0;x<W-1;x++){const i=(y*W+x)*4,j=i+4,k=i+W*4;
      const a=d.data[i]*.3+d.data[i+1]*.59+d.data[i+2]*.11,b=d.data[j]*.3+d.data[j+1]*.59+d.data[j+2]*.11,e=d.data[k]*.3+d.data[k+1]*.59+d.data[k+2]*.11;
      s+=Math.abs(a-b)+Math.abs(a-e);n++}return s/n};
  let raw=t; if(mir){raw=document.createElement('canvas');raw.width=w;raw.height=h;const q=raw.getContext('2d');q.translate(w,0);q.scale(-1,1);q.drawImage(t,0,0)}
  return {canvas:g(c),raw:g(raw)}}"""
BG = [0.0, 0.25, 0.42, 0.92]     # lewy dół kadru (tło, poza pasem gryfu i sylwetką)

def pbox(page, idx, pad=0.0):
    """ramka z punktów pozy (piksele wideo → ułamki, z uwzględnieniem lustra)"""
    return page.evaluate("""([idx,pad])=>{const p=__ct.pts,c=document.getElementById('view');if(!p)return null;const m=document.getElementById('mirror').checked;
      const xs=idx.map(i=>m?1-p[i].x/c.width:p[i].x/c.width),ys=idx.map(i=>p[i].y/c.height);
      return [Math.min(...xs)-pad,Math.max(...xs)+pad,Math.min(...ys)-pad,Math.max(...ys)+pad]}""", [idx, pad])
def barbox(page):
    return page.evaluate("""()=>{const b=__ct.cur&&__ct.cur.bar,c=document.getElementById('view');if(!b)return null;const m=document.getElementById('mirror').checked;
      const x=m?1-b.x/c.width:b.x/c.width,y=b.y/c.height;return [x-.04,x+.04,y-.05,y+.05]}""")
def ratio(page, box):
    r = page.evaluate(JS_SHARP, box); return r['canvas'] / max(r['raw'], 1e-6), r
def grad_of_png(path, left=.1):
    from PIL import Image; import numpy as np
    a = np.asarray(Image.open(path).convert('L')).astype(float); h, w = a.shape
    reg = a[int(.05*h):int(.85*h), :int(w*left)]; return abs(np.diff(reg, axis=0)).mean() + abs(np.diff(reg, axis=1)).mean()

def jsclick(page, sel): page.evaluate(f"document.querySelector('{sel}').click()")

def wait_pose(page):
    page.wait_for_function('window.__ct&&window.__ct.pts&&window.__ct.cur', timeout=120000); page.wait_for_timeout(1500)

def run(p):
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=ARGS) if ENGINE == 'chromium' else p.webkit.launch()
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}, permissions=['camera'], accept_downloads=True, locale='pl-PL')
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    if os.environ.get('NOFILTER'):   # symulacja Safari bez ctx.filter – zapasowe rozmycie przez zmniejszanie
        page.add_init_script("Object.defineProperty(CanvasRenderingContext2D.prototype,'filter',{get(){return 'none'},set(v){}})")
        print('tryb NOFILTER: ctx.filter wyłączone')
    page.add_init_script("window.__said=[];window.SpeechSynthesisUtterance=class{constructor(t){this.text=t}};"
        "Object.defineProperty(window,'speechSynthesis',{value:{speaking:false,getVoices(){return[{name:'Zosia',lang:'pl-PL',voiceURI:'zosia',localService:true}]},addEventListener(){},removeEventListener(){},speak(u){window.__said.push(u.text);setTimeout(()=>u.onend&&u.onend({}),30)},cancel(){},pause(){},resume(){}},configurable:true})")
    url = BASE + '?test'
    page.goto(url); page.wait_for_function('window.__ct', timeout=20000); page.wait_for_timeout(500)
    # --- UI i trwałość
    check('domyślnie włączone (przełącznik + przycisk 🔒)', page.is_checked('#blur') and page.get_attribute('#sPriv', 'aria-pressed') == 'true' and page.evaluate('__ct.S.blur') is True)
    check('etykieta przełącznika', 'Prywatność: rozmyj tło' in page.text_content('label.switch:has(#blur)'))
    page.evaluate("document.querySelector('#sPriv').click()")
    check('wyłączenie zapisuje się w localStorage', page.evaluate(f"JSON.parse(localStorage.getItem('{KEY}')).blur") is False and page.get_attribute('#sPriv', 'aria-pressed') == 'false' and not page.is_checked('#blur'))
    page.reload(); page.wait_for_function('window.__ct'); page.wait_for_timeout(500)
    check('ustawienie „wyłączone” przetrwało odświeżenie', not page.is_checked('#blur') and page.get_attribute('#sPriv', 'aria-pressed') == 'false')
    page.evaluate("document.querySelector('#blur').click()")
    page.reload(); page.wait_for_function('window.__ct'); page.wait_for_timeout(500)
    check('ustawienie „włączone” przetrwało odświeżenie', page.is_checked('#blur') and page.evaluate('__ct.S.blur') is True)
    check('wersja w stopce', 'Wersja 2.1' in page.inner_text('footer'))

    if ENGINE == 'chromium':
        page.wait_for_function("document.querySelector('#statusTxt').textContent.startsWith('Pose')", timeout=90000)
        page.click('#emptyCam'); wait_pose(page)
        check('plakietka „Tło rozmyte” widoczna przy kamerze', page.is_visible('#bPriv'))
        r, raw = ratio(page, BG)
        check('KAMERA: tło rozmyte (gradient ≤ 55% oryginału)', r <= .55, f'{r:.2f} {raw}')
        pb = pbox(page, [11, 12, 23, 24]); rp, rawp = ratio(page, pb)
        check('KAMERA: tułów ostry (≥ 60%)', rp >= .6, f'{rp:.2f} {rawp}')
        bb = barbox(page); rb, rawb = ratio(page, bb)
        check('KAMERA: okolica gryfu ostra (≥ 60%)', rb >= .6, f'{rb:.2f} {rawb} {bb}')
        hb = pbox(page, [15, 16, 19, 20], .03); rh, rawh = ratio(page, hb)
        check('KAMERA: strefa dłoni/nadgarstków ostra (≥ 60%)', rh >= .6, f'{rh:.2f} {rawh}')
        check('KAMERA: maska segmentacji dostarczona', (page.evaluate('__ct.PRIV.cov') or 0) > .01, str(page.evaluate('__ct.PRIV.cov')))
        page.locator('#stage').screenshot(path=f'{SHOTS}/privacy-blur-on.png')
        # pomiary nadal liczone
        ok = page.evaluate("(()=>{const c=__ct.cur;return !!c&&isFinite(c.bar.x)&&isFinite(c.torso)||isFinite(c.kneeFlex)})()")
        check('KAMERA: pomiary (cur) nadal liczone', ok)
        # zrzut do raportu
        url_on = page.evaluate('__ct.snapNow()')
        sp = tempfile.mktemp(suffix='.jpg'); open(sp, 'wb').write(__import__('base64').b64decode(url_on.split(',')[1]))
        g = grad_of_png(sp); check('ZRZUT (raport): tło rozmyte', g < 6, f'g={g:.2f}')
        # seria na żywo (bez odliczania) → raport/PDF
        page.evaluate("__ct.S.coach.countdown=0; __ct.S.coach.autoEnd=false; __ct.S.coach.autoNext=false")
        page.click('#recBtn'); page.wait_for_function('__ct.recording', timeout=15000); page.wait_for_timeout(9000)
        n = page.evaluate('__ct.samples.length'); check('SERIA: próbki zbierane przy włączonej prywatności', n > 15, n)
        # strefa toru gryfu: pas wzdłuż toru ostry (sztanga nie jest rozmywana)
        rb2, rawb2 = ratio(page, barbox(page)); check('SERIA: gryf ostry w trakcie serii', rb2 >= .6, f'{rb2:.2f}')
        page.evaluate('__ct.finish()'); page.wait_for_timeout(1800)
        sets = page.evaluate("(()=>{const s=__ct.lastSet;return s?{reps:s.reps.length,snaps:s.reps.filter(r=>r.snap).length,priv:s.reps.filter(r=>r.snapPriv).length}:null})()")
        print('  seria:', sets)
        # na potrzeby PDF dołóż zrzut z płótna do powtórzeń bez zdjęcia (kamera testowa nie zawsze daje ruch)
        page.evaluate("(()=>{const s=__ct.lastSet;if(!s)return;const u=__ct.snapNow();s.reps.forEach(r=>{if(!r.snap){r.snap=u;r.snapPriv=true}})})()")
        page.click('#tabs button[data-t="report"]'); page.wait_for_timeout(500)
        have_rep = page.evaluate("(()=>{const s=__ct.lastSet;return !!s&&s.reps.length>0})()")
        if have_rep:
            check('RAPORT HTML: opis „tło rozmyte”', 'tło rozmyte' in page.inner_text('#report'))
            with page.expect_download(timeout=90000) as dl: page.click('#pdfBtn')
            pp = tempfile.mktemp(suffix='.pdf'); dl.value.save_as(pp)
            check('PDF: wygenerowany', open(pp, 'rb').read(5) == b'%PDF-')
            d = tempfile.mkdtemp(); subprocess.run(['pdfimages', '-j', pp, d + '/im'], check=False)
            from PIL import Image
            fs = [f for f in sorted(glob.glob(d + '/im*')) if Image.open(f).size[0] > 250 and 'logo' not in f]
            vals = [grad_of_png(f) for f in fs]
            check('PDF: obrazy w raporcie mają rozmyte tło', len(vals) >= 1 and min(vals) < 6, f'{len(vals)} obr., g={[round(float(v),2) for v in vals]}')
        else:
            print('  (brak powtórzeń w serii z kamery testowej – pomijam raport/PDF)')
        jsclick(page,'#restStop') if page.is_visible('#restOv') else None
        page.click('#tabs button[data-t="train"]'); page.wait_for_timeout(300)
        # --- wyłączenie → ostre tło
        jsclick(page,'#sPriv'); page.wait_for_timeout(1500)
        r2, raw2 = ratio(page, BG); check('KAMERA: po wyłączeniu tło ostre (≥ 80%)', r2 >= .8, f'{r2:.2f} {raw2}')
        check('plakietka znika po wyłączeniu', not page.is_visible('#bPriv'))
        page.evaluate("(()=>{const o=document.querySelector('#restOv');if(o)o.style.display='none'})()"); page.wait_for_timeout(300)
        page.locator('#stage').screenshot(path=f'{SHOTS}/privacy-blur-off.png')
        jsclick(page,'#sPriv'); page.wait_for_timeout(1200)
        # --- fail-closed: model nic nie zwraca => cały kadr rozmyty
        page.evaluate("(()=>{const l=__ct.landmarker;l.__o=l.detectForVideo.bind(l);l.detectForVideo=()=>({landmarks:[],segmentationMasks:[]})})()")
        page.wait_for_timeout(1800)
        rf, rawf = ratio(page, [0.0, 1.0, 0.05, 0.95]); check('FAIL-CLOSED: brak sylwetki => cały kadr rozmyty', rf <= .45, f'{rf:.2f} {rawf}')
        page.evaluate("(()=>{const l=__ct.landmarker;l.detectForVideo=l.__o})()")
        page.click('#camBtn'); page.wait_for_timeout(500)

        # --- film z pliku
        if os.path.exists(FILEV):
            page.set_input_files('#fileIn', FILEV); page.wait_for_selector('#vctl:not([hidden])', timeout=20000)
            page.evaluate("document.querySelector('#video').play()"); wait_pose(page)
            r, raw = ratio(page, BG); check('FILM: tło rozmyte', r <= .55, f'{r:.2f} {raw}')
            rp, rawp = ratio(page, pbox(page, [11, 12, 23, 24])); check('FILM: tułów ostry', rp >= .55, f'{rp:.2f} {rawp}')
            rb, rawb = ratio(page, barbox(page)); check('FILM: okolica gryfu ostra', rb >= .55, f'{rb:.2f} {rawb}')
            page.click('#vPlay'); page.wait_for_timeout(600)
            jsclick(page,'#sPriv'); page.wait_for_timeout(1200)
            r3, raw3 = ratio(page, BG); check('FILM: przełączenie na wstrzymanym filmie → ostre', r3 >= .75, f'{r3:.2f}')
            jsclick(page,'#sPriv'); page.wait_for_timeout(1200)
            r4, raw4 = ratio(page, BG); check('FILM: ponowne włączenie na wstrzymanym filmie → rozmyte', r4 <= .55, f'{r4:.2f}')
            jsclick(page,'#vStart'); page.wait_for_timeout(1500)
            rs, raws = ratio(page, BG)
            check('FILM: po przewinięciu tło nadal rozmyte', rs <= .85, f'{rs:.2f}')
    else:
        print('UWAGA: WebKit – sprawdzono tylko UI/trwałość (inferencja MediaPipe niedostępna w headless WebKit na tym hoście)')
    bad = [e for e in errs if 'favicon' not in e and 'wakeLock' not in e and 'NotAllowed' not in e]
    check('brak błędów JS', not bad, '; '.join(bad)[:300])
    ctx.close(); br.close()

with sync_playwright() as p:
    run(p)
print(f'\n{sum(res)}/{len(res)} OK')
sys.exit(0 if all(res) else 1)
