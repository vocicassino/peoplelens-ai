import { PersonTracker, ObjectTracker } from './tracker.js';
import { DEFAULT_SETTINGS, pointInZone, isAfterHours, nearestPersonDistance, clusterSize } from './anomalies.js';
import { createPoseDetector, matchPosesToTracks, poseFallEvidence, drawPose } from './pose.js';
import { addEvent, getEvents, clearEvents } from './db.js';

const $ = s => document.querySelector(s);
const els = {
  video: $('#video'), overlay: $('#overlay'), cameraWrap: $('#cameraWrap'), emptyCamera: $('#emptyCamera'),
  startBtn: $('#startBtn'), stopBtn: $('#stopBtn'), switchBtn: $('#switchBtn'), zoneBtn: $('#zoneBtn'), gateBtn: $('#gateBtn'), priorityBtn: $('#priorityBtn'), aiModeBtn: $('#aiModeBtn'), installBtn: $('#installBtn'), exitViewBtn: $('#exitViewBtn'),
  modelBadge: $('#modelBadge'), liveBadge: $('#liveBadge'), fpsBadge: $('#fpsBadge'), poseBadge: $('#poseBadge'), scanBadge: $('#scanBadge'), cameraHud: $('#cameraHud'),
  cameraZoom: $('#cameraZoom'), zoomOutBtn: $('#zoomOutBtn'), zoomInBtn: $('#zoomInBtn'), zoomLabel: $('#zoomLabel'), priorityHint: $('#priorityHint'),
  visibleCount: $('#visibleCount'), occupancyCount: $('#occupancyCount'), entriesCount: $('#entriesCount'), exitsCount: $('#exitsCount'), peakCount: $('#peakCount'), peakTime: $('#peakTime'), crowdPercent: $('#crowdPercent'), crowdMeter: $('#crowdMeter'),
  avgDwell: $('#avgDwell'), poseStatus: $('#poseStatus'), hudVisible: $('#hudVisible'), hudOccupancy: $('#hudOccupancy'), hudEntries: $('#hudEntries'), hudExits: $('#hudExits'),
  alertPanel: $('#alertPanel'), alertIcon: $('#alertIcon'), alertTitle: $('#alertTitle'), alertText: $('#alertText'), anomalyCount: $('#anomalyCount'), eventLog: $('#eventLog'), toast: $('#toast'), zoneHelp: $('#zoneHelp'),
  fullAlert: $('#fullAlert'), fullAlertTitle: $('#fullAlertTitle'), fullAlertText: $('#fullAlertText'), heatmapCanvas: $('#heatmapCanvas'), gateCalibHint: $('#gateCalibHint'), gateCalibText: $('#gateCalibText'),
  gateQuickMap: $('#gateQuickMap'), gateQuickList: $('#gateQuickList'), gateQuickActive: $('#gateQuickActive'),
  gateSelector: $('#gateSelector'), gateName: $('#gateName'), gateEnabled: $('#gateEnabled'), gateSummary: $('#gateSummary'), gateCountLabel: $('#gateCountLabel'), calibrateGateBtn: $('#calibrateGateBtn'), addGateBtn: $('#addGateBtn'), deleteGateBtn: $('#deleteGateBtn'),
  personInspector: $('#personInspector'), personInspectorId: $('#personInspectorId'), personInspectorClose: $('#personInspectorClose'), personRisk: $('#personRisk'), personRiskLabel: $('#personRiskLabel'), personRiskDetail: $('#personRiskDetail'),
  personDwell: $('#personDwell'), personSpeed: $('#personSpeed'), personPose: $('#personPose'), personConfidence: $('#personConfidence'), personCrossing: $('#personCrossing'), personPosition: $('#personPosition'), personFlags: $('#personFlags'), personTrackStatus: $('#personTrackStatus'),
  followBtn: $('#followBtn'), personPath: $('#personPath'), personFollowState: $('#personFollowState'), priorityHelp: $('#priorityHelp'), priorityHelpText: $('#priorityHelpText'), clearPriorityBtn: $('#clearPriorityBtn')
};

let model=null, poseDetector=null, poseReady=false, poseLoadFailed=false, latestPoses=[];
let stream=null, running=false, inferenceBusy=false, lastInference=0, lastPoseInference=0, currentFacing='environment';
let entries=0, exits=0, peak=0, peakAt=null, occupancy=0, visible=0;
let personTracker=new PersonTracker(), objectTracker=new ObjectTracker();
let settings=loadSettings(); let recentCounts=[]; let lastFrameTs=0; let aiFrames=0; let fpsWindowStart=performance.now();
let anomalyCooldown=new Map(); let activeStates=new Set(); let drawZoneMode=false, zoneStart=null, tempZone=null; let installPrompt=null; let audioCtx=null;
let clusterSince=null, dwellTotalMs=0, dwellSamples=0, currentTracks=[];
let selectedTrackId=null, followTrackId=null;
let draggingLine=false, linePointerId=null, lineDragMode=null, lineDragStart=null, lineDragOriginal=null, lineDragGateId=null;
let calibrateMode=false, calibrationPoints=[], calibrationPointerId=null;
let priorityDrawMode=false, priorityStart=null, tempPriorityZone=null, priorityPointerId=null;
let gateSessionStats=new Map();
let cropCanvas=document.createElement('canvas'), tileCursor=0, lastScanSources=['FULL'];
let cameraZoomCaps=null, cameraZoomValue=1;
const bagClasses=new Set(['backpack','handbag','suitcase']);
const heatCols=16, heatRows=9; let heatGrid=new Array(heatCols*heatRows).fill(0);

const settingIds=['detectionMode','confidence','maxOccupancy','baseOccupancy','trailSeconds','stationarySeconds','fallSeconds','fallEscalationSeconds','speedThreshold','surgeCount','surgeWindow','clusterCount','clusterSeconds','clusterRadius','objectSeconds','zoneDwellSeconds','loopWindowSeconds','loopPathThreshold','openTime','closeTime','enableStationary','enableFall','enableSpeed','enableZone','enableSurge','enableCluster','enableAfterHours','enableObject','enableDark','enableLoop','enableZoneDwell','enableWrongWay','soundAlerts'];

