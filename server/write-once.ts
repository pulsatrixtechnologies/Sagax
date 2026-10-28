// One write per execution key (bot quality diagnostic 2026-10-19, cause C):
// two routine passes or two coordinated bots that send the same write with
// the same arguments at the same time (the doubled schedule entry) make one
// call. The second waits for the first and gets its answer; a write that
// succeeded is answered again for ttlMs without being sent. A failed write
// is never kept: the next one is sent for real. Memory only: a restart
// starts empty, and the resumed turn is told to check what was done.
import { createHash } from "node:crypto";

import { canonicalJson } from "../shared/canonical-json.ts";

export { canonicalJson };

export function executionKey(parts: readonly unknown[]): string {
  return createHash("sha256").update(canonicalJson(parts)).digest("hex");
}

export class WriteOnce<T> {
  private readonly inflight = new Map<string, Promise<T>>();
  private readonly done = new Map<string, { at: number; value: T }>();

  private readonly options: { ttlMs?: number; max?: number; now?: () => number };

  constructor(options: { ttlMs?: number; max?: number; now?: () => number } = {}) {
    this.options = options;
  }

  private get ttl(): number { return this.options.ttlMs ?? 10 * 60_000; }
  private now(): number { return (this.options.now ?? Date.now)(); }

  /** `keep`: whether this answer stands for the key (a success). */
  async run(key: string, send: () => Promise<T>, keep: (value: T) => boolean): Promise<{ value: T; replayed: boolean }> {
    const now = this.now();
    for (const [k, v] of this.done) if (now - v.at > this.ttl) this.done.delete(k);
    const hit = this.done.get(key);
    if (hit) return { value: hit.value, replayed: true };
    const flying = this.inflight.get(key);
    if (flying) {
      const value = await flying.catch(() => undefined);
      if (value !== undefined && keep(value)) return { value, replayed: true };
      return this.run(key, send, keep);
    }
    const sent = send();
    this.inflight.set(key, sent);
    try {
      const value = await sent;
      if (keep(value)) {
        this.done.set(key, { at: this.now(), value });
        const max = this.options.max ?? 500;
        while (this.done.size > max) this.done.delete(this.done.keys().next().value!);
      }
      return { value, replayed: false };
    } finally {
      if (this.inflight.get(key) === sent) this.inflight.delete(key);
    }
  }
}
