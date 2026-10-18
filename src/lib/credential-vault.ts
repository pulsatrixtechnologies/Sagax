// The person's credential vault (server/routes/credential-vault.ts): logins,
// API keys and notes their bots may fill into a page by reference. Nothing
// here ever holds a value the server sent: the server never sends one, only
// booleans that say one is saved. Values typed here go to the server once.
import { api } from "@/state/store";
import { bindingUrl, vaultDomainMatches, type VaultGrantMode, type VaultItemKind, type VaultItemListing } from "../../shared/credential-vault";
import type { VaultDuplicateMode, VaultExportFormat, VaultImportFormat, VaultTransferItem } from "../../shared/credential-vault-transfer";

export type { VaultItemListing } from "../../shared/credential-vault";

export interface OnePasswordStatus {
  available: boolean;
  via?: "cli" | "connect";
  reason?: "absent" | "signed_out" | "organization" | "error";
}

export interface OnePasswordItem {
  id: string;
  vaultId: string;
  vaultName: string;
  title: string;
  category: string;
  domains: string[];
}

export interface CredentialVaultState {
  items: VaultItemListing[];
  onePassword: OnePasswordStatus;
  /** The vault could not be opened on this launch (the keychain was busy). */
  unavailable?: string;
  /** The organization turned vault exports off (2026-10-18). */
  exportBlocked?: boolean;
}

export interface VaultItemDraft {
  kind: VaultItemKind;
  name: string;
  username?: string;
  password?: string;
  totpSeed?: string;
  apiKey?: string;
  notes?: string;
  domains: string[];
}

const ITEM = (id: string) => `/api/me/credentials/${encodeURIComponent(id)}`;

// Reads are POSTs: the server answers them only to the person's own app.
export const loadCredentials = () => api<CredentialVaultState>("/api/me/credentials/list", { method: "POST", body: "{}" });
export const createCredential = (draft: VaultItemDraft) =>
  api<{ item: VaultItemListing }>("/api/me/credentials", { method: "POST", body: JSON.stringify(draft) });
export const updateCredential = (id: string, patch: Partial<VaultItemDraft>) =>
  api<{ item: VaultItemListing }>(ITEM(id), { method: "PATCH", body: JSON.stringify(patch) });
export const deleteCredential = (id: string) => api<{ ok: true }>(ITEM(id), { method: "DELETE" });
export const revealCredentialNotes = (id: string) => api<{ notes: string }>(`${ITEM(id)}/notes`, { method: "POST", body: "{}" });
export const allowBotAlways = (id: string, botId: string) =>
  api<{ item: VaultItemListing }>(`${ITEM(id)}/grants`, { method: "POST", body: JSON.stringify({ botId, mode: "always" }) });
export const revokeBot = (id: string, botId: string) =>
  api<{ item: VaultItemListing }>(`${ITEM(id)}/grants/${encodeURIComponent(botId)}`, { method: "DELETE" });
export const loadOnePasswordItems = () => api<{ items: OnePasswordItem[] }>("/api/me/credentials/onepassword/items", { method: "POST", body: "{}" });
export const importOnePasswordItem = (item: OnePasswordItem, domains?: string[]) =>
  api<{ item: VaultItemListing }>("/api/me/credentials/onepassword/import", {
    method: "POST",
    body: JSON.stringify({ itemId: item.id, vaultId: item.vaultId, name: item.title, ...(domains ? { domains } : {}) }),
  });

const CARD = (botId: string, messageId: string) => `/api/bots/${encodeURIComponent(botId)}/vault-cards/${encodeURIComponent(messageId)}`;
export const grantFromCard = (botId: string, messageId: string, threadId: string, mode: VaultGrantMode, choice: { itemId: string } | { item: VaultItemDraft }) =>
  api<{ item: VaultItemListing }>(`${CARD(botId, messageId)}/grant`, { method: "POST", body: JSON.stringify({ threadId, mode, ...choice }) });
export const dismissCard = (botId: string, messageId: string, threadId: string) =>
  api<{ dismissed: true }>(`${CARD(botId, messageId)}/dismiss`, { method: "POST", body: JSON.stringify({ threadId }) });

/** Items a request card offers: bound to the asked site (or a parent of it),
 * or named like the request; logins and API keys only. Pure, for tests. */
export function matchingItems(items: readonly VaultItemListing[], request: { domain?: string; name?: string }): VaultItemListing[] {
  const name = request.name?.trim().toLowerCase();
  return items.filter((item) => (item.kind === "login" || item.kind === "apiKey") && (
    (request.domain && vaultDomainMatches(item.domains, bindingUrl(request.domain))) ||
    (name && item.name.toLowerCase().includes(name))
  ));
}

/** "a, b" or a list typed with spaces or new lines, as the server takes it. */
export function parseDomains(text: string): string[] {
  return text.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
}

/** A new login from a card or a form: empty optional fields are left out,
 * so the server does not read them as "clear". */
export function createCredentialDraft(input: { name: string; domains: string[]; username?: string; password?: string; totpSeed?: string }): VaultItemDraft {
  return {
    kind: "login",
    name: input.name.trim(),
    domains: input.domains,
    ...(input.username?.trim() ? { username: input.username.trim() } : {}),
    ...(input.password ? { password: input.password } : {}),
    ...(input.totpSeed?.trim() ? { totpSeed: input.totpSeed.trim() } : {}),
  };
}

// ── import and export (shared/credential-vault-transfer.ts) ────────────

/** What the server did with an import. Counts only. */
export interface VaultImportOutcome {
  created: number;
  merged: number;
  duplicates: number;
  inFile: number;
  overLimit: number;
  refused: number;
}

/** Items read from a file in memory: only these parsed items reach the
 * server (as typed ones do), never the file itself. */
export const importCredentials = (format: VaultImportFormat, duplicates: VaultDuplicateMode, items: readonly VaultTransferItem[]) =>
  api<VaultImportOutcome>("/api/me/credentials/import", { method: "POST", body: JSON.stringify({ format, duplicates, items }) });

/** The vault's values for an export file. The server asks a fresh sign-in
 * or the person's security key first (the store's `api` runs the key and
 * sends the request again). */
export const exportCredentials = (format: VaultExportFormat) =>
  api<{ items: VaultTransferItem[]; onePassword: number; notInFormat?: number; totpNotInFormat?: number }>("/api/me/credentials/export", { method: "POST", body: JSON.stringify({ format, acknowledge: "plaintext" }) });

/** The export file's name: sagax-identifiants-2026-10-18.csv. */
export function exportFileName(extension: "csv" | "json", at: Date = new Date()): string {
  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  return `sagax-credentials-${day}.${extension}`;
}

/** Hand the file to the browser's download (the desktop saves it in
 * Downloads and shows it). The blob URL is revoked right after. */
export function downloadText(text: string, mime: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
