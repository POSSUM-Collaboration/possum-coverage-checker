// Independent order-13 fixtures generated with astropy-healpix, seed 42.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {euclidPixel, euclidContains} = require('../src/euclid.js');
const {rd2v} = require('../src/lib.js');
const data = new Function(readFileSync(new URL('../src/euclid-data.js', import.meta.url), 'utf8') + ';return EUCLID;')();
const reference = JSON.parse(readFileSync(new URL('euclid-reference.json', import.meta.url)));
for (const [ra, dec, p] of reference) assert.equal(euclidPixel(rd2v(ra, dec), 13), p, `${ra},${dec}`);
assert.equal(euclidContains([3, 5, 8, 12], 2), false);
for (const p of [3,4,8,11]) assert.equal(euclidContains([3,5,8,12],p),true);
for (const p of [5,7,12]) assert.equal(euclidContains([3,5,8,12],p),false);
for (const kind of ['wide','deep']) {
 const moc = data[kind], bytes = readFileSync(new URL(`../data/euclid/euclid_dr1_${kind}.moc.fits`, import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),moc.sha256);
 let count=0;
 for(let i=0;i<moc.ranges.length;i+=2) {
  const [a,b]=moc.ranges.slice(i,i+2);assert.ok(a<b);if(i)assert.ok(a>moc.ranges[i-1]); count+=b-a;
  assert.ok(euclidContains(moc.ranges,a));assert.ok(euclidContains(moc.ranges,b-1));assert.ok(!euclidContains(moc.ranges,b));
 }
 assert.ok(Math.abs(count/(12*4**13)*41252.96124941927-moc.areaSqDeg)<1e-8);
}
console.log('Euclid indexing, ranges, source hashes and areas passed');
