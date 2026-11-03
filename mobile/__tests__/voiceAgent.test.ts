import {chooseOfflineCommand, destinationChoice, extractDestination, parseOfflineCommand,
  VoiceAgentController} from '../src/voiceAgent';

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
  ['turn on haptics', 'haptics_on'], ['turn off vibrations', 'haptics_off'],
  ['stop', 'stop'], ['cancel', 'cancel'],
  ["Let's go to Heritage Street Amritsar", 'destination'],
  ['navigate me to Golden Temple', 'destination'],
  ['confirm first destination', 'confirm_destination'],
  ['choose option two', 'confirm_destination'],
  ['start walking guidance', 'start_navigation'],
  ['pause navigation', 'pause_navigation'], ['resume guidance', 'resume_navigation'],
  ['stop navigation', 'stop_navigation'],
  ['repeat instruction', 'repeat_turn'],
  ["what's the next turn", 'repeat_turn'],
  ['route status', 'route_status'],
  ['refresh my location', 'refresh_gps'],
  ['change destination', 'change_destination'],
  ['take me safely across the road', 'unknown'],
  ['send SOS', 'send_sos'], ['emergency help', 'send_sos'],
  ['cancel SOS', 'cancel_sos'],
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

test.each([
  ['Please start the camera now', 'start_camera'],
  ['Could you turn on camera?', 'start_camera'],
  ['start camer assistance', 'start_camera'],
  ['start camera assistant', 'start_camera'],
  ['start camera systems', 'start_camera'],
  ['stop my camera please', 'stop_camera'],
  ['Tell me about my surroundings please', 'describe'],
  ['What do you see?', 'describe'],
  ['Read my last sign', 'read_last_text'],
  ['Say it again', 'repeat'],
  ['Please pause the obstacle alerts', 'pause_alerts'],
  ['Can you resume my alerts?', 'resume_alerts'],
  ['Begin walking guidance please', 'start_navigation'],
  ['stop the guidance', 'stop_navigation'],
  ['repeat my direction', 'repeat_turn'],
  ['update my GPS please', 'refresh_gps'],
  ['pick the first option', 'confirm_destination'],
  ['Hi NAVI, confirm the first destination', 'confirm_destination'],
] as const)('understands natural offline wording %s', (speech, intent) => {
  expect(parseOfflineCommand(speech)).toBe(intent);
});

test('uses destination context only for short option replies', () => {
  expect(parseOfflineCommand('first one')).toBe('unknown');
  expect(parseOfflineCommand('first one', 'CONFIRM')).toBe('confirm_destination');
  expect(parseOfflineCommand('pick the second one', 'CONFIRM')).toBe('confirm_destination');
  expect(destinationChoice('pick the second one')).toBe(1);
});

test('uses route state to interpret continue guidance', () => {
  expect(parseOfflineCommand('continue walking guidance', 'READY')).toBe('start_navigation');
  expect(parseOfflineCommand('continue walking guidance', 'NAVIGATING')).toBe('resume_navigation');
});

test.each([
  'start a new playlist', 'stop the alarm', 'turn on the flashlight',
  'take me safely across the road', 'find a destination',
  'pause', 'what is ahead', 'the first one',
])('does not act on unrelated or ambiguous speech: %s', speech => {
  expect(parseOfflineCommand(speech)).toBe('unknown');
});

test('keeps natural destination names for confirmation', () => {
  expect(extractDestination('Can you take me to Heritage Street Amritsar please?'))
    .toBe('Heritage Street Amritsar');
  expect(parseOfflineCommand('I want to go to Golden Temple')).toBe('destination');
});

test.each([
  [['start camera existence', 'start camera assistance'], 'start_camera'],
  [['open the camera system', 'open camera'], 'start_camera'],
  [['tell me surrounding', 'tell me surroundings'], 'describe'],
  [['begin the walking guide', 'begin walking guidance'], 'start_navigation'],
] as const)('uses recognition alternatives for %j', (alternatives, intent) => {
  expect(chooseOfflineCommand([...alternatives], intent === 'start_navigation' ? 'READY' : 'SEARCH').intent)
    .toBe(intent);
});

test('bounded fuzzy recovery accepts command damage but rejects unrelated actions', () => {
  expect(chooseOfflineCommand(['start camra'], 'SEARCH').intent).toBe('start_camera');
  expect(chooseOfflineCommand(['start a new playlist'], 'SEARCH').intent).toBe('unknown');
  expect(chooseOfflineCommand(['turn on the flashlight'], 'SEARCH').intent).toBe('unknown');
});

test('conflicting actionable alternatives request clarification', () => {
  expect(chooseOfflineCommand(['start camera', 'stop camera'], 'SEARCH'))
    .toMatchObject({intent: 'unknown', ambiguous: true});
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
