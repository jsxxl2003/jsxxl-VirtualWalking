'use strict';
(function(root){
 // The video is unlocked by the original tap before any motor command.
 // A successful BLE write is not an acceptance or proof of belt movement.
 async function jointStart({signal,prepareVideo,isMoving,allowStart,driver,onSent,waitForMotion,playVideo,beginRecording,manualStart=()=>false,onManualStart=()=>{}}){
  const check=()=>{if(signal.aborted)throw Error('Start abgebrochen.');};
  check();await prepareVideo(signal);check();
  if(!isMoving()){
   if(manualStart())onManualStart();
   else{
    if(!allowStart())throw Error('Bitte auf aktuelle Stillstandsdaten des Laufbands warten.');
    let sent=false;
    try{await driver.start({shouldStart:()=>!signal.aborted&&allowStart(),onSent:()=>{sent=true;onSent();}});}
    catch(error){check();if(sent||!manualStart(error))throw error;onManualStart(error);}
   }
   check();
   await waitForMotion(signal);check();
  }
  await playVideo(signal);check();beginRecording();
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={jointStart};
 root.VirtualWalkingStart={jointStart};
})(typeof window!=='undefined'?window:globalThis);
