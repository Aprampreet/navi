export type TextBlock = {text: string; x: number; y: number; width: number; height: number};
export type Reading = {spoken: string; areas: {position: 'left' | 'ahead' | 'right'; text: string}[]};

export function describeReading(blocks: TextBlock[]): Reading {
  const valid = blocks.filter(block => block && typeof block.text === 'string' &&
    block.text.trim().length >= 2 && [block.x, block.y, block.width, block.height].every(Number.isFinite) &&
    block.width > 0 && block.height > 0);
  const groups: TextBlock[][] = [];
  for (const block of [...valid].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const centre = block.x + block.width / 2;
    const group = groups.find(items => {
      const last = items[items.length - 1];
      const lastCentre = last.x + last.width / 2;
      const gap = block.y - (last.y + last.height);
      return Math.abs(centre - lastCentre) < 0.23 && gap >= -0.06 && gap < 0.12;
    });
    if (group) group.push(block); else groups.push([block]);
  }
  const areas = groups.map(group => {
    const left = Math.min(...group.map(block => block.x));
    const right = Math.max(...group.map(block => block.x + block.width));
    const centre = (left + right) / 2;
    return {position: (centre < 1 / 3 ? 'left' : centre > 2 / 3 ? 'right' : 'ahead') as
      'left' | 'ahead' | 'right', text: group.map(block => block.text.trim().replace(/\s+/g, ' ')).join(' ')};
  }).filter(area => area.text.length >= 3).slice(0, 3);
  if (!areas.length) return {spoken: 'I could not read any clear text in this view. Try holding the camera steady and closer to the text.', areas};
  if (areas.length === 1) return {spoken: `Text ${areas[0].position === 'ahead' ? 'ahead' : `on the ${areas[0].position}`} reads ${areas[0].text}.`, areas};
  const count = ['zero', 'one', 'two', 'three'][areas.length];
  return {spoken: `I can read ${count} text areas. ${areas.map(area =>
    `${area.position === 'ahead' ? 'Ahead' : `On the ${area.position}`}: ${area.text}.`).join(' ')}`, areas};
}

/** Confirms text over two captures and remembers recent announcements. */
export class AmbientReadingTracker {
  private previous = new Map<string, number>();
  private announced = new Map<string, number>();
  update(blocks: TextBlock[], now: number): string[] {
    const areas = describeReading(blocks.filter(block => block.width >= 0.08 &&
      block.height >= 0.018 && block.text.trim().length >= 4)).areas;
    const next = new Map<string, number>();
    const cues: string[] = [];
    for (const area of areas) {
      const key = `${area.position}:${area.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
      const count = (this.previous.get(key) || 0) + 1;
      next.set(key, count);
      if (count >= 2 && now - (this.announced.get(key) ?? -Infinity) >= 120000) {
        this.announced.set(key, now);
        cues.push(`Visible text ${area.position === 'ahead' ? 'ahead' : `on the ${area.position}`} reads ${area.text}.`);
      }
    }
    this.previous = next;
    for (const [key, at] of this.announced) if (now - at > 120000) this.announced.delete(key);
    return cues.slice(0, 2);
  }
  reset() { this.previous.clear(); this.announced.clear(); }
}
