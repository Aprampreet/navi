export type AlertPriority = 1 | 2 | 3;
type Alert = {text: string; priority: AlertPriority; key: string};
export class AlertManager {
  private queue: Alert[] = [];
  private last = new Map<string, number>();
  private running = false;
  muted = false;
  paused = false;
  constructor(private speak: (text: string) => Promise<unknown>, private cooldownMs = 5000) {}
  enqueue(text: string, priority: AlertPriority, key = text, now = Date.now()): boolean {
    if (this.muted || (this.paused && priority < 3)) return false;
    if (now - (this.last.get(key) ?? -Infinity) < this.cooldownMs) return false;
    this.last.set(key, now);
    this.queue.push({text, priority, key});
    this.queue.sort((a, b) => b.priority - a.priority);
    void this.drain();
    return true;
  }
  clear() { this.queue = []; }
  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const alert = this.queue.shift()!;
      try { await this.speak(alert.text); } catch { /* UI shows native TTS errors elsewhere */ }
    }
    this.running = false;
  }
}
