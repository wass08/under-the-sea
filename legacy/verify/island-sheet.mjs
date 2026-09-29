import {bundle} from './temp-build.mjs';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {scoreIsland} from './island-score.mjs';
await mkdir('verify/terrain/tiles',{recursive:true});
const {generateIslandTerrain}=await bundle('src/lib/terrain.ts');
const candidates=process.argv.includes('--render-only')?JSON.parse(await readFile('verify/terrain/seed-scores.json','utf8')).candidates:[];
for(let seed=1;!process.argv.includes('--render-only')&&seed<=240;seed++){const d=generateIslandTerrain(seed);candidates.push(scoreIsland(d,seed));d.geometry.dispose();}
candidates.sort((a,b)=>b.score-a.score);
const chosen=candidates.filter(r=>r.eligible).slice(0,9);
if(chosen.length!==9){await writeFile('verify/terrain/rejected-seeds.json',JSON.stringify(candidates,null,2));throw Error('Not enough eligible seeds');}
await writeFile('verify/terrain/seed-scores.json',JSON.stringify({searched:240,chosen,candidates},null,2));
console.table(chosen.map(r=>({...r,biomePct:r.biomePct.join(' / '),terms:undefined})));
const stats=[];for(const options of [{warp:0,erosion:0,carve:0},{erosion:0,carve:0},{carve:0},{}]){const d=generateIslandTerrain(chosen[0].seed,options);stats.push({options,...d.diagnostics});d.geometry.dispose();}
await writeFile('verify/terrain/height-stats.json',JSON.stringify(stats,null,2));console.log('Height-field ablations',JSON.stringify(stats,null,2));
if(process.argv.includes('--score-only'))process.exit(0);
const tiles=chosen;
const server=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan,UseSkiaRenderer','--use-angle=metal','--ignore-gpu-blocklist']});
try {
 const page=await browser.newPage({viewport:{width:640,height:400},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/verify/island-sheet.html`);await page.waitForFunction(()=>window.sheetReady,{timeout:60000});
 const images=[];
 for(const tile of tiles){await page.evaluate(async tile=>window.renderIsland(tile),tile);const path=`verify/terrain/tiles/${tile.baseline?'baseline-42':tile.seed}.png`;await page.screenshot({path});images.push((await readFile(path)).toString('base64'));}
 await page.setViewportSize({width:1920,height:1200});
 await page.evaluate(async images=>{document.body.innerHTML='<canvas id="sheet" width="1920" height="1200"></canvas>';const ctx=document.querySelector('canvas').getContext('2d');for(let i=0;i<images.length;i++){const img=new Image();img.src='data:image/png;base64,'+images[i];await img.decode();ctx.drawImage(img,i%3*640,Math.floor(i/3)*400);}},images);
 await page.screenshot({path:'verify/island-sheet.png'});
 if(errors.length)throw Error(errors.join('\n'));
 await writeFile('verify/terrain/sheet.json',JSON.stringify({tiles,errors},null,2));
 console.log('Contact sheet: verify/island-sheet.png');
}finally{await browser.close();await server.close();}
