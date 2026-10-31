"""Zrzuty ekranu do README (dane syntetyczne – bez żadnych prywatnych nagrań). © Wojciech Wieczorek"""
import os, sys
sys.argv = ['x']
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, 'test_app.py'), encoding='utf-8').read().split('errors = []')[0].replace('os.path.dirname(os.path.dirname(os.path.abspath(__file__)))', repr(os.path.dirname(here)))
exec(src)
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--enable-unsafe-swiftshader'])
    ctx = b.new_context(locale='pl-PL', **p.devices['Pixel 7']); ctx.add_init_script(SPEECH_MOCK)
    pg = ctx.new_page(); pg.goto(BASE + '?test'); pg.wait_for_function("window.__ct"); pg.add_script_tag(content=SYN)
    pg.wait_for_function("document.querySelector('#statusTxt').textContent.startsWith('Pose')", timeout=60000)
    pg.evaluate("window.__ct.S.coach.level=3; window.__ct.S.coach.rest=90")
    pg.fill('#plan', '4'); pg.fill('#weight', '100'); pg.evaluate("window.__ct.begin('squat'); window.__rep(4, 3.0, 0)")
    pg.wait_for_function("window.__ct.lastSet", timeout=20000); pg.wait_for_timeout(1800)
    pg.screenshot(path=f'{SHOTS}/mobile-odpoczynek.png')
    pg.click('#restStop'); pg.wait_for_timeout(300)
    pg.locator('#cardSum').scroll_into_view_if_needed(); pg.wait_for_timeout(300); pg.screenshot(path=f'{SHOTS}/mobile-podsumowanie.png')
    pg.click('#tabs button[data-t="coach"]'); pg.wait_for_timeout(300); pg.evaluate("window.scrollTo(0,0)"); pg.screenshot(path=f'{SHOTS}/mobile-trener.png')
    pg.click('#tabs button[data-t="report"]'); pg.wait_for_timeout(400); pg.evaluate("window.scrollTo(0,0)"); pg.screenshot(path=f'{SHOTS}/mobile-raport.png')
    with pg.expect_download(timeout=40000) as dl: pg.click('#pdfBtn')
    dl.value.save_as(f'{SHOTS}/raport-przyklad.pdf')
    b.close()
