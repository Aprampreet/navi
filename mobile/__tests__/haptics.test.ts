import {cameraZoneForEvent, HapticManager, routeDirection} from '../src/haptics';
import type {TrackedObject} from '../src/tracking';

test('route turns and camera zones use distinct patterns', () => {
  const patterns: number[][] = [];
  const manager = new HapticManager(pattern => patterns.push(pattern), () => {});
  manager.camera('chair-left', 'left', 1000);
  manager.camera('chair-centre', 'centre', 1100);
  manager.route('Turn left at the street', 2000);
  manager.route('Turn right onto the walkway', 4000);
  expect(patterns).toEqual([
    [0, 130], [0, 115, 85, 115, 85, 115], [0, 340], [0, 290, 130, 290],
  ]);
  expect(routeDirection('Continue straight')).toBe('other');
});

test('camera cues are deduplicated, suppressed during a turn, pause and voice listening', () => {
  const patterns: number[][] = [];
  const manager = new HapticManager(pattern => patterns.push(pattern), () => {});
  expect(manager.camera('chair', 'left', 1000)).toBe(true);
  expect(manager.camera('chair', 'left', 7000)).toBe(false);
  expect(manager.route('Turn right', 8000)).toBe(true);
  expect(manager.camera('person', 'centre', 8500)).toBe(false);
  manager.paused = true;
  expect(manager.camera('person', 'centre', 10000)).toBe(false);
  manager.paused = false; manager.commandListening = true;
  expect(manager.camera('person', 'centre', 10000)).toBe(false);
  manager.commandListening = false;
  expect(manager.camera('person', 'centre', 10000)).toBe(true);
  expect(patterns).toHaveLength(3);
});

test('mute is independent, while the haptics toggle disables every pattern', () => {
  const patterns: number[][] = [];
  const manager = new HapticManager(pattern => patterns.push(pattern), () => {});
  manager.enabled = false;
  expect(manager.camera('chair', 'centre', 1000)).toBe(false);
  expect(manager.route('Turn left', 2000)).toBe(false);
  expect(manager.voice('wake')).toBe(false);
  manager.enabled = true;
  expect(manager.route('Turn left', 3000)).toBe(true);
  expect(patterns).toEqual([[0, 340]]);
});

test('verified text, cautious approach, confirmation and error have separate cues', () => {
  const patterns: number[][] = [];
  const manager = new HapticManager(pattern => patterns.push(pattern), () => {});
  expect(manager.reading('sign-a', 1000)).toBe(true);
  expect(manager.reading('sign-b', 2000)).toBe(false);
  expect(manager.approach('track-1', 3000)).toBe(true);
  expect(manager.approach('track-2', 4000)).toBe(false);
  expect(manager.confirmed(5000)).toBe(true);
  expect(manager.camera('chair', 'centre', 5500)).toBe(false);
  expect(manager.error('camera', 7000)).toBe(true);
  expect(manager.error('camera', 8000)).toBe(false);
  expect(patterns).toEqual([
    [0, 210, 100, 90], [0, 135, 95, 135, 95, 135, 95, 135],
    [0, 130, 105, 130], [0, 300, 130, 300, 130, 300],
  ]);
});

test('a confirmed appearance uses tracked image position, not an approach claim', () => {
  const object = {label: 'chair', zone: 'right', missedFrames: 0} as TrackedObject;
  expect(cameraZoneForEvent({key: 'scene:chair:appear'}, [object])).toBe('right');
  expect(cameraZoneForEvent({key: 'scene:chair:centre'}, [object])).toBe('centre');
  expect(cameraZoneForEvent({key: 'scene:chair:count:3'}, [object])).toBe('right');
  expect(cameraZoneForEvent({key: 'approach:1'}, [object])).toBeNull();
});
