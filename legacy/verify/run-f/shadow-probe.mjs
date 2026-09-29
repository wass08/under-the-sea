import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5});
await page.addInitScript(() => {
 window.__THREE_DEVTOOLS__=new EventTarget();
 __THREE_DEVTOOLS__.addEventListener('observe',e=>{
  if(e.detail.isRenderer){ const renderer=e.detail, render=renderer.render.bind(renderer);
   renderer.render=(scene,camera,...args)=>{
    if(scene.isScene&&scene.children.length>10){window.scene=scene;window.camera=camera;
     if(window.pose){ camera.position.set(...pose);camera.lookAt(0,0.1,0);camera.updateMatrixWorld(); }
    }
    return render(scene,camera,...args);
   };
  }
 });
});
await page.goto('http://localhost:4174/?camera=34');await page.waitForFunction(()=>window.aquarium?.elapsed>2&&window.scene);
await page.evaluate(()=>{
 window.floor=scene.children.find(o=>o.geometry?.parameters?.width===10000);
 window.contact=floor.clone();contact.geometry=floor.geometry.clone();contact.geometry.scale(9/10000,6.5/10000,1);
 contact.material=floor.material.clone();contact.material.colorNode=null;contact.material.color.set('#0d1c25');contact.material.transparent=true;contact.material.opacity=.44;contact.material.depthWrite=false;
 contact.position.y=.003;contact.visible=false;scene.add(contact);
});
for(const mode of ['integrated','coplanar','raised']){
 await mkdir(`verify/run-f/probe-${mode}`,{recursive:true});
 await page.evaluate(mode=>{contact.visible=mode!=='integrated';contact.position.y=mode==='raised'?.04:.003;},mode);
 for(let i=0;i<10;i++){
  await page.evaluate(i=>{window.pose=[-7+i*.006,.30,8];},i);await page.waitForTimeout(34);
  await page.screenshot({path:`verify/run-f/probe-${mode}/${i}.png`});
 }
}
await writeFile('verify/run-f/shadow-probe-notes.txt','Depth precision probe: same 10 low-camera poses; integrated floor, synthetic second plane at .003, and at .04.\n');
await browser.close();
