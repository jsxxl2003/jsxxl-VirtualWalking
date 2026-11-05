'use strict';
(function(root){
 const C=typeof module!=='undefined'&&module.exports?require('./core.js'):root.VirtualWalkingCore;
 const videoID=value=>{
  if(typeof value!=='string')return null;
  if(/^[A-Za-z0-9_-]{11}$/.test(value))return value;
  try{const url=new URL(value),host=url.hostname.toLowerCase().replace(/^www\./,'');
   if(host==='youtu.be')return url.pathname.slice(1).split('/')[0];
   if(['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host))return url.searchParams.get('v')||url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/)?.[1]||null;
  }catch{}return null;
 };
 class CastController{
  constructor({rpc,onChange=()=>{},now=()=>performance.now(),timeout=8000}){
   this.rpc=rpc;this.onChange=onChange;this.now=now;this.timeout=timeout;this.source=null;this.connected=false;this.state=null;this.receivedAt=-Infinity;this.waiters=new Set();this.pendingRate=null;this.rateError='';this.epoch=0;this.session=null;this.suspended=false;this.transportBusy=false;this.confirmedRate=null;this.revision=0;
  }
  setSource(kind,value){this.source=kind==='youtube'?videoID(value):null;this.cancel(Error('Video gewechselt.'));this.rateError='';this.confirmedRate=null;this.onChange();}
  cancel(error){this.epoch++;this.pendingRate=null;for(const waiter of Array.from(this.waiters))waiter.fail(error);}
  receive(message){
   if(message.type!=='cast.status')return;
   this.revision++;
   const changed=this.session!==message.session||this.connected!==!!message.connected||(this.state&&message.media&&(this.state.mediaSessionID!==message.media.mediaSessionID||this.state.contentID!==message.media.contentID));
   if(changed){this.cancel(Error('TV-Verbindung geändert.'));this.rateError='';this.confirmedRate=null;}
   this.session=message.session;this.connected=!!message.connected;this.selected=this.selected||!!message.connected||!!message.connecting;this.device=message.device||'';this.applicationID=message.applicationID;
   this.state=message.media||null;this.receivedAt=message.fresh===false?-Infinity:this.now();
   if(!this.matches()){this.confirmedRate=null;if(this.waiters.size)this.cancel(Error('Der TV meldet ein anderes oder kein zugeordnetes YouTube-Video.'));}
   for(const waiter of Array.from(this.waiters))waiter.check();
   this.onChange();
  }
  matches(){return this.connected&&this.applicationID==='233637DE'&&!this.state?.playingAd&&!!this.source&&videoID(this.state?.contentID)===this.source&&Number.isFinite(this.state?.mediaSessionID)&&this.state.mediaSessionID>0;}
  fresh(){return this.matches()&&!this.suspended&&this.now()-this.receivedAt<6000;}
  get active(){return this.connected||!!this.selected;}
  get playing(){return this.fresh()&&this.state?.playerState==='playing';}
  get rate(){return this.fresh()&&Number.isFinite(this.state?.rate)?this.state.rate:null;}
  requireReady(){
   if(this.suspended)throw Error('Die App ist im Hintergrund.');
   if(!this.matches())throw Error('Bitte das gewählte YouTube-Video zuerst über YouTube auf deinen TV übertragen. Der TV muss dasselbe Video an VirtualWalking melden.');
   if(!this.fresh())throw Error('Keine aktuelle TV-Rückmeldung.');
  }
  binding(){return {session:this.session,mediaSessionID:this.state.mediaSessionID,contentID:this.state.contentID};}
  waitFor(predicate,signal,minimumRevision=-1){
   return new Promise((resolve,reject)=>{
    const epoch=this.epoch;let timer;
    const cleanup=()=>{clearTimeout(timer);this.waiters.delete(waiter);signal?.removeEventListener('abort',aborted);};
    const waiter={check:()=>{if(epoch!==this.epoch)return waiter.fail(Error('TV-Sitzung geändert.'));if(this.revision>minimumRevision&&this.fresh()&&predicate(this.state)){cleanup();resolve();}},fail:error=>{cleanup();reject(error);}};
    const aborted=()=>waiter.fail(Error('Start abgebrochen.'));
    this.waiters.add(waiter);timer=setTimeout(()=>waiter.fail(Error('Der TV hat den gewünschten Wiedergabezustand nicht bestätigt.')),this.timeout);
    signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)aborted();else waiter.check();
   });
  }
  async transport(action,signal){
   this.requireReady();if(signal?.aborted)throw Error('Start abgebrochen.');
   const epoch=this.epoch,started=this.revision;
   await this.rpc('cast.'+action,this.binding());
   if(epoch!==this.epoch||signal?.aborted)throw Error('TV-Start abgebrochen.');
   await this.waitFor(state=>state.playerState===(action==='play'?'playing':'paused'),signal,started);
  }
  async prepare(signal){
   if(this.transportBusy)throw Error('TV-Start läuft bereits.');this.transportBusy=true;
   try{await this.transport('play',signal);await this.transport('pause',signal);}
   finally{this.transportBusy=false;}
  }
  play(signal){return this.transport('play',signal);}
  pause(){
   this.cancel(Error('TV pausiert.'));if(this.pauseTask)return this.pauseTask;
   if(!this.matches()||(this.fresh()&&this.state.playerState==='paused'))return Promise.resolve();
   const task=this.rpc('cast.pause',this.binding());this.pauseTask=task;
   task.finally(()=>{if(this.pauseTask===task)this.pauseTask=null;}).catch(()=>{});return task;
  }
  stop(){this.cancel(Error('TV gestoppt.'));if(!this.matches())return Promise.resolve();return this.rpc('cast.stop',this.binding());}
  async setRate(rate){
   this.requireReady();if(this.pendingRate||this.rateError)return;
   if(!Number.isFinite(rate)||rate<.5||rate>2)throw Error('Ungültiges TV-Tempo.');
   if(this.confirmedRate===rate&&this.playing&&Math.abs(this.rate-rate)<.025)return;
   const operation={epoch:this.epoch,rate};this.pendingRate=operation;const started=this.revision;
   try{
    await this.rpc('cast.rate',{...this.binding(),rate});
    if(this.epoch!==operation.epoch)throw Error('TV-Sitzung geändert.');
    await this.waitFor(state=>state.playerState==='playing'&&Number.isFinite(state.rate)&&Math.abs(state.rate-rate)<.025,null,started);
    if(this.epoch===operation.epoch)this.confirmedRate=rate;
   }catch(error){if(this.epoch===operation.epoch){this.rateError=C.errorText(error);this.confirmedRate=null;}}
   finally{if(this.pendingRate===operation)this.pendingRate=null;this.onChange();}
  }
  suspend(){this.suspended=true;this.cancel(Error('Die App ist im Hintergrund.'));this.confirmedRate=null;}
  resume(){this.suspended=false;this.receivedAt=-Infinity;this.confirmedRate=null;}
 }
 const api={CastController,videoID};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.VirtualWalkingCast=api;
})(typeof window!=='undefined'?window:globalThis);
