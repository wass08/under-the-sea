import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const js=`(async()=>{
 const source=document.querySelector('#app canvas'),c=document.createElement('canvas');c.width=source.width;c.height=source.height;const ctx=c.getContext('2d',{willReadFrequently:true}),scale=c.width/innerWidth,samples=aquarium.sandSamples;
 const mean=(data,points)=>{let sum=0,n=0;for(const p of points){const x=Math.round(p.pixel.x*scale),y=Math.round(p.pixel.y*scale);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const i=((y+dy)*c.width+x+dx)*4;for(let k=0;k<3;k++){const v=data[i+k]/255;sum+=(v<=.04045?v/12.92:((v+.055)/1.055)**2.4)*[.2126,.7152,.0722][k];}n++;}}return sum/n;};
 const frames=[];for(let f=0;f<30;f++){for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);ctx.drawImage(source,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;frames.push({shadow:mean(data,samples.shadow),lit:mean(data,samples.lit)});}
 const shadow=frames.reduce((s,f)=>s+f.shadow,0)/frames.length,lit=frames.reduce((s,f)=>s+f.lit,0)/frames.length;
 return {shadow,lit,ratio:shadow/lit,darkerPercent:100*(1-shadow/lit),frames:frames.length,patchPixels:9,shadowSamples:samples.shadow.length,litSamples:samples.lit.length,samples};
})()`;
const result=JSON.parse(execFileSync('agent-browser',['--session','aquarium-lamp-followup','--json','eval',js],{encoding:'utf8',maxBuffer:4e6})).data.result;
await writeFile('verify/lighting/sand-luminance.json',JSON.stringify(result,null,2));const {samples,...summary}=result;console.log(JSON.stringify(summary));
