"""Plain-language provenance dialogs; no changes to scientific data or geometry."""
from __future__ import annotations
import functools
import hashlib
import json
import os
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results/source-guide'
OUT.mkdir(parents=True, exist_ok=True)
BODIES = {'mercury': 'JGMESS160A', 'venus': 'SHG120', 'earth': 'EGM2008', 'moon': 'GRGM900C', 'mars': 'GMM-3'}
FORBIDDEN = ['해상도', '구면조화', 'SHA-256', 'Taylor', '쌍선형', '단위 법선', '65,160', '2.5분', '격자', 'W₀', 'kN']


def main():
    protected = [ROOT / 'app-v6.html', *sorted((ROOT / 'data').rglob('*'))]
    hashes = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected if p.is_file()}
    index = (ROOT / 'index.html').read_text(encoding='utf-8')
    if 'source-guide.js' not in index:
        marker = '<script src="./earth-global.js?v=1"><\\/script>'
        assert marker in index, 'Unexpected loader; refusing a blind candidate edit'
        index = index.replace(marker, marker + '<script src="./source-guide.js?v=1"><\\/script>')
    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            if urlsplit(self.path).path in ('/', '/index.html'):
                data = index.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                super().do_GET()
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    site = os.getenv('TEST_SITE_URL') or f'http://127.0.0.1:{server.server_port}/'
    report = {'site': site, 'status': 'running', 'dialogs': []}
    errors = []
    try:
        with sync_playwright() as pw:
            executable = shutil.which('google-chrome') or shutil.which('chromium')
            browser = pw.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
            for width, height in [(1440, 900), (390, 844), (360, 740)]:
                page = browser.new_page(viewport={'width': width, 'height': height}, is_mobile=width < 600, has_touch=width < 600)
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(site + '?test=source-guide#geoid/earth', wait_until='domcontentloaded')
                page.wait_for_function("window.GeoidAtlas?.sourceGuideVersion==='1.0.0'", timeout=45000)
                for body, model in BODIES.items():
                    page.evaluate('b=>route("geoid",b)', body)
                    getter = 'getEarthGeoidState' if body == 'earth' else 'getPlanetGeoidState'
                    page.wait_for_function(f"GeoidAtlas.{getter}().status==='ready'", timeout=45000)
                    page.evaluate('state.rotate=false;state.formation=1')
                    before = page.evaluate(f'GeoidAtlas.{getter}()')
                    sample = page.evaluate('b=>b==="earth"?GeoidAtlas.sampleEarthGeoid(36,128):GeoidAtlas.samplePlanetGeoid(b,36,128)', body)
                    button = '[data-earth-global="sources"]' if body == 'earth' else '[data-planet-action="sources"]'
                    assert '자료 출처 · 그림 설명' in page.locator(button).inner_text()
                    page.click(button)
                    guide = page.locator('#dialog .source-guide')
                    assert guide.count() == 1 and guide.get_attribute('data-source-body') == body
                    text = guide.inner_text()
                    assert model in text and '원자료' in text
                    assert all(word not in text for word in FORBIDDEN), text
                    assert guide.locator('h3').all_text_contents() == ['자료는 어디에서 왔나요?', '이 그림은 무엇을 보여주나요?', '볼 때 알아두세요', '출처 확인하기']
                    assert '실제 비율 1×' in text and '중력의 세기를 비교하지' in text
                    assert len(text) < 1500
                    assert guide.locator('.formula-card, code, table').count() == 0
                    links = guide.locator('a').evaluate_all('(aa)=>aa.map(a=>({href:a.href,rel:a.rel}))')
                    assert all('noopener' in a['rel'] and a['href'].startswith('https://') for a in links)
                    hrefs = [a['href'] for a in links]
                    assert len(hrefs) == len(set(hrefs))
                    if body == 'earth':
                        assert 'https://cdn.proj.org/us_nga_README.txt' in hrefs
                        assert 'KN' in text and 'EGM' in text
                    else:
                        assert before['meta']['source'] in hrefs and before['meta']['label'] in hrefs
                    if body == 'mercury':
                        assert '공식적으로 정해진 수성의 높이 기준을 뜻하지는 않습니다' in text
                    if body == 'venus':
                        assert '기준을 상세히 설명하지 않아' in text
                    if body == 'mars':
                        assert '일부 높이 변화' in text and '아레오이드' in text
                    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
                    assert page.locator('#dialog').evaluate('(e)=>e.scrollWidth <= e.clientWidth+1')
                    if width != 360:
                        page.screenshot(path=str(OUT / f'{body}-source-{width}.png'))
                    page.keyboard.press('Escape')
                    assert page.locator('#dialogBackdrop').is_hidden()
                    assert page.locator(button).evaluate('(b)=>document.activeElement===b')
                    after = page.evaluate(f'GeoidAtlas.{getter}()')
                    assert before['meta'] == after['meta'] and before['exaggeration'] == after['exaggeration']
                    assert sample == page.evaluate('b=>b==="earth"?GeoidAtlas.sampleEarthGeoid(36,128):GeoidAtlas.samplePlanetGeoid(b,36,128)', body)
                    if body != 'earth':
                        page.evaluate('b=>selectPlanet(b)', body)
                        assert page.locator('#dialog .source-guide').get_attribute('data-source-body') == body
                        page.click('[data-action="close-dialog"]')
                    page.locator(button).focus()
                    page.keyboard.press('Enter')
                    assert page.locator('#dialog .source-guide').count() == 1
                    page.click('[data-action="close-dialog"]')
                    report['dialogs'].append({'body': body, 'width': width, 'characters': len(text), 'links': len(hrefs)})
                page.evaluate('route("geoid","earth");selectPlanet("earth")')
                assert page.evaluate('GeoidAtlas.getState().mode') == 'map'
                page.wait_for_function("GeoidAtlas.getModelState().status==='ready'", timeout=45000)
                page.click('[data-model="egm"]')
                page.click('[data-density="10"]')
                assert page.evaluate('GeoidAtlas.getVisiblePointCount()') == 479
                assert abs(page.evaluate('GeoidAtlas.getDataSummary().rmse') - .26755207604096415) < 1e-8
                page.click('[data-model="kn"]')
                assert page.evaluate('GeoidAtlas.getModelState().model') == 'kn'
                page.close()
            browser.close()
        assert not errors, errors
        for relative, digest in hashes.items():
            assert hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() == digest
        report.update(status='passed', allFiveBodies=True, desktopAndMobile=True, plainLanguage=True, noResolutionOrFormulas=True, originalLinksPreserved=True, referenceCaveatsPreserved=True, escapeAndFocus=True, keyboard=True, modelDataUnchanged=True, mapControlsUnchanged=True, pageErrors=errors)
    finally:
        server.shutdown()
        (OUT / 'checks.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
