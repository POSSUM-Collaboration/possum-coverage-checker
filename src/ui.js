"use strict";
/* ==================================================================
   POSSUM Coverage Checker — UI: live status loading, sky map,
   results table, detail drawer, exports
   ================================================================== */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const day = s => (s || "").slice(0, 10);
const store = {
  get(k, d) { try { const v = localStorage.getItem("pcc." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("pcc." + k, JSON.stringify(v)); } catch (e) { } },
};
const EXAMPLE = `RA DEC Name
13:37:00.92 -29:51:56.7 M83
19:39:25.03 -63:42:45.6 1934-638
00:52:37.99 -72:48:01.1 SMC
05:23:34.61 -69:45:22.0 LMC
161.259290 -59.699940 Carina
128.287000 -45.190100 Vela-X
202.784535 30.509156 3C286
07:21:48.5450 -67:07:14.804 J072148-670714
05:23:34 -45:17:50
20:41:25 -32:26:34
201.761 6.806
14.086 -27.154`;

const VERSION = "1.1.0", REPO_URL = "https://github.com/POSSUM-Collaboration/possum-coverage-checker";
const ST = {
  S: null, M: null, src: { kind: "loading" }, targets: [], results: [], sel: -1, filter: "all", q: "", sort: { k: "i", d: 1 },
  cfg: Object.assign({ thr: 1.0, minStatus: "observed" }, store.get("cfg", {})),
  view: { proj: "moll", frame: "eq", lon0: 0, lat0: 0, zoom: 1, panX: 0, panY: 0 },
  map: Object.assign({ band: 1, mode: "fields", grid: true, plane: true, labels: true, beams: true, proj: "moll", frame: "eq" }, store.get("map", {})),
  miniBand: 1, tpos: [], runId: 0, issues: [], resolved: {},
};
ST.view.proj = ST.map.proj; ST.view.frame = ST.map.frame;

/* ---------------- small UI helpers ---------------- */
function toast(msg, ms = 2400) { const t = $("toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toast._t); toast._t = setTimeout(() => t.style.display = "none", ms); }
function setProgress(msg, frac) { const p = $("progress"); if (msg == null) { p.style.display = "none"; return; } p.style.display = "block"; $("progresstext").textContent = msg; $("progressbar").style.width = Math.round((frac || 0) * 100) + "%"; }
function openModal(title, body, foot) { $("modal").innerHTML = `<div class="hd">${title}</div><div class="bd">${body}</div><div class="ft">${foot || ""}<button id="mclose" class="primary">Close</button></div>`; $("modalback").style.display = "flex"; $("mclose").onclick = closeModal; $("mclose").focus(); }
function closeModal() { $("modalback").style.display = "none"; }
function download(name, data, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: type || "text/plain" })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function chip(st, edge, text) { const s = FSTAT[st]; return `<span class="chip${edge ? " edge" : ""}" style="color:${s.col};background:${s.col}1f;border-color:${s.col}55"><i style="background:${s.col}"></i>${esc(text || s.short)}</span>`; }
function tchip(st) { const s = TSTAT[st]; return `<span class="chip" style="color:${s.col};background:${s.col}1f;border-color:${s.col}55"><i style="background:${s.col}"></i>${s.label}</span>`; }
function stamp() { const d = new Date(); return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); }

/* ==================================================================
   Live survey status
   ================================================================== */
async function fetchText(url, ms = 20000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal, cache: "no-store" }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.text(); }
  finally { clearTimeout(t); }
}
let jsonpN = 0;
function jsonp(url, cbParam, ms = 20000) {
  return new Promise((res, rej) => {
    const fn = "__pcc_cb" + (++jsonpN), s = document.createElement("script");
    const done = (f, v) => { clearTimeout(to); delete window[fn]; s.remove(); f(v); };
    const to = setTimeout(() => done(rej, new Error("timeout")), ms);
    window[fn] = d => done(res, d); s.onerror = () => done(rej, new Error("network error"));
    s.src = url + cbParam + fn; document.head.appendChild(s);
  });
}
async function loadTab(key) {
  const T = TABS[key], errs = [];
  const ways = [
    ["export", async () => csvToObjects(await fetchText(`${SHEET_URL}export?format=csv&gid=${T.gid}`), T.need)],
    ["gviz", async () => csvToObjects(await fetchText(`${SHEET_URL}gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(T.name)}`), T.need)],
    ["jsonp", async () => {
      const d = await jsonp(`${SHEET_URL}gviz/tq?headers=1&sheet=${encodeURIComponent(T.name)}&tqx=out:json;responseHandler:`, "");
      if (!d || d.status !== "ok") throw new Error("sheet query failed");
      const cols = d.table.cols.map(c => (c.label || "").trim()); for (const n of T.need) if (!cols.includes(n)) throw new Error(`missing “${n}”`);
      return d.table.rows.map(r => { const o = {}; cols.forEach((c, i) => { const cell = r.c[i]; if (c) o[c] = cell ? String(cell.f != null ? cell.f : cell.v != null ? cell.v : "").trim() : ""; }); return o; });
    }],
  ];
  for (const [how, fn] of ways) { try { return { rows: await fn(), how }; } catch (e) { errs.push(`${how}: ${e.message || e}`); } }
  throw new Error(errs.join(" · "));
}
function snapshotTabs() {
  const obj = (cols, rows) => rows.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  const tl = s => s.split("\n").map(l => { const p = l.split(";"); return { tile_id: p[0], aus_src: p[1] || "", "3d_pipeline": p[2] || "" }; });
  return { f1: obj(SNAPSHOT.fcols, SNAPSHOT.fields[1]), f2: obj(SNAPSHOT.fcols, SNAPSHOT.fields[2]), obs: obj(SNAPSHOT.acols, SNAPSHOT.obs), t1: tl(SNAPSHOT.tiles[1]), t2: tl(SNAPSHOT.tiles[2]) };
}
async function loadLive(manual) {
  ST.src = Object.assign({}, ST.src, { busy: true }); renderLive();
  const keys = Object.keys(TABS), snap = snapshotTabs(), tabs = {}, failed = [], errs = [];
  const res = await Promise.allSettled(keys.map(loadTab));
  res.forEach((r, i) => { if (r.status === "fulfilled") tabs[keys[i]] = r.value.rows; else { failed.push(keys[i]); errs.push(`${TABS[keys[i]].name} — ${r.reason.message}`); tabs[keys[i]] = snap[keys[i]]; } });
  const coreOK = !failed.includes("f1") && !failed.includes("f2");
  if (coreOK) {
    ST.M = applyStatus(ST.S, tabs);
    ST.src = { kind: failed.length ? "partial" : "live", at: new Date(), failed, errs };
  } else {
    ST.M = applyStatus(ST.S, snap);
    ST.src = { kind: "snapshot", at: null, failed, errs };
  }
  renderLive(); rematch();
  if (manual) toast(coreOK ? "Survey status refreshed" : "Could not reach the tracking sheet — still on the built-in snapshot");
}
function renderLive() {
  const s = ST.src, M = ST.M, lat = M && M.latest;
  const latest = lat ? `Latest observation: SBID <b style="color:var(--ink)">${esc(lat.sbid)}</b> (${esc(lat.name)}, ${day(lat.obs_start)})` : "";
  let cls = "busy", head = "Fetching the survey tracking sheet…", pill = "Loading status…", banner = "";
  if (s.kind === "live") { cls = "ok"; head = `<b>Live</b> — read from the POSSUM tracking sheet at ${s.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, ${s.at.toLocaleDateString()}`; pill = `Live status · ${s.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; }
  else if (s.kind === "partial") { cls = "stale"; head = `<b>Partly live</b> — fields are current, but ${s.failed.map(k => TABS[k].name).join(", ")} fell back to the ${SNAPSHOT.date} snapshot`; pill = "Partly live"; banner = `Some tabs of the tracking sheet could not be read (${esc(s.failed.map(k => TABS[k].name).join(", "))}); those use the built-in ${SNAPSHOT.date} snapshot.`; }
  else if (s.kind === "snapshot") { cls = "stale"; head = `<b>Offline snapshot</b> of ${SNAPSHOT.date} — the live tracking sheet could not be reached`; pill = `Stale · snapshot ${SNAPSHOT.date}`; banner = `<b>Not live.</b> The tracking sheet could not be read, so results use a built-in snapshot from ${SNAPSHOT.date} and may be out of date.`; }
  if (s.busy) cls = "busy";
  $("livedot").className = "dot " + cls;
  $("livetext").innerHTML = head + (latest ? `<small>${latest}</small>` : "") + (s.errs && s.errs.length ? `<small title="${esc(s.errs.join("\n"))}" style="cursor:help">Why? hover for details</small>` : "");
  $("pill-live").innerHTML = `<span class="dot ${cls}"></span><span>${s.busy ? "Refreshing…" : pill}</span>`;
  const b = $("banner");
  if (banner && !s.busy && !ST.bannerOff) { b.innerHTML = `<span>${banner}</span><button class="mini" id="bretry">Retry</button><button class="mini" id="bclose">Dismiss</button>`; b.style.display = "flex"; $("bretry").onclick = () => loadLive(true); $("bclose").onclick = () => { ST.bannerOff = true; b.style.display = "none"; }; }
  else b.style.display = "none";
  if (!M) return;
  let h = "";
  for (const bnd of [1, 2]) {
    const x = M.stats[bnd], obs = x.observed + x.validated + x.processed, seg = k => `<i style="width:${100 * x[k] / x.n}%;background:${FSTAT[k].col}" title="${FSTAT[k].label}: ${x[k]}"></i>`;
    h += `<div class="prog"><div class="lab"><span>${BANDS[bnd].label} fields observed</span><b>${obs} / ${x.n} · ${(100 * obs / x.n).toFixed(0)}%</b></div><div class="stack">${seg("processed")}${seg("validated")}${seg("observed")}${seg("rejected")}</div></div>`;
    if (x.tiles) h += `<div class="kv"><span>${BANDS[bnd].label} tiles with finished cubes</span><b>${x.tdone} / ${x.tiles}</b></div>`;
  }
  $("surveystats").innerHTML = h; renderLegend();
}

/* ==================================================================
   Targets: parse → resolve names → match
   ================================================================== */
async function resolveName(name) {
  const key = name.trim().toLowerCase(), cache = ST.resolved;
  if (cache[key]) return cache[key];
  const q = encodeURIComponent(name.trim()); let out = null;
  for (const host of ["https://cds.unistra.fr", "https://cdsweb.u-strasbg.fr"]) {
    try {
      const t = await fetchText(`${host}/cgi-bin/nph-sesame/-oI/SNA?${q}`, 12000), m = /%J\s+([\d.+-]+)\s+([\d.+-]+)/.exec(t);
      if (m) { out = { ra: +m[1], dec: +m[2] }; break; }
      if (/#!.*Nothing found/i.test(t) || /^#!/m.test(t)) { out = { notfound: true }; break; }
    } catch (e) { }
  }
  if (!out) {
    try {
      const d = await jsonp(`https://cds.unistra.fr/cgi-bin/nph-sesame.jsonp?object=${q}&callback=`, "", 12000), r = d && d.Target && d.Target.Resolver;
      if (r && r.jradeg != null) out = { ra: +r.jradeg, dec: +r.jdedeg }; else out = { notfound: true };
    } catch (e) { out = { neterr: true }; }
  }
  if (!out.neterr) { cache[key] = out; store.set("names", cache); }
  return out;
}
async function runCheck() {
  const id = ++ST.runId, text = $("text").value; store.set("text", text);
  const p = parseTargets(text), targets = p.targets.slice(), issues = p.issues.slice();
  if (p.names.length) {
    let done = 0; setProgress(`Resolving ${p.names.length} object name${p.names.length > 1 ? "s" : ""} with CDS Sesame…`, 0);
    const q = p.names.slice(), work = async () => {
      while (q.length) {
        const n = q.shift(), r = await resolveName(n.name); if (id !== ST.runId) return;
        if (r.ra != null) { const t = mkTarget(r.ra, r.dec, n.name, { resolved: true }); t.line = n.line; targets.push(t); }
        else issues.push({ line: n.line, text: n.name, msg: r.neterr ? "name resolver unreachable (offline?) — give coordinates instead" : "object name not found by SIMBAD / NED" });
        setProgress(`Resolving object names… ${++done}/${p.names.length}`, done / p.names.length);
      }
    };
    await Promise.all([work(), work(), work(), work()]); if (id !== ST.runId) return;
  }
  targets.sort((a, b) => a.line - b.line); issues.sort((a, b) => a.line - b.line);
  ST.targets = targets; ST.issues = issues; ST.sel = -1;
  await rematch(true);
  const pm = $("parsemsg");
  pm.innerHTML = (targets.length ? `Read <b style="color:var(--ink)">${targets.length}</b> target${targets.length > 1 ? "s" : ""}.` : text.trim() ? `<span class="bad">No targets could be read.</span>` : "") +
    (issues.length ? `<details ${issues.length <= 4 ? "open" : ""}><summary>${issues.length} line${issues.length > 1 ? "s" : ""} skipped</summary><ul>${issues.slice(0, 60).map(i => `<li>line ${i.line}: “${esc(i.text.slice(0, 40))}” — ${esc(i.msg)}</li>`).join("")}</ul></details>` : "");
}
async function rematch(fresh) {
  const id = ST.runId, T = ST.targets, out = new Array(T.length);
  if (!ST.M) return;
  for (let i = 0; i < T.length; i++) {
    out[i] = matchTarget(ST.S, ST.M, T[i], ST.cfg);
    if (i % 400 === 399) { setProgress(`Matching targets… ${i + 1}/${T.length}`, i / T.length); await new Promise(r => setTimeout(r)); if (id !== ST.runId) return; }
  }
  setProgress(null);
  // what changed since the last check of the same positions (only tracked against live status)
  const hist = store.get("hist", {}), live = ST.src.kind === "live" || ST.src.kind === "partial";
  out.forEach((r, i) => {
    const k = T[i].ra.toFixed(3) + "," + T[i].dec.toFixed(3) + "," + ST.cfg.thr, prev = hist[k];
    r.changed = null;
    if (!fresh) r.changed = ST.results[i] ? ST.results[i].changed : null;
    else if (prev) { const ch = [1, 2].filter(b => FSTAT[r.band[b].st].rank > FSTAT[prev["b" + b] || "none"].rank).map(b => `${BANDS[b].label}: ${FSTAT[prev["b" + b] || "none"].label} → ${FSTAT[r.band[b].st].label}`); if (ch.length) r.changed = `${ch.join("; ")} (since ${prev.t})`; }
    if (live && fresh) hist[k] = { b1: r.band[1].st, b2: r.band[2].st, t: new Date().toISOString().slice(0, 10) };
  });
  if (live && fresh && T.length) { const ks = Object.keys(hist); if (ks.length > 20000) for (const k of ks.slice(0, ks.length - 20000)) delete hist[k]; store.set("hist", hist); }
  ST.results = out;
  if (ST.sel >= T.length) ST.sel = -1;
  renderResults(); renderDetail(); draw();
}

