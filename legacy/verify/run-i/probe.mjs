import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
// Baseline/rounded modes report experiments; current modes enforce acceptance.
const variant = process.argv[2] || 'after';
assert.ok(['before', 'after', 'instant', 'settled-cracks', 'rounded'].includes(variant));
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
const browser = await chromium.launch({headless:true}); const page = await browser.newPage();
await page.route('**/probe-blank.html', route => route.fulfill({contentType:'text/html',body:'<!doctype html><title>Physics probe</title>'}));
try {
await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/verify/probe-blank.html`);
const result = await page.evaluate(async variant => {
 const root = variant === 'before' ? '/verify/run-i/before/src' : variant === 'rounded' ? '/verify/run-i/variants/'+variant+'/src' : '/src';
 const {createTank} = await import(root + '/scene/tank.ts');
 const {Scene,Vector3,Box3,Quaternion} = await import('/node_modules/three/build/three.webgpu.js');
 const physicsSource = await (await fetch(root + '/lib/physics.ts')).text();
 const R = (await import(physicsSource.match(/from "([^"]*rapier[^"]*)"/)[1])).default;
 const results=[];
 for(const walls of [1,4]) {
  const tank=await createTank(new Scene());
  for(let i=0;i<240;i++)tank.update(1/120);
  const points=[new Vector3(.6,1.75,1.775),new Vector3(0,1.5,-1.775),new Vector3(3.025,1.5,0),new Vector3(-3.025,1.5,0)];
  for(let w=0;w<walls;w++)tank.crack(points[w],w);
  if((walls===1 && variant !== 'instant') || variant === 'settled-cracks')for(let i=0;i<1320;i++)tank.update(1/120);
  const old=((walls===1 && variant !== 'instant') || variant==='settled-cracks') ? tank.shards.length : 0; tank.shatter(points[0],0);
  const pose=()=>tank.shards.flatMap(s=>[...s.mesh.position.toArray(),...s.mesh.quaternion.toArray()]);
  const masses=tank.shards.map(s=>{return s.body.mass();});
  const initialAngular = tank.shards.map(s=>{const w=s.body.angvel();return Math.hypot(w.x,w.y,w.z)});
  const colliders=tank.shards.flatMap((s,i)=>Array.from({length:s.body.numColliders()},(_,j)=>({c:s.body.collider(j),i})));
  const boxes=colliders.map(({c})=>{const box=new Box3(), p=new Vector3(),q=new Quaternion().copy(c.rotation()), at=c.translation(), vertices=c.vertices();for(let i=0;i<vertices.length;i+=3)box.expandByPoint(p.fromArray(vertices,i).applyQuaternion(q).add(at));if(c.shape.borderRadius)box.expandByScalar(c.shape.borderRadius); box.expandByScalar(c.contactSkin());return box;});
  let candidates=0,overlaps=0,marginOverlaps=0,staticOverlaps=0,maxPenetration=0;
  for(let i=0;i<colliders.length;i++)for(let j=i+1;j<colliders.length;j++){
    if(colliders[i].i===colliders[j].i || (colliders[i].i<old&&colliders[j].i<old) || !boxes[i].intersectsBox(boxes[j]))continue;
    candidates++;const c=colliders[i].c.contactCollider(colliders[j].c,colliders[i].c.contactSkin()+colliders[j].c.contactSkin());
    if(c && c.distance < colliders[i].c.contactSkin()+colliders[j].c.contactSkin()-1e-5)marginOverlaps++;
    if(c&&c.distance < -1e-5){overlaps++;maxPenetration=Math.max(maxPenetration,-c.distance);}
  }
  const statics=[[[0,-.54,0],[20,.12,20]],[[0,-.21,0],[3.2,.21,1.95]],[[0,.08,0],[3.09,.08,1.84]]];
  if(walls===1)statics.push([[0,1.91,-1.75],[3,1.75,.025]],[[3,1.91,0],[.025,1.75,1.75]],[[-3,1.91,0],[.025,1.75,1.75]]);
  for(const {c,i} of colliders)if(i>=old)for(const [p,h] of statics){const contact=c.contactShape(new R.Cuboid(...h),{x:p[0],y:p[1],z:p[2]},{x:0,y:0,z:0,w:1},0);if(contact&&contact.distance < -1e-5)staticOverlaps++;}
  let p3,p4,awake5, maxTravel=0,maxRotation=0;
  const track=[];
  for(let i=1;i<=600;i++){
   tank.update(1/120);
   if(i===360)p3=pose();if(i===480)p4=pose();
   if(i%60===0)track.push({t:i/120,awake:tank.awakeCount});
   if(i>=360&&i<=480){const now=pose();for(let j=0;j<p3.length;j+=7){maxTravel=Math.max(maxTravel,Math.hypot(...now.slice(j,j+3).map((v,k)=>v-p3[j+k])));const a=p3.slice(j+3,j+7),b=now.slice(j+3,j+7);const dot=a.reduce((s,v,k)=>s+v*b[k],0)/Math.hypot(...a)/Math.hypot(...b);maxRotation=Math.max(maxRotation,2*Math.acos(Math.min(1,Math.abs(dot))));}}
  }
  awake5=tank.awakeCount;
  results.push({walls,bodies:tank.shards.length,massRange:[Math.min(...masses),Math.max(...masses)],initialAngularRange:[Math.min(...initialAngular),Math.max(...initialAngular)],spawn:{candidates,overlaps,marginOverlaps,staticOverlaps,maxPenetration},skinRange:[Math.min(...colliders.map(v=>v.c.contactSkin())),Math.max(...colliders.map(v=>v.c.contactSkin()))],movers:tank.shards.map((s,i)=>({i,mass:masses[i],travel:Math.hypot(...p4.slice(i*7,i*7+3).map((v,k)=>v-p3[i*7+k])),p:s.mesh.position.toArray(),v:s.body.linvel(),w:s.body.angvel()})).sort((a,b)=>b.travel-a.travel).slice(0,8),window3to4:{maxTravel,maxRotation},awake5,track,diagnostics:tank.diagnostics});
  tank.reset();
 }
 return results;
},variant);
console.log(JSON.stringify(result,null,2)); await writeFile(`verify/run-i/${variant}-physics.json`,JSON.stringify(result,null,2)); 
if (!['before', 'rounded'].includes(variant)) for (const r of result) {
 assert.equal(r.spawn.overlaps, 0); assert.equal(r.spawn.marginOverlaps, 0); assert.equal(r.spawn.staticOverlaps, 0);
 assert.ok(r.window3to4.maxTravel < 0.002); assert.ok(r.window3to4.maxRotation < 0.01); assert.equal(r.awake5, 0);
 assert.equal(r.diagnostics.fixedFallbacks, 0);
}
} finally { await browser.close(); await server.close(); }
