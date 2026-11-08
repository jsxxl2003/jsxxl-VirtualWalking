'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
const C=require('../Web/core.js');
test('native motor allowlist enforces real feature bits, target bounds and grid',t=>{
 const dir=mkdtempSync(join(tmpdir(),'vw-ftms-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const binary=join(dir,'control-test');
 const build=spawnSync('cc',['-std=c17','-Wall','-Wextra','-Werror',join(__dirname,'ftms-control.c'),'-o',binary],{encoding:'utf8'});assert.equal(build.status,0,build.stderr||build.error?.message);
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/PASS/);
});
test('speed steps use device limits and increments without wrapping or requesting zero',()=>{
 const view=bytes=>new DataView(Uint8Array.from(bytes).buffer),features=view([0,0,0,0,1,0,0,0]);
 const range=C.parseSpeedRange(features,view([50,0,88,2,10,0]));
 assert.equal(C.nextSpeed(2,1,range),2.1);assert.equal(C.nextSpeed(2,-1,range),1.9);assert.equal(C.nextSpeed(6,1,range),null);assert.equal(C.nextSpeed(.5,-1,range),null);
 assert.equal(C.nextSpeed(.1,-1,{min:0,max:600,increment:10}),null);assert.equal(C.nextSpeed(0,1,range),null);
 assert.equal(C.nextSpeed(2,1,{min:0,max:600,increment:20}),2.2);
 assert.throws(()=>C.parseSpeedRange(view([0,0,0,0,0,0,0,0]),view([50,0,88,2,10,0])));
});
