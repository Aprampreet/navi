import {CorridorTracker, corridorSummary, parseCorridorFrame,
  type CorridorFrame, type CorridorZone} from '../src/corridor';

const zone = (name: CorridorZone['name'], status: CorridorZone['status'],
  surface: CorridorZone['surface'] = 'OTHER', obstacles: string[] = []): CorridorZone =>
  ({name, status, surface, confidence: 0.7, obstacles});

const frame = (zones: CorridorZone[]): CorridorFrame => ({zones, summary: '', timestamp: 1,
  latencyMs: 80, meanBrightness: 0.5, contrast: 0.2});

describe('corridor analysis', () => {
  test('describes possible pedestrian surface without a safety claim', () => {
    const text = corridorSummary([
      zone('LEFT', 'POTENTIAL_GROUND', 'PEDESTRIAN_SURFACE'),
      zone('CENTRE', 'UNKNOWN'), zone('RIGHT', 'UNKNOWN'),
    ]);
    expect(text).toBe('Possible pedestrian surface visible on the left.');
    expect(text.toLowerCase()).not.toMatch(/\bsafe\b|\bclear\b/);
  });

  test('obstruction in the centre takes precedence over ground evidence', () => {
    expect(corridorSummary([
      zone('LEFT', 'POTENTIAL_GROUND', 'PEDESTRIAN_SURFACE'),
      zone('CENTRE', 'OBSTRUCTED', 'PEDESTRIAN_SURFACE', ['person']),
      zone('RIGHT', 'UNKNOWN'),
    ])).toBe('People detected ahead.');
  });

  test('road, stairs, vegetation and poor visibility remain unassessed', () => {
    for (const surface of ['ROAD', 'STAIRS', 'VEGETATION', 'POOR_VISIBILITY'] as const)
      expect(corridorSummary([
        zone('LEFT', 'UNKNOWN', surface), zone('CENTRE', 'UNKNOWN', surface),
        zone('RIGHT', 'UNKNOWN', surface),
      ])).toBe('Unable to assess the walking surface.');
  });

  test('requires temporal persistence and stays quiet when unchanged', () => {
    const tracker = new CorridorTracker(2, 12000);
    const reading = frame([
      zone('LEFT', 'UNKNOWN'), zone('CENTRE', 'POTENTIAL_GROUND', 'PEDESTRIAN_SURFACE'),
      zone('RIGHT', 'UNKNOWN'),
    ]);
    expect(tracker.update(reading, 1000)).toBeNull();
    expect(tracker.update(reading, 3000)?.announcement)
      .toBe('Possible pedestrian surface visible ahead.');
    expect(tracker.update(reading, 5000)?.announcement).toBeNull();
  });

  test('deduplicates a recently repeated scene after a flip', () => {
    const tracker = new CorridorTracker(1, 12000);
    const possible = frame([zone('LEFT', 'POTENTIAL_GROUND', 'PEDESTRIAN_SURFACE'),
      zone('CENTRE', 'UNKNOWN'), zone('RIGHT', 'UNKNOWN')]);
    const unknown = frame([zone('LEFT', 'UNKNOWN'), zone('CENTRE', 'UNKNOWN'), zone('RIGHT', 'UNKNOWN')]);
    expect(tracker.update(possible, 1000)?.announcement).toBeTruthy();
    expect(tracker.update(unknown, 2000)?.announcement).toBeTruthy();
    expect(tracker.update(possible, 3000)?.announcement).toBeNull();
  });

  test('rejects malformed native events', () => {
    expect(parseCorridorFrame({zones: []})).toBeNull();
    expect(parseCorridorFrame({zones: [
      zone('LEFT', 'UNKNOWN'), zone('CENTRE', 'UNKNOWN'), zone('RIGHT', 'UNKNOWN'),
    ], latencyMs: 1})?.zones).toHaveLength(3);
  });
});
