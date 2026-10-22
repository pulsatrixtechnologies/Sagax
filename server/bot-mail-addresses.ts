// The bots' own email addresses, read from Perspicax (contract B of
// 2026-10-21, B21 / iOS CO5; the delivery side is server/bot-inbound-mail.ts).
//
//   POST <perspicax>/api/v1/pulsabot/inbound-mail/addresses   (link token)
//   { "bots": [ { "id", "name", "owner_sub" } ] }   at most 500
//   -> { "enabled", "domain", "addresses": [ { "bot_id", "address", "enabled" } ] }
//
// Perspicax records each (server, bot, name, owner) and allocates an address
// for a bot it does not know yet, only while inbound mail is enabled there.
// Sagax asks for every bot that has a Perspicax owner in ONE call and keeps
// the answer 5 minutes. A 404 (an older Perspicax), any other refusal, a
// timeout, an answer that is not the contract's, or inbound mail off: the
// bot has no address (`available: false`) and the app shows nothing. Never
// logs the link token or a body (linkPostJson does neither).
import type { LinkPostResult } from "./perspicax-link.ts";

export const BOT_MAIL_ADDRESSES_PATH = "/api/v1/pulsabot/inbound-mail/addresses";
export const BOT_MAIL_CACHE_MS = 5 * 60_000;
export const BOT_MAIL_BATCH_MAX = 500;
const TIMEOUT_MS = 5_000;
const ANSWER_MAX_BYTES = 256 * 1024;
const ADDRESS = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,253}$/;

/** One of this server's bots, as contract B names it. */
export interface BotMailBot {
  id: string;
  name: string;
  /** The owner's Perspicax user id; null for a bot with no Perspicax owner
   * (it then has no address and is not sent). */
  ownerSub: string | null;
}

/** What `GET /api/bots/:id/inbound-mail` answers (contract C). */
export interface BotInboundMail {
  available: boolean;
  address: string | null;
  enabled: boolean;
}

export const NO_BOT_MAIL: BotInboundMail = Object.freeze({ available: false, address: null, enabled: false });

export interface BotMailAddressesOptions {
  /** The Perspicax link (PerspicaxDirectory), null on a solo server. */
  link: () => { linkPostJson(path: string, body: unknown, limits: { timeoutMs: number; maxBytes: number }): Promise<LinkPostResult> } | null;
  bots: () => BotMailBot[];
  now?: () => number;
  log?: (line: string) => void;
}

interface Snapshot {
  at: number;
  /** The bot ids the call asked for. */
  asked: Set<string>;
  /** Null when the call failed or inbound mail is off. */
  entries: Map<string, BotInboundMail> | null;
}

/** The answer's entries, or null when it is not the contract's. */
export function parseAddresses(body: unknown): Map<string, BotInboundMail> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { enabled, addresses } = body as { enabled?: unknown; addresses?: unknown };
  if (typeof enabled !== "boolean" || !Array.isArray(addresses)) return null;
  const entries = new Map<string, BotInboundMail>();
  if (!enabled) return entries;
  for (const item of addresses) {
    if (!item || typeof item !== "object") return null;
    const { bot_id: botId, address, enabled: on } = item as { bot_id?: unknown; address?: unknown; enabled?: unknown };
    if (typeof botId !== "string" || typeof on !== "boolean") return null;
    if (address === null) continue;
    if (typeof address !== "string" || address.length > 320 || !ADDRESS.test(address)) return null;
    entries.set(botId, { available: true, address, enabled: on });
  }
  return entries;
}

export class BotMailAddresses {
  private readonly options: BotMailAddressesOptions;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private snapshot: Snapshot | null = null;
  private inflight: Promise<Snapshot> | null = null;
  private readonly logged = new Set<string>();

  constructor(options: BotMailAddressesOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
  }

  /** The bot's address, from the cache when it is fresh and covers it. */
  async forBot(botId: string): Promise<BotInboundMail> {
    const link = this.options.link();
    if (!link) return NO_BOT_MAIL;
    const bot = this.options.bots().find((candidate) => candidate.id === botId);
    if (!bot?.ownerSub) return NO_BOT_MAIL;
    let snapshot = this.snapshot;
    const fresh = snapshot && this.now() - snapshot.at < BOT_MAIL_CACHE_MS;
    if (!snapshot || !fresh || !snapshot.asked.has(botId)) snapshot = await this.refresh(botId);
    return snapshot.entries?.get(botId) ?? NO_BOT_MAIL;
  }

  /** Forget the cached answer (a bot renamed, created or deleted). */
  invalidate(): void {
    this.snapshot = null;
  }

  private refresh(first: string): Promise<Snapshot> {
    // One call at a time; a read that waits gets that call's answer.
    this.inflight ??= this.fetch(first).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetch(first: string): Promise<Snapshot> {
    const link = this.options.link();
    const owned = this.options.bots().filter((bot) => bot.ownerSub);
    const ordered = [...owned.filter((bot) => bot.id === first), ...owned.filter((bot) => bot.id !== first)].slice(0, BOT_MAIL_BATCH_MAX);
    const at = this.now();
    const asked = new Set(ordered.map((bot) => bot.id));
    let entries: Map<string, BotInboundMail> | null = null;
    if (link && ordered.length) {
      const result = await link.linkPostJson(BOT_MAIL_ADDRESSES_PATH, {
        bots: ordered.map((bot) => ({ id: bot.id, name: bot.name, owner_sub: bot.ownerSub })),
      }, { timeoutMs: TIMEOUT_MS, maxBytes: ANSWER_MAX_BYTES });
      if (result.ok) {
        entries = parseAddresses(result.body);
        if (!entries) this.once("shape", "bot mail: Perspicax's address answer is not the expected shape; no address shown");
      } else if (result.status !== 404) {
        this.once(`error:${result.error}`, `bot mail: Perspicax addresses unavailable (${result.error}${result.status ? ` ${result.status}` : ""})`);
      }
    }
    const snapshot: Snapshot = { at, asked, entries };
    this.snapshot = snapshot;
    return snapshot;
  }

  private once(kind: string, line: string): void {
    if (this.logged.has(kind)) return;
    this.logged.add(kind);
    this.log(line);
  }
}