/* ==================================================================
   Sky map
   ================================================================== */
function projector(view, w, h) {
  const gal = view.frame === "gal", toD = v => gal ? mul(E2G, v) : v, fromD = d => gal ? mulT(E2G, d) : d;
  if (view.proj === "globe") {
    const lo = view.lon0 * D2R, la = view.lat0 * D2R;
    const c = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)], e = [-Math.sin(lo), Math.cos(lo), 0], n = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
    const R = 0.46 * Math.min(w, h) * view.zoom, cx = w / 2, cy = h / 2;
    return {
      globe: true, R, cx, cy, ppd: R * D2R, w, h,
      fwd(v) { const d = toD(v); return [cx - R * (d[0] * e[0] + d[1] * e[1]), cy - R * (d[0] * n[0] + d[1] * n[1] + d[2] * n[2]), d[0] * c[0] + d[1] * c[1] + d[2] * c[2]]; },
      inv(x, y) { const u = -(x - cx) / R, t = -(y - cy) / R, r2 = u * u + t * t; if (r2 > 1) return null; const z = Math.sqrt(1 - r2); return fromD([c[0] * z + e[0] * u + n[0] * t, c[1] * z + e[1] * u + n[1] * t, c[2] * z + n[2] * t]); },
      outline(ctx) { ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); },
    };
  }
  const S = Math.min(w / (4 * Math.SQRT2) / 1.03, h / (2 * Math.SQRT2) / 1.07) * view.zoom, cx = w / 2 + view.panX, cy = h / 2 + view.panY, l0 = view.lon0 * D2R, kx = 2 * Math.SQRT2 / Math.PI;
  const theta = lat => { if (Math.abs(lat) > 1.5706) return lat; let t = lat; const k = Math.PI * Math.sin(lat); for (let i = 0; i < 8; i++) { const d = (2 * t + Math.sin(2 * t) - k) / (2 + 2 * Math.cos(2 * t)); t -= d; if (Math.abs(d) < 1e-7) break; } return t; };
  const P = {
    globe: false, S, cx, cy, ppd: S * kx * D2R, w, h,
    ll(v) { const d = toD(v); let lam = Math.atan2(d[1], d[0]) - l0; lam -= TAU * Math.round(lam / TAU); return [lam, Math.asin(Math.max(-1, Math.min(1, d[2])))]; },
    xy(lam, lat) { const t = theta(lat); return [cx - S * kx * lam * Math.cos(t), cy - S * Math.SQRT2 * Math.sin(t)]; },
    fwd(v) { const [lam, lat] = P.ll(v), p = P.xy(lam, lat); return [p[0], p[1], 1]; },
    inv(x, y) { const X = -(x - cx) / S, Y = -(y - cy) / S; if (X * X / 8 + Y * Y / 2 > 1) return null; const t = Math.asin(Y / Math.SQRT2), lat = Math.asin(Math.max(-1, Math.min(1, (2 * t + Math.sin(2 * t)) / Math.PI))), lam = Math.PI * X / (2 * Math.SQRT2 * Math.cos(t)) + l0; return fromD([Math.cos(lat) * Math.cos(lam), Math.cos(lat) * Math.sin(lam), Math.sin(lat)]); },
    outline(ctx) { ctx.beginPath(); ctx.ellipse(cx, cy, S * 2 * Math.SQRT2, S * Math.SQRT2, 0, 0, TAU); },
  };
  return P;
}
/* add a closed polygon (array of unit vectors) to the current path; returns false if culled */
function polyPath(ctx, P, vs) {
  if (P.globe) {
    let vis = false; const pts = vs.map(v => { const p = P.fwd(v); if (p[2] > 0) vis = true; return p; });
    if (!vis) return false; ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); return true;
  }
  const ll = vs.map(P.ll), l0 = ll[0][0]; let mn = l0, mx = l0;
  for (const q of ll) { q[0] = l0 + (q[0] - l0) - TAU * Math.round((q[0] - l0) / TAU); if (q[0] < mn) mn = q[0]; if (q[0] > mx) mx = q[0]; }
  const put = off => { ll.forEach((q, i) => { const p = P.xy(q[0] + off, q[1]); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.closePath(); };
  put(0); if (mx > Math.PI) put(-TAU); if (mn < -Math.PI) put(TAU); return true;
}
/* stroke an open line of display-frame (lon,lat) samples given as a function */
function linePath(ctx, P, vs) {
  let pen = false, prev = null;
  for (const v of vs) {
    if (P.globe) { const p = P.fwd(v); if (p[2] <= 0) { pen = false; continue; } pen ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); pen = true; }
    else { const [lam, lat] = P.ll(v), p = P.xy(lam, lat); if (pen && Math.abs(lam - prev) > Math.PI) pen = false; pen ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); pen = true; prev = lam; }
  }
}
function niceStep(ppd) { for (const s of [1, 2, 5, 10, 15, 30]) if (s * ppd >= 62) return s; return 30; }
function targetColour(r, band) { const b = r.band[band]; return b.st === "none" ? "#c3c9d6" : FSTAT[b.st].col; }

