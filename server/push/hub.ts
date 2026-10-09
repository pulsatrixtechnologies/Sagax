// The push hub: takes what happened (a message for a person, a nudge, an
// approval, an achievement, a routine that failed), decides with
// ./decide.ts whether that person's phones get a push, and sends it to
// each registered device (./devices.ts) through APNs (./apns.ts).
//
// Without APNs settings (./config.ts) it logs one clear line the first time
// a push would have gone out, then skips quietly. A dead token (410, or 400
// BadDeviceToken) is removed from the store. Never logs a token or a key.
import { ApnsSender, createHttp2Transport, type ApnsLog, type ApnsTransport } from "./apns.ts";
import type { ApnsConfigResult } from "./config.ts";
import { maskSecret } from "./config.ts";
import { PUSH_SEEN_GRACE_MS, PushRateLimiter, shouldPush, waitsForGrace } from "./decide.ts";
import type { PushDeviceStore } from "./devices.ts";
import { buildApnsRequest, collapseId, type PushMessage } from "./payload.ts";

export interface PushHubDeps {
  config: ApnsConfigResult;
  store: PushDeviceStore;
  /** A client of this person is connected right now (presence, or a live stream). */
  connected(person: string): boolean;
  /** The person's synced "Notification sounds" (true when unset). */
  personSound?(person: string): boolean;
  transport?: ApnsTransport;
  now?: () => number;
  log?: ApnsLog;
  graceMs?: number;
  /** setTimeout by default; tests drive it by hand. */
  schedule?(run: () => void, ms: number): () => void;
  limiter?: PushRateLimiter;
}

interface Pending {
  message: PushMessage;
  queuedAt: number;
  cancel: () => void;
}

const defaultLog: ApnsLog = {
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
};

const key = (person: string, rest: string) => `${person}\0${rest}`;

export class PushHub {
  readonly enabled: boolean;
  private readonly deps: PushHubDeps;
  private readonly sender: ApnsSender | null;
  private readonly log: ApnsLog;
  private readonly now: () => number;
  private readonly limiter: PushRateLimiter;
  private readonly pending = new Map<string, Pending>();
  /** When a client of that person last marked that thread read. */
  private readonly reads = new Map<string, number>();
  private readonly inflight = new Set<Promise<void>>();
  private notConfiguredLogged = false;

  constructor(deps: PushHubDeps) {
    this.deps = deps;
    this.log = deps.log ?? defaultLog;
    this.now = deps.now ?? Date.now;
    this.limiter = deps.limiter ?? new PushRateLimiter();
    let sender: ApnsSender | null = null;
    if (deps.config.configured) {
      try {
        sender = new ApnsSender({ config: deps.config.config, transport: deps.transport ?? createHttp2Transport(), now: this.now, log: this.log });
        this.log.info(`push: APNs on (${deps.config.config.environment} by default, topic ${deps.config.config.bundleId}, key ${maskSecret(deps.config.config.keyId)})`);
      } catch (error) {
        this.log.warn(`push: the APNs key could not be loaded (${error instanceof Error ? error.message : String(error)}); pushes to phones are off`);
        this.notConfiguredLogged = true;
      }
    }
    this.sender = sender;
    this.enabled = sender !== null;
  }

  /** Something a person may want on their phone. Never throws. */
  submit(message: PushMessage): void {
    try {
      const person = message.personId.trim().toLowerCase();
      if (!person) return;
      if (!this.deps.store.list(person).length) return;
      if (!this.sender) {
        if (!this.notConfiguredLogged) {
          this.notConfiguredLogged = true;
          const reason = this.deps.config.configured ? "key not loaded" : this.deps.config.reason;
          this.log.warn(`push: APNs is not configured (${reason}); pushes to phones are skipped (docs/ios-push.md)`);
        }
        return;
      }
      const normalized = { ...message, personId: person };
      const connected = this.deps.connected(person);
      if (!waitsForGrace({ kind: message.kind, connected })) {
        if (shouldPush({ kind: message.kind, connected, seen: false })) this.dispatch(normalized);
        return;
      }
      const pendingKey = key(person, collapseId(normalized));
      const queuedAt = this.now();
      const existing = this.pending.get(pendingKey);
      if (existing) {
        // the newest line of that conversation is the one the phone shows
        existing.message = normalized;
        existing.queuedAt = queuedAt;
        return;
      }
      const entry: Pending = { message: normalized, queuedAt, cancel: () => {} };
      const schedule = this.deps.schedule ?? ((run: () => void, ms: number) => {
        const timer = setTimeout(run, ms);
        timer.unref?.();
        return () => clearTimeout(timer);
      });
      entry.cancel = schedule(() => this.settle(pendingKey), this.deps.graceMs ?? PUSH_SEEN_GRACE_MS);
      this.pending.set(pendingKey, entry);
    } catch (error) {
      this.log.warn(`push: could not queue a push (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  /** A client of this person marked this conversation read. */
  noteRead(person: string, threadId: string): void {
    const who = person.trim().toLowerCase();
    if (!who || !threadId) return;
    this.reads.set(key(who, threadId), this.now());
    if (this.reads.size > 20_000) {
      const cutoff = this.now() - 10 * 60_000;
      for (const [entry, at] of this.reads) if (at < cutoff) this.reads.delete(entry);
    }
  }

  /** Waits for every send started so far (tests, shutdown). */
  async drain(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled(this.inflight);
  }

  private settle(pendingKey: string): void {
    const entry = this.pending.get(pendingKey);
    if (!entry) return;
    this.pending.delete(pendingKey);
    const { message } = entry;
    const readAt = message.threadId ? this.reads.get(key(message.personId, message.threadId)) : undefined;
    const seen = readAt !== undefined && readAt >= entry.queuedAt;
    if (shouldPush({ kind: message.kind, connected: true, seen })) this.dispatch(message);
  }

  private dispatch(message: PushMessage): void {
    if (!this.limiter.tryTake(message.personId, this.now())) return;
    const run = this.deliver(message).catch((error) => {
      this.log.warn(`push: send failed (${error instanceof Error ? error.message : String(error)})`);
    });
    this.inflight.add(run);
    void run.finally(() => this.inflight.delete(run));
  }

  private async deliver(message: PushMessage): Promise<void> {
    const sender = this.sender;
    if (!sender) return;
    const personSound = this.deps.personSound?.(message.personId) ?? true;
    for (const device of this.deps.store.list(message.personId)) {
      const request = buildApnsRequest({ message, bundleId: this.deps.config.configured ? this.deps.config.config.bundleId : "", settings: device.settings, personSound, nowMs: this.now() });
      const outcome = await sender.send(device, request);
      if (!outcome.ok && outcome.prune) {
        this.deps.store.prune(device.token);
        this.log.info(`push: removed device ${maskSecret(device.token)} (${outcome.status} ${outcome.reason})`);
      }
    }
  }
}
