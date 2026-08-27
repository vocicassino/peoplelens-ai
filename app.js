import { PersonTracker, ObjectTracker } from './tracker.js';
import { DEFAULT_SETTINGS, pointInZone, isAfterHours, nearestPersonDistance, clusterSize } from './anomalies.js';
import { createPoseDetector, matchPosesToTracks, poseFallEvidence, drawPose } from './pose.js';
import { addEvent, getEvents, clearEvents } from './db.js';

const $ = s => document.querySelector(s);
const els = {
  video: $('#video'), overlay: $('#overlay'), cameraWrap: $('#cameraWrap'), emptyCamera: $('#emptyCamera'),
  startBtn: $('#startBtn'), stopBtn: $('#stopBtn'), switchBtn: $('#switchBtn'), zoneBtn: $('#zoneBtn'), installBtn: $('#installBtn'), exitViewBtn: $('#exitViewBtn'),
  modelBadge: $('#modelBadge'), liveBadge: $('#liveBadge'), fpsBadge: $('#fpsBadge'), poseBadge: $('#poseBadge'), cameraHud: $('#cameraHud'),
  visibleCount: $('#visibleCount'), occupancyCount: $('#occupancyCount'), entriesCount: $('#entriesCount'), exitsCount: $('#exitsCount'), peakCount: $('#peakCount'), peakTime: $('#peakTime'), crowdPercent: $('#crowdPercent'), crowdMeter: $('#crowdMeter'),
  avgDwell: $('#avgDwell'), poseStatus: $('#poseStatus'), hudVisible: $('#hudVisible'), hudOccupancy: $('#hudOccupancy'), hudEntries: $('#hudEntries'), hudExits: $('#hudExits'),
  alertPanel: $('#alertPanel'), alertIcon: $('#alertIcon'), alertTitle: $('#alertTitle'), alertText: $('#alertText'), anomalyCount: $('#anomalyCount'), eventLog: $('#eventLog'), toast: $('#toast'), zoneHelp: $('#zoneHelp'),
  fullAlert: $('#fullAlert'), fullAlertTitle: $('#fullAlertTitle'), fullAlertText: $('#fullAlertText'), heatmapCanvas: $('#heatmapCanvas'),
  personInspector: $('#personInspector'), personInspectorId: $('#personInspectorId'), personInspectorClose: $('#personInspectorClose'), personRisk: $('#personRisk'), personRiskLabel: $('#personRiskLabel'), personRiskDetail: $('#personRiskDetail'),
  personDwell: $('#personDwell'), personSpeed: $('#personSpeed'), personPose: $('#personPose'), personConfidence: $('#personConfidence'), personCrossing: $('#personCrossing'), personPosition: $('#personPosition'), personFlags: $('#personFlags'), personTrackStatus: $('#personTrackStatus')
};

let model=null, poseDetector=null, poseReady=false, poseLoadFailed=false, latestPoses=[];
let stream=null, running=false, inferenceBusy=false, lastInference=0, lastPoseInference=0, currentFacing='environment';
let entries=0, exits=0, peak=0, peakAt=null, occupancy=0, visible=0;
let personTracker=new PersonTracker(), objectTracker=new ObjectTracker();
let settings=loadSettings(); let recentCounts=[]; let lastFrameTs=0; let aiFrames=0; let fpsWindowStart=performance.now();
let anomalyCooldown=new Map(); let activeStates=new Set(); let drawZoneMode=false, zoneStart=null, tempZone=null; let installPrompt=null; let audioCtx=null;
let clusterSince=null, dwellTotalMs=0, dwellSamples=0, currentTracks=[];
let selectedTrackId=null;
const bagClasses=new Set(['backpack','handbag','suitcase']);
const heatCols=16, heatRows=9; let heatGrid=new Array(heatCols*heatRows).fill(0);

const settingIds=['confidence','maxOccupancy','baseOccupancy','lineY','entryDirection','stationarySeconds','fallSeconds','fallEscalationSeconds','speedThreshold','surgeCount','surgeWindow','clusterCount','clusterSeconds','clusterRadius','objectSeconds','openTime','closeTime','enableStationary','enableFall','enableSpeed','enableZone','enableSurge','enableCluster','enableAfterHours','enableObject','enableDark','soundAlerts'];

