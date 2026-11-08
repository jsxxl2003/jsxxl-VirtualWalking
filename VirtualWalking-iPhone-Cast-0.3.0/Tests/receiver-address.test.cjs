'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
test('native TV address parser accepts a changed receiver address and rejects malformed destinations',t=>{
 const dir=mkdtempSync(join(tmpdir(),'vw-address-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const binary=join(dir,'address-test');
 const build=spawnSync('cc',['-std=c17','-Wall','-Wextra','-Werror',join(__dirname,'receiver-address.c'),'-o',binary],{encoding:'utf8'});
 assert.equal(build.status,0,build.stderr||build.error?.message);
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/PASS/);
});
