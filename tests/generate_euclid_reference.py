"""Regenerate independent HEALPix fixtures; requires astropy-healpix and numpy."""
import json
from pathlib import Path
import numpy as np
from astropy import units as u
from astropy_healpix import HEALPix
rng = np.random.default_rng(42)
ra = rng.uniform(0, 360, 1500)
dec = np.degrees(np.arcsin(rng.uniform(-1, 1, 1500)))
pixels = HEALPix(nside=8192, order='nested').lonlat_to_healpix(ra*u.deg, dec*u.deg)
Path(__file__).with_name('euclid-reference.json').write_text(
    json.dumps(list(zip(ra.tolist(), dec.tolist(), pixels.tolist())), separators=(',', ':')) + '\n')