function loadSettings(){ try{return {...DEFAULT_SETTINGS,...JSON.parse(localStorage.getItem('peoplelensSettings')||'{}')}}catch{return {...DEFAULT_SETTINGS}} }
function saveSettings(){ localStorage.setItem('peoplelensSettings',JSON.stringify(settings)); }
function hydrateSettings(){
  for(const id of settingIds){ const el=$('#'+id); if(!el) continue; const v=settings[id]; if(el.type==='checkbox')el.checked=!!v; else if(id==='confidence')el.value=Math.round(v*100); else if(id==='lineY'||id==='speedThreshold'||id==='clusterRadius')el.value=Math.round(v*100); else el.value=v; }
  updateOutputs(); updateZoneHelp();
}
function readSettings(){
  for(const id of settingIds){ const el=$('#'+id); if(!el)continue; let v; if(el.type==='checkbox')v=el.checked; else if(el.type==='number'||el.type==='range')v=Number(el.value); else v=el.value; if(id==='confidence'||id==='lineY'||id==='speedThreshold'||id==='clusterRadius')v/=100; settings[id]=v; }
  saveSettings(); updateOutputs(); updateStats();
}
function updateOutputs(){
  $('#confidenceOut').textContent=Math.round(settings.confidence*100)+'%';
  $('#lineYOut').textContent=Math.round(settings.lineY*100)+'%';
  $('#speedOut').textContent=Math.round(settings.speedThreshold*100)+'%';
  $('#clusterRadiusOut').textContent=Math.round(settings.clusterRadius*100)+'%';
}
function updateZoneHelp(){ els.zoneHelp.innerHTML=settings.restrictedZone?'Zona riservata impostata. Attiva <b>Zona riservata</b> per generare gli avvisi.':'Zona riservata non impostata. Tocca <b>Disegna zona</b> e trascina un rettangolo sul video.'; }

async function loadModels(){
  els.modelBadge.textContent='Caricamento AI V2.1…'; els.modelBadge.className='pill warn';
  try{
    await tf.ready(); try{await tf.setBackend('webgl')}catch{}
    model=await cocoSsd.load({base:'lite_mobilenet_v2'});
    els.modelBadge.textContent='Oggetti pronti · '+tf.getBackend(); els.modelBadge.className='pill ok';
  } catch(err){ console.error(err); els.modelBadge.textContent='Errore AI'; els.modelBadge.className='pill danger'; toast('Impossibile caricare COCO-SSD. Controlla la connessione.'); return; }

  try{
    poseDetector=await createPoseDetector(); poseReady=true;
    els.modelBadge.textContent='AI V2.1 pronta · '+tf.getBackend(); els.poseStatus.textContent='ON';
  } catch(err){
    console.warn('MoveNet non disponibile, uso fallback:',err); poseLoadFailed=true; poseReady=false; els.poseStatus.textContent='Fallback';
    els.modelBadge.textContent='AI pronta · pose fallback';
  }
}

async function enterImmersive(){
  document.body.classList.add('camera-immersive');
  els.exitViewBtn.classList.remove('hidden'); els.cameraHud.classList.remove('hidden');
  try{
    if(!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({navigationUI:'hide'});
  }catch(err){ console.debug('Fullscreen API non disponibile:',err?.message); }
}
async function exitImmersive(){
  document.body.classList.remove('camera-immersive'); els.exitViewBtn.classList.add('hidden'); els.cameraHud.classList.add('hidden'); closePersonInspector();
  try{ if(document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen(); }catch{}
  resizeCanvas();
}

async function startCamera(){
  if(!model){toast('Il modello AI non è ancora pronto.');return}
  await enterImmersive();
  try{
    stopTracks();
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:currentFacing},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}}});
    els.video.srcObject=stream; await els.video.play(); running=true; resetSession();
    els.startBtn.disabled=true; els.stopBtn.disabled=false; els.switchBtn.disabled=false; els.zoneBtn.disabled=false; els.emptyCamera.classList.add('hidden'); els.liveBadge.classList.remove('hidden'); els.fpsBadge.classList.remove('hidden');
    if(poseReady) els.poseBadge.classList.remove('hidden'); else els.poseBadge.classList.add('hidden');
    ensureAudio(); resizeCanvas(); requestAnimationFrame(loop);
  }catch(err){ console.error(err); await exitImmersive(); toast(err.name==='NotAllowedError'?'Permesso fotocamera negato.':'Fotocamera non disponibile.'); }
}
function stopTracks(){ if(stream){stream.getTracks().forEach(t=>t.stop());stream=null} }
async function stopCamera(){ selectedTrackId=null; closePersonInspector(); running=false; stopTracks(); els.video.srcObject=null; els.startBtn.disabled=false; els.stopBtn.disabled=true; els.switchBtn.disabled=true; els.zoneBtn.disabled=true; els.emptyCamera.classList.remove('hidden'); els.liveBadge.classList.add('hidden'); els.fpsBadge.classList.add('hidden'); els.poseBadge.classList.add('hidden'); els.fullAlert.classList.add('hidden'); clearOverlay(); await exitImmersive(); }
async function switchCamera(){ currentFacing=currentFacing==='environment'?'user':'environment'; if(!running)return; try{stopTracks(); stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:currentFacing},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}}});els.video.srcObject=stream;await els.video.play();personTracker.reset();objectTracker.reset();latestPoses=[];selectedTrackId=null;closePersonInspector();resizeCanvas();toast(currentFacing==='environment'?'Fotocamera posteriore':'Fotocamera anteriore');}catch(err){toast('Impossibile cambiare fotocamera.');console.error(err)} }
function resetSession(){ selectedTrackId=null; closePersonInspector(); entries=0; exits=0; peak=0; peakAt=null; occupancy=settings.baseOccupancy; visible=0; recentCounts=[]; personTracker.reset();objectTracker.reset();anomalyCooldown.clear();activeStates.clear();clusterSince=null;dwellTotalMs=0;dwellSamples=0;currentTracks=[];latestPoses=[];heatGrid.fill(0);drawHeatmap();updateStats(); }

