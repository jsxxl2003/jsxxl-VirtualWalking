const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const {FTMSClient}=require('../Web/bluetooth.js');const C=require('../Web/core.js');
function harness({controlResult=1,dropControlResponse=false,dropStartResponse=false,writeWithResponse=true,writeWithoutResponse=false,numericProperties=true,speedSupported=true,speedLimits=[50,0,88,2,10,0],speedResult=1,dropSpeedResponse=false}={}){
 const root=new EventTarget(),writes=[],notifications=[],modes=[];let generation=1;
 root.window=root;root.navigator={};root.DataView=DataView;root.Uint8Array=Uint8Array;root.ArrayBuffer=ArrayBuffer;root.EventTarget=EventTarget;root.Event=Event;root.CustomEvent=CustomEvent;root.setTimeout=setTimeout;root.clearTimeout=clearTimeout;
 root.webkit={messageHandlers:{virtualwalking:{postMessage:message=>queueMicrotask(()=>{
  let result={};
  if(message.method==='ble.choose')result={id:'device',name:'Mein echtes Laufband',generation:generation++};
  // Objective-C boxed comparison expressions arrive as JSON numbers, not booleans.
  const flag=value=>numericProperties?Number(value):value;
  if(message.method==='ble.connect')result={characteristics:[C.TREADMILL_DATA,C.MACHINE_STATUS,C.CONTROL_POINT,C.MACHINE_FEATURE,C.SPEED_RANGE].map(uuid=>({uuid,properties:{read:flag([C.MACHINE_FEATURE,C.SPEED_RANGE].includes(uuid)),write:flag(uuid===C.CONTROL_POINT&&writeWithResponse),writeWithoutResponse:flag(uuid===C.CONTROL_POINT&&writeWithoutResponse),indicate:flag(true),notify:flag(true)}}))};
  if(message.method==='ble.read')result={bytes:message.params.uuid===C.MACHINE_FEATURE?[0,0,0,0,Number(speedSupported),0,0,0]:speedLimits};
  if(message.method==='ble.notify')notifications.push(message.params.uuid);
  if(message.method==='ble.write'){
   const confirmed=message.params.withResponse!==false;
   if(confirmed?!writeWithResponse:!writeWithoutResponse){root.__vwNativeReceive({id:message.id,ok:false,error:{message:'Keine bestätigten Schreibzugriffe möglich.',name:'NotSupportedError'}});return;}
   writes.push(Array.from(message.params.bytes));
   modes.push(confirmed?'with-response':'without-response');
   // A control indication can arrive before the native write acknowledgement.
   if(!(dropControlResponse&&message.params.bytes[0]===0)&&!(dropStartResponse&&message.params.bytes[0]===7)&&!(dropSpeedResponse&&message.params.bytes[0]===2))root.__vwNativeEvent({type:'ble.value',deviceId:'device',generation:message.params.generation,uuid:C.CONTROL_POINT,bytes:[0x80,message.params.bytes[0],message.params.bytes[0]===0?controlResult:message.params.bytes[0]===2?speedResult:1]});
  }
  root.__vwNativeReceive({id:message.id,ok:true,result});
 })}}};
 vm.createContext(root);vm.runInContext(fs.readFileSync(require.resolve('../Web/native-bridge.js'),'utf8'),root);
 return {root,writes,notifications,modes,sample:speed=>{const n=Math.round(speed*100);root.__vwNativeEvent({type:'ble.value',deviceId:'device',generation:generation-1,uuid:C.TREADMILL_DATA,bytes:[0,0,n&255,n>>8]});},speedResponse:()=>root.__vwNativeEvent({type:'ble.value',deviceId:'device',generation:generation-1,uuid:C.CONTROL_POINT,bytes:[0x80,2,speedResult]})};
}
test('a native write-without-response control point uses its advertised transport and still confirms FTMS start and stop',async()=>{
 const h=harness({writeWithResponse:false,writeWithoutResponse:true});const client=new FTMSClient({bluetooth:h.root.navigator.bluetooth});
 await client.connect();await client.start();await client.stop(true);
 assert.deepEqual(h.writes,[[0],[7],[8,2]]);assert.deepEqual(h.modes,['without-response','without-response','without-response']);
 assert.equal(client.controlGranted,true);client.disconnect();
});
test('native boolean properties and legacy numeric properties select the same writer',async()=>{
 for(const numericProperties of [false,true]){
  const h=harness({writeWithResponse:false,writeWithoutResponse:true,numericProperties}),client=new FTMSClient({bluetooth:h.root.navigator.bluetooth});
  await client.connect();assert.equal(client.control.properties.write,false);assert.equal(client.control.properties.writeWithoutResponse,true);
  await client.start();assert.deepEqual(h.modes,['without-response','without-response']);client.disconnect();
 }
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
test('a speed tap requests control and sends the bounded little-endian target, never a motor start',async()=>{
 const h=harness({writeWithResponse:false,writeWithoutResponse:true}),client=new FTMSClient({bluetooth:h.root.navigator.bluetooth});
 await client.connect();h.sample(2);await client.setSpeed(2.1);
 assert.deepEqual(h.writes,[[0],[2,210,0]]);assert.deepEqual(h.modes,['without-response','without-response']);
 assert.equal(client.speed,2);h.sample(2.1);assert.equal(client.speed,2.1);client.disconnect();
});
test('stationary, stale, unsupported and malformed speed capabilities cannot send a speed command',async()=>{
 for(const options of [{speedSupported:false},{speedLimits:[]},{speedLimits:[50,0,88,2,0,0]},{speedLimits:[50,0,20,0,10,0]}]){
  const h=harness(options),client=new FTMSClient({bluetooth:h.root.navigator.bluetooth});await client.connect();h.sample(2);
  assert.equal(client.canSetSpeed,false);await assert.rejects(client.setSpeed(2.1));assert.deepEqual(h.writes,[]);assert.equal(client.canControl,true);client.disconnect();
 }
 const h=harness(),client=new FTMSClient({bluetooth:h.root.navigator.bluetooth});await client.connect();h.sample(0);
 await assert.rejects(client.setSpeed(2.1));h.sample(2);client.speedAt=Date.now()-6000;await assert.rejects(client.setSpeed(2.1));assert.deepEqual(h.writes,[]);client.disconnect();
});
test('out-of-range and off-grid targets are rejected before requesting control',async()=>{
 const h=harness(),client=new FTMSClient({bluetooth:h.root.navigator.bluetooth});await client.connect();h.sample(2);
 for(const speed of [0,.4,6.1,2.05,NaN,Infinity])await assert.rejects(client.setSpeed(speed));
 assert.deepEqual(h.writes,[]);client.disconnect();
});
test('a speed transport acknowledgement without FTMS confirmation blocks retries but still allows stop',async()=>{
 const h=harness({dropSpeedResponse:true}),client=new FTMSClient({bluetooth:h.root.navigator.bluetooth,commandTimeout:10});await client.connect();h.sample(2);
 await assert.rejects(client.setSpeed(2.1),/Keine Laufband-Bestätigung/);assert.equal(client.uncertainCommand,2);
 await assert.rejects(client.setSpeed(2.2));await client.stop();assert.deepEqual(h.writes,[[0],[2,210,0],[8,1]]);client.disconnect();
});
test('stop cancels an unsent speed change before sending the stop command',async()=>{
 const h=harness(),client=new FTMSClient({bluetooth:h.root.navigator.bluetooth});await client.connect();h.sample(2);await client.procedure(0);
 const changing=client.setSpeed(2.1),rejected=assert.rejects(changing,/abgebrochen/);await client.stop();await rejected;
 assert.deepEqual(h.writes,[[0],[8,1]]);client.disconnect();
});
test('stop follows a speed change already on the wire without overlapping FTMS procedures',async()=>{
 const h=harness({dropSpeedResponse:true}),client=new FTMSClient({bluetooth:h.root.navigator.bluetooth});await client.connect();h.sample(2);
 const changing=client.setSpeed(2.1);await new Promise(r=>setImmediate(r));const stopped=client.stop(true);
 assert.deepEqual(h.writes,[[0],[2,210,0]]);h.speedResponse();await changing;await stopped;
 assert.deepEqual(h.writes,[[0],[2,210,0],[8,2]]);client.disconnect();
});
