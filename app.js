import { PersonTracker, ObjectTracker } from './tracker.js';
import { DEFAULT_SETTINGS, pointInZone, isAfterHours, fallHeuristic, nearestPersonDistance } from './anomalies.js';
import { addEvent, getEvents, clearEvents } from './db.js';

const $ = s => document.querySelector(s);
const els = {
  video: $('#video'), overlay: $('#overlay'), cameraWrap: $('#cameraWrap'), emptyCamera: $('#emptyCamera'),
  startBtn: $('#startBtn'), stopBtn: $('#stopBtn'), switchBtn: $('#switchBtn'), zoneBtn: $('#zoneBtn'), installBtn: $('#installBtn'),
  modelBadge: $('#modelBadge'), liveBadge: $('#liveBadge'), fpsBadge: $('#fpsBadge'),
  visibleCount: $('#visibleCount'), occupancyCount: $('#occupancyCount'), entriesCount: $('#entriesCount'), exitsCount: $('#exitsCount'), peakCount: $('#peakCount'), peakTime: $('#peakTime'), crowdPercent: $('#crowdPercent'), crowdMeter: $('#crowdMeter'),
  alertPanel: $('#alertPanel'), alertIcon: $('#alertIcon'), alertTitle: $('#alertTitle'), alertText: $('#alertText'), anomalyCount: $('#anomalyCount'), eventLog: $('#eventLog'), toast: $('#toast'), zoneHelp: $('#zoneHelp')
};

let model=null, stream=null, running=false, inferenceBusy=false, lastInference=0, currentFacing='environment';
let entries=0, exits=0, peak=0, peakAt=null, occupancy=0, visible=0;
let personTracker=new PersonTracker(), objectTracker=new ObjectTracker();
let settings=loadSettings(); let recentCounts=[]; let lastFrameTs=0; let aiFrames=0; let fpsWindowStart=performance.now();
let anomalyCooldown=new Map(); let activeStates=new Set(); let drawZoneMode=false, zoneStart=null, tempZone=null; let installPrompt=null; let audioCtx=null;
const bagClasses=new Set(['backpack','handbag','suitcase']);

const settingIds=['confidence','maxOccupancy','baseOccupancy','lineY','entryDirection','stationarySeconds','fallSeconds','speedThreshold','surgeCount','surgeWindow','objectSeconds','openTime','closeTime','enableStationary','enableFall','enableSpeed','enableZone','enableSurge','enableAfterHours','enableObject','enableDark','soundAlerts'];

function loadSettings(){ try{return {...DEFAULT_SETTINGS,...JSON.parse(localStorage.getItem('peoplelensSettings')||'{}')}}catch{return {...DEFAULT_SETTINGS}} }
function saveSettings(){ localStorage.setItem('peoplelensSettings',JSON.stringify(settings)); }
function hydrateSettings(){
  for(const id of settingIds){ const el=$('#'+id); if(!el) continue; const v=settings[id]; if(el.type==='checkbox')el.checked=!!v; else if(id==='confidence')el.value=Math.round(v*100); else if(id==='lineY'||id==='speedThreshold')el.value=Math.round(v*100); else el.value=v; }
  updateOutputs(); updateZoneHelp();
}
function readSettings(){
  for(const id of settingIds){ const el=$('#'+id); if(!el)continue; let v; if(el.type==='checkbox')v=el.checked; else if(el.type==='number'||el.type==='range')v=Number(el.value); else v=el.value; if(id==='confidence'||id==='lineY'||id==='speedThreshold')v/=100; settings[id]=v; }
  saveSettings(); updateOutputs(); updateStats();
}
function updateOutputs(){ $('#confidenceOut').textContent=Math.round(settings.confidence*100)+'%'; $('#lineYOut').textContent=Math.round(settings.lineY*100)+'%'; $('#speedOut').textContent=Math.round(settings.speedThreshold*100)+'%'; }
function updateZoneHelp(){ els.zoneHelp.innerHTML=settings.restrictedZone?'Zona riservata impostata. Attiva <b>Zona riservata</b> per generare gli avvisi.':'Zona riservata non impostata. Tocca <b>Disegna zona</b> e trascina un rettangolo sul video.'; }

async function loadModel(){
  els.modelBadge.textContent='Caricamento AI…'; els.modelBadge.className='pill warn';
  try{ await tf.ready(); try{await tf.setBackend('webgl')}catch{}; model=await cocoSsd.load({base:'lite_mobilenet_v2'}); els.modelBadge.textContent='AI pronta · '+tf.getBackend(); els.modelBadge.className='pill ok'; }
  catch(err){ console.error(err); els.modelBadge.textContent='Errore AI'; els.modelBadge.className='pill danger'; toast('Impossibile caricare il modello AI. Controlla la connessione.'); }
}

