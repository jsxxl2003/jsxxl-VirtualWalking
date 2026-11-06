'use strict';
(() => {
 const C=window.VirtualWalkingCore,$=id=>document.getElementById(id);
 const key=name=>'virtualwalking_iphone_v1_'+name;
 const read=(name,fallback)=>{try{const value=JSON.parse(localStorage.getItem(key(name)));return value===null?fallback:value;}catch{return fallback;}};
 const write=(name,value)=>{try{localStorage.setItem(key(name),JSON.stringify(value));return true;}catch{announce('Die lokale Speicherung ist in diesem Browser nicht verfügbar.',true);return false;}};
 const text=(id,value)=>{const node=$(id);if(node.textContent!==value)node.textContent=value;};
 const decimal=(value,digits=1)=>Number(value).toLocaleString('de-DE',{minimumFractionDigits:digits,maximumFractionDigits:digits});
 const rateLabel=value=>Number.isFinite(value)?decimal(value,2)+'×':'—';
 let speed=null,nativeDistance=null,lastDataAt=0,lastSpeedAt=0,connectedAt=0,workout=null;
 let videoKind='none',videoName='',objectUrl=null,youtubePlayer=null,youtubeReady=false,youtubePromise=null,sourceGeneration=0;
 let wantedVideo=false,beltPaused=false,lastRateRequest=null,lastRateRequestAt=0,actualRate=null,wakeLock=null;
 let starting=false,stopping=false,startupTask=null,startupAbort=null,playbackProbe=null;
 let motorMayRun=false,coupled=false,stopTask=null,stopConfirmed=false;
 const tv=window.VirtualWalkingNative?new window.VirtualWalkingCast.CastController({rpc:window.VirtualWalkingNative.rpc,onChange:()=>{renderTV();}}):null;
 function renderTV(){
  const node=$('tvStatus');if(!node||!tv)return;
  node.textContent=!tv.active?'TV: Über das Cast-Symbol oben verbinden.':!tv.connected?'TV: Nicht verbunden. Bitte über das Cast-Symbol erneut verbinden.':!tv.matches()?'Verbunden: '+tv.device+' · Bitte dasselbe YouTube-Video am TV öffnen.':!tv.fresh()?'TV: Warte auf aktuelle Rückmeldung.':'TV: '+tv.device+' · '+(tv.playing?'Wiedergabe':'Pausiert / bereit')+' · '+rateLabel(tv.rate);
 }
 window.addEventListener('vw-native',event=>{
  const message=event.detail;
  if(message.type==='cast.status'){
   const wasActive=tv?.active;tv?.receive(message);
   if((starting||workout?.running)&&(wasActive||tv?.active)&&(!tv?.active||!tv.matches()||wasActive!==tv.active)){
    startupAbort?.abort();pause('TV meldet kein passendes Laufvideo mehr. Laufband am Gerät anhalten.');
   }
  }else if(message.type==='app.suspend'){
   tv?.suspend();startupAbort?.abort();if(workout?.running)pause('App im Hintergrund. Laufband am Gerät anhalten.');else pauseVideo();
  }else if(message.type==='app.resume'){tv?.resume();window.VirtualWalkingNative.rpc('cast.status').catch(()=>{});}
 });


 function announce(message,error=false){text('message',message);$('message').classList.toggle('error',error);}
 function settings(){const reference=Number($('referenceSpeed').value);return {sync:$('syncEnabled').checked,pauseAtZero:$('pauseAtZero').checked,reference:Number.isFinite(reference)&&reference>=1&&reference<=15?reference:4};}
 function fresh(){return bt.connected&&lastDataAt>0&&performance.now()-lastDataAt<5000;}
 function freshSpeed(){return fresh()&&lastSpeedAt>0&&performance.now()-lastSpeedAt<5000;}
 function videoPlaying(){if(tv?.active)return tv.playing;try{return videoKind==='youtube'?youtubeReady&&youtubePlayer?.getPlayerState()===1:videoKind!=='none'&&!$('video').paused&&!$('video').ended;}catch{return false;}}
 function playVideo(){
  if(videoKind==='none')return;
  wantedVideo=true;
  if(document.hidden)return;
  if(tv?.active){tv.play().catch(error=>{text('videoStatus',C.errorText(error));});return;}
  try{if(videoKind==='youtube'){if(youtubeReady)youtubePlayer.playVideo();}else $('video').play().catch(()=>text('videoStatus','Bitte zum Starten einmal ▶ im Video drücken.'));}catch{ text('videoStatus','Bitte die Wiedergabe im Video starten.');}
 }
 function pauseVideo(automatic=false){
  if(!automatic){wantedVideo=false;beltPaused=false;}
  if(tv?.active){tv.pause().catch(error=>text('videoStatus',C.errorText(error)));return;}
  try{if(videoKind==='youtube')youtubePlayer?.pauseVideo();else $('video').pause();}catch{}
 }
 function stopVideo(){if(tv?.active){wantedVideo=false;beltPaused=false;tv.stop().catch(error=>text('videoStatus',C.errorText(error)));return;}pauseVideo();try{if(videoKind==='youtube')youtubePlayer?.seekTo(0,true);else $('video').currentTime=0;}catch{}}
 async function keepAwake(enabled){
  if(!enabled){if(wakeLock){const lock=wakeLock;wakeLock=null;await lock.release().catch(()=>{});}return;}
  if(wakeLock||!navigator.wakeLock||document.hidden)return;
  try{wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>{wakeLock=null;},{once:true});}catch{}
 }
 function renderWorkout(){
  text('speed',bt.connected&&Number.isFinite(speed)?decimal(speed):'—');
  $('distance').replaceChildren(document.createTextNode(decimal(workout?.distanceKm||0,2)+' '),unit('km'));
  text('duration',C.formatTime(workout?.seconds||0));
  $('average').replaceChildren(document.createTextNode(decimal(workout?.averageKmh||0)+' '),unit('km/h'));
  const calories=workout?C.calories(Number($('weight').value),workout.averageKmh,workout.seconds):null;
  $('calories').replaceChildren(document.createTextNode((calories===null?'—':String(calories))+' '),unit('kcal'));
  $('start').disabled=!bt.connected||!!workout?.running||starting||stopping;
  text('start',starting?'Startet …':stopping?'Wird angehalten …':workout?'▶ Fortsetzen':'▶ Training starten');
  $('pause').disabled=stopping||(!starting&&!workout?.running&&!motorMayRun);$('finish').disabled=stopping||(!starting&&!workout&&!motorMayRun);
  for(const id of ['fileInput','showLink','pasteLink','videoUrl'])$(id).disabled=starting||stopping;
  text('trainingStatus',starting?'Gemeinsamer Start':stopping?'Wird angehalten':workout?(workout.running?'Aufzeichnung läuft':'Pausiert'):'Bereit');
  text('controlMode',bt.canControl?'FTMS · Steuerkanal bereit':'FTMS · Daten verbunden');
  if(!bt.connected)text('controlMode','FTMS · Nicht verbunden');
  text('trainingHint',!bt.connected?'Verbinde das Laufband und wähle ein Video. „Training starten“ prüft den gemeinsamen Start.':bt.canControl?'„Training starten“ fordert den gemeinsamen Start von Laufband und Video an. Das Starttempo bestimmt das Laufband. Nach einem App-Start halten „Pause“ und „Beenden“ auch das Band an.':'Unsere App konnte den Steuerkanal noch nicht öffnen. Trenne die Laufband-Verbindung in Wellfit und verbinde das Laufband hier erneut. Für Video und Aufzeichnung kannst du das Band auch am Gerät starten.');
  text('controlIssue',bt.controlIssue||'');$('controlIssue').hidden=!bt.connected||bt.canControl||!bt.controlIssue;
  $('controlHint').hidden=!bt.canControl;
 }
 function unit(value){const small=document.createElement('small');small.textContent=value;return small;}
 function beginRecording(play=true){
  if(!bt.connected){announce('Bitte zuerst das Laufband verbinden.');return;}
  if(workout?.running)return;
  const now=performance.now();
  if(workout)workout.resume(now,nativeDistance);else workout=new C.Workout(now,nativeDistance);
  if(play)playVideo();keepAwake(true);announce('Training und Video laufen.');renderWorkout();syncVideo();
 }
 function requestPlayback(signal,hold=false){
  if(tv?.active){
   if(videoKind!=='youtube')return Promise.reject(Error('Dieser TV-Baustein übernimmt bestehende YouTube-TV-Sitzungen. Bitte ein YouTube-Laufvideo wählen.'));
   return (hold?tv.prepare(signal):tv.play(signal)).then(()=>{if(!hold){wantedVideo=true;beltPaused=false;}});
  }
  if(videoKind==='none')return Promise.reject(Error('Bitte zuerst ein Laufvideo wählen.'));
  if(videoKind==='youtube'&&!youtubeReady)return Promise.reject(Error('Bitte warten, bis das YouTube-Video bereit ist.'));
  if(videoKind!=='youtube'&&$('video').error)return Promise.reject(Error('Das gewählte Video ist nicht abspielbar.'));
  if(signal.aborted||document.hidden)return Promise.reject(Error('Start abgebrochen.'));
  return new Promise((resolve,reject)=>{
   const generation=sourceGeneration;
   const clean=()=>{clearTimeout(probe.timer);signal.removeEventListener('abort',abort);if(playbackProbe===probe)playbackProbe=null;};
   const abort=()=>probe.fail(Error('Start abgebrochen.'));
   const probe={success:()=>{
    if(playbackProbe!==probe||probe.waitingPause)return;
    if(signal.aborted||document.hidden||generation!==sourceGeneration){probe.fail(Error('Start abgebrochen.'));return;}
    wantedVideo=true;beltPaused=false;
    if(hold){probe.waitingPause=true;pauseVideo(true);if(videoKind!=='youtube'&&$('video').paused)probe.paused();}
    else{clean();resolve();}
   },paused:()=>{if(playbackProbe===probe&&probe.waitingPause){clean();resolve();}},fail:error=>{if(playbackProbe!==probe)return;clean();pauseVideo();reject(error);}};
   playbackProbe=probe;signal.addEventListener('abort',abort,{once:true});
   probe.timer=setTimeout(()=>probe.fail(Error('Das Video startet noch nicht. Bitte einmal ▶ im Videoplayer drücken und danach erneut „Training starten“.')),8000);
   try{if(videoPlaying())probe.success();else if(videoKind==='youtube')youtubePlayer.playVideo();else $('video').play().then(probe.success,()=>probe.fail(Error('Bitte das Video zuerst einmal im Player freigeben und danach „Training starten“ drücken.')));}
   catch(error){probe.fail(error);}
  });
 }
 function waitForMotion(signal){
  return new Promise((resolve,reject)=>{
   const clean=()=>{clearTimeout(timer);clearInterval(poll);signal.removeEventListener('abort',abort);};
   const abort=()=>{clean();reject(Error('Start abgebrochen.'));};
   const timer=setTimeout(()=>{clean();reject(Error('Der Start wurde bestätigt, aber es wurden keine aktuellen Bewegungsdaten gemeldet.'));},20000);
   const poll=setInterval(()=>{if(freshSpeed()&&Number.isFinite(speed)&&speed>=.1){clean();resolve();}},100);
   signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
 }
 function stopMotor(paused=false){
  if(stopTask)return stopTask;
  if(!motorMayRun||!coupled)return Promise.resolve();
  stopTask=bt.stop(paused).then(()=>{motorMayRun=false;stopConfirmed=true;}).finally(()=>{stopTask=null;});return stopTask;
 }
 function begin(){
  if(starting||stopping||workout?.running)return;
  if(!bt.connected){announce('Bitte zuerst das Laufband verbinden.',true);return;}
  if(bt.startBlockedReason){announce(bt.startBlockedReason,true);return;}
  if(!freshSpeed()||!Number.isFinite(speed)){announce('Bitte auf aktuelle Geschwindigkeitsdaten des Laufbands warten.',true);return;}
  if(speed<.1&&!bt.canControl){announce('App-Start noch nicht möglich: '+(bt.controlIssue||'Der Steuerkanal konnte nicht geöffnet werden.')+' Bitte Wellfit trennen und Bluetooth hier neu verbinden. Alternativ am Gerät starten, dann „Training starten“ drücken.',true);return;}
  // Unlock iOS YouTube playback synchronously in the user's tap gesture, before awaiting BLE operations.
  // The joint-start state machine will pause the preview before requesting belt motion.
  if(videoKind==='youtube' && youtubeReady && !tv?.active) { try { youtubePlayer.playVideo(); } catch {} }
  starting=true;const controller=new AbortController();startupAbort=controller;renderWorkout();
  announce('Video wird vorbereitet. Danach wird der Laufband-Start angefordert.');
  startupTask=(async()=>{
   try{
    await window.VirtualWalkingStart.jointStart({signal:controller.signal,
     prepareVideo:signal=>requestPlayback(signal,true),isMoving:()=>freshSpeed()&&Number.isFinite(speed)&&speed>=.1,
     allowStart:()=>freshSpeed()&&Number.isFinite(speed)&&speed<.1,
     driver:bt,onSent:()=>{motorMayRun=true;coupled=true;stopConfirmed=false;announce('Laufband-Start gesendet. Warte auf Bestätigung und Bandbewegung …');},
     waitForMotion,playVideo:signal=>requestPlayback(signal,false),beginRecording:()=>beginRecording(false)});
   }catch(error){
    pauseVideo();let hint='';
    if(motorMayRun){try{await stopMotor();hint=' Der Stoppbefehl wurde vom Laufband bestätigt.';}catch{hint=' Bitte das Laufband jetzt am Gerät anhalten.';}}
    announce((controller.signal.aborted?'Gemeinsamer Start abgebrochen.':'Gemeinsamer Start nicht möglich: '+C.errorText(error))+hint,true);
   }finally{starting=false;startupAbort=null;startupTask=null;renderWorkout();syncVideo();}
  })();
 }
 function pause(reason='Training und Video pausiert.'){
  if(workout?.running)workout.pause(performance.now(),speed,fresh());
  pauseVideo();keepAwake(false);announce(reason);renderWorkout();
 }
 function finishRecording(){
  if(!workout)return;
  if(workout.running)workout.pause(performance.now(),speed,fresh());
  const record={date:workout.startedAt,duration:Math.round(workout.seconds),km:Number(workout.distanceKm.toFixed(3)),averageSpeed:Number(workout.averageKmh.toFixed(2)),calories:C.calories(Number($('weight').value),workout.averageKmh,workout.seconds),route:videoName||'Ohne Laufvideo',device:bt.device?.name||'FTMS-Laufband'};
  if(!write('history',[record,...history()].slice(0,500))){pause('Aufzeichnung pausiert. Die Einheit konnte nicht gespeichert werden.');return;}
  stopVideo();keepAwake(false);workout=null;renderHistory();renderWorkout();announce('Training lokal gespeichert.');
 }
 async function pauseFromButton(){
  if(stopping)return;stopping=true;const task=startupTask;startupAbort?.abort();pause();renderWorkout();
  try{if(task)await task;if(motorMayRun)await stopMotor(true);announce('Training und Video pausiert.'+(coupled?(stopConfirmed?' Der Pause-/Stoppbefehl wurde vom Laufband bestätigt.':' Laufband am Gerät prüfen.'):''));}
  catch{announce('Aufzeichnung und Video pausiert. Bitte das Laufband am Gerät anhalten – keine Stoppbestätigung erhalten.',true);}
  finally{stopping=false;renderWorkout();}
 }
 async function finishFromButton(){
  if(stopping)return;stopping=true;const task=startupTask;startupAbort?.abort();pause();renderWorkout();let failed=false;
  try{if(task)await task;if(motorMayRun)await stopMotor();}catch{failed=true;}
  finishRecording();if(failed)announce('Bitte das Laufband am Gerät anhalten – der Stopp wurde nicht bestätigt.',true);
  else if(!workout)announce('Training beendet.'+(coupled?(stopConfirmed?' Der Laufband-Stopp wurde bestätigt.':' Laufband am Gerät prüfen.'):''));
  stopping=false;renderWorkout();
 }
 function connectionChanged(info){
  $('connectionDot').classList.toggle('active',info.connected);$('connect').hidden=info.connected;$('disconnect').hidden=!info.connected;
  text('connectionStatus',info.connected?'Verbunden':'Nicht verbunden');
  if(info.connected){connectedAt=performance.now();motorMayRun=false;coupled=false;stopConfirmed=false;write('lastDevice',{id:info.id,name:info.name});text('deviceName',info.name);announce('Mit '+info.name+' verbunden.'+(info.canControl?' Steuerkanal bereit. „Training starten“ prüft die Freigabe am Laufband.':' Trainingsdaten verfügbar. Der Steuerkanal konnte noch nicht geöffnet werden.'));}
  else{
   startupAbort?.abort();playbackProbe?.fail(Error('Bluetooth-Verbindung getrennt.'));
   const reason=motorMayRun?'Bluetooth getrennt – Aufzeichnung und Video pausiert. Bitte das Laufband am Gerät anhalten.':'Bluetooth-Verbindung getrennt – Aufzeichnung und Video pausiert.';
   if(workout?.running)pause(reason);else{pauseVideo();if(motorMayRun)announce(reason,true);}
   speed=null;nativeDistance=null;lastDataAt=0;lastSpeedAt=0;const previous=read('lastDevice',null);text('deviceName',previous?.name?'Zuletzt: '+previous.name:'FTMS-Laufband auswählen');
  }
  renderWorkout();syncVideo();
 }
 function telemetry(data){
  const now=performance.now();if(workout?.running)workout.tick(now,speed,fresh());
  if(Number.isFinite(data.speed)){speed=data.speed;lastSpeedAt=now;}
  if(Number.isFinite(data.distanceKm)){nativeDistance=data.distanceKm;workout?.telemetry(nativeDistance);}
  lastDataAt=now;renderWorkout();syncVideo();
 }
 function machineStatus(status){
  if(status.code===0x03||(status.code===0x02&&status.reason===0x01)){motorMayRun=false;startupAbort?.abort();speed=0;if(workout)finishRecording();else pauseVideo();announce(status.code===0x03?'Sicherheitsstopp erkannt. Die laufende Einheit wurde beendet.':'Laufband-Stopp erkannt. Die laufende Einheit wurde beendet.');}
  else if(status.code===0x02&&status.reason===0x02){startupAbort?.abort();speed=0;if(workout?.running)pause('Laufband pausiert – Aufzeichnung und Video pausiert.');else pauseVideo();}
  else if(status.code===0x04&&workout&&!workout.running&&!starting&&!stopping)beginRecording();
  else if(status.code===0xff){startupAbort?.abort();pause('Steuerfreigabe verloren. Laufband am Gerät bedienen.');}
  renderWorkout();syncVideo();
 }
 const bt=new window.VirtualWalkingBluetooth.FTMSClient({bluetooth:navigator.bluetooth,onConnection:connectionChanged,onData:telemetry,onStatus:machineStatus,onError:error=>announce(C.errorText(error),true)});
 $('browserNotice').hidden=!!navigator.bluetooth?.requestDevice;
 $('connect').addEventListener('click',async()=>{
  if(!navigator.bluetooth?.requestDevice){$('browserNotice').hidden=false;announce('Für Bluetooth bitte diese Seite in Bluefy öffnen.',true);return;}
  $('connect').disabled=true;text('connectionStatus','Laufband auswählen …');
  try{await bt.connect();}catch(error){text('connectionStatus','Nicht verbunden');announce(error?.name==='NotFoundError'?'Geräteauswahl abgebrochen oder kein FTMS-Laufband gefunden.':'Bluetooth: '+C.errorText(error),error?.name!=='NotFoundError');}
  finally{$('connect').disabled=false;renderWorkout();}
 });
 $('disconnect').addEventListener('click',()=>{const wasRunning=motorMayRun;bt.disconnect();announce(wasRunning?'Bluetooth getrennt. Bitte das Laufband am Gerät anhalten.':'Bluetooth-Verbindung getrennt.',wasRunning);});
 const previous=read('lastDevice',null);if(previous?.name)text('deviceName','Zuletzt: '+previous.name);

 function resetVideo(){
  startupAbort?.abort();playbackProbe?.fail(Error('Video gewechselt.'));
  ++sourceGeneration;pauseVideo();
  if(youtubePlayer){try{youtubePlayer.destroy();}catch{}youtubePlayer=null;}
  youtubeReady=false;$('youtube').replaceChildren();$('youtube').hidden=true;
  const video=$('video');video.pause();video.removeAttribute('src');video.load();video.hidden=true;
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
  tv?.setSource(null,null);
  videoKind='none';lastRateRequest=null;lastRateRequestAt=0;actualRate=null;beltPaused=false;
  $('videoPlaceholder').hidden=true;
 }
 function markVideo(name,source){videoName=name;text('videoTitle',name);text('videoSource',source);}
 function loadFile(file){
  if(!file)return;
  const resume=!!workout?.running;resetVideo();videoKind='local';objectUrl=URL.createObjectURL(file);
  $('video').hidden=false;$('video').src=objectUrl;markVideo(file.name,'Vom iPhone');text('videoStatus','Lokales Video wird geladen …');wantedVideo=resume;
  if(resume)playVideo();syncVideo();
 }
 $('fileInput').addEventListener('change',event=>{loadFile(event.target.files?.[0]);event.target.value='';});
 $('showLink').addEventListener('click',()=>{const show=$('linkPanel').hidden;$('linkPanel').hidden=!show;$('showLink').setAttribute('aria-expanded',String(show));});
 function linkFeedback(message,error=false){text('linkStatus',message);$('linkStatus').classList.toggle('error',error);}
 function youtubeId(value){
  const url=new URL(value);const host=url.hostname.toLowerCase().replace(/^www\./,'');
  if(host==='youtu.be')return url.pathname.split('/')[1];
  if(['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host)){if(url.pathname==='/watch')return url.searchParams.get('v');return url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]||null;}
  return null;
 }
 function validLastYoutube(value){return value&&typeof value.id==='string'&&/^[a-zA-Z0-9_-]{11}$/.test(value.id)&&typeof value.title==='string'&&value.title.length<=512;}
 function rememberYoutube(id,title=''){
  const saved={id,title:String(title).slice(0,512)};if(!validLastYoutube(saved))return;
  write('lastYoutube',saved);
  window.VirtualWalkingNative?.rpc('video.last.set',saved).catch(()=>{});
 }
 function offerLastYoutube(saved){
  if(!validLastYoutube(saved)||sourceGeneration!==0||$('videoUrl').value.trim())return;
  $('videoUrl').value='https://www.youtube.com/watch?v='+saved.id;
  $('linkPanel').hidden=false;$('showLink').setAttribute('aria-expanded','true');
  linkFeedback('Zuletzt gewählt: '+(saved.title||'YouTube-Laufvideo')+' · Mit „Öffnen“ erneut laden.');
 }
 let videoLinkEdited=false;
 $('videoUrl').addEventListener('input',()=>{videoLinkEdited=true;});
 function youtubeApi(){
  if(window.YT?.Player)return Promise.resolve();if(youtubePromise)return youtubePromise;
  youtubePromise=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.async=true;
   const fail=()=>{clearTimeout(timeout);youtubePromise=null;script.remove();reject(Error('YouTube konnte nicht geladen werden. Internetverbindung prüfen und erneut versuchen.'));};
   const timeout=setTimeout(fail,15000);script.onerror=fail;
   window.onYouTubeIframeAPIReady=()=>{clearTimeout(timeout);resolve();};document.head.append(script);
  });return youtubePromise;
 }
 async function loadYoutube(id){
  rememberYoutube(id);
  const resume=!!workout?.running;resetVideo();videoKind='youtube';tv?.setSource('youtube',id);const generation=sourceGeneration;
  markVideo('YouTube-Laufvideo','YouTube');text('videoStatus','YouTube wird geladen …');$('youtube').hidden=false;wantedVideo=resume;
  try{
   await youtubeApi();if(generation!==sourceGeneration)return;
   const frame=document.createElement('iframe');frame.title='YouTube-Laufvideo';frame.referrerPolicy='strict-origin-when-cross-origin';frame.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';frame.allowFullscreen=true;
   frame.src='https://www.youtube-nocookie.com/embed/'+id+'?enablejsapi=1&playsinline=1&rel=0&origin='+encodeURIComponent(window.VirtualWalkingNative?'https://virtualwalking-iphone-bluefy.saltychick64.chatgpt.site':location.origin);$('youtube').append(frame);
   youtubePlayer=new YT.Player(frame,{events:{
    onReady:event=>{if(generation!==sourceGeneration)return;youtubeReady=true;const title=event.target.getVideoData?.().title;if(title){markVideo(title,'YouTube');rememberYoutube(id,title);}text('videoStatus','YouTube bereit. Zum Starten ggf. einmal ▶ im Player drücken.');if(wantedVideo)playVideo();syncVideo();},
    onPlaybackRateChange:event=>{if(generation!==sourceGeneration)return;actualRate=Number(event.data);syncVideo();},
    onStateChange:event=>{if(generation!==sourceGeneration)return;if(event.data===1){wantedVideo=true;beltPaused=false;text('videoStatus','YouTube läuft.');playbackProbe?.success();}else if(event.data===2){text('videoStatus','YouTube pausiert.');playbackProbe?.paused();}else if(event.data===3)text('videoStatus','YouTube puffert …');else if(event.data===0){wantedVideo=false;text('videoStatus','YouTube-Video beendet.');}},
    onAutoplayBlocked:()=>{text('videoStatus','Bitte einmal ▶ im YouTube-Player drücken, um die Wiedergabe freizugeben.');playbackProbe?.fail(Error('YouTube blockiert den Start. Bitte einmal ▶ im Player drücken, dann erneut „Training starten“.'));},
    onError:event=>{const messages={2:'Der YouTube-Link ist ungültig.',5:'YouTube kann dieses Video hier nicht abspielen.',100:'Das YouTube-Video ist nicht verfügbar.',101:'Dieses Video darf nicht eingebettet werden. Bitte ein anderes wählen.',150:'Dieses Video darf nicht eingebettet werden. Bitte ein anderes wählen.',153:'YouTube hat die Einbettung nicht freigegeben. Bitte ein anderes Video versuchen.'};const message=messages[event.data]||'YouTube-Fehler '+event.data;text('videoStatus',message);playbackProbe?.fail(Error(message));}
   }});
  }catch(error){if(generation===sourceGeneration){text('videoStatus',C.errorText(error));announce(C.errorText(error),true);}}
 }
 function openLink(value){
  value=value.trim();let url,id;
  try{url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw Error();id=youtubeId(value);if(/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(url.hostname)&&!id)throw Error();if(id&&!/^[a-zA-Z0-9_-]{11}$/.test(id))throw Error();}
  catch{const message='Bitte einen gültigen YouTube-Video-Link oder HTTPS-Videolink einfügen.';linkFeedback(message,true);announce(message,true);return false;}
  $('linkPanel').hidden=true;$('showLink').setAttribute('aria-expanded','false');$('videoUrl').blur();
  if(id)loadYoutube(id);else{const resume=!!workout?.running;resetVideo();videoKind='direct';$('video').hidden=false;$('video').src=url.toString();markVideo('Direktes Onlinevideo','Onlinevideo');text('videoStatus','Onlinevideo wird geladen …');if(resume)playVideo();syncVideo();}
  linkFeedback('Video übernommen. Zum Abspielen im Player ▶ drücken.');
  announce('Video-Link übernommen. Zum Abspielen im Player ▶ drücken.');
  return true;
 }
 $('linkPanel').addEventListener('submit',event=>{event.preventDefault();openLink($('videoUrl').value);});
 $('pasteLink').addEventListener('click',async()=>{
  const button=$('pasteLink');button.disabled=true;
  try{
   if(!navigator.clipboard?.readText)throw Error('Clipboard unavailable');
   const value=(await navigator.clipboard.readText()).trim();
   if(!value){linkFeedback('Noch kein Link kopiert. Bei YouTube „Teilen“ → „Link kopieren“ wählen.',true);return;}
   // Read only on this explicit tap; never inspect the clipboard on return to the app.
   // Unrelated clipboard contents are neither displayed nor stored.
   if(!openLink(value))return;
   $('videoUrl').value=value;
  }catch{
   linkFeedback('Bitte das Eingabefeld länger berühren, „Einfügen“ wählen und anschließend „Öffnen“ antippen.',true);
   $('videoUrl').focus();
  }finally{button.disabled=false;}
 });
 const video=$('video');
 video.addEventListener('loadedmetadata',()=>{text('videoStatus','Video bereit.');syncVideo();if(wantedVideo)playVideo();});
 video.addEventListener('playing',()=>{wantedVideo=true;beltPaused=false;text('videoStatus',videoKind==='local'?'Lokales Video läuft.':'Onlinevideo läuft.');playbackProbe?.success();});
 video.addEventListener('pause',()=>{if(videoKind==='local'||videoKind==='direct')text('videoStatus','Video pausiert.');});
 video.addEventListener('waiting',()=>text('videoStatus','Video puffert …'));
 video.addEventListener('ended',()=>{wantedVideo=false;text('videoStatus','Video beendet.');});
 video.addEventListener('error',()=>{if(videoKind==='none')return;const message='Dieses Video kann nicht abgespielt werden. Bitte z. B. eine MP4-Datei mit H.264 wählen.';text('videoStatus',message);playbackProbe?.fail(Error(message));});
 video.addEventListener('ratechange',()=>{actualRate=video.playbackRate;});

 function syncLabel(status,feedback,rate=null,confirmed=false){text('syncStatus',status);text('rateFeedback',feedback);text('rateValue',rateLabel(rate));$('syncDot').classList.toggle('active',confirmed);}
 function syncVideo(){
  if(tv?.active){
   renderTV();const opts=settings();
   if(starting){syncLabel('Gemeinsamer Start am TV','Warte auf TV-Bestätigung und Bandbewegung.');return;}
   if(!tv.matches()){syncLabel('TV-Video noch nicht zugeordnet','Dasselbe YouTube-Video zuerst am Fernseher öffnen.');return;}
   if(!tv.fresh()){if(wantedVideo||tv.playing){beltPaused=true;pauseVideo(true);}syncLabel('Keine aktuelle TV-Rückmeldung','Laufband am Gerät anhalten.',null);return;}
   if(!opts.sync){syncLabel('TV-Tempoanpassung aus','Videotempo wird nicht automatisch verändert.',tv.rate);return;}
   if(!freshSpeed()||!Number.isFinite(speed)){if(wantedVideo||tv.playing){beltPaused=true;pauseVideo(true);}syncLabel('Warte auf Laufbanddaten','TV-Wiedergabe pausiert.',tv.rate);return;}
   if(speed<.1&&opts.pauseAtZero){if(wantedVideo||tv.playing){beltPaused=true;pauseVideo(true);}syncLabel('Laufband steht','TV-Video pausiert.',tv.rate);return;}
   if(beltPaused&&speed>=.2&&wantedVideo){
   // Keep the automatic-pause latch until playback is confirmed. A rejected or
   // delayed YouTube play request must not permanently disable auto-resume.
   playVideo();
   if(videoPlaying())beltPaused=false;
  }
   const requested=C.targetRate(speed,opts.reference);
   if(tv.rateError){syncLabel('TV-Tempo nicht bestätigt',tv.rateError,tv.rate);return;}
   if(tv.playing)tv.setRate(requested).catch(error=>syncLabel('TV-Tempo nicht bestätigt',C.errorText(error),tv.rate));
   const confirmed=tv.playing&&tv.confirmedRate===requested&&Math.abs(tv.rate-requested)<.025;
   syncLabel(confirmed?'Synchron · TV meldet Tempo':'Warte auf TV-Temporückmeldung','Angefordert '+rateLabel(requested)+' · TV '+rateLabel(tv.rate),tv.rate,confirmed);return;
  }
  if(starting){syncLabel('Gemeinsamer Start wird vorbereitet','Video wartet auf bestätigten Start und Bandbewegung.');return;}
  if(videoKind==='none'){syncLabel('Tempoanpassung bereit','Video und Laufband verbinden.');return;}
  const opts=settings();
  try{actualRate=videoKind==='youtube'?(youtubeReady?youtubePlayer.getPlaybackRate():null):video.playbackRate;}catch{actualRate=null;}
  if(!opts.sync){syncLabel('Tempoanpassung aus','Videotempo wird nicht automatisch verändert.',actualRate);return;}
  if(!bt.connected){syncLabel('Laufband verbinden','Ohne Live-Daten bleibt das Videotempo manuell.',actualRate);return;}
  if(!fresh()||!Number.isFinite(speed)){
   if(!beltPaused&&(wantedVideo||videoPlaying())){beltPaused=true;pauseVideo(true);}
   syncLabel('Warte auf Laufbanddaten','Noch keine aktuellen Geschwindigkeitsdaten.',actualRate);return;
  }
  if(speed<.1&&opts.pauseAtZero){if(!beltPaused&&(wantedVideo||videoPlaying())){beltPaused=true;pauseVideo(true);}syncLabel('Laufband steht','Das Video pausiert bis das Laufband wieder läuft.',actualRate,true);return;}
  if(beltPaused&&speed>=.2&&wantedVideo){
   // Keep the automatic-pause latch until playback is confirmed. A rejected or
   // delayed YouTube play request must not permanently disable auto-resume.
   playVideo();
   if(videoPlaying())beltPaused=false;
  }
  const requested=C.targetRate(speed,opts.reference);
  if(videoKind==='youtube'){
   if(!youtubeReady){syncLabel('YouTube wird vorbereitet','Warte auf die verfügbaren Tempostufen.');return;}
   let rates=[];try{rates=(youtubePlayer.getAvailablePlaybackRates()||[]).filter(n=>n>=.5&&n<=2);}catch{}
   const closest=C.nearestRate(requested,rates);
   if(closest===null){syncLabel('YouTube meldet noch kein Tempo','Bitte das Video einmal starten.',actualRate);return;}
   if(rates.length===1&&rates[0]===1&&Math.abs(requested-1)>.025){syncLabel('YouTube bietet nur normales Tempo','Dieses Video erlaubt hier keine variable Wiedergabe.',actualRate);return;}
   const confirmed=Number.isFinite(actualRate)&&Math.abs(actualRate-closest)<.025;
   const now=Date.now();
   if(!confirmed&&(lastRateRequest!==closest||now-lastRateRequestAt>2500)){
    try{youtubePlayer.setPlaybackRate(closest);lastRateRequest=closest;lastRateRequestAt=now;}catch{syncLabel('YouTube-Tempo nicht übernommen','Bitte anderes Video versuchen.',actualRate);return;}
   }
   syncLabel(confirmed?'Synchron · YouTube-Stufe':'Warte auf YouTube-Temporückmeldung','Angefordert '+rateLabel(closest)+' · Player '+rateLabel(actualRate),actualRate,confirmed);
  }else{
   try{if(Math.abs(video.playbackRate-requested)>.01)video.playbackRate=requested;actualRate=video.playbackRate;
    const confirmed=Math.abs(actualRate-requested)<.025;syncLabel(confirmed?'Synchron zum Laufband':'Videotempo noch nicht übernommen','Angefordert '+rateLabel(requested)+' · Player '+rateLabel(actualRate),actualRate,confirmed);
   }catch{syncLabel('Dieses Video unterstützt das Tempo nicht','Bitte eine andere Videodatei wählen.',actualRate);}
  }
 }
 const savedSettings=read('settings',{});
 if(typeof savedSettings.sync==='boolean')$('syncEnabled').checked=savedSettings.sync;
 if(typeof savedSettings.pauseAtZero==='boolean')$('pauseAtZero').checked=savedSettings.pauseAtZero;
 if(Number(savedSettings.reference)>=1&&Number(savedSettings.reference)<=15)$('referenceSpeed').value=String(savedSettings.reference);
 function saveSettings(showValidation=false){
  if(!$('referenceSpeed').checkValidity()){if(showValidation)$('referenceSpeed').reportValidity();return;}
  write('settings',settings());
  if(!settings().sync){beltPaused=false;try{if(videoKind==='youtube')youtubePlayer?.setPlaybackRate(1);else video.playbackRate=1;}catch{}}
  syncVideo();
 }
 for(const id of ['syncEnabled','pauseAtZero','referenceSpeed'])$(id).addEventListener('change',()=>saveSettings(true));
 $('referenceSpeed').addEventListener('input',()=>saveSettings());
 const rules={weight:[25,300],height:[100,250],age:[10,120]};const profile=read('profile',{});
 for(const id of ['weight','height','age','gender']){
  const input=$(id),saved=String(profile[id]||'');
  const valid=value=>id==='gender'?['','female','male','diverse'].includes(value):!value||(Number.isFinite(Number(value))&&Number(value)>=rules[id][0]&&Number(value)<=rules[id][1]);
  if(valid(saved))input.value=saved;
  const saveProfile=showValidation=>{
   if(!valid(input.value)){if(showValidation)text('profileStatus','Bitte die Angabe überprüfen.');return;}
   const data=read('profile',{});data[id]=input.value;
   text('profileStatus',write('profile',data)?'Persönliche Angaben lokal gespeichert.':'Speichern nicht möglich.');renderWorkout();
  };
  input.addEventListener('change',()=>saveProfile(true));
  input.addEventListener('input',()=>saveProfile(false));
 }
 function history(){const values=read('history',[]);return Array.isArray(values)?values.filter(h=>h&&typeof h.date==='string'&&Number.isFinite(h.duration)&&Number.isFinite(h.km)).slice(0,500):[];}
 function renderHistory(){
  const entries=history();$('history').replaceChildren();text('historyCount',String(entries.length));
  if(!entries.length){const p=document.createElement('p');p.className='small-note';p.textContent='Noch keine gespeicherten Einheiten.';$('history').append(p);}
  for(const item of entries.slice(0,30)){const row=document.createElement('div');row.className='history-entry';const title=document.createElement('strong');title.textContent=decimal(item.km,2)+' km · '+C.formatTime(item.duration);const description=document.createElement('small');description.textContent=new Date(item.date).toLocaleString('de-DE')+' · Ø '+decimal(item.averageSpeed||0)+' km/h';const route=document.createElement('small');route.textContent=String(item.route||'Ohne Laufvideo');row.append(title,description,route);$('history').append(row);}
  $('export').disabled=!entries.length;$('clearHistory').disabled=!entries.length;
 }
 $('export').addEventListener('click',()=>{
  const cell=value=>{let str=String(value??'');if(/^[=+@-]/.test(str))str="'"+str;return '"'+str.replaceAll('"','""')+'"';};
  const rows=[['Datum','Dauer_Sekunden','Strecke_km','Durchschnitt_kmh','Kalorien_geschaetzt','Video','Laufband'],...history().map(h=>[h.date,h.duration,String(h.km).replace('.',','),String(h.averageSpeed||0).replace('.',','),h.calories,h.route,h.device])];
  const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='VirtualWalking-iPhone-Training.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
 });
 $('clearHistory').addEventListener('click',()=>{if(confirm('Alle in diesem Browser gespeicherten Trainingseinheiten löschen?')&&write('history',[])){renderHistory();announce('Trainingshistorie gelöscht.');}});
 $('start').addEventListener('click',begin);$('pause').addEventListener('click',pauseFromButton);$('finish').addEventListener('click',finishFromButton);
 document.addEventListener('visibilitychange',()=>{if(document.hidden){startupAbort?.abort();if(workout?.running)pause('Aufzeichnung pausiert, weil die App im Hintergrund ist. Laufband am Gerät anhalten.');else if(videoPlaying())pauseVideo();}});
 window.addEventListener('pagehide',()=>{bt.disconnect();if(objectUrl)URL.revokeObjectURL(objectUrl);});
 setInterval(()=>{
  const now=performance.now();
  if(workout?.running){
   const latest=lastDataAt||connectedAt;
   if(!bt.connected||now-latest>5000){workout.pause(Math.max(workout.lastTick,Math.min(now,latest+5000)),speed,true);pauseVideo();keepAwake(false);announce('Keine aktuellen Laufbanddaten – Aufzeichnung und Video pausiert. Laufband am Gerät anhalten und Verbindung prüfen.',true);}
   else workout.tick(now,speed,fresh());
  }
  renderWorkout();if(!document.hidden)syncVideo();
 },500);
 renderWorkout();renderHistory();syncVideo();renderTV();
 offerLastYoutube(read('lastYoutube',null));
 if(window.VirtualWalkingNative)window.VirtualWalkingNative.rpc('video.last.get').then(saved=>{
  if(videoLinkEdited||sourceGeneration!==0||!validLastYoutube(saved))return;
  const local=read('lastYoutube',null);
  if(!validLastYoutube(local))offerLastYoutube(saved);
 }).catch(()=>{});
 if(tv)window.VirtualWalkingNative.rpc('cast.status').catch(()=>{});
})();
