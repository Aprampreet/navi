import {ApproachEstimator, type ApproachState} from '../src/approach';
import {AlertManager} from '../src/alerts';
import type {Detection} from '../src/detections';
import {ObjectTracker} from '../src/tracking';

const box = (label: string, centreX: number, scale = 1): Detection => {
  const width = 0.1 * scale;
  const height = 0.2 * scale;
  return {label, confidence: 0.9, x: centreX - width / 2, y: 0.5 - height / 2,
    width, height};
};

function run(scales: number[], referenceScales?: number[]) {
  const tracker = new ObjectTracker();
  const estimator = new ApproachEstimator();
  const states: ApproachState[] = [];
  const spoken: string[] = [];
  const reasons: string[] = [];
  for (let i = 0; i < scales.length; i++) {
    const referenceScale = referenceScales?.[i] ?? 1;
    const frame = [box('person', 0.5, scales[i]), box('chair', 0.15, referenceScale),
      box('dog', 0.85, referenceScale)];
    const update = estimator.update(tracker.update(frame, 1000 + i * 500));
    const person = update.observations.find(observation => observation.label === 'person');
    if (person) { states.push(person.state); reasons.push(person.reason); }
    spoken.push(...update.events.map(event => event.text));
  }
  return {states, spoken, reasons};
}

test('stationary object and camera produce apparently stable image scale', () => {
  const result = run([1, 1, 1, 1, 1, 1, 1]);
  expect(result.states.at(-1)).toBe('APPARENTLY_STABLE');
  expect(result.spoken).toEqual([]);
});

test('one object expanding relative to stable references yields one cautious approach cue', () => {
  const result = run([1, 1.05, 1.12, 1.18, 1.26, 1.34, 1.42, 1.5, 1.55]);
  expect(result.states).toContain('POSSIBLY_APPROACHING');
  expect(result.spoken).toEqual(['Person appears to be getting closer']);
});

test('camera moving toward stationary objects remains unknown', () => {
  const scales = [1, 1.05, 1.12, 1.18, 1.26, 1.34, 1.42, 1.5];
  const result = run(scales, scales);
  expect(result.states.at(-1)).toBe('UNKNOWN');
  expect(result.reasons).toContain('camera_motion');
  expect(result.spoken).toEqual([]);
});

test('one object contracting relative to stable references yields one cautious receding cue', () => {
  const result = run([1.5, 1.44, 1.38, 1.3, 1.22, 1.14, 1.07, 1, 0.95]);
  expect(result.states).toContain('POSSIBLY_RECEDING');
  expect(result.spoken).toEqual(['Person appears to be moving away']);
});

test('a growing box with no independent reference stays unknown', () => {
  const tracker = new ObjectTracker();
  const estimator = new ApproachEstimator();
  let state: ApproachState = 'UNKNOWN';
  let reason = '';
  const scales = [1, 1.05, 1.12, 1.18, 1.26, 1.34, 1.42];
  for (let i = 0; i < scales.length; i++) {
    const update = estimator.update(tracker.update([box('person', 0.5, scales[i])], 1000 + i * 500));
    state = update.observations[0]?.state || 'UNKNOWN';
    reason = update.observations[0]?.reason || '';
    expect(update.events).toEqual([]);
  }
  expect(state).toBe('UNKNOWN');
  expect(reason).toBe('insufficient_stable_references');
});

test('camera shake and false box-size fluctuations do not trigger approach speech', () => {
  const result = run([1, 1.16, 0.92, 1.12, 0.94, 1.1, 0.96, 1.08]);
  expect(result.states.at(-1)).toBe('UNKNOWN');
  expect(result.spoken).toEqual([]);
});

test('partial occlusion and changed track ID reset approach evidence', () => {
  const tracker = new ObjectTracker();
  const estimator = new ApproachEstimator();
  const scales = [1, 1.05, 1.12, 1.18, 1.26, 1.34];
  for (let i = 0; i < scales.length; i++) {
    estimator.update(tracker.update([box('person', 0.5, scales[i]), box('chair', 0.15),
      box('dog', 0.85)], 1000 + i * 500));
  }
  const hidden = estimator.update(tracker.update([box('chair', 0.15), box('dog', 0.85)], 4000));
  expect(hidden.observations.find(observation => observation.label === 'person')?.reason)
    .toBe('temporarily_missing');
  expect(hidden.events).toEqual([]);
  tracker.reset(); estimator.reset();
  const fresh = estimator.update(tracker.update([box('person', 0.5, 1.4),
    box('chair', 0.15), box('dog', 0.85)], 4500));
  expect(fresh.observations).toEqual([]);
  expect(fresh.events).toEqual([]);
});

test('records stable, unreliable and lost transitions without speaking a clear-path claim', () => {
  const tracker = new ObjectTracker();
  const estimator = new ApproachEstimator();
  const transitions: string[] = [];
  for (let i = 0; i < 7; i++) {
    const update = estimator.update(tracker.update([box('chair', 0.5)], 1000 + i * 500));
    transitions.push(...update.transitions.map(item => `${item.from}->${item.to}`));
  }
  for (let i = 0; i < 3; i++) {
    const update = estimator.update(tracker.update([], 4500 + i * 500));
    transitions.push(...update.transitions.map(item => `${item.from}->${item.to}`));
    expect(update.events).toEqual([]);
  }
  expect(transitions).toContain('UNKNOWN->APPARENTLY_STABLE');
  expect(transitions).toContain('APPARENTLY_STABLE->UNKNOWN');
  expect(transitions).toContain('UNKNOWN->LOST');
});

test('two objects can have independent approach and receding observations', () => {
  const tracker = new ObjectTracker();
  const estimator = new ApproachEstimator();
  const grow = [1, 1.05, 1.12, 1.18, 1.26, 1.34, 1.42, 1.5];
  const shrink = [1.5, 1.44, 1.38, 1.3, 1.22, 1.14, 1.07, 1];
  let latest: ReturnType<ApproachEstimator['update']> | null = null;
  for (let i = 0; i < grow.length; i++) {
    latest = estimator.update(tracker.update([box('person', 0.4, grow[i]),
      box('bicycle', 0.6, shrink[i]), box('chair', 0.15), box('dog', 0.85)],
    1000 + i * 500));
  }
  expect(latest?.observations.find(observation => observation.label === 'person')?.state)
    .toBe('POSSIBLY_APPROACHING');
  expect(latest?.observations.find(observation => observation.label === 'bicycle')?.state)
    .toBe('POSSIBLY_RECEDING');
});

test('navigation speech is queued ahead of a pending apparent-approach cue', async () => {
  const spoken: string[] = [];
  const completions: Array<() => void> = [];
  const queue = new AlertManager(text => new Promise<void>(resolve => {
    spoken.push(text); completions.push(resolve);
  }));
  queue.enqueue('Current cue', 1, 'current', 0, 'camera');
  queue.enqueue('Person appears to be getting closer', 2, 'approach:1', 0, 'camera');
  queue.enqueue('Turn left', 4, 'turn', 0, 'navigation');
  completions.shift()!(); await Promise.resolve();
  expect(spoken).toEqual(['Current cue', 'Turn left']);
  completions.shift()!(); await Promise.resolve();
  expect(spoken).toEqual(['Current cue', 'Turn left', 'Person appears to be getting closer']);
  completions.shift()!(); await Promise.resolve();
});
