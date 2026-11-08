'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ReceiverController,RoutedController}=require('../Web/cast.js');
const id='M7lc1UVf-VE';
test('changing the saved TV address invalidates a delayed response from the previous destination',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);
 const routed=new RoutedController({rpc:()=>pending});routed.setSource('youtube',id);
 routed.connectReceiver('http://192.168.0.32:8765');
 routed.connectReceiver('http://192.168.0.119:8765');
 resolve({playerReady:true,playerState:1,actualRate:1,playerVideoId:id,feedbackAgeMs:0});
 await new Promise(r=>setImmediate(r));assert.equal(routed.playing,false);assert.equal(routed.connected,false);
 assert.match(routed.device,/192\.168\.0\.119/);
 await routed.poll();assert.equal(routed.playing,true);
});
function fixture(){
 const calls=[];let status={playerReady:true,playerState:2,actualRate:1,playerVideoId:id,feedbackAgeMs:0};
 const controller=new ReceiverController({rpc:async(method,params)=>{
  calls.push([method,params]);
  if(method==='tv.receiver.play'){status.playerVideoId=params.id;status.playerState=1;}
  if(method==='tv.receiver.pause')status.playerState=2;
  if(method==='tv.receiver.resume')status.playerState=1;
  if(method==='tv.receiver.rate')status.actualRate=params.value;
  return {...status};
 }});
 controller.selected=true;controller.setSource('youtube',id);
 return {controller,calls,status};
}
test('direct receiver prepares and pauses video before training, then resumes and confirms tempo',async()=>{
 const {controller:c,calls}=fixture();
 await c.prepare(new AbortController().signal);
 assert.equal(c.playing,false);assert.equal(c.fresh(),true);
 assert.deepEqual(calls.filter(x=>x[0]!=='tv.receiver.status').map(x=>x[0]),['tv.receiver.play','tv.receiver.pause']);
 await c.play();assert.equal(c.playing,true);
 await c.setRate(.5);assert.equal(c.confirmedRate,.5);assert.equal(c.rate,.5);
 await c.stop();assert.equal(calls.at(-1)[0],'tv.receiver.stop');
});
test('HTTP acknowledgement cannot confirm a stale or wrong player',()=>{
 const {controller:c,status}=fixture();c.accept({...status,playerVideoId:'abcdefghijk',playerState:1});assert.equal(c.playing,false);
 c.accept({...status,feedbackAgeMs:10000,playerState:1});assert.equal(c.playing,false);
});
test('player errors prevent training preparation',async()=>{
 const {controller:c,status}=fixture();status.playerError=152;
 await assert.rejects(c.prepare(),/YouTube-Fehler 152/);
});
test('receiver route survives unrelated disconnected Cast discovery',async()=>{
 const routed=new RoutedController({rpc:async()=>({playerReady:true,playerState:2,actualRate:1,playerVideoId:id,feedbackAgeMs:0})});
 routed.setSource('youtube',id);routed.connectReceiver();await routed.poll();
 routed.receive({type:'cast.status',connected:false});
 assert.equal(routed.active,true);assert.equal(routed.route,routed.receiver);
});
test('an explicitly selected direct receiver is not replaced by a connected legacy Cast session',async()=>{
 const routed=new RoutedController({rpc:async()=>({playerReady:true,playerState:2,actualRate:1,playerVideoId:id,feedbackAgeMs:0})});
 routed.setSource('youtube',id);routed.connectReceiver();await routed.poll();
 const applies=routed.receive({type:'cast.status',connected:true,session:'old-cast',applicationID:'233637DE',device:'Old Cast TV',media:{contentID:id,mediaSessionID:7,playerState:'playing',rate:1}});
 assert.equal(routed.route,routed.receiver);assert.equal(applies,false);
});
test('a response arriving after pause cannot confirm an obsolete play operation',async()=>{
 let resolveStatus;const pending=new Promise(resolve=>{resolveStatus=resolve;});
 const c=new ReceiverController({rpc:async method=>method==='tv.receiver.status'?pending:{}});c.selected=true;c.setSource('youtube',id);
 const playing=c.play();await new Promise(resolve=>setImmediate(resolve));await c.pause();
 resolveStatus({playerReady:true,playerState:1,actualRate:1,playerVideoId:id,feedbackAgeMs:0});
 await assert.rejects(playing,/abgebrochen/);assert.equal(c.playing,false);
});
test('changing the video clears a previous receiver rate error',()=>{
 const {controller:c}=fixture();c.rateError='YouTube-Fehler 152';c.setSource('youtube','zzzzzzzzzzz');assert.equal(c.rateError,'');
});
test('an old receiver that returns only HTTP acknowledgement reports its missing player feedback',async()=>{
 const c=new ReceiverController({rpc:async()=>({receiver:'VirtualWalking-TV',state:'requested',videoId:id})});c.selected=true;c.setSource('youtube',id);
 await assert.rejects(c.play(),/TV-Empfänger aktualisieren/);
});
test('resuming an already loaded route does not reload the video from the beginning',async()=>{
 const {controller:c,calls}=fixture();await c.prepare();await c.play();await c.pause();await c.poll();await c.prepare();
 assert.equal(calls.filter(x=>x[0]==='tv.receiver.play').length,1);assert.equal(c.playing,false);
});
test('a temporary status connection failure does not permanently disable tempo control',async()=>{
 let fail=true;
 const c=new ReceiverController({rpc:async()=>{if(fail)throw Error('offline');return {playerReady:true,playerState:1,actualRate:1,playerVideoId:id,feedbackAgeMs:0};}});c.selected=true;c.setSource('youtube',id);
 await c.poll();assert.equal(c.connected,false);fail=false;await c.poll();assert.equal(c.playing,true);assert.equal(c.rateError,'');
});