function makeGate(index=0,base=null){
  const y=Math.min(.88,.28+(index%5)*.13);
  return normalizeGate(base||{id:`gate-${Date.now()}-${index}`,name:`Varco ${index+1}`,enabled:true,a:{x:.12,y},b:{x:.88,y},entryDirection:'forward',allowedDirection:'forward'},index);
}
function normalizeGate(g,index=0){
  const fallbackA={x:.08,y:.62},fallbackB={x:.92,y:.62};
  return{
    id:String(g?.id||`gate-${Date.now()}-${index}`),
    name:String(g?.name||`Varco ${index+1}`).slice(0,28),
    enabled:g?.enabled!==false,
    a:normalizeLinePoint(g?.a||g?.lineA,fallbackA),
    b:normalizeLinePoint(g?.b||g?.lineB,fallbackB),
    entryDirection:g?.entryDirection==='reverse'?'reverse':'forward',
    allowedDirection:g?.allowedDirection==='reverse'?'reverse':'forward'
  };
}
function loadSettings(){
  try{
    const raw=JSON.parse(localStorage.getItem('peoplelensSettings')||'{}');
    const merged={...DEFAULT_SETTINGS,...raw};
    let gates=[];
    if(Array.isArray(raw.gates)&&raw.gates.length){gates=raw.gates.slice(0,6).map((g,i)=>normalizeGate(g,i));}
    else{
      const y=Number.isFinite(raw.lineY)?Math.min(.95,Math.max(.05,raw.lineY)):(raw.lineA?.y??DEFAULT_SETTINGS.lineA?.y??.62);
      gates=[normalizeGate({id:'gate-1',name:'Varco 1',enabled:true,a:raw.lineA||{x:.08,y},b:raw.lineB||{x:.92,y},entryDirection:raw.entryDirection==='up'?'reverse':raw.entryDirection||'forward',allowedDirection:raw.allowedDirection==='up'?'reverse':raw.allowedDirection||'forward'},0)];
    }
    if(!gates.length)gates=[makeGate(0,DEFAULT_SETTINGS.gates?.[0])];
    merged.gates=gates;
    merged.activeGateId=gates.some(g=>g.id===raw.activeGateId)?raw.activeGateId:gates[0].id;
    return merged;
  }catch{return {...DEFAULT_SETTINGS,gates:[makeGate(0,DEFAULT_SETTINGS.gates?.[0])],activeGateId:'gate-1'}}
}
function normalizeLinePoint(p,fallback){
  const x=Number(p?.x),y=Number(p?.y);
  return{x:Math.min(.97,Math.max(.03,Number.isFinite(x)?x:fallback.x)),y:Math.min(.97,Math.max(.03,Number.isFinite(y)?y:fallback.y))};
}
function activeGate(){return settings.gates.find(g=>g.id===settings.activeGateId)||settings.gates[0];}
function saveSettings(){ localStorage.setItem('peoplelensSettings',JSON.stringify(settings)); }
function hydrateSettings(){
  for(const id of settingIds){ const el=$('#'+id); if(!el) continue; const v=settings[id]; if(el.type==='checkbox')el.checked=!!v; else if(id==='confidence')el.value=Math.round(v*100); else if(id==='speedThreshold'||id==='clusterRadius'||id==='loopPathThreshold')el.value=Math.round(v*100); else el.value=v; }
  hydrateGateControls(); updateOutputs(); updateZoneHelp(); updatePriorityHelp();
}
function hydrateGateControls(){
  const g=activeGate(); if(!g)return;
  if(els.gateSelector){
    const current=els.gateSelector.value;
    els.gateSelector.innerHTML=settings.gates.map((x,i)=>`<option value="${escapeHtml(x.id)}">${i+1}. ${escapeHtml(x.name)}${x.enabled?'':' · OFF'}</option>`).join('');
    els.gateSelector.value=g.id||current;
  }
  if(els.gateName)els.gateName.value=g.name;
  if(els.gateEnabled)els.gateEnabled.checked=g.enabled;
  const entry=$('#entryDirection'),allowed=$('#allowedDirection');if(entry)entry.value=g.entryDirection;if(allowed)allowed.value=g.allowedDirection;
  if(els.gateCountLabel)els.gateCountLabel.textContent=settings.gates.length===1?'1 varco':`${settings.gates.length} varchi`;
  if(els.deleteGateBtn)els.deleteGateBtn.disabled=settings.gates.length<=1;
  renderGateSummary();
  renderGateQuickMap();
}
function readSettings(){
  for(const id of settingIds){ const el=$('#'+id); if(!el)continue; let v; if(el.type==='checkbox')v=el.checked; else if(el.type==='number'||el.type==='range')v=Number(el.value); else v=el.value; if(id==='confidence'||id==='speedThreshold'||id==='clusterRadius'||id==='loopPathThreshold')v/=100; settings[id]=v; }
  saveSettings(); updateOutputs(); updateStats();
}
function updateOutputs(){
  $('#confidenceOut').textContent=Math.round(settings.confidence*100)+'%';
  const g=activeGate();
  if(g){const dx=g.b.x-g.a.x,dy=g.b.y-g.a.y,w=els.overlay?.width||1,h=els.overlay?.height||1;const px=dx*w,py=dy*h;let angle=Math.round(Math.atan2(py,px)*180/Math.PI);if(angle<0)angle+=360;const lineOut=$('#lineInfoOut');if(lineOut)lineOut.textContent=`${angle}° · ${Math.round(Math.hypot(px,py)/Math.max(1,Math.hypot(w,h))*100)}%`;}
  $('#speedOut').textContent=Math.round(settings.speedThreshold*100)+'%';
  $('#clusterRadiusOut').textContent=Math.round(settings.clusterRadius*100)+'%';
  $('#loopPathOut').textContent=Math.round(settings.loopPathThreshold*100)+'%';
  renderGateSummary(); updateModeUi();
}
function renderGateSummary(){
  if(!els.gateSummary)return;
  els.gateSummary.innerHTML=settings.gates.map((g,i)=>{const st=gateSessionStats.get(g.id)||{entries:0,exits:0};return `<button type="button" data-gate-pick="${escapeHtml(g.id)}" class="${g.id===settings.activeGateId?'active':''} ${g.enabled?'':'disabled'}"><span>${i+1}</span><b>${escapeHtml(g.name)}</b><small>IN ${st.entries} · OUT ${st.exits}</small></button>`}).join('');
  els.gateSummary.querySelectorAll('[data-gate-pick]').forEach(btn=>btn.addEventListener('click',()=>setActiveGate(btn.dataset.gatePick,true)));
}
function renderGateQuickMap(){
  if(!els.gateQuickMap||!els.gateQuickList)return;
  const immersed=document.body.classList.contains('camera-immersive');
  const shouldShow=running&&immersed&&!calibrateMode&&!drawZoneMode&&!priorityDrawMode;
  els.gateQuickMap.classList.toggle('hidden',!shouldShow);
  const active=activeGate(),activeIndex=Math.max(0,settings.gates.findIndex(g=>g.id===active?.id));
  if(els.gateQuickActive)els.gateQuickActive.textContent=`V${activeIndex+1}`;
  els.gateQuickList.innerHTML=settings.gates.map((g,i)=>{
    const st=gateSessionStats.get(g.id)||{entries:0,exits:0};
    const selected=g.id===settings.activeGateId;
    return `<div class="gate-quick-item ${selected?'active':''} ${g.enabled?'':'disabled'}" data-gate-id="${escapeHtml(g.id)}">
      <button type="button" class="gate-quick-pick" data-gate-quick-pick="${escapeHtml(g.id)}" aria-pressed="${selected}" title="Seleziona ${escapeHtml(g.name)}">
        <span class="gate-quick-code">V${i+1}</span><span class="gate-quick-name">${escapeHtml(g.name)}</span><small>IN ${st.entries} · OUT ${st.exits}</small>
      </button>
      <button type="button" class="gate-quick-toggle" data-gate-quick-toggle="${escapeHtml(g.id)}" aria-pressed="${g.enabled}" aria-label="${g.enabled?'Disattiva':'Attiva'} ${escapeHtml(g.name)}" title="${g.enabled?'Disattiva':'Attiva'} conteggio">${g.enabled?'⏻':'○'}</button>
    </div>`;
  }).join('');
  els.gateQuickList.querySelectorAll('[data-gate-quick-pick]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();setActiveGate(btn.dataset.gateQuickPick,true);}));
  els.gateQuickList.querySelectorAll('[data-gate-quick-toggle]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();toggleGateQuick(btn.dataset.gateQuickToggle);}));
}
function toggleGateQuick(id){
  const g=settings.gates.find(x=>x.id===id);if(!g)return;
  g.enabled=!g.enabled;saveSettings();hydrateGateControls();resetLineSides();drawGuides(currentTracks);
  toast(`${g.name}: conteggio ${g.enabled?'attivato':'disattivato'}.`);if(navigator.vibrate)navigator.vibrate(20);
}
function setActiveGate(id,announce=false){
  const g=settings.gates.find(x=>x.id===id);if(!g)return;
  settings.activeGateId=g.id;saveSettings();hydrateGateControls();updateOutputs();if(running)resetLineSides();drawGuides(currentTracks);if(announce)toast(`${g.name} selezionato.`);
}
function updateZoneHelp(){ els.zoneHelp.innerHTML=settings.restrictedZone?'Zona riservata impostata. Attiva <b>Zona riservata</b> per generare gli avvisi.':'Zona riservata non impostata. Tocca <b>Disegna zona</b> e trascina un rettangolo sul video.'; }

function modeMeta(mode=settings.detectionMode){return mode==='long'?{icon:'🔭',label:'Lunga distanza',short:'LONG'}:mode==='fast'?{icon:'⚡',label:'Veloce',short:'FULL'}:{icon:'⚖',label:'Bilanciata',short:'BAL'};}
function updateModeUi(){
  const m=modeMeta();
  if(els.aiModeBtn)els.aiModeBtn.textContent=`${m.icon} ${m.label}`;
  if(els.scanBadge&&running){els.scanBadge.classList.remove('hidden');els.scanBadge.textContent=`AI ${lastScanSources.join('+')}`;}
}
function updatePriorityHelp(){
  const on=!!settings.priorityZone;
  if(els.priorityHelpText)els.priorityHelpText.textContent=on?'Zona prioritaria impostata: viene analizzata ingrandita nelle modalità Bilanciata e Lunga distanza.':'Non impostata. In modalità Bilanciata/Lunga distanza puoi dedicare più analisi a una zona lontana.';
  if(els.clearPriorityBtn)els.clearPriorityBtn.disabled=!on;
}
function setDetectionMode(mode,announce=true){
  settings.detectionMode=['fast','balanced','long'].includes(mode)?mode:'balanced';saveSettings();
  const sel=$('#detectionMode');if(sel)sel.value=settings.detectionMode;lastScanSources=['FULL'];updateModeUi();
  if(announce)toast(`${modeMeta().icon} Modalità ${modeMeta().label}.`);
}
function cycleDetectionMode(){const list=['fast','balanced','long'],i=list.indexOf(settings.detectionMode);setDetectionMode(list[(i+1)%list.length]);}

async function loadModels(){
  els.modelBadge.textContent='Caricamento AI V2.6…'; els.modelBadge.className='pill warn';
  try{
    await tf.ready(); try{await tf.setBackend('webgl')}catch{}
    model=await cocoSsd.load({base:'lite_mobilenet_v2'});
    els.modelBadge.textContent='Oggetti pronti · '+tf.getBackend(); els.modelBadge.className='pill ok';
  } catch(err){ console.error(err); els.modelBadge.textContent='Errore AI'; els.modelBadge.className='pill danger'; toast('Impossibile caricare COCO-SSD. Controlla la connessione.'); return; }

  try{
    poseDetector=await createPoseDetector(); poseReady=true;
    els.modelBadge.textContent='AI V2.6 pronta · '+tf.getBackend(); els.poseStatus.textContent='ON';
  } catch(err){
    console.warn('MoveNet non disponibile, uso fallback:',err); poseLoadFailed=true; poseReady=false; els.poseStatus.textContent='Fallback';
    els.modelBadge.textContent='AI pronta · pose fallback';
  }
}

async function enterImmersive(){
  document.body.classList.add('camera-immersive');
  els.exitViewBtn.classList.remove('hidden'); els.cameraHud.classList.remove('hidden'); renderGateQuickMap(); updateModeUi();
  try{
    if(!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({navigationUI:'hide'});
  }catch(err){ console.debug('Fullscreen API non disponibile:',err?.message); }
}
async function exitImmersive(){
  document.body.classList.remove('camera-immersive'); els.exitViewBtn.classList.add('hidden'); els.cameraHud.classList.add('hidden'); els.gateQuickMap?.classList.add('hidden'); closePersonInspector();
  try{ if(document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen(); }catch{}
  resizeCanvas();
}

async function startCamera(){
  if(!model){toast('Il modello AI non è ancora pronto.');return}
  await enterImmersive();
  try{
    stopTracks();
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:currentFacing},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:24,max:30}}});
    els.video.srcObject=stream; await els.video.play(); running=true; resetSession();
    els.startBtn.disabled=true; els.stopBtn.disabled=false; els.switchBtn.disabled=false; els.zoneBtn.disabled=false; if(els.gateBtn)els.gateBtn.disabled=false; if(els.priorityBtn)els.priorityBtn.disabled=false; if(els.aiModeBtn)els.aiModeBtn.disabled=false; els.emptyCamera.classList.add('hidden'); els.liveBadge.classList.remove('hidden'); els.fpsBadge.classList.remove('hidden');
    if(poseReady) els.poseBadge.classList.remove('hidden'); else els.poseBadge.classList.add('hidden');
    ensureAudio(); resizeCanvas(); ensureEditableLineVisible(true); await configureCameraZoom(); renderGateQuickMap(); updateModeUi(); requestAnimationFrame(loop);
  }catch(err){ console.error(err); await exitImmersive(); toast(err.name==='NotAllowedError'?'Permesso fotocamera negato.':'Fotocamera non disponibile.'); }
}
function stopTracks(){ if(stream){stream.getTracks().forEach(t=>t.stop());stream=null} }
async function stopCamera(){ cancelGateCalibration(); cancelPriorityDraw(); selectedTrackId=null; followTrackId=null; closePersonInspector(); running=false; stopTracks(); els.video.srcObject=null; els.startBtn.disabled=false; els.stopBtn.disabled=true; els.switchBtn.disabled=true; els.zoneBtn.disabled=true; if(els.gateBtn)els.gateBtn.disabled=true; if(els.priorityBtn)els.priorityBtn.disabled=true; if(els.aiModeBtn)els.aiModeBtn.disabled=true; els.emptyCamera.classList.remove('hidden'); els.liveBadge.classList.add('hidden'); els.fpsBadge.classList.add('hidden'); els.poseBadge.classList.add('hidden'); els.scanBadge?.classList.add('hidden'); els.cameraZoom?.classList.add('hidden'); els.fullAlert.classList.add('hidden'); els.gateQuickMap?.classList.add('hidden'); clearOverlay(); await exitImmersive(); }
async function switchCamera(){ currentFacing=currentFacing==='environment'?'user':'environment'; if(!running)return; try{stopTracks(); stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:currentFacing},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:24,max:30}}});els.video.srcObject=stream;await els.video.play();personTracker.reset();objectTracker.reset();latestPoses=[];selectedTrackId=null;followTrackId=null;closePersonInspector();resizeCanvas();ensureEditableLineVisible(true);await configureCameraZoom();resetLineSides();toast(currentFacing==='environment'?'Fotocamera posteriore':'Fotocamera anteriore');}catch(err){toast('Impossibile cambiare fotocamera.');console.error(err)} }
function resetSession(){ selectedTrackId=null; followTrackId=null; closePersonInspector(); gateSessionStats=new Map(settings.gates.map(g=>[g.id,{entries:0,exits:0}])); entries=0; exits=0; peak=0; peakAt=null; occupancy=settings.baseOccupancy; visible=0; recentCounts=[]; personTracker.reset();objectTracker.reset();anomalyCooldown.clear();activeStates.clear();clusterSince=null;dwellTotalMs=0;dwellSamples=0;currentTracks=[];latestPoses=[];heatGrid.fill(0);drawHeatmap();updateStats();renderGateQuickMap(); }

