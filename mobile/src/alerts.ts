// 5: assistance unavailable; 4: route turn; 3: confirmed spatial change;
// 2: cautious apparent approach; 1: routine observation.
export type AlertPriority = 1 | 2 | 3 | 4 | 5;
export type AlertSource = 'camera' | 'navigation' | 'reading' | 'system' | 'agent' | 'agent_wake';
type Alert = {text: string; priority: AlertPriority; key: string;
  source: AlertSource; queuedAt: number};
export class AlertManager {
  private queue: Alert[] = [];
  private readonly maxPending = 8;
  private last = new Map<string, number>();
  private running = false;
  currentSource: AlertSource | null = null;
  muted = false;
  paused = false;
  commandListening = false;
  constructor(private speak: (text: string, source: AlertSource) => Promise<unknown>,
    private cooldownMs = 5000,
    private onError?: (error: unknown, source: AlertSource) => void) {}
  enqueue(text: string, priority: AlertPriority, key = text, now = Date.now(),
    source: AlertSource = 'system'): boolean {
    if ((this.muted && source !== 'agent' && source !== 'agent_wake') ||
      (this.paused && (source === 'camera' || source === 'reading')) ||
      (this.commandListening && (source === 'reading' || (source === 'camera' && priority < 3)))) return false;
    if (now - (this.last.get(key) ?? -Infinity) < this.cooldownMs) return false;
    this.last.set(key, now);
    this.queue.push({text, priority, key, source, queuedAt: Date.now()});
    this.queue.sort((a, b) => b.priority - a.priority);
    if (this.queue.length > this.maxPending) this.queue.length = this.maxPending;
    void this.drain();
    return true;
  }
  clear() { this.queue = []; }
  clearCamera() { this.queue = this.queue.filter(alert => alert.source !== 'camera'); }
  clearReading() { this.queue = this.queue.filter(alert => alert.source !== 'reading'); }
  clearNavigation() { this.queue = this.queue.filter(alert => alert.source !== 'navigation'); }
  clearAgent() { this.queue = this.queue.filter(alert => alert.source !== 'agent' && alert.source !== 'agent_wake'); }
  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const alert = this.queue.shift()!;
      if ((this.muted && alert.source !== 'agent' && alert.source !== 'agent_wake') ||
        ((alert.source === 'camera' || alert.source === 'reading') &&
        (this.paused || (this.commandListening && (alert.source === 'reading' || alert.priority < 3)) ||
          Date.now() - alert.queuedAt > 4000))) continue;
      this.currentSource = alert.source;
      try { await this.speak(alert.text, alert.source); }
      catch (error) { this.onError?.(error, alert.source); }
      finally { this.currentSource = null; }
    }
    this.running = false;
  }
}
