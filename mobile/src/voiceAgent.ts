export type VoiceIntent = 'start_camera' | 'stop_camera' | 'describe' | 'read_last_text' |
  'repeat' | 'pause_alerts' | 'resume_alerts' | 'mute' | 'unmute' | 'stop' | 'cancel' |
  'destination' | 'confirm_destination' | 'start_navigation' | 'stop_navigation' |
  'repeat_turn' | 'route_status' | 'refresh_gps' | 'change_destination' |
  'pause_navigation' | 'resume_navigation' |
  'haptics_on' | 'haptics_off' | 'send_sos' | 'cancel_sos' | 'unknown';
// SOS uses an explicit command and a separate cancel command so generic "cancel"
// continues to end only the current voice session.
export type AgentState = 'IDLE' | 'WAKE_LISTENING' | 'COMMAND_LISTENING' |
  'PROCESSING' | 'SPEAKING' | 'ERROR_RECOVERY';
export type VoiceContext = 'SEARCH' | 'CONFIRM' | 'READY' | 'NAVIGATING';
export type VoiceDecision = {intent: VoiceIntent; text: string; ambiguous: boolean};

const nouns = ['camera', 'assistance', 'guidance', 'navigation', 'destination',
  'instruction', 'surroundings', 'location', 'obstacle', 'alerts', 'haptics'];

function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let left = 0, right = 0, edits = 0;
  while (left < a.length && right < b.length) {
    if (a[left] === b[right]) { left++; right++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) left++;
    if (b.length >= a.length) right++;
  }
  return edits + Number(left < a.length || right < b.length) <= 1;
}

function normalized(input: string): string {
  let text = input.toLowerCase().replace(/\bwhat['’]s\b/g, 'what is')
    .replace(/\blet['’]s\b/g, 'lets').replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    const next = text.replace(/^(?:(?:hi|hey) navi|please|can you|could you|would you|will you|i want you to|i would like to|i want to)\s+/, '');
    if (next === text) break;
    text = next;
  }
  text = text.replace(/\s+(?:please|now|for me|thanks)$/, '');
  return text.split(' ').map(word => {
    if (word === 'assistant') return 'assistance';
    if (word.length < 5 || nouns.includes(word)) return word;
    const matches = nouns.filter(noun => oneEditApart(word, noun));
    return matches.length === 1 ? matches[0] : word;
  }).join(' ');
}

const intentExamples: Partial<Record<VoiceIntent, string[]>> = {
  start_camera: ['start camera', 'open camera', 'begin assistance', 'turn on camera'],
  stop_camera: ['stop camera', 'close camera', 'end assistance', 'turn off camera'],
  describe: ['describe surroundings', 'describe scene', 'what do you see', 'tell me surroundings'],
  read_last_text: ['read last text', 'read last sign', 'repeat reading'],
  repeat: ['repeat', 'say again'],
  pause_alerts: ['pause alerts', 'stop obstacle alerts'],
  resume_alerts: ['resume alerts', 'continue obstacle alerts'],
  mute: ['mute voice', 'be quiet'], unmute: ['unmute voice', 'speak again'],
  haptics_on: ['enable haptics', 'turn on vibration'],
  haptics_off: ['disable haptics', 'turn off vibration'],
  confirm_destination: ['confirm destination', 'pick first option', 'choose first place'],
  start_navigation: ['start navigation', 'start guidance', 'begin walking'],
  pause_navigation: ['pause navigation', 'pause guidance'],
  resume_navigation: ['resume navigation', 'continue guidance'],
  stop_navigation: ['stop navigation', 'end guidance'],
  repeat_turn: ['repeat instruction', 'repeat direction', 'next turn'],
  route_status: ['route status', 'navigation status'],
  refresh_gps: ['refresh location', 'update gps'],
  change_destination: ['change destination', 'new destination'],
};

function editDistance(left: string, right: string): number {
  const row = Array.from({length: right.length + 1}, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const previous = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1,
        diagonal + Number(left[i - 1] !== right[j - 1]));
      diagonal = previous;
    }
  }
  return row[right.length];
}

function tokenSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  const limit = Math.max(left.length, right.length) >= 7 ? 2 : 1;
  const distance = editDistance(left, right);
  return distance <= limit ? 1 - distance / Math.max(left.length, right.length) : 0;
}

