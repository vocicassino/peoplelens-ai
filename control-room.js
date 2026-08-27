const $=s=>document.querySelector(s);
const els={
  form:$('#roomForm'),endpoint:$('#roomEndpoint'),room:$('#roomCode'),token:$('#roomToken'),state:$('#roomState'),grid:$('#nodesGrid'),refresh:$('#refreshRoomBtn'),toast:$('#roomToast'),
  nodes:$('#kpiNodes'),nodesTotal:$('#kpiNodesTotal'),visible:$('#kpiVisible'),occupancy:$('#kpiOccupancy'),alerts:$('#kpiAlerts'),cars:$('#kpiCars'),twoWheels:$('#kpiTwoWheels')
};
let cfg=loadCfg(),timer=null,busy=false;

function loadCfg(){try{return{...JSON.parse(localStorage.getItem('peoplelensRoomV3')||'{}')}}catch{return{}}}
function saveCfg(){localStorage.setItem('peoplelensRoomV3',JSON.stringify(cfg))}
function hydrate(){els.endpoint.value=cfg.endpoint||'';els.room.value=cfg.room||'';els.token.value=cfg.token||''}
function toast(msg){els.toast.textContent=msg;els.toast.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove('show'),2600)}
function setState(kind,text){els.state.textContent=text;els.state.className='pill '+(kind==='ok'?'ok':kind==='danger'?'danger':'warn')}
function esc(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function fmtAge(ts){const s=Math.max(0,Math.round((Date.now()-Number(ts||0))/1000));return s<60?`${s}s fa`:`${Math.floor(s/60)}m fa`}
function alertName(k){return{crowd:'Sovraffollamento',stationary:'Permanenza',fall:'Caduta',speed:'Movimento rapido',zone:'Zona riservata',surge:'Aumento rapido',cluster:'Assembramento',afterHours:'Fuori orario',object:'Oggetto',dark:'Camera scura',loop:'Movimento ripetitivo',zoneDwell:'Sosta zona',wrongWay:'Direzione vietata'}[k]||k}
async function fetchNodes(){
  if(busy)return;busy=true;
  try{
    cfg.endpoint=els.endpoint.value.trim().replace(/\/+$/,'');cfg.room=els.room.value.trim();cfg.token=els.token.value;saveCfg();
    if(!cfg.endpoint||!cfg.room||!cfg.token)throw new Error('Configurazione incompleta');
    const res=await fetch(`${cfg.endpoint}/api/nodes?room=${encodeURIComponent(cfg.room)}`,{headers:{Authorization:`Bearer ${cfg.token}`},cache:'no-store'});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);
    render(data.nodes||[]);setState('ok','Online');
  }catch(err){setState('danger','Errore');if(!els.grid.querySelector('.node-card'))els.grid.innerHTML=`<div class="empty-log">Connessione non riuscita: ${esc(err.message||err)}</div>`;}
  finally{busy=false}
}
function render(nodes){
  const online=nodes.filter(n=>n.online);
  const sum=(arr,key)=>arr.reduce((a,n)=>a+Number(n.payload?.stats?.[key]||0),0);
  els.nodes.textContent=online.length;els.nodesTotal.textContent=`${nodes.length} registrati`;
  els.visible.textContent=sum(online,'visible');els.occupancy.textContent=sum(online,'occupancy');
  els.cars.textContent=sum(online,'cars');els.twoWheels.textContent=sum(online,'motorcycles')+sum(online,'bicycles');
  els.alerts.textContent=online.reduce((a,n)=>a+(n.payload?.alerts?.length||0),0);
  if(!nodes.length){els.grid.innerHTML='<div class="empty-log">Nessun nodo registrato in questa stanza.</div>';return}
  els.grid.innerHTML=nodes.map(n=>{
    const p=n.payload||{},st=p.stats||{},src=p.source||{},alerts=Array.isArray(p.alerts)?p.alerts:[],gates=Array.isArray(p.gates)?p.gates:[];
    return `<article class="node-card ${n.online?'':'offline'}">
      <div class="node-head"><div class="node-name"><b>${esc(n.nodeName||n.nodeId)}</b><small>${esc(src.label||src.type||'Sorgente')} · ${fmtAge(n.lastSeen)}</small></div><span class="node-online ${n.online?'yes':''}">${n.online?'ONLINE':'OFFLINE'}</span></div>
      <div class="node-stats"><div><small>VISIBILI</small><strong>${Number(st.visible||0)}</strong></div><div><small>PRESENTI</small><strong>${Number(st.occupancy||0)}</strong></div><div><small>IN</small><strong>${Number(st.entries||0)}</strong></div><div><small>OUT</small><strong>${Number(st.exits||0)}</strong></div></div>
      <div class="node-vehicles">🚗 ${Number(st.cars||0)} &nbsp; 🏍️ ${Number(st.motorcycles||0)} &nbsp; 🚲 ${Number(st.bicycles||0)} &nbsp; 🙂 ${Number(st.faces||0)}</div>
      <div class="node-alerts">${alerts.length?alerts.map(a=>`<span>⚠ ${esc(alertName(a))}</span>`).join(''):'<span class="clear">✓ Regolare</span>'}</div>
      ${gates.length?`<div class="node-gates"><details><summary>${gates.length} varchi · dettagli</summary>${gates.map(g=>`<div class="gate-line"><b>${esc(g.name||'Varco')}</b><span>👤 ${Number(g.people?.entries||0)}/${Number(g.people?.exits||0)} · 🚗 ${Number(g.vehicles?.car?.entries||0)}/${Number(g.vehicles?.car?.exits||0)}</span></div>`).join('')}</details></div>`:''}
    </article>`;
  }).join('');
}
function startPolling(){clearInterval(timer);fetchNodes();timer=setInterval(fetchNodes,2000)}
els.form.addEventListener('submit',e=>{e.preventDefault();startPolling();toast('Control Room collegata.')});
els.refresh.addEventListener('click',fetchNodes);
window.addEventListener('beforeunload',()=>clearInterval(timer));
hydrate();if(cfg.endpoint&&cfg.room&&cfg.token)startPolling();
