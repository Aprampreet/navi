import type {SceneEvent, Zone} from './detections';
import type {TrackedObject} from './tracking';

export type HapticPattern = number[];
const cameraPatterns: Record<Zone, HapticPattern> = {
  left: [0, 130],
  centre: [0, 115, 85, 115, 85, 115],
  right: [0, 115, 85, 115],
};
const routePatterns = {
  left: [0, 340],
  right: [0, 290, 130, 290],
  other: [0, 180, 105, 180, 105, 180],
} as const;
const approachPattern = [0, 135, 95, 135, 95, 135, 95, 135];
const readingPattern = [0, 210, 100, 90];
const confirmationPattern = [0, 130, 105, 130];
const errorPattern = [0, 300, 130, 300, 130, 300];

export function routeDirection(instruction: string): 'left' | 'right' | 'other' {
  if (/\b(left|anticlockwise|counterclockwise)\b/i.test(instruction)) return 'left';
  if (/\b(right|clockwise)\b/i.test(instruction)) return 'right';
  return 'other';
}

/** Spatial haptics describe image position; apparent approach has a separate cautious pattern. */
export function cameraZoneForEvent(
  event: Pick<SceneEvent, 'key'>, objects: ReadonlyArray<TrackedObject>,
): Zone | null {
  if (event.key.startsWith('approach:') || event.key.startsWith('recede:')) return null;
  if (/^scene:[^:]+:centre$/.test(event.key)) return 'centre';
  const motion = event.key.match(/^motion:[^:]+:(left|right)$/);
  if (motion) return motion[1] as Zone;
  const scene = event.key.match(/^scene:([^:]+):(?:appear|count:\d+)$/);
  if (!scene) return null;
  const visible = objects.filter(object => object.label === scene[1] && object.missedFrames === 0);
  return visible.find(object => object.zone === 'centre')?.zone ||
    visible.find(object => object.zone === 'left')?.zone || visible[0]?.zone || null;
}

/** Short, non-repeating Android vibration patterns with route priority and camera cooldown. */
export class HapticManager {
  enabled = true;
  paused = false;
  commandListening = false;
  private lastCameraAt = -Infinity;
  private lastCameraZone: Zone | null = null;
  private routeHoldUntil = 0;
  private lastReadingAt = -Infinity;
  private lastApproachAt = -Infinity;
  private lastByKey = new Map<string, number>();

  constructor(private vibrate: (pattern: HapticPattern) => void,
    private cancelVibration: () => void) {}

  camera(key: string, zone: Zone, now = Date.now()): boolean {
    if (!this.enabled || this.paused || this.commandListening || now < this.routeHoldUntil) return false;
    if (now - (this.lastByKey.get(key) ?? -Infinity) < 9000) return false;
    const centreTakesPriority = zone === 'centre' && this.lastCameraZone !== 'centre';
    if (now - this.lastCameraAt < 3000 && !centreTakesPriority) return false;
    this.cancelVibration();
    this.vibrate(cameraPatterns[zone]);
    this.lastByKey.set(key, now);
    this.lastCameraAt = now;
    this.lastCameraZone = zone;
    return true;
  }

  approach(key: string, now = Date.now()): boolean {
    if (!this.enabled || this.paused || this.commandListening || now < this.routeHoldUntil ||
        now - this.lastApproachAt < 10000 || now - (this.lastByKey.get(key) ?? -Infinity) < 20000) return false;
    this.cancelVibration();
    this.vibrate(approachPattern);
    this.lastApproachAt = now;
    this.lastByKey.set(key, now);
    return true;
  }

  reading(key: string, now = Date.now()): boolean {
    if (!this.enabled || this.paused || this.commandListening || now < this.routeHoldUntil ||
        now - this.lastReadingAt < 8000 || now - (this.lastByKey.get(key) ?? -Infinity) < 30000) return false;
    this.cancelVibration();
    this.vibrate(readingPattern);
    this.lastReadingAt = now;
    this.lastByKey.set(key, now);
    return true;
  }

  confirmed(now = Date.now()): boolean {
    if (!this.enabled) return false;
    this.cancelVibration();
    this.vibrate(confirmationPattern);
    this.routeHoldUntil = now + 1000;
    return true;
  }

  error(key: string, now = Date.now()): boolean {
    if (!this.enabled || now - (this.lastByKey.get(`error:${key}`) ?? -Infinity) < 20000) return false;
    this.cancelVibration();
    this.vibrate(errorPattern);
    this.lastByKey.set(`error:${key}`, now);
    return true;
  }

  route(instruction: string, now = Date.now()): boolean {
    if (!this.enabled) return false;
    this.cancelVibration();
    this.vibrate([...routePatterns[routeDirection(instruction)]]);
    this.routeHoldUntil = now + 1500;
    return true;
  }

  voice(stage: 'wake' | 'heard'): boolean {
    if (!this.enabled) return false;
    this.vibrate(stage === 'wake' ? [0, 85] : [0, 65]);
    return true;
  }

  reset() {
    this.cancelVibration();
    this.lastByKey.clear();
    this.lastCameraAt = -Infinity;
    this.lastCameraZone = null;
    this.routeHoldUntil = 0;
    this.lastReadingAt = -Infinity;
    this.lastApproachAt = -Infinity;
  }
}