async function startCamera(){
  if(!model){toast('Il modello AI non è ancora pronto.');return}
  try{
    stopTracks();
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:currentFacing},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}}});
    els.video.srcObject=stream; await els.video.play(); running=true; resetSession();
    els.startBtn.disabled=true; els.stopBtn.disabled=false; els.switchBtn.disabled=false; els.zoneBtn.disabled=false; els.emptyCamera.classList.add('hidden'); els.liveBadge.classList.remove('hidden'); els.fpsBadge.classList.remove('hidden');
    ensureAudio(); resizeCanvas(); requestAnimationFrame(loop);
  }catch(err){ console.error(err); toast(err.name==='NotAllowedError'?'Permesso fotocamera negato.':'Fotocamera non disponibile.'); }
}
function stopTracks(){ if(stream){stream.getTracks().forEach(t=>t.stop());stream=null} }
function stopCamera(){ running=false; stopTracks(); els.video.srcObject=null; els.startBtn.disabled=false; els.stopBtn.disabled=true; els.switchBtn.disabled=true; els.zoneBtn.disabled=true; els.emptyCamera.classList.remove('hidden'); els.liveBadge.classList.add('hidden'); els.fpsBadge.classList.add('hidden'); clearOverlay(); }
async function switchCamera(){ currentFacing=currentFacing==='environment'?'user':'environment'; if(running) await startCamera(); }
function resetSession(){ entries=0; exits=0; peak=0; peakAt=null; occupancy=settings.baseOccupancy; visible=0; recentCounts=[]; personTracker.reset();objectTracker.reset();anomalyCooldown.clear();activeStates.clear();updateStats(); }

function resizeCanvas(){ const v=els.video,c=els.overlay; if(!v.videoWidth)return; if(c.width!==v.videoWidth||c.height!==v.videoHeight){c.width=v.videoWidth;c.height=v.videoHeight;} }
function clearOverlay(){ const c=els.overlay; c.getContext('2d').clearRect(0,0,c.width,c.height); }

async function loop(ts){
  if(!running)return; resizeCanvas(); drawGuides([]);
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
  visible=tracks.length; processCrossings(tracks,now); occupancy=Math.max(0,settings.baseOccupancy+entries-exits); if(occupancy>peak){peak=occupancy;peakAt=Date.now();}
  processAnomalies(tracks,objTracks,now); drawGuides(tracks,objTracks); updateStats(); updateFps(now);
}

function processCrossings(tracks,now){
  const line=els.overlay.height*settings.lineY;
  for(const t of tracks){
    const side=t.cy<line?'above':'below';
    if(t.lineSide==null){t.lineSide=side;continue}
    if(side!==t.lineSide && t.ageMs>450 && now-t.lastCrossAt>1800){
      const down=t.lineSide==='above'&&side==='below'; const isEntry=settings.entryDirection==='down'?down:!down;
      if(isEntry){entries++;record('Ingresso','Persona attraversata linea ingresso','info');} else {exits++;record('Uscita','Persona attraversata linea uscita','info');}
      t.lastCrossAt=now; t.lineSide=side;
    } else t.lineSide=side;
  }
}

