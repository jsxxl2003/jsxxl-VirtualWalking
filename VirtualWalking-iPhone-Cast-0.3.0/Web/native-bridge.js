'use strict';
(function(root){
 const pending=new Map(),devices=new Map();let serial=0;
 const token="__VW_TOKEN__";
 function rpc(method,params={}){
  return new Promise((resolve,reject)=>{
   const id=String(++serial),timer=setTimeout(()=>{pending.delete(id);reject(Error('Keine rechtzeitige Antwort: '+method));},method==='ble.choose'?45000:12000);
   pending.set(id,{resolve,reject,timer});
   try{root.webkit.messageHandlers.virtualwalking.postMessage({id,method,params,token});}
   catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
  });
 }
 root.__vwNativeReceive=message=>{
  const item=pending.get(message.id);if(!item)return;
  pending.delete(message.id);clearTimeout(item.timer);
  if(message.ok)item.resolve(message.result);
  else{const error=Error(message.error?.message||'Native Verbindung fehlgeschlagen.');error.name=message.error?.name||'Error';item.reject(error);}
 };
 const uuid=value=>typeof value==='number'?'0000'+value.toString(16).padStart(4,'0')+'-0000-1000-8000-00805f9b34fb':String(value).toLowerCase();
 const ftms=uuid(0x1826);
 class Characteristic extends EventTarget{
  constructor(device,description){
   super();this.device=device;this.uuid=uuid(description.uuid);this.value=null;
   // Older native adapters boxed C comparisons as NSNumber 0/1. Normalize at
   // the boundary so strict capability checks cannot mistake 0 for permission.
   const flags=description.properties||{};
   this.properties=Object.fromEntries(['write','writeWithoutResponse','notify','indicate'].map(name=>[name,flags[name]===true||flags[name]===1]));
  }
  async startNotifications(){await rpc('ble.notify',{deviceId:this.device.id,generation:this.device.generation,uuid:this.uuid});return this;}
  async write(value,withResponse){
   const bytes=ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):new Uint8Array(value);
   await rpc('ble.write',{deviceId:this.device.id,generation:this.device.generation,uuid:this.uuid,bytes:Array.from(bytes),withResponse});
  }
  writeValue(value){return this.write(value,true);}
  writeValueWithResponse(value){return this.writeValue(value);}
  writeValueWithoutResponse(value){return this.write(value,false);}
 }
 class Device extends EventTarget{
  constructor(description){
   super();this.id=description.id;this.name=description.name;this.generation=description.generation;this.channels=new Map();
   this.gatt={connected:false,connect:async()=>{
    const result=await rpc('ble.connect',{deviceId:this.id,generation:this.generation});
    for(const item of result.characteristics)this.channels.set(uuid(item.uuid),new Characteristic(this,item));
    this.gatt.connected=true;return this.gatt;
   },getPrimaryService:async requested=>{
    if(!this.gatt.connected||uuid(requested)!==ftms)throw Error('FTMS-Dienst nicht verbunden.');
    return {uuid:ftms,getCharacteristic:async requested=>{const c=this.channels.get(uuid(requested));if(!c)throw Error('FTMS-Kanal nicht vorhanden.');return c;},getCharacteristics:async()=>Array.from(this.channels.values())};
   },disconnect:()=>{const connected=this.gatt.connected;this.gatt.connected=false;rpc('ble.disconnect',{deviceId:this.id,generation:this.generation}).catch(()=>{});if(connected)this.dispatchEvent(new Event('gattserverdisconnected'));}};
  }
 }
 root.__vwNativeEvent=message=>{
  if(message.type==='ble.value'){
   const device=devices.get(message.deviceId);if(!device||device.generation!==message.generation||!device.gatt.connected)return;
   const characteristic=device.channels.get(uuid(message.uuid));if(!characteristic)return;
   characteristic.value=new DataView(Uint8Array.from(message.bytes).buffer);characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
  }else if(message.type==='ble.disconnected'){
   const device=devices.get(message.deviceId);if(!device||device.generation!==message.generation)return;
   device.gatt.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));
  }else root.dispatchEvent(new CustomEvent('vw-native',{detail:message}));
 };
 const bluetooth={requestDevice:async options=>{
  if(!options?.filters?.some(filter=>filter.services?.some(service=>uuid(service)===ftms)))throw Error('Nur FTMS-Laufbänder werden unterstützt.');
  const description=await rpc('ble.choose');const device=new Device(description);devices.set(device.id,device);return device;
 }};
 Object.defineProperty(root.navigator,'bluetooth',{value:bluetooth,configurable:false});
 Object.defineProperty(root.navigator,'clipboard',{value:{readText:()=>rpc('clipboard.read')},configurable:true});
 root.VirtualWalkingNative={rpc};
})(window);
