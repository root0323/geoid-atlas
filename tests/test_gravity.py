"""Gravity workspace: independent numbers, missingness, UI, real terrain, regressions."""
from __future__ import annotations
import csv, functools, hashlib, io, json, math, os, shutil, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results/gravity'
OUT.mkdir(parents=True,exist_ok=True)

def main():
    hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/'app-v6.html',*sorted((ROOT/'data').rglob('*'))] if p.is_file()}
    assert hashes['app-v6.html']=='ca42849f180f7d0c132532c0c6c54aba5320aae4b11dac3e3cdbae80a5ad6e46'
    data,_=json.JSONDecoder().raw_decode((ROOT/'app-v6.html').read_text().split('const GEOID_DATA=',1)[1])
    rows=data['observation']['rows']
    valid=[(i,r) for i,r in enumerate(rows) if isinstance(r[13],(int,float)) and isinstance(r[11],(int,float))]
    assert len(valid)==997
    def expected(r):
        s=math.sin(math.radians(r[6]))**2
        normal=978032.533590406*(1+.00193185265241*s)/math.sqrt(1-.0066943799901413165*s)
        fa=r[13]-normal+.3086*r[11]
        sb=fa-2*math.pi*6.67430e-11*1e8*2.67*r[11]
        return normal,fa,sb
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    site=os.getenv('TEST_SITE_URL') or f'http://127.0.0.1:{server.server_port}/'
    errors=[];report={'status':'running','site':site}
    try:
        with sync_playwright() as pw:
            executable=shutil.which('google-chrome') or shutil.which('chromium')
            browser=pw.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
            for width,height in [(1440,900),(390,844),(360,740)]:
                page=browser.new_page(viewport={'width':width,'height':height},is_mobile=width<600,has_touch=width<600)
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(site+'?test=gravity#map',wait_until='domcontentloaded')
                page.wait_for_function("window.GeoidAtlas?.gravityVersion==='1.0.0'",timeout=45000)
                page.wait_for_function("GeoidAtlas.getModelState().status==='ready'",timeout=45000)
                oldpoints=page.evaluate('GeoidAtlas.getPoints().map(p=>[p.id,p.lat,p.lon,p.gravity,p.h,p.H,p.N,p.kn,p.delta,p.egm])')
                page.evaluate('GeoidAtlas.setPointPercent(100)')
                assert page.locator('#workspace-gravity').is_visible()
                assert '동아시아' not in page.locator('#stageNav').inner_text()
                original_camera=page.evaluate('GeoidAtlas.getMapState()')
                page.click('#workspace-gravity')
                assert page.evaluate('GeoidAtlas.getGravityState().active') is True
                assert page.locator('#model-kn').is_hidden()
                camera=page.evaluate('GeoidAtlas.getMapState()')
                assert abs(camera['zoom']-original_camera['zoom'])<1e-10 and camera['center']==original_camera['center']
                assert page.evaluate('GeoidAtlas.getGravityState().displayed')==997
                rs=page.evaluate('GeoidAtlas.getPoints().map((p,i)=>GeoidAtlas.getGravityResult(i))')
                for i,r in valid:
                    gamma,fa,sb=expected(r)
                    assert abs(rs[i]['gamma']-gamma)<1e-7
                    assert abs(rs[i]['freeAir']-fa)<1e-7
                    assert abs(rs[i]['bouguer']-sb)<1e-7
                    assert rs[i]['complete'] is None
                assert rs[0]['freeAir'] is None and rs[2278]['warnings']
                assert abs(page.evaluate('GeoidGravityMath.normal(0)')-978032.533590406)<1e-8
                assert page.evaluate('GeoidGravityMath.normal(91)') is None
                assert page.evaluate('GeoidGravityMath.terrainSector(0,100,0,Math.PI,2.67)')==0
                a=page.evaluate('GeoidGravityMath.terrainSector(20,100,30,Math.PI,2.67)')
                b=page.evaluate('GeoidGravityMath.terrainSector(20,100,-30,Math.PI,2.67)')
                assert abs(a-b)<1e-12 and a>0
                page.click('[data-density="10"]')
                assert page.evaluate('GeoidAtlas.getGravityState().displayed')==100
                assert page.evaluate('GeoidAtlas.getGravityState().summary.eligible')==997
                assert abs(page.evaluate('GeoidAtlas.getMapState().zoom')-camera['zoom'])<1e-10
                page.click('[data-map-popover="search"]');page.fill('#pointSearch','U거창70');page.click('[data-point-index="2"]')
                text=page.locator('#pointPopup').inner_text()
                assert '32.728' in text and '1.546' in text and '지형 보정 필요' in text
                if width!=360:page.screenshot(path=str(OUT/f'gravity-popup-{width}.png'))
                page.click('[data-gravity-detail="input"] > summary')
                page.fill('[data-gravity-form="2"] input[name="terrain"]','2.5')
                page.fill('[data-gravity-form="2"] input[name="curvature"]','-0.1')
                page.fill('[data-gravity-form="2"] input[name="source"]','Browser test input — not a measurement')
                page.click('[data-gravity-form="2"] button[type="submit"]')
                r=page.evaluate('GeoidAtlas.getGravityResult(2)')
                assert abs(r['complete']-3.9463962931711634)<1e-7
                page.evaluate('GeoidAtlas.setGravityCorrection(2,0,0)')
                assert abs(page.evaluate('GeoidAtlas.getGravityResult(2).complete')-1.5463962931711634)<1e-7
                page.evaluate('GeoidAtlas.setGravityDensity(2.5)')
                assert page.evaluate('GeoidAtlas.getGravityResult(2).complete') is None
                assert page.evaluate('GeoidAtlas.getGravityResult(2).densityMismatch') is True
                page.evaluate('GeoidAtlas.setGravityDensity(2.67)')
                page.click('[data-gravity-action="clear"]')
                assert page.evaluate('GeoidAtlas.getGravityResult(2).complete') is None
                page.click('[data-point-close]')
                page.click('[data-gravity-layer="complete"]')
                assert 'mGal' in page.locator('#dataLegend').inner_text()
                assert page.evaluate('GeoidAtlas.getGravityState().summary.complete.count')==0
                page.select_option('#gravityRegion','거창')
                assert page.evaluate('GeoidAtlas.getGravityState().summary.eligible')>0
                csv_text=page.evaluate('GeoidAtlas.getGravityCSV()')
                table=list(csv.reader(io.StringIO(csv_text.lstrip('\ufeff'))))
                assert len(table)-1==sum(r[3]=='거창' for r in rows)
                assert all(r[1]=='거창' for r in table[1:])
                assert all(r[14]=='' for r in table[1:])
                page.select_option('#gravityRegion','')
                page.click('[data-dialog="data"]')
                assert '20 km' in page.locator('#dialog').inner_text()
                assert 'mGal' in page.locator('#dialog').inner_text()
                page.click('[data-action="close-dialog"]')
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
                page.click('#workspace-geoid')
                assert page.locator('#model-kn').is_visible()
                page.click('[data-model="egm"]');page.click('[data-density="10"]')
                assert page.evaluate('GeoidAtlas.getVisiblePointCount()')==479
                assert abs(page.evaluate('GeoidAtlas.getDataSummary().rmse')-.26755207604096415)<1e-8
                assert oldpoints==page.evaluate('GeoidAtlas.getPoints().map(p=>[p.id,p.lat,p.lon,p.gravity,p.h,p.H,p.N,p.kn,p.delta,p.egm])')
                page.evaluate('route("geoid","earth")')
                page.wait_for_function('GeoidAtlas.getEarthGeoidState().status==="ready"',timeout=45000)
                assert page.evaluate('GeoidAtlas.getEarthGeoidState().model')=='EGM2008'
                assert '동아시아 지도' not in page.locator('#rightPanel').inner_text()
                page.evaluate('route("geoid","mars")')
                page.wait_for_function('GeoidAtlas.getPlanetGeoidState().status==="ready"',timeout=45000)
                page.click('[data-planet-action="sources"]')
                assert '3,396 km' in page.locator('#dialog').inner_text()
                page.close()
            p=browser.new_page(viewport={'width':1440,'height':900})
            p.on('pageerror',lambda e:errors.append(str(e)))
            p.goto(site+'?view=gravity#map',wait_until='domcontentloaded')
            p.wait_for_function("window.GeoidAtlas?.gravityVersion==='1.0.0'",timeout=45000)
            p.evaluate('selectDataPoint(2)')
            try:
                tc=p.evaluate('async()=>await GeoidGravityTerrain.estimate(GeoidAtlas.getPoints()[2])')
                assert tc['radiusKm']==20 and 0<=tc['value']<100
                report['realTerrain']={'status':'passed',**tc}
                p.evaluate('async()=>await GeoidAtlas.estimateGravityTerrain(2)')
                assert p.evaluate('GeoidAtlas.getGravityResult(2).complete') is not None
                assert '20 km 지형 근사' in p.locator('#pointPopup').inner_text()
                p.screenshot(path=str(OUT/'complete-bouguer-dem.png'))
            except Exception as error:
                report['realTerrain']={'status':'network-or-test-error','message':str(error)}
                raise
            p.close();browser.close()
        assert not errors,errors
        for name,digest in hashes.items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest
        report.update(status='passed',validPoints=997,gravityPresent=998,sourceOutlierFlagged='U아산00',allPointsMatchIndependentMath=True,missingTerrainNotZero=True,manualCorrectionAndDensity=True,regionAndDensity=True,mapModelsPreserved=True,earthAndPlanetsPreserved=True,originalDataUnchanged=True,pageErrors=errors)
    finally:
        server.shutdown();(OUT/'checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