function resizeCanvas(){ const v=els.video,c=els.overlay; if(!v.videoWidth)return; if(c.width!==v.videoWidth||c.height!==v.videoHeight){c.width=v.videoWidth;c.height=v.videoHeight;} }
function clearOverlay(){ const c=els.overlay; c.getContext('2d').clearRect(0,0,c.width,c.height); }

async function loop(ts){
  if(!running)return; resizeCanvas(); drawGuides(currentTracks);
  const targetInterval=230;
  if(!inferenceBusy && ts-lastInference>=targetInterval && els.video.readyState>=2){
    inferenceBusy=true; lastInference=ts;
    try{ await inferFrame(); }catch(err){console.error(err)} finally{ inferenceBusy=false; }
  }
  requestAnimationFrame(loop);
}

async function inferFrame(){
  const now=performance.now(); const preds=await model.detect(els.video,35,settings.confidence); aiFrames++;
  const persons=preds.filter(p=>p.class==='person'); const objects=preds.filter(p=>bagClasses.has(p.class));
  const tracks=personTracker.update(persons,els.overlay.width,els.overlay.height,now); const objTracks=objectTracker.update(objects,els.overlay.width,els.overlay.height,now);
  const ended=personTracker.drainEnded(); for(const t of ended){ if(t.ageMs>1200){dwellTotalMs+=t.ageMs;dwellSamples++;} }

  if(poseReady && poseDetector && now-lastPoseInference>=650){
    try{ latestPoses=await poseDetector.estimatePoses(els.video,{maxPoses:6,flipHorizontal:false}); lastPoseInference=now; }
    catch(err){ console.warn('Pose inference:',err); latestPoses=[]; }
  }
  matchPosesToTracks(tracks,latestPoses,els.overlay.width,els.overlay.height);
  currentTracks=tracks;
  visible=tracks.length; processCrossings(tracks,now); occupancy=Math.max(0,settings.baseOccupancy+entries-exits); if(occupancy>peak){peak=occupancy;peakAt=Date.now();}
  updateHeatmap(tracks); processAnomalies(tracks,objTracks,now); renderPersonInspector(now); drawGuides(tracks,objTracks); updateStats(); updateFps(now);
}

function processCrossings(tracks,now){
  const line=els.overlay.height*settings.lineY;
  for(const t of tracks){
    const side=t.cy<line?'above':'below';
    if(t.lineSide==null){t.lineSide=side;continue}
    if(side!==t.lineSide && t.ageMs>450 && now-t.lastCrossAt>1800){
      const down=t.lineSide==='above'&&side==='below'; const isEntry=settings.entryDirection==='down'?down:!down;
      if(isEntry){entries++;t.lastCrossType='Ingresso';record('Ingresso',`P${t.id} ha attraversato la linea ingresso`,'info');} else {exits++;t.lastCrossType='Uscita';record('Uscita',`P${t.id} ha attraversato la linea uscita`,'info');}
      t.lastCrossAt=now; t.lastCrossEpoch=Date.now(); t.crossingCount=(t.crossingCount||0)+1; t.lineSide=side;
    } else t.lineSide=side;
  }
}

function updatePoseFallTrack(t,now){
  let evidence=null, lying=false;
  if(t.pose){ evidence=poseFallEvidence(t.pose); lying=evidence.lying; }
  else { const [, ,w,h]=t.bbox; lying=w/Math.max(h,1)>1.15; evidence={lying,confidence:lying?.55:0,reason:'fallback bounding box'}; }
  if(lying){ if(t.poseFallSince==null)t.poseFallSince=now; }
  else t.poseFallSince=null;
  const seconds=t.poseFallSince==null?0:(now-t.poseFallSince)/1000;
  t.poseFallEvidence=evidence; t.poseFallSeconds=seconds; t.poseLying=lying;
  return {lying,seconds,evidence};
}

