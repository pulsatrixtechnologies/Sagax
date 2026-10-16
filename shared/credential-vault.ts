// The credential vault's shapes and rules shared by the server and the app
// (server/credential-vault.ts keeps the encrypted store). Pure: no secret
// value ever appears in a type here, only whether one is saved.
//
// A login is filled into a page by reference: the bot names the item's
// handle, the browser runtime resolves the value at fill time and only on a
// page whose top-level origin matches one of the item's domains
// (server/credential-fill.ts). The bot never reads the value back.

/** The fixed target of a vault request card (kind "secret", target
 * vaultLogin). It is not one of the API keys of shared/credential-request.ts:
 * the card grants a bot the use of a saved login instead of asking for a key. */
export const VAULT_LOGIN_TARGET = "vaultLogin" as const;
export type VaultLoginTarget = typeof VAULT_LOGIN_TARGET;

export const VAULT_ITEM_KINDS = ["login", "apiKey", "note"] as const;
export type VaultItemKind = (typeof VAULT_ITEM_KINDS)[number];

/** A field the browser runtime can fill. */
export const VAULT_FILL_FIELDS = ["username", "password", "totp", "apiKey"] as const;
export type VaultFillField = (typeof VAULT_FILL_FIELDS)[number];

/** once: this conversation, for a short while. always: this bot, until revoked. */
export const VAULT_GRANT_MODES = ["once", "always"] as const;
export type VaultGrantMode = (typeof VAULT_GRANT_MODES)[number];

/** How long a "once" grant lasts in the conversation that asked. */
export const VAULT_ONCE_GRANT_MS = 15 * 60_000;

export const MAX_VAULT_ITEMS = 500;
export const MAX_VAULT_DOMAINS = 10;

export interface VaultGrantListing {
  botId: string;
  mode: VaultGrantMode;
  /** once: the conversation it holds in. */
  threadId?: string;
  grantedAt: number;
  /** once: when it ends. */
  expiresAt?: number;
}

/** What the person's own screen (and a request card) sees of an item. */
export interface VaultItemListing {
  id: string;
  kind: VaultItemKind;
  name: string;
  /** login: the user name is shown to the owner only, never to a bot. */
  username?: string;
  domains: string[];
  hasPassword: boolean;
  hasTotp: boolean;
  hasApiKey: boolean;
  hasNotes: boolean;
  /** "1password": a read-only reference resolved at fill time. */
  source: "local" | "1password";
  grants: VaultGrantListing[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  lastUsedBy?: string;
}

/** What a vault request card carries (message.secret.vault). */
export interface VaultRequestCardData {
  /** The name the bot asked for (free text it chose; shown, never trusted). */
  name?: string;
  /** The site it needs a login for, normalized. */
  domain?: string;
  /** The item the person chose, once they answered. */
  itemId?: string;
  itemName?: string;
  mode?: VaultGrantMode;
  /** The person whose vault answers (organization server). */
  principalId: string;
}

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** A bound domain as stored: lower case, no scheme, port, path or leading
 * dot, punycode for an international name. Null when it is not a host name
 * (an IP literal is refused: a login is bound to a name, not an address,
 * except localhost for a local test page). */
export function normalizeVaultDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().toLowerCase();
  if (!value || value.length > 253 + 16) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `https://${value}`;
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^\.+|\.+$/g, "");
  if (host === "localhost") return host;
  if (!host || host.length > 253 || host.includes("[") || /^[0-9.]+$/.test(host)) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => HOST_LABEL.test(label))) return null;
  if (/^[0-9]+$/.test(labels.at(-1)!)) return null;
  return host;
}

/** Whether a page may receive a value bound to these domains: https (http
 * only for localhost), and a host equal to a bound domain or under it. A
 * look-alike ("example.com.evil.test", "badexample.com") never matches. */
export function vaultDomainMatches(domains: readonly string[], pageUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  const local = host === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return false;
  return domains.some((domain) => host === domain || (!local && domain !== "localhost" && host.endsWith(`.${domain}`)));
}

export function isVaultFillField(value: unknown): value is VaultFillField {
  return typeof value === "string" && (VAULT_FILL_FIELDS as readonly string[]).includes(value);
}

export function isVaultGrantMode(value: unknown): value is VaultGrantMode {
  return typeof value === "string" && (VAULT_GRANT_MODES as readonly string[]).includes(value);
}

/** The opaque handle a bot uses for an item: never the value, never the
 * item's internal file layout. */
export function vaultHandle(itemId: string): string {
  return `cred_${itemId}`;
}

export function itemIdFromHandle(handle: unknown): string | null {
  if (typeof handle !== "string") return null;
  const match = /^cred_([a-z0-9]{8,40})$/.exec(handle.trim());
  return match ? match[1]! : null;
}
