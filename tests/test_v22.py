"""Testy v2.2 (Playwright, Chrome, szerokość telefonu): obciążenia kręgosłupa i kolan, zmęczenie, wpływ ciężaru na technikę,
źródła, raport HTML/PDF/CSV, głos – na syntetycznym szkielecie oraz (lokalnie) na klipie stockowym testmedia/squat.mp4.
Robi też zrzuty screenshots/v22-*.png. © Wojciech Wieczorek
Uruchom:  python3 -m http.server 8099 &  ;  python3 tests/test_v22.py"""
import os, sys, subprocess
from playwright.sync_api import sync_playwright
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, 'test_app.py'), encoding='utf-8').read().split('errors = []')[0].replace('os.path.dirname(os.path.dirname(os.path.abspath(__file__)))', repr(os.path.dirname(here)))
exec(src)   # BASE, SHOTS, MEDIA, SPEECH_MOCK, SYN
VID = os.path.join(MEDIA, 'squat.mp4')
# seria ze zmęczeniem: każde powtórzenie wolniejsze, tułów coraz bardziej pochylony
SYN2 = """
window.__sk2 = function(d, lean){ const lm = window.__sk(d); const hipx = lm[23].x;
  [11,12].forEach((i,k)=>{ lm[i] = {...lm[i], x: hipx + (.06+lean)*d + .004*k}; }); [13,14,15,16].forEach(i=>{ lm[i] = {...lm[i], x: lm[i].x + lean*d}; });
  lm[0] = {...lm[0], x: lm[0].x + lean*d}; return lm; };
window.__repF = function(n, t0){ const fps = 30; let t = t0;
  const frames = (dur, fn)=>{ const k = Math.round(dur*fps); for(let i=0;i<=k;i++){ const [d,l] = fn(i/k); window.__ct.feed(window.__sk2(d,l), t); t += 1/fps; } };
  frames(1.0, ()=>[0,0]);
  for (let r=0;r<n;r++){ const T = 2.4 + r*.55, lean = r < 2 ? 0 : .025*(r-1); frames(T, u=>[(1-Math.cos(2*Math.PI*u))/2, lean]); }
  frames(1.0, ()=>[0,0]); return t; };
"""
def overflow(pg): return pg.evaluate("document.documentElement.scrollWidth - innerWidth")
res = []
def check(name, ok, info=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + (f'  [{info}]' if info and not ok else ''), flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(locale='pl-PL', accept_downloads=True, **p.devices['Pixel 7']); ctx.add_init_script(SPEECH_MOCK)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    def boot():
        pg.wait_for_function("window.__ct", timeout=20000); pg.add_script_tag(content=SYN); pg.add_script_tag(content=SYN2)
    pg.goto(BASE + '?test'); boot()
    pg.wait_for_function("document.querySelector('#statusTxt').textContent.startsWith('Pose')", timeout=90000)
    check('stopka: wersja 2.2', 'Wersja 2.2' in pg.inner_text('footer'))
    check('pigułki v2.2 w karcie „Na żywo”', pg.locator('#liveBio .bz').count() == 4)
    # ustawienia: masa ciała i progi
    pg.click('#cardAn summary'); pg.fill('#mass', '80'); pg.dispatch_event('#mass', 'change')
    pg.fill('#thrL', '6'); pg.dispatch_event('#thrL', 'change')
    pg.reload(); boot()
    check('masa ciała i próg zapisane po odświeżeniu', pg.evaluate("window.__ct.S.mass") == '80' and pg.evaluate("window.__ct.S.thr.lean") == 6)
    pg.evaluate("window.__ct.S.thr.lean = 5"); pg.evaluate("window.__ct.S.coach.level = 2; window.__ct.S.coach.rest = 0")
    # seria 1: lżejsza (60 kg)
    pg.fill('#plan', '4'); pg.fill('#weight', '60'); pg.dispatch_event('#weight', 'change')
    pg.evaluate("window.__ct.begin('squat'); window.__rep(4, 3.0, 0)")
    pg.wait_for_function("window.__ct.lastSet && window.__ct.lastSet.reps.length === 4", timeout=20000)
    r = pg.evaluate("window.__ct.lastSet.reps[1].bio")
    check('powtórzenie: szacowane obciążenie L4/L5 (moment, ściskanie, ścinanie)', r and r.get('load') and r['load']['moment'] > 0 and r['load']['comp'] > 0 and r['load']['shear'] >= 0, r)
    check('powtórzenie: zgięcie kolana i strefa', r['knee'] and r['kneeZone'] in ('low', 'mid', 'peak', 'deep'), r)
    check('powtórzenie: pewność pomiaru', 0 < r['conf']['pct'] <= 100, r.get('conf'))
    check('masa ciała z ustawień (80 kg)', r['mass'] == 80 and r['massEst'] is False)
    sb = pg.evaluate("window.__ct.lastSet.summary.bio")
    check('podsumowanie serii: bio (ścinanie max, kolano, zmęczenie)', sb and sb['shearPeak'] is not None and sb['kneeAvg'] and sb['fatigue'] in ('ok', 'warn', 'bad'), sb)
    check('historia: zapis bio i ciężaru', pg.evaluate("(()=>{const h=window.__ct.store.loadHist()[0];return h.weight===60 && !!h.summary.bio && h.summary.bio.trunkAvg!=null})()"))
    check('karta podsumowania: blok obciążeń', pg.is_visible('#cardSum .biosum') and 'L4/L5' in pg.inner_text('#cardSum'))
    check('pigułki pokazują wartości (N, °, %)', ' N' in pg.inner_text('#bzSpine') and '°' in pg.inner_text('#bzKnee') and '%' in pg.inner_text('#bzConf'), pg.inner_text('#liveBio'))
    # seria 2: cięższa (100 kg) ze zmęczeniem i narastającym pochyleniem
    pg.fill('#plan', '6'); pg.fill('#weight', '100'); pg.dispatch_event('#weight', 'change')
    pg.evaluate("window.__said.length = 0; window.__ct.begin('squat')")
    pg.evaluate("window.__repF(6, 0)")
    pg.wait_for_function("window.__ct.lastSet && window.__ct.lastSet.weight === 100", timeout=30000)
    pg.wait_for_timeout(1500)
    reps = pg.evaluate("window.__ct.lastSet.reps.map(r=>({v:r.vel, f:r.bio.fatigue, vl:r.bio.vloss, dl:r.bio.leanDelta, s:r.safety&&r.safety.key, sh:r.bio.load&&r.bio.load.shear}))")
    print('  seria 100 kg:', reps)
    check('zmęczenie wykryte w serii (spadek prędkości + pochylenie)', any(x['f'] in ('warn', 'bad') for x in reps[2:]), reps)
    check('więcej kg → większe ścinanie L4/L5 niż przy 60 kg', max(x['sh'] or 0 for x in reps) > sb['shearPeak'], (reps, sb['shearPeak']))
    sb2 = pg.evaluate("window.__ct.lastSet.summary.bio")
    check('porównanie z lżejszą serią (baseline 60 kg)', sb2['base'] and sb2['base']['weight'] == 60, sb2.get('base'))
    log = [x['text'] for x in pg.evaluate("window.__ct.voice.log")]
    check('głos: krótka uwaga o zmęczeniu/pochyleniu', any(('kończ serię' in t) or ('Prędkość spada' in t) or ('pochylasz' in t) for t in log), log[-8:])
    rep_lines = [t for t in log if t.split('.')[0].strip().lower() in ('jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć')]
    check('głos: najwyżej jedna uwaga na powtórzenie', all(t.count('.') <= 3 for t in rep_lines), rep_lines)
    if pg.is_visible('#restOv'): pg.click('#restStop')
    pg.locator('#cardSum').scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{SHOTS}/v22-podsumowanie.png')
    # raport HTML
    pg.click('#tabs button[data-t="report"]'); pg.wait_for_timeout(500)
    rt = pg.text_content('#report')
    check('raport: sekcja obciążeń „szacunkowo / orientacyjnie”', 'Obciążenia i zmęczenie' in rt and 'szacunkowo' in rt.lower())
    check('raport: wpływ ciężaru (60 i 100 kg)', 'Wpływ ciężaru na technikę' in rt and '60 kg' in rt and '100 kg' in rt)
    check('raport: źródła (Cholewicki, Gallagher, Escamilla)', 'Źródła' in rt and 'Cholewicki' in rt and 'Gallagher' in rt and 'Escamilla' in rt)
    check('raport: brak reguły „kolana za palce” w ocenach', 'nie za palce' in rt and 'Fry 2003' in rt)
    check('raport: brak przewijania poziomego', overflow(pg) <= 0, overflow(pg))
    pg.locator('#report h3:has-text("Obciążenia i zmęczenie")').scroll_into_view_if_needed(); pg.evaluate("window.scrollBy(0,-70)"); pg.wait_for_timeout(200)
    pg.screenshot(path=f'{SHOTS}/v22-raport.png')
    pg.locator('#report h3:has-text("Wpływ ciężaru")').scroll_into_view_if_needed(); pg.evaluate("window.scrollBy(0,-70)"); pg.wait_for_timeout(200)
    pg.screenshot(path=f'{SHOTS}/v22-raport-wplyw-ciezaru.png')
    with pg.expect_download(timeout=60000) as dl: pg.click('#pdfBtn')
    pdf = os.path.join(SHOTS, 'raport-przyklad-v22.pdf'); dl.value.save_as(pdf)
    txt = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True).stdout
    check('PDF: obciążenia L4/L5, wpływ ciężaru, źródła', 'L4/L5' in txt and 'wpływ ciężaru' in txt.lower() and 'źródła' in txt.lower() and 'Cholewicki' in txt, len(txt))
    check('PDF: zastrzeżenie „szacunkowe … orientacyjnie”', 'szacunkowe' in txt and 'orientacyjnie' in txt)
    with pg.expect_download(timeout=20000) as dl2: pg.click('#csvBtn')
    csv = open(dl2.value.path(), encoding='utf-8-sig').read()
    check('CSV: kolumny obciążeń i zmęczenia', 'scinanie_L4L5_N' in csv and 'sciskanie_L4L5_N' in csv and 'spadek_predkosci_proc' in csv and 'pewnosc_proc' in csv)
    # historia: wpływ ciężaru
    pg.click('#tabs button[data-t="hist"]'); pg.wait_for_timeout(400)
    check('historia: tabela wpływu ciężaru (2 ciężary)', pg.locator('#loadEff table tr').count() >= 3 and pg.locator('#loadEff svg').count() >= 1)
    check('historia: brak przewijania poziomego', overflow(pg) <= 0, overflow(pg))
    pg.evaluate("document.querySelector('#toast').classList.remove('show')")
    pg.locator('#loadEff').scroll_into_view_if_needed(); pg.evaluate("window.scrollBy(0,-90)"); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{SHOTS}/v22-historia-wplyw-ciezaru.png')
    # pomoc: źródła
    pg.click('#tabs button[data-t="help"]'); pg.wait_for_timeout(300)
    n_src = pg.locator('#helpSrc li').count()
    check('pomoc: lista źródeł', n_src >= 14, n_src)
    pg.evaluate("document.querySelector('#toast').classList.remove('show')")
    pg.locator('#helpBio').scroll_into_view_if_needed(); pg.evaluate("document.querySelector('#helpBio').scrollIntoView({block:'start'}); window.scrollBy(0,-80)"); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{SHOTS}/v22-pomoc-zrodla.png')
    # ławka: obciążenia kręgosłupa nie dotyczą, chwyt z boku n/d
    pg.click('#tabs button[data-t="train"]'); pg.evaluate("window.__ct.setEx('bench')")
    rb = pg.evaluate("""(()=>{ const S=[]; for(let i=0;i<120;i++){ const t=i/30, d=(1-Math.cos(2*Math.PI*t/2))/2; S.push({t, bx:600, by:300+80*d, ry:300+80*d, mfx:600, f:1, shx:600, shy:300, hipx:800, hipy:320, kx:900, ky:330, ay:400, kneeFlex:90, hipAng:170, torso:80, elbow:170-90*d, forearm:5, leg:300, trunk:200, q:.9, sg:.05}); }
      const s = window.__ct.buildSetData({samples:S, ex:'bench', weight:80, height:178, mass:80, history:[]}); return s && s.reps.length ? s.reps[0].bio : null; })()""")
    check('wyciskanie leżąc: bez modelu L4/L5, chwyt „n/d z boku”', rb is not None and rb['load'] is None and rb['gripSt'] == 'na', rb)
    pg.evaluate("window.__ct.setEx('squat')")
    # klip stockowy (lokalnie, nie w repozytorium)
    if os.path.exists(VID):
        pg.fill('#weight', '60'); pg.dispatch_event('#weight', 'change')
        pg.set_input_files('#fileIn', VID); pg.wait_for_selector('#vctl:not([hidden])', timeout=20000)
        pg.click('#recBtn'); pg.wait_for_function("window.__ct.recording", timeout=10000)
        try:
            pg.wait_for_function("window.__ct.liveReps.length >= 1", timeout=120000)
            pg.wait_for_timeout(700); pg.evaluate("window.scrollTo(0,0)")
            pg.screenshot(path=f'{SHOTS}/v22-live.png')
            pg.locator('#cardLive').screenshot(path=f'{SHOTS}/v22-live-karta.png')
        except Exception as e: print('  (brak powtórzenia w trakcie – zrzut po analizie)', e)
        pg.wait_for_function("window.__ct.lastSet && window.__ct.lastSet.src === 'file'", timeout=180000)
        fs = pg.evaluate("(()=>{const s=window.__ct.lastSet;return {n:s.reps.length, bio:s.reps.map(r=>({k:r.bio.knee, c:r.bio.conf.pct, sh:r.bio.load&&r.bio.load.shear, t:r.bio.trunk})), sum:s.summary.bio}})()")
        print('  klip stockowy:', fs['n'], 'powt.', fs['bio'][:6], 'pewność', fs['sum'] and fs['sum']['conf'])
        check('KLIP: wykryto powtórzenia', fs['n'] >= 1, fs['n'])
        check('KLIP: kolano, tułów, L4/L5 i pewność dla każdego powtórzenia', fs['n'] >= 1 and all(x['k'] is not None and x['t'] is not None and x['sh'] is not None and 0 < x['c'] <= 100 for x in fs['bio']), fs['bio'])
        if not os.path.exists(f'{SHOTS}/v22-live.png'): pg.screenshot(path=f'{SHOTS}/v22-live.png')
    else:
        print('(pominięto klip stockowy – brak testmedia/squat.mp4)')
    bad = [e for e in errs if 'favicon' not in e]
    check('brak błędów JS/konsoli', not bad, bad[:3])
    b.close()
print(f'\nWYNIK v2.2: {sum(res)}/{len(res)}')
sys.exit(0 if all(res) else 1)
