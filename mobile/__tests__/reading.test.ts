import {AmbientReadingTracker, describeReading} from '../src/reading';
import {AlertManager} from '../src/alerts';

describe('local surroundings reading', () => {
  it('reports literal text and approximate side', () => {
    expect(describeReading([{text: 'Sharma Medical Store', x: .04, y: .2, width: .24, height: .08}]).spoken)
      .toBe('Text on the left reads Sharma Medical Store.');
  });
  it('groups nearby lines and separates distant text', () => {
    const result = describeReading([
      {text: 'Medical', x: .05, y: .2, width: .2, height: .07},
      {text: 'Store', x: .06, y: .28, width: .2, height: .07},
      {text: 'Heritage Street', x: .45, y: .45, width: .3, height: .07},
    ]);
    expect(result.areas).toHaveLength(2);
    expect(result.spoken).toContain('On the left: Medical Store.');
    expect(result.spoken).toContain('Ahead: Heritage Street.');
  });
  it('does not invent text when OCR finds none', () => {
    expect(describeReading([]).areas).toHaveLength(0);
    expect(describeReading([]).spoken).toContain('could not read');
  });
});

it('places route turns ahead of pending readings and can cancel a pending reading', async () => {
  const heard: string[] = [];
  const done: Array<() => void> = [];
  const alerts = new AlertManager(text => new Promise<void>(resolve => {
    heard.push(text); done.push(resolve);
  }));
  alerts.enqueue('First cue', 1, 'first', 1, 'camera');
  alerts.enqueue('Text ahead reads Open', 3, 'reading', 1, 'reading');
  alerts.enqueue('Turn right', 4, 'turn', 1, 'navigation');
  expect(alerts.currentSource).toBe('camera');
  done.shift()!(); await Promise.resolve();
  expect(heard[1]).toBe('Turn right');
  alerts.clearReading();
  done.shift()!(); await Promise.resolve();
  expect(heard).toHaveLength(2);
});

it('suppresses camera and text cues during a voice command while preserving a turn and response', async () => {
  const heard: string[] = [];
  const done: Array<() => void> = [];
  const alerts = new AlertManager(text => new Promise<void>(resolve => {
    heard.push(text); done.push(resolve);
  }));
  alerts.enqueue('Current instruction', 4, 'current', 1, 'navigation');
  alerts.commandListening = true;
  expect(alerts.enqueue('Routine chair cue', 1, 'chair', 1, 'camera')).toBe(false);
  expect(alerts.enqueue('Text ahead', 2, 'text', 1, 'reading')).toBe(false);
  alerts.enqueue("I'm listening", 5, 'wake', 1, 'agent_wake');
  done.shift()!(); await Promise.resolve();
  expect(heard).toEqual(['Current instruction', "I'm listening"]);
  done.shift()!(); await Promise.resolve();
});

it('announces stable prominent text once and ignores a transient or tiny block', () => {
  const tracker = new AmbientReadingTracker();
  const sign = [{text: 'Heritage Street', x: .4, y: .2, width: .27, height: .06}];
  expect(tracker.update(sign, 1000)).toEqual([]);
  expect(tracker.update([], 2000)).toEqual([]);
  expect(tracker.update(sign, 3000)).toEqual([]);
  expect(tracker.update(sign, 9000)).toEqual(['Visible text ahead reads Heritage Street.']);
  expect(tracker.update(sign, 15000)).toEqual([]);
  expect(tracker.update([{text: 'SHOP', x: .2, y: .1, width: .03, height: .01}], 20000)).toEqual([]);
});
