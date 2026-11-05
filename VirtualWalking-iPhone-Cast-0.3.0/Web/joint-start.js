'use strict';
(function(root){
 // The video is unlocked by the original tap before any motor command.
 // A successful BLE write is not an acceptance or proof of belt movement.
 async function jointStart({signal,prepareVideo,isMoving,allowStart,driver,onSent,waitForMotion,playVideo,beginRecording}){
  const check=()=>{if(signal.aborted)throw Error('Start abgebrochen.');};
  check();await prepareVideo(signal);check();
  if(!isMoving()){
   if(!allowStart())throw Error('Bitte auf aktuelle Stillstandsdaten des Laufbands warten.');
   await driver.start({shouldStart:()=>!signal.aborted&&allowStart(),onSent});check();
   await waitForMotion(signal);check();
  }
  await playVideo(signal);check();beginRecording();
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={jointStart};
 root.VirtualWalkingStart={jointStart};
})(typeof window!=='undefined'?window:globalThis);
