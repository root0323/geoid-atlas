"""Three-stage PDF-based gravity views, unchanged math/data and map regressions."""
from __future__ import annotations
import csv, functools, hashlib, io, json, math, os, shutil, threading, time, urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
LIVE=bool(os.getenv('TEST_SITE_URL'))
LOCAL_ONLY=bool(os.getenv('LOCAL_STAGE_ONLY'))
OUT=ROOT/('test-results/gravity/live' if LIVE else 'test-results/gravity')
OUT.mkdir(parents=True,exist_ok=True)
KEYS=['freeAir','bouguer','complete']

def main():
    protected=[ROOT/'app-v6.html',ROOT/'gravity-math.js',ROOT/'gravity-terrain.js',*sorted((ROOT/'data').rglob('*'))]
    hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in protected if p.is_file()}
    assert hashes['app-v6.html']=='ca42849f180f7d0c132532c0c6c54aba5320aae4b11dac3e3cdbae80a5ad6e46'
    data,_=json.JSONDecoder().raw_decode((ROOT/'app-v6.html').read_text().split('const GEOID_DATA=',1)[1])
    rows=data['observation']['rows']
    valid=[(i,r) for i,r in enumerate(rows) if isinstance(r[13],(int,float)) and isinstance(r[11],(int,float))]
    assert len(valid)==997
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    site=os.getenv('TEST_SITE_URL') or f'http://127.0.0.1:{server.server_port}/'
    if LIVE:
        for attempt in range(25):
            try:
                with urllib.request.urlopen(site+'?verify-stages='+str(time.time_ns()),timeout=15) as r:
                    if 'gravity-stages.js' in r.read().decode():break
            except Exception:pass
            time.sleep(5)
        else:raise RuntimeError('New staged loader not published')
    url=site+('stage-local.html' if LOCAL_ONLY else '')
    errors=[];report={'status':'running','site':site,'screens':[]}
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
            for width,height in [(1440,900),(390,844),(360,740)]:
                page=browser.new_page(viewport={'width':width,'height':height},is_mobile=width<600,has_touch=width<600)
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(url+'?view=gravity&test='+str(time.time_ns())+'#map',wait_until='domcontentloaded')
                page.wait_for_function("window.GeoidAtlas?.gravityStagesVersion==='1.0.0'",timeout=45000)
                page.wait_for_function("GeoidAtlas.getModelState().status==='ready'",timeout=45000)
                page.evaluate('GeoidAtlas.setPointPercent(100)')
                assert page.evaluate('GeoidAtlas.getGravityState().stage')==1
                assert page.evaluate('GeoidAtlas.getGravityState().displayed')==997
                assert page.locator('#gravityControls [role=tab]').count()==3
                assert '1단계' in page.locator('#gravityStageSummary').inner_text()
                original=page.evaluate('GeoidAtlas.getPoints().map(p=>[p.id,p.lat,p.lon,p.gravity,p.h,p.H,p.N,p.kn,p.delta,p.egm])')
                rs=page.evaluate('GeoidAtlas.getPoints().map((p,i)=>GeoidAtlas.getGravityResult(i))')
                for i,r in valid:
                    ss=math.sin(math.radians(r[6]))**2
                    gamma=978032.533590406*(1+.00193185265241*ss)/math.sqrt(1-.0066943799901413165*ss)
                    fa=r[13]-gamma+.3086*r[11]
                    sb=fa-2*math.pi*6.67430e-11*1e8*2.67*r[11]
                    assert abs(rs[i]['gamma']-gamma)<1e-7
                    assert abs(rs[i]['freeAir']-fa)<1e-7 and abs(rs[i]['bouguer']-sb)<1e-7
                    assert rs[i]['complete'] is None
                assert rs[0]['freeAir'] is None and rs[2278]['warnings']
                page.click('[data-density="10"]')
                assert page.evaluate('GeoidAtlas.getGravityState().displayed')==100
                page.click('[data-map-popover="search"]');page.fill('#pointSearch','U거창70');page.click('[data-point-index="2"]')
                camera=page.evaluate('GeoidAtlas.getMapState()')
                baseline=page.evaluate('GeoidAtlas.getGravityResult(2)')
                for number,key in enumerate(KEYS,1):
                    assert page.evaluate('GeoidAtlas.getGravityState().stage')==number
                    rendered=page.locator('#pointPopup [data-gravity-result]').evaluate_all('(els)=>els.map(e=>e.dataset.gravityResult)')
                    assert rendered==KEYS[:number]
                    assert page.locator('#pointPopup .gravity-current').get_attribute('data-gravity-result')==key
                    assert page.locator('#pointPopup .gs-terrain-controls').count()==(1 if number==3 else 0)
                    now=page.evaluate('GeoidAtlas.getMapState()')
                    assert now['center']==camera['center'] and now['zoom']==camera['zoom']
                    assert page.evaluate('GeoidAtlas.getDataState().selected')==2
                    assert page.evaluate('GeoidAtlas.getGravityResult(2)')==baseline
                    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
                    assert page.locator('#pointPopup').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
                    if LIVE:page.wait_for_timeout(1200)
                    if width!=360:page.screenshot(path=str(OUT/f'stage-{number}-{width}.png'))
                    if number<3:page.click('#pointPopup [data-gs-nav="next"]')
                assert '미계산' in page.locator('[data-gravity-result="complete"]').inner_text()
                page.click('[data-gravity-detail="input"] > summary')
                page.fill('[data-gravity-form="2"] input[name="terrain"]','2.5')
                page.locator('[data-gravity-form="2"] .gs-curvature > summary').click()
                page.fill('[data-gravity-form="2"] input[name="curvature"]','-0.1')
                page.fill('[data-gravity-form="2"] input[name="source"]','Browser validation only — not an observed TC')
                page.click('[data-gravity-form="2"] button[type="submit"]')
                r=page.evaluate('GeoidAtlas.getGravityResult(2)')
                assert abs(r['complete']-3.9463962931711634)<1e-7
                assert '첨부 자료의 3단계 식에는 없습니다' in page.locator('.gs-extra-notice').inner_text()
                page.evaluate('GeoidAtlas.setGravityCorrection(2,0)')
                assert abs(page.evaluate('GeoidAtlas.getGravityResult(2).complete')-baseline['bouguer'])<1e-9
                page.click('#pointPopup [data-gs-nav="previous"]')
                assert page.locator('[data-gravity-result="complete"]').count()==0
                page.click('#pointPopup [data-gs-nav="next"]')
                assert page.evaluate('GeoidAtlas.getGravityResult(2).terrain')==0
                page.evaluate('GeoidAtlas.setGravityDensity(2.5)')
                assert page.evaluate('GeoidAtlas.getGravityResult(2).complete') is None
                assert page.evaluate('GeoidAtlas.getGravityResult(2).densityMismatch')
                page.evaluate('GeoidAtlas.setGravityDensity(2.67)')
                if not page.locator('[data-gravity-detail="input"]').evaluate('(e)=>e.open'):
                    page.click('[data-gravity-detail="input"] > summary')
                page.click('[data-gravity-action="clear"]')
                page.click('[data-point-close]')
                tab=page.locator('#gravityControls [data-gravity-layer="freeAir"]')
                tab.click();tab.focus();page.keyboard.press('ArrowRight')
                assert page.evaluate('GeoidAtlas.getGravityState().stage')==2
                assert page.locator('#gravityControls [data-gravity-layer="bouguer"]').evaluate('(e)=>document.activeElement===e')
                page.select_option('#gravityRegion','거창')
                table=list(csv.reader(io.StringIO(page.evaluate('GeoidAtlas.getGravityCSV()').lstrip('\ufeff'))))
                assert len(table)-1==sum(r[3]=='거창' for r in rows)
                assert all(r[14]=='' for r in table[1:])
                for stage in [1,2,3]:
                    page.evaluate('s=>GeoidAtlas.setGravityStage(s)',stage)
                    assert len(list(csv.reader(io.StringIO(page.evaluate('GeoidAtlas.getGravityCSV()').lstrip('\ufeff')))))==len(table)
                page.click('#gravityStageSummary [data-gravity-action="info"]')
                assert page.locator('.gs-help-step').count()==3
                text=page.locator('#dialog').inner_text()
                for term in ['중력이상.pdf','6–18쪽','Δgfa = g − gt + FAC','ΔgB = Δgfa − BC','ΔgBC = ΔgB + TC','두 이상값을 더하라는 뜻이 아니라']:assert term in text
                page.locator('.gs-method > summary').nth(0).click()
                text=page.locator('#dialog').inner_text()
                for term in ['0.308 × h','0.3086 × H','0.0419','WGS84','추가 설정']:assert term in text
                page.locator('.gs-method > summary').nth(1).click()
                assert '20 km' in page.locator('#dialog').inner_text()
                assert page.locator('#dialog').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
                if width!=360:page.screenshot(path=str(OUT/f'stage-guide-{width}.png'))
                page.keyboard.press('Escape');assert page.locator('#dialogBackdrop').is_hidden()
                page.click('#workspace-geoid')
                page.click('[data-model="egm"]');page.click('[data-density="10"]')
                assert page.evaluate('GeoidAtlas.getVisiblePointCount()')==479
                assert abs(page.evaluate('GeoidAtlas.getDataSummary().rmse')-.26755207604096415)<1e-8
                assert original==page.evaluate('GeoidAtlas.getPoints().map(p=>[p.id,p.lat,p.lon,p.gravity,p.h,p.H,p.N,p.kn,p.delta,p.egm])')
                if not LOCAL_ONLY:
                    page.evaluate('route("geoid","earth")')
                    page.wait_for_function('GeoidAtlas.getEarthGeoidState().status==="ready"',timeout=45000)
                    assert page.evaluate('GeoidAtlas.getEarthGeoidState().model')=='EGM2008'
                    page.evaluate('route("geoid","mars")')
                    page.wait_for_function('GeoidAtlas.getPlanetGeoidState().status==="ready"',timeout=45000)
                    page.click('[data-planet-action="sources"]');assert '3,396 km' in page.locator('#dialog').inner_text()
                report['screens'].append({'width':width,'progressiveRows':[1,2,3],'cameraPreserved':True,'sourceFormulaDifferencesDisclosed':True})
                page.close()
            if not os.getenv('SKIP_REMOTE_TERRAIN'):
                page=browser.new_page(viewport={'width':1440,'height':900})
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(url+'?view=gravity#map',wait_until='domcontentloaded')
                page.wait_for_function("window.GeoidAtlas?.gravityStagesVersion==='1.0.0'",timeout=45000)
                page.evaluate('GeoidAtlas.setGravityStage(3);selectDataPoint(2)')
                page.click('[data-gravity-action="estimate"]')
                page.wait_for_function('GeoidAtlas.getGravityResult(2).complete!==null',timeout=45000)
                r=page.evaluate('GeoidAtlas.getGravityResult(2)')
                assert r['terrainMethod']=='20 km 지형 근사' and 0<=r['terrain']<100
                assert abs(r['complete']-r['bouguer']-r['terrain'])<1e-9
                page.wait_for_timeout(3000);page.screenshot(path=str(OUT/'stage-3-real-terrain.png'))
                report['realTerrain']={'status':'passed','values':r}
            browser.close()
        assert not errors,errors
        for name,digest in hashes.items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest
        report.update(status='passed',validPoints=997,allPointsMatchIndependentMath=True,missingTerrainNotZero=True,manualCorrectionAndDensity=True,mapModelsPreserved=True,originalDataUnchanged=True,pageErrors=errors)
    finally:
        server.shutdown();(OUT/'checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