function phraseScore(input: string, example: string): number {
  const ignored = new Set(['a', 'an', 'the', 'my', 'me', 'please', 'now', 'for']);
  const actual = normalized(input).split(' ').filter(word => word && !ignored.has(word));
  const expected = normalized(example).split(' ').filter(word => word && !ignored.has(word));
  if (!actual.length || !expected.length) return 0;
  const matched = expected.reduce((total, wanted) => total +
    Math.max(...actual.map(word => tokenSimilarity(word, wanted))), 0);
  const recall = matched / expected.length;
  const precision = matched / actual.length;
  return 0.68 * recall + 0.32 * Math.min(1, precision);
}

function approximateIntent(input: string, context: VoiceContext): VoiceIntent {
  const allowed = Object.entries(intentExamples).filter(([intent]) => {
    if (intent === 'confirm_destination') return context === 'CONFIRM';
    if (intent === 'start_navigation') return context === 'READY';
    if (['pause_navigation', 'resume_navigation', 'stop_navigation', 'repeat_turn',
      'route_status'].includes(intent)) return context === 'NAVIGATING';
    return true;
  }) as Array<[VoiceIntent, string[]]>;
  const ranked = allowed.map(([intent, examples]) => ({intent,
    score: Math.max(...examples.map(example => phraseScore(input, example))) }))
    .sort((left, right) => right.score - left.score);
  if (!ranked[0] || ranked[0].score < 0.76 ||
      (ranked[1] && ranked[0].score - ranked[1].score < 0.08)) return 'unknown';
  return ranked[0].intent;
}

/** Selects safely among ASR alternatives, then applies bounded fuzzy intent recovery. */
export function chooseOfflineCommand(inputs: string[], context: VoiceContext = 'SEARCH'): VoiceDecision {
  const candidates = [...new Set(inputs.map(value => value.trim()).filter(Boolean))];
  if (!candidates.length) return {intent: 'unknown', text: '', ambiguous: false};
  const exact = candidates.map(text => ({text, intent: parseOfflineCommand(text, context)}))
    .filter(result => result.intent !== 'unknown');
  const exactIntents = new Set(exact.map(result => result.intent));
  if (exactIntents.size === 1) return {...exact[0], ambiguous: false};
  if (exactIntents.size > 1) return {intent: 'unknown', text: candidates[0], ambiguous: true};
  const recovered = candidates.map(text => ({text, intent: approximateIntent(text, context)}))
    .filter(result => result.intent !== 'unknown');
  const recoveredIntents = new Set(recovered.map(result => result.intent));
  if (recoveredIntents.size === 1) return {...recovered[0], ambiguous: false};
  return {intent: 'unknown', text: candidates[0], ambiguous: recoveredIntents.size > 1};
}

