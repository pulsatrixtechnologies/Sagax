// The credential vault: logins (user name, password, one-time code seed),
// API keys and notes a person keeps for their bots, with the bots each item
// is granted to. One encrypted file per person:
//
//   solo or desktop       DATA_DIR/credential-vault.enc
//   organization server   DATA_DIR/principals/<pid>/credential-vault.enc
//
// AES-256-GCM with a key derived (HKDF) from the server's vault key, the one
// mcp-oauth.enc uses (server/mcp-oauth.ts resolveVaultKey): on the desktop
// that key lives in the OS keychain through Electron safeStorage
// (credentials.bin) and reaches the server as SAGAX_MCP_OAUTH_KEY; a
// headless server keeps it in a 0600 key file beside its data. The
// additional data names the person, so a file copied into another person's
// folder does not open.
//
// Nothing here returns a value to a caller other than resolveForFill, which
// only the browser runtime's fill path calls (server/credential-fill.ts),
// after the grant and the page's origin are checked. Listings carry booleans.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import {
  bindingUrl,
  MAX_VAULT_DOMAINS,
  MAX_VAULT_ITEMS,
  VAULT_GRANT_MODES,
  VAULT_ITEM_KINDS,
  VAULT_ONCE_GRANT_MS,
  itemIdFromHandle,
  normalizeVaultDomain,
  vaultDomainMatches,
  type VaultFillField,
  type VaultGrantMode,
  type VaultItemKind,
  type VaultItemListing,
} from "../shared/credential-vault.ts";
import { mergePatch, planVaultImport, type VaultDuplicateMode, type VaultExportFormat, type VaultTransferItem } from "../shared/credential-vault-transfer.ts";
import { writeFileAtomic } from "./atomic.ts";
import type { VaultKeySource } from "./mcp-oauth.ts";
import { principalDir } from "./person-connections.ts";
import { parseTotpSeed, totp } from "./totp.ts";

export const LOCAL_VAULT_PRINCIPAL = "local";
const FILE = "credential-vault.enc";
const AAD_PREFIX = "sagax credential-vault v1";
const HKDF_INFO = Buffer.from("sagax credential-vault key v1");
const BOT_ID = /^[\w-]{1,128}$/;
const THREAD_ID = /^[\w:.-]{1,200}$/;

const grantSchema = z.object({
  botId: z.string().regex(BOT_ID),
  mode: z.enum(VAULT_GRANT_MODES),
  threadId: z.string().regex(THREAD_ID).optional(),
  grantedAt: z.number(),
  expiresAt: z.number().optional(),
}).strict();

const onePasswordRefSchema = z.object({
  via: z.enum(["cli", "connect"]),
  vaultId: z.string().min(1).max(128),
  itemId: z.string().min(1).max(128),
}).strict();

const itemSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{8,40}$/),
  kind: z.enum(VAULT_ITEM_KINDS),
  name: z.string().min(1).max(120),
  username: z.string().max(512).optional(),
  domains: z.array(z.string()).max(MAX_VAULT_DOMAINS),
  password: z.string().max(4_096).optional(),
  totpSeed: z.string().max(1_024).optional(),
  apiKey: z.string().max(16_384).optional(),
  notes: z.string().max(16_384).optional(),
  source: z.enum(["local", "1password"]),
  onePassword: onePasswordRefSchema.optional(),
  grants: z.array(grantSchema).max(200),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastUsedAt: z.number().optional(),
  lastUsedBy: z.string().regex(BOT_ID).optional(),
}).strict();

const documentSchema = z.object({
  version: z.literal(1),
  items: z.record(z.string(), itemSchema),
}).strict();

export type StoredVaultItem = z.infer<typeof itemSchema>;
export type OnePasswordRef = z.infer<typeof onePasswordRefSchema>;
type VaultDocument = z.infer<typeof documentSchema>;

export class CredentialVaultError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** What a person types to create or change an item. A secret field left
 * out keeps its value; an empty string clears it. */
