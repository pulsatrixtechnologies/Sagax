// The unlock toasts' queue, kept pure so its rules are tested on their own
// (achievement-toasts.test.ts): one toast at a time, each unlock once (an
// unlock reported by the POST and by the live frame shows once), a short
// stack at most, and never while the person is typing: a toast waits until
// the keyboard has been quiet for a moment.
export const TOAST_SHOW_MS = 5_200;
export const TYPING_QUIET_MS = 1_800;
export const MAX_QUEUED = 8;

export interface ToastQueueState {
  /** The toast on screen, if any. */
  current: string | null;
  /** Waiting, oldest first. */
  queue: string[];
}

export class AchievementToastQueue {
  private state: ToastQueueState = { current: null, queue: [] };
  private seen = new Set<string>();
  private listeners = new Set<() => void>();

  snapshot(): ToastQueueState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: ToastQueueState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /** Queue unlocks not shown yet. Returns how many were new. */
  enqueue(ids: readonly string[]): number {
    const fresh = ids.filter((id) => !this.seen.has(id));
    for (const id of fresh) this.seen.add(id);
    if (!fresh.length) return 0;
    this.set({ ...this.state, queue: [...this.state.queue, ...fresh].slice(-MAX_QUEUED) });
    return fresh.length;
  }

  /** Remember unlocks without showing them (toasts turned off). */
  markSeen(ids: readonly string[]): void {
    for (const id of ids) this.seen.add(id);
  }

  /** Whether the next toast may show now: nothing on screen, something waiting, the keyboard quiet. */
  ready(now: number, lastTypedAt: number): boolean {
    return this.state.current === null && this.state.queue.length > 0 && now - lastTypedAt >= TYPING_QUIET_MS;
  }

  /** Put the next waiting toast on screen. */
  advance(): string | null {
    const [next, ...rest] = this.state.queue;
    if (next === undefined) return null;
    this.set({ current: next, queue: rest });
    return next;
  }

  dismiss(): void {
    if (this.state.current === null) return;
    this.set({ ...this.state, current: null });
  }

  reset(): void {
    this.seen.clear();
    this.set({ current: null, queue: [] });
  }
}

export const achievementToasts = new AchievementToastQueue();
