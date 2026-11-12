"use strict";
/* ==================================================================
   POSSUM Coverage Checker — core (no DOM): astro maths, HEALPix,
   input parsing, survey-status model, cross-matching
   ================================================================== */
const D2R = Math.PI / 180, R2D = 180 / Math.PI, TAU = 2 * Math.PI;
const SHEET_ID = "1sWCtxSSzTwjYjhxr1_KVLWG2AnrHwSJf_RWQow7wbH0";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/`;
/* Tabs of the POSSUM pipeline-status sheet (maintained by Cameron Van Eck).
   `need` = columns that must be present; guards against Google silently
   returning the first tab when a tab name no longer exists. */
const TABS = {
  f1: { name: "Survey Fields - Band 1", gid: "1364788351", need: ["name", "sbid", "validated", "associated_tiles"] },
  f2: { name: "Survey Fields - Band 2", gid: "995376834", need: ["name", "sbid", "validated", "associated_tiles"] },
  t1: { name: "Survey Tiles - Band 1", gid: "1858715798", need: ["tile_id", "3d_pipeline"] },
  t2: { name: "Survey Tiles - Band 2", gid: "780749712", need: ["tile_id", "3d_pipeline"] },
  obs: { name: "All Observations", gid: "785190940", need: ["name", "sbid", "current_state"] },
};
const BANDS = {
  1: { label: "Band 1", freq: "800–1088 MHz", prefix: "EMU_", partner: "EMU", fwhm: 1.65 },
  2: { label: "Band 2", freq: "1296–1440 MHz", prefix: "WALLABY_", partner: "WALLABY", fwhm: 1.14 },
};
const NSIDE = 32;                // POSSUM tiles = HEALPix nside 32, ring ordering
const BEAM_PITCH = 0.9;          // deg, both footprints

/* ---- field status ladder (rank order matters) ---- */
const FSTAT = {
  none:      { rank: -1, label: "Not in footprint", short: "—", col: "#566076" },
  planned:   { rank: 0, label: "Planned", short: "Planned", col: "#6b7488" },
  rejected:  { rank: 1, label: "Rejected", short: "Rejected", col: "#e0564c" },
  observed:  { rank: 2, label: "Observed", short: "Observed", col: "#e0a33b" },
  validated: { rank: 3, label: "Validated", short: "Validated", col: "#4f8cff" },
  processed: { rank: 4, label: "POSSUM-processed", short: "Processed", col: "#35c48a" },
};
const FSTAT_DESC = {
  planned: "In the survey plan, not yet observed",
  rejected: "Observed, but the observation failed validation — awaiting re-observation",
  observed: "Observed and processed by ASKAPsoft; awaiting validation",
  validated: "Observed and validated (released on CASDA)",
  processed: "Validated and ingested by the POSSUM pipeline at AusSRC",
};
const TSTAT = {
  none:    { label: "Not started", col: "#566076" },
  ingest:  { label: "Tile mosaicked", col: "#4f8cff" },
  running: { label: "3D pipeline running", col: "#e0a33b" },
  waiting: { label: "Awaiting validation", col: "#b58cf5" },
  failed:  { label: "3D pipeline failed", col: "#e0564c" },
  done:    { label: "Cubes complete", col: "#35c48a" },
};

/* ---------------- vectors & frames ---------------- */
function rd2v(ra, dec) { const a = ra * D2R, d = dec * D2R, c = Math.cos(d); return [c * Math.cos(a), c * Math.sin(a), Math.sin(d)]; }
function v2rd(v) { let ra = Math.atan2(v[1], v[0]) * R2D; if (ra < 0) ra += 360; return [ra, Math.asin(Math.max(-1, Math.min(1, v[2]))) * R2D]; }
function sepDeg(a, b) {
  const cx = a[1] * b[2] - a[2] * b[1], cy = a[2] * b[0] - a[0] * b[2], cz = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * R2D;
}
// J2000 equatorial -> Galactic rotation (rows)
const E2G = [[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
             [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
             [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]];
function mul(M, v) { return [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]]; }
function mulT(M, v) { return [M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2], M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2], M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2]]; }
function eq2gal(ra, dec) { return v2rd(mul(E2G, rd2v(ra, dec))); }
function gal2eq(l, b) { return v2rd(mulT(E2G, rd2v(l, b))); }

function pad2(n) { return (n < 10 ? "0" : "") + n; }
function fmtRA(ra, prec = 2) {
  let t = Math.round(((ra % 360 + 360) % 360) / 15 * 3600 * 10 ** prec) / 10 ** prec; if (t >= 86400) t -= 86400;
  const h = Math.floor(t / 3600), m = Math.floor((t - h * 3600) / 60), s = t - h * 3600 - m * 60;
  return `${pad2(h)}:${pad2(m)}:${(s < 10 ? "0" : "") + s.toFixed(prec)}`;
}
function fmtDec(dec, prec = 1) {
  const sg = dec < 0 ? "-" : "+"; let t = Math.round(Math.abs(dec) * 3600 * 10 ** prec) / 10 ** prec;
  const d = Math.floor(t / 3600), m = Math.floor((t - d * 3600) / 60), s = t - d * 3600 - m * 60;
  return `${sg}${pad2(d)}:${pad2(m)}:${(s < 10 ? "0" : "") + s.toFixed(prec)}`;
}
function jname(ra, dec) { return "J" + fmtRA(ra, 0).replace(/:/g, "") + fmtDec(dec, 0).replace(/:/g, ""); }

/* ---------------- HEALPix (ring) ---------------- */
function ang2pix(nside, z, phi) {
  const za = Math.abs(z), tt = ((phi % TAU + TAU) % TAU) / (Math.PI / 2);
  if (za <= 2 / 3) {
    const t1 = nside * (0.5 + tt), t2 = nside * z * 0.75;
    const jp = Math.floor(t1 - t2), jm = Math.floor(t1 + t2);
    const ir = nside + 1 + jp - jm, ks = 1 - (ir & 1);
    let ip = Math.floor((jp + jm - nside + ks + 1) / 2); ip = ((ip % (4 * nside)) + 4 * nside) % (4 * nside);
    return 2 * nside * (nside - 1) + (ir - 1) * 4 * nside + ip;
  }
  const tp = tt - Math.floor(tt), tmp = nside * Math.sqrt(3 * (1 - za));
  const jp = Math.floor(tp * tmp), jm = Math.floor((1 - tp) * tmp);
  const ir = jp + jm + 1; let ip = Math.floor(tt * ir); ip = ((ip % (4 * ir)) + 4 * ir) % (4 * ir);
  return z > 0 ? 2 * ir * (ir - 1) + ip : 12 * nside * nside - 2 * ir * (ir + 1) + ip;
}
function tileOf(ra, dec) { return ang2pix(NSIDE, Math.sin(dec * D2R), ra * D2R); }
function pix2zphi(nside, p) {
  const npix = 12 * nside * nside, ncap = 2 * nside * (nside - 1);
  if (p < ncap) { const i = Math.floor((1 + Math.sqrt(1 + 2 * p)) / 2), j = p + 1 - 2 * i * (i - 1); return [1 - i * i / (3 * nside * nside), (j - 0.5) * Math.PI / (2 * i)]; }
  if (p < npix - ncap) { const ip = p - ncap, i = Math.floor(ip / (4 * nside)) + nside, j = ip % (4 * nside) + 1, f = ((i + nside) & 1) ? 1 : 0.5; return [(2 * nside - i) * 2 / (3 * nside), (j - f) * Math.PI / (2 * nside)]; }
  const ip = npix - p, i = Math.floor((1 + Math.sqrt(2 * ip - 1)) / 2), j = 4 * i + 1 - (ip - 2 * i * (i - 1));
  return [-1 + i * i / (3 * nside * nside), (j - 0.5) * Math.PI / (2 * i)];
}
function tileCentre(p) { const [z, phi] = pix2zphi(NSIDE, p); return [phi * R2D, Math.asin(z) * R2D]; }
/* Tile outline as unit vectors: the pixel is a diamond in the HEALPix plane. */
function tileOutline(p, nseg = 3) {
  const [z, phi] = pix2zphi(NSIDE, p), q = Math.PI / 2, pc = (Math.floor(phi / q) + 0.5) * q;
  let x, y;
  if (Math.abs(z) <= 2 / 3) { x = phi; y = 3 * Math.PI * z / 8; }
  else { const s = Math.sqrt(3 * (1 - Math.abs(z))); x = pc + (phi - pc) * s; y = Math.sign(z) * Math.PI / 4 * (2 - s); }
  const d = Math.PI / (4 * NSIDE), cs = [[x, y + d], [x - d, y], [x, y - d], [x + d, y]], out = [];
  for (let k = 0; k < 4; k++) {
    const a = cs[k], b = cs[(k + 1) % 4];
    for (let s = 0; s < nseg; s++) {
      const px = a[0] + (b[0] - a[0]) * s / nseg, py = a[1] + (b[1] - a[1]) * s / nseg; let zz, ph;
      if (Math.abs(py) <= Math.PI / 4) { ph = px; zz = 8 * py / (3 * Math.PI); }
      else { const sg = Math.max(0, 2 - 4 * Math.abs(py) / Math.PI); zz = Math.sign(py) * (1 - sg * sg / 3); ph = sg > 1e-9 ? pc + (px - pc) / sg : pc; }
      const c = Math.sqrt(Math.max(0, 1 - zz * zz)); out.push([c * Math.cos(ph), c * Math.sin(ph), zz]);
    }
  }
  return out;
}

/* ---------------- CSV ---------------- */
function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function csvToObjects(text, need) {
  const rows = parseCSV(text); if (rows.length < 2) throw new Error("empty table");
  const hdr = rows[0].map(h => h.trim());
  for (const n of need) if (!hdr.includes(n)) throw new Error(`unexpected columns (missing “${n}”) — the sheet layout may have changed`);
  return rows.slice(1).filter(r => r.some(c => c !== "")).map(r => { const o = {}; hdr.forEach((h, i) => { if (h) o[h] = (r[i] || "").trim(); }); return o; });
}

/* ---------------- target-list parsing ---------------- */
const RE_SEX = /^[+-]?\d{1,3}:\d{1,2}(:\d{1,2}(\.\d*)?)?$/;
const RE_HMS = /^(\d{1,2})h\s*(\d{1,2})m\s*(\d{1,2}(?:\.\d*)?)?s?$/i;
const RE_DMS = /^([+-]?\d{1,2})[d°]\s*(\d{1,2})[m'′]\s*(\d{1,2}(?:\.\d*)?)?(?:s|"|″)?$/i;
const RE_NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function sex2num(s) {
  let m, parts;
  if ((m = RE_HMS.exec(s)) || (m = RE_DMS.exec(s))) parts = [m[1], m[2], m[3] || "0"]; else parts = s.split(":");
  const neg = /^\s*-/.test(parts[0]); const a = parts.map(p => Math.abs(parseFloat(p)) || 0);
  if (a[1] >= 60 || (a[2] || 0) >= 60) return NaN;
  const v = a[0] + a[1] / 60 + (a[2] || 0) / 3600; return neg ? -v : v;
}
function coordKind(tok) { if (RE_SEX.test(tok) || RE_HMS.test(tok)) return "s"; if (RE_DMS.test(tok)) return "d"; if (RE_NUM.test(tok)) return "n"; return ""; }
function mkTarget(ra, dec, name, extra) {
  if (!isFinite(ra) || !isFinite(dec)) return { error: "could not read coordinates" };
  if (dec < -90 || dec > 90) return { error: `declination ${dec.toFixed(3)}° is outside ±90°` };
  if (ra < -360 || ra > 360) return { error: `right ascension ${ra.toFixed(3)}° is outside 0–360°` };
  ra = (ra % 360 + 360) % 360;
  return Object.assign({ ra, dec, name: name || jname(ra, dec), named: !!name }, extra || {});
}
function parsePair(a, b, gal) {
  const ka = coordKind(a), kb = coordKind(b);
  let lon = ka === "n" ? parseFloat(a) : sex2num(a) * (ka === "s" && !gal ? 15 : 1);
  let lat = kb === "n" ? parseFloat(b) : sex2num(b);
  if (gal) { const e = gal2eq(lon, lat); return e; }
  return [lon, lat];
}
/* Parse free-form text into targets. Returns {targets, names (to resolve), issues, skipped}. */
function parseTargets(text, opts) {
  const targets = [], issues = [], names = []; let colmap = null, gal = false, delim = null;
  const lines = text.replace(/\r/g, "").split("\n");
  lines.forEach((raw, li) => {
    let line = raw.replace(/#.*$/, "").trim(); if (!line) return;
    let toks;
    const d = delim || (line.includes("\t") ? "\t" : line.includes(",") ? "," : line.includes(";") ? ";" : line.includes("|") ? "|" : null);
    toks = d ? line.split(d).map(t => t.trim()) : line.split(/\s+/);
    if (d && toks.filter(Boolean).length < 2 && /\s/.test(line)) toks = line.split(/[\s,;|]+/);
    // header row?
    const low = toks.map(t => t.toLowerCase().replace(/[\s"']/g, ""));
    if (!toks.some(t => /\d/.test(t) && coordKind(t)) && low.some(t => /^(ra|raj2000|ra_deg|ra\(deg\)|radeg|ra_icrs|alpha|_ra|glon|gl|l)$/.test(t))) {
      const find = re => low.findIndex(t => re.test(t));
      let ri = find(/^(ra|raj2000|ra_deg|ra\(deg\)|radeg|ra_icrs|alpha|_ra)$/), di = find(/^(dec|dej2000|decj2000|dec_deg|dec\(deg\)|decdeg|de|de_icrs|delta|_de|_dec)$/);
      if (ri < 0 || di < 0) { ri = find(/^(glon|gl|l)$/); di = find(/^(glat|gb|b)$/); gal = ri >= 0 && di >= 0; }
      if (ri >= 0 && di >= 0) { colmap = { ri, di, ni: find(/^(name|source|src|object|obj|id|target|source_name|srcname)$/) }; delim = d; }
      return;
    }
    toks = toks.filter(t => t !== "");
    let t = null;
    if (colmap && toks.length > Math.max(colmap.ri, colmap.di)) {
      const full = d ? line.split(d).map(s => s.trim()) : toks;
      const a = full[colmap.ri], b = full[colmap.di];
      if (coordKind(a) && coordKind(b)) { const [ra, dec] = parsePair(a, b, gal); t = mkTarget(ra, dec, colmap.ni >= 0 ? full[colmap.ni] : ""); }
    }
    if (!t) {
      const kinds = toks.map(coordKind), numIdx = kinds.map((k, i) => k ? i : -1).filter(i => i >= 0);
      // six bare numbers in a row: "13 37 00.9 -29 51 57"
      let run = -1;
      for (let i = 0; i + 5 < toks.length; i++) if (kinds.slice(i, i + 6).every(k => k === "n") && !/[+-]/.test(toks[i + 1] + toks[i + 2] + toks[i + 4] + toks[i + 5])) { run = i; break; }
      if (run >= 0 && (numIdx.length === 6 || kinds[0] === "")) {
        const ra = sex2num(toks.slice(run, run + 3).join(":")) * 15, dec = sex2num(toks.slice(run + 3, run + 6).join(":"));
        t = mkTarget(ra, dec, toks.slice(0, run).concat(toks.slice(run + 6)).join(" "));
      } else {
        const pairs = []; for (let i = 0; i + 1 < toks.length; i++) if (kinds[i] && kinds[i + 1]) pairs.push(i);
        if (pairs.length) {
          const i = kinds[0] ? pairs[0] : pairs[pairs.length - 1];
          const [ra, dec] = parsePair(toks[i], toks[i + 1], false);
          t = mkTarget(ra, dec, toks.slice(0, i).concat(toks.slice(i + 2)).join(" ").replace(/^["']|["']$/g, ""));
        }
      }
    }
    if (t && !t.error) { t.line = li + 1; targets.push(t); }
    else if (t && t.error) issues.push({ line: li + 1, text: raw.trim(), msg: t.error });
    else if (/[A-Za-z]/.test(line) && line.length <= 60 && !/^(ra|name)\b.*\bdec\b/i.test(line)) names.push({ line: li + 1, name: (d ? toks.join(" ") : line).replace(/^["']|["']$/g, "") });
    else issues.push({ line: li + 1, text: raw.trim(), msg: "not recognised as coordinates or an object name" });
  });
  return { targets, names, issues };
}

/* ---------------- survey model ---------------- */
function b64f32(b64) {
  const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Float32Array(u.buffer);
}
function convexHull(pts) { // pts: [x,y,...]; returns indices CCW
  const idx = pts.map((_, i) => i).sort((a, b) => pts[a][0] - pts[b][0] || pts[a][1] - pts[b][1]);
  const cr = (o, a, b) => (pts[a][0] - pts[o][0]) * (pts[b][1] - pts[o][1]) - (pts[a][1] - pts[o][1]) * (pts[b][0] - pts[o][0]);
  const lo = [], up = [];
  for (const i of idx) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], i) <= 1e-12) lo.pop(); lo.push(i); }
  for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], i) <= 1e-12) up.pop(); up.push(i); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
/* Build the static geometry of every field in both bands from the embedded beam table. */
function buildFields(beamdata) {
  const S = { 1: [], 2: [] };
  for (const b of [1, 2]) {
    const f32 = b64f32(beamdata[b].b64);
    beamdata[b].names.forEach((nm, fi) => {
      const bv = new Float64Array(108), rd = new Float32Array(72); let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 36; k++) {
        const ra = f32[(fi * 36 + k) * 2], dec = f32[(fi * 36 + k) * 2 + 1], v = rd2v(ra, dec);
        bv[k * 3] = v[0]; bv[k * 3 + 1] = v[1]; bv[k * 3 + 2] = v[2]; rd[k * 2] = ra; rd[k * 2 + 1] = dec; cx += v[0]; cy += v[1]; cz += v[2];
      }
      const n = Math.hypot(cx, cy, cz), c = [cx / n, cy / n, cz / n], [cra, cdec] = v2rd(c);
      // tangent-plane basis at field centre (east, north)
      const e = [-Math.sin(cra * D2R), Math.cos(cra * D2R), 0], no = [-Math.sin(cdec * D2R) * Math.cos(cra * D2R), -Math.sin(cdec * D2R) * Math.sin(cra * D2R), Math.cos(cdec * D2R)];
      const pts = []; let rmax = 0;
      for (let k = 0; k < 36; k++) {
        const v = [bv[k * 3], bv[k * 3 + 1], bv[k * 3 + 2]], dt = v[0] * c[0] + v[1] * c[1] + v[2] * c[2];
        pts.push([(v[0] * e[0] + v[1] * e[1]) / dt, (v[0] * no[0] + v[1] * no[1] + v[2] * no[2]) / dt]);
        rmax = Math.max(rmax, sepDeg(v, c));
      }
      const padR = 0.55 * D2R, hull = convexHull(pts).map(i => {
        const p = pts[i], r = Math.hypot(p[0], p[1]) || 1, x = p[0] * (1 + padR / r), y = p[1] * (1 + padR / r);
        const w = [c[0] + x * e[0] + y * no[0], c[1] + x * e[1] + y * no[1], c[2] + y * no[2]], wn = Math.hypot(w[0], w[1], w[2]);
        return [w[0] / wn, w[1] / wn, w[2] / wn];
      });
      S[b].push({ band: b, id: nm, full: BANDS[b].prefix + nm, c, ra: cra, dec: cdec, rmax, bv, rd, hull, st: "planned", info: {}, obs: [] });
    });
  }
  return S;
}
function isDate(s) { return /^\d{4}-\d{2}-\d{2}/.test(s || ""); }
function tileStat(aus, p3) {
  if (isDate(p3)) return "done"; if (/running/i.test(p3)) return "running"; if (/waiting/i.test(p3)) return "waiting";
  if (/fail/i.test(p3)) return "failed"; if (isDate(aus)) return "ingest"; return "none";
}
/* Merge the sheet tables into the field model. `tabs` = {f1,f2,t1,t2,obs} arrays of row objects. */
function applyStatus(S, tabs) {
  const M = { tiles: { 1: new Map(), 2: new Map() }, stats: { 1: {}, 2: {} }, latest: null, bySbid: new Map(), unmatched: [] };
  const obsBy = new Map();
  for (const o of tabs.obs || []) {
    if (!obsBy.has(o.name)) obsBy.set(o.name, []); obsBy.get(o.name).push(o);
    if (o.obs_start && (!M.latest || o.obs_start > M.latest.obs_start)) M.latest = o;
  }
  for (const b of [1, 2]) {
    const byName = new Map(); for (const r of tabs["f" + b] || []) byName.set(r.name, r);
    const tmap = M.tiles[b], st = M.stats[b] = { n: S[b].length, planned: 0, rejected: 0, observed: 0, validated: 0, processed: 0, tiles: 0, tdone: 0, tfail: 0, trun: 0, twait: 0 };
    for (const f of S[b]) {
      const r = byName.get(f.full) || byName.get(f.id);
      f.obs = (obsBy.get(f.full) || []).slice().sort((x, y) => (x.obs_start < y.obs_start ? -1 : 1));
      f.info = {}; f.st = "planned"; f.tiles = [];
      if (!r) { M.unmatched.push(f.full); st.planned++; continue; }
      const sb = (r.sbid || "").split(".")[0];
      f.info = { sbid: /^\d+$/.test(sb) ? sb : "", obs_start: r.obs_start || "", processed: r.processed || "", validated: r.validated || "", aus_src: r.aus_src || "", pipe1d: r.single_SB_1D_pipeline || "", dave1d: r.Dave_1D_pipeline || "" };
      f.tiles = (r.associated_tiles || "").split(/[,\s]+/).filter(Boolean).map(Number);
      if (f.info.sbid && f.info.processed) {
        f.st = /REJECTED/i.test(f.info.validated) ? "rejected" : isDate(f.info.aus_src) ? "processed" : isDate(f.info.validated) ? "validated" : "observed";
        M.bySbid.set(f.info.sbid, f);
      }
      st[f.st]++;
      for (const t of f.tiles) { if (!tmap.has(t)) tmap.set(t, { id: t, band: b, fields: [], aus: "", p3: "", st: "none" }); tmap.get(t).fields.push(f); }
    }
    for (const r of tabs["t" + b] || []) {
      const id = Number(r.tile_id); if (!isFinite(id)) continue;
      if (!tmap.has(id)) tmap.set(id, { id, band: b, fields: [], aus: "", p3: "", st: "none" });
      const t = tmap.get(id); t.aus = r.aus_src || ""; t.p3 = r["3d_pipeline"] || ""; t.st = tileStat(t.aus, t.p3);
    }
    for (const t of tmap.values()) { st.tiles++; if (t.st === "done") st.tdone++; else if (t.st === "failed") st.tfail++; else if (t.st === "running") st.trun++; else if (t.st === "waiting") st.twait++; }
  }
  return M;
}

/* ---------------- cross-match ---------------- */
/* For one position: every field (any status) of `band` whose nearest beam centre is within thr deg.
   Each entry lists all of that field's beams within thr (`beams`, nearest first); `beam`/`sep` are the nearest. */
function coverAt(S, band, v, thr) {
  const out = [], seps = new Float64Array(36);
  for (const f of S[band]) {
    const dc = v[0] * f.c[0] + v[1] * f.c[1] + v[2] * f.c[2];
    if (dc < Math.cos(Math.min(Math.PI, (f.rmax + thr + 0.05) * D2R))) continue;
    let best = 1e9;
    for (let k = 0; k < 36; k++) { const s = sepDeg(v, [f.bv[k * 3], f.bv[k * 3 + 1], f.bv[k * 3 + 2]]); seps[k] = s; if (s < best) best = s; }
    if (best > thr) continue;
    const order = Array.from(seps.keys()).filter(k => seps[k] <= thr).sort((a, b) => seps[a] - seps[b]);   // every beam within reach, nearest first
    out.push({ f, sep: best, beam: order[0] + 1, beams: order.map(k => ({ no: k + 1, sep: seps[k] })) });
  }
  // fields with data first, then those where the target sits inside the beam grid, then furthest along, then closest
  const key = c => (FSTAT[c.f.st].rank >= 2 ? 100 : 0) + (c.sep <= 0.65 ? 10 : 0) + FSTAT[c.f.st].rank;
  out.sort((a, b) => key(b) - key(a) || a.sep - b.sep);
  return out;
}
function matchTarget(S, M, t, cfg) {
  const v = rd2v(t.ra, t.dec), res = { tile: tileOf(t.ra, t.dec), band: {} };
  const minRank = FSTAT[cfg.minStatus].rank;
  for (const b of [1, 2]) {
    const cov = coverAt(S, b, v, cfg.thr), best = cov[0] || null;
    const tile = M ? M.tiles[b].get(res.tile) || null : null;
    res.band[b] = { cov, best, st: best ? best.f.st : "none", covered: !!best && FSTAT[best.f.st].rank >= minRank, edge: !!best && best.sep > 0.65, tile };
  }
  return res;
}
if (typeof module !== "undefined") module.exports = { parseTargets, buildFields, applyStatus, matchTarget, coverAt, tileOf, tileCentre, tileOutline, csvToObjects, parseCSV, rd2v, v2rd, sepDeg, eq2gal, gal2eq, fmtRA, fmtDec, jname, FSTAT, TSTAT, BANDS, TABS };
