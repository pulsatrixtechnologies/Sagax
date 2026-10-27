// "Me joindre" settings and reply codes on disk (2026-10-26):
//
//   <data>/reach-me.json        each person's choice for each bot (mode 0600:
//                               it holds their own phone number)
//   <data>/reach-me-codes.json  the reply codes still open (mode 0600)
//
// A person's settings are keyed by the person who answers the cards
// (principal id, or this computer's operator) and the bot. Telegram's bot
// token and WhatsApp's access token are not here: they are sealed apart
// (./secrets.ts).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomInt } from "node:crypto";

import { DEFAULT_REACH_ME, parseReachMe, REACH_CODE_ALPHABET, type ReachChannelId, type ReachMeSettings } from "../../shared/reach-me.ts";
import { writeFileAtomic } from "../atomic.ts";

export const REACH_ME_FILE = "reach-me.json";
export const REACH_ME_CODES_FILE = "reach-me-codes.json";
/** A code lives as long as its card, and a day at most. */
export const REACH_CODE_TTL_MS = 24 * 60 * 60_000;
/** Open codes per person: older ones go first. */
export const REACH_CODES_PER_PERSON = 50;

const personKey = (person: string) => person.trim().toLowerCase();
const entryKey = (person: string, botId: string) => `${personKey(person)}\u0000${botId}`;

/** Telegram's link to the person's own chat (no token: that is sealed). */
export interface ReachTelegramLink {
  /** The bot's @username from BotFather (getMe), shown to the person. */
  username: string;
  /** The private chat the person opened with /start, once linked. */
  chatId?: number;
  /** The /start code waiting for the person, until linked. */
  linkCode?: string;
  linkExpiresAt?: number;
}

/** WhatsApp's link to the person's own number (no token: that is sealed). */
export interface ReachWhatsAppLink {
  /** The business number's Phone Number ID at Meta (never shown). */
  phoneNumberId: string;
  /** What Meta says the business number is (display number, verified name). */
  displayNumber: string;
  verifiedName?: string;
  /** The webhook path id (`/reach-me/whatsapp/<id>` on the webhook receiver). */
  endpointId: string;
  /** What the person pastes as "Verify token" in their Meta app's webhook. */
  verifyToken: string;
  /** The person's own WhatsApp number, E.164, once proven by the code. */
  number?: string;
  /** The code waiting for the person, until linked. */
  linkCode?: string;
  linkExpiresAt?: number;
  /** The number the code went to by template (the person typed it). */
  pendingNumber?: string;
  /** The person's last message: WhatsApp's 24 hour window for free text. */
  lastInboundAt?: number;
  /** The approved message template for a card outside that window, with one
   * body parameter ({{1}}): its name and language code at Meta. */
  templateName?: string;
  templateLanguage?: string;
}

interface StoredEntry {
  person: string;
  botId: string;
  settings: ReachMeSettings;
  telegram?: ReachTelegramLink;
  whatsapp?: ReachWhatsAppLink;
  updatedAt: number;
}

export interface ReachMeStore {
  /** The saved settings, or null when the person never chose for this bot. */
  get(person: string, botId: string): ReachMeSettings | null;
  /** The saved settings, else the default (push only, any hour). */
  effective(person: string, botId: string): ReachMeSettings;
  set(person: string, botId: string, settings: ReachMeSettings): ReachMeSettings;
  telegram(person: string, botId: string): ReachTelegramLink | undefined;
  setTelegram(person: string, botId: string, link: ReachTelegramLink | undefined): void;
  /** Every saved entry with a Telegram link (the poller's list). */
  telegramLinks(): Array<{ person: string; botId: string; link: ReachTelegramLink }>;
  whatsapp(person: string, botId: string): ReachWhatsAppLink | undefined;
  setWhatsApp(person: string, botId: string, link: ReachWhatsAppLink | undefined): void;
  /** The entry a WhatsApp webhook path names. */
  whatsappByEndpoint(endpointId: string): { person: string; botId: string; link: ReachWhatsAppLink } | undefined;
  /** Every saved entry of a person (the sms reply: which number is theirs). */
  entriesOf(person: string): Array<{ botId: string; settings: ReachMeSettings }>;
  /** A bot deleted: its settings go for everyone. */
  removeBot(botId: string): void;
  /** A person removed: their settings go. */
  removePerson(person: string): void;
}

