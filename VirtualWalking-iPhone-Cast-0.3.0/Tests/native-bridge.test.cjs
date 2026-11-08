const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const {FTMSClient}=require('../Web/bluetooth.js');const C=require('../Web/core.js');
function harness({controlResult=1,dropControlResponse=false,dropStartResponse=false,writeWithResponse=true,writeWithoutResponse=false}={}){
 const root=new EventTarget(),writes=[],notifications=[],modes=[];let generation=1;
 root.window=root;root.navigator={};root.DataView=DataView;root.Uint8Array=Uint8Array;root.ArrayBuffer=ArrayBuffer;root.EventTarget=EventTarget;root.Event=Event;root.CustomEvent=CustomEvent;root.setTimeout=setTimeout;root.clearTimeout=clearTimeout;
 root.webkit={messageHandlers:{virtualwalking:{postMessage:message=>queueMicrotask(()=>{
  let result={};
  if(message.method==='ble.choose')result={id:'device',name:'Mein echtes Laufband',generation:generation++};
  if(message.method==='ble.connect')result={characteristics:[C.TREADMILL_DATA,C.MACHINE_STATUS,C.CONTROL_POINT].map(uuid=>({uuid,properties:{write:uuid===C.CONTROL_POINT&&writeWithResponse,writeWithoutResponse:uuid===C.CONTROL_POINT&&writeWithoutResponse,indicate:true,notify:true}}))};
  if(message.method==='ble.notify')notifications.push(message.params.uuid);
  if(message.method==='ble.write'){
   const confirmed=message.params.withResponse!==false;
   if(confirmed?!writeWithResponse:!writeWithoutResponse){root.__vwNativeReceive({id:message.id,ok:false,error:{message:'Keine bestätigten Schreibzugriffe möglich.',name:'NotSupportedError'}});return;}
   writes.push(Array.from(message.params.bytes));
   modes.push(confirmed?'with-response':'without-response');
   // A control indication can arrive before the native write acknowledgement.
   if(!(dropControlResponse&&message.params.bytes[0]===0)&&!(dropStartResponse&&message.params.bytes[0]===7))root.__vwNativeEvent({type:'ble.value',deviceId:'device',generation:message.params.generation,uuid:C.CONTROL_POINT,bytes:[0x80,message.params.bytes[0],message.params.bytes[0]===0?controlResult:1]});
  }
  root.__vwNativeReceive({id:message.id,ok:true,result});
 })}}};
 vm.createContext(root);vm.runInContext(fs.readFileSync(require.resolve('../Web/native-bridge.js'),'utf8'),root);
 return {root,writes,notifications,modes};
}
test('a native write-without-response control point uses its advertised transport and still confirms FTMS start and stop',async()=>{
 const h=harness({writeWithResponse:false,writeWithoutResponse:true});const client=new FTMSClient({bluetooth:h.root.navigator.bluetooth});
 await client.connect();await client.start();await client.stop(true);
 assert.deepEqual(h.writes,[[0],[7],[8,2]]);assert.deepEqual(h.modes,['without-response','without-response','without-response']);
 assert.equal(client.controlGranted,true);client.disconnect();
});
test('a write-without-response transport acknowledgement alone never grants FTMS control',async()=>{
 const h=harness({writeWithResponse:false,writeWithoutResponse:true,dropControlResponse:true});const client=new FTMSClient({bluetooth:h.root.navigator.bluetooth,commandTimeout:10});
 await client.connect();await assert.rejects(client.start(),/Keine Laufband-Bestätigung/);
 assert.equal(client.controlGranted,false);assert.equal(client.uncertainCommand,0);assert.deepEqual(h.writes,[[0]]);client.disconnect();
});
test('an explicitly rejected FTMS control request never falls back to a different writer',async()=>{
 const h=harness({writeWithResponse:false,writeWithoutResponse:true,controlResult:5});const client=new FTMSClient({bluetooth:h.root.navigator.bluetooth});
 await client.connect();await assert.rejects(client.start(),/erlaubt die Steuerung/);
 assert.deepEqual(h.writes,[[0]]);assert.deepEqual(h.modes,['without-response']);client.disconnect();
});
test('an unconfirmed write-without-response motor start is not retried but can be stopped',async()=>{
 const h=harness({writeWithResponse:false,writeWithoutResponse:true,dropStartResponse:true});const client=new FTMSClient({bluetooth:h.root.navigator.bluetooth,commandTimeout:10});
 await client.connect();await assert.rejects(client.start(),/Keine Laufband-Bestätigung/);assert.equal(client.uncertainCommand,7);
 await assert.rejects(client.start(),/Unklarer Laufband-Zustand/);await client.stop();assert.deepEqual(h.writes,[[0],[7],[8,1]]);client.disconnect();
});
test('a control point with both write modes retains confirmed GATT writes',async()=>{
 const h=harness({writeWithoutResponse:true});const client=new FTMSClient({bluetooth:h.root.navigator.bluetooth});await client.connect();await client.start();
 assert.deepEqual(h.modes,['with-response','with-response']);client.disconnect();
});
test('a read-only control point is never reported as ready for control',async()=>{
 const h=harness({writeWithResponse:false});const client=new FTMSClient({bluetooth:h.root.navigator.bluetooth});await client.connect();
 assert.equal(client.canControl,false);assert.match(client.controlIssue,/Schreibmodus/);assert.deepEqual(h.writes,[]);client.disconnect();
});
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
test('denied FTMS control never sends Start and leaves telemetry connected',async()=>{
 const h=harness({controlResult:5}),client=new FTMSClient({bluetooth:h.root.navigator.bluetooth});await client.connect();
 await assert.rejects(client.start(),/erlaubt die Steuerung/);assert.equal(client.controlDenied,true);assert.equal(client.connected,true);assert.equal(client.controlGranted,false);
 assert.deepEqual(h.writes,[[0]]);client.disconnect();
});
test('timed out Request Control is identified separately from an unconfirmed motor start',async()=>{
 const h=harness({dropControlResponse:true}),client=new FTMSClient({bluetooth:h.root.navigator.bluetooth,commandTimeout:10});await client.connect();
 await assert.rejects(client.start(),/Keine Laufband-Bestätigung/);assert.equal(client.uncertainCommand,0);assert.equal(client.controlGranted,false);assert.deepEqual(h.writes,[[0]]);client.disconnect();
});