export interface VaultItemInput {
  kind?: unknown;
  name?: unknown;
  username?: unknown;
  domains?: unknown;
  password?: unknown;
  totpSeed?: unknown;
  apiKey?: unknown;
  notes?: unknown;
}

/** Reads a 1Password item's field at fill time (server/onepassword.ts). */
export type OnePasswordFieldReader = (ref: OnePasswordRef, field: VaultFillField) => Promise<string | null>;

export interface VaultImportOutcome {
  created: number;
  merged: number;
  /** Matched a saved item and left as it was. */
  duplicates: number;
  /** Repeated an earlier item of the file. */
  inFile: number;
  /** Over the vault's item limit. */
  overLimit: number;
  /** Refused by the vault's rules (a seed it cannot read, a site it refuses). */
  refused: number;
}

export type FillResolution =
  | { ok: true; value: string; item: VaultItemListing; field: VaultFillField }
  | { ok: false; code: "unknown_item" | "not_granted" | "wrong_origin" | "no_value" | "unavailable"; message: string };

function deriveKey(source: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", source, Buffer.alloc(0), HKDF_INFO, 32));
}

function aad(principalId: string): Buffer {
  return Buffer.from(`${AAD_PREFIX}\0${principalId}`);
}

function newItemId(): string {
  return randomBytes(12).toString("hex");
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new CredentialVaultError(`${field} must be text`, "invalid_field");
  if (value.length > max) throw new CredentialVaultError(`${field} is too long`, "invalid_field");
  return value;
}

function domainsFrom(value: unknown): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : null;
  if (!list) throw new CredentialVaultError("domains must be a list of site names", "invalid_domains");
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw === "string" && !raw.trim()) continue;
    const domain = normalizeVaultDomain(raw);
    if (!domain) throw new CredentialVaultError("A site must be a name such as example.com", "invalid_domains");
    if (!out.includes(domain)) out.push(domain);
  }
  if (out.length > MAX_VAULT_DOMAINS) throw new CredentialVaultError(`At most ${MAX_VAULT_DOMAINS} sites per item`, "invalid_domains");
  return out;
}

function activeGrants(item: StoredVaultItem, now: number): StoredVaultItem["grants"] {
  return item.grants.filter((grant) => grant.mode === "always" || (grant.expiresAt ?? 0) > now);
}

export function listingOf(item: StoredVaultItem, now: number = Date.now()): VaultItemListing {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    ...(item.username ? { username: item.username } : {}),
    domains: [...item.domains],
    hasPassword: Boolean(item.password) || (item.source === "1password" && item.kind === "login"),
    hasTotp: Boolean(item.totpSeed),
    hasApiKey: Boolean(item.apiKey),
    hasNotes: Boolean(item.notes),
    source: item.source,
    grants: activeGrants(item, now).map((grant) => ({ ...grant })),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.lastUsedAt ? { lastUsedAt: item.lastUsedAt } : {}),
    ...(item.lastUsedBy ? { lastUsedBy: item.lastUsedBy } : {}),
  };
}

export class CredentialVault {
  private readonly dataDir: string;
  private readonly keySource: () => VaultKeySource;
  private readonly now: () => number;
  private readonly cache = new Map<string, VaultDocument>();

  constructor(dataDir: string, keySource: () => VaultKeySource, now: () => number = Date.now) {
    this.dataDir = dataDir;
    this.keySource = keySource;
    this.now = now;
  }

  private file(principalId: string): string {
    if (principalId === LOCAL_VAULT_PRINCIPAL) return join(this.dataDir, FILE);
    return join(principalDir(this.dataDir, principalId), FILE);
  }

  private key(): Buffer {
    const source = this.keySource();
    if (source.kind !== "key") throw new CredentialVaultError(source.reason, "vault_unavailable", 503);
    return deriveKey(source.key);
  }

