import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1500,height:950},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*', r=>r.request().url().startsWith('file:')?r.continue():r.abort());
 await page.goto('file://'+fileURLToPath(new URL('../index.html',import.meta.url)));
 await page.waitForFunction(()=>ST.S && !ST.src.busy);
 await page.evaluate(()=>{document.getElementById('lay-euclidWide').click();document.getElementById('lay-euclidDeep').click();});
 assert.match(await page.textContent('#legend'),/Euclid DR1 wide tiles/);
 assert.match(await page.textContent('#legend'),/Euclid DR1 deep tiles/);
 for(const proj of ['moll','globe']) for(const frame of ['eq','gal']) for(const zoom of [1, 4]) {
  const result=await page.evaluate(({proj,frame,zoom})=>{
   Object.assign(ST.view,{proj,frame,lon0:35,lat0:-45,zoom,panX:25,panY:-10});
   const c=document.createElement('canvas'),start=performance.now();
   drawSky(c,ST.view,{w:800,h:500,scale:1,band:1,mode:'fields'});
   const P=projector(ST.view,800,500),r=euclidRasterCache.get(c).raster;
   const rgba=r.getContext('2d').getImageData(0,0,800,500).data;
   let mismatch=0,covered=0;
   for(let y=0;y<500;y+=7)for(let x=0;x<800;x+=7){
    const v=P.inv(x+0.5,y+0.5),p=v&&euclidPixel(v,13);
    const expected=!!v&&(euclidContains(EUCLID.wide.ranges,p)||euclidContains(EUCLID.deep.ranges,p));
    const actual=rgba[(y*800+x)*4+3]>0;if(expected!==actual)mismatch++;if(actual)covered++;
   }
   draw();return {mismatch,covered,ms:performance.now()-start};
  },{proj,frame,zoom});
  assert.equal(result.mismatch,0);if(zoom===1)assert.ok(result.covered>0);console.log(proj,frame,zoom,result);
 }
 await page.evaluate(()=>{Object.assign(ST.view,{proj:'moll',frame:'eq',lon0:0,lat0:0,zoom:1});draw();});
 await page.waitForTimeout(500);
 await page.locator('#lay-euclidWide').scrollIntoViewIfNeeded();
 await page.screenshot({path:'/tmp/possum-euclid-preview.png'});
 // Selection persists, including when the sheet is unavailable.
 await page.reload();await page.waitForFunction(()=>ST.S&&!ST.src.busy);
 assert.equal(await page.isChecked('#lay-euclidWide'),true);
 assert.equal(await page.isChecked('#lay-euclidDeep'),true);
 const [download]=await Promise.all([page.waitForEvent('download'),page.click('#exp-png')]);
 assert.match(download.suggestedFilename(),/\.png$/);
 assert.deepEqual(errors,[]);console.log('Euclid browser and PNG export checks passed');
} finally {await browser.close();}
