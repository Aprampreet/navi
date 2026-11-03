export type VoiceIntent = 'start_camera' | 'stop_camera' | 'describe' | 'read_last_text' |
  'repeat' | 'pause_alerts' | 'resume_alerts' | 'mute' | 'unmute' | 'stop' | 'cancel' |
  'destination' | 'confirm_destination' | 'start_navigation' | 'stop_navigation' |
  'repeat_turn' | 'route_status' | 'refresh_gps' | 'change_destination' |
  'pause_navigation' | 'resume_navigation' |
  'haptics_on' | 'haptics_off' | 'unknown';
export type AgentState = 'IDLE' | 'WAKE_LISTENING' | 'COMMAND_LISTENING' |
  'PROCESSING' | 'SPEAKING' | 'ERROR_RECOVERY';

export function parseOfflineCommand(input: string): VoiceIntent {
  const text = input.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (extractDestination(input)) return 'destination';
  if (/^(?:change|new|another) destination$/.test(text)) return 'change_destination';
  if (/^(?:confirm|choose|select)(?: the)? (?:(?:first|second|third|fourth|fifth|[1-5]) )?(?:destination|result|option|place)(?: (?:number )?(?:one|two|three|four|five|[1-5]))?$/.test(text) ||
      /^(?:option|result|destination|place) (?:number )?(?:one|two|three|four|five|[1-5])$/.test(text)) return 'confirm_destination';
  if (/^resume(?: the)? (?:walking )?(?:navigation|guidance|route)$/.test(text)) return 'resume_navigation';
  if (/^(?:start|begin|continue)(?: the)? (?:walking )?(?:navigation|guidance|route)$/.test(text) ||
      /^(?:start|begin) walking$/.test(text)) return 'start_navigation';
  if (/^pause(?: the)? (?:walking )?(?:navigation|guidance|route)$/.test(text)) return 'pause_navigation';
  if (/^(?:stop|end)(?: the)? (?:walking )?(?:navigation|guidance|route)$/.test(text)) return 'stop_navigation';
  if (/^(?:repeat|say)(?: the)? (?:turn|instruction|next instruction)(?: again)?$/.test(text) ||
      /^(?:what is|what s) (?:the )?next (?:turn|instruction)$/.test(text)) return 'repeat_turn';
  if (/^(?:route status|navigation status|where am i on (?:the )?route)$/.test(text)) return 'route_status';
  if (/^(?:refresh|update|check)(?: my| the)? (?:gps|location)$/.test(text)) return 'refresh_gps';
  if (/^(?:start|turn on|enable)(?: the)? (?:camera|camera assistance|assistance)$/.test(text)) return 'start_camera';
  if (/^(?:stop|turn off|disable)(?: the)? (?:camera|camera assistance|assistance)$/.test(text)) return 'stop_camera';
  if (/^(?:describe|tell me about|what is in) (?:my |the )?(?:surroundings|scene|view)$/.test(text)) return 'describe';
  if (/^(?:read|repeat)(?: me)? (?:the )?(?:last|previous) (?:text|sign|reading)$/.test(text)) return 'read_last_text';
  if (/^(?:repeat|say that again|repeat that)$/.test(text)) return 'repeat';
  if (/^(?:pause|stop) (?:the )?(?:alerts|obstacle alerts)$/.test(text)) return 'pause_alerts';
  if (/^(?:resume|restart|continue) (?:the )?(?:alerts|obstacle alerts)$/.test(text)) return 'resume_alerts';
  if (/^(?:mute|mute voice|be quiet)$/.test(text)) return 'mute';
  if (/^(?:unmute|unmute voice|speak again)$/.test(text)) return 'unmute';
  if (/^(?:turn on|enable|start) (?:the )?(?:haptics|vibration|vibrations)$/.test(text)) return 'haptics_on';
  if (/^(?:turn off|disable|stop) (?:the )?(?:haptics|vibration|vibrations)$/.test(text)) return 'haptics_off';
  if (/^(?:stop|stop everything|stop navigation)$/.test(text)) return 'stop';
  if (/^(?:cancel|never mind|nevermind)$/.test(text)) return 'cancel';
  return 'unknown';
}

/** Speech recognition is local; the returned place name is sent to the existing map proxy. */
export function extractDestination(input: string): string | null {
  const match = input.trim().match(/^(?:let['’]?s|let s|lets) go to\s+(.+)|^(?:navigate(?: me)? to|go to|take me to|directions to|find|search for)\s+(.+)/i);
  const destination = (match?.[1] || match?.[2] || '').replace(/[.!?]+$/, '').trim();
  return destination.length >= 2 && destination.length <= 120 ? destination : null;
}

/** null means the speaker did not specify an option. */
export function destinationChoice(input: string): number | null {
  const text = input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const choice = text.match(/\b(first|second|third|fourth|fifth|one|two|three|four|five|[1-5])\b/);
  if (!choice) return null;
  const values: Record<string, number> = {first: 0, one: 0, second: 1, two: 1,
    third: 2, three: 2, fourth: 3, four: 3, fifth: 4, five: 4};
  return values[choice[1]] ?? Number(choice[1]) - 1;
}

/** A deterministic controller for the local wake, command and response cycle. */
export class VoiceAgentController {
  state: AgentState = 'IDLE';
  lastResponse = '';
  activate() { this.state = 'WAKE_LISTENING'; }
  deactivate() { this.state = 'IDLE'; }
  wake(): boolean {
    if (this.state !== 'WAKE_LISTENING' && this.state !== 'COMMAND_LISTENING') return false;
    this.state = 'COMMAND_LISTENING';
    return true;
  }
  command(text: string): VoiceIntent {
    if (this.state !== 'COMMAND_LISTENING') return 'unknown';
    this.state = 'PROCESSING';
    return parseOfflineCommand(text);
  }
  speaking(response: string) { this.lastResponse = response; this.state = 'SPEAKING'; }
  ready() { if (this.state !== 'IDLE') this.state = 'WAKE_LISTENING'; }
  error() { this.state = 'ERROR_RECOVERY'; }
}
