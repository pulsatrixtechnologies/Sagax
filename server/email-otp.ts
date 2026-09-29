// Sign-in codes this server emails itself (no outside account service).
// Only a sha256 of each code is held, in memory: a restart simply voids
// codes in flight, which costs a person one more email.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_SENDS_PER_ADDRESS = 3;
export const OTP_SENDS_PER_SOURCE = 10;
export const OTP_SEND_WINDOW_MS = 15 * 60_000;

const digest = (value: string) => createHash("sha256").update(value).digest();
const key = (email: string) => email.trim().toLowerCase();

interface Pending { hash: Buffer; expiresAt: number; attempts: number }

export class EmailOtpStore {
  private readonly now: () => number;
  private readonly random: () => string;
  private readonly pending = new Map<string, Pending>();
  private readonly sends = new Map<string, number[]>();

  constructor(options: { now?: () => number; random?: () => string } = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? (() => String(randomInt(0, 100_000_000)).padStart(8, "0"));
  }

  issue(email: string, source: string): { ok: true; code: string } | { ok: false; status: 429; error: string } {
    const now = this.now();
    const address = key(email);
    if (!this.allowSend(`a:${address}`, OTP_SENDS_PER_ADDRESS, now) || !this.allowSend(`s:${source}`, OTP_SENDS_PER_SOURCE, now)) {
      return { ok: false, status: 429, error: "too many codes requested; wait a few minutes and try again" };
    }
    const code = this.random();
    this.pending.set(address, { hash: digest(code), expiresAt: now + OTP_TTL_MS, attempts: 0 });
    return { ok: true, code };
  }

  verify(email: string, code: string): { ok: true } | { ok: false; status: 400 | 401 | 429; error: string } {
    const trimmed = code.replace(/\s+/g, "");
    if (!/^\d{8}$/.test(trimmed)) return { ok: false, status: 400, error: "enter the 8-digit code from the email" };
    const address = key(email);
    const entry = this.pending.get(address);
    if (!entry || this.now() > entry.expiresAt) {
      this.pending.delete(address);
      return { ok: false, status: 401, error: "that code is wrong or has expired; request a new one" };
    }
    if (!timingSafeEqual(entry.hash, digest(trimmed))) {
      entry.attempts += 1;
      if (entry.attempts >= OTP_MAX_ATTEMPTS) this.pending.delete(address);
      return { ok: false, status: 401, error: "that code is wrong or has expired; request a new one" };
    }
    this.pending.delete(address);
    return { ok: true };
  }

  private allowSend(bucket: string, limit: number, now: number): boolean {
    const recent = (this.sends.get(bucket) ?? []).filter((at) => now - at <= OTP_SEND_WINDOW_MS);
    if (recent.length >= limit) { this.sends.set(bucket, recent); return false; }
    recent.push(now);
    this.sends.set(bucket, recent);
    return true;
  }
}
