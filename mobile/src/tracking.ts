import {classifyZone, SUPPORTED_LABELS, type Detection, type ObjectLabel,
  type SceneEvent, type Zone} from './detections';

export type CameraMotionEstimate = {horizontalShift: number; logScale: number;
  referenceCount: number; likely: boolean};
export type TrackSample = {timestamp: number; label: ObjectLabel;
  box: {x: number; y: number; width: number; height: number};
  centre: {x: number; y: number}; area: number; confidence: number;
  trackingConfidence: number; cameraMotion: CameraMotionEstimate | null; zone: Zone};
type Track = {id: number; label: ObjectLabel; box: Detection; hits: number; missed: number;
  history: TrackSample[]; stableZone: Zone; candidateZone: Zone; zoneFrames: number;
  trackingConfidence: number};
export type TrackedObject = {id: number; label: ObjectLabel; box: Detection;
  zone: Zone; missedFrames: number; trackingConfidence: number;
  history: ReadonlyArray<TrackSample>};
export type TrackMovement = {id: number; label: ObjectLabel; from: Zone; to: Zone;
  direction: 'left' | 'right'; relativeMotion: boolean};
export type TrackingUpdate = {timestamp: number; objects: TrackedObject[]; movements: TrackMovement[];
  cameraMotionLikely: boolean; cameraMotion: CameraMotionEstimate};

const supported = new Set<string>(SUPPORTED_LABELS);
const zoneOrder: Record<Zone, number> = {left: 0, centre: 1, right: 2};
const plurals: Record<ObjectLabel, string> = {person: 'people', bicycle: 'bicycles', car: 'cars',
  motorcycle: 'motorcycles', bus: 'buses', dog: 'dogs', chair: 'chairs'};
const numberWords = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five'];

export function movementCues(movements: TrackMovement[]): SceneEvent[] {
  const groups = new Map<string, TrackMovement[]>();
  for (const movement of movements) {
    const key = `${movement.label}:${movement.from}:${movement.to}:${movement.relativeMotion}`;
    groups.set(key, [...(groups.get(key) || []), movement]);
  }
  return [...groups.values()].map(group => {
    const first = group[0];
    const n = group.length;
    const count = numberWords[n] || String(n);
    const label = n === 1 ? first.label : plurals[first.label];
    const place = first.to === 'centre' ? 'in the centre' : `on the ${first.to}`;
    let text: string;
    if (first.relativeMotion) {
      text = `${n === 1 ? `A ${label}` : `${count} ${label}`} ${n === 1 ? 'is' : 'are'} ` +
        `moving from ${first.from} toward ${first.to} in the camera view`;
    } else if (first.to === 'centre') {
      text = n === 1 ? `${label[0].toUpperCase()}${label.slice(1)} detected in the centre` :
        `${count} ${label} now in the centre`;
    } else {
      text = n === 1 ? `${label[0].toUpperCase()}${label.slice(1)} now visible ${place}` :
        `${count} ${label} now visible ${place}`;
    }
    return {key: first.to === 'centre' ? `scene:${first.label}:centre` :
      `motion:${first.label}:${first.to}`, text, priority: 3 as const};
  });
}