function resizeCanvas(){ const v=els.video,c=els.overlay; if(!v.videoWidth)return; if(c.width!==v.videoWidth||c.height!==v.videoHeight){c.width=v.videoWidth;c.height=v.videoHeight;} }
function clearOverlay(){ const c=els.overlay; c.getContext('2d').clearRect(0,0,c.width,c.height); }

async function loop(ts){
  if(!running)return; resizeCanvas(); drawGuides(currentTracks);
  const targetInterval=settings.detectionMode==='long'?360:settings.detectionMode==='balanced'?280:230;
  if(!inferenceBusy && ts-lastInference>=targetInterval && els.video.readyState>=2){
    inferenceBusy=true; lastInference=ts;
    try{ await inferFrame(); }catch(err){console.error(err)} finally{ inferenceBusy=false; }
  }
  requestAnimationFrame(loop);
}

async function inferFrame(){
  const now=performance.now(); const preds=await detectScene(); aiFrames++;
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

function cropRegions(){
  const o=.08, w=.58, h=.58;
  return [
    {x:0,y:0,w,h,label:'T1'}, {x:1-w,y:0,w,h,label:'T2'},
    {x:0,y:1-h,w,h,label:'T3'}, {x:1-w,y:1-h,w,h,label:'T4'},
  ];
}
function iou(a,b){
  const [ax,ay,aw,ah]=a,[bx,by,bw,bh]=b,ix=Math.max(ax,bx),iy=Math.max(ay,by),ir=Math.min(ax+aw,bx+bw),ib=Math.min(ay+ah,by+bh);
  const inter=Math.max(0,ir-ix)*Math.max(0,ib-iy);return inter/Math.max(1,aw*ah+bw*bh-inter);
}
function mergePredictions(preds){
  const sorted=preds.slice().sort((a,b)=>b.score-a.score),keep=[];
  for(const p of sorted){if(keep.some(k=>k.class===p.class&&iou(k.bbox,p.bbox)>.43))continue;keep.push(p);if(keep.length>=55)break;}
  return keep;
}
async function detectCrop(region,source,threshold){
  const v=els.video,sw=v.videoWidth,sh=v.videoHeight;if(!sw||!sh)return[];
  const sx=Math.round(region.x*sw),sy=Math.round(region.y*sh),rw=Math.max(2,Math.round(region.w*sw)),rh=Math.max(2,Math.round(region.h*sh));
  const maxSide=settings.detectionMode==='long'?704:576,ratio=rw/rh;
  let dw,dh;if(ratio>=1){dw=maxSide;dh=Math.max(224,Math.round(maxSide/ratio));}else{dh=maxSide;dw=Math.max(224,Math.round(maxSide*ratio));}
  cropCanvas.width=dw;cropCanvas.height=dh;const ctx=cropCanvas.getContext('2d',{alpha:false});ctx.drawImage(v,sx,sy,rw,rh,0,0,dw,dh);
  const out=await model.detect(cropCanvas,35,threshold);
  return out.map(d=>({...d,source,bbox:[sx+d.bbox[0]/dw*rw,sy+d.bbox[1]/dh*rh,d.bbox[2]/dw*rw,d.bbox[3]/dh*rh]}));
}
async function detectScene(){
  const full=(await model.detect(els.video,40,settings.confidence)).map(d=>({...d,source:'full'}));
  if(settings.detectionMode==='fast'){lastScanSources=['FULL'];updateModeUi();return full;}
  const all=[...full],sources=['FULL'];
  if(settings.priorityZone){
    const th=Math.max(.26,settings.confidence-(settings.detectionMode==='long'?.20:.14));
    all.push(...await detectCrop(settings.priorityZone,'priority',th));sources.push('PRIORITY');
  }
  const tiles=cropRegions(),tileRuns=settings.detectionMode==='long'?(settings.priorityZone?1:2):(!settings.priorityZone?1:0);
  for(let i=0;i<tileRuns;i++){
    const tile=tiles[tileCursor%tiles.length];tileCursor=(tileCursor+1)%tiles.length;
    all.push(...await detectCrop(tile,'tile',Math.max(.30,settings.confidence-.16)));sources.push(tile.label);
  }
  lastScanSources=sources;updateModeUi();return mergePredictions(all);
}

function linePointsPx(gate=activeGate()){
  const c=els.overlay; if(!gate)return{a:{x:0,y:0},b:{x:0,y:0}};
  return{a:{x:gate.a.x*c.width,y:gate.a.y*c.height},b:{x:gate.b.x*c.width,y:gate.b.y*c.height}};
}
function lineSideInfo(x,y,gate=activeGate()){
  const {a,b}=linePointsPx(gate),dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
  const signed=((x-a.x)*(-dy)+(y-a.y)*dx)/len;
  const projection=((x-a.x)*dx+(y-a.y)*dy)/(len*len);
  const deadband=Math.max(3,Math.hypot(els.overlay.width,els.overlay.height)*.006);
  return{side:Math.abs(signed)<=deadband?0:(signed>0?1:-1),signed,projection};
}
function movementCrossesGate(t,gate){
  const {a,b}=linePointsPx(gate);
  const p={x:t.prevCx,y:t.prevCy},r={x:t.cx-t.prevCx,y:t.cy-t.prevCy};
  const q=a,s={x:b.x-a.x,y:b.y-a.y};
  const cross=(u,v)=>u.x*v.y-u.y*v.x;
  const den=cross(r,s); if(Math.abs(den)<1e-7)return false;
  const qp={x:q.x-p.x,y:q.y-p.y};
  const u=cross(qp,r)/den,tt=cross(qp,s)/den;
  return tt>=0&&tt<=1&&u>=-.035&&u<=1.035;
}
function gateTrackState(t,gate){
  if(!t.gateStates)t.gateStates={};
  if(!t.gateStates[gate.id])t.gateStates[gate.id]={side:null,lastCrossAt:0};
  return t.gateStates[gate.id];
}
function resetLineSides(){
  const now=performance.now();
  for(const t of currentTracks){
    if(!t.gateStates)t.gateStates={};
    for(const gate of settings.gates){const info=lineSideInfo(t.cx,t.cy,gate);t.gateStates[gate.id]={side:info.side||1,lastCrossAt:now};}
  }
}
function processCrossings(tracks,now){
  for(const t of tracks){
    for(const gate of settings.gates){
      if(!gate.enabled)continue;
      const state=gateTrackState(t,gate),info=lineSideInfo(t.cx,t.cy,gate),side=info.side;
      if(side===0)continue;
      if(state.side==null){state.side=side;continue}
      if(draggingLine||calibrateMode){state.side=side;continue}
      const crossed=side!==state.side&&movementCrossesGate(t,gate);
      if(crossed && t.ageMs>450 && now-state.lastCrossAt>1800){
        const direction=state.side<side?'forward':'reverse';
        const isEntry=direction===gate.entryDirection;
        const gst=gateSessionStats.get(gate.id)||{entries:0,exits:0};
        if(isEntry){entries++;gst.entries++;t.lastCrossType='Ingresso';record('Ingresso',`P${t.id} · ${gate.name}`,'info',{gateId:gate.id,gateName:gate.name});}
        else {exits++;gst.exits++;t.lastCrossType='Uscita';record('Uscita',`P${t.id} · ${gate.name}`,'info',{gateId:gate.id,gateName:gate.name});}
        gateSessionStats.set(gate.id,gst);
        if(settings.enableWrongWay && direction!==gate.allowedDirection){
          t.wrongWayUntil=now+6500;
          trigger('wrongWay:'+gate.id+':'+t.id,'Direzione vietata',`P${t.id} ha attraversato ${gate.name} nel verso non consentito`,'danger',9000);
        }
        t.lastDirection=direction;t.lastCrossAt=now;t.lastCrossEpoch=Date.now();t.lastGateId=gate.id;t.lastGateName=gate.name;t.crossingCount=(t.crossingCount||0)+1;state.lastCrossAt=now;
        renderGateSummary();renderGateQuickMap();
      }
      state.side=side;
    }
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


function trackPathMetrics(t,now,windowSeconds=settings.trailSeconds){
  const diag=Math.hypot(els.overlay.width,els.overlay.height)||1;
  const pts=(t.trail||[]).filter(p=>now-p.ts<=windowSeconds*1000);
  let length=0;for(let i=1;i<pts.length;i++)length+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);
  const net=pts.length>1?Math.hypot(pts.at(-1).x-pts[0].x,pts.at(-1).y-pts[0].y):0;
  const duration=pts.length>1?(pts.at(-1).ts-pts[0].ts)/1000:0;
  return{pts,lengthRatio:length/diag,netRatio:net/diag,duration};
}

function updateAdvancedTrackSignals(t,now,fw,fh){
  const inZone=!!(settings.restrictedZone&&pointInZone(t.cx,t.cy,settings.restrictedZone,fw,fh));
  if(inZone){if(t.zoneDwellSince==null)t.zoneDwellSince=now;}else t.zoneDwellSince=null;
  if(settings.enableZoneDwell&&inZone&&t.zoneDwellSince!=null&&(now-t.zoneDwellSince)/1000>=settings.zoneDwellSeconds){
    if(!t.anomalyFlags.includes('zoneDwell'))t.anomalyFlags.push('zoneDwell');activeStates.add('zoneDwell');
    trigger('zoneDwell:'+t.id,'Sosta prolungata in zona',`P${t.id} nella zona da ${Math.round((now-t.zoneDwellSince)/1000)} s`,'warning',15000);
  }
  if(settings.enableLoop){
    const m=trackPathMetrics(t,now,settings.loopWindowSeconds);
    const loopCandidate=m.duration>=Math.max(6,settings.loopWindowSeconds*.65)&&m.lengthRatio>=settings.loopPathThreshold&&m.netRatio<=Math.max(.12,m.lengthRatio*.22);
    if(loopCandidate){if(t.loopSince==null)t.loopSince=now;}else t.loopSince=null;
    if(t.loopSince!=null&&now-t.loopSince>=2200){if(!t.anomalyFlags.includes('loop'))t.anomalyFlags.push('loop');activeStates.add('loop');trigger('loop:'+t.id,'Movimento ripetitivo',`P${t.id}: percorso ripetitivo nella stessa area`,'warning',18000);}
  }else t.loopSince=null;
  if(settings.enableWrongWay&&t.wrongWayUntil>now){if(!t.anomalyFlags.includes('wrongWay'))t.anomalyFlags.push('wrongWay');activeStates.add('wrongWay');}
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
    updateAdvancedTrackSignals(t,now,fw,fh);
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

function roundRectPath(ctx,x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function drawTrackTrail(ctx,t,now){
  const pts=(t.trail||[]).filter(p=>now-p.ts<=settings.trailSeconds*1000);if(pts.length<2)return;
  ctx.save();ctx.strokeStyle='#ffd166';ctx.lineWidth=Math.max(3,els.overlay.width/420);ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();
  const last=pts.at(-1);ctx.fillStyle='#ffd166';ctx.beginPath();ctx.arc(last.x,last.y,Math.max(5,els.overlay.width/150),0,Math.PI*2);ctx.fill();ctx.restore();
}

function lineHandleGeometry(gate=activeGate()){
  const c=els.overlay,{scale}=getObjectFitTransform(),inv=1/Math.max(scale,.001),{a,b}=linePointsPx(gate);
  const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},len=Math.hypot(b.x-a.x,b.y-a.y)||1;
  const radius=Math.max(16*inv,Math.min(c.width,c.height)*.018);
  const pillW=88*inv,pillH=32*inv;
  return{a,b,mid,len,radius,pillW,pillH,inv};
}
function drawArrow(ctx,from,to,inv,label){
  const dx=to.x-from.x,dy=to.y-from.y,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len;
  const head=10*inv;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.beginPath();ctx.moveTo(to.x,to.y);ctx.lineTo(to.x-head*(ux+uy*.65),to.y-head*(uy-ux*.65));ctx.lineTo(to.x-head*(ux-uy*.65),to.y-head*(uy+ux*.65));ctx.closePath();ctx.fill();
  if(label){ctx.font=`900 ${12*inv}px system-ui`;ctx.textAlign='center';ctx.fillText(label,to.x+ux*12*inv,to.y+uy*12*inv);ctx.textAlign='left';}
}
function drawSingleGate(ctx,gate,isActive){
  const c=els.overlay,g=lineHandleGeometry(gate),{a,b,mid,inv}=g,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
  const editing=isActive&&draggingLine&&lineDragGateId===gate.id;
  ctx.save();ctx.globalAlpha=gate.enabled?1:.45;ctx.strokeStyle=editing?'#ffd166':isActive?'#27b0ff':'rgba(108,213,255,.72)';ctx.lineWidth=editing?Math.max(4*inv,c.width/350):isActive?Math.max(3*inv,c.width/460):Math.max(2*inv,c.width/650);ctx.setLineDash(gate.enabled?[12*inv,8*inv]:[5*inv,7*inv]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
  const nx=-dy/len,ny=dx/len,dir=gate.entryDirection==='forward'?1:-1,arrowLen=Math.max((isActive?42:30)*inv,Math.min(c.width,c.height)*(isActive?.055:.038));
  ctx.strokeStyle=isActive?'#5ed0ff':'rgba(176,232,255,.78)';ctx.fillStyle=isActive?'#bcecff':'rgba(213,244,255,.88)';ctx.lineWidth=Math.max(1.5*inv,c.width/700);drawArrow(ctx,{x:mid.x-nx*dir*arrowLen*.42,y:mid.y-ny*dir*arrowLen*.42},{x:mid.x+nx*dir*arrowLen*.52,y:mid.y+ny*dir*arrowLen*.52},inv,isActive?'IN':'');
  const label=`${gate.name}${gate.enabled?'':' · OFF'}`;ctx.font=`800 ${isActive?12:10}pt system-ui`;const tw=Math.min(220*inv,ctx.measureText(label).width+18*inv);ctx.fillStyle=isActive?'rgba(9,31,49,.94)':'rgba(7,18,31,.76)';ctx.strokeStyle=isActive?'#5ed0ff':'rgba(94,208,255,.32)';ctx.lineWidth=1.5*inv;roundRectPath(ctx,mid.x-tw/2,mid.y-46*inv,tw,25*inv,9*inv);ctx.fill();ctx.stroke();ctx.fillStyle='#d9f4ff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`800 ${11*inv}px system-ui`;ctx.fillText(label,mid.x,mid.y-33.5*inv);
  if(isActive&&!calibrateMode){
    for(const [lbl,p] of [['A',a],['B',b]]){ctx.beginPath();ctx.fillStyle=lineDragMode===lbl.toLowerCase()?'#ffd166':'rgba(9,31,49,.94)';ctx.strokeStyle=lineDragMode===lbl.toLowerCase()?'#ffe29a':'#5ed0ff';ctx.lineWidth=2*inv;ctx.arc(p.x,p.y,g.radius,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=lineDragMode===lbl.toLowerCase()?'#251b05':'#d9f4ff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`900 ${13*inv}px system-ui`;ctx.fillText(lbl,p.x,p.y);}
    const pw=g.pillW,ph=g.pillH;ctx.fillStyle=lineDragMode==='move'?'rgba(112,82,14,.95)':'rgba(9,31,49,.94)';ctx.strokeStyle=lineDragMode==='move'?'#ffd166':'#5ed0ff';ctx.lineWidth=2*inv;roundRectPath(ctx,mid.x-pw/2,mid.y-ph/2,pw,ph,ph/2);ctx.fill();ctx.stroke();ctx.fillStyle=lineDragMode==='move'?'#ffe29a':'#bcecff';ctx.textAlign='center';ctx.font=`800 ${11*inv}px system-ui`;ctx.fillText('✥ SPOSTA',mid.x,mid.y+1*inv);
    const sideOffset=Math.max(30*inv,Math.min(c.width,c.height)*.035);ctx.font=`800 ${11*inv}px system-ui`;ctx.fillStyle='rgba(190,228,249,.9)';ctx.fillText('LATO 1',mid.x-nx*sideOffset,mid.y-ny*sideOffset);ctx.fillText('LATO 2',mid.x+nx*sideOffset,mid.y+ny*sideOffset);
  }
  ctx.restore();
}
function drawGuides(tracks=[],objTracks=[]){
  const c=els.overlay,ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height); if(!c.width)return;
  const active=activeGate();
  for(const gate of settings.gates)if(gate.id!==active?.id)drawSingleGate(ctx,gate,false);
  if(active)drawSingleGate(ctx,active,true);
  ctx.save();
  if(calibrateMode&&calibrationPoints.length){const p=calibrationPoints[0],a={x:p.x*c.width,y:p.y*c.height};ctx.strokeStyle='#ffd166';ctx.fillStyle='#ffd166';ctx.lineWidth=Math.max(3,c.width/420);ctx.beginPath();ctx.arc(a.x,a.y,Math.max(8,c.width/160),0,Math.PI*2);ctx.fill();if(calibrationPoints.length>1){const q=calibrationPoints[1],b={x:q.x*c.width,y:q.y*c.height};ctx.setLineDash([10,7]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);}}
  const pzone=tempPriorityZone||settings.priorityZone;if(pzone){const px=pzone.x*c.width,py=pzone.y*c.height,pw=pzone.w*c.width,ph=pzone.h*c.height;ctx.fillStyle='rgba(66,217,255,.10)';ctx.fillRect(px,py,pw,ph);ctx.strokeStyle='#42d9ff';ctx.lineWidth=Math.max(2,c.width/520);ctx.setLineDash([11,7]);ctx.strokeRect(px,py,pw,ph);ctx.setLineDash([]);ctx.fillStyle='#8cecff';ctx.font=`800 ${Math.max(11,c.width/75)}px system-ui`;ctx.fillText('🎯 ZONA AI PRIORITARIA',px+8,py+20);}
  const zone=tempZone||settings.restrictedZone; if(zone){const zx=zone.x*c.width,zy=zone.y*c.height,zw=zone.w*c.width,zh=zone.h*c.height;ctx.fillStyle='rgba(255,93,104,.13)';ctx.fillRect(zx,zy,zw,zh);ctx.strokeStyle='#ff5d68';ctx.lineWidth=3;ctx.setLineDash([9,6]);ctx.strokeRect(zx,zy,zw,zh);ctx.setLineDash([]);ctx.fillStyle='#ff9ca3';ctx.fillText('ZONA RISERVATA',zx+8,zy+20);}
  const followed=followTrackId!=null?tracks.find(t=>t.id===followTrackId):null;if(followed){drawTrackTrail(ctx,followed,performance.now());}
  for(const t of tracks){
    const [x,bY,w,h]=t.bbox; const poseFall=t.poseFallSince!=null && (performance.now()-t.poseFallSince)/1000>=settings.fallSeconds; const selected=t.id===selectedTrackId;
    const src=t.source||'full',srcColor=src==='priority'?'#42d9ff':src==='tile'?'#b68cff':'#33d17a',srcTag=src==='priority'?' · LR🎯':src==='tile'?' · LR':'';ctx.strokeStyle=selected?'#ffd166':poseFall?'#ff5d68':srcColor;ctx.lineWidth=selected?Math.max(4,c.width/300):Math.max(2,c.width/500);ctx.strokeRect(x,bY,w,h);ctx.fillStyle=selected?'rgba(87,62,10,.88)':'rgba(4,14,24,.78)';const labelW=Math.min(selected?230:180,Math.max(w,110));ctx.fillRect(x,Math.max(0,bY-24),labelW,22);ctx.fillStyle='#fff';ctx.fillText(`P${t.id} ${Math.round(t.score*100)}%${srcTag}${t.id===followTrackId?' · FOLLOW':selected?' · SELEZIONATA':''}`,x+5,Math.max(15,bY-8));
    if(t.pose) drawPose(ctx,t.pose,{strokeStyle:poseFall?'#ff7b85':'#5ed0ff',pointStyle:'#ffffff',lineWidth:Math.max(2,c.width/600)});
  }
  for(const o of objTracks){const [x,bY,w,h]=o.bbox;ctx.strokeStyle='#ffb02e';ctx.lineWidth=2;ctx.strokeRect(x,bY,w,h);ctx.fillStyle='#ffcf76';ctx.fillText(`O${o.id} ${o.class}`,x+4,Math.max(15,bY-6));}
  if(drawZoneMode){ctx.fillStyle='rgba(255,176,46,.92)';ctx.fillRect(10,c.height-36,290,26);ctx.fillStyle='#07101d';ctx.fillText('TRASCINA PER DISEGNARE LA ZONA',16,c.height-18)} if(priorityDrawMode){ctx.fillStyle='rgba(66,217,255,.94)';ctx.fillRect(10,c.height-36,330,26);ctx.fillStyle='#07101d';ctx.fillText('TRASCINA LA ZONA AI PRIORITARIA',16,c.height-18)}
  ctx.restore();
}

function closePersonInspector(){
  selectedTrackId=null; followTrackId=null;
  if(els.followBtn){els.followBtn.classList.remove('active');els.followBtn.setAttribute('aria-pressed','false');els.followBtn.textContent='◎ SEGUI';}
  els.personInspector?.classList.add('hidden');
}

function sourcePointFromPointer(e){
  const {r,scale,ox,oy}=getObjectFitTransform();
  return {x:(e.clientX-r.left-ox)/scale,y:(e.clientY-r.top-oy)/scale};
}

function selectTrackAtPointer(e){
  if(drawZoneMode||priorityDrawMode||calibrateMode||!running||!currentTracks.length)return;
  const p=sourcePointFromPointer(e);
  const candidates=currentTracks.filter(t=>{
    const [x,y,w,h]=t.bbox; const pad=Math.max(8,Math.min(w,h)*.08);
    return p.x>=x-pad&&p.x<=x+w+pad&&p.y>=y-pad&&p.y<=y+h+pad;
  }).sort((a,b)=>(a.bbox[2]*a.bbox[3])-(b.bbox[2]*b.bbox[3]));
  if(!candidates.length){closePersonInspector();drawGuides(currentTracks);return;}
  selectedTrackId=candidates[0].id;
  if(followTrackId!=null)followTrackId=selectedTrackId;
  renderPersonInspector(performance.now(),true);
  drawGuides(currentTracks);
  if(navigator.vibrate)navigator.vibrate(25);
}

function trackRisk(t){
  const flags=t.anomalyFlags||[];
  const globalCritical=activeStates.has('crowd');
  const critical=t.fallEscalated||flags.includes('fall')||flags.includes('zone')||flags.includes('afterHours')||flags.includes('wrongWay')||globalCritical;
  if(critical)return{level:'critical',label:'CRITICO',detail:t.fallEscalated?'Persona a terra da verificare subito':flags.length?flags.map(flagLabel).join(' · '):'Sovraffollamento attivo'};
  if(flags.length||activeStates.has('cluster'))return{level:'warning',label:'ATTENZIONE',detail:flags.length?flags.map(flagLabel).join(' · '):'Assembramento locale attivo'};
  return{level:'normal',label:'NORMALE',detail:'Nessuna anomalia associata'};
}

function flagLabel(k){return{stationary:'Permanenza insolita',fall:'Possibile caduta',speed:'Movimento rapido',zone:'Zona riservata',afterHours:'Fuori orario',loop:'Movimento ripetitivo',zoneDwell:'Sosta prolungata in zona',wrongWay:'Direzione vietata'}[k]||k}

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
  const ag=activeGate(),gs=ag?t.gateStates?.[ag.id]:null;const sideLabel=!ag?'Nessun varco':gs?.side==null?`${ag.name}: lato da determinare`:`${ag.name}: ${gs.side<0?'Lato 1':'Lato 2'}`;
  const position=`${sideLabel}${settings.restrictedZone?' · '+(inZone?'in zona':'fuori zona'):''}`;
  const risk=trackRisk(t);
  els.personInspectorId.textContent=`P${t.id}`;
  els.personDwell.textContent=formatDuration(age);
  els.personSpeed.textContent=speedLabel;
  els.personPose.textContent=pose;
  els.personConfidence.textContent=Math.round((t.score||0)*100)+'%';
  els.personCrossing.textContent=crossing;
  els.personPosition.textContent=position;
  const path=trackPathMetrics(t,now,settings.trailSeconds);els.personPath.textContent=`${Math.round(path.lengthRatio*100)}% · ${settings.trailSeconds}s`;
  const following=followTrackId===t.id;els.personFollowState.textContent=following?'ATTIVO':'OFF';els.followBtn.classList.toggle('active',following);els.followBtn.setAttribute('aria-pressed',String(following));els.followBtn.textContent=following?'● SEGUENDO':'◎ SEGUI';
  els.personRisk.className='person-risk '+risk.level;
  els.personRiskLabel.textContent=risk.label;els.personRiskDetail.textContent=risk.detail;
  const flags=t.anomalyFlags||[];
  els.personFlags.innerHTML=flags.length?flags.map(k=>`<span class="${k==='fall'||k==='zone'||k==='afterHours'||k==='wrongWay'?'danger':'warning'}">${escapeHtml(flagLabel(k))}</span>`).join(''):'<span>Nessuna anomalia</span>';
  els.personTrackStatus.textContent=stale>650?`Segnale temporaneamente perso da ${(stale/1000).toFixed(1)} s`:followTrackId===t.id?`FOLLOW attivo · percorso ultimi ${settings.trailSeconds} s`:`Tracciamento attivo · premi SEGUI per mostrare il percorso`;
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
  const enabled={crowd:true,stationary:settings.enableStationary,fall:settings.enableFall,speed:settings.enableSpeed,zone:settings.enableZone,surge:settings.enableSurge,cluster:settings.enableCluster,afterHours:settings.enableAfterHours,object:settings.enableObject,dark:settings.enableDark,loop:settings.enableLoop,zoneDwell:settings.enableZoneDwell,wrongWay:settings.enableWrongWay}; let n=0;
  document.querySelectorAll('[data-state]').forEach(el=>{const k=el.dataset.state;el.className='';if(activeStates.has(k)){el.textContent='ALERT';el.classList.add('alert');n++;}else if(enabled[k]){el.textContent='ON';el.classList.add('on')}else el.textContent='OFF';}); els.anomalyCount.textContent=n;
}
function updateAlertPanel(){
  const danger=['crowd','fall','zone','afterHours','wrongWay'].find(x=>activeStates.has(x)); const warning=[...activeStates][0];
  els.alertPanel.className='alert-panel card '+(danger?'danger':warning?'warn':'ok'); els.alertIcon.textContent=danger?'!':warning?'⚠':'✓'; els.alertTitle.textContent=danger?'Anomalia critica rilevata':warning?'Anomalia da verificare':'Situazione regolare'; els.alertText.textContent=danger?labelFor(danger):warning?labelFor(warning):'Nessuna anomalia attiva.';
  if(danger||warning){els.fullAlert.classList.remove('hidden');els.fullAlertTitle.textContent=danger?'⚠ ANOMALIA CRITICA':'⚠ ANOMALIA';els.fullAlertText.textContent=labelFor(danger||warning);}else els.fullAlert.classList.add('hidden');
}
function labelFor(k){return {crowd:'Capienza massima raggiunta o superata.',stationary:'Una persona risulta quasi ferma da molto tempo.',fall:'Possibile persona a terra: verificare.',speed:'Rilevato movimento insolitamente rapido.',zone:'Rilevata presenza nella zona riservata.',surge:'Numero di persone aumentato rapidamente.',cluster:'Rilevato un gruppo di persone molto ravvicinate.',afterHours:'Presenza rilevata fuori dall’orario configurato.',object:'Possibile oggetto lasciato senza persona vicina.',dark:'Inquadratura troppo scura o ostruita.',loop:'Rilevato un possibile movimento ripetitivo nella stessa area.',zoneDwell:'Permanenza prolungata nella zona configurata.',wrongWay:'Attraversamento nel verso configurato come vietato.'}[k]||k}

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

async function record(type,message,severity='info',meta={}){
  const event={ts:Date.now(),type,message,severity,visible,occupancy,entries,exits,...meta}; try{await addEvent(event)}catch{} renderEvents(); }
async function renderEvents(){
  let events=[];try{events=await getEvents(200)}catch{} if(!events.length){els.eventLog.innerHTML='<div class="empty-log">Nessun evento registrato.</div>';return}
  els.eventLog.innerHTML=events.map(e=>`<div class="event-row"><time>${new Date(e.ts).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><span class="type">${escapeHtml(e.type)}</span><span>${escapeHtml(e.message)}</span><span class="sev ${e.severity}">${e.severity.toUpperCase()}</span></div>`).join('');
}
function escapeHtml(s){return String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}
function toast(msg){els.toast.textContent=msg;els.toast.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove('show'),2600)}

async function exportCsv(){
  const ev=await getEvents(10000);const rows=[['data','ora','tipo','gravita','varco','messaggio','visibili','presenti_stimati','entrati','usciti'],...ev.slice().reverse().map(e=>{const d=new Date(e.ts);return[d.toLocaleDateString('it-IT'),d.toLocaleTimeString('it-IT'),e.type,e.severity,e.gateName||'',e.message,e.visible,e.occupancy,e.entries,e.exits]})];
  const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';')).join('\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='peoplelens-v2.6-eventi-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function getObjectFitTransform(){
  const r=els.overlay.getBoundingClientRect(),sw=els.overlay.width||1,sh=els.overlay.height||1;
  const cover=document.body.classList.contains('camera-immersive'); const scale=cover?Math.max(r.width/sw,r.height/sh):Math.min(r.width/sw,r.height/sh);
  const dw=sw*scale,dh=sh*scale,ox=(r.width-dw)/2,oy=(r.height-dh)/2;return{r,sw,sh,scale,ox,oy};
}
function visibleNormalizedBounds(){
  const {r,sw,sh,scale,ox,oy}=getObjectFitTransform();
  const x1=Math.max(0,(-ox)/Math.max(scale,.001)/sw),x2=Math.min(1,(r.width-ox)/Math.max(scale,.001)/sw);
  const y1=Math.max(0,(-oy)/Math.max(scale,.001)/sh),y2=Math.min(1,(r.height-oy)/Math.max(scale,.001)/sh);
  const mx=Math.min(.035,Math.max(.012,(x2-x1)*.035)),my=Math.min(.035,Math.max(.012,(y2-y1)*.035));
  return{minX:Math.min(x2,x1+mx),maxX:Math.max(x1,x2-mx),minY:Math.min(y2,y1+my),maxY:Math.max(y1,y2-my)};
}
function ensureEditableLineVisible(save=false){
  if(!els.overlay.width||!els.overlay.height)return;
  const vb=visibleNormalizedBounds();
  const clamp=(p)=>({x:Math.min(vb.maxX,Math.max(vb.minX,p.x)),y:Math.min(vb.maxY,Math.max(vb.minY,p.y))});
  for(const gate of settings.gates){
    const a=clamp(gate.a),b=clamp(gate.b);
    if(Math.hypot(b.x-a.x,b.y-a.y)<.10){const y=Math.min(vb.maxY,Math.max(vb.minY,(a.y+b.y)/2));gate.a={x:vb.minX,y};gate.b={x:vb.maxX,y};}
    else{gate.a=a;gate.b=b;}
  }
  if(save)saveSettings();updateOutputs();
}
function pointSegmentDistance(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;if(l2<1e-8)return Math.hypot(p.x-a.x,p.y-a.y);
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2));return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
}
function nearestGateAtPointer(e){
  const p=sourcePointFromPointer(e),{scale}=getObjectFitTransform(),threshold=28/Math.max(scale,.001);let best=null,bestD=Infinity;
  for(const gate of settings.gates){const {a,b}=linePointsPx(gate),d=pointSegmentDistance(p,a,b);if(d<threshold&&d<bestD){best=gate;bestD=d;}}
  return best;
}
function lineHandleHit(e){
  if(!running||drawZoneMode||priorityDrawMode||calibrateMode)return null;
  const gate=activeGate();if(!gate)return null;const p=sourcePointFromPointer(e),g=lineHandleGeometry(gate);
  const hitRadius=Math.max(g.radius*1.65,30*g.inv);
  if(Math.hypot(p.x-g.a.x,p.y-g.a.y)<=hitRadius)return'a';
  if(Math.hypot(p.x-g.b.x,p.y-g.b.y)<=hitRadius)return'b';
  if(Math.abs(p.x-g.mid.x)<=g.pillW*.65&&Math.abs(p.y-g.mid.y)<=g.pillH*.9)return'move';
  return null;
}
function clampLinePoint(p){const b=visibleNormalizedBounds();return{x:Math.min(b.maxX,Math.max(b.minX,p.x)),y:Math.min(b.maxY,Math.max(b.minY,p.y))}}
function setLineFromPointer(e,save=false){
  const gate=settings.gates.find(g=>g.id===lineDragGateId)||activeGate();if(!gate)return;const p=canvasPoint(e);
  if(lineDragMode==='a')gate.a=clampLinePoint(p);
  else if(lineDragMode==='b')gate.b=clampLinePoint(p);
  else if(lineDragMode==='move'&&lineDragStart&&lineDragOriginal){
    let dx=p.x-lineDragStart.x,dy=p.y-lineDragStart.y;const a0=lineDragOriginal.a,b0=lineDragOriginal.b,vb=visibleNormalizedBounds();
    dx=Math.max(vb.minX-Math.min(a0.x,b0.x),Math.min(vb.maxX-Math.max(a0.x,b0.x),dx));dy=Math.max(vb.minY-Math.min(a0.y,b0.y),Math.min(vb.maxY-Math.max(a0.y,b0.y),dy));gate.a={x:a0.x+dx,y:a0.y+dy};gate.b={x:b0.x+dx,y:b0.y+dy};
  }
  if(Math.hypot(gate.b.x-gate.a.x,gate.b.y-gate.a.y)<.10){if(lineDragMode==='a')gate.a={...lineDragOriginal.a};if(lineDragMode==='b')gate.b={...lineDragOriginal.b};}
  updateOutputs();if(save)saveSettings();drawGuides(currentTracks);
}
function setCalibrationUi(on,text='Tocca il punto A del passaggio.'){
  calibrateMode=on;if(els.gateCalibHint)els.gateCalibHint.classList.toggle('hidden',!on);if(els.gateCalibText)els.gateCalibText.textContent=text;
  if(els.gateBtn)els.gateBtn.textContent=on?'✕ Annulla calibrazione':'⌁ Calibra varco';if(els.calibrateGateBtn)els.calibrateGateBtn.textContent=on?'✕ Annulla calibrazione':'⌁ Calibra con 2 tocchi';
  renderGateQuickMap();
}
function startGateCalibration(){
  if(!running){toast('Avvia prima la fotocamera.');return;}if(calibrateMode){cancelGateCalibration();return;}
  drawZoneMode=false;zoneStart=null;tempZone=null;if(els.zoneBtn)els.zoneBtn.textContent='▧ Disegna zona';cancelPriorityDraw();closePersonInspector();calibrationPoints=[];setCalibrationUi(true,`Tocca il punto A di ${activeGate()?.name||'varco'}.`);toast('Calibrazione: tocca il primo lato del passaggio.');drawGuides(currentTracks);
}
function cancelGateCalibration(){calibrationPoints=[];calibrationPointerId=null;setCalibrationUi(false);drawGuides(currentTracks);}
function calibrationTap(e){
  const p=clampLinePoint(canvasPoint(e));
  if(!calibrationPoints.length){calibrationPoints=[p];setCalibrationUi(true,'Punto A acquisito. Tocca ora il punto B.');if(navigator.vibrate)navigator.vibrate(25);drawGuides(currentTracks);return;}
  if(Math.hypot(p.x-calibrationPoints[0].x,p.y-calibrationPoints[0].y)<.08){toast('Punto B troppo vicino ad A. Tocca più lontano.');return;}
  const gate=activeGate();if(!gate)return;gate.a={...calibrationPoints[0]};gate.b={...p};saveSettings();const name=gate.name;calibrationPoints=[];setCalibrationUi(false);resetLineSides();updateOutputs();hydrateGateControls();drawGuides(currentTracks);record('Calibrazione varco',`${name} calibrato con due punti`,'info',{gateId:gate.id,gateName:gate.name});toast(`${name} calibrato.`);
}
function beginPointerAction(e){
  if(!running)return;
  if(calibrateMode){calibrationPointerId=e.pointerId;els.overlay.setPointerCapture?.(e.pointerId);return;}
  if(priorityDrawMode){const p=canvasPoint(e);priorityStart=p;tempPriorityZone={x:p.x,y:p.y,w:0,h:0};priorityPointerId=e.pointerId;els.overlay.setPointerCapture?.(e.pointerId);return;}
  if(drawZoneMode){const p=canvasPoint(e);zoneStart=p;tempZone={x:p.x,y:p.y,w:0,h:0};els.overlay.setPointerCapture?.(e.pointerId);return;}
  const hit=lineHandleHit(e);
  if(hit){const gate=activeGate();draggingLine=true;lineDragMode=hit;linePointerId=e.pointerId;lineDragGateId=gate.id;lineDragStart=canvasPoint(e);lineDragOriginal={a:{...gate.a},b:{...gate.b}};els.overlay.setPointerCapture?.(e.pointerId);if(navigator.vibrate)navigator.vibrate(20);drawGuides(currentTracks);return;}
  const near=nearestGateAtPointer(e);if(near&&near.id!==settings.activeGateId){setActiveGate(near.id,true);return;}
}
function movePointerAction(e){
  if(draggingLine&&e.pointerId===linePointerId){setLineFromPointer(e,false);return;}
  if(priorityStart&&priorityDrawMode&&e.pointerId===priorityPointerId){const p=canvasPoint(e);tempPriorityZone=normalizeZone(priorityStart,p);drawGuides(currentTracks);return;} if(zoneStart&&drawZoneMode){const p=canvasPoint(e);tempZone=normalizeZone(zoneStart,p);drawGuides(currentTracks);}
}
function endPointerAction(e){
  if(calibrateMode&&e.pointerId===calibrationPointerId){calibrationPointerId=null;calibrationTap(e);return;}
  if(draggingLine&&e.pointerId===linePointerId){setLineFromPointer(e,true);draggingLine=false;linePointerId=null;const mode=lineDragMode;lineDragMode=null;lineDragStart=null;lineDragOriginal=null;lineDragGateId=null;resetLineSides();toast(mode==='move'?'Varco spostato.':'Varco ruotato/ridimensionato.');drawGuides(currentTracks);return;}
  if(priorityDrawMode&&priorityStart&&e.pointerId===priorityPointerId){const p=canvasPoint(e),z=normalizeZone(priorityStart,p);priorityStart=null;tempPriorityZone=null;priorityPointerId=null;if(z.w<.06||z.h<.06){toast('Zona AI troppo piccola. Riprova.');return;}settings.priorityZone=z;saveSettings();priorityDrawMode=false;if(els.priorityBtn)els.priorityBtn.textContent='🎯 Zona AI';els.priorityHint?.classList.add('hidden');updatePriorityHelp();renderGateQuickMap();toast('Zona AI prioritaria salvata.');drawGuides(currentTracks);return;}
  if(drawZoneMode&&zoneStart){const p=canvasPoint(e);const z=normalizeZone(zoneStart,p);zoneStart=null;tempZone=null;if(z.w<.04||z.h<.04){toast('Zona troppo piccola. Riprova.');return}settings.restrictedZone=z;settings.enableZone=true;$('#enableZone').checked=true;saveSettings();drawZoneMode=false;els.zoneBtn.textContent='▧ Disegna zona';updateZoneHelp();renderGateQuickMap();toast('Zona riservata salvata.');return;}
  if(!nearestGateAtPointer(e))selectTrackAtPointer(e);
}
function cancelPointerAction(){draggingLine=false;linePointerId=null;lineDragMode=null;lineDragStart=null;lineDragOriginal=null;lineDragGateId=null;zoneStart=null;tempZone=null;priorityStart=null;tempPriorityZone=null;priorityPointerId=null;calibrationPointerId=null;drawGuides(currentTracks);}
function canvasPoint(e){const {r,sw,sh,scale,ox,oy}=getObjectFitTransform();const sx=(e.clientX-r.left-ox)/scale,sy=(e.clientY-r.top-oy)/scale;return{x:Math.min(1,Math.max(0,sx/sw)),y:Math.min(1,Math.max(0,sy/sh))}}
function normalizeZone(a,b){return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)}}
function cancelPriorityDraw(){priorityDrawMode=false;priorityStart=null;tempPriorityZone=null;priorityPointerId=null;if(els.priorityBtn)els.priorityBtn.textContent='🎯 Zona AI';els.priorityHint?.classList.add('hidden');renderGateQuickMap();}
function togglePriorityDraw(){
  if(!running)return;if(priorityDrawMode){cancelPriorityDraw();drawGuides(currentTracks);return;}
  if(calibrateMode)cancelGateCalibration();drawZoneMode=false;zoneStart=null;tempZone=null;if(els.zoneBtn)els.zoneBtn.textContent='▧ Disegna zona';closePersonInspector();priorityDrawMode=true;if(els.priorityBtn)els.priorityBtn.textContent='✕ Annulla AI';els.priorityHint?.classList.remove('hidden');renderGateQuickMap();drawGuides(currentTracks);toast('Disegna la zona lontana da analizzare con priorità.');
}
function clearPriorityZone(){settings.priorityZone=null;saveSettings();cancelPriorityDraw();updatePriorityHelp();drawGuides(currentTracks);toast('Zona AI prioritaria rimossa.');}
async function configureCameraZoom(){
  cameraZoomCaps=null;cameraZoomValue=1;const track=stream?.getVideoTracks?.()[0];if(!track){els.cameraZoom?.classList.add('hidden');return;}
  try{const caps=track.getCapabilities?.()||{},st=track.getSettings?.()||{};if(caps.zoom&&Number.isFinite(caps.zoom.min)&&Number.isFinite(caps.zoom.max)&&caps.zoom.max>caps.zoom.min){cameraZoomCaps={min:caps.zoom.min,max:caps.zoom.max,step:caps.zoom.step||.1};cameraZoomValue=Number.isFinite(st.zoom)?st.zoom:caps.zoom.min;els.cameraZoom?.classList.remove('hidden');updateZoomUi();}else els.cameraZoom?.classList.add('hidden');}catch{els.cameraZoom?.classList.add('hidden');}
}
function updateZoomUi(){if(els.zoomLabel)els.zoomLabel.textContent=`${cameraZoomValue.toFixed(cameraZoomValue<2?1:0)}×`;if(cameraZoomCaps){if(els.zoomOutBtn)els.zoomOutBtn.disabled=cameraZoomValue<=cameraZoomCaps.min+.001;if(els.zoomInBtn)els.zoomInBtn.disabled=cameraZoomValue>=cameraZoomCaps.max-.001;}}
async function changeCameraZoom(dir){if(!cameraZoomCaps)return;const track=stream?.getVideoTracks?.()[0];if(!track)return;const span=cameraZoomCaps.max-cameraZoomCaps.min,step=Math.max(cameraZoomCaps.step,span/8);let v=Math.min(cameraZoomCaps.max,Math.max(cameraZoomCaps.min,cameraZoomValue+dir*step));v=Math.round(v/cameraZoomCaps.step)*cameraZoomCaps.step;try{await track.applyConstraints({advanced:[{zoom:v}]});cameraZoomValue=v;updateZoomUi();}catch(err){console.warn('Zoom hardware non disponibile:',err);toast('Zoom hardware non disponibile su questa fotocamera.');}}

