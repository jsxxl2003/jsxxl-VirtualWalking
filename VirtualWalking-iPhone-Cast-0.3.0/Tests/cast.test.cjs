const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CastController,videoID}=require('../Web/cast.js');
const {jointStart}=require('../Web/joint-start.js');
const core=require('../Web/core.js');
const id='abcdefghijk';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function status(patch={}){return {type:'cast.status',connected:true,applicationID:'233637DE',session:'receiver-session',device:'PHILIPS_TV_55PUS8079/12',fresh:true,media:{contentID:id,mediaSessionID:7,playerState:'playing',rate:1,playingAd:false,...patch}};}
function controller(rpc=async()=>({acknowledged:true})){const tv=new CastController({rpc,now:()=>0,timeout:25});tv.setSource('youtube',id);tv.receive(status());return tv;}

test('matches only a real YouTube ID or an allowed YouTube URL',()=>{
 assert.equal(videoID('https://youtu.be/'+id),id);
 assert.equal(videoID('https://www.youtube.com/watch?v='+id),id);
 assert.equal(videoID('https://example.com/watch?v='+id),null);
 assert.equal(videoID('https://youtube.com.evil.invalid/watch?v='+id),null);
});
test('TV mismatch prevents every motor command, including Request Control',async()=>{
 const calls=[];const tv=controller(async(method)=>calls.push(method));tv.receive(status({contentID:'zzzzzzzzzzz'}));
 await assert.rejects(jointStart({signal:new AbortController().signal,prepareVideo:s=>tv.prepare(s),isMoving:()=>false,allowStart:()=>true,driver:{start:async()=>calls.push('motor')},waitForMotion:async()=>{},playVideo:s=>tv.play(s),beginRecording:()=>calls.push('record')}),/dasselbe Video/);
 assert.deepEqual(calls,[]);
});
test('acknowledgement and a cached playing state cannot unlock the motor',async()=>{
 const calls=[];const tv=controller(async method=>calls.push(method));
 await assert.rejects(jointStart({signal:new AbortController().signal,prepareVideo:s=>tv.prepare(s),isMoving:()=>false,allowStart:()=>true,driver:{start:async()=>calls.push('motor')},waitForMotion:async()=>{},playVideo:s=>tv.play(s),beginRecording:()=>calls.push('record')}),/nicht bestätigt/);
 assert.deepEqual(calls,['cast.play']);
});
test('TV prepare, motor motion and TV playback are confirmed in order',async()=>{
 const calls=[];let tv,moving=false;
 tv=controller(async(method,params)=>{calls.push(method);tv.receive(status({playerState:method==='cast.pause'?'paused':'playing',rate:params.rate||1}));return {acknowledged:true};});
 await jointStart({signal:new AbortController().signal,prepareVideo:s=>tv.prepare(s),isMoving:()=>moving,allowStart:()=>!moving,driver:{start:async()=>{calls.push('motor.start');moving=true;}},waitForMotion:async()=>calls.push('motion'),playVideo:s=>tv.play(s),beginRecording:()=>calls.push('record')});
 await tv.setRate(core.targetRate(6,4));
 assert.deepEqual(calls,['cast.play','cast.pause','motor.start','motion','cast.play','record','cast.rate']);
 assert.equal(tv.confirmedRate,1.5);
});
test('same-clock cached rate plus request ACK never counts as rate confirmation',async()=>{
 const tv=controller();tv.receive(status({rate:1.5}));await tv.setRate(1.5);
 assert.equal(tv.confirmedRate,null);assert.match(tv.rateError,/nicht bestätigt/);
});
test('rejected rate is reported once rather than retried on every telemetry update',async()=>{
 let calls=0;const tv=controller(async()=>{calls++;throw Error('Receiver lehnt Tempo ab.');});
 await tv.setRate(1.5);await tv.setRate(1.5);await tv.setRate(.75);
 assert.equal(calls,1);assert.equal(tv.confirmedRate,null);assert.match(tv.rateError,/lehnt Tempo ab/);
});
test('a new media session invalidates an outstanding rate request for the same video',async()=>{
 let release;const tv=controller(()=>new Promise(resolve=>release=resolve));const request=tv.setRate(1.5);
 tv.receive(status({mediaSessionID:8,rate:1.5}));release({acknowledged:true});await request;
 assert.equal(tv.confirmedRate,null);assert.equal(tv.rateError,'');
});
test('disconnect keeps TV intent and blocks a silent fallback to local video',async()=>{
 const tv=controller();tv.receive({type:'cast.status',session:'closed',connected:false,media:null});
 assert.equal(tv.active,true);assert.equal(tv.fresh(),false);await assert.rejects(tv.prepare(new AbortController().signal));
});
test('receiver, advertising and stale snapshots all block playback control',async()=>{
 for(const message of [{...status(),applicationID:'CC1AD845'},status({playingAd:true}),{...status(),fresh:false}]){
  let calls=0;const tv=controller(async()=>calls++);tv.receive(message);await assert.rejects(tv.play());assert.equal(calls,0);
 }
});
test('abort between request and receiver status prevents recording and motor start',async()=>{
 const abort=new AbortController(),calls=[];const tv=controller(async(method)=>{calls.push(method);abort.abort();return {};});
 await assert.rejects(jointStart({signal:abort.signal,prepareVideo:s=>tv.prepare(s),isMoving:()=>false,allowStart:()=>true,driver:{start:async()=>calls.push('motor')},waitForMotion:async()=>{},playVideo:s=>tv.play(s),beginRecording:()=>calls.push('record')}),/abgebrochen/);
 assert.deepEqual(calls,['cast.play']);
});
test('backgrounding invalidates feedback; resuming requires a fresh TV response',async()=>{
 const tv=controller();tv.suspend();assert.equal(tv.fresh(),false);await assert.rejects(tv.play());tv.resume();assert.equal(tv.fresh(),false);tv.receive(status());assert.equal(tv.fresh(),true);
});
test('pending rate updates are coalesced and can only confirm their own epoch',async()=>{
 let release,calls=0;const tv=controller(()=>{calls++;return new Promise(resolve=>release=resolve);});
 const first=tv.setRate(1.5);await tv.setRate(.75);assert.equal(calls,1);
 tv.receive(status({rate:1.5}));release({});await first;assert.equal(tv.confirmedRate,1.5);
});
