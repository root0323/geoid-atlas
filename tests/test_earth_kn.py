"""Test the actual checked-in Earth KN extension before and after activation.
No mock geoid values. Basemap requests are not required by these assertions.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import hashlib
import json
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results' / 'earth-kn'
OUT.mkdir(parents=True, exist_ok=True)


def main():
    assert hashlib.sha256((ROOT/'app-v6.html').read_bytes()).hexdigest() == 'ca42849f180f7d0c132532c0c6c54aba5320aae4b11dac3e3cdbae80a5ad6e46'
    summary = json.loads((ROOT/'data/egm2008-summary.json').read_text())
    assert hashlib.sha256((ROOT/'data/egm2008.json').read_bytes()).hexdigest() == summary['outputSha256']
    source = (ROOT/'earth-kn.js').read_text()
    assert 'EGM96_DATA' not in source and 'field(' not in source and 'drawGlobe(' not in source
    server = ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(ROOT)))
    Thread(target=server.serve_forever,daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'
    errors, report = [], {'status':'running','earthModel':'KNGeoid18','mapModels':['KNGeoid18','EGM2008']}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
            for w,h in [(1440,900),(390,844),(360,780)]:
                page = browser.new_page(viewport={'width':w,'height':h},is_mobile=w<600,has_touch=w<600)
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(url+'#geoid/earth',wait_until='domcontentloaded')
                page.wait_for_function("window.GeoidAtlas && GeoidAtlas.planetVersion==='0.9.0'")
                # Before activation, test the exact staged module once.
                if not page.evaluate('!!GeoidAtlas.earthVersion'):
                    page.add_script_tag(url=url+'earth-kn.js')
                page.wait_for_function("GeoidAtlas.earthVersion==='0.10.1' && GeoidAtlas.getEarthGeoidState().active")
                points = page.evaluate('GeoidAtlas.getPoints().map(p=>[p.id,p.lat,p.lon,p.h,p.H,p.N,p.kn,p.delta])')
                assert page.locator('#modelControls').is_hidden()
                assert page.locator('.earth-model-switch').count() == 0
                assert page.locator('[data-earth-model]').count() == 0
                assert page.locator('#rightPanel [role=tab]').count() == 0
                assert page.evaluate('GeoidAtlas.getEarthGeoidState().model') == 'KNGeoid18'
                assert page.evaluate('GeoidAtlas.getEarthGeoidState().global') is False
                assert page.evaluate('GeoidAtlas.sampleEarthGeoid(0,0)') is None
                assert page.evaluate('GeoidAtlas.sampleEarthGeoid(50,128)') is None
                assert page.evaluate('GeoidAtlas.sampleEarthGeoid(KN.lat0-0.0001,KN.lon0)') is None
                assert page.evaluate('GeoidAtlas.sampleEarthGeoid(NaN,128)') is None
                for expr in ['KN.lat0,KN.lon0','KN.latMax,KN.lonMax','35.58649477,127.76366518']:
                    assert page.evaluate(f'Math.abs(GeoidAtlas.sampleEarthGeoid({expr})-sampleKN({expr}))<1e-10')
                page.wait_for_timeout(1000)
                page.screenshot(path=str(OUT/f'earth-globe-{w}.png'))
                page.click('[data-earth-kn="focus"]')
                assert page.evaluate('GeoidAtlas.getEarthGeoidState().view') == 'region'
                assert page.evaluate('GeoidAtlas.getEarthKNMeshSamples().every(v=>v.n!==null && Math.abs(v.n-sampleKN(v.lat,v.lon))<1e-10)')
                page.wait_for_timeout(150)
                page.screenshot(path=str(OUT/f'earth-region-{w}.png'))
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
                if w<600:
                    page.click('[data-action="expand-detail"]')
                page.click('#rightPanel details summary')
                page.click('[data-earth-kn="actual"]')
                assert page.evaluate('GeoidAtlas.getEarthGeoidState().exaggeration') == 1
                assert page.evaluate('GeoidAtlas.getPoints().map(p=>[p.id,p.lat,p.lon,p.h,p.H,p.N,p.kn,p.delta])') == points
                page.click('[data-earth-kn="sources"]')
                assert 'KNGeoid18.dat' in page.locator('#dialog').inner_text()
                page.click('#dialog details summary')
                assert '9d88e22cb05387c6a07a342fd6b77c4221184d9f636a4b84687319d6dbd351b6' in page.locator('#dialog').inner_text()
                page.click('[data-action="close-dialog"]')
                page.evaluate("route('map','earth')")
                page.wait_for_function("GeoidAtlas.getModelState().status==='ready'",timeout=45000)
                assert page.locator('#modelControls').is_visible()
                assert page.locator('#rightPanel').is_hidden()
                page.click('[data-model="egm"]')
                page.click('[data-density="10"]')
                assert page.evaluate('GeoidAtlas.getVisiblePointCount()') == 479
                stats = page.evaluate('GeoidAtlas.getDataSummary()')
                assert stats['valid'] == 4778
                assert abs(stats['rmse']-summary['meta']['statistics']['rmse'])<1e-8
                page.click('[data-map-popover="search"]')
                page.fill('#pointSearch','U거창61')
                page.click('[data-point-index="0"]')
                popup=page.locator('#pointPopup').inner_text()
                assert 'EGM2008' in popup and '27.2280' in popup
                page.click('[data-model="kn"]')
                assert '27.4376' in page.locator('#pointPopup').inner_text()
                page.click('[data-model="egm"]')
                page.evaluate("route('geoid','earth')")
                assert page.evaluate('GeoidAtlas.getEarthGeoidState().model') == 'KNGeoid18'
                assert page.locator('#modelControls').is_hidden()
                page.evaluate("selectPlanet('earth')")
                assert page.evaluate('GeoidAtlas.getState().mode') == 'map'
                assert page.evaluate('GeoidAtlas.getModelState().model') == 'egm'
                assert page.evaluate('GeoidAtlas.getVisiblePointCount()') == 479
                if w==1440:
                    for body in ['mars','venus','mercury','moon']:
                        page.evaluate('(body)=>route("geoid",body)',body)
                        page.wait_for_function("GeoidAtlas.getPlanetGeoidState().status==='ready'",timeout=45000)
                        assert page.locator('#rightPanel').is_visible()
                        assert not page.evaluate('document.body.classList.contains("earth-kn-active")')
                        assert page.locator('[data-planet-action="sources"]').is_visible()
                        assert page.evaluate('GeoidAtlas.getEarthGeoidState().active') is False
                page.evaluate("route('home')")
                assert page.locator('#home').is_visible()
                assert page.locator('#modelControls').is_hidden()
                page.close()
            assert not errors, errors
            browser.close()
        report.update(status='passed',viewports=[1440,390,360],noEarthTabs=True,regionalMask=True,knMeshMatchesOriginal=True,originalDataUnchanged=True,mapTabsPreserved=True,pointDensityPreserved=True,egm2008Unchanged=True,otherPlanetsPreserved=True,pageErrors=errors)
    except Exception as error:
        report.update(status='failed',error=str(error),pageErrors=errors)
        raise
    finally:
        server.shutdown()
        (OUT/'checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()
