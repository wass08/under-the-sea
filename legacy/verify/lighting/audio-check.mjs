import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const run=(...args)=>JSON.parse(execFileSync('agent-browser',['--session','aquarium-lamp-audio','--json',...args],{encoding:'utf8',maxBuffer:4e6}));
const evaluate=js=>run('eval',js).data.result;
const read=()=>evaluate('({on:aquarium.lampOn,done:aquarium.lampSequenceDone,time:aquarium.lampSequenceTime,audio:aquarium.audio,cracks:aquarium.cracks})');
const report={};
try {
 run('--webgpu','open','about:blank');run('set','viewport','1920','1080');run('open','http://localhost:4174/?camera=lamp-base');run('wait','--fn','aquarium.lampSequenceDone&&aquarium.lampOn===1');
 report.startup=read();assert.equal(report.startup.audio.lampPlays,0);assert.equal(report.startup.audio.contextState,'suspended');
 const p=evaluate('aquarium.lampSwitch');run('mouse','move',String(Math.round(p.x)),String(Math.round(p.y)));run('mouse','down');run('mouse','up');run('wait','--fn','aquarium.lampOn===0');
 report.click=read();assert.equal(report.click.audio.lampPlays,1);assert.equal(report.click.audio.lastLamp.on,false);assert.equal(report.click.cracks,0);
 run('press','l');run('wait','--fn','aquarium.lampOn===1');report.key=read();assert.equal(report.key.audio.lampPlays,2);assert.equal(report.key.audio.lastLamp.on,true);
 run('press','m');run('press','l');run('wait','--fn','aquarium.lampOn===0');report.muted=read();assert.equal(report.muted.audio.lampPlays,2);assert.equal(report.muted.audio.muted,true);
 run('press','r');evaluate('new Promise(r=>setTimeout(r,1400))');report.reset=read();assert.equal(report.reset.on,0);assert.equal(report.reset.done,true);assert.ok(report.reset.time>report.muted.time);
 run('press','m');run('press','l');run('wait','--fn','aquarium.lampOn===1');report.unmuted=read();assert.equal(report.unmuted.audio.lampPlays,3);
 report.errors=run('errors').data.errors;assert.deepEqual(report.errors,[]);
 await writeFile('verify/lighting/audio-check.json',JSON.stringify(report,null,2));
 console.log('Lamp audio: PASS (locked startup silent; rocker OFF and L ON play; M suppresses voices; R does not replay startup; unmute restores clack)');
}finally{run('close');}