function drawSky(canvas, view, o) {
  const dpr = o.scale || window.devicePixelRatio || 1, w = o.w || canvas.clientWidth, h = o.h || canvas.clientHeight;
  if (!w || !h) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0b0e14"; ctx.fillRect(0, 0, w, h);
  const P = projector(view, w, h), gal = view.frame === "gal", fromD = d => gal ? mulT(E2G, d) : d, band = o.band;
  const cv = P.inv(w / 2, h / 2), rad = Math.hypot(w, h) / 2 / P.ppd, near = (c, pad) => !cv || rad > 80 || sepDeg(c, cv) < rad + pad;
  P.outline(ctx); ctx.fillStyle = "#0e121b"; ctx.fill();
  ctx.save(); P.outline(ctx); ctx.clip();

  /* graticule */
  const step = niceStep(P.ppd), dl = d2v => fromD(d2v);
  if (o.grid) {
    ctx.strokeStyle = "#ffffff12"; ctx.lineWidth = 1; ctx.beginPath();
    const wide = !cv || rad > 60, [clon, clat] = cv ? v2rd(gal ? mul(E2G, cv) : cv) : [0, 0];
    const la0 = wide ? -90 : Math.max(-90, Math.floor((clat - rad) / step) * step), la1 = wide ? 90 : Math.min(90, Math.ceil((clat + rad) / step) * step);
    const span = wide || Math.abs(clat) + rad > 80 ? 180 : Math.min(180, rad / Math.cos(Math.min(89, Math.abs(clat) + rad) * D2R));
    const lo0 = span >= 180 ? 0 : Math.floor((clon - span) / step) * step, lo1 = span >= 180 ? 360 - step : Math.ceil((clon + span) / step) * step;
    const ds = Math.max(0.25, step / 10);
    for (let lo = lo0; lo <= lo1; lo += step) { const a = []; for (let la = la0; la <= la1 + 1e-9; la += ds) a.push(dl(rd2v(lo, Math.max(-90, Math.min(90, la))))); linePath(ctx, P, a); }
    for (let la = Math.max(-90 + step, la0); la <= Math.min(90 - step, la1); la += step) { const a = []; for (let lo = lo0; lo <= (span >= 180 ? 360 : lo1) + 1e-9; lo += ds * 2) a.push(dl(rd2v(lo, la))); linePath(ctx, P, a); }
    ctx.stroke();
  }
  if (o.plane) { // Galactic plane in equatorial view, celestial equator in Galactic view
    ctx.strokeStyle = "#ffffff30"; ctx.setLineDash([5, 5]); ctx.beginPath(); const a = [];
    for (let l = 0; l <= 360; l += 1) a.push(gal ? rd2v(l, 0) : mulT(E2G, rd2v(l, 0)));
    linePath(ctx, P, a); ctx.stroke(); ctx.setLineDash([]);
  }

  /* survey layer */
  const hl = new Set(o.hl || []);
  if (o.mode === "tiles" && ST.M) {
    const groups = {};
    for (const t of ST.M.tiles[band].values()) {
      if (!t.out) { t.out = tileOutline(t.id, P.ppd > 12 ? 4 : 2); const c = tileCentre(t.id); t.c = rd2v(c[0], c[1]); }
      if (!near(t.c, 3)) continue; (groups[t.st] = groups[t.st] || []).push(t);
    }
    for (const k of ["none", "ingest", "running", "waiting", "failed", "done"]) {
      if (!groups[k]) continue; ctx.beginPath(); for (const t of groups[k]) polyPath(ctx, P, t.out);
      if (k !== "none") { ctx.fillStyle = TSTAT[k].col + "73"; ctx.fill(); }
      ctx.strokeStyle = k === "none" ? "#ffffff17" : TSTAT[k].col + "aa"; ctx.lineWidth = k === "none" ? 0.6 : 0.8; ctx.stroke();
    }
    if (P.ppd > 26) { ctx.font = "10px ui-monospace,Menlo,monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#9aa3b5"; for (const k in groups) for (const t of groups[k]) { const p = P.fwd(t.c); if (p[2] > 0) ctx.fillText(t.id, p[0], p[1] + 3); } }
  } else {
    const order = ["planned", "rejected", "observed", "validated", "processed"], groups = {};
    for (const f of ST.S[band]) { if (!near(f.c, 6)) continue; (groups[f.st] = groups[f.st] || []).push(f); }
    for (const k of order) {
      if (!groups[k]) continue; ctx.beginPath(); for (const f of groups[k]) polyPath(ctx, P, f.hull);
      const col = FSTAT[k].col; ctx.fillStyle = col + (k === "planned" ? "14" : o.mini ? "26" : "50"); ctx.fill();
      ctx.strokeStyle = col + (k === "planned" ? "55" : "c8"); ctx.lineWidth = k === "planned" ? 0.6 : 0.9; ctx.stroke();
    }
    if (o.beams && P.ppd >= 20) {
      const r = 0.45 * P.ppd; ctx.font = (P.ppd > 70 ? 11 : 9.5) + "px ui-monospace,Menlo,monospace"; ctx.textAlign = "center";
      for (const k of order) for (const f of groups[k] || []) {
        if (!near(f.c, 4)) continue; const col = FSTAT[k].col, isHl = hl.has(f);
        ctx.strokeStyle = col + (isHl ? "ee" : hl.size ? "48" : "70"); ctx.lineWidth = isHl ? 1.3 : 0.8; ctx.beginPath();
        const pts = [];
        for (let b = 0; b < 36; b++) { const p = P.fwd([f.bv[b * 3], f.bv[b * 3 + 1], f.bv[b * 3 + 2]]); if (p[2] <= 0) continue; pts.push([p, b]); ctx.moveTo(p[0] + r, p[1]); ctx.arc(p[0], p[1], r, 0, TAU); }
        ctx.stroke();
        const nb = o.nearBeams && o.nearBeams.get(f);
        if (nb) { ctx.beginPath(); for (const no of nb) { const p = P.fwd([f.bv[(no - 1) * 3], f.bv[(no - 1) * 3 + 1], f.bv[(no - 1) * 3 + 2]]); if (p[2] > 0) { ctx.moveTo(p[0] + r, p[1]); ctx.arc(p[0], p[1], r, 0, TAU); } } ctx.fillStyle = col + "2b"; ctx.fill(); ctx.strokeStyle = col + "ee"; ctx.lineWidth = 1.3; ctx.stroke(); }
        if (o.hlBeam && o.hlBeam.f === f) { const p = P.fwd([f.bv[(o.hlBeam.no - 1) * 3], f.bv[(o.hlBeam.no - 1) * 3 + 1], f.bv[(o.hlBeam.no - 1) * 3 + 2]]); ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fillStyle = col + "40"; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.stroke(); }
        if (P.ppd >= (isHl || o.mini ? 36 : 58)) { ctx.fillStyle = isHl ? "#e8ebf2" : "#7c869b"; for (const [p, b] of pts) ctx.fillText(b + 1, p[0], p[1] + 3.5); }
      }
    }
    if (P.ppd >= 9 && !o.mini) { ctx.font = "10.5px -apple-system,Segoe UI,sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#9aa3b5cc"; for (const k of order) for (const f of groups[k] || []) { const tp = rd2v(f.ra, Math.min(89.9, f.dec + f.rmax + 0.75)); const p = P.fwd(P.ppd >= 20 ? tp : f.c); if (p[2] > 0 && p[0] > -40 && p[0] < w + 40 && p[1] > 0 && p[1] < h) { ctx.strokeStyle = "#0b0e14e0"; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.strokeText(f.full, p[0], p[1] + 3); ctx.fillText(f.full, p[0], p[1] + 3); } } }
  }
  ctx.restore();
  P.outline(ctx); ctx.strokeStyle = "#2c3446"; ctx.lineWidth = 1; ctx.stroke();

  /* graticule labels */
  if (o.grid && !o.mini && P.ppd < 20) {
    ctx.font = "10px ui-monospace,Menlo,monospace"; ctx.fillStyle = "#6b7488"; ctx.textAlign = "center";
    const lonLab = lo => gal ? lo + "°" : (lo / 15 === Math.round(lo / 15) ? (lo / 15) + "h" : lo + "°");
    if (!P.globe && view.zoom < 1.6) {
      for (let lo = 0; lo < 360; lo += 30) { const p = P.fwd(fromD(rd2v(lo, 0))); if (Math.abs(p[0] - P.cx) < P.S * 2.7) ctx.fillText(lonLab(lo), p[0], p[1] - 4); }
      ctx.textAlign = "right"; for (const la of [-60, -30, 30, 60]) { const p = P.xy(Math.PI, la * D2R); ctx.fillText((la > 0 ? "+" : "") + la + "°", p[0] - 5, p[1] + 3); }
    } else if (cv) {
      const [clon, clat] = v2rd(gal ? mul(E2G, cv) : cv);
      for (let lo = Math.floor((clon - rad * 2) / step) * step; lo <= clon + rad * 2; lo += step) { const p = P.fwd(fromD(rd2v(lo, Math.round(clat / step) * step))); if (p[2] > 0 && p[0] > 20 && p[0] < w - 20 && p[1] > 60 && p[1] < h - 30) ctx.fillText(lonLab(((lo % 360) + 360) % 360), p[0], p[1] - 4); }
      ctx.textAlign = "left"; for (let la = Math.floor((clat - rad) / step) * step; la <= clat + rad; la += step) { if (Math.abs(la) > 89) continue; const p = P.fwd(fromD(rd2v(Math.round(clon / step) * step, la))); if (p[2] > 0 && p[0] > 20 && p[0] < w - 40 && p[1] > 60 && p[1] < h - 30) ctx.fillText((la > 0 ? "+" : "") + la + "°", p[0] + 4, p[1] + 12); }
    }
  }

  /* targets */
  const tpos = [], T = ST.targets, R = ST.results, list = o.only != null ? [o.only] : T.map((_, i) => i);
  for (const i of list) { if (!R[i]) continue; const p = P.fwd(rd2v(T[i].ra, T[i].dec)); if (p[2] <= 0 || p[0] < -20 || p[0] > w + 20 || p[1] < -20 || p[1] > h + 20) continue; tpos.push({ i, x: p[0], y: p[1] }); }
  const small = tpos.length > 600;
  for (const q of tpos) {
    if (q.i === ST.sel && !o.mini) continue; const col = targetColour(R[q.i], band), cov = R[q.i].band[band].covered, r = small ? 2.6 : 4.6;
    ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, TAU);
    if (cov) { ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = "#0b0e14"; ctx.lineWidth = 1.4; ctx.stroke(); if (!small) { ctx.beginPath(); ctx.arc(q.x, q.y, r + 2.4, 0, TAU); ctx.strokeStyle = "#ffffffd0"; ctx.lineWidth = 1.1; ctx.stroke(); } }
    else { ctx.strokeStyle = "#0b0e14"; ctx.lineWidth = 3.4; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke(); }
  }
  const selq = tpos.find(q => q.i === ST.sel) || (o.mini ? tpos[0] : null);
  if (selq) {
    const col = o.mini ? "#ffffff" : targetColour(R[selq.i], band), x = selq.x, y = selq.y, a = o.mini ? 7 : 9, g = o.mini ? 16 : 17;
    ctx.strokeStyle = "#0b0e14"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, a, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(x, y, a, 0, TAU);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * a, y + dy * a); ctx.lineTo(x + dx * g, y + dy * g); } ctx.stroke();
    if (!o.mini) { ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fillStyle = col; ctx.fill(); }
  }
  if (o.labels && !o.mini && (tpos.length <= 60 || P.ppd > 14)) {
    ctx.font = "550 11px -apple-system,Segoe UI,sans-serif"; ctx.textAlign = "left"; const used = [];
    const sorted = tpos.slice().sort((a, b) => (b.i === ST.sel) - (a.i === ST.sel));
    for (const q of sorted) {
      const s = T[q.i].name, tw = ctx.measureText(s).width, bx = q.x + 10, by = q.y - 9;
      if (q.i !== ST.sel && used.some(u => bx < u[0] + u[2] && bx + tw > u[0] && by < u[1] + 13 && by + 13 > u[1])) continue; used.push([bx, by, tw]);
      ctx.strokeStyle = "#0b0e14e6"; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.strokeText(s, bx, by + 10); ctx.fillStyle = q.i === ST.sel ? "#fff" : "#e3e7f0"; ctx.fillText(s, bx, by + 10);
    }
  }
  if (o.mini) { // scale bar + compass
    const L = P.ppd; ctx.strokeStyle = "#9aa3b5"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(12, h - 12); ctx.lineTo(12 + L, h - 12); ctx.stroke();
    ctx.fillStyle = "#9aa3b5"; ctx.font = "10px ui-monospace,Menlo,monospace"; ctx.textAlign = "left"; ctx.fillText("1°", 12 + L + 5, h - 9); ctx.fillStyle = "#0b0e14d9"; ctx.fillRect(w - 76, 4, 72, 18); ctx.fillRect(6, h - 24, L + 34, 20); ctx.strokeStyle = "#9aa3b5"; ctx.beginPath(); ctx.moveTo(12, h - 12); ctx.lineTo(12 + L, h - 12); ctx.stroke(); ctx.fillStyle = "#9aa3b5"; ctx.textAlign = "left"; ctx.fillText("1°", 12 + L + 5, h - 9); ctx.textAlign = "right"; ctx.fillText("N ↑   E ←", w - 10, 16);
  }
  return { P, tpos };
}
function draw() {
  if (!ST.S) return; cancelAnimationFrame(draw._r);
  draw._r = requestAnimationFrame(() => {
    const sel = ST.results[ST.sel], hl = sel ? sel.band[ST.map.band].cov.map(c => c.f) : [];
    const out = drawSky($("sky"), ST.view, { band: ST.map.band, mode: ST.map.mode, grid: ST.map.grid, plane: ST.map.plane, labels: ST.map.labels, beams: ST.map.beams, hl, nearBeams: sel ? new Map(sel.band[ST.map.band].cov.map(x => [x.f, x.beams.map(m => m.no)])) : null });
    if (out) { ST.P = out.P; ST.tpos = out.tpos; }
    const nC = ST.results.filter(r => r.band[ST.map.band].covered).length;
    $("pill-view").innerHTML = ST.targets.length ? `<b>${ST.targets.length}</b> target${ST.targets.length > 1 ? "s" : ""} · <b>${nC}</b> covered in ${BANDS[ST.map.band].label}` : `${BANDS[ST.map.band].label} · ${BANDS[ST.map.band].freq}`;
  });
}
function renderLegend() {
  if (!ST.M) return; const b = ST.map.band, x = ST.M.stats[b]; let h;
  if (ST.map.mode === "tiles") {
    const cnt = { none: 0, ingest: 0, running: 0, waiting: 0, failed: 0, done: 0 }; for (const t of ST.M.tiles[b].values()) cnt[t.st]++;
    h = `<div class="t">${BANDS[b].label} tiles · 3D pipeline</div>` + ["done", "waiting", "running", "failed", "ingest", "none"].map(k => `<div class="li"><span class="sw" style="background:${TSTAT[k].col}${k === "none" ? "40" : ""}"></span>${TSTAT[k].label}<b>${cnt[k]}</b></div>`).join("");
  } else h = `<div class="t">${BANDS[b].label} fields · ${BANDS[b].freq}</div>` + ["processed", "validated", "observed", "rejected", "planned"].map(k => `<div class="li"><span class="sw" style="background:${FSTAT[k].col}${k === "planned" ? "55" : ""}"></span>${FSTAT[k].label}<b>${x[k]}</b></div>`).join("");
  $("legend").innerHTML = h;
}
function homeView() { ST.view.proj = ST.map.proj; syncControls(); Object.assign(ST.view, { lon0: ST.view.proj === "globe" ? 60 : 0, lat0: ST.view.proj === "globe" ? -45 : 0, zoom: 1, panX: 0, panY: 0 }); draw(); }
function flyTo(ra, dec, ppd) {
  const c = $("sky"), w = c.clientWidth, h = c.clientHeight, V = ST.view, [lon, lat] = V.frame === "gal" ? eq2gal(ra, dec) : [ra, dec];
  if (ppd && V.proj === "moll") { V.proj = "globe"; V.panX = V.panY = 0; syncControls(); }   // close-ups use the globe: no all-sky shear
  if (V.proj === "globe") { V.lon0 = lon; V.lat0 = lat; if (ppd) V.zoom = ppd / (D2R * 0.46 * Math.min(w, h)); }
  else {
    if (ppd) V.zoom = ppd / (Math.min(w / (4 * Math.SQRT2) / 1.03, h / (2 * Math.SQRT2) / 1.07) * 2 * Math.SQRT2 / Math.PI * D2R);
    V.panX = V.panY = 0; const p = projector(V, w, h).fwd(rd2v(ra, dec)); V.panX = w / 2 - p[0]; V.panY = h / 2 - p[1];
  }
  draw();
}
function zoomBy(f, mx, my) {
  const c = $("sky"), w = c.clientWidth, h = c.clientHeight, V = ST.view; if (mx == null) { mx = w / 2; my = h / 2; }
  const before = V.proj === "moll" && ST.P ? ST.P.inv(mx, my) : null;
  V.zoom = Math.max(0.5, Math.min(600, V.zoom * f));
  if (V.proj === "moll" && V.zoom > 3.2 && ST.P) { // hand over to the globe for close-ups
    const cv = ST.P.inv(mx, my) || ST.P.inv(w / 2, h / 2); if (cv) { const [ra, dec] = v2rd(cv); flyTo(ra, dec, ST.P.ppd * f); return; }
  }
  if (V.proj === "globe" && ST.map.proj === "moll" && V.zoom < 0.95) { homeView(); return; }
  if (before) { const p = projector(V, w, h).fwd(before); V.panX += mx - p[0]; V.panY += my - p[1]; }
  if (V.proj === "moll" && V.zoom <= 1.001) { V.panX = V.panY = 0; }
  draw();
}
function fieldTip(f) {
  const i = f.info; return `<b>${esc(f.full)}</b> · <span class="v">${FSTAT[f.st].label}</span><br>` +
    (i.sbid ? `SBID <span class="v">${i.sbid}</span> · observed ${day(i.obs_start)}` + (i.validated ? `<br>validated: ${esc(i.validated)}` : "") + (i.aus_src ? `<br>POSSUM ingest: ${esc(i.aus_src)}` : "") : "not yet observed");
}
function initMap() {
  const c = $("sky"), tip = $("tip"); let drag = null, moved = 0, raf = 0;
  const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hitTarget = (x, y) => { let best = null, bd = 11; for (const q of ST.tpos) { const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = q; } } return best; };
  c.addEventListener("pointerdown", e => { c.setPointerCapture(e.pointerId); const [x, y] = pos(e); drag = { x, y }; moved = 0; c.classList.add("dragging"); hideInspect(); });
  c.addEventListener("pointermove", e => {
    const [x, y] = pos(e), V = ST.view;
    if (drag) {
      const dx = x - drag.x, dy = y - drag.y; moved += Math.abs(dx) + Math.abs(dy); drag.x = x; drag.y = y;
      if (V.proj === "globe") { const R = ST.P.R; V.lon0 = ((V.lon0 + dx / R * R2D / Math.max(0.15, Math.cos(V.lat0 * D2R))) % 360 + 360) % 360; V.lat0 = Math.max(-89.9, Math.min(89.9, V.lat0 + dy / R * R2D)); }
      else { V.panX += dx; V.panY += dy; }
      tip.style.display = "none"; draw(); return;
    }
    cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      if (!ST.P) return; const v = ST.P.inv(x, y);
      if (!v) { $("st-coord").innerHTML = "&nbsp;"; $("st-obj").innerHTML = "&nbsp;"; tip.style.display = "none"; return; }
      const [ra, dec] = v2rd(v), [l, b] = eq2gal(ra, dec);
      $("st-coord").innerHTML = `RA <b>${fmtRA(ra, 0)}</b> Dec <b>${fmtDec(dec, 0)}</b> &nbsp; l <b>${l.toFixed(2)}°</b> b <b>${b.toFixed(2)}°</b>`;
      const q = hitTarget(x, y); let html = "", obj = "";
      if (q) { const t = ST.targets[q.i], r = ST.results[q.i]; html = `<b>${esc(t.name)}</b><br>` + [1, 2].map(bd => `${BANDS[bd].label}: <span class="v">${FSTAT[r.band[bd].st].label}</span>` + (r.band[bd].best ? ` · ${esc(r.band[bd].best.f.full)}` + (r.band[bd].best.f.info.sbid ? ` · SBID ${r.band[bd].best.f.info.sbid}` : "") + ` · beam ${r.band[bd].best.beam}` : "")).join("<br>"); obj = esc(t.name); }
      else if (ST.map.mode === "tiles" && ST.M) { const id = tileOf(ra, dec), t = ST.M.tiles[ST.map.band].get(id); if (t) { html = `<b>Tile ${id}</b> · <span class="v">${TSTAT[t.st].label}</span>` + (isDate(t.p3) ? `<br>3D pipeline finished ${esc(t.p3)}` : "") + (t.aus ? `<br>mosaicked ${esc(t.aus)}` : "") + `<br>${t.fields.filter(f => FSTAT[f.st].rank >= 2).length}/${t.fields.length} contributing fields observed`; obj = "tile " + id; } }
      else { const cv = coverAt(ST.S, ST.map.band, v, 0.65)[0]; if (cv) { html = fieldTip(cv.f) + `<br>nearest beam ${cv.beam} (${cv.sep.toFixed(2)}°)`; obj = `${cv.f.full} · beam ${cv.beam}`; } }
      $("st-obj").innerHTML = obj ? `<b>${obj}</b>` : "&nbsp;"; c.style.cursor = q ? "pointer" : "";
      if (html) { tip.innerHTML = html; tip.style.display = "block"; const tw = tip.offsetWidth, th = tip.offsetHeight; tip.style.left = Math.min(c.clientWidth - tw - 8, x + 14) + "px"; tip.style.top = (y + 16 + th > c.clientHeight ? y - th - 10 : y + 16) + "px"; } else tip.style.display = "none";
    });
  });
  const up = e => {
    if (!drag) return; drag = null; c.classList.remove("dragging");
    if (moved > 5) return; const [x, y] = pos(e), q = hitTarget(x, y);
    if (q) { select(q.i, true); return; }
    const v = ST.P && ST.P.inv(x, y); if (v) showInspect(v, x, y);
  };
  c.addEventListener("pointerup", up); c.addEventListener("pointercancel", () => { drag = null; c.classList.remove("dragging"); });
  c.addEventListener("pointerleave", () => { tip.style.display = "none"; });
  c.addEventListener("wheel", e => { e.preventDefault(); const [x, y] = pos(e); zoomBy(Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004), x, y); hideInspect(); }, { passive: false });
  c.addEventListener("dblclick", e => { const [x, y] = pos(e), v = ST.P && ST.P.inv(x, y); if (v) { const [ra, dec] = v2rd(v); hideInspect(); flyTo(ra, dec, Math.max(34, ST.P.ppd * 2.2)); } });
  new ResizeObserver(() => { draw(); renderMini(); }).observe($("stage"));
}
function hideInspect() { $("inspect").style.display = "none"; }
function showInspect(v, x, y) {
  const [ra, dec] = v2rd(v), el = $("inspect"), tid = tileOf(ra, dec); let body = "";
  for (const b of [1, 2]) {
    const cv = coverAt(ST.S, b, v, ST.cfg.thr), t = ST.M && ST.M.tiles[b].get(tid);
    body += `<div class="kv"><span>${BANDS[b].label}</span><b>${cv.length ? chip(cv[0].f.st, cv[0].sep > 0.65) : `<span style="color:var(--muted)">not in footprint</span>`}</b></div>`;
    for (const c of cv.slice(0, 3)) body += `<div class="kv"><span>&nbsp; ${esc(c.f.full)}</span><b>${c.f.info.sbid ? "SBID " + c.f.info.sbid + " · " : ""}beam ${c.beam} · ${c.sep.toFixed(2)}°</b></div>`;
    if (t) body += `<div class="kv"><span>&nbsp; tile ${tid}</span><b>${TSTAT[t.st].label}</b></div>`;
  }
  el.innerHTML = `<div class="hd"><span>${fmtRA(ra, 1)} ${fmtDec(dec, 0)}</span><span class="x" id="insx">✕</span></div><div class="bd">${body}</div><div class="foot"><button class="primary" id="insadd">Add as target</button><button id="inszoom">Zoom here</button></div>`;
  el.style.display = "block"; const st = $("stage"), ew = el.offsetWidth, eh = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(st.clientWidth - ew - 8, x + 14)) + "px"; el.style.top = Math.max(50, Math.min(st.clientHeight - eh - 8, y + 10)) + "px";
  $("insx").onclick = hideInspect; $("inszoom").onclick = () => { hideInspect(); flyTo(ra, dec, 42); };
  $("insadd").onclick = () => { hideInspect(); addLine(`${fmtRA(ra, 2)} ${fmtDec(dec, 1)}`); };
}
function addLine(line) { const ta = $("text"); ta.value = (ta.value.trim() ? ta.value.replace(/\s+$/, "") + "\n" : "") + line; runCheck().then(() => { let j = -1; ST.targets.forEach((t, i) => { if (j < 0 || t.line >= ST.targets[j].line) j = i; }); if (j >= 0) select(j, true); }); }