function processAnomalies(tracks,objTracks,now){
  activeStates.clear(); const fw=els.overlay.width,fh=els.overlay.height,diag=Math.hypot(fw,fh)||1;
  if(occupancy>=settings.maxOccupancy){activeStates.add('crowd');trigger('crowd','Sovraffollamento',`Capienza ${occupancy}/${settings.maxOccupancy}`,'danger',5000)}

  for(const t of tracks){
    if(settings.enableStationary && (now-t.stationarySince)/1000>=settings.stationarySeconds){activeStates.add('stationary');trigger('stationary:'+t.id,'Permanenza insolita',`P${t.id} quasi ferma da ${Math.round((now-t.stationarySince)/1000)} s`,'warning',12000)}
    if(settings.enableFall && fallHeuristic(t,now,settings.fallSeconds)){activeStates.add('fall');trigger('fall:'+t.id,'Possibile caduta',`P${t.id}: postura orizzontale persistente`,'danger',10000)}
    if(settings.enableSpeed && t.speed>=settings.speedThreshold){activeStates.add('speed');trigger('speed:'+t.id,'Movimento rapido',`P${t.id}: velocità anomala stimata`,'warning',8000)}
    if(settings.enableZone && settings.restrictedZone && pointInZone(t.cx,t.cy,settings.restrictedZone,fw,fh)){activeStates.add('zone');trigger('zone:'+t.id,'Zona riservata',`P${t.id} dentro la zona configurata`,'danger',8000)}
  }

  const epoch=Date.now(); recentCounts.push({ts:epoch,count:visible}); recentCounts=recentCounts.filter(x=>epoch-x.ts<=settings.surgeWindow*1000);
  if(settings.enableSurge && recentCounts.length>1){ const min=Math.min(...recentCounts.map(x=>x.count)); if(visible-min>=settings.surgeCount){activeStates.add('surge');trigger('surge','Aumento improvviso',`+${visible-min} persone in circa ${settings.surgeWindow} s`,'warning',10000)} }
  if(settings.enableAfterHours && tracks.length && isAfterHours(new Date(),settings.openTime,settings.closeTime)){activeStates.add('afterHours');trigger('afterHours','Presenza fuori orario',`${tracks.length} persona/e rilevata/e in orario di chiusura`,'danger',15000)}

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
  for(const t of tracks){const [x,bY,w,h]=t.bbox;const fall=t.fallSince!=null;ctx.strokeStyle=fall?'#ff5d68':'#33d17a';ctx.lineWidth=Math.max(2,c.width/500);ctx.strokeRect(x,bY,w,h);ctx.fillStyle='rgba(4,14,24,.78)';ctx.fillRect(x,Math.max(0,bY-24),Math.min(130,w),22);ctx.fillStyle='#fff';ctx.fillText(`P${t.id} ${Math.round(t.score*100)}%`,x+5,Math.max(15,bY-8));}
  for(const o of objTracks){const [x,bY,w,h]=o.bbox;ctx.strokeStyle='#ffb02e';ctx.lineWidth=2;ctx.strokeRect(x,bY,w,h);ctx.fillStyle='#ffcf76';ctx.fillText(`O${o.id} ${o.class}`,x+4,Math.max(15,bY-6));}
  if(drawZoneMode){ctx.fillStyle='rgba(255,176,46,.92)';ctx.fillRect(10,c.height-36,250,26);ctx.fillStyle='#07101d';ctx.fillText('TRASCINA PER DISEGNARE LA ZONA',16,c.height-18)} ctx.restore();
}

function updateStats(){
  els.visibleCount.textContent=visible; els.occupancyCount.textContent=occupancy; els.entriesCount.textContent=entries; els.exitsCount.textContent=exits; els.peakCount.textContent=peak; els.peakTime.textContent=peakAt?new Date(peakAt).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}):'—';
  const pct=Math.min(999,Math.round(occupancy/Math.max(settings.maxOccupancy,1)*100)); els.crowdPercent.textContent=pct+'%';els.crowdMeter.style.width=Math.min(100,pct)+'%';
}
function updateFps(now){ if(now-fpsWindowStart>=1500){const fps=aiFrames/((now-fpsWindowStart)/1000);els.fpsBadge.textContent=fps.toFixed(1)+' FPS AI';aiFrames=0;fpsWindowStart=now;} }
function updateAnomalyStates(){
  const enabled={crowd:true,stationary:settings.enableStationary,fall:settings.enableFall,speed:settings.enableSpeed,zone:settings.enableZone,surge:settings.enableSurge,afterHours:settings.enableAfterHours,object:settings.enableObject,dark:settings.enableDark}; let n=0;
  document.querySelectorAll('[data-state]').forEach(el=>{const k=el.dataset.state;el.className='';if(activeStates.has(k)){el.textContent='ALERT';el.classList.add('alert');n++;}else if(enabled[k]){el.textContent='ON';el.classList.add('on')}else el.textContent='OFF';}); els.anomalyCount.textContent=n;
}
function updateAlertPanel(){
  const danger=['crowd','fall','zone','afterHours'].find(x=>activeStates.has(x)); const warning=[...activeStates][0];
  els.alertPanel.className='alert-panel card '+(danger?'danger':warning?'warn':'ok'); els.alertIcon.textContent=danger?'!':warning?'⚠':'✓'; els.alertTitle.textContent=danger?'Anomalia critica rilevata':warning?'Anomalia da verificare':'Situazione regolare'; els.alertText.textContent=danger?labelFor(danger):warning?labelFor(warning):'Nessuna anomalia attiva.';
}
function labelFor(k){return {crowd:'Capienza massima raggiunta o superata.',stationary:'Una persona risulta quasi ferma da molto tempo.',fall:'Possibile persona a terra: verificare.',speed:'Rilevato movimento insolitamente rapido.',zone:'Rilevata presenza nella zona riservata.',surge:'Numero di persone aumentato rapidamente.',afterHours:'Presenza rilevata fuori dall’orario configurato.',object:'Possibile oggetto lasciato senza persona vicina.',dark:'Inquadratura troppo scura o ostruita.'}[k]||k}

