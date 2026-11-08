'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../Web/core.js'),{jointStart}=require('../Web/joint-start.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function app(t,{nativeCast=false,nativeReceiver=false,nativeBLE=false,nativeWriteWithoutResponse=false,nativeSpeedSupported=true,initialTVRate=1,canControl=true,blockedVideo=false,failedStart=false,failedControl=false,dropControlResponse=false,failedStop=false,delayedYoutubePause=false,storage=new Map(),nativeLastVideo=null,nativeVideoRead=null}={}){
 const calls=[],nativeWriteModes=[],nativeWrites=[],resumedRates=[],store=storage,timers=new Set(),intervals=new Map();let clock=1000,driver,intervalId=0,youtube,pendingYoutubePause;
 class Element extends EventTarget{
  constructor(){super();this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.checked=false;this.classList={toggle(){}};this.files=[];}
  append(){}replaceChildren(){}setAttribute(){}removeAttribute(){}load(){}focus(){}blur(){}
 }
 const elements=new Map([...fs.readFileSync(require.resolve('../Web/index.html'),'utf8').matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
 const el=id=>elements.get(id);el('referenceSpeed').value='4';el('syncEnabled').checked=true;el('pauseAtZero').checked=true;
 const video=el('video');video.paused=true;video.currentTime=0;video.playbackRate=1;
 video.play=()=>{calls.push('video-play');if(blockedVideo)return Promise.reject(Error('Blocked'));video.paused=false;queueMicrotask(()=>video.dispatchEvent(new Event('playing')));return Promise.resolve();};
 video.pause=()=>{video.paused=true;video.dispatchEvent(new Event('pause'));};
 const document=new EventTarget();document.getElementById=el;document.createElement=()=>new Element();document.createTextNode=text=>({textContent:text});document.hidden=false;
 const window=new EventTarget();
 let remoteState='paused',remoteRate=initialTVRate,remoteID=nativeReceiver?'':'M7lc1UVf-VE',remoteConnected=true;
 function sendTV(patch={}){window.dispatchEvent(new CustomEvent('vw-native',{detail:{type:'cast.status',connected:remoteConnected,applicationID:'233637DE',fresh:true,session:remoteConnected?'receiver-session':'closed',device:'Philips',media:remoteConnected?{contentID:remoteID,mediaSessionID:7,playerState:remoteState,rate:remoteRate,playingAd:false,...patch}:null}}));}
 if(nativeCast||nativeReceiver||nativeBLE){window.VirtualWalkingCast=require('../Web/cast.js');window.VirtualWalkingNative={rpc:async(method,params={})=>{
  if(method==='tv.receiver.connection')return {connected:nativeReceiver,address:'http://192.168.0.32:8765'};
  if(method.startsWith('tv.receiver.')){calls.push(method);if(method==='tv.receiver.play'){remoteID=params.id;remoteState='playing';}if(method==='tv.receiver.pause'||method==='tv.receiver.stop')remoteState='paused';if(method==='tv.receiver.resume'){resumedRates.push(remoteRate);remoteState='playing';}if(method==='tv.receiver.rate')remoteRate=params.value;return {playerReady:true,playerState:remoteState==='playing'?1:2,playerVideoId:remoteID,actualRate:remoteRate,feedbackAgeMs:0};}
  if(method==='video.last.get')return nativeVideoRead?nativeVideoRead():nativeLastVideo;
  if(method==='video.last.set'){nativeLastVideo={...params};return {};}
  if(method!=='cast.status')calls.push(method);
  if(method==='cast.play')remoteState='playing';if(method==='cast.pause')remoteState='paused';if(method==='cast.stop')remoteState='idle';if(method==='cast.rate')remoteRate=params.rate;
  if(nativeCast)queueMicrotask(()=>sendTV());return {acknowledged:true};
 }};}
window.VirtualWalkingCore=C;window.VirtualWalkingStart={jointStart};
 class Client{
  constructor(options){driver=this;this.options=options;this.connected=false;this.canControl=canControl;this.device={name:'Test-Laufband'};}
  async connect(){this.connected=true;this.options.onConnection({connected:true,name:this.device.name,id:'test',canControl:this.canControl});}
  disconnect(){if(this.connected){this.connected=false;this.options.onConnection({connected:false});}}
  async start({shouldStart,onSent}){assert.equal(shouldStart(),true);if(failedControl){calls.push('request-control');this.controlDenied=true;this.uncertainCommand=0;this.startBlockedReason='Steuerfreigabe fehlgeschlagen';throw Error('Steuerfreigabe fehlgeschlagen');}calls.push('motor-start');onSent();if(failedStart)throw Error('Start rejected');}
  async stop(pause){calls.push(pause?'motor-pause':'motor-stop');if(failedStop)throw Error('Stop rejected');}
 }
 window.VirtualWalkingBluetooth={FTMSClient:Client};
 const YT={Player:class{
  constructor(frame,{events}){youtube=this;this.events=events;this.state=2;queueMicrotask(()=>events.onReady({target:this}));}
  getVideoData(){return {title:'YouTube-Teststrecke'};}getPlayerState(){return this.state;}getPlaybackRate(){return 1;}getAvailablePlaybackRates(){return [.5,1,1.5,2];}setPlaybackRate(){}destroy(){}seekTo(){}
  playVideo(){if(this.state===1)return;calls.push('youtube-play');if(blockedVideo){queueMicrotask(()=>this.events.onAutoplayBlocked());return;}this.state=1;queueMicrotask(()=>this.events.onStateChange({data:1}));}
  pauseVideo(){if(this.state===2)return;pendingYoutubePause=()=>{this.state=2;this.events.onStateChange({data:2});};if(!delayedYoutubePause)queueMicrotask(()=>pendingYoutubePause());}
 }};window.YT=YT;
 const context={window,document,YT,location:{origin:'https://test.example'},navigator:{bluetooth:{requestDevice(){}}},localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)},performance:{now:()=>clock},AbortController,URL:class extends URL{static createObjectURL(){return 'blob:local-test';}static revokeObjectURL(){}},setTimeout:(callback,delay)=>{const timer=setTimeout(callback,delay);timers.add(timer);return timer;},clearTimeout:timer=>{clearTimeout(timer);timers.delete(timer);},setInterval:(callback,delay)=>{const id=++intervalId;intervals.set(id,{callback,delay});return id;},clearInterval:id=>intervals.delete(id),confirm:()=>false,console};
 vm.createContext(context);
 if(nativeBLE){
  const rpc=window.VirtualWalkingNative.rpc;let generation=0;
  window.navigator=context.navigator;
  window.webkit={messageHandlers:{virtualwalking:{postMessage:message=>queueMicrotask(async()=>{
   try{
    let result={};const {method,params}=message;
    if(method==='ble.choose')result={id:'native-belt',name:'WELLFIT TM Linker',generation:++generation};
    else if(method==='ble.connect')result={characteristics:[C.TREADMILL_DATA,C.MACHINE_STATUS,C.MACHINE_FEATURE,C.SPEED_RANGE,...(canControl?[C.CONTROL_POINT]:[])].map(uuid=>({uuid,properties:{read:Number([C.MACHINE_FEATURE,C.SPEED_RANGE].includes(uuid)),write:Number(uuid===C.CONTROL_POINT&&!nativeWriteWithoutResponse),writeWithoutResponse:Number(uuid===C.CONTROL_POINT&&nativeWriteWithoutResponse),notify:1,indicate:1}}))};
    else if(method==='ble.read')result={bytes:params.uuid===C.MACHINE_FEATURE?[0,0,0,0,Number(nativeSpeedSupported),0,0,0]:[50,0,88,2,10,0]};
    else if(method==='ble.write'){
     if((params.withResponse!==false)===nativeWriteWithoutResponse)throw Error('Schreibmodus wird vom Laufband nicht angeboten.');
     nativeWriteModes.push(params.withResponse!==false?'with-response':'without-response');
     nativeWrites.push(Array.from(params.bytes));const [command,reason]=params.bytes;calls.push(command===2?'motor-speed':command===0?'request-control':command===7?'motor-start':reason===2?'motor-pause':'motor-stop');
     if(!(dropControlResponse&&command===0))window.__vwNativeEvent({type:'ble.value',deviceId:'native-belt',generation:params.generation,uuid:C.CONTROL_POINT,bytes:[0x80,command,command===0&&failedControl?5:command===7&&failedStart||command===8&&failedStop?4:1]});
    }else if(!method.startsWith('ble.'))result=await rpc(method,params);
    window.__vwNativeReceive({id:message.id,ok:true,result});
   }catch(error){window.__vwNativeReceive({id:message.id,ok:false,error:{message:error.message}});}
  })}}};
  Object.assign(context,{EventTarget,Event,CustomEvent,DataView,Uint8Array,ArrayBuffer});
  vm.runInContext(fs.readFileSync(require.resolve('../Web/native-bridge.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(require.resolve('../Web/bluetooth.js'),'utf8'),context);
  const NativeClient=window.VirtualWalkingBluetooth.FTMSClient;
  window.VirtualWalkingBluetooth.FTMSClient=class extends NativeClient{constructor(options){super({...options,commandTimeout:dropControlResponse?10:15000});driver=this;}};
 }
 vm.runInContext(fs.readFileSync(require.resolve('../Web/app.js'),'utf8'),context);
 t.after(()=>{window.dispatchEvent(new Event('pagehide'));for(const timer of timers)clearTimeout(timer);});
 const packet=bytes=>{window.__vwNativeEvent({type:'ble.value',deviceId:driver.device.id,generation:driver.device.generation,uuid:C.TREADMILL_DATA,bytes});};
 return {sendTV,nativeEvent:detail=>window.dispatchEvent(new CustomEvent('vw-native',{detail})),tvVideo:id=>{remoteID=id;sendTV();},tvDisconnect:()=>{remoteConnected=false;sendTV();},tickUI:()=>{for(const {callback,delay} of intervals.values())if(delay===500)callback();},calls,nativeWriteModes,nativeWrites,resumedRates,store,el,nativeLastVideo:()=>nativeLastVideo,driver:()=>driver,click:id=>el(id).dispatchEvent(new Event('click')),loadVideo:()=>{el('fileInput').files=[{name:'Laufstrecke.mp4'}];el('fileInput').dispatchEvent(new Event('change'));},loadYoutube:(id='M7lc1UVf-VE')=>{el('videoUrl').value='https://youtu.be/'+id;el('linkPanel').dispatchEvent(new Event('submit'));},confirmYoutubePause:()=>pendingYoutubePause?.(),youtubeUserPlay:()=>youtube.playVideo(),youtubeState:()=>youtube?.state,sample:speed=>{clock+=100;if(nativeBLE){const value=Math.round(speed*100);packet([0,0,value&255,value>>8]);}else driver.options.onData({speed});for(const {callback,delay} of [...intervals.values()])if(delay===100)callback();},packet,advance:ms=>{clock+=ms;}};
}

module.exports={app,flush};
