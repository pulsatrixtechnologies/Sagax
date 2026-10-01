// Request signing between the Sagax server and the sandbox provisioner
// (server/sandboxd.ts). The shared key never travels: each request carries an
// HMAC over its method, path, timestamp, nonce and body digest, valid for a
// short window and accepted once. The key lives in a file only the two
// containers can read (the provisioner writes it, mode 0440).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const SANDBOXD_AUTH_HEADER = "x-sagax-sandboxd-auth";
export const SANDBOXD_AUTH_WINDOW_MS = 30_000;
const KEY_RE = /^[a-f0-9]{64}$/;

function bodyDigest(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function mac(key: string, method: string, path: string, ts: number, nonce: string, body: string | Buffer): string {
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update(`sagax-sandboxd-v1\n${method.toUpperCase()}\n${path}\n${ts}\n${nonce}\n${bodyDigest(body)}`)
    .digest("hex");
}

export function signSandboxdRequest(key: string, method: string, path: string, body: string | Buffer, now = Date.now()): string {
  if (!KEY_RE.test(key)) throw new Error("invalid sandboxd key");
  const nonce = randomBytes(16).toString("hex");
  return `v1 ts=${now},nonce=${nonce},sig=${mac(key, method, path, now, nonce, body)}`;
}

/** Verifies signatures and remembers nonces for the window, so a captured
 * request cannot be replayed. */
export class SandboxdVerifier {
  private readonly seen = new Map<string, number>();
  private readonly key: string;
  private readonly now: () => number;
  constructor(key: string, now: () => number = Date.now) {
    this.key = key;
    this.now = now;
    if (!KEY_RE.test(key)) throw new Error("invalid sandboxd key");
  }

  verify(header: string | string[] | undefined, method: string, path: string, body: string | Buffer): boolean {
    if (typeof header !== "string" || header.length > 300) return false;
    const match = /^v1 ts=(\d{1,16}),nonce=([a-f0-9]{32}),sig=([a-f0-9]{64})$/.exec(header);
    if (!match) return false;
    const ts = Number(match[1]);
    const nonce = match[2]!;
    const now = this.now();
    if (Math.abs(now - ts) > SANDBOXD_AUTH_WINDOW_MS) return false;
    const expected = Buffer.from(mac(this.key, method, path, ts, nonce, body), "hex");
    const given = Buffer.from(match[3]!, "hex");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
    for (const [seenNonce, at] of this.seen) if (now - at > SANDBOXD_AUTH_WINDOW_MS * 2) this.seen.delete(seenNonce);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, now);
    return true;
  }
}

/** Read the shared key; the provisioner creates it on first start. */
export function readSandboxdKey(file: string): string {
  const key = readFileSync(file, "utf8").trim();
  if (!KEY_RE.test(key)) throw new Error(`${file} does not hold a sandboxd key`);
  return key;
}

export function ensureSandboxdKey(file: string): string {
  if (existsSync(file)) return readSandboxdKey(file);
  mkdirSync(dirname(file), { recursive: true, mode: 0o750 });
  const key = randomBytes(32).toString("hex");
  writeFileSync(file, `${key}\n`, { mode: 0o440, flag: "wx" });
  chmodSync(file, 0o440);
  return key;
}