  /** Never an empty document in place of one that could not be opened, so
   * a wrong key can never overwrite saved items. */
  private load(principalId: string): VaultDocument {
    const cached = this.cache.get(principalId);
    if (cached) return cached;
    const key = this.key();
    let raw: string;
    try {
      raw = readFileSync(this.file(principalId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const empty: VaultDocument = { version: 1, items: {} };
        this.cache.set(principalId, empty);
        return empty;
      }
      throw new CredentialVaultError("The credential vault could not be read.", "vault_unavailable", 503);
    }
    try {
      const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
      if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") {
        throw new Error("format");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(aad(principalId));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
      const document = documentSchema.parse(JSON.parse(plain));
      this.cache.set(principalId, document);
      return document;
    } catch {
      throw new CredentialVaultError("The credential vault could not be decrypted on this launch.", "vault_unavailable", 503);
    }
  }

  private write(principalId: string, document: VaultDocument): void {
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad(principalId));
    const data = Buffer.concat([cipher.update(JSON.stringify(document), "utf8"), cipher.final()]);
    const envelope = { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
    const file = this.file(principalId);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileAtomic(file, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
    this.cache.set(principalId, document);
  }

  private mutate<T>(principalId: string, change: (items: Record<string, StoredVaultItem>) => T): T {
    const document = this.load(principalId);
    const items = structuredClone(document.items);
    const result = change(items);
    this.write(principalId, { version: 1, items });
    return result;
  }

  /** Whether the vault can be opened now, and why not. */
  unavailableReason(principalId: string): string | null {
    try {
      this.load(principalId);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  list(principalId: string): VaultItemListing[] {
    const now = this.now();
    return Object.values(this.load(principalId).items)
      .map((item) => listingOf(item, now))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  item(principalId: string, itemId: string): VaultItemListing | null {
    const item = this.load(principalId).items[itemId];
    return item ? listingOf(item, this.now()) : null;
  }

  /** The owner's own look at a note (Settings > Credentials, "Show"). */
  revealNotes(principalId: string, itemId: string): string {
    const item = this.load(principalId).items[itemId];
    if (!item) throw new CredentialVaultError("No such item", "unknown_item", 404);
    return item.notes ?? "";
  }

  create(principalId: string, input: VaultItemInput, extra: { source?: "local" | "1password"; onePassword?: OnePasswordRef } = {}): VaultItemListing {
    const kind = (VAULT_ITEM_KINDS as readonly unknown[]).includes(input.kind ?? "login") ? (input.kind ?? "login") as VaultItemKind : null;
    if (!kind) throw new CredentialVaultError("kind must be login, apiKey or note", "invalid_kind");
    const now = this.now();
    const item: StoredVaultItem = {
      id: newItemId(),
      kind,
      name: "",
      domains: [],
      source: extra.source ?? "local",
      ...(extra.onePassword ? { onePassword: extra.onePassword } : {}),
      grants: [],
      createdAt: now,
      updatedAt: now,
    };
    applyInput(item, input, true);
    return this.mutate(principalId, (items) => {
      if (Object.keys(items).length >= MAX_VAULT_ITEMS) throw new CredentialVaultError(`At most ${MAX_VAULT_ITEMS} items`, "vault_full", 409);
      items[item.id] = item;
      return listingOf(item, now);
    });
  }

  update(principalId: string, itemId: string, input: VaultItemInput): VaultItemListing {
    const now = this.now();
    return this.mutate(principalId, (items) => {
      const item = items[itemId];
      if (!item) throw new CredentialVaultError("No such item", "unknown_item", 404);
      if (input.kind !== undefined && input.kind !== item.kind) throw new CredentialVaultError("An item keeps its kind", "invalid_kind");
      if (item.source === "1password" && ["password", "totpSeed", "apiKey", "username"].some((field) => (input as Record<string, unknown>)[field] !== undefined)) {
        throw new CredentialVaultError("A 1Password item is read-only here; change it in 1Password.", "read_only");
      }
      applyInput(item, input, false);
      item.updatedAt = now;
      return listingOf(item, now);
    });
  }

  remove(principalId: string, itemId: string): boolean {
    return this.mutate(principalId, (items) => {
      if (!items[itemId]) return false;
      delete items[itemId];
      return true;
    });
  }

  /** once: this conversation for VAULT_ONCE_GRANT_MS. always: the bot,
   * anywhere, until revoked. A new grant replaces the bot's earlier one. */
  grant(principalId: string, itemId: string, grant: { botId: string; mode: VaultGrantMode; threadId?: string }): VaultItemListing {
    if (!BOT_ID.test(grant.botId)) throw new CredentialVaultError("invalid bot", "invalid_bot");
    if (grant.mode === "once" && !(grant.threadId && THREAD_ID.test(grant.threadId))) {
      throw new CredentialVaultError("A one-time grant needs its conversation", "invalid_thread");
    }
    const now = this.now();
    return this.mutate(principalId, (items) => {
      const item = items[itemId];
      if (!item) throw new CredentialVaultError("No such item", "unknown_item", 404);
      const kept = activeGrants(item, now).filter((row) => !(row.botId === grant.botId && (grant.mode === "always" || row.threadId === grant.threadId)));
      kept.push(grant.mode === "always"
        ? { botId: grant.botId, mode: "always", grantedAt: now }
        : { botId: grant.botId, mode: "once", threadId: grant.threadId!, grantedAt: now, expiresAt: now + VAULT_ONCE_GRANT_MS });
      item.grants = kept;
      return listingOf(item, now);
    });
  }

  revoke(principalId: string, itemId: string, botId: string): VaultItemListing {
    const now = this.now();
    return this.mutate(principalId, (items) => {
      const item = items[itemId];
      if (!item) throw new CredentialVaultError("No such item", "unknown_item", 404);
      item.grants = activeGrants(item, now).filter((row) => row.botId !== botId);
      return listingOf(item, now);
    });
  }

  /** Items a bot's request names: by site (an item bound to the domain or
   * to a parent of it) or by name. Listings only. */
  find(principalId: string, query: { name?: string; domain?: string }): VaultItemListing[] {
    const domain = query.domain ? normalizeVaultDomain(query.domain) : null;
    const name = query.name?.trim().toLowerCase();
    return this.list(principalId).filter((item) =>
      (domain && vaultDomainMatches(item.domains, bindingUrl(domain))) ||
      (name && item.name.toLowerCase().includes(name)));
  }

  /** Whether this bot may use the item in this conversation now. */
  granted(principalId: string, itemId: string, botId: string, threadId: string): boolean {
    const item = this.load(principalId).items[itemId];
    if (!item) return false;
    return activeGrants(item, this.now()).some((grant) => grant.botId === botId && (grant.mode === "always" || grant.threadId === threadId));
  }

  /** Whether this bot may use any item in this conversation now: its own
   * page scripts are then off in its browser (server/browser-runtime.ts). A
   * vault that cannot be opened counts as armed, the safe side. */
  armed(principalId: string, botId: string, threadId: string): boolean {
    let items: Record<string, StoredVaultItem>;
    try {
      items = this.load(principalId).items;
    } catch {
      return true;
    }
    const now = this.now();
    return Object.values(items).some((item) => activeGrants(item, now).some((grant) => grant.botId === botId && (grant.mode === "always" || grant.threadId === threadId)));
  }

  /** The value to fill, only for a granted bot and a page whose top-level
   * URL is on one of the item's sites. Marks the item used. The caller must
   * never put the value in a tool result, a message or a log. */
  async resolveForFill(
    principalId: string,
    request: { handle: unknown; field: VaultFillField; botId: string; threadId: string; pageUrl: string },
    readOnePassword?: OnePasswordFieldReader,
  ): Promise<FillResolution> {
    const itemId = itemIdFromHandle(request.handle);
    let item: StoredVaultItem | undefined;
    try {
      item = itemId ? this.load(principalId).items[itemId] : undefined;
    } catch (error) {
      return { ok: false, code: "unavailable", message: error instanceof Error ? error.message : "The credential vault is unavailable." };
    }
    if (!item) return { ok: false, code: "unknown_item", message: "No saved credential has this handle. Call request_login to ask the person for one." };
    if (!this.granted(principalId, item.id, request.botId, request.threadId)) {
      return { ok: false, code: "not_granted", message: `You are not allowed to use "${item.name}" here. Call request_login so the person can allow it.` };
    }
    if (!item.domains.length || !vaultDomainMatches(item.domains, request.pageUrl)) {
      return { ok: false, code: "wrong_origin", message: `"${item.name}" is only filled on ${item.domains.join(", ") || "its own sites"} over https, and this page is not one of them. Nothing was filled.` };
    }
    let value: string | null = null;
    if (item.source === "1password" && item.onePassword && request.field !== "totp") {
      if (!readOnePassword) return { ok: false, code: "unavailable", message: "1Password is not available on this computer right now. Nothing was filled." };
      try {
        value = await readOnePassword(item.onePassword, request.field);
      } catch {
        return { ok: false, code: "unavailable", message: "1Password did not answer. Nothing was filled." };
      }
    } else if (request.field === "username") value = item.username ?? null;
    else if (request.field === "password") value = item.password ?? null;
    else if (request.field === "apiKey") value = item.apiKey ?? null;
    else if (request.field === "totp") {
      const params = item.totpSeed ? parseTotpSeed(item.totpSeed) : null;
      value = params ? totp(params, this.now()) : null;
      if (!value && item.source === "1password" && item.onePassword && readOnePassword) {
        try { value = await readOnePassword(item.onePassword, "totp"); } catch { value = null; }
      }
    }
    if (!value) return { ok: false, code: "no_value", message: `"${item.name}" has no ${request.field === "totp" ? "one-time code" : request.field} saved. Nothing was filled.` };
    const now = this.now();
    try {
      this.mutate(principalId, (items) => {
        const current = items[item.id];
        if (current) {
          current.lastUsedAt = now;
          current.lastUsedBy = request.botId;
          current.grants = activeGrants(current, now);
        }
      });
    } catch {
      // the fill still happens; only "last used" is not recorded
    }
    return { ok: true, value, item: listingOf(item, now), field: request.field };
  }

  /** Items read from another manager's file (Settings > Credentials,
   * Import), in one write: new ones created, ones that match a saved item
   * merged or left out (shared/credential-vault-transfer.ts
   * planVaultImport). An item the vault refuses is counted by its
   * position, never echoed. */
  importItems(principalId: string, input: readonly VaultTransferItem[], mode: VaultDuplicateMode): VaultImportOutcome {
    const now = this.now();
    return this.mutate(principalId, (items) => {
      const existing = Object.values(items).map((item) => ({ id: item.id, kind: item.kind, name: item.name, ...(item.username ? { username: item.username } : {}), domains: item.domains, source: item.source }));
      const plan = planVaultImport(input, existing, mode, MAX_VAULT_ITEMS - Object.keys(items).length);
      const outcome: VaultImportOutcome = { created: 0, merged: 0, duplicates: plan.duplicates, inFile: plan.inFile, overLimit: plan.overLimit, refused: 0 };
      for (const entry of plan.create) {
        const item: StoredVaultItem = { id: newItemId(), kind: entry.kind, name: "", domains: [], source: "local", grants: [], createdAt: now, updatedAt: now };
        try {
          applyInput(item, { name: entry.name, domains: entry.domains, username: entry.username, password: entry.password, totpSeed: entry.totpSeed, apiKey: entry.apiKey, notes: entry.notes }, true);
        } catch {
          outcome.refused++;
          continue;
        }
        items[item.id] = item;
        outcome.created++;
      }
      for (const { id, item: entry } of plan.merge) {
        const current = items[id];
        if (!current) continue;
        const next = structuredClone(current);
        try {
          // a bot allowed on this item never gains a site from a file
          applyInput(next, mergePatch(current, entry, { keepSites: activeGrants(current, now).length > 0 }), false);
        } catch {
          outcome.refused++;
          continue;
        }
        next.updatedAt = now;
        items[id] = next;
        outcome.merged++;
      }
      return outcome;
    });
  }

  /** The person's own items with their values, for an export file the
   * person asked for (the route checks a fresh sign-in or their security
   * key first). A 1Password item holds no value here and is left out.
   * Only what the format holds leaves the vault: Chrome CSV takes logins
   * without their one-time code seed. */
  exportItems(principalId: string, format: VaultExportFormat): { items: VaultTransferItem[]; onePassword: number; notInFormat: number; totpNotInFormat: number } {
    const all = Object.values(this.load(principalId).items).sort((left, right) => left.name.localeCompare(right.name));
    const items: VaultTransferItem[] = [];
    let onePassword = 0;
    let notInFormat = 0;
    let totpNotInFormat = 0;
    for (const item of all) {
      if (item.source !== "local") {
        onePassword++;
        continue;
      }
      if (format === "chrome-csv" && item.kind !== "login") {
        notInFormat++;
        continue;
      }
      if (format === "chrome-csv" && item.totpSeed) totpNotInFormat++;
      items.push({
        kind: item.kind,
        name: item.name,
        domains: [...item.domains],
        ...(item.username ? { username: item.username } : {}),
        ...(item.password ? { password: item.password } : {}),
        ...(item.totpSeed && format !== "chrome-csv" ? { totpSeed: item.totpSeed } : {}),
        ...(item.apiKey ? { apiKey: item.apiKey } : {}),
        ...(item.notes ? { notes: item.notes } : {}),
      });
    }
    return { items, onePassword, notInFormat, totpNotInFormat };
  }

  /** Forget a person's whole vault (their account is deleted). */
  drop(principalId: string): void {
    rmSync(this.file(principalId), { force: true });
    this.cache.delete(principalId);
  }
}

function applyInput(item: StoredVaultItem, input: VaultItemInput, creating: boolean): void {
  if (input.name !== undefined || creating) {
    const name = text(input.name ?? "", "name", 120).trim();
    if (!name) throw new CredentialVaultError("A name is required", "invalid_name");
    item.name = name;
  }
  if (input.domains !== undefined) item.domains = domainsFrom(input.domains);
  if (input.username !== undefined) {
    const username = text(input.username, "username", 512).trim();
    if (username) item.username = username;
    else delete item.username;
  }
  if (input.password !== undefined) {
    const password = text(input.password, "password", 4_096);
    if (password) item.password = password;
    else delete item.password;
  }
  if (input.totpSeed !== undefined) {
    const seed = text(input.totpSeed, "one-time code seed", 1_024).trim();
    if (seed && !parseTotpSeed(seed)) throw new CredentialVaultError("The one-time code seed must be a base32 secret or an otpauth:// link", "invalid_totp");
    if (seed) item.totpSeed = seed;
    else delete item.totpSeed;
  }
  if (input.apiKey !== undefined) {
    const apiKey = text(input.apiKey, "API key", 16_384).trim();
    if (apiKey) item.apiKey = apiKey;
    else delete item.apiKey;
  }
  if (input.notes !== undefined) {
    const notes = text(input.notes, "notes", 16_384);
    if (notes.trim()) item.notes = notes;
    else delete item.notes;
  }
  if (item.kind === "login" && !item.domains.length) {
    throw new CredentialVaultError("A login needs at least one site it may be filled on", "invalid_domains");
  }
}

/** The browser runtime's view of the vault for one turn
 * (server/browser-runtime.ts CredentialFillAccess): this person's vault, this
 * bot, this conversation. */
export function fillResolverFor(
  vault: CredentialVault,
  context: { principalId: string; botId: string; threadId: string },
  readOnePassword?: OnePasswordFieldReader,
): {
  resolve(request: { handle: string; field: VaultFillField; pageUrl: string }): Promise<{ ok: true; value: string; label: string } | { ok: false; message: string }>;
  armed(): boolean;
} {
  return {
    async resolve(request) {
      const resolved = await vault.resolveForFill(context.principalId, { ...request, botId: context.botId, threadId: context.threadId }, readOnePassword);
      return resolved.ok ? { ok: true, value: resolved.value, label: resolved.item.name } : { ok: false, message: resolved.message };
    },
    armed: () => vault.armed(context.principalId, context.botId, context.threadId),
  };
}
