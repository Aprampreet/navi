import {SceneTracker, type Detection} from '../src/detections';
import {AlertManager} from '../src/alerts';
import {movementCues, ObjectTracker} from '../src/tracking';

const box = (x: number, label = 'person'): Detection =>
  ({x, y: 0.2, width: 0.1, height: 0.2, label, confidence: 0.9});

test('keeps one ID as a person crosses from left to centre', () => {
  const tracker = new ObjectTracker();
  const positions = [0.1, 0.1, 0.1, 0.1, 0.3, 0.35, 0.4];
  const updates = positions.map((x, i) => tracker.update([box(x)], i * 500 + 1000));
  expect(updates[0].objects).toHaveLength(0);
  expect(updates.slice(1).every(update => update.objects.length === 1 && update.objects[0].id === 1)).toBe(true);
  expect(updates[6].movements).toEqual([{
    id: 1, label: 'person', from: 'left', to: 'centre', direction: 'right', relativeMotion: false,
  }]);
  expect(movementCues(updates[6].movements)[0].text).toBe('Person detected in the centre');
  expect(updates[6].objects[0].history.length).toBeLessThanOrEqual(6);
});

test('preserves one chair identity and speaks left then centre only once', async () => {
  const tracker = new ObjectTracker();
  const scene = new SceneTracker();
  const spoken: string[] = [];
  const queue = new AlertManager(async text => { spoken.push(text); });
  const positions = [0.1, 0.1, 0.1, 0.1, 0.3, 0.35, 0.4, 0.4, 0.4];
  for (let i = 0; i < positions.length; i++) {
    const tracked = tracker.update([box(positions[i], 'chair')], 1000 + i * 500);
    const changes = [...movementCues(tracked.movements),
      ...scene.update(tracked.objects.map(object => object.box)).events];
    for (const change of changes) queue.enqueue(change.text, change.priority, change.key,
      1000 + i * 500, 'camera');
    if (tracked.objects.length) expect(tracked.objects[0].id).toBe(1);
  }
  await Promise.resolve();
  expect(spoken).toEqual(['Chair detected on the left', 'Chair detected in the centre']);
});

test('counts distinct people and preserves IDs through two missing frames', () => {
  const tracker = new ObjectTracker();
  const scene = new SceneTracker();
  const people = [box(0.1), box(0.45), box(0.8)];
  let update = tracker.update(people, 1000);
  expect(update.objects).toHaveLength(0);
  for (let i = 1; i < 5; i++) {
    update = tracker.update(people, 1000 + i * 500);
    scene.update(update.objects.map(object => object.box));
  }
  expect(update.objects.map(object => object.id)).toEqual([1, 2, 3]);
  expect(scene.update(update.objects.map(object => object.box)).counts.person).toBe(3);
  update = tracker.update([], 3500);
  expect(update.objects.map(object => object.id)).toEqual([1, 2, 3]);
  update = tracker.update([], 4000);
  expect(update.objects.map(object => object.id)).toEqual([1, 2, 3]);
  update = tracker.update(people, 4500);
  expect(update.objects.map(object => object.id)).toEqual([1, 2, 3]);
  expect(update.movements).toEqual([]);
  expect(scene.update(update.objects.map(object => object.box)).counts.person).toBe(3);
  tracker.update([], 5000); tracker.update([], 5500);
  expect(tracker.update([], 6000).objects).toHaveLength(0);
});

test('does not create a second track for a duplicate overlapping box', () => {
  const tracker = new ObjectTracker();
  const duplicate = {...box(0.1), x: 0.11};
  tracker.update([box(0.1), duplicate], 1000);
  const update = tracker.update([box(0.1), duplicate], 1500);
  expect(update.objects.map(object => object.id)).toEqual([1]);
});

test('suppresses motion claims when several tracked objects shift together', () => {
  const tracker = new ObjectTracker();
  const frame = (shift: number) => [box(0.25 + shift), box(0.45 + shift, 'chair'),
    box(0.7 + shift, 'dog')];
  tracker.update(frame(0), 1000);
  tracker.update(frame(0), 1500);
  tracker.update(frame(0.05), 2000);
  tracker.update(frame(0.1), 2500);
  const update = tracker.update(frame(0.15), 3000);
  expect(update.cameraMotionLikely).toBe(true);
  expect(update.movements).toEqual([]);
  expect(update.objects.map(object => object.id)).toEqual([1, 2, 3]);
});

test('describes image-relative movement only when other objects provide a stable reference', () => {
  const tracker = new ObjectTracker();
  const frame = (personX: number) => [box(personX), box(0.45, 'chair'), box(0.75, 'dog')];
  tracker.update(frame(0.1), 1000);
  tracker.update(frame(0.1), 1500);
  tracker.update(frame(0.3), 2000);
  tracker.update(frame(0.35), 2500);
  const update = tracker.update(frame(0.4), 3000);
  expect(update.cameraMotionLikely).toBe(false);
  expect(update.movements).toEqual([{
    id: 1, label: 'person', from: 'left', to: 'centre', direction: 'right', relativeMotion: true,
  }]);
  expect(movementCues(update.movements)[0].text)
    .toBe('A person is moving from left toward centre in the camera view');
});

test('resets stale tracks after a long camera interruption', () => {
  const tracker = new ObjectTracker();
  tracker.update([box(0.1, 'chair')], 1000);
  tracker.update([box(0.1, 'chair')], 1500);
  expect(tracker.update([box(0.1, 'chair')], 6000).objects).toHaveLength(0);
  expect(tracker.update([box(0.1, 'chair')], 6500).objects[0].id).toBe(1);
});
