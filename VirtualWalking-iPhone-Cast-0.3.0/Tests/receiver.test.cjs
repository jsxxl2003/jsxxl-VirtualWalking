'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ReceiverController,RoutedController}=require('../Web/cast.js');
const id='M7lc1UVf-VE';
test('background polling and playback confirmation share one ordered TV request stream',async()=>{
 let active=0,maximum=0,state=2;const calls=[];
 const c=new ReceiverController({rpc:async method=>{
  calls.push(method);maximum=Math.max(maximum,++active);
  await new Promise(r=>setTimeout(r,5));
  if(method==='tv.receiver.play'||method==='tv.receiver.resume')state=1;
  if(method==='tv.receiver.pause')state=2;
  active--;return{playerReady:true,playerState:state,actualRate:1,playerVideoId:id,feedbackAgeMs:0};
 }});c.selected=true;c.setSource('youtube',id);
 await Promise.all([c.poll(),c.prepare()]);assert.equal(maximum,1);
 assert.equal(c.playing,false);assert.equal(c.fresh(),true);
 assert.ok(calls.includes('tv.receiver.pause'));
});
test('repeated pause requests are coalesced while an earlier TV request is pending',async()=>{
 let release;const gate=new Promise(r=>release=r),calls=[];
 const c=new ReceiverController({rpc:async method=>{calls.push(method);if(method==='tv.receiver.status')await gate;return{playerReady:true,playerState:2,actualRate:1,playerVideoId:id,feedbackAgeMs:0};}});
 c.selected=true;c.setSource('youtube',id);const polling=c.poll();await new Promise(r=>setImmediate(r));
 const pauses=[c.pause(),c.pause(),c.pause()];release();await polling;await Promise.all(pauses);
 assert.equal(calls.filter(x=>x==='tv.receiver.pause').length,1);
});
test('a pause cancels a queued resume before it can be sent to the TV',async()=>{
 let release;const gate=new Promise(r=>release=r),calls=[];
 const c=new ReceiverController({rpc:async method=>{calls.push(method);if(method==='tv.receiver.status')await gate;return{playerReady:true,playerState:2,actualRate:1,playerVideoId:id,feedbackAgeMs:0};}});
 c.selected=true;c.setSource('youtube',id);const polling=c.poll();await new Promise(r=>setImmediate(r));
 const playing=c.play();const failure=assert.rejects(playing,/abgebrochen/);const paused=c.pause();release();
 await polling;await failure;await paused;assert.equal(calls.includes('tv.receiver.resume'),false);
});
test('a failed HTTP command reports which TV operation failed and does not poison the pause queue',async()=>{
 const c=new ReceiverController({rpc:async method=>{if(method==='tv.receiver.play')throw Error('Zeitüberschreitung bei der Anforderung.');return{playerReady:true,playerState:2,actualRate:1,playerVideoId:id,feedbackAgeMs:0};}});
 c.selected=true;c.setSource('youtube',id);
 await assert.rejects(c.prepare(),/TV-Video laden.*Zeitüberschreitung/);await c.pause();
});
test('a second pause cancels a resume queued after the first pause',async()=>{
 let release;const gate=new Promise(r=>release=r),calls=[];
 const c=new ReceiverController({rpc:async method=>{calls.push(method);if(method==='tv.receiver.status')await gate;return{playerReady:true,playerState:2,actualRate:1,playerVideoId:id,feedbackAgeMs:0};}});
 c.selected=true;c.setSource('youtube',id);const polling=c.poll();await new Promise(r=>setImmediate(r));
 const first=c.pause().catch(()=>{}),playing=c.play(),failure=assert.rejects(playing,/abgebrochen/),second=c.pause();
 release();await polling;await first;await failure;await second;
 assert.equal(calls.includes('tv.receiver.resume'),false);
});
test('backgrounding still allows the TV pause while preventing new playback requests',async()=>{
 const {controller:c,calls}=fixture();c.suspend();await c.pause();
 assert.equal(calls.at(-1)[0],'tv.receiver.pause');await assert.rejects(c.play(),/abgebrochen/);
 assert.equal(calls.some(x=>x[0]==='tv.receiver.resume'),false);
});
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
 assert.deepEqual(calls.filter(x=>x[0]!=='tv.receiver.status').map(x=>x[0]),['tv.receiver.rate','tv.receiver.play','tv.receiver.pause']);
 await c.play();assert.equal(c.playing,true);
 await c.setRate(.5);assert.equal(c.confirmedRate,.5);assert.equal(c.rate,.5);
 await c.stop();assert.equal(calls.at(-1)[0],'tv.receiver.stop');
});
test('TV preparation resets a retained slow rate and resume applies the current walking rate first',async()=>{
 const {controller:c,calls,status}=fixture();status.actualRate=.5;
 await c.prepare();assert.equal(status.actualRate,1);
 const before=calls.length;await c.play(undefined,1.5);
 assert.deepEqual(calls.slice(before).filter(x=>x[0]!=='tv.receiver.status'),[['tv.receiver.rate',{value:1.5}],['tv.receiver.resume',{}]]);
 assert.equal(c.rate,1.5);assert.equal(c.playing,true);
});
test('normal-speed playback waits for actual 1x feedback instead of accepting a still-slow playing state',async()=>{
 let reads=0;const c=new ReceiverController({rpc:async method=>({playerReady:true,playerState:1,actualRate:method==='tv.receiver.status'&&++reads>1?1:.5,playerVideoId:id,feedbackAgeMs:0})});
 c.selected=true;c.setSource('youtube',id);await c.play(undefined,1);
 assert.equal(reads,2);assert.equal(c.rate,1);assert.equal(c.playing,true);
});
test('HTTP acknowledgement cannot confirm a stale or wrong player',()=>{
 const {controller:c,status}=fixture();c.accept({...status,playerVideoId:'abcdefghijk',playerState:1});assert.equal(c.playing,false);
 c.accept({...status,feedbackAgeMs:10000,playerState:1});assert.equal(c.playing,false);
});
test('a background TV player cannot confirm visible playback even with fresh player feedback',()=>{
 const {controller:c,status}=fixture();
 c.accept({...status,playerState:1,foreground:false});assert.equal(c.connected,true);assert.equal(c.playing,false);assert.equal(c.fresh(),false);
 c.accept({...status,playerState:1,foreground:true});assert.equal(c.playing,true);
});
test('a blocked TV foreground switch reports the permission problem before motor preparation',async()=>{
 const c=new ReceiverController({rpc:async()=>({playerReady:true,playerState:1,actualRate:1,playerVideoId:id,feedbackAgeMs:0,foreground:false,foregroundError:'TV-Empfänger läuft im Hintergrund. Über anderen Apps einblenden erlauben.'})});
 c.selected=true;c.setSource('youtube',id);
 await assert.rejects(c.prepare(),/Über anderen Apps einblenden/);assert.equal(c.playing,false);
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
 const playing=c.play();const failure=assert.rejects(playing,/abgebrochen/);await new Promise(resolve=>setImmediate(resolve));const paused=c.pause();
 resolveStatus({playerReady:true,playerState:1,actualRate:1,playerVideoId:id,feedbackAgeMs:0});
 await failure;await paused;assert.equal(c.playing,false);
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