function processAnomalies(tracks,objTracks,now){
  activeStates.clear(); const fw=els.overlay.width,fh=els.overlay.height,diag=Math.hypot(fw,fh)||1;
  if(occupancy>=settings.maxOccupancy){activeStates.add('crowd');trigger('crowd','Sovraffollamento',`Capienza ${occupancy}/${settings.maxOccupancy}`,'danger',5000)}

  for(const t of tracks){
    t.anomalyFlags=[];
    if(settings.enableStationary && (now-t.stationarySince)/1000>=settings.stationarySeconds){t.anomalyFlags.push('stationary');activeStates.add('stationary');trigger('stationary:'+t.id,'Permanenza insolita',`P${t.id} quasi ferma da ${Math.round((now-t.stationarySince)/1000)} s`,'warning',12000)}
    if(settings.enableFall){
      const fs=updatePoseFallTrack(t,now);
      if(fs.seconds>=settings.fallSeconds){t.anomalyFlags.push('fall');activeStates.add('fall');trigger('fall:'+t.id,'Possibile caduta',`P${t.id}: postura compatibile con persona a terra (${Math.round(fs.evidence.confidence*100)}%)`,'danger',9000)}
      if(fs.seconds>=settings.fallEscalationSeconds && t.speed<0.08){if(!t.anomalyFlags.includes('fall'))t.anomalyFlags.push('fall');t.fallEscalated=true;activeStates.add('fall');trigger('fall-escalation:'+t.id,'Persona a terra da verificare subito',`P${t.id}: postura a terra persistente da ${Math.round(fs.seconds)} s`,'danger',12000)} else t.fallEscalated=false;
    } else { t.poseFallSince=null; t.poseFallEvidence=null; t.poseFallSeconds=0; t.poseLying=false; t.fallEscalated=false; }
    if(settings.enableSpeed && t.speed>=settings.speedThreshold){t.anomalyFlags.push('speed');activeStates.add('speed');trigger('speed:'+t.id,'Movimento rapido',`P${t.id}: velocità anomala stimata`,'warning',8000)}
    if(settings.enableZone && settings.restrictedZone && pointInZone(t.cx,t.cy,settings.restrictedZone,fw,fh)){t.anomalyFlags.push('zone');activeStates.add('zone');trigger('zone:'+t.id,'Zona riservata',`P${t.id} dentro la zona configurata`,'danger',8000)}
  }

  const epoch=Date.now(); recentCounts.push({ts:epoch,count:visible}); recentCounts=recentCounts.filter(x=>epoch-x.ts<=settings.surgeWindow*1000);
  if(settings.enableSurge && recentCounts.length>1){ const min=Math.min(...recentCounts.map(x=>x.count)); if(visible-min>=settings.surgeCount){activeStates.add('surge');trigger('surge','Aumento improvviso',`+${visible-min} persone in circa ${settings.surgeWindow} s`,'warning',10000)} }

  if(settings.enableCluster){
    const n=clusterSize(tracks,diag,settings.clusterRadius);
    if(n>=settings.clusterCount){ if(clusterSince==null)clusterSince=now; if((now-clusterSince)/1000>=settings.clusterSeconds){activeStates.add('cluster');trigger('cluster','Assembramento locale',`${n} persone molto vicine da almeno ${settings.clusterSeconds} s`,'warning',12000)} }
    else clusterSince=null;
  } else clusterSince=null;

  if(settings.enableAfterHours && tracks.length && isAfterHours(new Date(),settings.openTime,settings.closeTime)){for(const t of tracks){if(!t.anomalyFlags.includes('afterHours'))t.anomalyFlags.push('afterHours')}activeStates.add('afterHours');trigger('afterHours','Presenza fuori orario',`${tracks.length} persona/e rilevata/e in orario di chiusura`,'danger',15000)}

  if(settings.enableObject){
    for(const o of objTracks){ const still=(now-o.stationarySince)/1000; const near=nearestPersonDistance(o,tracks,diag); if(still>=settings.objectSeconds&&near>0.18){activeStates.add('object');trigger('object:'+o.id,'Possibile oggetto incustodito',`${o.class} O${o.id} senza persona vicina`,'warning',15000)} }
  }

  if(settings.enableDark && epoch-lastFrameTs>1800){ lastFrameTs=epoch; checkDarkFrame(); }
  updateAnomalyStates(); updateAlertPanel();
}

function checkDarkFrame(){
  const sample=document.createElement('canvas'); sample.width=64;sample.height=36; const x=sample.getContext('2d',{willReadFrequently:true}); x.drawImage(els.video,0,0,64,36); const d=x.getImageData(0,0,64,36).data; let sum=0; for(let i=0;i<d.length;i+=4)sum+=(d[i]+d[i+1]+d[i+2])/3; const avg=sum/(d.length/4); if(avg<24){activeStates.add('dark');trigger('dark','Camera troppo scura','Inquadratura molto scura o possibile ostruzione','warning',12000)}
}

