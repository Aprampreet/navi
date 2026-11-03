import type {ObjectLabel, Zone} from './detections';
import type {TrackedObject, TrackingUpdate, TrackSample} from './tracking';

export type ApproachState = 'POSSIBLY_APPROACHING' | 'POSSIBLY_RECEDING' |
  'APPARENTLY_STABLE' | 'UNKNOWN';
export type ApproachObservation = {id: number; label: ObjectLabel; zone: Zone;
  state: ApproachState; reason: string; logScaleChange: number | null;
  durationMs: number; timestamp: number};
export type ApproachEvent = {key: string; text: string; priority: 1 | 2};
export type ApproachTransition = {id: number; label: ObjectLabel; from: ApproachState;
  to: ApproachState | 'LOST'; reason: string; timestamp: number};
export type ApproachUpdate = {observations: ApproachObservation[]; events: ApproachEvent[];
  transitions: ApproachTransition[]};

type Evidence = {change: number; durationMs: number; positive: number; negative: number;
  unstable: boolean};
type StateMemory = {candidate: ApproachState; frames: number; stable: ApproachState;
  label: ObjectLabel; timestamp: number};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function evidence(history: ReadonlyArray<TrackSample>): Evidence | null {
  const samples = history.slice(-6);
  if (samples.length < 4) return null;
  const durationMs = samples[samples.length - 1].timestamp - samples[0].timestamp;
  if (durationMs < 1200 || durationMs > 5000) return null;
  if (samples.some((sample, i) => i > 0 &&
    (sample.timestamp <= samples[i - 1].timestamp ||
      sample.timestamp - samples[i - 1].timestamp > 1500))) return null;
  const areas = samples.map(sample => sample.area);
  if (areas.some(area => !Number.isFinite(area) || area <= 0)) return null;
  const early = median(areas.slice(0, 2));
  const late = median(areas.slice(-2));
  const changes = areas.slice(1).map((area, i) => Math.log(area / areas[i]));
  return {change: Math.log(late / early), durationMs,
    positive: changes.filter(change => change > 0.025).length,
    negative: changes.filter(change => change < -0.025).length,
    unstable: Math.max(...changes.map(Math.abs)) > 0.5};
}

function stableReference(target: TrackedObject, other: TrackedObject): boolean {
  if (target.id === other.id || other.missedFrames > 0 || other.trackingConfidence < 0.7) return false;
  const targetLast = target.history[target.history.length - 1];
  const samples = other.history.slice(-6);
  if (samples.length < 4 || Math.abs(samples[samples.length - 1].timestamp - targetLast.timestamp) > 750) {
    return false;
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const scale = Math.log(last.area / first.area);
  const shift = Math.hypot(last.centre.x - first.centre.x, last.centre.y - first.centre.y);
  return Math.abs(scale) < 0.12 && shift < 0.09;
}

function classify(target: TrackedObject, update: TrackingUpdate): ApproachObservation {
  const last = target.history[target.history.length - 1];
  const base = {id: target.id, label: target.label, zone: target.zone, timestamp: last.timestamp};
  const unknown = (reason: string, data: Evidence | null = null): ApproachObservation => ({
    ...base, state: 'UNKNOWN', reason, logScaleChange: data?.change ?? null,
    durationMs: data?.durationMs ?? 0,
  });
  if (target.missedFrames > 0) return unknown('temporarily_missing');
  if (target.trackingConfidence < 0.7 || last.confidence < 0.55) return unknown('weak_tracking');
  const data = evidence(target.history);
  if (!data) return unknown('insufficient_history');
  if (update.cameraMotion.likely || target.history.slice(-3).some(item => item.cameraMotion?.likely)) {
    return unknown('camera_motion', data);
  }
  if (data.unstable || (data.positive > 1 && data.negative > 1)) {
    return unknown('box_fluctuation', data);
  }
  if (Math.abs(data.change) < 0.12 && data.positive <= 2 && data.negative <= 2) {
    return {...base, state: 'APPARENTLY_STABLE', reason: 'stable_image_scale',
      logScaleChange: data.change, durationMs: data.durationMs};
  }
  const references = update.objects.filter(other => stableReference(target, other)).length;
  if (references < 2) return unknown('insufficient_stable_references', data);
  if (data.change >= 0.28 && data.positive >= 3 && data.negative <= 1) {
    return {...base, state: 'POSSIBLY_APPROACHING', reason: 'relative_image_expansion',
      logScaleChange: data.change, durationMs: data.durationMs};
  }
  if (data.change <= -0.28 && data.negative >= 3 && data.positive <= 1) {
    return {...base, state: 'POSSIBLY_RECEDING', reason: 'relative_image_contraction',
      logScaleChange: data.change, durationMs: data.durationMs};
  }
  return unknown('insufficient_consistent_change', data);
}

/** Image-scale evidence only. A camera can move at constant speed without a usable IMU cue. */
export class ApproachEstimator {
  private memory = new Map<number, StateMemory>();
  reset() { this.memory.clear(); }

  update(tracking: TrackingUpdate): ApproachUpdate {
    const observations = tracking.objects.map(object => classify(object, tracking));
    const present = new Set(observations.map(observation => observation.id));
    const transitions: ApproachTransition[] = [];
    for (const [id, previous] of this.memory) if (!present.has(id)) {
      transitions.push({id, label: previous.label, from: previous.stable, to: 'LOST',
        reason: 'track_lost', timestamp: tracking.timestamp});
      this.memory.delete(id);
    }
    const events: ApproachEvent[] = [];
    for (const observation of observations) {
      const previous = this.memory.get(observation.id) ||
        {candidate: 'UNKNOWN' as ApproachState, frames: 0, stable: 'UNKNOWN' as ApproachState,
          label: observation.label, timestamp: observation.timestamp};
      if (observation.state === previous.candidate) previous.frames++;
      else { previous.candidate = observation.state; previous.frames = 1; }
      if (previous.frames >= 2 && previous.stable !== observation.state) {
        transitions.push({id: observation.id, label: observation.label, from: previous.stable,
          to: observation.state, reason: observation.reason, timestamp: observation.timestamp});
        previous.stable = observation.state;
        if (observation.zone === 'centre' && observation.state === 'POSSIBLY_APPROACHING') {
          events.push({key: `approach:${observation.id}`, priority: 2,
            text: `${capitalize(observation.label)} appears to be getting closer`});
        } else if (observation.zone === 'centre' && observation.state === 'POSSIBLY_RECEDING') {
          events.push({key: `recede:${observation.id}`, priority: 1,
            text: `${capitalize(observation.label)} appears to be moving away`});
        }
      }
      previous.timestamp = observation.timestamp;
      this.memory.set(observation.id, previous);
    }
    return {observations, events, transitions};
  }
}

function capitalize(text: string): string { return text[0].toUpperCase() + text.slice(1); }
