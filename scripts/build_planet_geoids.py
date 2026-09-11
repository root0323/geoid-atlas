"""Acquire only public NASA PDS planetary reference-surface data.

First-stage acquisition: retain the original labels and hashes for review.
No Earth observations, KN18 or EGM2008 data are modified.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen
import numpy as np
import pyshtools as pysh

ROOT = 'https://pds-geosciences.wustl.edu/'
PRODUCTS = {
    'mars': ROOT + 'mro/mro-m-rss-5-sdp-v1/mrors_1xxx/data/rsdmap/ggmro_120_geoid_90',
    'moon': ROOT + 'grail/grail-l-lgrs-5-rdr-v1/grail_1001/rsdmap/gggrx_0900c_geoid_l600',
    'venus': ROOT + 'mgn/mgn-v-rss-5-gravity-l2-v1/mg_5201/gravity/geoidgrd',
    'mercury': ROOT + 'messenger/mess-h-rss_mla-5-sdp-v1/messrs_1001/data/shadr/jgmess_160a_sha',
}
OUT = Path('planet-build')
OUT.mkdir(exist_ok=True)

def download(url: str, filename: str) -> Path:
    target = OUT / filename
    if not target.exists():
        with urlopen(Request(url, headers={'User-Agent': 'GeoidAtlas-science/0.9 (public planetary data)'}), timeout=120) as response:
            data = response.read()
        if len(data) < 20 or data[:100].lstrip().lower().startswith(b'<!doctype html'):
            raise ValueError('Unexpected response for ' + url)
        target.write_bytes(data)
    return target

def main() -> None:
    provenance = {}
    for body, url in PRODUCTS.items():
        ext = '.tab' if body == 'mercury' else '.dat' if body == 'venus' else '.img'
        label = download(url+'.lbl', body+'.lbl')
        source = download(url+ext, body+ext)
        print('\n--- '+body+' PDS label ---\n'+label.read_text(errors='replace'), flush=True)
        provenance[body] = {'source': url+ext, 'label': url+'.lbl', 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'bytes': source.stat().st_size}
    mercury_path = OUT/'mercury.tab'
    assert provenance['mercury']['sourceSha256'] == '14fa0129c4b5ef655e08a883a05a476a836a806349da607f84b3c2b2e3d899ca'
    # A stated reference convention, not an official Mercury vertical datum.
    # Fully normalized PDS coefficients, degrees 0..90, plus centrifugal potential.
    gravity = pysh.SHGravCoeffs.from_file(str(mercury_path), lmax=90, header_units='km', errors=True, omega=pysh.constants.Mercury.angular_velocity.value)
    r = float(gravity.r0)
    w0 = float(gravity.gm/r + gravity.omega**2*r*r/3)
    geoid = gravity.geoid(potref=w0, a=r, f=0.0, r=r, order=3, lmax=90, lmax_calc=90, sampling=2, extend=True)
    values = geoid.geoid.data
    assert np.isfinite(values).all()
    np.save(OUT/'mercury-geoid.npy', values)
    provenance['mercury'].update({'gm': float(gravity.gm), 'referenceRadiusM': r, 'omegaRadS': float(gravity.omega), 'referencePotentialM2S2': w0, 'degreeUsed': 90, 'originalDegree': 160, 'shape': list(values.shape), 'min': float(values.min()), 'max': float(values.max()), 'method': 'SHTOOLS order-3 equipotential radial height above reference sphere; W0=GM/R+omega^2 R^2/3; no external tidal potential', 'pyshtoolsVersion': pysh.__version__})
    (OUT/'provenance.json').write_text(json.dumps(provenance, indent=2), encoding='utf-8')
    print(json.dumps(provenance, indent=2), flush=True)

if __name__ == '__main__':
    main()
