'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../Web/core.js'),{jointStart}=require('../Web/joint-start.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function app(t,{nativeCast=false,canControl=true,blockedVideo=false,failedStart=false,failedStop=false,delayedYoutubePause=false,storage=new Map(),nativeLastVideo=null,nativeVideoRead=null}={}){
 const calls=[],store=storage,timers=new Set(),intervals=new Map();let clock=1000,driver,intervalId=0,youtube,pendingYoutubePause;
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
 let remoteState='paused',remoteRate=1,remoteID='M7lc1UVf-VE',remoteConnected=true;
 function sendTV(patch={}){window.dispatchEvent(new CustomEvent('vw-native',{detail:{type:'cast.status',connected:remoteConnected,applicationID:'233637DE',fresh:true,session:remoteConnected?'receiver-session':'closed',device:'Philips',media:remoteConnected?{contentID:remoteID,mediaSessionID:7,playerState:remoteState,rate:remoteRate,playingAd:false,...patch}:null}}));}
 if(nativeCast){window.VirtualWalkingCast=require('../Web/cast.js');window.VirtualWalkingNative={rpc:async(method,params={})=>{
  if(method==='video.last.get')return nativeVideoRead?nativeVideoRead():nativeLastVideo;
  if(method==='video.last.set'){nativeLastVideo={...params};return {};}
  if(method!=='cast.status')calls.push(method);
  if(method==='cast.play')remoteState='playing';if(method==='cast.pause')remoteState='paused';if(method==='cast.stop')remoteState='idle';if(method==='cast.rate')remoteRate=params.rate;
  queueMicrotask(()=>sendTV());return {acknowledged:true};
 }};}
window.VirtualWalkingCore=C;window.VirtualWalkingStart={jointStart};
 class Client{
  constructor(options){driver=this;this.options=options;this.connected=false;this.canControl=canControl;this.device={name:'Test-Laufband'};}
  async connect(){this.connected=true;this.options.onConnection({connected:true,name:this.device.name,id:'test',canControl:this.canControl});}
  disconnect(){if(this.connected){this.connected=false;this.options.onConnection({connected:false});}}
  async start({shouldStart,onSent}){assert.equal(shouldStart(),true);calls.push('motor-start');onSent();if(failedStart)throw Error('Start rejected');}
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
 vm.runInNewContext(fs.readFileSync(require.resolve('../Web/app.js'),'utf8'),context);
 t.after(()=>{window.dispatchEvent(new Event('pagehide'));for(const timer of timers)clearTimeout(timer);});
 return {sendTV,tvVideo:id=>{remoteID=id;sendTV();},tvDisconnect:()=>{remoteConnected=false;sendTV();},tickUI:()=>{for(const {callback,delay} of intervals.values())if(delay===500)callback();},calls,store,el,nativeLastVideo:()=>nativeLastVideo,driver:()=>driver,click:id=>el(id).dispatchEvent(new Event('click')),loadVideo:()=>{el('fileInput').files=[{name:'Laufstrecke.mp4'}];el('fileInput').dispatchEvent(new Event('change'));},loadYoutube:(id='M7lc1UVf-VE')=>{el('videoUrl').value='https://youtu.be/'+id;el('linkPanel').dispatchEvent(new Event('submit'));},confirmYoutubePause:()=>pendingYoutubePause?.(),youtubeUserPlay:()=>youtube.playVideo(),sample:speed=>{clock+=100;driver.options.onData({speed});for(const {callback,delay} of [...intervals.values()])if(delay===100)callback();},advance:ms=>{clock+=ms;}};
}

module.exports={app,flush};
