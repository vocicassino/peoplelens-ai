function cors(env,origin='*'){
  const allowed=String(env.ALLOWED_ORIGIN||'*').trim();
  const value=allowed==='*'?'*':(origin===allowed?origin:allowed);
  return{
    'Access-Control-Allow-Origin':value,
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Max-Age':'86400',
    'Cache-Control':'no-store'
  };
}
function json(data,status=200,env={},origin='*'){
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...cors(env,origin)}});
}
function authorized(req,env){
  const expected=String(env.ROOM_TOKEN||'');
  if(!expected)return false;
  const auth=req.headers.get('Authorization')||'';
  return auth===`Bearer ${expected}`;
}
const text=(v,max=120)=>String(v??'').trim().slice(0,max);

export default{
  async fetch(request,env){
    const url=new URL(request.url),origin=request.headers.get('Origin')||'*';
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(env,origin)});
    if(url.pathname==='/api/health')return json({ok:true,service:'peoplelens-sync',version:'3.0'},200,env,origin);
    if(!authorized(request,env))return json({error:'Chiave stanza non valida'},401,env,origin);

    if(url.pathname==='/api/push'&&request.method==='POST'){
      let body;
      try{body=await request.json()}catch{return json({error:'JSON non valido'},400,env,origin)}
      const room=text(body.room,40),nodeId=text(body.nodeId,90),nodeName=text(body.nodeName||'Nodo PeopleLens',40);
      if(!room||!nodeId)return json({error:'room e nodeId obbligatori'},400,env,origin);
      const payload={
        appVersion:text(body.appVersion,20),
        running:!!body.running,
        source:body.source&&typeof body.source==='object'?body.source:{},
        stats:body.stats&&typeof body.stats==='object'?body.stats:{},
        vehicleTotals:body.vehicleTotals&&typeof body.vehicleTotals==='object'?body.vehicleTotals:{},
        alerts:Array.isArray(body.alerts)?body.alerts.slice(0,30).map(x=>text(x,50)):[],
        gates:Array.isArray(body.gates)?body.gates.slice(0,8):[]
      };
      const now=Date.now();
      await env.DB.prepare(`INSERT INTO nodes(room,node_id,node_name,payload,last_seen)
        VALUES(?1,?2,?3,?4,?5)
        ON CONFLICT(room,node_id) DO UPDATE SET node_name=excluded.node_name,payload=excluded.payload,last_seen=excluded.last_seen`)
        .bind(room,nodeId,nodeName,JSON.stringify(payload),now).run();
      return json({ok:true,serverTime:now},200,env,origin);
    }

    if(url.pathname==='/api/nodes'&&request.method==='GET'){
      const room=text(url.searchParams.get('room'),40);
      if(!room)return json({error:'room obbligatoria'},400,env,origin);
      const {results=[]}=await env.DB.prepare('SELECT node_id,node_name,payload,last_seen FROM nodes WHERE room=?1 ORDER BY last_seen DESC LIMIT 100').bind(room).all();
      const now=Date.now();
      const nodes=results.map(r=>{
        let payload={};try{payload=JSON.parse(r.payload||'{}')}catch{}
        return{nodeId:r.node_id,nodeName:r.node_name,payload,lastSeen:Number(r.last_seen||0),online:now-Number(r.last_seen||0)<10000};
      });
      return json({ok:true,room,serverTime:now,nodes},200,env,origin);
    }

    if(url.pathname==='/api/cleanup'&&request.method==='POST'){
      const cutoff=Date.now()-7*24*60*60*1000;
      const info=await env.DB.prepare('DELETE FROM nodes WHERE last_seen<?1').bind(cutoff).run();
      return json({ok:true,deleted:info.meta?.changes||0},200,env,origin);
    }

    return json({error:'Endpoint non trovato'},404,env,origin);
  }
};