export function parseOfflineCommand(input: string, context: VoiceContext = 'SEARCH'): VoiceIntent {
  const text = normalized(input);
  if (/^(?:send|start|trigger|activate)(?: an| the)? sos$/.test(text) ||
      /^(?:emergency help|send emergency alert|i need emergency help)$/.test(text)) return 'send_sos';
  if (/^(?:cancel|stop)(?: the| my)? sos$/.test(text) ||
      /^cancel emergency alert$/.test(text)) return 'cancel_sos';
  if (extractDestination(input)) return 'destination';
  if (/^(?:change|new|another|different)(?: the| my)? destination$/.test(text)) return 'change_destination';
  const ordinal = '(?:first|second|third|fourth|fifth|one|two|three|four|five|[1-5])';
  if (new RegExp(`^(?:confirm|choose|select|pick)(?: the)? (?:${ordinal} )?(?:destination|result|option|place)(?: (?:number )?${ordinal})?$`).test(text) ||
      new RegExp(`^(?:option|result|destination|place) (?:number )?${ordinal}$`).test(text) ||
      (context === 'CONFIRM' && new RegExp(`^(?:(?:confirm|choose|select|pick)(?: the)? )?${ordinal}(?: one)?$`).test(text))) return 'confirm_destination';
  if (/^continue(?: the| my)? (?:walking )?(?:navigation|guidance|route|directions)$/.test(text))
    return context === 'NAVIGATING' ? 'resume_navigation' : 'start_navigation';
  if (/^(?:resume|restart)(?: the| my)? (?:walking )?(?:navigation|guidance|route|directions)$/.test(text)) return 'resume_navigation';
  if (/^(?:start|begin)(?: the| my)? (?:walking )?(?:navigation|guidance|route|directions)$/.test(text) ||
      /^(?:start|begin) walking$/.test(text)) return 'start_navigation';
  if (/^pause(?: the| my)? (?:walking )?(?:navigation|guidance|route|directions)$/.test(text)) return 'pause_navigation';
  if (/^(?:stop|end|cancel)(?: the| my)? (?:walking )?(?:navigation|guidance|route|directions)$/.test(text)) return 'stop_navigation';
  if (/^(?:repeat|say)(?: the| my)? (?:turn|instruction|next instruction|direction)(?: again)?$/.test(text) ||
      /^what is (?:the |my )?next (?:turn|instruction|direction)$/.test(text)) return 'repeat_turn';
  if (/^(?:route|navigation|guidance) status$/.test(text) ||
      /^where am i on (?:the |my )?route$/.test(text)) return 'route_status';
  if (/^(?:refresh|update|check|get)(?: my| the)? (?:gps|location|position)$/.test(text)) return 'refresh_gps';
  if (/^(?:start|begin|turn on|switch on|enable|open)(?: the| my)? (?:camera(?: assistance| systems?)?|assistance)$/.test(text)) return 'start_camera';
  if (/^(?:stop|end|turn off|switch off|disable|close)(?: the| my)? (?:camera(?: assistance)?|assistance)$/.test(text)) return 'stop_camera';
  if (/^(?:describe|tell me about|what is in|what can you see in)(?: my| the)? (?:surroundings|scene|view)$/.test(text) ||
      /^(?:what do you see|what can you see|describe what is around me)$/.test(text)) return 'describe';
  if (/^(?:read|repeat|say)(?: me)? (?:the|my)? ?(?:last|previous) (?:text|sign|reading)$/.test(text)) return 'read_last_text';
  if (/^(?:repeat|say that again|repeat that|say it again)$/.test(text)) return 'repeat';
  if (/^(?:pause|stop)(?: the| my)? (?:alerts|obstacle alerts)$/.test(text)) return 'pause_alerts';
  if (/^(?:resume|restart|continue)(?: the| my)? (?:alerts|obstacle alerts)$/.test(text)) return 'resume_alerts';
  if (/^(?:mute|mute voice|be quiet)$/.test(text)) return 'mute';
  if (/^(?:unmute|unmute voice|speak again)$/.test(text)) return 'unmute';
  if (/^(?:turn on|enable|start)(?: the| my)? (?:haptics|vibration|vibrations)$/.test(text)) return 'haptics_on';
  if (/^(?:turn off|disable|stop)(?: the| my)? (?:haptics|vibration|vibrations)$/.test(text)) return 'haptics_off';
  if (/^(?:stop|stop everything|stop all assistance)$/.test(text)) return 'stop';
  if (/^(?:cancel|never mind|nevermind)$/.test(text)) return 'cancel';
  return 'unknown';
}

/** Speech recognition is local; the returned place name is sent to the existing map proxy. */
export function extractDestination(input: string): string | null {
  let text = input.trim();
  for (let i = 0; i < 3; i++) {
    const next = text.replace(/^(?:(?:hi|hey) navi[, ]*|please\s+|can you\s+|could you\s+|would you\s+|i want you to\s+|i would like to\s+|i want to\s+)/i, '').trim();
    if (next === text) break;
    text = next;
  }
  const match = text.match(/^(?:(?:let['’]?s|let s|lets) go to|navigate(?: me)? to|go to|take me to|bring me to|directions to|find|search for)\s+(.+)/i);
  const destination = (match?.[1] || '').replace(/[.!?]+$/, '').replace(/\s+please$/i, '').trim();
  return destination.length >= 2 && destination.length <= 120 &&
    !/^(?:a |the )?(?:destination|place|route|somewhere)$/i.test(destination) ? destination : null;
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
  command(text: string, context: VoiceContext = 'SEARCH'): VoiceIntent {
    return this.commandCandidates([text], context).intent;
  }
  commandCandidates(inputs: string[], context: VoiceContext = 'SEARCH'): VoiceDecision {
    if (this.state !== 'COMMAND_LISTENING')
      return {intent: 'unknown', text: inputs[0] || '', ambiguous: false};
    this.state = 'PROCESSING';
    return chooseOfflineCommand(inputs, context);
  }
  speaking(response: string) { this.lastResponse = response; this.state = 'SPEAKING'; }
  ready() { if (this.state !== 'IDLE') this.state = 'WAKE_LISTENING'; }
  error() { this.state = 'ERROR_RECOVERY'; }
}
