const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const {FTMSClient}=require('../Web/bluetooth.js');const C=require('../Web/core.js');
function harness(){
 const root=new EventTarget(),writes=[],notifications=[];let generation=1;
 root.window=root;root.navigator={};root.DataView=DataView;root.Uint8Array=Uint8Array;root.ArrayBuffer=ArrayBuffer;root.EventTarget=EventTarget;root.Event=Event;root.CustomEvent=CustomEvent;root.setTimeout=setTimeout;root.clearTimeout=clearTimeout;
 root.webkit={messageHandlers:{virtualwalking:{postMessage:message=>queueMicrotask(()=>{
  let result={};
  if(message.method==='ble.choose')result={id:'device',name:'Mein echtes Laufband',generation:generation++};
  if(message.method==='ble.connect')result={characteristics:[C.TREADMILL_DATA,C.MACHINE_STATUS,C.CONTROL_POINT].map(uuid=>({uuid,properties:{write:uuid===C.CONTROL_POINT,indicate:true,notify:true}}))};
  if(message.method==='ble.notify')notifications.push(message.params.uuid);
  if(message.method==='ble.write'){
   writes.push(Array.from(message.params.bytes));
   // A control indication can arrive before the native write acknowledgement.
   root.__vwNativeEvent({type:'ble.value',deviceId:'device',generation:message.params.generation,uuid:C.CONTROL_POINT,bytes:[0x80,message.params.bytes[0],1]});
  }
  root.__vwNativeReceive({id:message.id,ok:true,result});
 })}}};
 vm.createContext(root);vm.runInContext(fs.readFileSync(require.resolve('../Web/native-bridge.js'),'utf8'),root);
 return {root,writes,notifications};
}
test('native Bluetooth transport preserves FTMS response ordering and actual device name',async()=>{
 const h=harness();let connection;const client=new FTMSClient({bluetooth:h.root.navigator.bluetooth,onConnection:info=>connection=info});
 await client.connect();assert.equal(connection.name,'Mein echtes Laufband');assert.equal(client.canControl,true);assert.deepEqual(h.writes,[]);
 assert.deepEqual(h.notifications,[C.TREADMILL_DATA,C.MACHINE_STATUS,C.CONTROL_POINT]);
 await client.start();assert.deepEqual(h.writes,[[0],[7]]);await client.stop(true);assert.deepEqual(h.writes,[[0],[7],[8,2]]);client.disconnect();
});
test('late notification from an earlier native connection cannot change new telemetry',async()=>{
 const h=harness(),speeds=[];const client=new FTMSClient({bluetooth:h.root.navigator.bluetooth,onData:data=>speeds.push(data.speed)});
 await client.connect();client.disconnect();await client.connect();
 h.root.__vwNativeEvent({type:'ble.value',deviceId:'device',generation:1,uuid:C.TREADMILL_DATA,bytes:[0,0,0x58,2]});assert.deepEqual(speeds,[]);
 h.root.__vwNativeEvent({type:'ble.value',deviceId:'device',generation:2,uuid:C.TREADMILL_DATA,bytes:[0,0,0x58,2]});assert.deepEqual(speeds,[6]);client.disconnect();
});
