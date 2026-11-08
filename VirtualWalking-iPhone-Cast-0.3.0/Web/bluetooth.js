'use strict';
(function(root){
 const core=typeof module!=='undefined'&&module.exports?require('./core.js'):root.VirtualWalkingCore;
 class FTMSClient{
  constructor({bluetooth,onConnection=()=>{},onData=()=>{},onStatus=()=>{},onError=()=>{},commandTimeout=15000}){this.bluetooth=bluetooth;this.onConnection=onConnection;this.onData=onData;this.onStatus=onStatus;this.onError=onError;this.device=null;this.listeners=[];this.pending=false;this.control=null;this.controlWriter=null;this.controlIssue='';this.controlGranted=false;this.controlDenied=false;this.uncertain=false;this.uncertainCommand=null;this.lastControlError='';this.operation=null;this.commandTimeout=commandTimeout;this.starting=false;}
  get connected(){return !!this.device?.gatt?.connected;}
  get canControl(){return this.connected&&!!this.control;}
  get startBlockedReason(){
   if(!this.uncertain)return '';
   return this.uncertainCommand===0?'Die Steuerfreigabe ist fehlgeschlagen. Es wurde kein Laufband-Startbefehl gesendet. Bitte Bluetooth neu verbinden. '+this.lastControlError:'Unklarer Laufband-Zustand nach einem unbestätigten Start-/Stoppbefehl. Bitte am Gerät prüfen und Bluetooth neu verbinden.';
  }
  async connect(){
   if(this.pending)return;
   if(!this.bluetooth?.requestDevice)throw Error('Bitte diese Seite in Bluefy öffnen, um Bluetooth zu verwenden.');
   this.pending=true;
   try{
    if(this.device)this.disconnect();
    const device=await this.bluetooth.requestDevice({filters:[{services:[core.FTMS]}],optionalServices:[core.FTMS]});
    this.device=device;
    const closed=()=>{if(this.device===device)this.disconnect();};device.addEventListener('gattserverdisconnected',closed);this.listeners.push([device,'gattserverdisconnected',closed]);
    const server=await device.gatt.connect(),service=await server.getPrimaryService(core.FTMS);
    const data=await service.getCharacteristic(core.TREADMILL_DATA);
    const read=event=>{try{this.onData(core.parseTreadmillData(event.target.value));}catch(error){this.onError(error);}};
    data.addEventListener('characteristicvaluechanged',read);this.listeners.push([data,'characteristicvaluechanged',read]);await data.startNotifications();
    try{
     const status=await service.getCharacteristic(core.MACHINE_STATUS);
     const report=event=>{const v=event.target.value;if(v?.byteLength){const code=v.getUint8(0);if(code===0xff){this.controlGranted=false;this.operation?.finish(Error('Die Steuerfreigabe des Laufbands wurde entzogen.'));}this.onStatus({code,reason:v.byteLength>1?v.getUint8(1):null});}};
     status.addEventListener('characteristicvaluechanged',report);this.listeners.push([status,'characteristicvaluechanged',report]);await status.startNotifications();
    }catch{}
    // Discovery and indication subscription never move the belt or request control.
    let stage='Steuerkanal-Suche',channels=[];
    try{
     let point;
     try{point=await service.getCharacteristic(core.CONTROL_POINT);}
     catch(lookupError){
      if(typeof service.getCharacteristics!=='function')throw lookupError;
      const all=await service.getCharacteristics();
      const normalize=value=>typeof value==='number'?value.toString(16):String(value||'').toLowerCase().replace(/^0x/,'');
      channels=all.map(item=>normalize(item.uuid)).filter(Boolean);
      point=all.find(item=>[core.CONTROL_POINT,'2ad9'].includes(normalize(item.uuid)));
      if(!point)throw lookupError;
     }
     stage='Schreibzugriff';
     // Prefer the compatibility API when a browser supplies it. Use one writer
     // for the connection; never try another writer after an ambiguous failure.
     const writer=typeof point.writeValue==='function'?'writeValue':typeof point.writeValueWithResponse==='function'?'writeValueWithResponse':null;
     if(!writer)throw Error('Der Browser stellt für den FTMS-Steuerkanal keine bestätigte Schreibfunktion bereit.');
     // Property flags alone cannot prove that the connection works. Require
     // notification setup, then an actual FTMS response to Request Control.
     stage='Steuerantworten abonnieren';
     const response=event=>{
      const value=event.target.value,op=this.operation;
      if(!op||!value||value.byteLength<3||value.getUint8(0)!==0x80||value.getUint8(1)!==op.code)return;
      op.response=value.getUint8(2);op.settle();
     };
     point.addEventListener('characteristicvaluechanged',response);this.listeners.push([point,'characteristicvaluechanged',response]);await point.startNotifications();
     if(this.device===device&&device.gatt.connected){this.control=point;this.controlWriter=writer;this.controlIssue='';}
    }catch(error){
     this.control=null;this.controlWriter=null;
     const detail=core.errorText(error).replace(/\s+/g,' ').slice(0,220);
     const ids=channels.map(id=>id.replace(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/,'$1')).slice(0,16);
     this.controlIssue=stage+': '+(error?.name&&error.name!=='Error'?error.name+' – ':'')+detail+(ids.length?' · FTMS-Kanäle: '+ids.join(', '):'');
    }
    if(this.device!==device||!device.gatt.connected)throw Error('Die Bluetooth-Verbindung wurde unterbrochen.');
    this.onConnection({connected:true,id:device.id||'',name:device.name||'Unbenanntes FTMS-Laufband',canControl:this.canControl});
    return device;
   }catch(error){this.disconnect();throw error;}
   finally{this.pending=false;}
  }
  procedure(code,parameters=[],beforeWrite=()=>{}){
   // Intentionally no speed, incline, reset, or vendor-specific commands.
   if(!((code===0x00||code===0x07)&&parameters.length===0)&&!(code===0x08&&parameters.length===1&&[1,2].includes(parameters[0])))return Promise.reject(Error('Nicht erlaubter FTMS-Befehl.'));
   if(!this.canControl)return Promise.reject(Error('Unsere App konnte den FTMS-Steuerkanal noch nicht öffnen. '+this.controlIssue));
   if(this.operation)return Promise.reject(Error('Ein Laufband-Befehl wartet noch auf Bestätigung.'));
   const point=this.control,device=this.device,writer=this.controlWriter;
   const label=({0:'Steuerfreigabe (0x00)',7:'Laufband-Start (0x07)',8:'Laufband-Pause/Stopp (0x08)'})[code]+' / '+writer;
   return new Promise((resolve,reject)=>{
    const op={code,response:null,written:false,sent:false,finish:(...errors)=>{
     if(this.operation!==op)return;clearTimeout(op.timer);this.operation=null;
     if(errors.length)reject(Error(core.errorText(errors[0])));else resolve();
    },settle:()=>{
     if(this.operation!==op||this.device!==device)return;
     if(!op.written||op.response===null)return;
     if(op.response===1){if(code===0){this.controlGranted=true;this.controlDenied=false;}op.finish();}
     else{if(op.response===5)this.controlGranted=false;const messages={2:'Das Laufband unterstützt diesen Start-/Stoppbefehl nicht.',3:'Das Laufband hat den Befehl als ungültig abgelehnt.',4:'Das Laufband hat den Befehl abgelehnt. Zustand und Sicherheitsschlüssel am Gerät prüfen.',5:'Das Laufband erlaubt die Steuerung gerade nicht. Andere Trainings-App trennen und am Gerät prüfen.'};const message=messages[op.response]||'Unbekannte Laufband-Antwort '+op.response;if(code===0){this.controlDenied=true;this.lastControlError=label+': '+message;this.controlIssue=this.lastControlError;}op.finish(Error(message));}
    }};
    const fail=error=>{
     if(this.operation!==op||this.device!==device)return;
     const detail=label+': '+core.errorText(error);
     if(op.sent){this.uncertain=true;this.uncertainCommand=code;this.lastControlError=detail;}
     op.finish(Error(detail));
    };
    this.operation=op;op.timer=setTimeout(()=>fail(Error('Keine Laufband-Bestätigung. Bitte Bluetooth neu verbinden.')),this.commandTimeout);
    Promise.resolve().then(async()=>{
     if(this.operation!==op||this.device!==device||!this.connected)throw Error('Bluetooth-Verbindung unterbrochen.');
     beforeWrite();op.sent=true;
     await point[writer](Uint8Array.from([code,...parameters]));
    }).then(()=>{op.written=true;op.settle();},fail);
   });
  }
  async start({shouldStart=()=>true,onSent=()=>{}}={}){
   if(this.starting)throw Error('Der gemeinsame Start läuft bereits.');
   if(this.uncertain)throw Error(this.startBlockedReason);
   const device=this.device;this.starting=true;
   const check=()=>{if(!shouldStart()||this.device!==device||!this.connected)throw Error('Start abgebrochen.');};
   try{check();if(!this.controlGranted)await this.procedure(0x00,[],check);check();await this.procedure(0x07,[],()=>{check();onSent();});}
   finally{this.starting=false;}
  }
  async stop(pause=false){
   if(!this.controlGranted)throw Error('Keine Steuerfreigabe. Bitte das Laufband am Gerät anhalten.');
   await this.procedure(0x08,[pause?2:1]);
  }
  disconnect(){
   const device=this.device;this.device=null;
   this.operation?.finish(Error('Bluetooth-Verbindung unterbrochen. Laufband am Gerät prüfen.'));
   this.control=null;this.controlWriter=null;this.controlIssue='';this.controlGranted=false;this.controlDenied=false;this.uncertain=false;this.uncertainCommand=null;this.lastControlError='';
   for(const [target,event,handler] of this.listeners)target.removeEventListener(event,handler);this.listeners=[];
   if(device?.gatt?.connected)device.gatt.disconnect();
   if(device)this.onConnection({connected:false});
  }
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={FTMSClient};
 root.VirtualWalkingBluetooth={FTMSClient};
})(typeof window!=='undefined'?window:globalThis);
