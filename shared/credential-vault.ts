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
/** Second levels that registries sell under a country code (co.uk,
 * com.au, gc.ca...): a wildcard under one of them would cover strangers. A
 * heuristic, not the public suffix list; exact hosts are the default. */
const SHARED_SECOND_LEVEL = /^(?:co|com|net|org|gov|edu|ac|or|ne|go|gob|gouv|nic|ltd|plc|sch|mil|gc|qc|on|bc|ab)\.[a-z]{2}$/;

/** A site binding as stored. Exact by default:
 *
 *   example.com             https://example.com only (default port)
 *   example.com:8443        that host on that port, https
 *   *.example.com           any subdomain of example.com, never the apex
 *   http://localhost:3000   the one plain-http binding: localhost, with a port
 *
 * Lower case, punycode for an international name. Null when it is not one of
 * these: an IP literal, a bare TLD, a wildcard on a shared suffix (co.uk), a
 * plain-http binding other than localhost. */
export function normalizeVaultDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().toLowerCase();
  if (!value || value.length > 253 + 32) return null;
  const http = value.startsWith("http://");
  const wildcard = !http && /^(?:https:\/\/)?\*\./.test(value);
  if (wildcard) value = value.replace(/^(?:https:\/\/)?\*\./, "");
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\.+|\.+$/g, "");
  const port = url.port ? `:${url.port}` : "";
  if (url.protocol === "http:") return host === "localhost" && port && !wildcard ? `http://localhost${port}` : null;
  if (host === "localhost") return wildcard ? null : `localhost${port}`;
  if (!host || host.length > 253 || host.includes("[") || /^[0-9.]+$/.test(host)) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => HOST_LABEL.test(label))) return null;
  if (/^[0-9]+$/.test(labels.at(-1)!)) return null;
  if (wildcard && (SHARED_SECOND_LEVEL.test(host) || port)) return null;
  return `${wildcard ? "*." : ""}${host}${port}`;
}

/** Whether a page may receive a value bound to these sites (see
 * normalizeVaultDomain): the same scheme, host and port, or a subdomain for
 * a "*." binding. A look-alike ("example.com.evil.test", "badexample.com")
 * never matches, nor a URL that carries a user name. */
export function vaultDomainMatches(domains: readonly string[], pageUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  const port = url.port ? `:${url.port}` : "";
  return domains.some((domain) => {
    if (domain.startsWith("http://")) return url.protocol === "http:" && `http://${host}${port}` === domain;
    if (url.protocol !== "https:") return false;
    if (domain.startsWith("*.")) return !port && host.endsWith(`.${domain.slice(2)}`);
    return `${host}${port}` === domain;
  });
}

/** A page URL a binding would match, for comparing a request with items. */
export function bindingUrl(domain: string): string {
  if (domain.startsWith("http://")) return `${domain}/`;
  return `https://${domain.replace(/^\*\./, "www.")}/`;
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
