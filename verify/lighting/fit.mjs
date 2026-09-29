import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BoxGeometry,Frustum,Matrix4,Vector3} from 'three/webgpu';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {bundle} from '../temp-build.mjs';
const {lampLight:light,head,aim}=await bundle('src/scene/lighting.ts',[{name:'lamp-fit',transform:(code,id)=>id.endsWith('/src/scene/lighting.ts')?code+'\nexport {lampLight,head,aim};':null}]);
const {TANK,STAGE_Y}=await bundle('src/state.ts'),source=await readFile('src/scene/stage.ts','utf8');
// Instantiate the production rounded-box expression, including its bevel vertices.
const expression=source.match(/new RoundedBoxGeometry\([^\n]+?\)/)[0],geometry=new Function('RoundedBoxGeometry','TANK','STAGE_Y',`return ${expression}`)(RoundedBoxGeometry,TANK,STAGE_Y);
light.position.copy(head);light.target.position.copy(aim);light.updateMatrixWorld();light.target.updateMatrixWorld();light.shadow.updateMatrices(light);
const camera=light.shadow.camera,frustum=new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)),axis=aim.clone().sub(head).normalize(),p=new Vector3(),attr=geometry.getAttribute('position');let outside=0,maxAngle=0;
for(let i=0;i<attr.count;i++){p.fromBufferAttribute(attr,i);p.y+=STAGE_Y/2;if(!frustum.containsPoint(p))outside++;maxAngle=Math.max(maxAngle,p.sub(head).angleTo(axis)*180/Math.PI);}
assert.equal(outside,0);assert.ok(camera.fov/2-maxAngle>1);
console.log(`Spot fit: PASS ${attr.count} rounded-box vertices, ${outside} outside shadow frustum, max angle ${maxAngle.toFixed(3)}°, cone ${(light.angle*180/Math.PI).toFixed(1)}°, shadow half-FOV ${(camera.fov/2).toFixed(1)}°, margin ${(camera.fov/2-maxAngle).toFixed(3)}°`);geometry.dispose();

// Also cover the upper tank plinth; its top is above the rounded stage base.
const tankSource=await readFile('src/scene/tank.ts','utf8'),upperExpression=tankSource.match(/const plinth = new Mesh\((new BoxGeometry\([^\n]+?\))/)[1];
const upper=new Function('BoxGeometry','TANK',`return ${upperExpression}`)(BoxGeometry,TANK),vertices=upper.getAttribute('position');let upperOutside=0;
for(let i=0;i<vertices.count;i++){p.fromBufferAttribute(vertices,i);p.y+=.08;if(!frustum.containsPoint(p))upperOutside++;}
assert.equal(upperOutside,0);console.log(`Upper plinth fit: PASS ${vertices.count} vertices, ${upperOutside} outside shadow frustum`);upper.dispose();