function addGate(){
  if(settings.gates.length>=6){toast('Puoi configurare al massimo 6 varchi.');return;}
  const idx=settings.gates.length;const gate=makeGate(idx);settings.gates.push(gate);settings.activeGateId=gate.id;gateSessionStats.set(gate.id,{entries:0,exits:0});if(running)ensureEditableLineVisible(false);saveSettings();hydrateGateControls();resetLineSides();drawGuides(currentTracks);toast(`${gate.name} creato. Ora puoi calibrarlo.`);
}
function deleteActiveGate(){
  if(settings.gates.length<=1){toast('Deve rimanere almeno un varco.');return;}const g=activeGate();settings.gates=settings.gates.filter(x=>x.id!==g.id);gateSessionStats.delete(g.id);settings.activeGateId=settings.gates[0].id;saveSettings();hydrateGateControls();resetLineSides();drawGuides(currentTracks);toast(`${g.name} eliminato.`);
}
function resetActiveGate(){
  const g=activeGate();if(!g)return;const vb=running?visibleNormalizedBounds():{minX:.08,maxX:.92,minY:.05,maxY:.95};const y=Math.min(vb.maxY,Math.max(vb.minY,.62));g.a={x:vb.minX,y};g.b={x:vb.maxX,y};saveSettings();updateOutputs();resetLineSides();drawGuides(currentTracks);toast(`${g.name} ripristinato orizzontale.`);
}

