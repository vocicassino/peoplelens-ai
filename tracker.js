export class PersonTracker {
  constructor(options = {}) {
    this.maxAgeMs = options.maxAgeMs ?? 1800;
    this.maxDistanceRatio = options.maxDistanceRatio ?? 0.13;
    this.nextId = 1;
    this.tracks = new Map();
    this.endedTracks = [];
  }

  reset() {
    this.nextId = 1;
    this.tracks.clear();
    this.endedTracks = [];
  }

  update(detections, frameWidth, frameHeight, now = performance.now()) {
    const diag = Math.hypot(frameWidth, frameHeight) || 1;
    const maxDistance = diag * this.maxDistanceRatio;
    const unmatchedTrackIds = new Set(this.tracks.keys());
    const candidates = [];

    for (let di = 0; di < detections.length; di++) {
      const d = detections[di];
      const [x, y, w, h] = d.bbox;
      const cx = x + w / 2;
      const cy = y + h / 2;
      for (const [id, t] of this.tracks) {
        const dist = Math.hypot(cx - t.cx, cy - t.cy);
        if (dist <= maxDistance) candidates.push({ di, id, dist });
      }
    }

    candidates.sort((a, b) => a.dist - b.dist);
    const usedDetections = new Set();
    const assignments = [];
    for (const c of candidates) {
      if (usedDetections.has(c.di) || !unmatchedTrackIds.has(c.id)) continue;
      usedDetections.add(c.di);
      unmatchedTrackIds.delete(c.id);
      assignments.push(c);
    }

    const output = [];
    for (const { di, id } of assignments) {
      const d = detections[di];
      const [x, y, w, h] = d.bbox;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const t = this.tracks.get(id);
      const dt = Math.max((now - t.lastSeen) / 1000, 0.001);
      const rawSpeed = Math.hypot(cx - t.cx, cy - t.cy) / diag / dt;
      const speed = t.speed == null ? rawSpeed : (t.speed * 0.65 + rawSpeed * 0.35);
      const moved = Math.hypot(cx - t.cx, cy - t.cy) / diag;
      const stationarySince = moved > 0.012 ? now : (t.stationarySince ?? now);
      const updated = {
        ...t,
        bbox: d.bbox,
        score: d.score,
        prevCx: t.cx,
        prevCy: t.cy,
        cx, cy,
        speed,
        stationarySince,
        lastSeen: now,
        ageMs: now - t.firstSeen,
        trail: [...(t.trail || []), {x:cx,y:cy,ts:now}].filter(p=>now-p.ts<=32000).slice(-180),
      };
      this.tracks.set(id, updated);
      output.push(updated);
    }

    for (let di = 0; di < detections.length; di++) {
      if (usedDetections.has(di)) continue;
      const d = detections[di];
      const [x, y, w, h] = d.bbox;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const id = this.nextId++;
      const t = {
        id,
        bbox: d.bbox,
        score: d.score,
        cx, cy, prevCx: cx, prevCy: cy,
        speed: 0,
        firstSeen: now,
        lastSeen: now,
        stationarySince: now,
        ageMs: 0,
        lineSide: null,
        lastCrossAt: 0,
        fallSince: null,
        zoneSince: null,
        trail: [{x:cx,y:cy,ts:now}],
        zoneDwellSince: null,
        loopSince: null,
        wrongWayUntil: 0,
      };
      this.tracks.set(id, t);
      output.push(t);
    }

    for (const [id, t] of this.tracks) {
      if (now - t.lastSeen > this.maxAgeMs) { this.endedTracks.push({...t, endedAt: now}); this.tracks.delete(id); }
    }

    return output;
  }

  drainEnded() { const out=this.endedTracks.slice(); this.endedTracks.length=0; return out; }
}

export class ObjectTracker {
  constructor(options = {}) {
    this.maxAgeMs = options.maxAgeMs ?? 2500;
    this.maxDistanceRatio = options.maxDistanceRatio ?? 0.09;
    this.nextId = 1;
    this.tracks = new Map();
  }
  reset(){ this.nextId = 1; this.tracks.clear(); }
  update(detections, frameWidth, frameHeight, now = performance.now()) {
    const diag = Math.hypot(frameWidth, frameHeight) || 1;
    const maxDist = diag * this.maxDistanceRatio;
    const unused = new Set(this.tracks.keys());
    const result=[];
    for (const d of detections) {
      const [x,y,w,h]=d.bbox; const cx=x+w/2, cy=y+h/2;
      let bestId=null,best=Infinity;
      for(const id of unused){ const t=this.tracks.get(id); if(t.class!==d.class) continue; const dist=Math.hypot(cx-t.cx,cy-t.cy); if(dist<best&&dist<=maxDist){best=dist;bestId=id;} }
      if(bestId!=null){
        unused.delete(bestId); const t=this.tracks.get(bestId); const moved=Math.hypot(cx-t.cx,cy-t.cy)/diag;
        const updated={...t,bbox:d.bbox,score:d.score,cx,cy,lastSeen:now,stationarySince:moved>0.01?now:t.stationarySince};
        this.tracks.set(bestId,updated); result.push(updated);
      } else {
        const id=this.nextId++; const t={id,class:d.class,bbox:d.bbox,score:d.score,cx,cy,firstSeen:now,lastSeen:now,stationarySince:now}; this.tracks.set(id,t); result.push(t);
      }
    }
    for(const [id,t] of this.tracks){ if(now-t.lastSeen>this.maxAgeMs) this.tracks.delete(id); }
    return result;
  }
}
