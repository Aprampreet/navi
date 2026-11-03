import {GuardianCoordinator, initialGuardian, type GuardianState,
  type GuardianTransport} from '../src/guardian';

function state(overrides: Partial<GuardianState> = {}): GuardianState {
  return {...initialGuardian, name: 'Test contact', phone: '+911234567890', ...overrides};
}

function mockTransport() {
  let current = state();
  const transport: jest.Mocked<GuardianTransport> = {
    getState: jest.fn(async () => current),
    saveSettings: jest.fn(async (name, phone, _confirmation, enabled, sensitivity, seconds) =>
      (current = state({name, phone, enabled, sensitivity, seconds}))),
    startSOS: jest.fn(async () => (current = state({phase: 'COUNTDOWN', remaining: 10,
      detail: 'Emergency SOS countdown started. Cancel before sending.'}))),
    cancelSOS: jest.fn(async () => (current = state({phase: 'CANCELLED', remaining: 0,
      detail: 'SOS cancelled before any message was sent'}))),
    openTestComposer: jest.fn(async () => 'Test draft opened. You must tap Send yourself.'),
  };
  return transport;
}

test('starts and cancels through a mock transport without sending SMS', async () => {
  const transport = mockTransport();
  const guardian = new GuardianCoordinator(transport);
  expect((await guardian.start()).phase).toBe('COUNTDOWN');
  expect((await guardian.cancel()).phase).toBe('CANCELLED');
  expect(transport.startSOS).toHaveBeenCalledTimes(1);
  expect(transport.cancelSOS).toHaveBeenCalledTimes(1);
  expect(transport.openTestComposer).not.toHaveBeenCalled();
});

test('passes confirmed settings to the native boundary exactly once', async () => {
  const transport = mockTransport();
  const guardian = new GuardianCoordinator(transport);
  const result = await guardian.save('Helper', '+919999999999', '+919999999999', true, 'high', 15);
  expect(result).toMatchObject({name: 'Helper', enabled: true, sensitivity: 'high', seconds: 15});
  expect(transport.saveSettings).toHaveBeenCalledWith(
    'Helper', '+919999999999', '+919999999999', true, 'high', 15);
});

test('test mode opens only a user-confirmed draft', async () => {
  const transport = mockTransport();
  const guardian = new GuardianCoordinator(transport);
  await expect(guardian.testDraft()).resolves.toContain('tap Send yourself');
  expect(transport.startSOS).not.toHaveBeenCalled();
  expect(transport.openTestComposer).toHaveBeenCalledTimes(1);
});

test.each(['REQUESTED', 'SENT', 'DELIVERED', 'FAILED', 'COMPOSER', 'UNCERTAIN'] as const)(
  'preserves honest terminal or transport state %s', async phase => {
    const transport = mockTransport();
    transport.getState.mockResolvedValue(state({phase, detail: `Reported ${phase}`}));
    const result = await new GuardianCoordinator(transport).state();
    expect(result.phase).toBe(phase);
    expect(result.detail).toBe(`Reported ${phase}`);
  });
