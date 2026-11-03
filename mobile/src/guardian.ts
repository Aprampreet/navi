export type GuardianSensitivity = 'high' | 'normal' | 'low';
export type GuardianPhase = 'IDLE' | 'COUNTDOWN' | 'LOCATING' | 'REQUESTED' |
  'SENT' | 'DELIVERED' | 'FAILED' | 'COMPOSER' | 'CANCELLED' | 'UNCERTAIN';
export type GuardianAttempt = {status: string; detail: string; timestamp: number};
export type GuardianState = {
  name: string; phone: string; enabled: boolean; sensitivity: GuardianSensitivity;
  seconds: number; phase: GuardianPhase; detail: string; remaining: number;
  accelerometerAvailable: boolean; monitoring: boolean; smsPermission: boolean;
  history: GuardianAttempt[];
};

export const initialGuardian: GuardianState = {
  name: '', phone: '', enabled: false, sensitivity: 'normal', seconds: 10,
  phase: 'IDLE', detail: '', remaining: 0, accelerometerAvailable: false,
  monitoring: false, smsPermission: false, history: [],
};

/**
 * Boundary around the native, cellular SMS implementation. Keeping this small makes
 * emergency UI/voice flows testable without ever addressing or sending a real SMS.
 */
export interface GuardianTransport {
  getState(): Promise<GuardianState>;
  saveSettings(name: string, phone: string, confirmation: string, enabled: boolean,
    sensitivity: GuardianSensitivity, seconds: number): Promise<GuardianState>;
  startSOS(): Promise<GuardianState>;
  cancelSOS(): Promise<GuardianState>;
  openTestComposer(): Promise<string>;
}

export class GuardianCoordinator {
  constructor(private readonly transport: GuardianTransport) {}

  state() { return this.transport.getState(); }
  save(name: string, phone: string, confirmation: string, enabled: boolean,
    sensitivity: GuardianSensitivity, seconds: number) {
    return this.transport.saveSettings(name, phone, confirmation, enabled, sensitivity, seconds);
  }
  start() { return this.transport.startSOS(); }
  cancel() { return this.transport.cancelSOS(); }
  testDraft() { return this.transport.openTestComposer(); }
}
