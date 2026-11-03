export type Zone = 'left' | 'centre' | 'right';
export type Detection = {label: string; confidence: number; x: number; y: number;
  width: number; height: number};

export const SUPPORTED_LABELS = ['person', 'bicycle', 'car', 'motorcycle', 'bus', 'dog', 'chair'] as const;
export type ObjectLabel = typeof SUPPORTED_LABELS[number];
const labelSet = new Set<string>(SUPPORTED_LABELS);
const plurals: Record<ObjectLabel, string> = {
  person: 'people', bicycle: 'bicycles', car: 'cars', motorcycle: 'motorcycles',
  bus: 'buses', dog: 'dogs', chair: 'chairs',
};
const numberWords = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const zones: Zone[] = ['left', 'centre', 'right'];
type ZoneCounts = Record<Zone, number>;
type ClassCounts = Record<ObjectLabel, ZoneCounts>;
export type SceneEvent = {key: string; text: string; priority: 1 | 3};
export type SceneUpdate = {events: SceneEvent[]; counts: Record<ObjectLabel, number>;
  hasStableObjects: boolean};

function emptyZones(): ZoneCounts { return {left: 0, centre: 0, right: 0}; }
function emptyCounts(): ClassCounts {
  return Object.fromEntries(SUPPORTED_LABELS.map(label => [label, emptyZones()])) as ClassCounts;
}
function total(counts: ZoneCounts): number { return counts.left + counts.centre + counts.right; }
function same(a: ZoneCounts, b: ZoneCounts): boolean {
  return zones.every(zone => a[zone] === b[zone]);
}
function number(count: number): string { return numberWords[count] || String(count); }
function noun(label: ObjectLabel, count: number): string {
  return count === 1 ? label : plurals[label];
}
function location(counts: ZoneCounts): Zone {
  return counts.centre ? 'centre' : counts.left ? 'left' : 'right';
}
function locationWords(zone: Zone): string {
  return zone === 'centre' ? 'in the centre' : `on the ${zone}`;
}

export function classifyZone(d: Detection): Zone {
  const centre = d.x + d.width / 2;
  return centre < 1 / 3 ? 'left' : centre > 2 / 3 ? 'right' : 'centre';
}

export function countFrame(items: Detection[]): ClassCounts {
  const counts = emptyCounts();
  for (const item of items) {
    if (!labelSet.has(item.label) || !Number.isFinite(item.confidence) || item.confidence < 0.45 ||
        !Number.isFinite(item.x) || !Number.isFinite(item.width) || item.width <= 0) continue;
    counts[item.label as ObjectLabel][classifyZone(item)]++;
  }
  return counts;
}

export function countObjects(items: Detection[]): Record<string, number> {
  const byZone = countFrame(items);
  const counts: Record<string, number> = {};
  for (const label of SUPPORTED_LABELS) for (const zone of zones) {
    if (byZone[label][zone]) counts[`${label}:${zone}`] = byZone[label][zone];
  }
  return counts;
}

export function describeScene(counts: Record<ObjectLabel, number>): string {
  return SUPPORTED_LABELS.filter(label => counts[label] > 0)
    .map(label => `${counts[label]} ${noun(label, counts[label])}`).join(' · ');
}

function appearance(label: ObjectLabel, counts: ZoneCounts): SceneEvent {
  const n = total(counts);
  if (label === 'person') {
    return {key: `scene:${label}:appear`, text: `${number(n)} ${noun(label, n)} visible ahead`, priority: 1};
  }
  const zone = location(counts);
  return {key: `scene:${label}:appear`,
    text: n === 1 ? `${label[0].toUpperCase()}${label.slice(1)} detected ${locationWords(zone)}` :
      `${number(n)} ${noun(label, n)} visible ${locationWords(zone)}`,
    priority: zone === 'centre' ? 3 : 1};
}

function centreEntry(label: ObjectLabel, counts: ZoneCounts): SceneEvent {
  const n = counts.centre;
  return {key: `scene:${label}:centre`,
    text: n === 1 ? `${label[0].toUpperCase()}${label.slice(1)} detected in the centre` :
      `${number(n)} ${noun(label, n)} now in the centre`, priority: 3};
}

function countChange(label: ObjectLabel, counts: ZoneCounts): SceneEvent {
  const n = total(counts);
  return {key: `scene:${label}:count:${n}`,
    text: `${number(n)} ${noun(label, n)} visible ahead`, priority: 1};
}

type ClassState = {candidate: ZoneCounts; stable: ZoneCounts; frames: number};

/** Emits only transitions between scenes confirmed in consecutive camera frames. */
export class SceneTracker {
  private state = new Map<ObjectLabel, ClassState>();
  constructor(private requiredFrames = 3) {
    if (requiredFrames < 2) throw new Error('Scene smoothing requires at least two frames');
    this.reset();
  }
  reset() {
    this.state.clear();
    for (const label of SUPPORTED_LABELS) {
      this.state.set(label, {candidate: emptyZones(), stable: emptyZones(), frames: 0});
    }
  }
  update(items: Detection[]): SceneUpdate {
    const frame = countFrame(items);
    const events: SceneEvent[] = [];
    const counts = {} as Record<ObjectLabel, number>;
    for (const label of SUPPORTED_LABELS) {
      const state = this.state.get(label)!;
      const next = frame[label];
      if (same(next, state.candidate)) state.frames++;
      else { state.candidate = {...next}; state.frames = 1; }
      if (state.frames >= this.requiredFrames && !same(next, state.stable)) {
        const previous = state.stable;
        state.stable = {...next};
        const before = total(previous);
        const after = total(next);
        if (before === 0 && after > 0) events.push(appearance(label, next));
        else if (before > 0 && previous.centre === 0 && next.centre > 0) {
          events.push(centreEntry(label, next));
        } else if (after > 0 && Math.abs(after - before) >= 2) {
          events.push(countChange(label, next));
        }
      }
      counts[label] = total(state.stable);
    }
    events.sort((a, b) => b.priority - a.priority);
    return {events, counts, hasStableObjects: SUPPORTED_LABELS.some(label => counts[label] > 0)};
  }
}
