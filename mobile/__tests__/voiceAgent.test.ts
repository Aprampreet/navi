import {destinationChoice, extractDestination, parseOfflineCommand, VoiceAgentController} from '../src/voiceAgent';

test.each([
  ['Start camera assistance', 'start_camera'],
  ['turn on the camera', 'start_camera'],
  ['Stop camera assistance', 'stop_camera'],
  ['Describe my surroundings', 'describe'],
  ['what is in the scene', 'describe'],
  ['Read the last text', 'read_last_text'],
  ['Repeat', 'repeat'],
  ['pause alerts', 'pause_alerts'],
  ['resume obstacle alerts', 'resume_alerts'],
  ['mute', 'mute'], ['unmute voice', 'unmute'],
  ['stop', 'stop'], ['cancel', 'cancel'],
  ["Let's go to Heritage Street Amritsar", 'destination'],
  ['navigate me to Golden Temple', 'destination'],
  ['confirm first destination', 'confirm_destination'],
  ['choose option two', 'confirm_destination'],
  ['start walking guidance', 'start_navigation'],
  ['stop navigation', 'stop_navigation'],
  ['repeat instruction', 'repeat_turn'],
  ["what's the next turn", 'repeat_turn'],
  ['route status', 'route_status'],
  ['refresh my location', 'refresh_gps'],
  ['take me safely across the road', 'unknown'],
])('parses offline command %s as %s', (speech, intent) => {
  expect(parseOfflineCommand(speech)).toBe(intent);
});

test('destination speech keeps the place name and confirmation selects the spoken result', () => {
  expect(extractDestination("Let's go to Heritage Street Amritsar.")).toBe('Heritage Street Amritsar');
  expect(extractDestination('navigate me to Golden Temple')).toBe('Golden Temple');
  expect(extractDestination('start camera assistance')).toBeNull();
  expect(destinationChoice('confirm first destination')).toBe(0);
  expect(destinationChoice('choose option two')).toBe(1);
  expect(destinationChoice('confirm destination')).toBeNull();
});

test('agent only accepts a command after a wake event and returns to wake listening', () => {
  const agent = new VoiceAgentController();
  expect(agent.command('start camera assistance')).toBe('unknown');
  agent.activate();
  expect(agent.wake()).toBe(true);
  expect(agent.command('start camera assistance')).toBe('start_camera');
  agent.speaking('Camera assistance started.');
  expect(agent.lastResponse).toBe('Camera assistance started.');
  agent.ready();
  expect(agent.state).toBe('WAKE_LISTENING');
});

test('a completed command requires a new wake before another command', () => {
  const agent = new VoiceAgentController();
  agent.activate(); agent.wake();
  expect(agent.command('start camera assistance')).toBe('start_camera');
  agent.speaking('Camera assistance started.');
  agent.ready();
  expect(agent.state).toBe('WAKE_LISTENING');
  expect(agent.command('describe my surroundings')).toBe('unknown');
  agent.wake();
  expect(agent.command('describe my surroundings')).toBe('describe');
  agent.speaking('One chair visible.');
  agent.ready();
  expect(agent.state).toBe('WAKE_LISTENING');
});

test('invalid speech and recovery keep the controller deterministic', () => {
  const agent = new VoiceAgentController();
  agent.activate(); agent.wake();
  expect(agent.command('some unrelated words')).toBe('unknown');
  expect(agent.state).toBe('PROCESSING');
  agent.error();
  expect(agent.state).toBe('ERROR_RECOVERY');
  agent.ready();
  expect(agent.state).toBe('WAKE_LISTENING');
  agent.deactivate();
  expect(agent.wake()).toBe(false);
});
