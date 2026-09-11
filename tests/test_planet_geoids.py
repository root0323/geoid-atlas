"""Exercise actual planetary grids in the browser, then the existing Earth UI."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import hashlib
import json
import math
import os
import random
import shutil
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results/planets'
OUT.mkdir(parents=True,exist_ok=True)

def bilinear(d,lat,lon):
 g=d['grid']; rows,cols=g['rows'],g['cols']
 y=max(0,min(rows-1,(g['lat0']-lat)/g['stepLat']));y0=int(y);y1=min(rows-1,y0+1);fy=y-y0
 x=((lon-g['lon0'])%360)/g['stepLon'];x0=int(x)%cols;x1=(x0+1)%cols;fx=x-int(x)
 at=lambda r,c:d['values'][r*cols+c]
 return ((1-fx)*at(y0,x0)+fx*at(y0,x1))*(1-fy)+((1-fx)*at(y1,x0)+fx*at(y1,x1))*fy

def activate_for_test():
 # This changes only this Actions checkout, not the repository or live Pages.
 path=ROOT/'index.html';s=path.read_text()
 if 'planet-geoid.js' not in s:
  marker='<link rel="stylesheet" href="./model-controls.css?v=1">'
  assert marker in s
  s=s.replace(marker,marker+'<link rel="stylesheet" href="./planet-geoid.css?v=1">')
  marker='<script src="./model-controls.js?v=1"><\\/script>'
  assert marker in s
  s=s.replace(marker,marker+'<script src="./planet-geoid.js?v=1"><\\/script>')
  path.write_text(s)

def main():
 activate_for_test()
 manifest=json.loads((ROOT/'data/planet-geoids/manifest.json').read_text())
 inputs={}
 for body,item in manifest['bodies'].items():
  f=ROOT/f'data/planet-geoids/{body}.json';assert hashlib.sha256(f.read_bytes()).hexdigest()==item['outputSha256']
  d=json.loads(f.read_text());assert d['meta']['isTopography'] is False and d['meta']['unit']=='m'
  assert len(d['values'])==d['grid']['rows']*d['grid']['cols'] and all(math.isfinite(n) for n in d['values'])
  inputs[body]=d
 assert inputs['mars']['meta']['usedDegreeMin']==3
 assert inputs['mercury']['meta']['equipotentialResidualMaxM']<.02
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(ROOT)))
 Thread(target=server.serve_forever,daemon=True).start()
 url=os.getenv('TEST_SITE_URL') or f'http://127.0.0.1:{server.server_port}/'
 errors=[];report={'bodies':{},'site':url};rng=random.Random(42)
 try:
  with sync_playwright() as p:
   chrome=shutil.which('google-chrome') or shutil.which('chromium')
   browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1440,'height':900})
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(url+'?test=planet#geoid/mars',wait_until='domcontentloaded')
   page.wait_for_function("window.GeoidAtlas?.getPlanetGeoidState?.().status==='ready'",timeout=45000)
   for body in ['mars','mercury','venus','moon']:
    page.evaluate('(b)=>route("geoid",b)',body)
    page.wait_for_function("window.GeoidAtlas.getPlanetGeoidState().status==='ready'",timeout=45000)
    page.evaluate('state.rotate=false');page.wait_for_timeout(1300)
    state=page.evaluate('GeoidAtlas.getPlanetGeoidState()');assert state['body']==body and state['exaggeration']>1
    title=page.locator('#sceneTitle').inner_text();assert '개념' not in page.locator('#sceneSubtitle').inner_text()
    d=inputs[body];max_error=0
    for c in d['checks']:
     n=page.evaluate('(a)=>GeoidAtlas.samplePlanetGeoid(...a)',[body,c['lat'],c['lon']]);assert abs(n-c['valueM'])<.001
    for _ in range(25):
     lat,lon=rng.uniform(-89,89),rng.uniform(-720,720)
     n=page.evaluate('(a)=>GeoidAtlas.samplePlanetGeoid(...a)',[body,lat,lon]);max_error=max(max_error,abs(n-bilinear(d,lat,lon)))
    assert max_error<1e-7
    page.screenshot(path=str(OUT/f'{body}-desktop.png'))
    page.click('[data-planet-action="actual"]');assert page.evaluate('GeoidAtlas.getPlanetGeoidState().exaggeration')==1
    if body=='mars':page.screenshot(path=str(OUT/'mars-actual-scale.png'))
    page.click('[data-planet-action="suggested"]');assert page.evaluate('GeoidAtlas.getPlanetGeoidState().exaggeration')==state['exaggeration']
    page.click('[data-planet-action="sources"]')
    assert '원자료' in page.locator('#dialog').inner_text()
    links=page.locator('#dialog a').evaluate_all('(a)=>a.map(x=>x.href)')
    assert d['meta']['source'] in links and d['meta']['label'] in links
    if body=='mercury':page.screenshot(path=str(OUT/'mercury-source.png'))
    page.click('[data-action="close-dialog"]')
    report['bodies'][body]={'rangeM':d['meta']['rangeM'],'exaggeration':state['exaggeration'],'gridChecks':True,'maxSampleErrorM':max_error}
   page.evaluate('route("solar","mars")');page.click('[data-action="form"]');assert page.evaluate('GeoidAtlas.getPlanetGeoidState().active')
   page.evaluate('route("geoid","asteroid")');assert not page.evaluate('GeoidAtlas.getPlanetGeoidState().active')
   assert '가상' in page.locator('#rightPanel').inner_text()
   page.evaluate('route("solar");selectPlanet("earth")');assert page.evaluate('GeoidAtlas.getState().mode')=='geoid'
   page.evaluate('selectPlanet("earth")');assert page.evaluate('GeoidAtlas.getState().mode')=='map'
   page.wait_for_function("GeoidAtlas.getModelState().status==='ready'",timeout=45000)
   page.click('[data-model="egm"]');page.click('[data-density="10"]');assert page.evaluate('GeoidAtlas.getVisiblePointCount()')==479
   assert abs(page.evaluate('GeoidAtlas.getDataSummary().rmse')-.26755207604096415)<1e-8
   assert not page.locator('.planet-geoid-panel').count()
   for width,height in [(390,844),(360,740)]:
    mobile=browser.new_page(viewport={'width':width,'height':height},is_mobile=True,has_touch=True)
    mobile.on('pageerror',lambda e:errors.append(str(e)))
    mobile.goto(url+'?test=planet-mobile#geoid/mars',wait_until='domcontentloaded')
    mobile.wait_for_function("window.GeoidAtlas?.getPlanetGeoidState?.().status==='ready'",timeout=45000)
    mobile.evaluate('state.rotate=false');mobile.wait_for_timeout(1300)
    assert not mobile.evaluate('document.documentElement.scrollWidth>innerWidth')
    mobile.click('[data-planet-action="actual"]');assert mobile.evaluate('GeoidAtlas.getPlanetGeoidState().exaggeration')==1
    mobile.click('[data-planet-action="suggested"]');mobile.screenshot(path=str(OUT/f'mars-mobile-{width}.png'))
    mobile.click('[data-planet-action="sources"]');assert mobile.locator('#dialog').is_visible()
    mobile.click('[data-action="close-dialog"]');mobile.close()
   failed=browser.new_page(viewport={'width':1000,'height':800})
   failed.route('**/data/planet-geoids/mercury.json*',lambda route:route.fulfill(status=503,body='Unavailable'))
   failed.goto(url+'?test=planet-error#geoid/mercury',wait_until='domcontentloaded')
   failed.wait_for_function("window.GeoidAtlas?.getPlanetGeoidState?.().status==='error'",timeout=45000)
   assert failed.evaluate('GeoidAtlas.getPlanetGeoidState().meta') is None
   assert '가상 굴곡으로 대체하지 않습니다' in failed.locator('#rightPanel').inner_text()
   assert not errors,errors
   report.update(status='passed',pageErrors=errors,mobileOverflow=False,sourceLinks=True,earthTabsPreserved=True,noSyntheticFallback=True)
   browser.close()
 finally:server.shutdown()
 (OUT/'checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
 # Reuse the original extensive Earth regression suite, allowing the new version.
 test=ROOT/'tests/test_models.py'
 source=test.read_text().replace("GeoidAtlas.version==='0.8.0'", "typeof GeoidAtlas.getModelState==='function'")
 namespace={'__file__':str(test),'__name__':'earth_regression'}
 exec(compile(source,str(test),'exec'),namespace);namespace['main']()

if __name__=='__main__':main()