/* ==================================================================
   Results table
   ================================================================== */
const COLS = [
  { k: "i", h: "#", cls: "num", v: (t, r, i) => i + 1 },
  { k: "name", h: "Target", cls: "nm", v: t => t.name },
  { k: "ra", h: "RA (J2000)", cls: "mono", v: t => t.ra },
  { k: "dec", h: "Dec", cls: "mono", v: t => t.dec },
  ...[1, 2].flatMap(b => [
    { k: "st" + b, h: "Status", cls: "b" + b, v: (t, r) => FSTAT[r.band[b].st].rank * 10 - (r.band[b].best ? r.band[b].best.sep : 0) },
    { k: "f" + b, h: "Field", cls: "mono", v: (t, r) => r.band[b].best ? r.band[b].best.f.id : "~" },
    { k: "sb" + b, h: "SBID", cls: "mono", v: (t, r) => r.band[b].best && r.band[b].best.f.info.sbid ? +r.band[b].best.f.info.sbid : 1e9 },
    { k: "bm" + b, h: "Nearest beam", cls: "num", v: (t, r) => r.band[b].best ? r.band[b].best.beam : 99 },
    { k: "sp" + b, h: "Offset", cls: "num", v: (t, r) => r.band[b].best ? r.band[b].best.sep : 99 },
    { k: "ob" + b, h: () => `Other beams ≤ ${+ST.cfg.thr.toFixed(2)}°`, cls: "mono", v: (t, r) => -r.band[b].cov.reduce((n, c) => n + c.beams.length, 0) },
  ]),
  { k: "tile", h: "Tile", cls: "num tl", v: (t, r) => r.tile },
  { k: "cube", h: "Band 1 cubes", cls: "", v: (t, r) => r.band[1].tile ? ["none", "ingest", "failed", "running", "waiting", "done"].indexOf(r.band[1].tile.st) : -1 },
];
function visibleRows() {
  const q = ST.q.trim().toLowerCase(), F = ST.filter, rows = [];
  ST.targets.forEach((t, i) => {
    const r = ST.results[i]; if (!r) return; const c1 = r.band[1].covered, c2 = r.band[2].covered;
    if (F === "b1" && !c1 || F === "b2" && !c2 || F === "both" && !(c1 && c2) || F === "none" && (c1 || c2) || F === "new" && !r.changed) return;
    if (q) { const hay = [t.name, ...[1, 2].flatMap(b => r.band[b].cov.map(c => c.f.full + " " + c.f.info.sbid)), r.tile].join(" ").toLowerCase(); if (!hay.includes(q)) return; }
    rows.push(i);
  });
  const col = COLS.find(c => c.k === ST.sort.k) || COLS[0], d = ST.sort.d;
  rows.sort((a, b) => { const x = col.v(ST.targets[a], ST.results[a], a), y = col.v(ST.targets[b], ST.results[b], b); return (typeof x === "string" ? x.localeCompare(y, undefined, { numeric: true }) : x - y) * d || a - b; });
  return rows;
}
/* "Other beams" cell: the best field's remaining beams within reach, nearest first, plus a count of further SBIDs */
function beamsByField(x) { return x.cov.map(c => `${c.f.info.sbid ? "SBID " + c.f.info.sbid : "planned"} · ${c.f.full}: ` + c.beams.map(m => `${m.no} (${m.sep.toFixed(2)}°)`).join(", ")).join("\n"); }
function otherBeamsCell(x) {
  const o = x.best.beams.slice(1), more = x.cov.slice(1).filter(c => c.f.info.sbid && FSTAT[c.f.st].rank >= 2).length;
  return `<td class="mono" title="${esc("Beams within " + ST.cfg.thr + "° of the target, nearest first\n" + beamsByField(x))}">${o.length ? o.slice(0, 6).map(m => m.no).join(" · ") + (o.length > 6 ? " …" : "") : `<span style="color:var(--muted)">none</span>`}${more ? ` <span style="color:var(--muted)">+${more} SBID${more > 1 ? "s" : ""}</span>` : ""}</td>`;
}
function renderResults() {
  const T = ST.targets, R = ST.results, wrap = $("tablewrap");
  const n = { all: T.length, b1: 0, b2: 0, both: 0, none: 0, new: 0 };
  R.forEach(r => { const a = r.band[1].covered, b = r.band[2].covered; if (a) n.b1++; if (b) n.b2++; if (a && b) n.both++; if (!a && !b) n.none++; if (r.changed) n.new++; });
  const chips = [["all", "All"], ["b1", "Band 1 ✓"], ["b2", "Band 2 ✓"], ["both", "Both bands"], ["none", "Not covered"]]; if (n.new) chips.push(["new", "Changed since last check"]);
  $("reschips").innerHTML = T.length ? chips.map(([k, l]) => `<button class="chipf${ST.filter === k ? " on" : ""}" data-f="${k}">${l} <b>${n[k]}</b></button>`).join(" ") : "";
  $("resfilter").style.display = T.length ? "" : "none";
  if (!T.length) {
    wrap.innerHTML = `<div id="empty"><h2>Which of your targets has POSSUM covered?</h2><p>Drop a target list anywhere on this page, paste positions into the panel on the left, or type an object name in the search box above the map. Each target is matched against every POSSUM field in both bands using the survey status read live from the tracking sheet.</p><div class="btnrow"><button class="primary" id="empty-ex">Try the example list</button><button id="empty-help">How it works</button></div><p style="font-size:11.5px;color:var(--muted)">Accepted lines: <code>13:37:00.9 -29:51:57 M83</code> <code>161.259 -59.700 Carina</code> <code>Abell 3627</code></p></div>`;
    $("empty-ex").onclick = loadExample; $("empty-help").onclick = showHelp; return;
  }
  const rows = visibleRows(), MAX = 1500, arrow = k => ST.sort.k === k ? (ST.sort.d > 0 ? " ▲" : " ▼") : "";
  let h = `<table class="res"><thead><tr><th class="grp" colspan="4"></th><th class="grp b1" colspan="6">Band 1 · 944 MHz</th><th class="grp b2" colspan="6">Band 2 · 1368 MHz</th><th class="grp tl" colspan="2">Tile products</th></tr><tr class="h2">` +
    COLS.map(c => `<th data-k="${c.k}" class="${/b\d|tl/.test(c.cls) ? c.cls.replace("num ", "") : ""}">${typeof c.h === "function" ? c.h() : c.h}${arrow(c.k)}</th>`).join("") + `</tr></thead><tbody>`;
  for (const i of rows.slice(0, MAX)) {
    const t = T[i], r = R[i];
    h += `<tr data-i="${i}" tabindex="0" class="${i === ST.sel ? "sel" : ""}"><td class="num">${i + 1}</td><td class="nm" title="${esc(t.name)}">${esc(t.name)}${t.resolved ? `<span class="src" title="Position resolved by CDS Sesame">resolved</span>` : ""}${r.changed ? `<span class="newb" title="${esc(r.changed)}">NEW</span>` : ""}</td><td class="mono">${fmtRA(t.ra)}</td><td class="mono">${fmtDec(t.dec)}</td>`;
    for (const b of [1, 2]) {
      const x = r.band[b], c = x.best;
      h += `<td class="b${b}" title="${c ? esc(FSTAT_DESC[x.st]) : "No POSSUM field of this band reaches this position"}">${chip(x.st, x.edge)}</td>` + (c ? `<td class="mono">${esc(c.f.id)}${x.cov.length > 1 ? ` <span style="color:var(--muted)">+${x.cov.length - 1}</span>` : ""}</td><td class="mono">${c.f.info.sbid || "—"}</td><td class="num">${c.beam}</td><td class="num">${c.sep.toFixed(2)}°</td>${otherBeamsCell(x)}` : `<td class="mono">—</td><td class="mono">—</td><td class="num">—</td><td class="num">—</td><td class="mono">—</td>`);
    }
    h += `<td class="num tl">${r.tile}</td><td>${r.band[1].tile ? tchip(r.band[1].tile.st) : `<span style="color:var(--muted)">—</span>`}</td></tr>`;
  }
  h += `</tbody></table>` + (rows.length > MAX ? `<div class="hint" style="padding:8px 14px">Showing the first ${MAX} of ${rows.length} rows — filter or export to see the rest.</div>` : "") + (!rows.length ? `<div class="hint" style="padding:14px">No targets match this filter.</div>` : "");
  wrap.innerHTML = h;
}
function select(i, scroll) {
  ST.sel = i; hideInspect();
  document.querySelectorAll("table.res tr.sel").forEach(tr => tr.classList.remove("sel"));
  const tr = document.querySelector(`table.res tr[data-i="${i}"]`); if (tr) { tr.classList.add("sel"); if (scroll) tr.scrollIntoView({ block: "nearest" }); }
  if (i >= 0 && ST.results[i]) {
    const r = ST.results[i]; ST.miniBand = r.band[ST.map.band].best ? ST.map.band : r.band[1].best ? 1 : r.band[2].best ? 2 : ST.map.band;
    if (ST.view.proj === "globe" && ST.P) { const p = ST.P.fwd(rd2v(ST.targets[i].ra, ST.targets[i].dec)); if (p[2] < 0.15) flyTo(ST.targets[i].ra, ST.targets[i].dec); }
  }
  renderDetail(); draw();
}