export function createReachMeStore(dataDir: string, now: () => number = Date.now): ReachMeStore {
  const file = join(dataDir, REACH_ME_FILE);
  let entries: Map<string, StoredEntry> | null = null;

  const load = (): Map<string, StoredEntry> => {
    if (entries) return entries;
    entries = new Map();
    if (!existsSync(file)) return entries;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown; entries?: unknown };
      if (raw.version === 1 && Array.isArray(raw.entries)) {
        for (const item of raw.entries as Array<Record<string, unknown>>) {
          if (typeof item?.person !== "string" || typeof item.botId !== "string") continue;
          const parsed = parseReachMe(item.settings);
          if (!parsed.ok) continue;
          const telegram = item.telegram && typeof item.telegram === "object" && typeof (item.telegram as { username?: unknown }).username === "string"
            ? item.telegram as ReachTelegramLink
            : undefined;
          const whatsapp = item.whatsapp && typeof item.whatsapp === "object"
            && typeof (item.whatsapp as { phoneNumberId?: unknown }).phoneNumberId === "string"
            && typeof (item.whatsapp as { endpointId?: unknown }).endpointId === "string"
            ? item.whatsapp as ReachWhatsAppLink
            : undefined;
          entries.set(entryKey(item.person, item.botId), {
            person: personKey(item.person),
            botId: item.botId,
            settings: parsed.settings,
            ...(telegram ? { telegram } : {}),
            ...(whatsapp ? { whatsapp } : {}),
            updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : 0,
          });
        }
      }
    } catch {
      // a damaged file: every bot is back on push only until the person saves again
      console.warn("reach-me: reach-me.json could not be read; ignored");
    }
    return entries;
  };

  const save = () => {
    const all = [...load().values()];
    mkdirSync(dirname(file), { recursive: true });
    writeFileAtomic(file, `${JSON.stringify({ version: 1, entries: all }, null, 2)}\n`, { mode: 0o600 });
  };

  return {
    get(person, botId) {
      const entry = load().get(entryKey(person, botId));
      return entry ? structuredClone(entry.settings) : null;
    },
    effective(person, botId) {
      return this.get(person, botId) ?? structuredClone(DEFAULT_REACH_ME);
    },
    set(person, botId, settings) {
      const key = entryKey(person, botId);
      const existing = load().get(key);
      load().set(key, { person: personKey(person), botId, settings: structuredClone(settings), ...(existing?.telegram ? { telegram: existing.telegram } : {}), ...(existing?.whatsapp ? { whatsapp: existing.whatsapp } : {}), updatedAt: now() });
      save();
      return structuredClone(settings);
    },
    telegram(person, botId) {
      const link = load().get(entryKey(person, botId))?.telegram;
      return link ? { ...link } : undefined;
    },
    setTelegram(person, botId, link) {
      const key = entryKey(person, botId);
      const existing = load().get(key);
      const base: StoredEntry = existing ?? { person: personKey(person), botId, settings: structuredClone(DEFAULT_REACH_ME), updatedAt: now() };
      const next: StoredEntry = { ...base, updatedAt: now() };
      if (link) next.telegram = { ...link };
      else delete next.telegram;
      load().set(key, next);
      save();
    },
    telegramLinks() {
      return [...load().values()].filter((entry) => entry.telegram).map((entry) => ({ person: entry.person, botId: entry.botId, link: { ...entry.telegram! } }));
    },
    whatsapp(person, botId) {
      const link = load().get(entryKey(person, botId))?.whatsapp;
      return link ? { ...link } : undefined;
    },
    setWhatsApp(person, botId, link) {
      const key = entryKey(person, botId);
      const existing = load().get(key);
      const base: StoredEntry = existing ?? { person: personKey(person), botId, settings: structuredClone(DEFAULT_REACH_ME), updatedAt: now() };
      const next: StoredEntry = { ...base, updatedAt: now() };
      if (link) next.whatsapp = { ...link };
      else delete next.whatsapp;
      load().set(key, next);
      save();
    },
    whatsappByEndpoint(endpointId) {
      const entry = [...load().values()].find((row) => row.whatsapp?.endpointId === endpointId);
      return entry ? { person: entry.person, botId: entry.botId, link: { ...entry.whatsapp! } } : undefined;
    },
    entriesOf(person) {
      const who = personKey(person);
      return [...load().values()].filter((entry) => entry.person === who).map((entry) => ({ botId: entry.botId, settings: structuredClone(entry.settings) }));
    },
    removeBot(botId) {
      let changed = false;
      for (const [key, entry] of load()) if (entry.botId === botId) { load().delete(key); changed = true; }
      if (changed) save();
    },
    removePerson(person) {
      const who = personKey(person);
      let changed = false;
      for (const [key, entry] of load()) if (entry.person === who) { load().delete(key); changed = true; }
      if (changed) save();
    },
  };
}

