import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5});
await page.addInitScript(() => {
  window.__THREE_DEVTOOLS__ = new EventTarget();
  __THREE_DEVTOOLS__.addEventListener('observe', e => {
    const object=e.detail;
    if (object.isRenderer) {
      window.debugRenderer=object;
      const render=object.render.bind(object);
      object.render=(scene,camera,...args)=>{if(scene.isScene && scene.children.length>10){window.debugScene=scene;window.debugCamera=camera;} return render(scene,camera,...args);};
    }
  });
});
await page.goto('http://localhost:4174/?camera=34');
await page.waitForFunction(()=>window.aquarium?.elapsed>2 && window.debugScene);
const info=await page.evaluate(()=>{
 const scene=debugScene;
 return scene.children.map((o,i)=>({i,type:o.type,geometry:o.geometry?.type,parameters:o.geometry?.parameters,material:o.material?.type,receiveShadow:o.receiveShadow,castShadow:o.castShadow,y:o.position.y}));
});
await writeFile('verify/run-f/before-scene.json',JSON.stringify(info,null,2));
for(const variant of ['original','no-contact','no-sun-shadow','raised-contact']){
 await mkdir(`verify/run-f/shadow-${variant}`,{recursive:true});
 await page.evaluate(v=>{
  const contact=debugScene.children.find(o=>o.geometry?.parameters?.width===9);
  contact.visible=v!=='no-contact';contact.position.y=v==='raised-contact'?0.04:0.003;
  debugScene.children.filter(o=>o.isDirectionalLight).forEach(o=>o.castShadow=v!=='no-sun-shadow');
 },variant);
 for(let i=0;i<10;i++){
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  await page.screenshot({path:`verify/run-f/shadow-${variant}/${i}.png`});
 }
}
await browser.close();
