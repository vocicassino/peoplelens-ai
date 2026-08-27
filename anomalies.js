export const DEFAULT_SETTINGS = {
  confidence: 0.55,
  detectionMode: 'balanced',
  priorityZone: null,
  maxOccupancy: 50,
  baseOccupancy: 0,
  lineA: {x: 0.08, y: 0.62},
  lineB: {x: 0.92, y: 0.62},
  entryDirection: 'forward',
  activeGateId: 'gate-1',
  gates: [
    {id:'gate-1', name:'Varco 1', enabled:true, a:{x:0.08,y:0.62}, b:{x:0.92,y:0.62}, entryDirection:'forward', allowedDirection:'forward'}
  ],
  stationarySeconds: 30,
  fallSeconds: 2.5,
  fallEscalationSeconds: 8,
  speedThreshold: 0.38,
  surgeCount: 5,
  surgeWindow: 8,
  clusterCount: 4,
  clusterSeconds: 8,
  clusterRadius: 0.17,
  objectSeconds: 45,
  trailSeconds: 15,
  zoneDwellSeconds: 20,
  loopWindowSeconds: 15,
  loopPathThreshold: 0.90,
  allowedDirection: 'forward',
  openTime: '07:00',
  closeTime: '23:00',
  enableStationary: true,
  enableFall: true,
  enableSpeed: false,
  enableZone: false,
  enableSurge: true,
  enableCluster: false,
  enableAfterHours: false,
  enableObject: false,
  enableDark: false,
  enableLoop: false,
  enableZoneDwell: false,
  enableWrongWay: false,
  soundAlerts: true,
  restrictedZone: null,
};

export function pointInZone(cx, cy, zone, width, height) {
  if (!zone) return false;
  const x = zone.x * width, y = zone.y * height, w = zone.w * width, h = zone.h * height;
  return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
}

export function isAfterHours(date, openTime, closeTime) {
  const mins = date.getHours() * 60 + date.getMinutes();
  const [oh, om] = openTime.split(':').map(Number);
  const [ch, cm] = closeTime.split(':').map(Number);
  const open = oh * 60 + om, close = ch * 60 + cm;
  if (open === close) return false;
  if (open < close) return mins < open || mins >= close;
  return mins >= close && mins < open;
}

export function fallHeuristic(track, now, thresholdSeconds) {
  const [, , w, h] = track.bbox;
  const horizontal = w / Math.max(h, 1) > 1.15;
  if (horizontal) {
    if (track.fallSince == null) track.fallSince = now;
  } else {
    track.fallSince = null;
  }
  return track.fallSince != null && (now - track.fallSince) / 1000 >= thresholdSeconds;
}

export function nearestPersonDistance(object, people, frameDiag) {
  if (!people.length) return Infinity;
  return Math.min(...people.map(p => Math.hypot(p.cx - object.cx, p.cy - object.cy) / frameDiag));
}

export function clusterSize(people, frameDiag, radiusRatio) {
  if (!people.length) return 0;
  let best = 1;
  for (const p of people) {
    let n = 0;
    for (const q of people) if (Math.hypot(p.cx-q.cx,p.cy-q.cy)/frameDiag <= radiusRatio) n++;
    best = Math.max(best,n);
  }
  return best;
}
