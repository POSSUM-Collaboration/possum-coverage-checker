// Headless end-to-end check of the built index.html.   npm i playwright && node tests/smoke.mjs
// The tracking sheet is mocked from data/snapshot, so this runs without network access.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("..", import.meta.url));
const GID = { "1364788351": "fields_band1", "995376834": "fields_band2", "1858715798": "tiles_band1", "780749712": "tiles_band2", "785190940": "all_observations" };
const browser = await chromium.launch(), errors = [];
async function open(online) {
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", r => {
    const u = r.request().url(), m = /export\?format=csv&gid=(\d+)/.exec(u);
    if (u.startsWith("file:")) return r.continue();
    if (online && m && GID[m[1]]) return r.fulfill({ status: 200, contentType: "text/csv", body: readFileSync(`${root}data/snapshot/${GID[m[1]]}.csv`, "utf8") });
    if (online && /nph-sesame\/-oI/.test(u)) return r.fulfill({ status: 200, contentType: "text/plain", body: /Abell/.test(u) ? "%J 243.59167 -60.87222 = 16:14:22.0 -60:52:20\n" : "#!SIMBAD: Nothing found\n" });
    return r.abort();
  });
  await page.goto("file://" + root + "index.html");
  await page.waitForFunction(() => !ST.src.busy && ST.src.kind !== "loading");
  return page;
}
let p = await open(true);
assert.match(await p.textContent("#livetext"), /^Live/);
await p.click("#example"); await p.waitForFunction(() => ST.results.length === 12);
assert.equal(await p.$$eval("table.res tbody tr", t => t.length), 12);
assert.match(await p.$eval("table.res tbody tr:nth-child(2)", r => r.innerText), /1921-64/);
await p.click("table.res tbody tr:nth-child(2)"); assert.equal(await p.textContent("#detail h2"), "1934-638");
await p.fill("#quickbox", "Abell 3627"); await p.press("#quickbox", "Enter"); await p.waitForFunction(() => ST.results.length === 13);
assert.match(await p.textContent("#detail"), /resolved by CDS Sesame/);
for (const sel of ['#seg-mode button[data-v=tiles]', '#seg-band button[data-v="2"]']) await p.click(sel);
await p.selectOption("#projection", "globe"); await p.selectOption("#frame", "gal");
const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#exp-csv")]);
assert.match(dl.suggestedFilename(), /^possum_coverage_\d{8}\.csv$/);
p = await open(false);                                   // sheet unreachable: must say so and fall back
assert.match(await p.textContent("#livetext"), /Offline snapshot/);
assert.equal(await p.isVisible("#banner"), true);
await browser.close();
assert.deepEqual(errors, []);
console.log("smoke test passed");
