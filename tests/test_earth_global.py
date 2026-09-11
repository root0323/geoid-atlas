"""Whole-Earth EGM2008 + map regression. Candidate loader before activation,
actual loader afterwards. Original measurements/model files must not change.
"""
from __future__ import annotations
import functools, hashlib, json, math, os, shutil, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results/global-earth'
OUT.mkdir(parents=True,exist_ok=True)


def main():
    report={'status':'running'}
    original_index=(ROOT/'index.html').read_text()
    candidate='earth-kn.js' in original_index
    html=original_index.replace('./earth-kn.js?v=1','./earth-global.js?v=1')
    if 'earth-global.css' not in html:
        html=html.replace('<link rel="stylesheet" href="./planet-geoid.css?v=2">','<link rel="stylesheet" href="./planet-geoid.css?v=2"><link rel="stylesheet" href="./earth-global.css?v=1">')
    assert 'earth-global.js' in html and 'earth-kn.js' not in html
    assert hashlib.sha256((ROOT/'app-v6.html').read_bytes()).hexdigest()=='ca42849f180f7d0c132532c0c6c54aba5320aae4b11dac3e3cdbae80a5ad6e46'
    meta=json.loads((ROOT/'data/earth-global/summary.json').read_text())
    dataset=json.loads((ROOT/'data/earth-global/egm2008-global.json').read_text())
    assert hashlib.sha256((ROOT/'data/earth-global/egm2008-global.json').read_bytes()).hexdigest()==meta['outputSha256']
    for file,expected in meta['protectedFilesUnchanged'].items():
        assert hashlib.sha256((ROOT/file).read_bytes()).hexdigest()==expected
    assert meta['sourceRegionalMaxDifferenceM']<1e-8
    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            if urlsplit(self.path).path in ('/','/index.html'):
                content=html.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
            else: super().do_GET()
        def log_message(self,*args): pass
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    site=os.getenv('TEST_SITE_URL') or f'http://127.0.0.1:{server.server_port}/'
    report.update(site=site,candidateLoader=candidate and not bool(os.getenv('TEST_SITE_URL')))
    errors=[]
    try:
        with sync_playwright() as pw:
            executable=shutil.which('google-chrome') or shutil.which('chromium')
            browser=pw.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
            for width,height in [(1440,900),(390,844),(360,740)]:
                page=browser.new_page(viewport={'width':width,'height':height},is_mobile=width<600,has_touch=width<600)
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(site+'?test=global-earth#geoid/earth',wait_until='domcontentloaded')
                page.wait_for_function('window.GeoidAtlas?.getEarthGeoidState?.().status==="ready"',timeout=45000)
                page.evaluate('state.rotate=false;state.formation=1;resetCamera()')
                page.wait_for_timeout(200)
                s=page.evaluate('GeoidAtlas.getEarthGeoidState()')
                assert s['coverage']=='global' and s['model']=='EGM2008' and s['grid']['rows']==181
                assert page.locator('[data-earth-model]').count()==0
                assert page.locator('#modelControls').is_hidden()
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
                points=page.evaluate('GeoidAtlas.getPoints().map(p=>[p.id,p.lat,p.lon,p.h,p.H,p.N,p.kn,p.delta])')
                for check in dataset['checks']:
                    n=page.evaluate('p=>GeoidAtlas.sampleEarthGeoid(p.lat,p.lon)',check)
                    assert abs(n-check['nativeValueM'])<=.000051
                for lat in [-90,-87.3,-44.1,0,36,88.2,90]:
                    v=page.evaluate('lat=>[-180,180,540,-540].map(lon=>GeoidAtlas.sampleEarthGeoid(lat,lon))',lat)
                    assert max(v)-min(v)<1e-10
                assert page.evaluate('GeoidAtlas.sampleEarthGeoid(91,0)') is None
                assert page.evaluate('GeoidAtlas.sampleEarthGeoid(NaN,0)') is None
                mesh=page.evaluate('GeoidAtlas.getEarthGeoidMeshSamples()')
                assert all(math.isfinite(v['n']) for v in mesh)
                assert min(v['lat'] for v in mesh)==-90 and max(v['lat'] for v in mesh)==90
                assert min(v['lon'] for v in mesh)==-180 and max(v['lon'] for v in mesh)==180
                assert min(v['n'] for v in mesh)<-95 and max(v['n'] for v in mesh)>70
                page.screenshot(path=str(OUT/f'earth-global-{width}.png'))
                page.click('[data-earth-global="actual"]')
                assert page.evaluate('GeoidAtlas.getEarthGeoidState().exaggeration')==1
                page.wait_for_timeout(120)
                if width==1440:page.screenshot(path=str(OUT/'earth-global-1x.png'))
                page.click('[data-earth-global="suggested"]')
                assert page.evaluate('GeoidAtlas.getEarthGeoidState().exaggeration')==10000
                page.click('[data-earth-global="sources"]')
                text=page.locator('#dialog').inner_text()
                assert 'EGM2008' in text and '65,160' in text and '1°' in text and '2.5분' in text
                assert page.locator('#dialog a[href="https://cdn.proj.org/us_nga_README.txt"]').count()==1
                page.click('[data-action="close-dialog"]')
                for kind in ['concept','help','data']:
                    page.evaluate('kind=>openDialog(kind)',kind)
                    assert '전 지구 구체는 개념' not in page.locator('#dialog').inner_text()
                    assert '전 지구 지오이드의 굴곡은 개념' not in page.locator('#dialog').inner_text()
                    page.click('[data-action="close-dialog"]')
                page.click('#rightPanel [data-action="map"]')
                page.wait_for_function('GeoidAtlas.getModelState().status==="ready"',timeout=45000)
                assert page.locator('#modelControls').is_visible() and page.locator('#rightPanel').is_hidden()
                page.click('[data-model="egm"]');page.click('[data-density="10"]')
                assert page.evaluate('GeoidAtlas.getVisiblePointCount()')==479
                assert abs(page.evaluate('GeoidAtlas.getDataSummary().rmse')-.26755207604096415)<1e-8
                page.click('[data-map-popover="search"]');page.fill('#pointSearch','U거창61');page.click('[data-point-index="0"]')
                assert '27.2280' in page.locator('#pointPopup').inner_text()
                page.click('[data-model="kn"]');assert '27.4376' in page.locator('#pointPopup').inner_text()
                assert page.evaluate('GeoidAtlas.getPoints().map(p=>[p.id,p.lat,p.lon,p.h,p.H,p.N,p.kn,p.delta])')==points
                if width==1440:page.screenshot(path=str(OUT/'map-kn-preserved.png'))
                page.evaluate('route("geoid","earth")')
                assert page.evaluate('GeoidAtlas.getEarthGeoidState().model')=='EGM2008'
                assert page.locator('#modelControls').is_hidden()
                page.evaluate('route("map","earth")')
                assert page.evaluate('GeoidAtlas.getModelState().percent')==10
                if width==1440:
                    for body in ['mars','mercury','venus','moon']:
                        page.evaluate('b=>route("geoid",b)',body)
                        page.wait_for_function('GeoidAtlas.getPlanetGeoidState().status==="ready"',timeout=45000)
                        assert page.evaluate('GeoidAtlas.getEarthGeoidState().active') is False
                    page.evaluate('route("solar","asteroid");formGeoid()')
                    assert '가상' in page.locator('#rightPanel').inner_text()
                    page.evaluate('route("solar");selectPlanet("earth")')
                    assert page.evaluate('GeoidAtlas.getState().mode')=='geoid'
                    page.evaluate('selectPlanet("earth")')
                    assert page.evaluate('GeoidAtlas.getState().mode')=='map'
                page.close()
            bad=browser.new_page(viewport={'width':390,'height':844})
            bad.route('**/data/earth-global/egm2008-global.json*',lambda r:r.fulfill(status=503,body='unavailable'))
            bad.goto(site+'?test=failure#geoid/earth',wait_until='domcontentloaded')
            bad.wait_for_function('GeoidAtlas.getEarthGeoidState().status==="error"',timeout=45000)
            assert '가상값으로 대체하지 않습니다' in bad.locator('#rightPanel').inner_text()
            assert bad.evaluate('GeoidAtlas.sampleEarthGeoid(0,0)') is None
            bad.unroute('**/data/earth-global/egm2008-global.json*')
            bad.click('[data-earth-global="retry"]')
            bad.wait_for_function('GeoidAtlas.getEarthGeoidState().status==="ready"',timeout=45000)
            browser.close()
        assert not errors,errors
        report.update(status='passed',model='EGM2008',coverage='global',grid=dataset['grid'],rangeM=dataset['meta']['rangeM'],sourceHash=dataset['meta']['sourceSha256'],desktopAndMobile=True,sourceChecks=True,seamAndPoles=True,scale1x=True,noSyntheticFallback=True,mapModelTabsPreserved=True,mapPointDensityPreserved=True,originalDataUnchanged=True,otherPlanetsPreserved=True,pageErrors=errors)
    finally:
        server.shutdown()
        (OUT/'checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