function centre(box: Detection): {x: number; y: number} {
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}
function sample(box: Detection, timestamp: number, trackingConfidence: number): TrackSample {
  return {timestamp, label: box.label as ObjectLabel,
    box: {x: box.x, y: box.y, width: box.width, height: box.height},
    centre: centre(box), area: box.width * box.height, confidence: box.confidence,
    trackingConfidence, cameraMotion: null, zone: classifyZone(box)};
}
function iou(a: Detection, b: Detection): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}
function valid(box: Detection): boolean {
  return supported.has(box.label) && Number.isFinite(box.confidence) && box.confidence >= 0.45 &&
    [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
    box.width > 0 && box.height > 0;
}

/** Lightweight class-aware association for the existing two-frames-per-second detector. */
export class ObjectTracker {
  private tracks: Track[] = [];
  private nextId = 1;
  private lastTimestamp = 0;

  reset() { this.tracks = []; this.nextId = 1; this.lastTimestamp = 0; }

  update(input: Detection[], timestamp = Date.now()): TrackingUpdate {
    if (this.lastTimestamp && (timestamp < this.lastTimestamp || timestamp - this.lastTimestamp > 3000)) {
      this.reset();
    }
    this.lastTimestamp = timestamp;
    const boxes = input.filter(valid);
    const candidates: Array<{track: number; box: number; score: number}> = [];
    for (let t = 0; t < this.tracks.length; t++) {
      const track = this.tracks[t];
      const last = track.history[track.history.length - 1];
      const before = track.history[track.history.length - 2];
      const step = track.missed + 1;
      const predictedX = last.centre.x + (before ?
        Math.max(-0.15, Math.min(0.15, last.centre.x - before.centre.x)) * step : 0);
      const predictedY = last.centre.y + (before ?
        Math.max(-0.15, Math.min(0.15, last.centre.y - before.centre.y)) * step : 0);
      for (let b = 0; b < boxes.length; b++) {
        const box = boxes[b];
        if (box.label !== track.label) continue;
        const point = centre(box);
        const distance = Math.hypot(point.x - predictedX, point.y - predictedY);
        const overlap = iou(track.box, box);
        const scale = Math.max(box.width / track.box.width, track.box.width / box.width,
          box.height / track.box.height, track.box.height / box.height);
        if (scale > 2.5 || (overlap < 0.1 && distance > 0.23 + 0.06 * track.missed)) continue;
        candidates.push({track: t, box: b,
          score: overlap * 0.65 + Math.max(0, 1 - distance / 0.35) * 0.35 - track.missed * 0.04});
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const matchedTracks = new Set<number>();
    const matchedBoxes = new Set<number>();
    const shifts: Array<{track: Track; dx: number; logScale: number}> = [];
    const transitions: Array<{track: Track; from: Zone; to: Zone; dx: number}> = [];
    for (const pair of candidates) {
      if (matchedTracks.has(pair.track) || matchedBoxes.has(pair.box)) continue;
      matchedTracks.add(pair.track); matchedBoxes.add(pair.box);
      const track = this.tracks[pair.track];
      const box = boxes[pair.box];
      const point = centre(box);
      const previous = track.history[track.history.length - 1];
      const dx = point.x - previous.centre.x;
      const logScale = Math.log((box.width * box.height) / previous.area);
      shifts.push({track, dx, logScale});
      const zone = classifyZone(box);
      track.box = box; track.hits++; track.missed = 0;
      track.trackingConfidence = Math.min(0.98, 0.55 + Math.min(track.hits, 5) * 0.05 +
        Math.max(0, pair.score) * 0.15);
      track.history.push(sample(box, timestamp, track.trackingConfidence));
      if (track.history.length > 6) track.history.shift();
      if (zone === track.candidateZone) track.zoneFrames++;
      else { track.candidateZone = zone; track.zoneFrames = 1; }
      if (track.zoneFrames >= 3 && zone !== track.stableZone) {
        transitions.push({track, from: track.stableZone, to: zone, dx});
        track.stableZone = zone;
      }
    }
    for (let t = 0; t < this.tracks.length; t++) {
      if (!matchedTracks.has(t)) {
        this.tracks[t].missed++;
        this.tracks[t].trackingConfidence *= 0.7;
        this.tracks[t].zoneFrames = 0;
      }
    }
    this.tracks = this.tracks.filter(track => track.missed < 3);
    for (let b = 0; b < boxes.length; b++) {
      if (matchedBoxes.has(b)) continue;
      const box = boxes[b];
      if (this.tracks.some(track => track.label === box.label && track.missed === 0 &&
        iou(track.box, box) > 0.7)) continue;
      const zone = classifyZone(box);
      this.tracks.push({id: this.nextId++, label: box.label as ObjectLabel, box, hits: 1,
        missed: 0, history: [sample(box, timestamp, 0.55)], stableZone: zone,
        candidateZone: zone, zoneFrames: 1, trackingConfidence: 0.55});
    }
    const shiftValues = shifts.map(item => item.dx);
    const commonShift = shiftValues.length >= 3 ? median(shiftValues) : 0;
    const coherentTranslation = shiftValues.length >= 3 && Math.abs(commonShift) >= 0.035 &&
      shifts.filter(item => Math.abs(item.dx - commonShift) <= 0.025).length >=
        Math.ceil(shifts.length * 0.75);
    const scaleValues = shifts.map(item => item.logScale);
    const commonScale = scaleValues.length >= 3 ? median(scaleValues) : 0;
    const coherentScale = scaleValues.length >= 3 && Math.abs(commonScale) >= 0.035 &&
      shifts.filter(item => Math.abs(item.logScale - commonScale) <= 0.04).length >=
        Math.ceil(shifts.length * 0.75);
    const cameraMotion: CameraMotionEstimate = {horizontalShift: commonShift,
      logScale: commonScale, referenceCount: shifts.length,
      likely: coherentTranslation || coherentScale};
    for (const shift of shifts) {
      shift.track.history[shift.track.history.length - 1].cameraMotion = cameraMotion;
    }
    const movements = transitions.map(item => ({id: item.track.id, label: item.track.label,
      from: item.from, to: item.to,
      direction: (zoneOrder[item.to] > zoneOrder[item.from] ? 'right' : 'left') as 'left' | 'right',
      relativeMotion: shiftValues.length >= 3 && !cameraMotion.likely &&
        Math.abs(item.dx - commonShift) >= 0.035}));
    return {timestamp, objects: this.tracks.filter(track => track.hits >= 2 && track.missed < 3).map(track => ({
      id: track.id, label: track.label, box: track.box, zone: track.stableZone,
      missedFrames: track.missed, trackingConfidence: track.trackingConfidence,
      history: [...track.history],
    })), movements: cameraMotion.likely ? [] : movements,
    cameraMotionLikely: cameraMotion.likely, cameraMotion};
  }
}
