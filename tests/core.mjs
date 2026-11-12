// Core checks: no browser, no network.   node tests/core.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url), root = fileURLToPath(new URL("..", import.meta.url));
const L = require("../src/lib.js");
const { BEAMDATA, SNAPSHOT } = new Function(readFileSync(root + "src/data.js", "utf8") + "; return {BEAMDATA, SNAPSHOT};")();

// --- HEALPix tiles (nside 32, ring)
const c = L.tileCentre(5184); assert.ok(Math.abs(c[0]) < 1e-9 && Math.abs(c[1] - 8.386) < 1e-3, "tile 5184 centre");
for (let p = 0; p < 12 * 32 * 32; p++) { const [ra, dec] = L.tileCentre(p); assert.equal(L.tileOf(ra, dec), p, "tile round trip " + p); }
for (const p of [0, 100, 5184, 9224, 12287]) { const cc = L.tileCentre(p), v = L.rd2v(cc[0], cc[1]); for (const o of L.tileOutline(p)) { const s = L.sepDeg(o, v); assert.ok(s > 0.7 && s < 1.7, "outline of tile " + p); } }

// --- target parsing
const P = L.parseTargets(readFileSync(root + "examples/named_example_positions.txt", "utf8"));
assert.equal(P.targets.length, 8); assert.equal(P.issues.length, 0);
assert.equal(P.targets[0].name, "M83"); assert.ok(Math.abs(P.targets[0].ra - 204.25383) < 1e-4 && Math.abs(P.targets[0].dec + 29.86575) < 1e-4);
const Q = L.parseTargets("name,ra,dec\nFoo bar,10.5,-20.25\nNGC 253 11.888 -25.288\n13 37 00.9 -29 51 57 M83x\n12h30m49.4s +12d23m28s M87\nAbell 3627\n400 95\n# comment\n1934-638 19:39:25.03 -63:42:45.6");
assert.deepEqual(Q.targets.map(t => t.name), ["Foo bar", "NGC 253", "M83x", "M87", "1934-638"]);
assert.ok(Math.abs(Q.targets[1].ra - 11.888) < 1e-9 && Math.abs(Q.targets[3].ra - 187.70583) < 1e-4);
assert.deepEqual(Q.names.map(n => n.name), ["Abell 3627"]); assert.equal(Q.issues.length, 1);
const G = L.parseTargets("l,b\n280.47,-32.89"); assert.ok(L.sepDeg(L.rd2v(G.targets[0].ra, G.targets[0].dec), L.rd2v(80.894, -69.756)) < 0.05, "Galactic input");

// --- survey model + matching against the bundled snapshot
const S = L.buildFields(BEAMDATA); assert.equal(S[1].length, 1014); assert.equal(S[2].length, 1104);
const obj = (cols, rows) => rows.map(r => Object.fromEntries(cols.map((k, i) => [k, r[i]])));
const tl = s => s.split("\n").map(l => { const p = l.split(";"); return { tile_id: p[0], aus_src: p[1] || "", "3d_pipeline": p[2] || "" }; });
const M = L.applyStatus(S, { f1: obj(SNAPSHOT.fcols, SNAPSHOT.fields[1]), f2: obj(SNAPSHOT.fcols, SNAPSHOT.fields[2]), obs: obj(SNAPSHOT.acols, SNAPSHOT.obs), t1: tl(SNAPSHOT.tiles[1]), t2: tl(SNAPSHOT.tiles[2]) });
assert.equal(M.unmatched.length, 0, "every beam-table field is in the tracking sheet");
for (const b of [1, 2]) { const x = M.stats[b]; assert.equal(x.planned + x.rejected + x.observed + x.validated + x.processed, x.n); }
// a position on a beam centre must return that beam at ~zero offset
const f = S[1][10], m = L.coverAt(S, 1, [f.bv[51], f.bv[52], f.bv[53]], 1.0).find(x => x.f === f);
assert.equal(m.beam, 18); assert.ok(m.sep < 1e-4);
if (SNAPSHOT.date === "2026-11-12") { // regression values, cross-checked with astropy against covered_by_POSSUM.py logic
  const r = L.matchTarget(S, M, { ra: 294.854292, dec: -63.712667 }, { thr: 1.0, minStatus: "observed" });   // PKS 1934-638
  assert.equal(r.band[1].best.f.full, "EMU_1921-64"); assert.equal(r.band[1].best.f.info.sbid, "71466"); assert.equal(r.band[1].best.beam, 30);
  assert.ok(Math.abs(r.band[1].best.sep - 0.0544) < 2e-3); assert.equal(r.band[2].st, "none"); assert.equal(r.tile, 11731);
  const n = L.matchTarget(S, M, { ra: 202.784535, dec: 30.509156 }, { thr: 1.0, minStatus: "observed" });    // 3C 286: north of the survey
  assert.equal(n.band[1].st, "none"); assert.equal(n.band[2].st, "none");
}
console.log("core tests passed");
