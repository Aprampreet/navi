export type CorridorName = 'LEFT' | 'CENTRE' | 'RIGHT';
export type CorridorStatus = 'POTENTIAL_GROUND' | 'OBSTRUCTED' | 'UNKNOWN';
export type SurfaceKind = 'PEDESTRIAN_SURFACE' | 'ROAD' | 'STAIRS' |
  'VEGETATION' | 'OTHER' | 'POOR_VISIBILITY';

export type CorridorZone = {
  name: CorridorName;
  status: CorridorStatus;
  surface: SurfaceKind;
  confidence: number;
  obstacles: string[];
};

export type CorridorFrame = {
  zones: CorridorZone[];
  summary: string;
  timestamp: number;
  latencyMs: number;
  meanBrightness: number;
  contrast: number;
};

export type CorridorUpdate = {
  frame: CorridorFrame;
  changed: boolean;
  announcement: string | null;
};

const names: CorridorName[] = ['LEFT', 'CENTRE', 'RIGHT'];
const statuses: CorridorStatus[] = ['POTENTIAL_GROUND', 'OBSTRUCTED', 'UNKNOWN'];
const surfaces: SurfaceKind[] = ['PEDESTRIAN_SURFACE', 'ROAD', 'STAIRS',
  'VEGETATION', 'OTHER', 'POOR_VISIBILITY'];

export function parseCorridorFrame(value: unknown): CorridorFrame | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.zones)) return null;
  const zones = raw.zones.map(zone => {
    if (!zone || typeof zone !== 'object') return null;
    const item = zone as Record<string, unknown>;
    if (!names.includes(item.name as CorridorName) ||
      !statuses.includes(item.status as CorridorStatus) ||
      !surfaces.includes(item.surface as SurfaceKind)) return null;
    return {
      name: item.name as CorridorName,
      status: item.status as CorridorStatus,
      surface: item.surface as SurfaceKind,
      confidence: Number.isFinite(item.confidence) ? Number(item.confidence) : 0,
      obstacles: Array.isArray(item.obstacles) ?
        item.obstacles.filter(label => typeof label === 'string') as string[] : [],
    };
  });
  if (zones.some(zone => zone === null) || zones.length !== 3 ||
    names.some(name => !zones.some(zone => zone?.name === name))) return null;
  return {
    zones: zones as CorridorZone[],
    summary: typeof raw.summary === 'string' ? raw.summary : 'Unable to assess the walking surface.',
    timestamp: Number.isFinite(raw.timestamp) ? Number(raw.timestamp) : Date.now(),
    latencyMs: Number.isFinite(raw.latencyMs) ? Number(raw.latencyMs) : 0,
    meanBrightness: Number.isFinite(raw.meanBrightness) ? Number(raw.meanBrightness) : 0,
    contrast: Number.isFinite(raw.contrast) ? Number(raw.contrast) : 0,
  };
}

export function corridorSummary(zones: CorridorZone[]): string {
  const centre = zones.find(zone => zone.name === 'CENTRE');
  if (centre?.status === 'OBSTRUCTED' && centre.obstacles.includes('person'))
    return 'People detected ahead.';
  const potential = zones.find(zone => zone.status === 'POTENTIAL_GROUND');
  if (potential) {
    const direction = potential.name === 'LEFT' ? 'on the left' :
      potential.name === 'RIGHT' ? 'on the right' : 'ahead';
    return `Possible pedestrian surface visible ${direction}.`;
  }
  return 'Unable to assess the walking surface.';
}

function signature(frame: CorridorFrame): string {
  return frame.zones.map(zone => `${zone.name}:${zone.status}:${zone.surface}:` +
    zone.obstacles.slice().sort().join(',')).join('|');
}

/** Requires repeated agreement before publishing a corridor state and suppresses
 * flip-flop announcements. This is deliberately separate from YOLO tracking. */
export class CorridorTracker {
  private candidate = '';
  private candidateCount = 0;
  private stable = '';
  private lastSpoken = new Map<string, number>();

  constructor(private persistenceFrames = 2, private cooldownMs = 12000) {}

  update(frame: CorridorFrame, now = Date.now()): CorridorUpdate | null {
    const next = signature(frame);
    if (next === this.candidate) this.candidateCount++;
    else { this.candidate = next; this.candidateCount = 1; }
    if (this.candidateCount < this.persistenceFrames) return null;
    const changed = next !== this.stable;
    this.stable = next;
    const summary = corridorSummary(frame.zones);
    const normalized = {...frame, summary};
    if (!changed) return {frame: normalized, changed: false, announcement: null};
    const last = this.lastSpoken.get(next) ?? -Infinity;
    const announcement = now - last >= this.cooldownMs ? summary : null;
    if (announcement) this.lastSpoken.set(next, now);
    return {frame: normalized, changed: true, announcement};
  }

  reset() {
    this.candidate = '';
    this.candidateCount = 0;
    this.stable = '';
    this.lastSpoken.clear();
  }
}
