import {parseCommand, decodePolyline, formatInstruction, shouldAdvanceStep} from '../src/navigation';
import {classifyZone, countObjects, detectionCue, DetectionStabilizer, type Detection} from '../src/detections';
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
test('classifies zone boundaries and counts a frame only', () => {
  expect(classifyZone({...box(0), width: 2 / 3})).toBe('centre');
  expect(classifyZone({...box(0.1), width: 0.1})).toBe('left');
  expect(classifyZone({...box(0.8), width: 0.1})).toBe('right');
  expect(countObjects([box(0.1), box(0.2), box(0.8)])).toEqual({'person:left': 2, 'person:right': 1});
  const stabilizer = new DetectionStabilizer();
  expect(stabilizer.update([box(0.1), box(0.2), box(0.8)])).toBeNull();
  expect(stabilizer.update([box(0.1), box(0.2), box(0.8)])).toBe('Three people detected ahead in the camera view');
  expect(detectionCue([box(0.45, 'chair')])).toBe('Chair detected in the centre');
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
  manager.enqueue('Current speech', 1, 'a', 0);
  manager.enqueue('Chair detected', 1, 'b', 0);
  manager.enqueue('Turn left', 3, 'c', 0);
  expect(spoken).toEqual(['Current speech']);
  completions.shift()!(); await Promise.resolve();
  expect(spoken).toEqual(['Current speech', 'Turn left']);
  completions.shift()!(); await Promise.resolve();
  expect(spoken).toEqual(['Current speech', 'Turn left', 'Chair detected']);
  completions.shift()!(); await Promise.resolve();
});
test('decodes route and formats instructions', () => {
  expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toHaveLength(3);
  expect(formatInstruction('Turn <b>left</b> &amp; continue')).toBe('Turn left & continue');
  const point = {latitude: 31.63, longitude: 74.87};
  expect(shouldAdvanceStep(point, {point, instruction: 'Turn', distanceMeters: 10}, 10)).toBe(true);
  expect(shouldAdvanceStep(point, {point, instruction: 'Turn', distanceMeters: 10}, 60)).toBe(false);
});
