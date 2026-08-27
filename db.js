const DB_NAME='peoplelens-ai'; const DB_VERSION=1; const STORE='events';
function openDb(){
  return new Promise((resolve,reject)=>{ const req=indexedDB.open(DB_NAME,DB_VERSION); req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'id',autoIncrement:true}); }; req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); });
}
export async function addEvent(event){ const db=await openDb(); return new Promise((resolve,reject)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).add(event); tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); }); }
export async function getEvents(limit=250){ const db=await openDb(); return new Promise((resolve,reject)=>{ const tx=db.transaction(STORE,'readonly'); const req=tx.objectStore(STORE).getAll(); req.onsuccess=()=>resolve(req.result.sort((a,b)=>b.ts-a.ts).slice(0,limit)); req.onerror=()=>reject(req.error); }); }
export async function clearEvents(){ const db=await openDb(); return new Promise((resolve,reject)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); }); }
