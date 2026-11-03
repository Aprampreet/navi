export type Zone = 'left' | 'centre' | 'right';
export type Detection = {label: string; confidence: number; x: number; y: number;
  width: number; height: number};
export function classifyZone(d: Detection): Zone {
  const centre = d.x + d.width / 2;
  return centre < 1 / 3 ? 'left' : centre > 2 / 3 ? 'right' : 'centre';
}
export function countObjects(items: Detection[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (item.confidence < 0.45) continue;
    const key = `${item.label}:${classifyZone(item)}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
export function detectionCue(items: Detection[]): string | null {
  const people = items.filter(d => d.label === 'person' && d.confidence >= 0.45);
  if (people.length) {
    const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
    const count = words[people.length] || String(people.length);
    return `${count} ${people.length === 1 ? 'person' : 'people'} detected ahead in the camera view`;
  }
  const first = items.find(d => d.confidence >= 0.45);
  if (!first) return null;
  const zone = classifyZone(first);
  return `${first.label[0].toUpperCase()}${first.label.slice(1)} detected ${zone === 'centre' ? 'in the centre' : `on the ${zone}`}`;
}

export class DetectionStabilizer {
  private previous = '';
  private repeats = 0;
  update(items: Detection[]): string | null {
    const cue = detectionCue(items) || '';
    this.repeats = cue && cue === this.previous ? this.repeats + 1 : 1;
    this.previous = cue;
    return cue && this.repeats >= 2 ? cue : null;
  }
}
