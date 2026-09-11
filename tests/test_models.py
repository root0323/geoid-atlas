"""Browser regression checks using the real checked-in EGM/KN/observation data."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import csv
import hashlib
import json
import os
import shutil

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'test-results'
OUTPUT.mkdir(exist_ok=True)


def main():
    original = (ROOT / 'app-v6.html').read_bytes()
    assert hashlib.sha256(original).hexdigest() == 'ca42849f180f7d0c132532c0c6c54aba5320aae4b11dac3e3cdbae80a5ad6e46'
    summary = json.loads((ROOT / 'data/egm2008-summary.json').read_text())
    assert hashlib.sha256((ROOT / 'data/egm2008.json').read_bytes()).hexdigest() == summary['outputSha256']
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    url = os.environ.get('TEST_SITE_URL') or f'http://127.0.0.1:{server.server_port}/'
    errors, report = [], {'site': url}
    try:
        with sync_playwright() as pw:
            chrome = shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('chromium-browser')
            browser = pw.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
            page = browser.new_page(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(url + '?test=models#map', wait_until='domcontentloaded')
            page.wait_for_function("window.GeoidAtlas && GeoidAtlas.version==='0.8.0' && GeoidAtlas.getModelState().status==='ready'", timeout=45000)
            assert page.locator('#modelControls').is_visible()
            assert page.evaluate('GeoidAtlas.getModelState().percent') == 100
            camera = page.evaluate('GeoidAtlas.getState()')
            kn = page.evaluate('GeoidAtlas.getDataSummary()')
            points_before = page.evaluate('GeoidAtlas.getPoints().map(p=>[p.id,p.lat,p.lon,p.h,p.H,p.kn,p.delta])')
            previous, counts = None, {}
            for percent in [100, 50, 25, 10, 5]:
                page.click(f'[data-density="{percent}"]')
                ids = page.evaluate('GeoidAtlas.getDisplayedPointIds()')
                assert len(ids) == int(4787*percent/100+.5)
                assert len(set(ids)) == len(ids)
                if previous is not None:
                    assert set(ids) <= previous
                previous = set(ids)
                counts[percent] = len(ids)
                for key in ['zoom', 'panX', 'panY']:
                    assert page.evaluate(f'GeoidAtlas.getState().{key}') == camera[key]
                assert page.evaluate('GeoidAtlas.getDataSummary()') == kn
            same_ids = page.evaluate('GeoidAtlas.getDisplayedPointIds()')
            page.click('[data-model="egm"]')
            assert page.evaluate('GeoidAtlas.getDisplayedPointIds()') == same_ids
            stats = page.evaluate('GeoidAtlas.getDataSummary()')
            assert stats['valid'] == 4778
            for key in ['mean', 'rmse', 'mae', 'min', 'max']:
                assert abs(stats[key]-summary['meta']['statistics'][key]) < 1e-8, key
            error = page.evaluate('Math.max(...GeoidAtlas.getPoints().map(p=>Math.abs(GeoidAtlas.sampleEGM(p.lat,p.lon)-p.egm)))')
            assert error < 1e-9
            assert page.evaluate('GeoidAtlas.sampleEGM(0,0)') is None
            assert page.evaluate('GeoidAtlas.getPoints().map(p=>[p.id,p.lat,p.lon,p.h,p.H,p.kn,p.delta])') == points_before
            assert page.evaluate('GeoidAtlas.getPoints().filter(p=>p.N===null && p.deltaEgm===null && Number.isFinite(p.egm)).length') == 9
            page.click('[data-map-popover="search"]')
            page.fill('#pointSearch', 'U거창61')
            page.click('[data-point-index="0"]')
            popup = page.locator('#pointPopup').inner_text()
            assert 'EGM2008' in popup and '27.2280' in popup and '+0.1793' in popup
            assert page.evaluate('GeoidAtlas.getVisiblePointCount()') == 239
            page.click('[data-model="kn"]')
            assert '27.4376' in page.locator('#pointPopup').inner_text()
            assert '-0.0303' in page.locator('#pointPopup').inner_text()
            page.click('[data-model="egm"]')
            page.screenshot(path=str(OUTPUT / 'desktop-egm-popup.png'))
            page.click('[data-point-close]')
            page.click('[data-map-popover="settings"]')
            page.click('[data-layer="kn"]')
            page.click('#gridToggle')
            assert page.evaluate('GeoidAtlas.getDataState().heatmap') is True
            assert 'EGM2008' in page.locator('#dataLegend').inner_text()
            assert 'EGM2008' in page.locator('#gridToggle').evaluate('(e)=>e.previousElementSibling.textContent')
            page.wait_for_timeout(100)
            page.click('[data-dialog="data"]')
            assert '0.2676' in page.locator('#dialogBackdrop').inner_text()
            with page.expect_download() as download:
                page.click('[data-data-action="export"]')
            rows = list(csv.reader(Path(download.value.path()).read_text(encoding='utf-8-sig').splitlines()))
            assert len(rows) == 4788
            assert 'EGM2008_N_m' in rows[0]
            assert abs(float(rows[1][10])-27.22801730116105) < 1e-10
            page.click('[data-action="close-dialog"]')
            page.evaluate("route('home')")
            assert page.locator('#modelControls').is_hidden()
            footer = page.locator('.home-footer > span:first-child').inner_text()
            assert 'EGM2008' not in footer and '지오이드 탐구' in footer
            page.evaluate("route('solar')")
            assert page.locator('#modelControls').is_hidden()
            page.evaluate("selectPlanet('earth')")
            assert page.evaluate('GeoidAtlas.getState().mode') == 'geoid'
            page.evaluate("selectPlanet('earth')")
            assert page.evaluate('GeoidAtlas.getState().mode') == 'map'
            mobile = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
            mobile.on('pageerror', lambda error: errors.append(str(error)))
            mobile.goto(url + '?test=mobile#map', wait_until='domcontentloaded')
            mobile.wait_for_function("window.GeoidAtlas && GeoidAtlas.version==='0.8.0' && GeoidAtlas.getModelState().status==='ready'", timeout=45000)
            mobile.click('[data-model="egm"]')
            mobile.click('[data-density="10"]')
            mobile.click('[data-map-popover="search"]')
            mobile.fill('#pointSearch', 'U거창61')
            mobile.click('[data-point-index="0"]')
            assert '27.2280' in mobile.locator('#pointPopup').inner_text()
            assert mobile.evaluate('GeoidAtlas.getVisiblePointCount()') == 479
            assert not mobile.evaluate('document.documentElement.scrollWidth > innerWidth')
            card, toolbar = mobile.locator('#modelControls').bounding_box(), mobile.locator('#mapToolbar').bounding_box()
            assert card['x']+card['width'] < toolbar['x']
            mobile.screenshot(path=str(OUTPUT / 'mobile-egm-popup.png'))
            assert not errors, errors
            report.update(status='passed', counts=counts, egmStatistics=stats, maxInterpolationDifference=error,
                          missingHeights=9, csvRows=len(rows)-1, originalDataUnchanged=True,
                          modelTabs=True, fixedMapExtent=True, nestedSampling=True, mobileOverflow=False,
                          pageErrors=errors, mapState=mobile.evaluate('GeoidAtlas.getMapState()'))
            browser.close()
    finally:
        server.shutdown()
    (OUTPUT / 'browser-checks.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