/** One reply code: the card it answers and where it went. */
export interface ReachCode {
  code: string;
  person: string;
  botId: string;
  threadId: string;
  requestId: string;
  kind: "approval" | "question";
  /** The channels this code was sent through: a reply counts only from one of them. */
  channels: ReachChannelId[];
  /** sms: the number it was texted to (a reply must come from it). */
  smsTo?: string;
  /** whatsapp: the number it went to (a reply must come from it). */
  whatsappTo?: string;
  /** teams: when the message went (the reply check reads what came after). */
  teamsSentAt?: number;
  createdAt: number;
  expiresAt: number;
}

export interface ReachCodeStore {
  /** A new code for this card, unique among the person's open codes. The
   * same card asks again: its open code is reused. */
  issue(input: Omit<ReachCode, "code" | "createdAt" | "expiresAt" | "channels"> & { channels?: ReachChannelId[] }): ReachCode;
  update(code: string, person: string, patch: Partial<Pick<ReachCode, "channels" | "smsTo" | "whatsappTo" | "teamsSentAt">>): void;
  find(person: string, code: string): ReachCode | undefined;
  forCard(threadId: string, requestId: string): ReachCode | undefined;
  /** A card settled: its code goes. */
  dropCard(threadId: string, requestId: string): ReachCode | undefined;
  /** Every open code (the hours ticker, the Teams checks). */
  list(): ReachCode[];
}

export function createReachCodeStore(dataDir: string, now: () => number = Date.now, random: (max: number) => number = (max) => randomInt(max)): ReachCodeStore {
  const file = join(dataDir, REACH_ME_CODES_FILE);
  let codes: ReachCode[] | null = null;
  const load = (): ReachCode[] => {
    if (codes) return codes;
    codes = [];
    if (existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown; codes?: unknown };
        if (raw.version === 1 && Array.isArray(raw.codes)) codes = (raw.codes as ReachCode[]).filter((entry) => entry && typeof entry.code === "string" && typeof entry.person === "string");
      } catch {
        codes = [];
      }
    }
    return codes;
  };
  const prune = () => {
    const at = now();
    codes = load().filter((entry) => entry.expiresAt > at);
  };
  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileAtomic(file, `${JSON.stringify({ version: 1, codes: load() }, null, 2)}\n`, { mode: 0o600 });
  };
  const fresh = (person: string): string => {
    const taken = new Set(load().filter((entry) => entry.person === person).map((entry) => entry.code));
    for (let attempt = 0; attempt < 200; attempt += 1) {
      let code = "";
      for (let i = 0; i < 4; i += 1) code += REACH_CODE_ALPHABET[random(REACH_CODE_ALPHABET.length)];
      if (!taken.has(code)) return code;
    }
    throw new Error("no free reply code");
  };
  return {
    issue(input) {
      prune();
      const person = personKey(input.person);
      const open = load().find((entry) => entry.threadId === input.threadId && entry.requestId === input.requestId && entry.person === person);
      if (open) return { ...open };
      const at = now();
      const entry: ReachCode = { ...input, person, channels: input.channels ?? [], code: fresh(person), createdAt: at, expiresAt: at + REACH_CODE_TTL_MS };
      const mine = load().filter((row) => row.person === person);
      if (mine.length >= REACH_CODES_PER_PERSON) {
        const oldest = mine.sort((a, b) => a.createdAt - b.createdAt)[0]!;
        codes = load().filter((row) => row !== oldest);
      }
      load().push(entry);
      save();
      return { ...entry };
    },
    update(code, person, patch) {
      const entry = load().find((row) => row.code === code && row.person === personKey(person));
      if (!entry) return;
      Object.assign(entry, patch);
      save();
    },
    find(person, code) {
      prune();
      const entry = load().find((row) => row.person === personKey(person) && row.code === code.toUpperCase());
      return entry ? { ...entry } : undefined;
    },
    forCard(threadId, requestId) {
      prune();
      const entry = load().find((row) => row.threadId === threadId && row.requestId === requestId);
      return entry ? { ...entry } : undefined;
    },
    dropCard(threadId, requestId) {
      const entry = load().find((row) => row.threadId === threadId && row.requestId === requestId);
      if (!entry) return undefined;
      codes = load().filter((row) => row !== entry);
      save();
      return { ...entry };
    },
    list() {
      prune();
      return load().map((entry) => ({ ...entry }));
    },
  };
}
