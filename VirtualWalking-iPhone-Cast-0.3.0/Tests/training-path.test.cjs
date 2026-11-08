'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {app,flush}=require('./app-fixture.cjs');
const last={id:'M7lc1UVf-VE',title:'Gespeicherte Laufstrecke'};
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
test('the TV menu prepares the saved video on the shared training route, without starting a workout',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true,nativeLastVideo:last});await flush();
 a.nativeEvent({type:'training.action',action:'prepare-tv',video:last});await flush();
 assert.equal(a.calls.includes('tv.receiver.play'),true);assert.equal(a.calls.includes('tv.receiver.pause'),true);
 assert.equal(a.calls.includes('tv.receiver.resume'),false);assert.equal(a.calls.includes('motor-start'),false);
 assert.equal(a.el('trainingStatus').textContent,'Bereit');assert.match(a.el('message').textContent,/Laufband verbinden/);
 a.click('connect');await flush();a.sample(0);a.click('start');await flush();
 assert.equal(a.calls.includes('motor-start'),true);a.sample(4);await flush();
 assert.equal(a.el('trainingStatus').textContent,'Aufzeichnung läuft');
 a.nativeEvent({type:'training.action',action:'pause'});await flush();assert.equal(a.el('trainingStatus').textContent,'Pausiert');
 assert.equal(a.calls.includes('motor-pause'),true);
 a.nativeEvent({type:'training.action',action:'resume'});await flush();assert.equal(a.el('trainingStatus').textContent,'Aufzeichnung läuft');
});
test('TV menu resume without a Bluetooth connection cannot play independently',async t=>{
 const a=app(t,{nativeBLE:true,nativeReceiver:true});await flush();a.nativeEvent({type:'training.action',action:'resume'});await flush();
 assert.equal(a.calls.includes('tv.receiver.resume'),false);assert.match(a.el('message').textContent,/Laufband verbinden/);
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
