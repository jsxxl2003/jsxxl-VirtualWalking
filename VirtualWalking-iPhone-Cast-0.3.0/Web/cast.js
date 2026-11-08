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
 // Direct HTTP receiver: only player feedback confirms playback, never an HTTP acknowledgement.
 class ReceiverController {
  constructor({rpc,onChange=()=>{},now=()=>performance.now()}){Object.assign(this,{rpc,onChange,now,selected:false,connected:false,source:null,state:null,receivedAt:-Infinity,confirmedRate:null,rateError:'',transportError:'',device:'waipu.tv Box',suspended:false,polling:false,epoch:0,requestTail:Promise.resolve(),statusTask:null,pauseTask:null});}
  get active(){return this.selected;}
  setSource(kind,value){this.source=kind==='youtube'?videoID(value):null;this.confirmedRate=null;this.rateError='';this.epoch++;}
  accept(status){
   if(!status||!Number.isFinite(status.playerState)||!Number.isFinite(status.feedbackAgeMs)||typeof status.playerReady!=='boolean')throw Error('TV-Empfänger aktualisieren: Es fehlt die Rückmeldung des Videoplayers.');
   this.connected=true;this.state=status;this.receivedAt=this.now();this.transportError='';
   if(status.playerError)this.rateError='YouTube-Fehler '+status.playerError;
   this.onChange();
  }
  matches(){return this.connected&&!!this.source&&this.state?.playerVideoId===this.source;}
  fresh(){return this.matches()&&!this.suspended&&this.state?.foreground!==false&&this.state?.playerReady===true&&this.now()-this.receivedAt<5000&&this.state?.feedbackAgeMs>=0&&this.state.feedbackAgeMs<5000;}
  get playing(){return this.fresh()&&this.state?.playerState===1;}
  get rate(){return this.fresh()&&Number.isFinite(this.state?.actualRate)?this.state.actualRate:null;}
  async poll(){
   if(!this.selected||this.suspended||this.polling)return;
   this.polling=true;const epoch=this.epoch;
   try{const status=await this.readStatus();if(epoch===this.epoch&&!this.suspended)this.accept(status);}catch(error){if(epoch===this.epoch){this.connected=false;this.confirmedRate=null;this.transportError=C.errorText(error);this.onChange();}}
   finally{this.polling=false;}
  }
  request(method,params={},signal,epoch=this.epoch){
   const canFinish=method==='pause'||method==='stop';
   const task=this.requestTail.then(async()=>{
    this.check(signal,epoch,canFinish);
    try{const response=await this.rpc('tv.receiver.'+method,params);this.check(signal,epoch,canFinish);return response;}
    catch(error){
     this.check(signal,epoch,canFinish);
     const action={status:'TV-Status lesen',play:'TV-Video laden',resume:'TV-Video starten',pause:'TV-Video pausieren',stop:'TV-Video beenden',rate:'TV-Tempo ändern'}[method]||'TV-Befehl';
     this.transportError=action+': '+C.errorText(error);throw Error(this.transportError);
    }
   });
   // A failed request must not block a later pause or an explicit retry.
   this.requestTail=task.catch(()=>{});return task;
  }
  readStatus(){
   if(this.statusTask?.epoch===this.epoch)return this.statusTask.promise;
   const operation={epoch:this.epoch};operation.promise=this.request('status');this.statusTask=operation;
   operation.promise.finally(()=>{if(this.statusTask===operation)this.statusTask=null;}).catch(()=>{});
   return operation.promise;
  }
  async command(method,params={},signal,epoch=this.epoch){await this.request(method,params,signal,epoch);}
  check(signal,epoch,canFinish=false){if(signal?.aborted||(!canFinish&&this.suspended)||epoch!==this.epoch)throw Error('TV-Start abgebrochen.');}
  async waitFor(predicate,signal,epoch=this.epoch){
   const deadline=Date.now()+10000;
   while(Date.now()<deadline){
    this.check(signal,epoch);
    const status=await this.readStatus();this.check(signal,epoch);this.accept(status);
    if(status.playerError)throw Error('YouTube-Fehler '+status.playerError);
    if(status.foregroundError)throw Error(status.foregroundError);
    if(this.fresh()&&predicate(status))return;
    await new Promise(resolve=>setTimeout(resolve,200));
   }
   throw Error(this.state?.foreground===false?'Der TV-Empfänger läuft noch im Hintergrund. Bitte die App am TV öffnen und ‚Über anderen Apps einblenden‘ erlauben.':'Der TV hat die Wiedergabe nicht bestätigt.');
  }
  async prepare(signal){
   if(!this.source)throw Error('Bitte ein YouTube-Laufvideo wählen.');
   this.intent='prepare';
   const epoch=this.epoch;
   this.check(signal,epoch);
   if(this.fresh())await this.command('resume',{},signal,epoch);else await this.command('play',{id:this.source},signal,epoch);
   await this.waitFor(s=>s.playerState===1,signal,epoch);
   await this.command('pause',{},signal,epoch);await this.waitFor(s=>s.playerState===2,signal,epoch);
  }
  async play(signal){this.intent='play';const epoch=this.epoch;this.check(signal,epoch);await this.command('resume',{},signal,epoch);await this.waitFor(s=>s.playerState===1,signal,epoch);}
  pause(){
   if(this.intent==='pause'&&this.pauseTask?.epoch===this.epoch)return this.pauseTask.promise;
   this.intent='pause';this.epoch++;const operation={epoch:this.epoch};operation.promise=this.command('pause');this.pauseTask=operation;
   operation.promise.finally(()=>{if(this.pauseTask===operation)this.pauseTask=null;}).catch(()=>{});
   return operation.promise;
  }
  stop(){this.intent='stop';this.epoch++;return this.command('stop');}
  async setRate(rate){
   if(this.pendingRate||this.rateError||!this.playing)return;
   if(!Number.isFinite(rate)||rate<.5||rate>2)throw Error('Ungültiges TV-Tempo.');
   if(this.confirmedRate===rate&&Math.abs(this.rate-rate)<.025)return;
   this.pendingRate=true;const epoch=this.epoch;
   try{await this.command('rate',{value:rate},null,epoch);await this.waitFor(s=>Math.abs(s.actualRate-rate)<.025,null,epoch);if(epoch===this.epoch)this.confirmedRate=rate;}
   catch(error){if(epoch===this.epoch)this.rateError=C.errorText(error);}
   finally{this.pendingRate=false;this.onChange();}
  }
  suspend(){this.suspended=true;this.epoch++;this.confirmedRate=null;}
  resume(){this.suspended=false;this.receivedAt=-Infinity;this.confirmedRate=null;}
 }
 class RoutedController {
  constructor(options){this.cast=new CastController(options);this.receiver=new ReceiverController(options);this.route=this.cast;}
  connectReceiver(address){
   const receiver=this.receiver;
   if(typeof address==='string'&&address){
    receiver.address=address;receiver.epoch++;receiver.state=null;receiver.connected=false;receiver.receivedAt=-Infinity;receiver.confirmedRate=null;
    receiver.device='waipu.tv Box · '+address.replace(/^http:\/\//,'');
   }
   this.route=receiver;receiver.selected=true;receiver.rateError='';receiver.poll();
  }
  receive(message){if(message.connected&&!this.receiver.selected)this.route=this.cast;this.cast.receive(message);return this.route===this.cast;}
  setSource(kind,value){this.cast.setSource(kind,value);this.receiver.setSource(kind,value);}
  poll(){return this.receiver.poll();}
 }
 for(const name of ['active','connected','device','playing','rate','rateError','transportError','confirmedRate'])Object.defineProperty(RoutedController.prototype,name,{get(){return this.route[name];}});
 for(const name of ['matches','fresh','prepare','play','pause','stop','setRate','suspend','resume'])RoutedController.prototype[name]=function(...args){return this.route[name](...args);};

 const api={CastController,ReceiverController,RoutedController,videoID};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.VirtualWalkingCast=api;
})(typeof window!=='undefined'?window:globalThis);