/* ==================================================================
   Detail drawer
   ================================================================== */
function stepsHTML(rank, tile) {
  const cols = ["observed", "validated", "processed"].map((k, j) => rank >= j + 2 ? FSTAT[k].col : rank === 1 && j === 0 ? FSTAT.rejected.col : "");
  const tc = tile && tile.st !== "none" ? TSTAT[tile.st].col : "";
  return `<div class="steps">${cols.concat([tc]).map(c => `<span style="${c ? "background:" + c : ""}"></span>`).join("")}</div><div class="steplab"><span>Observed</span><span>Validated</span><span>Ingested</span><span>Cubes</span></div>`;
}
function renderDetail() {
  const el = $("detail"), i = ST.sel, t = ST.targets[i], r = ST.results[i];
  if (!t || !r) { el.classList.remove("open"); el.innerHTML = ""; draw(); return; }
  const [l, b] = eq2gal(t.ra, t.dec), verdict = [1, 2].map(bd => {
    const x = r.band[bd], c = x.best; if (!c) return `<b>${BANDS[bd].label}:</b> outside the survey footprint.`;
    const where = `${esc(c.f.full)}${c.f.info.sbid ? `, SBID ${c.f.info.sbid}` : ""}, beam ${c.beam}`;
    if (x.covered) return `<b style="color:${FSTAT[x.st].col}">${BANDS[bd].label}: covered</b> — ${FSTAT[x.st].label.toLowerCase()} (${where})${x.edge ? "; near the field edge" : ""}.`;
    if (x.st === "planned") return `<b>${BANDS[bd].label}:</b> planned, not yet observed (${esc(c.f.full)}).`;
    if (x.st === "rejected") return `<b style="color:${FSTAT.rejected.col}">${BANDS[bd].label}:</b> observed but rejected at validation; awaiting re-observation (${where}).`;
    return `<b>${BANDS[bd].label}:</b> ${FSTAT[x.st].label.toLowerCase()}, below your “counts as covered” level (${where}).`;
  }).join("<br>");
  let h = `<div class="hd"><div><h2>${esc(t.name)}</h2><div class="co">${fmtRA(t.ra)} &nbsp;${fmtDec(t.dec)}<br>${t.ra.toFixed(5)}° &nbsp;${t.dec >= 0 ? "+" : ""}${t.dec.toFixed(5)}°<br>l ${l.toFixed(3)}° &nbsp;b ${b >= 0 ? "+" : ""}${b.toFixed(3)}°${t.resolved ? "<br>position resolved by CDS Sesame" : ""}</div></div><button class="x" id="dclose" aria-label="Close details">✕</button></div><div class="bd">`;
  h += `<div id="verdict">${verdict}${r.changed ? `<br><span class="newb" style="margin-left:0">NEW</span> <span style="color:var(--ink2)">${esc(r.changed)}</span>` : ""}</div>`;
  h += `<div class="minibar"><div class="seg" style="flex:0 0 150px"><button data-mb="1" class="${ST.miniBand === 1 ? "on" : ""}">Band 1</button><button data-mb="2" class="${ST.miniBand === 2 ? "on" : ""}">Band 2</button></div><span class="cap">beam footprint · 5° × 5°</span></div><canvas id="minichart"></canvas>`;
  h += `<div class="btnrow"><button id="dzoom">Zoom map here</button><button id="dcopy">Copy summary</button><button id="dprev" class="mini" style="margin-left:auto" title="Previous target (↑)">↑</button><button id="dnext" class="mini" title="Next target (↓)">↓</button></div>`;
  for (const bd of [1, 2]) {
    const x = r.band[bd];
    h += `<div class="card"><div class="ch"><span class="n">${BANDS[bd].label}</span>${chip(x.st, x.edge, FSTAT[x.st].label)}<span class="f">${BANDS[bd].freq}</span></div><div class="cb">`;
    if (x.cov.length) { const withData = x.cov.filter(c => c.f.info.sbid && FSTAT[c.f.st].rank >= 2), nb = withData.reduce((n, c) => n + c.beams.length, 0);
      h += `<div class="hint" style="margin:0 0 6px">` + (withData.length ? `<b>${nb} beam${nb > 1 ? "s" : ""}</b> in <b>${withData.length} SBID${withData.length > 1 ? "s" : ""}</b> lie within ${+ST.cfg.thr.toFixed(2)}° of this position` + (x.cov.length > withData.length ? `, plus ${x.cov.length - withData.length} field${x.cov.length - withData.length > 1 ? "s" : ""} without usable data` : "") + `.` : `No observed field yet; ${x.cov.length} field${x.cov.length > 1 ? "s" : ""} will cover this position.`) + ` Beams are listed nearest first.</div>`; }
    if (!x.cov.length) h += `<div class="none">No ${BANDS[bd].label} field has a beam centre within ${ST.cfg.thr.toFixed(2)}° of this position${Math.abs(t.dec) > 60 && t.dec > 0 ? " (far northern declinations are outside the survey)" : ""}.</div>`;
    x.cov.forEach((c, k) => {
      const f = c.f, inf = f.info;
      h += `<div class="fld"><div class="fh"><span class="nm">${esc(f.full)}</span>${chip(f.st)}</div>` + stepsHTML(FSTAT[f.st].rank, k === 0 ? x.tile : null) +
        `<div class="beams">${c.beams.map((bm, j) => `<span class="beam${j ? "" : " first"}" title="Offset of the target from the centre of beam ${bm.no}">beam <b>${bm.no}</b> · ${bm.sep.toFixed(3)}°</span>`).join("")}</div>` +
        (inf.sbid ? `<div class="kv"><span>SBID</span><b>${inf.sbid}</b></div><div class="kv"><span>Observed</span><b>${day(inf.obs_start) || "—"}</b></div><div class="kv"><span>ASKAPsoft processed</span><b>${esc(inf.processed) || "—"}</b></div><div class="kv"><span>Validated</span><b>${esc(inf.validated) || "pending"}</b></div><div class="kv"><span>POSSUM ingest (AusSRC)</span><b>${esc(inf.aus_src) || "—"}</b></div>` +
          (inf.pipe1d || inf.dave1d ? `<div class="kv"><span>1D pipeline</span><b>${esc([inf.pipe1d, inf.dave1d].filter(Boolean).join(" · "))}</b></div>` : "") : `<div class="none">In the survey plan; no observation yet.</div>`) +
        (f.obs.length > 1 || (f.obs.length === 1 && f.obs[0].sbid !== inf.sbid) ? `<div class="hist">${f.obs.map(o => `<div class="${/REJECT|DELETED|BAD/.test(o.current_state + o.validation_level) ? "rej" : ""}">${day(o.obs_start)} &nbsp;SBID ${esc(o.sbid)} &nbsp;${esc(o.current_state.toLowerCase())}${o.validation_level && !/UNCERTAIN|NOT_VALIDATED/.test(o.validation_level) && o.validation_level !== o.current_state ? " · " + esc(o.validation_level.toLowerCase()) : ""}</div>`).join("")}</div>` : "") + `</div>`;
    });
    if (x.tile) { const tl = x.tile, ob = tl.fields.filter(f => FSTAT[f.st].rank >= 2).length; h += `<div class="fld"><div class="fh"><span class="nm">Tile ${tl.id}</span>${tchip(tl.st)}</div><div class="kv"><span>Contributing fields observed</span><b>${ob} / ${tl.fields.length}</b></div>${tl.aus ? `<div class="kv"><span>Tile mosaicked</span><b>${esc(tl.aus)}</b></div>` : ""}${tl.p3 ? `<div class="kv"><span>3D pipeline (cubes)</span><b>${esc(tl.p3)}</b></div>` : ""}</div>`; }
    h += `</div></div>`;
  }
  h += `<div class="hint">For each field, every beam whose centre is within the maximum offset is listed, nearest first (outlined). Beam numbers are 1–36 as listed in the POSSUM beam-centre tables. Tile = HEALPix pixel (N<sub>side</sub> 32, ring) used for POSSUM mosaics and cubes.</div></div>`;
  el.innerHTML = h; el.classList.add("open");
  $("dclose").onclick = () => select(-1);
  $("dzoom").onclick = () => flyTo(t.ra, t.dec, 42);
  $("dcopy").onclick = () => copyText(summaryText(i), "Summary copied");
  const step = d => { const rows = visibleRows(), k = rows.indexOf(i), j = rows[k + d]; if (j != null) select(j, true); };
  $("dprev").onclick = () => step(-1); $("dnext").onclick = () => step(1);
  el.querySelectorAll("[data-mb]").forEach(bn => bn.onclick = () => { ST.miniBand = +bn.dataset.mb; renderDetail(); });
  renderMini(); draw();
}
function renderMini() {
  const c = $("minichart"), i = ST.sel, t = ST.targets[i], r = ST.results[i]; if (!c || !t || !r) return;
  const w = c.clientWidth, h = c.clientHeight, ppd = Math.min(w, h) / 5, best = r.band[ST.miniBand].best;
  drawSky(c, { proj: "globe", frame: "eq", lon0: t.ra, lat0: t.dec, zoom: ppd / (D2R * 0.46 * Math.min(w, h)), panX: 0, panY: 0 }, { band: ST.miniBand, mode: "fields", grid: true, beams: true, mini: true, only: i, hl: r.band[ST.miniBand].cov.map(x => x.f), nearBeams: new Map(r.band[ST.miniBand].cov.map(x => [x.f, x.beams.map(m => m.no)])), hlBeam: best ? { f: best.f, no: best.beam } : null });
}
function summaryText(i) {
  const t = ST.targets[i], r = ST.results[i]; let s = `${t.name}  ${fmtRA(t.ra)} ${fmtDec(t.dec)}  (tile ${r.tile})\n`;
  for (const b of [1, 2]) { const x = r.band[b]; s += `  ${BANDS[b].label}: ${FSTAT[x.st].label}`; s += x.cov.length ? "\n" + x.cov.map(c => `    ${c.f.full}  SBID ${c.f.info.sbid || "-"}  ${FSTAT[c.f.st].label}  beams ${c.beams.map(m => `${m.no} (${m.sep.toFixed(3)} deg)`).join(", ")}`).join("\n") + "\n" : "\n"; }
  return s;
}
async function copyText(s, msg) { try { await navigator.clipboard.writeText(s); toast(msg || "Copied"); } catch (e) { openModal("Copy", `<pre>${esc(s)}</pre>`); } }

