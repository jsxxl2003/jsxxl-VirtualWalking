'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ReceiverController,RoutedController}=require('../Web/cast.js');
const id='M7lc1UVf-VE';
function fixture(){
 const calls=[];let status={playerState:2,actualRate:1,playerVideoId:id,feedbackAgeMs:0};
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
 await c.stop();assert.equal(calls.at(-1)[0],'tv.receiver.pause');
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
 const routed=new RoutedController({rpc:async()=>({playerState:2,actualRate:1,playerVideoId:id,feedbackAgeMs:0})});
 routed.setSource('youtube',id);routed.connectReceiver();await routed.poll();
 routed.receive({type:'cast.status',connected:false});
 assert.equal(routed.active,true);assert.equal(routed.route,routed.receiver);
});
