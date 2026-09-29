import {chromium} from 'playwright';
const b=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});const p=await b.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5});p.on('pageerror',e=>console.error(e));p.on('console',e=>{if(e.type()==='error')console.error(e.text())});
for(const camera of ['surface','front','shore']){await p.goto('http://localhost:4174/?camera='+camera);await p.waitForFunction(()=>window.aquarium?.elapsed>2);await p.screenshot({path:'verify/run-m/look-'+camera+'.png'});}
await b.close();
