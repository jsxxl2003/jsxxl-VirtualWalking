'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {app,flush}=require('./app-fixture.cjs');
const key='virtualwalking_iphone_v1_lastYoutube';
test('selected YouTube video is offered after reopening without playback or motor start',async t=>{
 const storage=new Map(),first=app(t,{storage});first.loadYoutube();await flush();
 const saved=JSON.parse(storage.get(key));assert.equal(saved.id,'M7lc1UVf-VE');assert.equal(saved.title,'YouTube-Teststrecke');
 const next=app(t,{storage});await flush();
 assert.equal(next.el('videoUrl').value,'https://www.youtube.com/watch?v=M7lc1UVf-VE');
 assert.equal(next.el('linkPanel').hidden,false);assert.match(next.el('linkStatus').textContent,/Zuletzt gewählt: YouTube-Teststrecke/);
 assert.equal(next.calls.includes('youtube-play'),false);assert.equal(next.calls.includes('motor-start'),false);
 next.el('linkPanel').dispatchEvent(new Event('submit'));await flush();assert.equal(next.el('videoTitle').textContent,'YouTube-Teststrecke');
});
test('only the latest valid YouTube selection replaces the saved offer',async t=>{
 const a=app(t);a.loadYoutube();await flush();a.loadYoutube('zzzzzzzzzzz');await flush();
 assert.equal(JSON.parse(a.store.get(key)).id,'zzzzzzzzzzz');
 a.loadYoutube('invalid');await flush();a.loadVideo();assert.equal(JSON.parse(a.store.get(key)).id,'zzzzzzzzzzz');
});
test('native preferences restore the offer when web storage is empty',async t=>{
 const a=app(t,{nativeCast:true,nativeLastVideo:{id:'M7lc1UVf-VE',title:'Gespeicherte Strecke'}});await flush();
 assert.equal(a.el('videoUrl').value,'https://www.youtube.com/watch?v=M7lc1UVf-VE');assert.match(a.el('linkStatus').textContent,/Gespeicherte Strecke/);
 assert.equal(a.calls.includes('youtube-play'),false);assert.equal(a.calls.includes('cast.play'),false);
 a.loadYoutube('zzzzzzzzzzz');await flush();assert.equal(a.nativeLastVideo().id,'zzzzzzzzzzz');
});
test('a late preference response cannot replace a manually edited link',async t=>{
 let resolve;const read=new Promise(r=>resolve=r);const a=app(t,{nativeCast:true,nativeVideoRead:()=>read});
 a.el('videoUrl').value='https://youtu.be/zzzzzzzzzzz';a.el('videoUrl').dispatchEvent(new Event('input'));
 resolve({id:'M7lc1UVf-VE',title:'Alte Strecke'});await flush();assert.equal(a.el('videoUrl').value,'https://youtu.be/zzzzzzzzzzz');
});
test('malformed persisted video data is ignored',async t=>{
 const a=app(t,{storage:new Map([[key,JSON.stringify({id:'https://evil.example',title:'Falsch'})]])});await flush();assert.equal(a.el('videoUrl').value,'');assert.equal(a.calls.includes('youtube-play'),false);
});
