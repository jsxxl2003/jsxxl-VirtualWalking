'use strict';
(function(root){
 const FTMS='00001826-0000-1000-8000-00805f9b34fb';
 const TREADMILL_DATA='00002acd-0000-1000-8000-00805f9b34fb';
 const MACHINE_STATUS='00002ada-0000-1000-8000-00805f9b34fb';
 const CONTROL_POINT='00002ad9-0000-1000-8000-00805f9b34fb';
 const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
 function errorText(value,fallback='Der Browser hat keinen Fehlertext geliefert.',depth=0){
  if(depth>3||value===undefined||value===null)return fallback;
  if(typeof value==='string'){const text=value.trim();return text&&text!=='undefined'&&text!=='null'?text:fallback;}
  if(typeof value==='number'||typeof value==='boolean')return String(value);
  if(typeof value==='object'){
   for(const field of ['message','error','reason','description','localizedDescription']){try{if(value[field]!==undefined&&value[field]!==value){const text=errorText(value[field],'',depth+1);if(text)return text;}}catch{}}
   try{if(value.name&&value.name!=='Error')return String(value.name);if(value.code!==undefined)return 'Fehlercode '+String(value.code);}catch{}
  }
  return fallback;
 }
 function parseTreadmillData(view){
  if(!(view instanceof DataView)||view.byteLength<2)throw Error('Unvollständiges FTMS-Datenpaket');
  const flags=view.getUint16(0,true);let position=2;
  const take=n=>{if(position+n>view.byteLength)throw Error('Unvollständiges FTMS-Datenpaket');const start=position;position+=n;return start;};
  const speed=flags&1?null:view.getUint16(take(2),true)/100;
  if(flags&2)take(2);
  let distanceKm=null;
  if(flags&4){const p=take(3);distanceKm=(view.getUint8(p)|(view.getUint8(p+1)<<8)|(view.getUint8(p+2)<<16))/1000;}
  return {speed,distanceKm,flags};
 }
 function targetRate(speed,reference){return clamp(Number.isFinite(speed)&&Number.isFinite(reference)&&reference>0?speed/reference:1,.5,2);}
 function nearestRate(target,rates){const allowed=[...new Set(rates.filter(n=>Number.isFinite(n)&&n>0))];if(!allowed.length)return null;return allowed.reduce((best,n)=>Math.abs(n-target)<Math.abs(best-target)?n:best);}
 function formatTime(seconds){seconds=Math.max(0,Math.floor(seconds));const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
 function calories(weight,averageKmh,seconds){if(!Number.isFinite(weight)||weight<25||weight>300)return null;const met=averageKmh<1?1:averageKmh<3?2.5:averageKmh<5?3.5:averageKmh<6.5?4.3:averageKmh<8?6:8.3;return Math.round(met*3.5*weight/200*(seconds/60));}
 class Workout{
  constructor(now,distanceKm=null){this.running=true;this.startedAt=new Date().toISOString();this.elapsedMs=0;this.speedIntegral=0;this.estimatedKm=0;this.nativeKm=0;this.nativeSeen=Number.isFinite(distanceKm);this.lastNative=Number.isFinite(distanceKm)?distanceKm:null;this.lastTick=now;}
  tick(now,speed,live=true){if(!this.running)return;const delta=Math.max(0,now-this.lastTick);this.lastTick=Math.max(now,this.lastTick);this.elapsedMs+=delta;const validSpeed=live&&Number.isFinite(speed)?Math.max(0,speed):0;this.speedIntegral+=validSpeed*delta;this.estimatedKm+=validSpeed*delta/3600000;}
  telemetry(distanceKm){if(!this.running||!Number.isFinite(distanceKm))return;if(!this.nativeSeen){this.nativeKm=this.estimatedKm;this.nativeSeen=true;}if(this.lastNative!==null&&distanceKm>=this.lastNative)this.nativeKm+=distanceKm-this.lastNative;this.lastNative=distanceKm;}
  pause(now,speed,live=true){this.tick(now,speed,live);this.running=false;}
  resume(now,distanceKm=null){this.running=true;this.lastTick=now;this.lastNative=Number.isFinite(distanceKm)?distanceKm:null;}
  get seconds(){return this.elapsedMs/1000;}
  get distanceKm(){return Math.max(0,this.nativeSeen?this.nativeKm:this.estimatedKm);}
  get averageKmh(){return this.elapsedMs?this.speedIntegral/this.elapsedMs:0;}
 }
 const api={FTMS,TREADMILL_DATA,MACHINE_STATUS,CONTROL_POINT,errorText,parseTreadmillData,targetRate,nearestRate,formatTime,calories,Workout};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.VirtualWalkingCore=api;
})(typeof window!=='undefined'?window:globalThis);