function trigger(key,title,text,severity='warning',cooldown=10000){
  const now=Date.now(), last=anomalyCooldown.get(key)||0; if(now-last<cooldown)return; anomalyCooldown.set(key,now); record(title,text,severity); if(settings.soundAlerts) alertSignal(severity); }
function alertSignal(sev){ try{ if(navigator.vibrate)navigator.vibrate(sev==='danger'?[140,90,140]:[100]); if(audioCtx){ const o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.frequency.value=sev==='danger'?880:660;g.gain.value=.045;o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+.11);} }catch{} }
function ensureAudio(){ try{ if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended')audioCtx.resume(); }catch{} }

function drawGuides(tracks=[],objTracks=[]){
  const c=els.overlay,ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height); if(!c.width)return;
  const y=c.height*settings.lineY; ctx.save(); ctx.strokeStyle='#27b0ff';ctx.lineWidth=Math.max(2,c.width/500);ctx.setLineDash([12,8]);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(c.width,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='rgba(8,18,32,.78)';ctx.fillRect(8,y-28,150,22);ctx.fillStyle='#8edcff';ctx.font=`700 ${Math.max(13,c.width/70)}px system-ui`;ctx.fillText('LINEA IN/OUT',16,y-12);
  const zone=tempZone||settings.restrictedZone; if(zone){const zx=zone.x*c.width,zy=zone.y*c.height,zw=zone.w*c.width,zh=zone.h*c.height;ctx.fillStyle='rgba(255,93,104,.13)';ctx.fillRect(zx,zy,zw,zh);ctx.strokeStyle='#ff5d68';ctx.lineWidth=3;ctx.setLineDash([9,6]);ctx.strokeRect(zx,zy,zw,zh);ctx.setLineDash([]);ctx.fillStyle='#ff9ca3';ctx.fillText('ZONA RISERVATA',zx+8,zy+20);}
  for(const t of tracks){
    const [x,bY,w,h]=t.bbox; const poseFall=t.poseFallSince!=null && (performance.now()-t.poseFallSince)/1000>=settings.fallSeconds; const selected=t.id===selectedTrackId;
    ctx.strokeStyle=selected?'#ffd166':poseFall?'#ff5d68':'#33d17a';ctx.lineWidth=selected?Math.max(4,c.width/300):Math.max(2,c.width/500);ctx.strokeRect(x,bY,w,h);ctx.fillStyle=selected?'rgba(87,62,10,.88)':'rgba(4,14,24,.78)';const labelW=Math.min(selected?210:150,Math.max(w,110));ctx.fillRect(x,Math.max(0,bY-24),labelW,22);ctx.fillStyle='#fff';ctx.fillText(`P${t.id} ${Math.round(t.score*100)}%${selected?' · SELEZIONATA':''}`,x+5,Math.max(15,bY-8));
    if(t.pose) drawPose(ctx,t.pose,{strokeStyle:poseFall?'#ff7b85':'#5ed0ff',pointStyle:'#ffffff',lineWidth:Math.max(2,c.width/600)});
  }
  for(const o of objTracks){const [x,bY,w,h]=o.bbox;ctx.strokeStyle='#ffb02e';ctx.lineWidth=2;ctx.strokeRect(x,bY,w,h);ctx.fillStyle='#ffcf76';ctx.fillText(`O${o.id} ${o.class}`,x+4,Math.max(15,bY-6));}
  if(drawZoneMode){ctx.fillStyle='rgba(255,176,46,.92)';ctx.fillRect(10,c.height-36,290,26);ctx.fillStyle='#07101d';ctx.fillText('TRASCINA PER DISEGNARE LA ZONA',16,c.height-18)} ctx.restore();
}


function closePersonInspector(){
  selectedTrackId=null;
  els.personInspector?.classList.add('hidden');
}

function sourcePointFromPointer(e){
  const {r,scale,ox,oy}=getObjectFitTransform();
  return {x:(e.clientX-r.left-ox)/scale,y:(e.clientY-r.top-oy)/scale};
}

function selectTrackAtPointer(e){
  if(drawZoneMode||!running||!currentTracks.length)return;
  const p=sourcePointFromPointer(e);
  const candidates=currentTracks.filter(t=>{
    const [x,y,w,h]=t.bbox; const pad=Math.max(8,Math.min(w,h)*.08);
    return p.x>=x-pad&&p.x<=x+w+pad&&p.y>=y-pad&&p.y<=y+h+pad;
  }).sort((a,b)=>(a.bbox[2]*a.bbox[3])-(b.bbox[2]*b.bbox[3]));
  if(!candidates.length){closePersonInspector();drawGuides(currentTracks);return;}
  selectedTrackId=candidates[0].id;
  renderPersonInspector(performance.now(),true);
  drawGuides(currentTracks);
  if(navigator.vibrate)navigator.vibrate(25);
}

function trackRisk(t){
  const flags=t.anomalyFlags||[];
  const globalCritical=activeStates.has('crowd');
  const critical=t.fallEscalated||flags.includes('fall')||flags.includes('zone')||flags.includes('afterHours')||globalCritical;
  if(critical)return{level:'critical',label:'CRITICO',detail:t.fallEscalated?'Persona a terra da verificare subito':flags.length?flags.map(flagLabel).join(' · '):'Sovraffollamento attivo'};
  if(flags.length||activeStates.has('cluster'))return{level:'warning',label:'ATTENZIONE',detail:flags.length?flags.map(flagLabel).join(' · '):'Assembramento locale attivo'};
  return{level:'normal',label:'NORMALE',detail:'Nessuna anomalia associata'};
}

function flagLabel(k){return{stationary:'Permanenza insolita',fall:'Possibile caduta',speed:'Movimento rapido',zone:'Zona riservata',afterHours:'Fuori orario'}[k]||k}

function renderPersonInspector(now=performance.now(),forceOpen=false){
  if(selectedTrackId==null){els.personInspector?.classList.add('hidden');return;}
  const t=personTracker.tracks.get(selectedTrackId)||currentTracks.find(x=>x.id===selectedTrackId);
  if(!t){closePersonInspector();return;}
  if(forceOpen||document.body.classList.contains('camera-immersive'))els.personInspector.classList.remove('hidden');
  const age=Math.max(t.ageMs||0,now-t.firstSeen);
  const stale=Math.max(0,now-t.lastSeen);
  const speedPct=Math.max(0,Math.round((t.speed||0)*100));
  const speedLabel=speedPct<2?'Quasi ferma':speedPct>=Math.round(settings.speedThreshold*100)?`${speedPct}%/s · rapida`:`${speedPct}%/s`;
  let pose='Pose non agganciata';
  if(t.pose){const conf=Math.round((t.poseFallEvidence?.confidence||0)*100);pose=t.poseLying?`Possibile a terra ${conf}%`:'Normale';}
  else if(t.poseFallEvidence) pose=t.poseLying?'Possibile a terra · fallback':'Normale · fallback';
  const crossing=t.lastCrossType?`${t.lastCrossType} · ${new Date(t.lastCrossEpoch).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`:'Nessun passaggio';
  const inZone=!!(settings.restrictedZone&&pointInZone(t.cx,t.cy,settings.restrictedZone,els.overlay.width,els.overlay.height));
  const sideLabel=t.lineSide==null?'Linea da determinare':t.lineSide==='above'?'Sopra linea':'Sotto linea';
  const position=`${sideLabel}${settings.restrictedZone?' · '+(inZone?'in zona':'fuori zona'):''}`;
  const risk=trackRisk(t);
  els.personInspectorId.textContent=`P${t.id}`;
  els.personDwell.textContent=formatDuration(age);
  els.personSpeed.textContent=speedLabel;
  els.personPose.textContent=pose;
  els.personConfidence.textContent=Math.round((t.score||0)*100)+'%';
  els.personCrossing.textContent=crossing;
  els.personPosition.textContent=position;
  els.personRisk.className='person-risk '+risk.level;
  els.personRiskLabel.textContent=risk.label;els.personRiskDetail.textContent=risk.detail;
  const flags=t.anomalyFlags||[];
  els.personFlags.innerHTML=flags.length?flags.map(k=>`<span class="${k==='fall'||k==='zone'||k==='afterHours'?'danger':'warning'}">${escapeHtml(flagLabel(k))}</span>`).join(''):'<span>Nessuna anomalia</span>';
  els.personTrackStatus.textContent=stale>650?`Segnale temporaneamente perso da ${(stale/1000).toFixed(1)} s`:`Tracciamento attivo · aggiornato ora`;
}

function updateStats(){
  els.visibleCount.textContent=visible; els.occupancyCount.textContent=occupancy; els.entriesCount.textContent=entries; els.exitsCount.textContent=exits; els.peakCount.textContent=peak; els.peakTime.textContent=peakAt?new Date(peakAt).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}):'—';
  const pct=Math.min(999,Math.round(occupancy/Math.max(settings.maxOccupancy,1)*100)); els.crowdPercent.textContent=pct+'%';els.crowdMeter.style.width=Math.min(100,pct)+'%';
  els.avgDwell.textContent=dwellSamples?formatDuration(dwellTotalMs/dwellSamples):'—'; els.poseStatus.textContent=poseReady?'ON':poseLoadFailed?'Fallback':'…';
  els.hudVisible.textContent=visible;els.hudOccupancy.textContent=occupancy;els.hudEntries.textContent=entries;els.hudExits.textContent=exits;
}
function formatDuration(ms){const s=Math.round(ms/1000);return s<60?s+' s':Math.floor(s/60)+'m '+(s%60)+'s'}
function updateFps(now){ if(now-fpsWindowStart>=1500){const fps=aiFrames/((now-fpsWindowStart)/1000);els.fpsBadge.textContent=fps.toFixed(1)+' FPS AI';aiFrames=0;fpsWindowStart=now;} }
function updateAnomalyStates(){
  const enabled={crowd:true,stationary:settings.enableStationary,fall:settings.enableFall,speed:settings.enableSpeed,zone:settings.enableZone,surge:settings.enableSurge,cluster:settings.enableCluster,afterHours:settings.enableAfterHours,object:settings.enableObject,dark:settings.enableDark}; let n=0;
  document.querySelectorAll('[data-state]').forEach(el=>{const k=el.dataset.state;el.className='';if(activeStates.has(k)){el.textContent='ALERT';el.classList.add('alert');n++;}else if(enabled[k]){el.textContent='ON';el.classList.add('on')}else el.textContent='OFF';}); els.anomalyCount.textContent=n;
}
function updateAlertPanel(){
  const danger=['crowd','fall','zone','afterHours'].find(x=>activeStates.has(x)); const warning=[...activeStates][0];
  els.alertPanel.className='alert-panel card '+(danger?'danger':warning?'warn':'ok'); els.alertIcon.textContent=danger?'!':warning?'⚠':'✓'; els.alertTitle.textContent=danger?'Anomalia critica rilevata':warning?'Anomalia da verificare':'Situazione regolare'; els.alertText.textContent=danger?labelFor(danger):warning?labelFor(warning):'Nessuna anomalia attiva.';
  if(danger||warning){els.fullAlert.classList.remove('hidden');els.fullAlertTitle.textContent=danger?'⚠ ANOMALIA CRITICA':'⚠ ANOMALIA';els.fullAlertText.textContent=labelFor(danger||warning);}else els.fullAlert.classList.add('hidden');
}
function labelFor(k){return {crowd:'Capienza massima raggiunta o superata.',stationary:'Una persona risulta quasi ferma da molto tempo.',fall:'Possibile persona a terra: verificare.',speed:'Rilevato movimento insolitamente rapido.',zone:'Rilevata presenza nella zona riservata.',surge:'Numero di persone aumentato rapidamente.',cluster:'Rilevato un gruppo di persone molto ravvicinate.',afterHours:'Presenza rilevata fuori dall’orario configurato.',object:'Possibile oggetto lasciato senza persona vicina.',dark:'Inquadratura troppo scura o ostruita.'}[k]||k}