els.startBtn.addEventListener('click',startCamera);els.stopBtn.addEventListener('click',stopCamera);els.switchBtn.addEventListener('click',switchCamera);els.exitViewBtn.addEventListener('click',exitImmersive);
els.zoneBtn.addEventListener('click',()=>{if(!running)return;if(calibrateMode)cancelGateCalibration();cancelPriorityDraw();drawZoneMode=!drawZoneMode;els.zoneBtn.textContent=drawZoneMode?'✕ Annulla zona':'▧ Disegna zona';if(!drawZoneMode){zoneStart=null;tempZone=null}renderGateQuickMap();});
els.gateBtn?.addEventListener('click',startGateCalibration);els.calibrateGateBtn?.addEventListener('click',startGateCalibration);els.priorityBtn?.addEventListener('click',togglePriorityDraw);els.aiModeBtn?.addEventListener('click',cycleDetectionMode);els.clearPriorityBtn?.addEventListener('click',clearPriorityZone);els.zoomOutBtn?.addEventListener('click',()=>changeCameraZoom(-1));els.zoomInBtn?.addEventListener('click',()=>changeCameraZoom(1));
els.overlay.addEventListener('pointerdown',beginPointerAction);els.overlay.addEventListener('pointermove',movePointerAction);els.overlay.addEventListener('pointerup',endPointerAction);els.overlay.addEventListener('pointercancel',cancelPointerAction);
els.personInspectorClose?.addEventListener('click',()=>{closePersonInspector();drawGuides(currentTracks)});
els.followBtn?.addEventListener('click',()=>{if(selectedTrackId==null)return;followTrackId=followTrackId===selectedTrackId?null:selectedTrackId;renderPersonInspector(performance.now(),true);drawGuides(currentTracks);if(navigator.vibrate)navigator.vibrate(25);});
for(const id of settingIds){$('#'+id)?.addEventListener('input',readSettings);$('#'+id)?.addEventListener('change',readSettings)}
els.gateSelector?.addEventListener('change',e=>setActiveGate(e.target.value,false));
els.gateName?.addEventListener('input',e=>{const g=activeGate();if(!g)return;g.name=e.target.value.slice(0,28);saveSettings();const opt=els.gateSelector?.querySelector(`option[value="${CSS.escape(g.id)}"]`);if(opt)opt.textContent=`${settings.gates.indexOf(g)+1}. ${g.name||'Varco'}${g.enabled?'':' · OFF'}`;renderGateSummary();renderGateQuickMap();drawGuides(currentTracks)});els.gateName?.addEventListener('change',e=>{const g=activeGate();if(!g)return;if(!g.name.trim())g.name=`Varco ${settings.gates.indexOf(g)+1}`;e.target.value=g.name;saveSettings();hydrateGateControls();drawGuides(currentTracks)});
els.gateEnabled?.addEventListener('change',e=>{const g=activeGate();if(!g)return;g.enabled=e.target.checked;saveSettings();hydrateGateControls();resetLineSides();drawGuides(currentTracks)});
$('#entryDirection')?.addEventListener('change',e=>{const g=activeGate();if(!g)return;g.entryDirection=e.target.value==='reverse'?'reverse':'forward';saveSettings();resetLineSides();drawGuides(currentTracks)});
$('#allowedDirection')?.addEventListener('change',e=>{const g=activeGate();if(!g)return;g.allowedDirection=e.target.value==='reverse'?'reverse':'forward';saveSettings();resetLineSides();drawGuides(currentTracks)});
els.addGateBtn?.addEventListener('click',addGate);els.deleteGateBtn?.addEventListener('click',deleteActiveGate);$('#resetLineBtn')?.addEventListener('click',resetActiveGate);
$('#resetSettingsBtn').addEventListener('click',()=>{settings={...DEFAULT_SETTINGS,gates:[makeGate(0,DEFAULT_SETTINGS.gates?.[0])],activeGateId:'gate-1'};gateSessionStats=new Map(settings.gates.map(g=>[g.id,{entries:0,exits:0}]));cancelPriorityDraw();if(running)ensureEditableLineVisible(true);else saveSettings();hydrateSettings();if(running)resetLineSides();drawGuides(currentTracks);toast('Impostazioni ripristinate.');});
$('#resetHeatmapBtn').addEventListener('click',()=>{heatGrid.fill(0);drawHeatmap();toast('Heatmap azzerata.');});
$('#exportBtn').addEventListener('click',exportCsv);$('#clearBtn').addEventListener('click',async()=>{await clearEvents();renderEvents();toast('Registro azzerato.');});
window.addEventListener('resize',()=>{resizeCanvas();if(running){ensureEditableLineVisible(true);resetLineSides();drawGuides(currentTracks);}drawHeatmap()});window.addEventListener('beforeunload',stopTracks);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;els.installBtn.classList.remove('hidden')});els.installBtn.addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;els.installBtn.classList.add('hidden')});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));

gateSessionStats=new Map(settings.gates.map(g=>[g.id,{entries:0,exits:0}]));hydrateSettings();renderEvents();drawHeatmap();loadModels();updateAnomalyStates();updateAlertPanel();
