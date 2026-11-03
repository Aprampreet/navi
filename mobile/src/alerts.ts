// 5: assistance unavailable; 4: route turn; 3: confirmed spatial change;
// 2: cautious apparent approach; 1: routine observation.
export type AlertPriority = 1 | 2 | 3 | 4 | 5;
export type AlertSource = 'camera' | 'navigation' | 'system';
type Alert = {text: string; priority: AlertPriority; key: string;
  source: AlertSource; queuedAt: number};
export class AlertManager {
  private queue: Alert[] = [];
  private readonly maxPending = 8;
  private last = new Map<string, number>();
  private running = false;
  muted = false;
  paused = false;
  constructor(private speak: (text: string) => Promise<unknown>, private cooldownMs = 5000) {}
  enqueue(text: string, priority: AlertPriority, key = text, now = Date.now(),
    source: AlertSource = 'system'): boolean {
    if (this.muted || (this.paused && source === 'camera')) return false;
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
  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const alert = this.queue.shift()!;
      if (this.muted || (alert.source === 'camera' &&
        (this.paused || Date.now() - alert.queuedAt > 4000))) continue;
      try { await this.speak(alert.text); } catch { /* UI shows native TTS errors elsewhere */ }
    }
    this.running = false;
  }
}
