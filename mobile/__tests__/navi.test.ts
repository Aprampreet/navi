import {parseCommand, decodePolyline, formatInstruction, shouldAdvanceStep} from '../src/navigation';
import {classifyZone, countFrame, countObjects, describeScene, SceneTracker, type Detection} from '../src/detections';
import {AlertManager} from '../src/alerts';

const box = (x: number, label = 'person'): Detection =>
  ({x, y: 0.1, width: 0.1, height: 0.2, label, confidence: 0.9});

test('extracts and handles spoken commands', () => {
  expect(parseCommand("Let's go to Heritage Street.")).toEqual({type: 'destination', destination: 'Heritage Street'});
  expect(parseCommand('Navigate to Golden Temple')).toEqual({type: 'destination', destination: 'Golden Temple'});
  expect(parseCommand('navigate me to Golden Temple')).toEqual({type: 'destination', destination: 'Golden Temple'});
  expect(parseCommand('go to Heritage Street Amritsar')).toEqual({type: 'destination', destination: 'Heritage Street Amritsar'});
  expect(parseCommand('stop navigation')).toEqual({type: 'stop'});
  expect(parseCommand('repeat instruction')).toEqual({type: 'repeat'});
  expect(parseCommand('pause obstacle alerts')).toEqual({type: 'pause'});
  expect(parseCommand('hello')).toEqual({type: 'unknown'});
});
test('classifies zone boundaries and counts every supported class in one frame', () => {
  expect(classifyZone({...box(0), width: 2 / 3})).toBe('centre');
  expect(classifyZone({...box(0.1), width: 0.1})).toBe('left');
  expect(classifyZone({...box(0.8), width: 0.1})).toBe('right');
  const labels = ['person', 'bicycle', 'car', 'motorcycle', 'bus', 'dog', 'chair'];
  const items = labels.map(label => box(0.45, label)).concat([
    box(0.1), box(0.8), {...box(0.45, 'chair'), confidence: 0.2}, box(0.45, 'tree'),
  ]);
  const counts = countFrame(items);
  expect(counts.person).toEqual({left: 1, centre: 1, right: 1});
  for (const label of labels.slice(1)) expect(counts[label as keyof typeof counts].centre).toBe(1);
  expect(countObjects(items)['chair:centre']).toBe(1);
  expect(describeScene({person: 3, bicycle: 0, car: 0, motorcycle: 0, bus: 0,
    dog: 0, chair: 1})).toBe('3 people · 1 chair');
});
test('confirms a new scene over three frames and stays quiet while it is unchanged', () => {
  const tracker = new SceneTracker();
  const people = [box(0.1), box(0.45), box(0.8)];
  expect(tracker.update(people).events).toEqual([]);
  expect(tracker.update(people).events).toEqual([]);
  expect(tracker.update(people).events).toEqual([
    {key: 'scene:person:appear', text: 'Three people visible ahead', priority: 1},
  ]);
  for (let i = 0; i < 15; i++) expect(tracker.update(people).events).toEqual([]);
  expect(tracker.update([box(0.45, 'chair')]).events).toEqual([]);
  expect(tracker.update(people).events).toEqual([]);
});
test('announces a supported object entering the centre after stable left detection', () => {
  const tracker = new SceneTracker();
  for (let i = 0; i < 3; i++) tracker.update([box(0.1, 'chair')]);
  expect(tracker.update([box(0.45, 'chair')]).events).toEqual([]);
  expect(tracker.update([box(0.45, 'chair')]).events).toEqual([]);
  expect(tracker.update([box(0.45, 'chair')]).events).toEqual([
    {key: 'scene:chair:centre', text: 'Chair detected in the centre', priority: 3},
  ]);
  expect(tracker.update([box(0.45, 'chair')]).events).toEqual([]);
});
test('announces significant count changes and treats brief missing detections as noise', () => {
  const tracker = new SceneTracker();
  for (let i = 0; i < 3; i++) tracker.update([box(0.1)]);
  expect(tracker.update([]).hasStableObjects).toBe(true);
  expect(tracker.update([box(0.1)]).events).toEqual([]);
  const people = [box(0.1), box(0.2), box(0.8)];
  for (let i = 0; i < 2; i++) expect(tracker.update(people).events).toEqual([]);
  expect(tracker.update(people).events).toEqual([
    {key: 'scene:person:count:3', text: 'Three people visible ahead', priority: 1},
  ]);
  for (let i = 0; i < 3; i++) tracker.update([]);
  expect(tracker.update([]).hasStableObjects).toBe(false);
  for (let i = 0; i < 2; i++) expect(tracker.update([box(0.1)]).events).toEqual([]);
  expect(tracker.update([box(0.1)]).events[0].key).toBe('scene:person:appear');
});
test('deduplicates alerts using cooldown', async () => {
  const spoken: string[] = [];
  const manager = new AlertManager(async text => { spoken.push(text); }, 5000);
  expect(manager.enqueue('Bicycle detected on the left', 1, 'bike', 1000)).toBe(true);
  expect(manager.enqueue('Bicycle detected on the left', 1, 'bike', 2000)).toBe(false);
  await Promise.resolve();
  expect(spoken).toEqual(['Bicycle detected on the left']);
  expect(manager.enqueue('Bicycle detected on the left', 1, 'bike', 7000)).toBe(true);
});
test('queues route cues ahead of pending detection cues without overlap', async () => {
  const spoken: string[] = [];
  const completions: Array<() => void> = [];
  const manager = new AlertManager(text => new Promise<void>(resolve => {
    spoken.push(text); completions.push(resolve);
  }));
  manager.enqueue('Current speech', 1, 'a', 0, 'camera');
  manager.enqueue('Chair detected', 1, 'b', 0, 'camera');
  manager.enqueue('Turn left', 4, 'c', 0, 'navigation');
  expect(spoken).toEqual(['Current speech']);
  completions.shift()!(); await Promise.resolve();
  expect(spoken).toEqual(['Current speech', 'Turn left']);
  completions.shift()!(); await Promise.resolve();
  expect(spoken).toEqual(['Current speech', 'Turn left', 'Chair detected']);
  completions.shift()!(); await Promise.resolve();
});
test('pause, mute and camera clearing suppress queued scene speech without dropping route speech', async () => {
  const spoken: string[] = [];
  const completions: Array<() => void> = [];
  const manager = new AlertManager(text => new Promise<void>(resolve => {
    spoken.push(text); completions.push(resolve);
  }));
  manager.enqueue('Speaking now', 2, 'first', 0, 'system');
  manager.enqueue('Chair detected', 3, 'chair', 0, 'camera');
  manager.enqueue('Turn right', 4, 'turn', 0, 'navigation');
  manager.paused = true;
  manager.clearCamera();
  expect(manager.enqueue('Dog detected', 1, 'dog', 0, 'camera')).toBe(false);
  completions.shift()!(); await Promise.resolve();
  expect(spoken).toEqual(['Speaking now', 'Turn right']);
  manager.muted = true;
  expect(manager.enqueue('Another turn', 4, 'next', 0, 'navigation')).toBe(false);
  completions.shift()!(); await Promise.resolve();
});
test('drops a camera cue that became stale while a route instruction was spoken', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(10000);
  try {
    const spoken: string[] = [];
    const completions: Array<() => void> = [];
    const manager = new AlertManager(text => new Promise<void>(resolve => {
      spoken.push(text); completions.push(resolve);
    }));
    manager.enqueue('Current instruction', 3, 'current', 10000, 'navigation');
    manager.enqueue('Chair detected', 3, 'chair', 10000, 'camera');
    clock.mockReturnValue(15001);
    completions.shift()!(); await Promise.resolve();
    expect(spoken).toEqual(['Current instruction']);
  } finally { clock.mockRestore(); }
});
test('bounds pending speech while keeping a route turn ahead of camera cues', async () => {
  const spoken: string[] = [];
  const completions: Array<() => void> = [];
  const manager = new AlertManager(text => new Promise<void>(resolve => {
    spoken.push(text); completions.push(resolve);
  }));
  manager.enqueue('Already speaking', 1, 'active', 0, 'camera');
  for (let i = 0; i < 16; i++) manager.enqueue(`Camera ${i}`, 1, `camera-${i}`, 0, 'camera');
  manager.enqueue('Turn left now', 4, 'turn', 0, 'navigation');
  completions.shift()!(); await Promise.resolve();
  expect(spoken[1]).toBe('Turn left now');
  for (let i = 0; i < 8; i++) {
    completions.shift()!(); await Promise.resolve();
  }
  expect(spoken).toHaveLength(9);
});
test('decodes route and formats instructions', () => {
  expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toHaveLength(3);
  expect(formatInstruction('Turn <b>left</b> &amp; continue')).toBe('Turn left & continue');
  const point = {latitude: 31.63, longitude: 74.87};
  expect(shouldAdvanceStep(point, {point, instruction: 'Turn', distanceMeters: 10}, 10)).toBe(true);
  expect(shouldAdvanceStep(point, {point, instruction: 'Turn', distanceMeters: 10}, 60)).toBe(false);
});
