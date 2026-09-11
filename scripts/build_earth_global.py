"""Global EGM2008 display grid; keep all uploaded and regional data unchanged.

Source: NGA model, GeographicLib-derived PROJ grid (public domain).
Take actual pixel-centre nodes at 1 degree from the 2.5 arcminute grid.
No synthetic values, zero padding, mean removal, or KN extrapolation.
"""
from __future__ import annotations
import hashlib
import json
import math
import platform
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
import numpy as np
import rasterio

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/earth-global'
SOURCE = 'https://cdn.proj.org/us_nga_egm08_25.tif'
DOC = 'https://cdn.proj.org/us_nga_README.txt'
EXPECTED = '4191d471eefebf24091b56dbc604353cb3b8cf8cc70e448bb9ae56a272bef17a'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    protected = ['app-v6.html', 'data/egm2008.json', 'data/egm2008-summary.json']
    before = {name: sha(ROOT / name) for name in protected}
    regional = json.loads((ROOT / 'data/egm2008-summary.json').read_text())
    assert regional['meta']['sourceSha256'] == EXPECTED
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / 'egm2008.tif'
        with urlopen(Request(SOURCE, headers={'User-Agent': 'GeoidAtlas-global-geoid/1.0'}), timeout=120) as response, source.open('wb') as target:
            while block := response.read(1024 * 1024):
                target.write(block)
        assert sha(source) == EXPECTED, 'Unexpected source checksum; stop rather than substitute a model'
        with rasterio.open(source) as ds:
            assert ds.width == 8640 and ds.height == 4321 and ds.count == 1
            t = ds.transform
            assert abs(t.a - 1/24) < 1e-12 and abs(t.e + 1/24) < 1e-12 and t.b == 0 and t.d == 0
            lon0, lat0 = t * (.5, .5)
            assert abs(lon0 + 180) < 1e-10 and abs(lat0 - 90) < 1e-10
            assert ds.tags().get('AREA_OR_POINT') == 'Point'
            raw = ds.read(1, masked=True)
            assert not np.ma.getmaskarray(raw).any()
            native = np.asarray(raw, dtype=np.float64) * ds.scales[0] + ds.offsets[0]
            assert np.isfinite(native).all() and native.min() > -150 and native.max() < 150
            assert np.ptp(native[0]) < .001 and np.ptp(native[-1]) < .001
            values = np.round(native[::24, ::24], 4)
            assert values.shape == (181, 360)
            # Independently confirm the source against the existing, higher-
            # resolution regional comparison checks, not the display grid.
            max_difference = 0.0
            for check in regional['checks']:
                x, y = (~t) * (check['lon'], check['lat'])
                x -= .5
                y -= .5
                j, i = math.floor(x), math.floor(y)
                u, v = x-j, y-i
                n = sum(float(native[i+dy, j+dx]) * (u if dx else 1-u) * (v if dy else 1-v) for dy in (0, 1) for dx in (0, 1))
                max_difference = max(max_difference, abs(n-check['egm']))
            assert max_difference < 1e-8
            native_range = [float(native.min()), float(native.max())]
            raster = {'rows': ds.height, 'cols': ds.width, 'transform': list(t)[:6], 'crs': str(ds.crs), 'tags': ds.tags()}
        checks = []
        for i, j in [(0, 0), (20, 30), (45, 75), (90, 180), (120, 20), (140, 290), (175, 359), (180, 180), (53, 307)]:
            checks.append({'row': i, 'col': j, 'lat': 90-i, 'lon': -180+j, 'valueM': float(values[i,j]), 'nativeValueM': float(native[i*24,j*24])})
        meta = {
            'schema': 1, 'body': 'earth', 'model': 'EGM2008', 'quantity': 'geoid undulation', 'unit': 'm', 'isTopography': False,
            'coverage': 'global', 'ellipsoid': 'WGS84', 'semiMajorAxisM': 6378137.0, 'inverseFlattening': 298.257223563,
            'source': SOURCE, 'sourceDocumentation': DOC, 'sourceLicence': 'Public Domain', 'sourceSha256': EXPECTED,
            'modelAuthority': 'NGA', 'gridDistributor': 'PROJ / OSGeo', 'nativeSpacingArcMinutes': 2.5,
            'modelDocumentation': 'https://earth-info.nga.mil/index.php?dir=wgs84&action=wgs84',
            'paper': 'Pavlis, Holmes, Kenyon & Factor (2012), The development and evaluation of the Earth Gravitational Model 2008 (EGM2008)',
            'paperUrl': 'https://doi.org/10.1029/2011JB008916',
            'processing': 'Exact native pixel-centre node selection every 24 rows and columns (1 degree); rounded to 0.0001 m for storage. No mean subtraction, no model mixing, no filled data gaps. Longitude wraps; both pole rows retained.',
            'displayNotice': 'Global 1-degree display grid, not the full-resolution original. Browser interpolation is bilinear; geometry is simplified. Map comparisons keep their separate original 2.5-minute grid and KN data.',
            'referenceNotice': 'N is height relative to the WGS84 ellipsoid. Display uses geodetic latitude and outward ellipsoid normals. Only height is visually exaggerated. This is an educational model visualization, not terrain or a precision survey product.',
            'rangeM': [float(values.min()), float(values.max())], 'nativeRangeM': native_range,
            'generatedAt': datetime.now(timezone.utc).isoformat(), 'software': {'python': platform.python_version(), 'numpy': np.__version__, 'rasterio': rasterio.__version__}
        }
        grid = {'rows': 181, 'cols': 360, 'lat0': 90, 'lon0': -180, 'stepLat': 1, 'stepLon': 1, 'rowOrder': 'north-to-south', 'longitudePeriodic': True}
        result = {'meta': meta, 'grid': grid, 'checks': checks, 'values': values.ravel().tolist()}
        OUT.mkdir(parents=True, exist_ok=True)
        target = OUT / 'egm2008-global.json'
        target.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False)+'\n', encoding='utf-8')
        with urlopen(Request(DOC, headers={'User-Agent': 'GeoidAtlas-global-geoid/1.0'}), timeout=30) as response:
            (OUT / 'source-readme.txt').write_bytes(response.read())
        report = {'meta': meta, 'grid': grid, 'checks': checks, 'sourceRaster': raster, 'outputSha256': sha(target), 'sourceRegionalMaxDifferenceM': max_difference, 'protectedFilesUnchanged': before}
        assert before == {name: sha(ROOT / name) for name in protected}
        (OUT / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