/* ==================================================================
   Exports
   ================================================================== */
const csvCell = v => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function provenance() { const s = ST.src; return `# POSSUM Coverage Checker · status source: ${s.kind === "snapshot" ? "built-in snapshot " + SNAPSHOT.date + " (NOT live)" : "tracking sheet, read " + s.at.toISOString()}${s.kind === "partial" ? " (some tabs from snapshot " + SNAPSHOT.date + ")" : ""} · max beam offset ${ST.cfg.thr} deg · covered = ${ST.cfg.minStatus} or better\n`; }
function needTargets() { if (!ST.targets.length) { toast("Add some targets first"); return false; } return true; }
function exportSummary() {
  if (!needTargets()) return; const hd = ["name", "ra_deg", "dec_deg", "ra_hms", "dec_dms", "glon_deg", "glat_deg", "tile_id"];
  for (const b of [1, 2]) hd.push(...["status", "covered", "field", "sbid", "beam", "beam_offset_deg", "edge", "obs_date", "validated", "possum_ingest", "n_fields", "tile_3d_pipeline", "beams_within_radius", "all_sbid_beams"].map(k => `band${b}_${k}`));
  const rows = ST.targets.map((t, i) => {
    const r = ST.results[i], [l, bb] = eq2gal(t.ra, t.dec), o = [t.name, t.ra.toFixed(6), t.dec.toFixed(6), fmtRA(t.ra), fmtDec(t.dec), l.toFixed(5), bb.toFixed(5), r.tile];
    for (const b of [1, 2]) { const x = r.band[b], c = x.best, f = c && c.f.info; o.push(x.st, x.covered ? 1 : 0, c ? c.f.full : "", c ? f.sbid : "", c ? c.beam : "", c ? c.sep.toFixed(4) : "", c ? (x.edge ? 1 : 0) : "", c ? day(f.obs_start) : "", c ? f.validated : "", c ? f.aus_src : "", x.cov.length, x.tile ? (x.tile.p3 || (x.tile.aus ? "mosaicked " + x.tile.aus : "")) : "", c ? c.beams.map(m => m.no).join(";") : "", x.cov.filter(q => q.f.info.sbid && FSTAT[q.f.st].rank >= 2).map(q => q.f.info.sbid + ":" + q.beams.map(m => m.no).join(";")).join("|")); }
    return o.map(csvCell).join(",");
  });
  download(`possum_coverage_${stamp()}.csv`, provenance() + hd.join(",") + "\n" + rows.join("\n") + "\n", "text/csv");
}
function exportFull() {
  if (!needTargets()) return; const hd = "name,ra_deg,dec_deg,band,field,field_status,sbid,obs_date,validated,possum_ingest,beam_rank,beam,beam_offset_deg,tile_id,tile_3d_pipeline", rows = [];
  ST.targets.forEach((t, i) => { const r = ST.results[i]; for (const b of [1, 2]) for (const c of r.band[b].cov) c.beams.forEach((m, k) => rows.push([t.name, t.ra.toFixed(6), t.dec.toFixed(6), b, c.f.full, c.f.st, c.f.info.sbid, day(c.f.info.obs_start), c.f.info.validated, c.f.info.aus_src, k + 1, m.no, m.sep.toFixed(4), r.tile, r.band[b].tile ? r.band[b].tile.p3 : ""].map(csvCell).join(","))); });
  download(`possum_coverage_all_matches_${stamp()}.csv`, provenance() + hd + "\n" + rows.join("\n") + "\n", "text/csv");
}
function sbidList() {
  const m = new Map();
  ST.targets.forEach((t, i) => { const r = ST.results[i]; for (const b of [1, 2]) for (const c of r.band[b].cov) { if (FSTAT[c.f.st].rank < FSTAT[ST.cfg.minStatus].rank || !c.f.info.sbid) continue; const k = c.f.info.sbid; if (!m.has(k)) m.set(k, { sbid: k, band: b, f: c.f, items: [] }); m.get(k).items.push({ name: t.name, beam: c.beam, sep: c.sep, beams: c.beams }); } });
  return [...m.values()].sort((a, b) => a.band - b.band || a.sbid - b.sbid);
}
function exportSbids() {
  if (!needTargets()) return; const L = sbidList();
  const txt = L.length ? L.map(e => `SBID ${e.sbid}  ${e.f.full}  [${BANDS[e.band].label}, ${FSTAT[e.f.st].label}]\n` + e.items.map(x => `    ${x.name}: beams ${x.beams.map(m => `${m.no} (${m.sep.toFixed(2)})`).join(", ")}`).join("\n")).join("\n") : "No covered targets.";
  openModal(`Scheduling blocks to fetch · ${L.length} SBID${L.length === 1 ? "" : "s"}`, `<p>Every field that covers a target at your “counts as covered” level, with the beams within ${+ST.cfg.thr.toFixed(2)}° of each target, nearest first (offset in degrees).</p><pre id="sbtxt">${esc(txt)}</pre>`, `<button id="sbcopy">Copy</button><button id="sbcsv">Download CSV</button>`);
  $("sbcopy").onclick = () => copyText(txt, "SBID list copied");
  $("sbcsv").onclick = () => download(`possum_sbids_${stamp()}.csv`, provenance() + "sbid,band,field,field_status,target,beam_rank,beam,beam_offset_deg\n" + L.flatMap(e => e.items.flatMap(x => x.beams.map((m, k) => [e.sbid, e.band, e.f.full, e.f.st, x.name, k + 1, m.no, m.sep.toFixed(4)].map(csvCell).join(",")))).join("\n") + "\n", "text/csv");
}
function exportPNG() {
  const src = $("sky"), w = src.clientWidth, h = src.clientHeight, c = document.createElement("canvas"), sel = ST.results[ST.sel];
  drawSky(c, ST.view, { w, h, scale: 2, band: ST.map.band, mode: ST.map.mode, grid: ST.map.grid, plane: ST.map.plane, labels: ST.map.labels, beams: ST.map.beams, hl: sel ? sel.band[ST.map.band].cov.map(x => x.f) : [] });
  const ctx = c.getContext("2d"); ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.font = "600 13px -apple-system,Segoe UI,sans-serif"; ctx.fillStyle = "#e8ebf2"; ctx.textAlign = "left";
  ctx.fillText(`POSSUM coverage · ${BANDS[ST.map.band].label} (${BANDS[ST.map.band].freq}) · ${ST.map.mode === "tiles" ? "tile pipeline status" : "observation status"}`, 14, 22);
  ctx.font = "11px -apple-system,Segoe UI,sans-serif"; ctx.fillStyle = "#9aa3b5"; ctx.fillText(ST.src.kind === "snapshot" ? `status: snapshot ${SNAPSHOT.date} (not live)` : `status read from the tracking sheet ${ST.src.at.toISOString().slice(0, 16).replace("T", " ")} UTC`, 14, 38);
  const keys = ST.map.mode === "tiles" ? ["done", "waiting", "running", "failed", "ingest"].map(k => [TSTAT[k].col, TSTAT[k].label]) : ["processed", "validated", "observed", "rejected", "planned"].map(k => [FSTAT[k].col, FSTAT[k].label]);
  keys.forEach(([col, lab], i) => { const y = h - 14 - (keys.length - 1 - i) * 16; ctx.fillStyle = col; ctx.fillRect(14, y - 9, 10, 10); ctx.fillStyle = "#9aa3b5"; ctx.fillText(lab, 30, y); });
  c.toBlob(b => download(`possum_coverage_map_band${ST.map.band}_${stamp()}.png`, b));
}

