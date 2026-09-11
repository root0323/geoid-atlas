"""Build traceable planetary reference-surface grids from public NASA PDS.
Only data/planet-geoids is produced; the uploaded Earth data are never changed.
"""
from __future__ import annotations
import hashlib
import json
import math
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
import numpy as np

ROOT = 'https://pds-geosciences.wustl.edu/'
PRODUCTS = {
 'mars': ROOT+'mro/mro-m-rss-5-sdp-v1/mrors_1xxx/data/rsdmap/ggmro_120_geoid_90',
 'moon': ROOT+'grail/grail-l-lgrs-5-rdr-v1/grail_1001/rsdmap/gggrx_0900c_geoid_l600',
 'venus': ROOT+'mgn/mgn-v-rss-5-gravity-l2-v1/mg_5201/gravity/geoidgrd',
 'mercury': ROOT+'messenger/mess-h-rss_mla-5-sdp-v1/messrs_1001/data/shadr/jgmess_160a_sha',
}
HASHES = {
 'mars':'3539ffe090fc4d34324be964e5297eabdeaad4cf23bad642bd75aa91d99015b0',
 'moon':'0c47ae56c7b73232be405ba9168580dc0165b881680a0c4111fb3ae0a4098e62',
 'venus':'e363c5eb2eba49b15438cb4aa7fbaad7ac953d11368c80e08d37d0092d244e1e',
 'mercury':'14fa0129c4b5ef655e08a883a05a476a836a806349da607f84b3c2b2e3d899ca',
}
CACHE = Path('planet-build'); OUT = Path('data/planet-geoids')
CACHE.mkdir(exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
CATALOG = {
 'mars': dict(name='화성', surfaceName='아레오이드 편차', model='GMM-3 · 3–90차', agency='NASA GSFC · PDS Geosciences', mission='Mars Global Surveyor / Mars Odyssey / MRO', sourceDegree=120, usedDegreeMin=3, usedDegreeMax=90, referenceRadiusM=3396000., flattening=1/196.877360, referenceText='원본 PDS 제품의 기준 타원체: a=3396.0 km, 1/f=196.877360. 회전율 7.088218066303858×10⁻⁵ rad/s. 이 제품은 GMM-3의 3–90차 편차이며, 모든 저차항을 포함한 완전한 아레오이드 파일은 아닙니다.', method='PDS가 계산한 공식 격자의 m 단위 값을 그대로 사용합니다. 지형 높이 자료가 아닙니다.', nativeGrid='180 × 360 · 1°', processing='원본 1° 격자 유지; PC_REAL little-endian float32, scaling=1, offset=0.', frame='행성중심 위도 · 동경 · 원본 body-fixed 좌표계', paper='Genova et al. (2016), Seasonal and static gravity field of Mars from MGS, Mars Odyssey and MRO radio science.', paperUrl='https://doi.org/10.1016/j.icarus.2016.02.050'),
 'moon': dict(name='달', surfaceName='달 지오이드', model='GRGM900C · 600차 격자', agency='NASA GSFC / GRAIL · PDS Geosciences', mission='GRAIL A/B', sourceDegree=900, usedDegreeMin=0, usedDegreeMax=600, referenceRadiusM=1738000., flattening=0., referenceText='원본 PDS 제품: 반경 1738.0 km 기준구, GM=4902.79996708864 km³/s², 회전율 0. 지구 EGM과 같은 기준계가 아닙니다.', method='PDS가 GRGM900C를 600차까지 합성해 배포한 지오이드 격자입니다. 이 웹에서는 원본 값을 1° 간격으로 추출합니다.', nativeGrid='1441 × 2880 · 0.125°', processing='8개 격자마다 원본 노드 추출 → 181 × 360 · 1°. 서브도 단위 특징은 재현하지 못합니다. 평균화나 지형 자료 대입은 하지 않았습니다.', frame='행성중심 위도 · 동경 · DE421 달 고정 좌표계', paper='Lemoine et al. (2014), GRGM900C: A degree 900 lunar gravity model from GRAIL primary and extended mission data.', paperUrl='https://doi.org/10.1002/2014GL060027'),
 'venus': dict(name='금성', surfaceName='금성 지오이드 이상', model='SHG120 · Magellan', agency='NASA PDS · Magellan Radio Science', mission='Magellan', sourceDegree=120, usedDegreeMin=None, usedDegreeMax=120, referenceRadiusM=6051800., flattening=0., referenceText='원본 라벨은 SHG120 geoid 이상값(m)으로 정의하며 기준면 반경·퍼텐셜 수치를 명시하지 않습니다. 화면의 반경 6051.8 km 구는 굴곡 표현을 위한 시각화 지지면일 뿐 공인 기준면이 아닙니다. 절대 반경을 추정하는 데 사용할 수 없습니다.', method='GEOIDGRD.DAT의 실수 지오이드 이상값을 사용합니다. 컬러 이미지나 레이더 지형 자료가 아닙니다. 이 제품은 SHG120이며 MGNP180U로 표시하지 않습니다.', nativeGrid='180 × 360 · 1°', processing='F8.2 ASCII 원본 m 값 유지. 원본 시작 동경 240°를 0° 시작으로 순환 재배열했습니다.', frame='원본 위도 89.5° → −89.5° · 동경 240° 시작', paper='Magellan Radio Science, GEOIDGRD-DAT (released 1997-08-01), NASA PDS.', paperUrl=PRODUCTS['venus']+'.lbl'),
 'mercury': dict(name='수성', surfaceName='수성 등퍼텐셜면', model='JGMESS160A · 90차 합성', agency='NASA JPL / MESSENGER · PDS Geosciences', mission='MESSENGER', sourceDegree=160, usedDegreeMin=0, usedDegreeMax=90, referenceRadiusM=2440000., flattening=0., referenceText='반경 R=2440.0 km 기준구. 이 웹의 선택 기준: W₀=GM/R+ω²R²/3. 원심 퍼텐셜 포함, 외부 조석 퍼텐셜 및 영구조석 복원은 제외. 공인 수성 수직기준을 뜻하지 않습니다.', method='공개된 완전 정규화 JGMESS160A 중력장 계수의 0–90차로 등퍼텐셜면을 계산합니다. SHTOOLS 3차 Taylor 방법; 내부 밀도 보정 없는 외부 중력장의 형식적 연장입니다.', nativeGrid='원본 160차 구면조화 계수', processing='90차로 절단하여 약 0.989° DH2 격자로 합성. 출력은 m 단위이며 JSON 저장 시 0.001 m로 반올림합니다.', frame='행성중심 위도 · 동경 · JGMESS160A 수성 고정 좌표계', paper='Konopliv, Park & Ermakov (2020), The Mercury gravity field, orientation, Love number, and ephemeris from the MESSENGER radiometric tracking data.', paperUrl='https://doi.org/10.1016/j.icarus.2019.07.020'),
}

def fetch(url: str, target: Path) -> bytes:
 if not target.exists():
  with urlopen(Request(url, headers={'User-Agent':'GeoidAtlas-science/0.9 (NASA PDS public data)'}), timeout=120) as response:
   data = response.read()
  if len(data)<20 or b'<!doctype html' in data[:100].lower():
   raise ValueError('Unexpected download: '+url)
  target.write_bytes(data)
 return target.read_bytes()

def save_json(path: Path, data: dict) -> str:
 raw = json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
 path.write_bytes(raw)
 return hashlib.sha256(raw).hexdigest()

def main() -> None:
 import pyshtools as sh
 manifest = {'schema':1, 'createdAt':datetime.now(timezone.utc).isoformat(), 'software':{'python':sys.version.split()[0], 'numpy':np.__version__, 'pyshtools':sh.__version__}, 'bodies':{}}
 for body, base in PRODUCTS.items():
  ext = '.tab' if body=='mercury' else '.dat' if body=='venus' else '.img'
  label = fetch(base+'.lbl', CACHE/(body+'.lbl'))
  raw = fetch(base+ext, CACHE/(body+ext))
  assert hashlib.sha256(raw).hexdigest()==HASHES[body], 'Source changed: '+body
  metadata = dict(CATALOG[body], body=body, source=base+ext, label=base+'.lbl', sourceSha256=HASHES[body], labelSha256=hashlib.sha256(label).hexdigest(), unit='m', isTopography=False)
  if body=='mars':
   assert len(raw)==180*360*4 and b'PC_REAL' in label
   native = np.frombuffer(raw, dtype='<f4').reshape(180,360).astype(float)
   values = native.copy(); lat0,lon0,dlat,dlon = 89.5,.5,1.,1.
  elif body=='moon':
   assert len(raw)==1441*2880*4 and b'PC_REAL' in label
   native = np.frombuffer(raw, dtype='<f4').reshape(1441,2880).astype(float)
   values = native[::8,::8].copy(); lat0,lon0,dlat,dlon = 90.,0.,1.,1.
   assert np.array_equal(values, native[::8,::8])
  elif body=='venus':
   native = np.fromstring(raw.decode('ascii'), sep=' ').reshape(180,360)
   values = np.roll(native,-120,axis=1); lat0,lon0,dlat,dlon = 89.5,0.,1.,1.
   assert np.array_equal(values[:,240],native[:,0])
  else:
   omega = math.radians(6.138514)/86400.
   gravity = sh.SHGravCoeffs.from_file(str(CACHE/'mercury.tab'), lmax=90, header_units='km', errors=True, omega=omega)
   assert gravity.normalization=='4pi' and gravity.csphase==1
   r, gm = float(gravity.r0), float(gravity.gm)
   w0 = gm/r+omega**2*r*r/3
   full = sh.gravmag.MakeGeoidGridDH(gravity.coeffs, r, gm, w0, lmax=90, omega=omega, r=r, order=3, lmax_calc=90, a=r, f=0., sampling=2, extend=True)
   native=full[:,:-1]; values=native.copy()
   lat0,lon0,dlat,dlon=90.,0.,180/(values.shape[0]-1),360/values.shape[1]
   residuals=[]
   for i,j in [(0,0),(30,40),(60,120),(90,180),(130,240),(170,300),(182,0)]:
    rr=r+values[i,j];lat=lat0-i*dlat;lon=j*dlon
    coeff=gravity.coeffs*(r/rr)**np.arange(91)[None,:,None]
    potential=gm/rr*sh.expand.MakeGridPoint(coeff,lat,lon,norm=1,csphase=1)+.5*omega**2*rr**2*math.cos(math.radians(lat))**2
    residuals.append(abs(potential-w0)/(gm/rr**2))
   assert max(residuals)<.02, residuals
   metadata.update(gmM3S2=gm,omegaRadS=omega,referencePotentialM2S2=w0,equipotentialResidualMaxM=max(residuals))
  assert np.isfinite(native).all() and np.isfinite(values).all()
  assert float(np.ptp(values))>1 and float(np.max(np.abs(values)))<20000
  metadata['nativeRangeM']=[float(native.min()),float(native.max())]
  values=np.round(values,3)
  metadata['rangeM']=[float(values.min()),float(values.max())]
  grid={'rows':int(values.shape[0]),'cols':int(values.shape[1]),'lat0':lat0,'lon0':lon0,'stepLat':dlat,'stepLon':dlon,'order':'north-to-south, eastward, periodic longitude'}
  checks=[{'row':i,'col':j,'lat':lat0-i*dlat,'lon':(lon0+j*dlon)%360,'valueM':float(values[i,j])} for i,j in [(0,0),(values.shape[0]//2,values.shape[1]//2),(values.shape[0]-1,values.shape[1]-1)]]
  product={'meta':metadata,'grid':grid,'checks':checks,'values':values.ravel().tolist()}
  sha=save_json(OUT/(body+'.json'),product)
  shutil.copyfile(CACHE/(body+'.lbl'), OUT/(body+'-source.lbl'))
  manifest['bodies'][body]={'meta':metadata,'grid':grid,'checks':checks,'outputSha256':sha}
  print(body,grid,metadata['rangeM'], 'source hash verified', flush=True)
 save_json(OUT/'manifest.json',manifest)
 print('Validated all four planetary geoid products.', flush=True)

if __name__=='__main__':
 main()
