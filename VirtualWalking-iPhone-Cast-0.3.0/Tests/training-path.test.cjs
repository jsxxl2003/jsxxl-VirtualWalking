'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {app,flush}=require('./app-fixture.cjs');
const last={id:'M7lc1UVf-VE',title:'Gespeicherte Laufstrecke'};
test('TV videos start at normal speed below the saved reference and remain normal at steady walking speed',async t=>{
 for(const id of ['M7lc1UVf-VE','abcdefghijk']){
  const a=app(t,{nativeBLE:true,nativeReceiver:true,initialTVRate:.5});a.click('connect');await flush();a.loadYoutube(id);await flush();a.sample(0);a.click('start');await flush();a.sample(2);await flush();
  assert.equal(a.el('trainingStatus').textContent,'Aufzeichnung läuft');assert.deepEqual(a.resumedRates,[1]);assert.equal(a.tvRate(),1);
  a.advance(3200);a.sample(2);a.tickUI();await flush();
  assert.equal(a.el('referenceSpeed').value,'2');assert.equal(a.tvRate(),1);assert.equal(a.requestedRates.every(rate=>rate===1),true);
  a.sample(3);a.tickUI();await flush();assert.equal(a.tvRate(),1.5);
 }
});
test('normal video speed is held while the treadmill accelerates to a stable starting speed',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true});a.click('connect');await flush();a.loadYoutube();await flush();a.sample(0);a.click('start');await flush();a.sample(.2);await flush();
 a.advance(1000);a.sample(1);await flush();a.advance(1000);a.sample(2);await flush();a.advance(1000);a.sample(2);await flush();
 assert.equal(a.el('referenceSpeed').value,'4');assert.equal(a.tvRate(),1);assert.equal(a.requestedRates.every(rate=>rate===1),true);
 a.advance(2100);a.sample(2);a.tickUI();await flush();assert.equal(a.el('referenceSpeed').value,'2');assert.equal(a.tvRate(),1);
});
test('normal startup also supports slow walking below one km/h',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true});a.click('connect');await flush();a.loadYoutube();await flush();a.sample(0);a.click('start');await flush();a.sample(.5);await flush();
 assert.equal(a.tvRate(),1);a.advance(3200);a.sample(.5);a.tickUI();await flush();assert.equal(a.el('referenceSpeed').value,'0.5');assert.equal(a.tvRate(),1);
 a.sample(1);a.tickUI();await flush();assert.equal(a.tvRate(),2);
});
test('an explicitly edited reference is respected instead of being recalibrated',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true});a.click('connect');await flush();a.loadYoutube();await flush();a.sample(0);a.click('start');await flush();a.sample(2);await flush();
 const input=a.el('referenceSpeed');input.checkValidity=()=>true;input.value='6';input.dispatchEvent(new Event('input'));await flush();
 a.advance(3200);a.sample(2);a.tickUI();await flush();assert.equal(input.value,'6');assert.equal(a.tvRate(),.5);
});
test('disabled automatic adaptation keeps normal video speed and leaves the reference alone',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true});a.el('syncEnabled').checked=false;a.click('connect');await flush();a.loadYoutube();await flush();a.sample(0);a.click('start');await flush();a.sample(2);await flush();
 a.advance(3200);a.sample(2);a.tickUI();await flush();assert.equal(a.tvRate(),1);assert.equal(a.el('referenceSpeed').value,'4');
});
test('starting TV training at reference speed does not resume the previous half-speed playback',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true,initialTVRate:.5});a.click('connect');await flush();a.loadYoutube();await flush();a.sample(0);a.click('start');await flush();a.sample(4);await flush();
 assert.equal(a.el('trainingStatus').textContent,'Aufzeichnung läuft');assert.deepEqual(a.resumedRates,[1]);
});
test('an immediate Pause cancels a speed tap before it reaches the native motor transport',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true});a.click('connect');await flush();a.loadYoutube();await flush();a.sample(0);a.click('start');await flush();a.sample(2);await flush();
 a.click('speedUp');a.click('pause');await flush();
 assert.equal(a.nativeWrites.some(bytes=>bytes[0]===2),false);assert.deepEqual(a.nativeWrites.at(-1),[8,2]);assert.equal(a.el('trainingStatus').textContent,'Pausiert');
});
test('the two speed buttons change belt speed only during training and wait for actual telemetry',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true,nativeWriteWithoutResponse:true});
 assert.equal(a.el('speedUp').disabled,true);a.click('connect');await flush();a.loadYoutube();await flush();a.sample(0);a.click('start');await flush();a.sample(2);await flush();
 assert.equal(a.el('speedUp').disabled,false);assert.equal(a.el('speedDown').disabled,false);
 a.click('speedUp');await flush();assert.deepEqual(a.nativeWrites.at(-1),[2,210,0]);assert.equal(a.el('speed').textContent,'2,0');assert.equal(a.el('speedUp').disabled,true);
 const count=a.nativeWrites.length;a.click('speedUp');await flush();assert.equal(a.nativeWrites.length,count);
 a.sample(2.1);await flush();assert.equal(a.el('speed').textContent,'2,1');assert.equal(a.el('speedDown').disabled,false);
 a.click('speedDown');await flush();assert.deepEqual(a.nativeWrites.at(-1),[2,200,0]);a.sample(2);await flush();
 a.click('pause');await flush();assert.equal(a.el('speedUp').disabled,true);assert.equal(a.el('speedDown').disabled,true);assert.deepEqual(a.nativeWrites.at(-1),[8,2]);
});
test('speed buttons stay disabled at reported boundaries and when speed support is absent',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true});a.click('connect');await flush();a.loadYoutube();await flush();a.sample(6);await flush();
 assert.equal(a.el('speedUp').disabled,true);assert.equal(a.el('speedDown').disabled,false);a.sample(.5);await flush();assert.equal(a.el('speedDown').disabled,true);
 const b=app(t,{nativeBLE:true,nativeReceiver:true,nativeSpeedSupported:false});b.click('connect');await flush();b.loadYoutube();await flush();b.sample(2);await flush();
 assert.equal(b.el('speedUp').disabled,true);assert.match(b.el('speedControlStatus').textContent,/keine FTMS/);
});
test('the training button can start and pause a native write-without-response treadmill after actual FTMS acknowledgements',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true,nativeWriteWithoutResponse:true});a.click('connect');await flush();a.loadYoutube();await flush();a.sample(0);a.click('start');await flush();
 assert.equal(a.driver().controlGranted,true);assert.equal(a.calls.filter(x=>x==='motor-start').length,1);
 assert.notEqual(a.el('trainingStatus').textContent,'Aufzeichnung läuft');
 a.sample(2);await flush();assert.equal(a.el('trainingStatus').textContent,'Aufzeichnung läuft');
 assert.equal(a.el('controlMode').textContent,'FTMS · Steuerfreigabe bestätigt');
 a.click('pause');await flush();assert.equal(a.calls.includes('motor-pause'),true);
 assert.deepEqual(a.nativeWriteModes,['without-response','without-response','without-response']);
 assert.equal(a.el('trainingStatus').textContent,'Pausiert');
});
test('reusing a saved TV connection cannot interrupt an already running training session',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true});a.click('connect');await flush();a.loadYoutube();await flush();a.sample(3);await flush();
 const pauses=a.calls.filter(x=>x==='tv.receiver.pause').length;
 a.nativeEvent({type:'tv.receiver.connected',reuse:true,address:'http://192.168.0.32:8765'});await flush();
 assert.equal(a.el('trainingStatus').textContent,'Aufzeichnung läuft');
 assert.equal(a.calls.filter(x=>x==='tv.receiver.pause').length,pauses);
});
test('a timed out native FTMS control request remains visible after fallback to manual starting',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true,dropControlResponse:true});a.click('connect');await flush();a.loadYoutube();await flush();a.sample(0);a.click('start');
 await new Promise(r=>setTimeout(r,30));await flush();
 assert.equal(a.driver().uncertainCommand,0);assert.equal(a.el('controlIssue').hidden,false);
 assert.match(a.el('controlIssue').textContent,/Steuerfreigabe.*Keine Laufband-Bestätigung/);
 assert.equal(a.calls.includes('motor-start'),false);assert.equal(a.el('pause').disabled,false);
 a.click('pause');await flush();assert.equal(a.el('controlIssue').hidden,false);
});
test('native FTMS speed packets drive TV training even when the first packet already reports motion',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true});a.click('connect');await flush();a.loadYoutube();await flush();
 a.sample(3);await flush();assert.equal(a.el('speed').textContent,'3,0');
 assert.equal(a.el('trainingStatus').textContent,'Aufzeichnung läuft');
 assert.equal(a.calls.includes('motor-start'),false);a.tickUI();await flush();
 assert.equal(a.calls.includes('tv.receiver.rate'),true);
 a.click('pause');await flush();assert.equal(a.el('trainingStatus').textContent,'Pausiert');
 a.click('finish');await flush();assert.equal(a.calls.includes('tv.receiver.stop'),true);
});
test('training can wait for the first native speed packet instead of refusing the start',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true});a.click('connect');await flush();a.loadYoutube();await flush();a.click('start');await flush();
 assert.equal(a.el('pause').disabled,false);assert.equal(a.el('finish').disabled,false);
 assert.match(a.el('message').textContent,/Laufbanddaten|Bandbewegung/);
 assert.equal(a.calls.includes('motor-start'),false);
 a.sample(2);await flush();assert.equal(a.el('trainingStatus').textContent,'Aufzeichnung läuft');
});
test('waiting for native speed data can be cancelled and a later packet cannot restart it',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true});a.click('connect');await flush();a.loadYoutube();await flush();a.click('start');await flush();
 a.click('pause');await flush();a.sample(2);await flush();
 assert.notEqual(a.el('trainingStatus').textContent,'Aufzeichnung läuft');assert.equal(a.calls.includes('motor-start'),false);
});
test('the phone preview cannot override the selected TV playback intent',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true});a.click('connect');await flush();a.loadYoutube();await flush();
 a.youtubeUserPlay();await flush();assert.equal(a.youtubeState(),2);
 a.sample(0);a.tickUI();await flush();a.sample(3);await flush();
 assert.equal(a.el('trainingStatus').textContent,'Aufzeichnung läuft');
 assert.equal(a.calls.filter(c=>c==='youtube-play').length,1);
});
test('FTMS packets without speed cannot keep an obsolete speed alive in the workout',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true});a.click('connect');await flush();a.loadYoutube();await flush();a.sample(3);await flush();
 a.advance(6000);a.packet([1,0]);a.tickUI();await flush();
 assert.equal(a.el('speed').textContent,'—');assert.equal(a.el('trainingStatus').textContent,'Pausiert');
 assert.match(a.el('message').textContent,/Keine aktuellen Laufbanddaten/);
});
test('losing the native Bluetooth connection pauses training and the direct TV receiver',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true});a.click('connect');await flush();a.loadYoutube();await flush();a.sample(3);await flush();
 a.click('disconnect');await flush();assert.equal(a.el('trainingStatus').textContent,'Pausiert');
 assert.equal(a.calls.at(-1),'tv.receiver.pause');assert.equal(a.el('start').disabled,true);
});