async function record(type,message,severity='info'){
  const event={ts:Date.now(),type,message,severity,visible,occupancy,entries,exits}; try{await addEvent(event)}catch{} renderEvents(); }
async function renderEvents(){
  let events=[];try{events=await getEvents(200)}catch{} if(!events.length){els.eventLog.innerHTML='<div class="empty-log">Nessun evento registrato.</div>';return}
  els.eventLog.innerHTML=events.map(e=>`<div class="event-row"><time>${new Date(e.ts).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><span class="type">${escapeHtml(e.type)}</span><span>${escapeHtml(e.message)}</span><span class="sev ${e.severity}">${e.severity.toUpperCase()}</span></div>`).join('');
}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function toast(msg){els.toast.textContent=msg;els.toast.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove('show'),2600)}

async function exportCsv(){
  const ev=await getEvents(10000);const rows=[['data','ora','tipo','gravita','messaggio','visibili','presenti_stimati','entrati','usciti'],...ev.slice().reverse().map(e=>{const d=new Date(e.ts);return[d.toLocaleDateString('it-IT'),d.toLocaleTimeString('it-IT'),e.type,e.severity,e.message,e.visible,e.occupancy,e.entries,e.exits]})];
  const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';')).join('\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='peoplelens-eventi-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function beginZoneDraw(e){ if(!drawZoneMode||!running)return; const p=canvasPoint(e);zoneStart=p;tempZone={x:p.x,y:p.y,w:0,h:0};els.overlay.setPointerCapture?.(e.pointerId); }
function moveZoneDraw(e){ if(!zoneStart||!drawZoneMode)return;const p=canvasPoint(e);tempZone=normalizeZone(zoneStart,p);drawGuides([]); }
function endZoneDraw(e){ if(!zoneStart||!drawZoneMode)return;const p=canvasPoint(e);const z=normalizeZone(zoneStart,p);zoneStart=null;tempZone=null; if(z.w<.04||z.h<.04){toast('Zona troppo piccola. Riprova.');return}settings.restrictedZone=z;settings.enableZone=true;$('#enableZone').checked=true;saveSettings();drawZoneMode=false;els.zoneBtn.textContent='▧ Disegna zona';updateZoneHelp();toast('Zona riservata salvata.'); }
function canvasPoint(e){const r=els.overlay.getBoundingClientRect();return{x:Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))}}
function normalizeZone(a,b){return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)}}

els.startBtn.addEventListener('click',startCamera);els.stopBtn.addEventListener('click',stopCamera);els.switchBtn.addEventListener('click',switchCamera);
els.zoneBtn.addEventListener('click',()=>{if(!running)return;drawZoneMode=!drawZoneMode;els.zoneBtn.textContent=drawZoneMode?'✕ Annulla zona':'▧ Disegna zona';if(!drawZoneMode){zoneStart=null;tempZone=null}});
els.overlay.addEventListener('pointerdown',beginZoneDraw);els.overlay.addEventListener('pointermove',moveZoneDraw);els.overlay.addEventListener('pointerup',endZoneDraw);els.overlay.addEventListener('pointercancel',()=>{zoneStart=null;tempZone=null});
for(const id of settingIds){$('#'+id)?.addEventListener('input',readSettings);$('#'+id)?.addEventListener('change',readSettings)}
$('#resetSettingsBtn').addEventListener('click',()=>{settings={...DEFAULT_SETTINGS};saveSettings();hydrateSettings();toast('Impostazioni ripristinate.');});
$('#exportBtn').addEventListener('click',exportCsv);$('#clearBtn').addEventListener('click',async()=>{await clearEvents();renderEvents();toast('Registro azzerato.');});
window.addEventListener('resize',resizeCanvas);window.addEventListener('beforeunload',stopTracks);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;els.installBtn.classList.remove('hidden')});els.installBtn.addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;els.installBtn.classList.add('hidden')});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));

hydrateSettings();renderEvents();loadModel();updateAnomalyStates();updateAlertPanel();
