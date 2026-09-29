import { chromium } from 'playwright';
import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const variant=process.argv[2]||'after';
assert.ok(['before','after'].includes(variant));
const server=await createServer({logLevel:'silent',server:{host:'127.0.0.1',port:0,hmr:false}}); await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage();
await page.route('**/src/scene/tank.ts',async route=>{const response=await route.fetch();const code=await response.text();await route.fulfill({response,body:code.replace(/Math.min\(strength, 0?\.75\)/,'Math.min(strength, 1)')});});
await page.route('**/probe-blank.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><style>canvas{width:800px;height:600px}</style><canvas width="800" height="600"></canvas>'}));
try {
await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probe-blank.html`);
const results=await page.evaluate(async variant=>{
 const root=variant==='before'?'/verify/run-o/before/src':'/src';
 const {Scene,Group,PerspectiveCamera,Vector3,Box3,Quaternion}=await import('/node_modules/three/build/three.webgpu.js');
 const {TANK}=await import(root+'/state.ts');
 const {createTank}=await import(root+'/scene/tank.ts');
 const {createShatterBench}=await import(root+'/lab/shatter.ts');
 const source=await(await fetch(root+'/lib/physics.ts')).text(); const R=(await import(source.match(/from "([^"]*rapier[^"]*)"/)[1])).default;
 const samples=[];let bodies=[], previouslyResting=new Set();const owners=new WeakMap();
 const create=R.World.prototype.createRigidBody;
 R.World.prototype.createRigidBody=function(...args){const b=create.apply(this,args);bodies.push(b);owners.set(b,this);return b;};
 const stats=(values)=>{values.sort((a,b)=>a-b);return{min:values[0],median:values[Math.floor(values.length/2)],max:values.at(-1)}};
 const magnitude=v=>Math.hypot(v.x,v.y,v.z);
 async function measure(name,launch,update,dispose,poses,reference){
  bodies=[]; previouslyResting=new Set(); await launch();const shards=bodies.filter(b=>b.isValid() && b.isDynamic());
  const radialFraction=shards.map(b=>{const {impact,normal}=reference(b),radial=new Vector3().copy(b.worldCom()).sub(impact),v=b.linvel();radial.addScaledVector(normal,-radial.dot(normal)).normalize();return Math.abs(new Vector3().copy(v).dot(radial))/Math.max(1e-8,magnitude(v))});
  const t0={radialFraction:radialFraction.reduce((a,b)=>a+b,0)/shards.length,speed:stats(shards.map(b=>magnitude(b.linvel()))),angular:stats(shards.map(b=>magnitude(b.angvel()))),mass:stats(shards.map(b=>b.mass()))};
  const restingAtRelease=new Set([...previouslyResting,...shards.filter(b=>b.isSleeping()).map(b=>b.handle)]);
  const cols=shards.flatMap((b,i)=>Array.from({length:b.numColliders()},(_,j)=>({c:b.collider(j),i})));
  const boxes=cols.map(({c})=>{const box=new Box3(),p=new Vector3(),q=new Quaternion().copy(c.rotation()),at=c.translation(),v=c.vertices();for(let i=0;i<v.length;i+=3)box.expandByPoint(p.fromArray(v,i).applyQuaternion(q).add(at));box.expandByScalar(c.contactSkin() + (c.shape.borderRadius ?? 0));return box});
  let overlap=0,skinOverlap=0;for(let i=0;i<cols.length;i++)for(let j=i+1;j<cols.length;j++){if(cols[i].i===cols[j].i || (restingAtRelease.has(shards[cols[i].i].handle) && restingAtRelease.has(shards[cols[j].i].handle)) || !boxes[i].intersectsBox(boxes[j]))continue;const skin=cols[i].c.contactSkin()+cols[j].c.contactSkin(),c=cols[i].c.contactCollider(cols[j].c,skin);if(c?.distance< -1e-5)overlap++;if(c?.distance<skin-1e-5)skinOverlap++;}
  let staticOverlap=0;const statics=[];owners.get(shards[0]).forEachCollider(c=>{if(c.parent()?.isFixed())statics.push(c)});
  for(const {c,i} of cols)if(!restingAtRelease.has(shards[i].handle))for(const fixed of statics){const contact=c.contactCollider(fixed,0);if(contact?.distance < -1e-5)staticOverlap++;}
  let p3,maxDisplacement=0,maxRotation=0;const motion=shards.map((b,i)=>({i,mass:b.mass(),displacement:0,rotation:0}));const track=[];
  for(let i=1;i<=600;i++){
   update(1/120);const now=poses();if(i===360)p3=now;
   if(i>=360&&i<=480)for(let j=0;j<p3.length;j++){const a=p3[j],b=now[j];const d=Math.hypot(...b.slice(0,3).map((v,k)=>v-a[k]));motion[j].displacement=Math.max(motion[j].displacement,d);maxDisplacement=Math.max(maxDisplacement,d);const q=a.slice(3),r=b.slice(3),dot=q.reduce((s,v,k)=>s+v*r[k],0)/Math.hypot(...q)/Math.hypot(...r);const angle=2*Math.acos(Math.min(1,Math.abs(dot)));motion[j].rotation=Math.max(motion[j].rotation,angle);maxRotation=Math.max(maxRotation,angle);}
   if(i%60===0)track.push({time:i/120,awake:shards.filter(b=>!b.isSleeping()).length});
  }
  samples.push({name,count:shards.length,t0,spawn:{overlap,skinOverlap,staticOverlap,existingRestingBodies:restingAtRelease.size},window3to4:{maxDisplacement,maxRotation},largestMotion:motion.sort((a,b)=>b.displacement-a.displacement).slice(0,5).map(m=>({...m,pose3:p3[m.i],pose5:poses()[m.i]})),movers:shards.map(b=>({p:b.translation(),v:b.linvel(),w:b.angvel(),damping:b.linearDamping(),angularDamping:b.angularDamping()})).filter(s=>Math.hypot(s.v.x,s.v.y,s.v.z)>.0001||Math.hypot(s.w.x,s.w.y,s.w.z)>.0001),awake5:shards.filter(b=>!b.isSleeping()).length,fixedFallbacks:shards.filter(b=>!b.isDynamic()).length,track});dispose();
 }
 for(const walls of (variant==='before'?[1,4]:[1,4,'settled-crack','rendered-crack'])){
  const tank=await createTank(new Scene()); if(walls==='rendered-crack')for(let i=0;i<240;i++)tank.update(1/120);
  const points=[new Vector3(.6,TANK.base-.84,TANK.depth/2+.025),new Vector3(0,TANK.base-.84,-TANK.depth/2-.025),new Vector3(TANK.width/2+.025,TANK.base-.84,0),new Vector3(-TANK.width/2-.025,TANK.base-.84,0)];
  await measure('main-'+walls+'-wall',()=>{if(walls===4)for(let i=0;i<4;i++)tank.crack(points[i],i);if(walls==='settled-crack'||walls==='rendered-crack'){tank.crack(points[0],0);for(let i=0;i<(walls==='rendered-crack'?1300:2640);i++)tank.update(1/120);}previouslyResting=new Set(tank.shards.filter(s=>s.body.isSleeping()).map(s=>s.body.handle));tank.shatter(points[0],0)},dt=>tank.update(dt),()=>tank.reset(),()=>tank.shards.map(s=>[...s.mesh.position.toArray(),...s.mesh.quaternion.toArray()]),body=>{const wall=tank.shards.find(s=>s.body===body).wall,o=tank.openings.find(o=>o.wall===wall);return {impact:o.point,normal:o.normal}});
 }
 for(const level of [1,2,3]){
  const rootGroup=new Group(),camera=new PerspectiveCamera(45,800/600,.1,100),canvas=document.querySelector('canvas');
  const pane={addBinding(){return this},addFolder(){return this},addButton(){return this},on(){return this},refresh(){}};
  const bench=await createShatterBench({scene:new Scene(),root:rootGroup,camera,controls:{target:new Vector3()},renderer:{domElement:canvas},pane,hint:document.createElement('div'),settings:{},level});
  camera.lookAt(0,1.05,0);camera.updateMatrixWorld();rootGroup.updateMatrixWorld(true);
  await measure('lab-L'+level,()=>{const p=bench.diagnostics().paneCenter;for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new PointerEvent(type,{button:0,clientX:p.x,clientY:p.y}));assertBroken();},dt=>bench.update(dt),()=>bench.dispose(),()=>bench.diagnostics().shardTransforms,()=>{const [x,y]=bench.diagnostics().impact;return {impact:new Vector3(x,y+1.25,0),normal:new Vector3(0,0,1)}});
  function assertBroken(){if(!bench.diagnostics().broken)throw Error('Probe did not hit Lab pane')}
 }
 R.World.prototype.createRigidBody=create;return samples;
},variant);
await writeFile(`verify/run-o/experiments/spin1-${variant}-physics.json`,JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
if(variant!=='before')for(const r of results){assert.ok(r.window3to4.maxDisplacement<.002,r.name+' displacement');assert.ok(r.window3to4.maxRotation<.01,r.name+' rotation');assert.equal(r.awake5,0,r.name+' awake');assert.equal(r.fixedFallbacks,0);assert.equal(r.spawn.overlap,0);assert.equal(r.spawn.skinOverlap,0);assert.equal(r.spawn.staticOverlap,0);}
} finally{await browser.close();await server.close()}