function updateHeatmap(tracks){
  if(!els.overlay.width||!els.overlay.height)return;
  for(const t of tracks){const col=Math.max(0,Math.min(heatCols-1,Math.floor(t.cx/els.overlay.width*heatCols)));const row=Math.max(0,Math.min(heatRows-1,Math.floor(t.cy/els.overlay.height*heatRows)));heatGrid[row*heatCols+col]+=1;}
  drawHeatmap();
}
function drawHeatmap(){
  const c=els.heatmapCanvas,ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='#07111f';ctx.fillRect(0,0,c.width,c.height);
  const max=Math.max(1,...heatGrid),cw=c.width/heatCols,ch=c.height/heatRows;
  for(let r=0;r<heatRows;r++)for(let col=0;col<heatCols;col++){const v=heatGrid[r*heatCols+col];if(!v)continue;const a=Math.min(.9,.12+.78*v/max);const hue=210-170*(v/max);ctx.fillStyle=`hsla(${hue},90%,55%,${a})`;ctx.fillRect(col*cw,r*ch,cw+1,ch+1);}
  ctx.strokeStyle='rgba(255,255,255,.08)';ctx.lineWidth=1;for(let i=1;i<heatCols;i++){ctx.beginPath();ctx.moveTo(i*cw,0);ctx.lineTo(i*cw,c.height);ctx.stroke()}for(let i=1;i<heatRows;i++){ctx.beginPath();ctx.moveTo(0,i*ch);ctx.lineTo(c.width,i*ch);ctx.stroke()}
  ctx.fillStyle='rgba(255,255,255,.7)';ctx.font='700 15px system-ui';ctx.fillText('BASSA',12,c.height-14);ctx.textAlign='right';ctx.fillText('ALTA',c.width-12,c.height-14);ctx.textAlign='left';
}

