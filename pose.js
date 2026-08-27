const CONNECTIONS = [
  ['left_shoulder','right_shoulder'],['left_shoulder','left_elbow'],['left_elbow','left_wrist'],
  ['right_shoulder','right_elbow'],['right_elbow','right_wrist'],['left_shoulder','left_hip'],
  ['right_shoulder','right_hip'],['left_hip','right_hip'],['left_hip','left_knee'],['left_knee','left_ankle'],
  ['right_hip','right_knee'],['right_knee','right_ankle']
];

export async function createPoseDetector() {
  const pd = window.poseDetection;
  if (!pd) throw new Error('poseDetection non disponibile');
  const config = {
    modelType: pd.movenet.modelType.MULTIPOSE_LIGHTNING,
    enableSmoothing: true,
    enableTracking: true,
    multiPoseMaxDimension: 256
  };
  if (pd.TrackerType?.BoundingBox) config.trackerType = pd.TrackerType.BoundingBox;
  return pd.createDetector(pd.SupportedModels.MoveNet, config);
}

export function poseBounds(pose, minScore = 0.25) {
  const pts = (pose?.keypoints || []).filter(k => (k.score ?? 0) >= minScore);
  if (pts.length < 4) return null;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys), x2 = Math.max(...xs), y2 = Math.max(...ys);
  return { x, y, w: x2 - x, h: y2 - y, cx: (x + x2) / 2, cy: (y + y2) / 2 };
}

export function matchPosesToTracks(tracks, poses, frameWidth, frameHeight) {
  for (const t of tracks) t.pose = null;
  if (!tracks.length || !poses?.length) return;
  const diag = Math.hypot(frameWidth, frameHeight) || 1;
  const candidates = [];
  poses.forEach((pose, pi) => {
    const b = poseBounds(pose);
    if (!b) return;
    tracks.forEach((t, ti) => {
      const d = Math.hypot(b.cx - t.cx, b.cy - t.cy) / diag;
      const [x,y,w,h] = t.bbox;
      const inside = b.cx >= x-w*.25 && b.cx <= x+w*1.25 && b.cy >= y-h*.25 && b.cy <= y+h*1.25;
      if (inside || d < 0.18) candidates.push({pi,ti,d});
    });
  });
  candidates.sort((a,b)=>a.d-b.d);
  const usedP = new Set(), usedT = new Set();
  for (const c of candidates) {
    if (usedP.has(c.pi) || usedT.has(c.ti)) continue;
    tracks[c.ti].pose = poses[c.pi];
    usedP.add(c.pi); usedT.add(c.ti);
  }
}

function kpMap(pose) {
  const map = new Map();
  for (const k of pose?.keypoints || []) if (k.name) map.set(k.name, k);
  return map;
}
function good(k, s=.28){ return k && (k.score ?? 0) >= s; }
function mid(a,b){ return {x:(a.x+b.x)/2,y:(a.y+b.y)/2}; }

export function poseFallEvidence(pose) {
  if (!pose) return {lying:false, confidence:0, reason:'pose assente'};
  const m = kpMap(pose);
  const ls=m.get('left_shoulder'), rs=m.get('right_shoulder'), lh=m.get('left_hip'), rh=m.get('right_hip');
  const la=m.get('left_ankle'), ra=m.get('right_ankle'), nose=m.get('nose');
  let score = 0, tests = 0;

  if (good(ls)&&good(rs)&&good(lh)&&good(rh)) {
    const sh=mid(ls,rs), hip=mid(lh,rh); const dx=Math.abs(hip.x-sh.x), dy=Math.abs(hip.y-sh.y);
    const torsoLen=Math.hypot(dx,dy);
    if (torsoLen>10) { tests++; if (dx > dy*1.15) score += 1; }
    const shoulderSpan=Math.hypot(ls.x-rs.x,ls.y-rs.y);
    const hipSpan=Math.hypot(lh.x-rh.x,lh.y-rh.y);
    if (shoulderSpan>10 && hipSpan>10) { tests++; if (Math.abs(sh.y-hip.y) < Math.max(shoulderSpan,hipSpan)*0.75) score += 1; }
  }

  const b=poseBounds(pose,.2);
  if (b && b.w>15 && b.h>15) { tests++; if (b.w/b.h > 1.05) score += 1; }

  const ankles=[la,ra].filter(k=>good(k));
  if (good(nose) && ankles.length) {
    const ax=ankles.reduce((s,k)=>s+k.x,0)/ankles.length, ay=ankles.reduce((s,k)=>s+k.y,0)/ankles.length;
    tests++; if (Math.abs(ax-nose.x) > Math.abs(ay-nose.y)*1.05) score += 1;
  }

  const confidence = tests ? score/tests : 0;
  return {lying: tests>=2 && confidence>=0.66, confidence, reason:`${score}/${tests} indicatori postura`};
}

export function drawPose(ctx, pose, options={}) {
  const minScore=options.minScore ?? .32;
  const m=kpMap(pose);
  ctx.save();
  ctx.lineWidth=options.lineWidth ?? 3;
  ctx.strokeStyle=options.strokeStyle ?? '#5ed0ff';
  ctx.fillStyle=options.pointStyle ?? '#ffffff';
  ctx.globalAlpha=.9;
  for (const [a,b] of CONNECTIONS) {
    const p=m.get(a), q=m.get(b); if(!good(p,minScore)||!good(q,minScore)) continue;
    ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
  }
  for (const k of pose?.keypoints || []) {
    if(!good(k,minScore)) continue; ctx.beginPath();ctx.arc(k.x,k.y,Math.max(2,ctx.canvas.width/380),0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}
