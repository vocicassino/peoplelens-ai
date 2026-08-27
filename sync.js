const safeText=(v,max=80)=>String(v??'').trim().slice(0,max);

export function getOrCreateNodeId(){
  const key='peoplelensNodeIdV3';
  let id=localStorage.getItem(key);
  if(!id){
    const rand=(crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`);
    id=`node-${rand}`;
    localStorage.setItem(key,id);
  }
  return id;
}

export class SyncClient{
  constructor({onStatus}={}){
    this.onStatus=onStatus||(()=>{});
    this.timer=null;
    this.config=null;
    this.payloadProvider=null;
    this.busy=false;
    this.lastOk=0;
  }
  configure(config,payloadProvider){
    this.config={...config,nodeId:config.nodeId||getOrCreateNodeId()};
    this.payloadProvider=payloadProvider;
    this.restart();
  }
  restart(){
    this.stop();
    if(!this.config?.enabled){
      this.onStatus({state:'idle',message:'Sincronizzazione disattivata'});
      return;
    }
    if(!this.isComplete()){
      this.onStatus({state:'idle',message:'Completa endpoint, stanza e chiave'});
      return;
    }
    this.onStatus({state:'testing',message:'Connessione…'});
    this.push(true);
    this.timer=setInterval(()=>this.push(false),1500);
  }
  stop(){if(this.timer){clearInterval(this.timer);this.timer=null;}}
  isComplete(){
    const c=this.config||{};
    return /^https?:\/\//i.test(c.endpoint||'') && safeText(c.room,40) && safeText(c.token,200);
  }
  async test(){
    if(!this.isComplete())throw new Error('Configurazione incompleta');
    return this.push(true);
  }
  async push(force=false){
    if(this.busy||!this.config?.enabled||!this.isComplete()||!this.payloadProvider)return false;
    this.busy=true;
    try{
      const c=this.config;
      const base=c.endpoint.replace(/\/+$/,'');
      const payload={
        room:safeText(c.room,40),
        nodeId:safeText(c.nodeId,90),
        nodeName:safeText(c.nodeName||'Nodo PeopleLens',40),
        sentAt:Date.now(),
        ...this.payloadProvider()
      };
      const res=await fetch(`${base}/api/push`,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${c.token}`},
        body:JSON.stringify(payload),
        cache:'no-store'
      });
      if(!res.ok){
        let msg=`HTTP ${res.status}`;
        try{const j=await res.json();if(j?.error)msg=j.error}catch{}
        throw new Error(msg);
      }
      this.lastOk=Date.now();
      this.onStatus({state:'online',message:'Online · aggiornato ora'});
      return true;
    }catch(err){
      this.onStatus({state:'error',message:`Errore Sync · ${err.message||err}`});
      if(force)throw err;
      return false;
    }finally{this.busy=false}
  }
}