async function record(type,message,severity='info'){
  const event={ts:Date.now(),type,message,severity,visible,occupancy,entries,exits}; try{await addEvent(event)}catch{} renderEvents(); }
async function renderEvents(){
  let events=[];try{events=await getEvents(200)}catch{} if(!events.length){els.eventLog.innerHTML='<div class="empty-log">Nessun evento registrato.</div>';return}
  els.eventLog.innerHTML=events.map(e=>`<div class="event-row"><time>${new Date(e.ts).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><span class="type">${escapeHtml(e.type)}</span><span>${escapeHtml(e.message)}</span><span class="sev ${e.severity}">${e.severity.toUpperCase()}</span></div>`).join('');
}
function escapeHtml(s){return String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}
function toast(msg){els.toast.textContent=msg;els.toast.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove('show'),2600)}

async function exportCsv(){
  const ev=await getEvents(10000);const rows=[['data','ora','tipo','gravita','messaggio','visibili','presenti_stimati','entrati','usciti'],...ev.slice().reverse().map(e=>{const d=new Date(e.ts);return[d.toLocaleDateString('it-IT'),d.toLocaleTimeString('it-IT'),e.type,e.severity,e.message,e.visible,e.occupancy,e.entries,e.exits]})];
  const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';')).join('\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='peoplelens-v2.1-eventi-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function getObjectFitTransform(){
  const r=els.overlay.getBoundingClientRect(),sw=els.overlay.width||1,sh=els.overlay.height||1;
  const cover=document.body.classList.contains('camera-immersive'); const scale=cover?Math.max(r.width/sw,r.height/sh):Math.min(r.width/sw,r.height/sh);
  const dw=sw*scale,dh=sh*scale,ox=(r.width-dw)/2,oy=(r.height-dh)/2;return{r,sw,sh,scale,ox,oy};
}
function beginZoneDraw(e){ if(!drawZoneMode||!running)return; const p=canvasPoint(e);zoneStart=p;tempZone={x:p.x,y:p.y,w:0,h:0};els.overlay.setPointerCapture?.(e.pointerId); }
function moveZoneDraw(e){ if(!zoneStart||!drawZoneMode)return;const p=canvasPoint(e);tempZone=normalizeZone(zoneStart,p);drawGuides(currentTracks); }
function endZoneDraw(e){ if(!zoneStart||!drawZoneMode)return;const p=canvasPoint(e);const z=normalizeZone(zoneStart,p);zoneStart=null;tempZone=null; if(z.w<.04||z.h<.04){toast('Zona troppo piccola. Riprova.');return}settings.restrictedZone=z;settings.enableZone=true;$('#enableZone').checked=true;saveSettings();drawZoneMode=false;els.zoneBtn.textContent='▧ Disegna zona';updateZoneHelp();toast('Zona riservata salvata.'); }
function canvasPoint(e){const {r,sw,sh,scale,ox,oy}=getObjectFitTransform();const sx=(e.clientX-r.left-ox)/scale,sy=(e.clientY-r.top-oy)/scale;return{x:Math.min(1,Math.max(0,sx/sw)),y:Math.min(1,Math.max(0,sy/sh))}}
function normalizeZone(a,b){return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)}}