/* ==================================================================
   Help / about, wiring, boot
   ================================================================== */
const ABOUT = `<p class="hint">Each target is compared with the centres of all 36 beams of every POSSUM field (1014 in Band 1, 1104 in Band 2). Field, tile and observation status is read from the collaboration's <b>POSSUM Pipeline status</b> Google Sheet every time the page opens, so the answer reflects the survey as it stands now.</p>
<p class="hint"><b>Status ladder.</b> Planned → Observed (ASKAPsoft-processed, awaiting validation) → Validated → POSSUM-processed (ingested at AusSRC). Rejected observations are shown but never count as coverage.</p>
<p class="hint"><b>Tiles.</b> POSSUM mosaics and cubes are made per HEALPix tile (N<sub>side</sub> 32). The tile containing each target and its 3D-pipeline state come from the Survey Tiles tabs.</p>
<p class="hint">Beam geometry from the full-survey beam-centre tables (L. Sebokolodi). Survey tracking by C. Van Eck. Builds on <i>covered_by_POSSUM.py</i> (C. Anderson) and <i>query_status.py</i> (E. Osinga). Name resolution by CDS Sesame.</p>
<p class="hint">Version ${VERSION} · source, documentation and issue tracker: <a href="${REPO_URL}" target="_blank" rel="noopener">${REPO_URL.replace("https://", "")}</a></p>`;
function showHelp() {
  openModal("How the coverage checker works", `
<h4>1 · Give it targets</h4><ul><li>Drop a <code>.txt</code>/<code>.csv</code> file anywhere, paste lines into the Targets box, or type one into the search box above the map.</li><li>Each line: <code>RA Dec [name]</code> or <code>name RA Dec</code>. Sexagesimal RA is hours (<code>13:37:00.9</code>, <code>13h37m00.9s</code>, <code>13 37 00.9</code>); plain numbers are degrees. Commas, tabs or spaces all work.</li><li>A line with just a name (<code>Abell 3627</code>) is resolved by CDS Sesame. A header row with <code>ra, dec, name</code> or <code>l, b</code> selects columns.</li></ul>
<h4>2 · Read the answer</h4><ul><li>The table gives, for each band, the best field covering the target, its SBID, the nearest beam (1–36) and the offset from that beam's centre. <b>edge</b> marks targets more than 0.65° from any beam centre.</li><li>Click a row for every covering field, all beams within the maximum offset (in every SBID), observation history, tile and cube status, and a 5° beam chart.</li><li><b>NEW</b> marks targets whose status has improved since you last checked the same position in this browser.</li></ul>
<h4>3 · Explore the map</h4><ul><li>Drag to move, wheel or <kbd>+</kbd>/<kbd>−</kbd> to zoom, double-click to zoom in; beam footprints and numbers appear when zoomed. Click empty sky to query any position.</li><li>Use the <b>All sky / Globe</b> switch above the map to change projection: all-sky for the overview, globe to spin the sky and zoom in. Also switch between observation and tile / cube status, Band 1 and Band 2, equatorial and Galactic.</li><li><kbd>↑</kbd>/<kbd>↓</kbd> step through targets, <kbd>Esc</kbd> closes panels, <kbd>1</kbd>/<kbd>2</kbd> switch band, <kbd>P</kbd> switches projection.</li></ul>
<h4>Is it live?</h4><p>The pill at the top right is green when the status came from the tracking sheet in this session. If the sheet cannot be reached the page says so and falls back to a snapshot built in on ${SNAPSHOT.date}; exports record which was used.</p>`);
}
function loadExample() { $("text").value = EXAMPLE; runCheck(); }
function saveMap() { store.set("map", ST.map); }
function syncControls() {
  document.querySelectorAll("#seg-band button").forEach(b => b.classList.toggle("on", +b.dataset.v === ST.map.band));
  document.querySelectorAll("#seg-mode button").forEach(b => b.classList.toggle("on", b.dataset.v === ST.map.mode));
  $("projection").value = ST.view.proj; document.querySelectorAll("#seg-proj button").forEach(b => b.classList.toggle("on", b.dataset.v === ST.view.proj)); $("frame").value = ST.view.frame; $("minstatus").value = ST.cfg.minStatus; $("thr").value = ST.cfg.thr; $("thrval").textContent = (+ST.cfg.thr).toFixed(2) + "°";
  for (const k of ["grid", "plane", "labels", "beams"]) $("lay-" + k).checked = ST.map[k];
  document.querySelectorAll("[data-thr]").forEach(b => b.classList.toggle("on", Math.abs(+b.dataset.thr - ST.cfg.thr) < 1e-6));
}
/* All-sky Mollweide <-> draggable globe. Going to the globe keeps whatever is at the centre of the view. */
function setProj(v) {
  ST.map.proj = v; store.set("map", ST.map); hideInspect();
  if (v === "moll") { homeView(); return; }
  if (ST.view.proj !== "globe") {
    const c = $("sky"), cv = ST.P && ST.view.zoom > 1.05 ? ST.P.inv(c.clientWidth / 2, c.clientHeight / 2) : null;
    Object.assign(ST.view, { proj: "globe", zoom: 1, panX: 0, panY: 0, lon0: 60, lat0: -45 });
    if (cv) { const [ra, dec] = v2rd(cv), [lon, lat] = ST.view.frame === "gal" ? eq2gal(ra, dec) : [ra, dec]; ST.view.lon0 = lon; ST.view.lat0 = lat; }
  }
  syncControls(); draw();
}
function setBand(b) { ST.map.band = b; saveMap(); syncControls(); renderLegend(); draw(); }
function readFile(f) { if (!f) return; if (f.size > 20e6) { toast("That file is too large to be a target list"); return; } const r = new FileReader(); r.onload = () => { $("text").value = String(r.result); runCheck(); }; r.readAsText(f); }
function wire() {
  document.querySelectorAll(".sec-head").forEach(h => h.onclick = () => h.parentElement.classList.toggle("open"));
  $("burger").onclick = () => { $("sidebar").classList.toggle("collapsed"); };
  $("drop").onclick = () => $("file").click(); $("drop").onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } };
  $("file").onchange = e => { readFile(e.target.files[0]); e.target.value = ""; };
  $("run").onclick = runCheck; $("example").onclick = loadExample;
  $("clear").onclick = () => { $("text").value = ""; runCheck(); };
  $("text").addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runCheck(); });
  $("text").addEventListener("paste", () => setTimeout(runCheck, 0));
  $("quickbox").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.value.trim()) { addLine(e.target.value.trim()); e.target.value = ""; } });
  $("refresh").onclick = () => loadLive(true); $("pill-live").onclick = () => { $("sidebar").classList.remove("collapsed"); $("sec-survey").classList.add("open"); $("sec-survey").scrollIntoView({ block: "nearest" }); };
  $("sheetlink").href = SHEET_URL + "edit"; $("helpbtn").onclick = showHelp; $("aboutbody").innerHTML = ABOUT;
  $("minstatus").onchange = e => { ST.cfg.minStatus = e.target.value; store.set("cfg", ST.cfg); rematch(); };
  let thrT; $("thr").oninput = e => { ST.cfg.thr = +e.target.value; syncControls(); clearTimeout(thrT); thrT = setTimeout(() => { store.set("cfg", ST.cfg); rematch(); }, 120); };
  document.querySelectorAll("[data-thr]").forEach(b => b.onclick = () => { ST.cfg.thr = +b.dataset.thr; store.set("cfg", ST.cfg); syncControls(); rematch(); });
  document.querySelectorAll("#seg-band button").forEach(b => b.onclick = () => setBand(+b.dataset.v));
  document.querySelectorAll("#seg-mode button").forEach(b => b.onclick = () => { ST.map.mode = b.dataset.v; saveMap(); syncControls(); renderLegend(); draw(); });
  $("projection").onchange = e => setProj(e.target.value);
  document.querySelectorAll("#seg-proj button").forEach(b => b.onclick = () => setProj(b.dataset.v));
  $("frame").onchange = e => { ST.view.frame = ST.map.frame = e.target.value; store.set("map", ST.map); homeView(); };
  for (const k of ["grid", "plane", "labels", "beams"]) $("lay-" + k).onchange = e => { ST.map[k] = e.target.checked; saveMap(); draw(); };
  $("zin").onclick = () => zoomBy(1.6); $("zout").onclick = () => zoomBy(1 / 1.6); $("zhome").onclick = homeView;
  $("exp-csv").onclick = exportSummary; $("exp-full").onclick = exportFull; $("exp-sbid").onclick = exportSbids; $("exp-png").onclick = exportPNG;
  $("reschips").onclick = e => { const b = e.target.closest("[data-f]"); if (b) { ST.filter = b.dataset.f; renderResults(); } };
  $("resfilter").oninput = e => { ST.q = e.target.value; renderResults(); };
  $("tablewrap").addEventListener("click", e => { const th = e.target.closest("th[data-k]"); if (th) { const k = th.dataset.k; ST.sort = { k, d: ST.sort.k === k ? -ST.sort.d : (/^(st|cube)/.test(k) ? -1 : 1) }; renderResults(); return; } const tr = e.target.closest("tr[data-i]"); if (tr) select(+tr.dataset.i); });
  $("tablewrap").addEventListener("dblclick", e => { const tr = e.target.closest("tr[data-i]"); if (tr) { const t = ST.targets[+tr.dataset.i]; flyTo(t.ra, t.dec, 42); } });
  $("tablewrap").addEventListener("keydown", e => { const tr = e.target.closest("tr[data-i]"); if (tr && e.key === "Enter") select(+tr.dataset.i); });
  $("modalback").addEventListener("click", e => { if (e.target === $("modalback")) closeModal(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { if ($("modalback").style.display === "flex") closeModal(); else if ($("inspect").style.display === "block") hideInspect(); else if (ST.sel >= 0) select(-1); return; }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { const rows = visibleRows(); if (!rows.length) return; e.preventDefault(); const k = rows.indexOf(ST.sel), j = rows[Math.max(0, Math.min(rows.length - 1, k < 0 ? 0 : k + (e.key === "ArrowDown" ? 1 : -1)))]; select(j, true); }
    else if (e.key === "1" || e.key === "2") setBand(+e.key);
    else if (e.key === "+" || e.key === "=") zoomBy(1.6); else if (e.key === "-") zoomBy(1 / 1.6);
    else if (e.key === "p" || e.key === "P") setProj(ST.view.proj === "moll" ? "globe" : "moll");
    else if (e.key === "?") showHelp();
  });
  // whole-window drag & drop
  let depth = 0; const veil = $("dropveil"), hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  window.addEventListener("dragenter", e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; veil.style.display = "flex"; });
  window.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("dragleave", e => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; veil.style.display = "none"; } });
  window.addEventListener("drop", e => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; veil.style.display = "none"; readFile(e.dataTransfer.files[0]); });
  // splitter
  const sp = $("split"); sp.addEventListener("pointerdown", e => { sp.setPointerCapture(e.pointerId); const mv = ev => { const r = $("main").getBoundingClientRect(); $("results").style.height = Math.max(92, Math.min(r.height - 190, r.bottom - ev.clientY)) + "px"; }; const up = () => { sp.removeEventListener("pointermove", mv); sp.removeEventListener("pointerup", up); store.set("resh", $("results").style.height); }; sp.addEventListener("pointermove", mv); sp.addEventListener("pointerup", up); });
  const rh = store.get("resh", null); if (rh) $("results").style.height = rh;
}
function boot() {
  ST.resolved = store.get("names", {});
  ST.S = buildFields(BEAMDATA);
  ST.M = applyStatus(ST.S, snapshotTabs());            // draw something at once; replaced by live data below
  wire(); syncControls(); initMap(); homeView(); renderLive(); renderResults();
  const saved = store.get("text", ""); if (saved) { $("text").value = saved; }
  loadLive(false).then(() => { if ($("text").value.trim()) runCheck(); });
  if (window.innerWidth < 760) $("sidebar").classList.add("collapsed");
}
boot();
