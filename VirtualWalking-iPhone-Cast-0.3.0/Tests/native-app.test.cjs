const {test}=require('node:test');const assert=require('node:assert/strict');const {app,flush}=require('./app-fixture.cjs');
test('the existing training button uses TV preparation, motor acknowledgement and TV playback',async t=>{
 const a=app(t,{nativeCast:true});a.click('connect');await flush();a.loadYoutube();await flush();a.sample(0);a.click('start');await flush();
 assert.equal(a.calls.filter(c=>c==='motor-start').length,1);
 assert.ok(a.calls.indexOf('cast.play')<a.calls.indexOf('motor-start'));
 assert.ok(a.calls.indexOf('cast.pause')<a.calls.indexOf('motor-start'));
 assert.equal(a.calls.includes('youtube-play'),false);
 a.sample(6);await flush();a.tickUI();await flush();
 assert.equal(a.el('trainingStatus').textContent,'Aufzeichnung läuft');
 assert.ok(a.calls.includes('cast.rate'));assert.match(a.el('tvStatus').textContent,/Philips/);
 a.click('pause');await flush();assert.ok(a.calls.includes('motor-pause'));assert.equal(a.el('trainingStatus').textContent,'Pausiert');
});
test('a mismatched TV video is rejected by the actual start-button handler before motor control',async t=>{
 const a=app(t,{nativeCast:true});a.click('connect');await flush();a.loadYoutube();await flush();a.tvVideo('zzzzzzzzzzz');a.sample(0);a.click('start');await flush();
 assert.equal(a.calls.includes('motor-start'),false);assert.equal(a.calls.includes('youtube-play'),false);
 assert.match(a.el('message').textContent,/dasselbe Video/);assert.equal(a.el('trainingStatus').textContent,'Bereit');
});
test('TV disconnection during a coupled start requests a motor stop and cannot resume later',async t=>{
 const a=app(t,{nativeCast:true});a.click('connect');await flush();a.loadYoutube();await flush();a.sample(0);a.click('start');await flush();
 assert.equal(a.calls.includes('motor-start'),true);a.tvDisconnect();await flush();
 assert.equal(a.calls.includes('motor-stop'),true);a.sample(6);await flush();
 assert.notEqual(a.el('trainingStatus').textContent,'Aufzeichnung läuft');assert.equal(a.calls.includes('youtube-play'),false);
});
test('moving treadmill can record after failed Request Control, and training buttons drive the direct receiver',async t=>{
 const a=app(t,{nativeReceiver:true});a.click('connect');await flush();a.loadYoutube();await flush();
 Object.assign(a.driver(),{uncertainCommand:0,startBlockedReason:'Steuerfreigabe fehlgeschlagen'});
 a.sample(2);a.click('start');await flush();
 assert.equal(a.calls.includes('motor-start'),false);
 assert.equal(a.calls.includes('tv.receiver.play'),true);
 assert.equal(a.calls.includes('tv.receiver.resume'),true);
 assert.equal(a.el('trainingStatus').textContent,'Aufzeichnung läuft');
 a.tickUI();await flush();assert.equal(a.calls.includes('tv.receiver.rate'),true);
 a.click('pause');await flush();assert.equal(a.calls.includes('tv.receiver.pause'),true);
 assert.equal(a.el('trainingStatus').textContent,'Pausiert');
 assert.equal(a.calls.includes('motor-pause'),false);
});
test('unconfirmed motor start remains blocked even if telemetry reports motion',async t=>{
 const a=app(t);a.click('connect');await flush();a.loadYoutube();await flush();
 Object.assign(a.driver(),{uncertainCommand:7,startBlockedReason:'Unklarer Laufband-Zustand'});
 a.sample(2);a.click('start');await flush();assert.equal(a.calls.includes('motor-start'),false);
 assert.equal(a.el('trainingStatus').textContent,'Bereit');
});