els.startBtn.addEventListener('click',startCamera);els.stopBtn.addEventListener('click',stopCamera);els.switchBtn.addEventListener('click',switchCamera);els.exitViewBtn.addEventListener('click',exitImmersive);
els.zoneBtn.addEventListener('click',()=>{if(!running)return;drawZoneMode=!drawZoneMode;els.zoneBtn.textContent=drawZoneMode?'✕ Annulla zona':'▧ Disegna zona';if(!drawZoneMode){zoneStart=null;tempZone=null}});
els.overlay.addEventListener('pointerdown',beginZoneDraw);els.overlay.addEventListener('pointermove',moveZoneDraw);els.overlay.addEventListener('pointerup',e=>{if(drawZoneMode)endZoneDraw(e);else selectTrackAtPointer(e)});els.overlay.addEventListener('pointercancel',()=>{zoneStart=null;tempZone=null});
els.personInspectorClose?.addEventListener('click',()=>{closePersonInspector();drawGuides(currentTracks)});
for(const id of settingIds){$('#'+id)?.addEventListener('input',readSettings);$('#'+id)?.addEventListener('change',readSettings)}
$('#resetSettingsBtn').addEventListener('click',()=>{settings={...DEFAULT_SETTINGS};saveSettings();hydrateSettings();toast('Impostazioni ripristinate.');});
$('#resetHeatmapBtn').addEventListener('click',()=>{heatGrid.fill(0);drawHeatmap();toast('Heatmap azzerata.');});
$('#exportBtn').addEventListener('click',exportCsv);$('#clearBtn').addEventListener('click',async()=>{await clearEvents();renderEvents();toast('Registro azzerato.');});
window.addEventListener('resize',()=>{resizeCanvas();drawHeatmap()});window.addEventListener('beforeunload',stopTracks);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;els.installBtn.classList.remove('hidden')});els.installBtn.addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;els.installBtn.classList.add('hidden')});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));

hydrateSettings();renderEvents();drawHeatmap();loadModels();updateAnomalyStates();updateAlertPanel();
