"""Build real EGM2008 values from the public NGA/PROJ 2.5-minute grid.

Only derived files under data/ are written. The uploaded observations and KN18
values in app-v6.html are never changed. Raster pixels are sampled at their
centres, with four-node bilinear interpolation and no vertical-datum correction.
Source and licence: https://cdn.proj.org/us_nga_README.txt (public domain).
"""
from __future__ import annotations
import hashlib
import json
import math
import platform
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

SOURCE = 'https://cdn.proj.org/us_nga_egm08_25.tif'
ROOT = Path(__file__).resolve().parents[1]


def finite(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def bilinear(grid, x, y):
    rows, cols = grid.shape
    if not (0 <= x <= cols - 1 and 0 <= y <= rows - 1):
        raise ValueError('Observation outside the extracted EGM2008 grid')
    j, i = min(math.floor(x), cols - 2), min(math.floor(y), rows - 2)
    u, v = x - j, y - i
    nodes = grid[i:i + 2, j:j + 2].astype(np.float64)
    if not np.isfinite(nodes).all():
        raise ValueError('Invalid EGM2008 grid node')
    return float((1-v)*((1-u)*nodes[0, 0]+u*nodes[0, 1]) + v*((1-u)*nodes[1, 0]+u*nodes[1, 1]))


def summary(values):
    d = np.array(values, dtype=np.float64)
    if not len(d):
        raise ValueError('No valid residuals')
    return dict(valid=len(d), mean=float(d.mean()), rmse=float(np.sqrt(np.mean(d*d))),
                mae=float(np.mean(np.abs(d))), min=float(d.min()), max=float(d.max()))


def main():
    # A plane must interpolate exactly; these guard axis and weight conventions.
    test = np.array([[2., 5.], [9., 12.]])
    assert abs(bilinear(test, .2, .7) - 7.5) < 1e-12
    assert bilinear(test, 1., 1.) == 12.
    html = (ROOT / 'app-v6.html').read_bytes()
    payload = html.decode('utf-8').split('const GEOID_DATA=', 1)[1]
    original, _ = json.JSONDecoder().raw_decode(payload)
    records = original['observation']['rows']
    kn = original['model']
    coords = [(float(r[7]), float(r[6])) for r in records if finite(r[6]) and finite(r[7])]
    if not coords:
        raise ValueError('No observation coordinates')
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / 'us_nga_egm08_25.tif'
        for attempt in range(3):
            try:
                request = urllib.request.Request(SOURCE, headers={'User-Agent': 'GeoidAtlas-EducationalDataBuild/1.0'})
                with urllib.request.urlopen(request, timeout=120) as response, target.open('wb') as out:
                    while block := response.read(1024*1024):
                        out.write(block)
                if target.stat().st_size < 10_000_000:
                    raise ValueError('Unexpected geoid grid file size')
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
        source_hash = hashlib.sha256(target.read_bytes()).hexdigest()
        with rasterio.open(target) as src:
            t = src.transform
            assert src.count == 1 and src.crs.is_geographic
            assert t.a > 0 and t.e < 0 and t.b == 0 and t.d == 0
            assert abs(t.a - 1/24) < 1e-8 and abs(-t.e - 1/24) < 1e-8
            west = min(kn['lon0'], min(p[0] for p in coords))
            east = max(kn['lonMax'], max(p[0] for p in coords))
            south = min(kn['lat0'], min(p[1] for p in coords))
            north = max(kn['latMax'], max(p[1] for p in coords))
            c0, r0 = (~t) * (west, north)
            c1, r1 = (~t) * (east, south)
            c0, r0 = max(0, math.floor(c0)-2), max(0, math.floor(r0)-2)
            c1, r1 = min(src.width, math.ceil(c1)+2), min(src.height, math.ceil(r1)+2)
            window = Window(c0, r0, c1-c0, r1-r0)
            masked = src.read(1, window=window, masked=True)
            if np.ma.getmaskarray(masked).any():
                raise ValueError('Missing data in the regional EGM2008 grid')
            grid = np.array(masked, dtype=np.float64) * src.scales[0] + src.offsets[0]
            if not np.isfinite(grid).all() or np.max(np.abs(grid)) > 150:
                raise ValueError('Implausible EGM2008 grid values')
            gt = src.window_transform(window)
            lon0, lat_max = gt * (.5, .5)
            rows, cols = grid.shape
            lat0 = lat_max - (rows-1)*(-gt.e)
            lon_max = lon0 + (cols-1)*gt.a
            source_meta = dict(width=src.width, height=src.height, crs=str(src.crs),
                               transform=list(t)[:6], tags=src.tags(), bandTags=src.tags(1))
        points, residuals = [], []
        for index, record in enumerate(records):
            lat, lon, H, h = record[6], record[7], record[11], record[12]
            value = None
            if finite(lat) and finite(lon):
                x, y = (lon-lon0)/gt.a, (lat_max-lat)/(-gt.e)
                value = bilinear(grid, x, y)
                # Independent weighted-node calculation catches transposed indexing.
                j, i = math.floor(x), math.floor(y)
                u, v = x-j, y-i
                independent = sum(float(grid[i+dy, j+dx]) * (u if dx else 1-u) * (v if dy else 1-v)
                                  for dy in (0, 1) for dx in (0, 1))
                assert abs(value-independent) < 1e-10
                if finite(H) and finite(h):
                    residuals.append(float(h-H-value))
            points.append([index, record[1], lat, lon, value])
        stats = summary(residuals)
        stats.update(total=len(records), missing=len(records)-len(residuals),
                     modelAvailable=sum(p[4] is not None for p in points))
        meta = dict(schema=1, model='EGM2008', gridSpacingArcMinutes=2.5,
                    unit='m', ellipsoid='WGS84', interpolation='four-node bilinear',
                    source=SOURCE, sourceDocumentation='https://cdn.proj.org/us_nga_README.txt',
                    sourceLicence='Public Domain', sourceSha256=source_hash,
                    inputSha256=hashlib.sha256(html).hexdigest(),
                    generatedAt=datetime.now(timezone.utc).isoformat(),
                    software=dict(python=platform.python_version(), rasterio=rasterio.__version__, numpy=np.__version__),
                    datumNotice='관측 높이의 수직기준과 EGM2008 기준의 일치를 가정한 잠정 비교입니다. 수직기준·조석계·시점 보정은 적용하지 않았습니다. 잔차를 모델의 공인 정확도로 해석하지 마세요.',
                    statistics=stats, sourceRaster=source_meta)
        regional = dict(rows=rows, cols=cols, lat0=lat0, latMax=lat_max, lon0=lon0, lonMax=lon_max,
                        stepLat=-gt.e, stepLon=gt.a, nmin=float(grid.min()), nmax=float(grid.max()),
                        order='north-to-south, west-to-east', values=grid.ravel().tolist())
        result = dict(meta=meta, points=points, grid=regional)
        out = ROOT / 'data'
        out.mkdir(exist_ok=True)
        (out / 'egm2008.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False)+'\n', encoding='utf-8')
        checks = [dict(index=p[0], id=p[1], lat=p[2], lon=p[3], egm=p[4],
                       observed=(records[p[0]][12]-records[p[0]][11]) if finite(records[p[0]][12]) and finite(records[p[0]][11]) else None)
                  for p in points[::max(1, len(points)//8)]]
        report = dict(meta=meta, regionalGrid={k:v for k,v in regional.items() if k != 'values'}, checks=checks,
                      outputSha256=hashlib.sha256((out / 'egm2008.json').read_bytes()).hexdigest())
        (out / 'egm2008-summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
