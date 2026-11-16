"use strict";
/* HEALPix NESTED indexing (Gorski et al. 2005). Separate from POSSUM's RING tiles. */
function euclidPixel(v, order) {
  const n = 2 ** order, z = Math.max(-1, Math.min(1, v[2])), za = Math.abs(z);
  let phi = Math.atan2(v[1], v[0]); if (phi < 0) phi += 2 * Math.PI;
  const tt = phi / (Math.PI / 2);
  let face, x, y;
  if (za <= 2 / 3) {
    const jp = Math.floor(n * (0.5 + tt - z * 0.75));
    const jm = Math.floor(n * (0.5 + tt + z * 0.75));
    const fp = Math.floor(jp / n), fm = Math.floor(jm / n);
    face = fp === fm ? (fp | 4) : fp < fm ? fp : fm + 8;
    x = jm % n; y = n - jp % n - 1;
  } else {
    const nt = Math.min(3, Math.floor(tt)), tp = tt - nt, tmp = n * Math.sqrt(3 * (1 - za));
    const jp = Math.min(n - 1, Math.floor(tp * tmp)), jm = Math.min(n - 1, Math.floor((1 - tp) * tmp));
    face = z >= 0 ? nt : nt + 8;
    x = z >= 0 ? n - jm - 1 : jp; y = z >= 0 ? n - jp - 1 : jm;
  }
  // Interleave 13-bit x/y coordinates without an allocation or per-bit loop.
  return face * n * n + euclidSpread(x) + 2 * euclidSpread(y);
}
function euclidSpread(x) {
  x = (x | (x << 8)) & 0x00ff00ff;
  x = (x | (x << 4)) & 0x0f0f0f0f;
  x = (x | (x << 2)) & 0x33333333;
  return (x | (x << 1)) & 0x55555555;
}
function euclidContains(ranges, pixel) {
  let lo = 0, hi = ranges.length / 2;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (ranges[mid * 2] <= pixel) lo = mid + 1; else hi = mid; }
  return lo > 0 && pixel < ranges[lo * 2 - 1];
}
const EUCLID_COLOURS = { wide: [255, 205, 64], deep: [235, 116, 255] };
/* Inverse-project screen samples into the exact MOC. This naturally clips the
   globe limb and Mollweide seam; no polygon can bridge the back of the globe.
   Cache one raster per canvas so targets/status redraws need no new sky lookup. */
const euclidRasterCache = new WeakMap();
function drawEuclid(ctx, canvas, P, view, w, h, scale, wide, deep) {
  if (!wide && !deep) return;
  const width = Math.round(w * scale), height = Math.round(h * scale);
  const key = JSON.stringify([view, width, height, wide, deep]);
  let cached = euclidRasterCache.get(canvas);
  if (!cached || cached.key !== key) {
    const raster = document.createElement('canvas'); raster.width = width; raster.height = height;
    const rc = raster.getContext('2d'), pixels = rc.createImageData(width, height), mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const v = P.inv((x + 0.5) / scale, (y + 0.5) / scale); if (!v) continue;
      const p = euclidPixel(v, EUCLID.wide.order);
      mask[y * width + x] = deep && euclidContains(EUCLID.deep.ranges, p) ? 2 : wide && euclidContains(EUCLID.wide.ranges, p) ? 1 : 0;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, m = mask[i]; if (!m) continue;
      const edge = x === 0 || x === width - 1 || y === 0 || y === height - 1 || mask[i-1] !== m || mask[i+1] !== m || mask[i-width] !== m || mask[i+width] !== m;
      pixels.data.set([...EUCLID_COLOURS[m === 2 ? 'deep' : 'wide'], edge ? 235 : 70], i * 4);
    }
    rc.putImageData(pixels, 0, 0); cached = { key, raster }; euclidRasterCache.set(canvas, cached);
  }
  ctx.drawImage(cached.raster, 0, 0, w, h);
}
if (typeof module !== 'undefined') module.exports = { euclidPixel, euclidContains };
