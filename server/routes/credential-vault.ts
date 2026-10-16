// Settings > Credentials and the vault request card (server/credential-vault.ts).
//
//   POST   /api/me/credentials/list                 { items, onePassword, unavailable? }
//   POST   /api/me/credentials        {kind,name,username?,password?,totpSeed?,apiKey?,notes?,domains}
//   PATCH  /api/me/credentials/:id    same fields; a secret left out is kept, "" clears it
//   DELETE /api/me/credentials/:id
//   POST   /api/me/credentials/:id/notes             the owner's own note, never a bot's
//   POST   /api/me/credentials/:id/grants   { botId, mode: "always" }
//   DELETE /api/me/credentials/:id/grants/:botId     revoke
//   POST   /api/me/credentials/onepassword/items     the 1Password picker (names and sites)
//   POST   /api/me/credentials/onepassword/import { via, vaultId, itemId, name?, domains? }
//   POST   /api/bots/:botId/vault-cards/:messageId/grant   { threadId, itemId | item, mode }
//   POST   /api/bots/:botId/vault-cards/:messageId/dismiss { threadId }
//
// The vault is the person's own: the session's principal on an organization
// server, the one local vault on a desktop or a solo server. No answer
// carries a password, a seed or an API key; only booleans say one is saved.
// Member scope (request-auth.ts CLIENT_ALLOW).
//
// Every read is a POST on purpose: a packaged desktop lets any process on
// the computer make loopback GET requests (a bot's shell among them), while
// a mutation needs the desktop's per-launch capability or a paired session.
// The listing (user names), a note and the 1Password picker are therefore
// only answered to the person's own app.
import { randomUUID } from "node:crypto";

import { isVaultGrantMode, VAULT_LOGIN_TARGET, vaultHandle, type VaultGrantMode, type VaultItemListing } from "../../shared/credential-vault.ts";
import type { SecretRequestCardData } from "../../shared/wire.ts";
import { CredentialVaultError, type CredentialVault, type VaultItemInput } from "../credential-vault.ts";
import type { OnePassword } from "../onepassword.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface CredentialVaultRouteDeps {
  vault: CredentialVault;
  onePassword: OnePassword;
  /** Whose vault this request reads: null refuses (a session-less caller
   * on an organization server). */
  principal(auth: RequestAuth): string | null;
  botExists(botId: string): boolean;
  cards: {
    /** The pending vault card a bot posted in this conversation, or null. */
    find(botId: string, threadId: string, messageId: string): SecretRequestCardData | null;
    patch(botId: string, threadId: string, messageId: string, secret: SecretRequestCardData): void;
    /** Settle the card and wake the bot with this note. */
    resume(botId: string, threadId: string, messageId: string, outcome: "provided" | "dismissed", prompt: string): boolean;
  };
  audit?(action: "credentials.create" | "credentials.delete" | "credentials.grant" | "credentials.revoke", auth: RequestAuth, detail: Record<string, unknown>): void;
}

const ITEM = /^\/api\/me\/credentials\/([a-z0-9]{8,40})(?:\/(notes|grants)(?:\/([\w-]{1,128}))?)?$/;
const CARD = /^\/api\/bots\/([\w-]+)\/vault-cards\/([\w-]+)\/(grant|dismiss)$/;

function refusal(error: unknown): { status: number; body: Record<string, unknown> } | null {
  if (error instanceof CredentialVaultError) return { status: error.status, body: { error: error.message, code: error.code } };
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number" && status >= 400 && status < 600) return { status, body: { error: error instanceof Error ? error.message : "refused" } };
  return null;
}

/** What the bot is told after the person allowed a login. A handle, the
 * sites and the fields; never a value. */
export function grantedNote(item: VaultItemListing, mode: VaultGrantMode): string {
  const fields = [item.username ? "username" : "", item.hasPassword ? "password" : "", item.hasTotp ? "totp" : "", item.hasApiKey ? "apiKey" : ""].filter(Boolean);
  return `Sagax credential update: the person allowed you to use the saved login "${item.name}", handle ${vaultHandle(item.id)}, on ${item.domains.join(", ")}` +
    `${mode === "once" ? " in this conversation for the next 15 minutes" : ""}. Fields: ${fields.join(", ") || "none"}. ` +
    "Continue the task: in the browser, call fill_credential with this handle and the field. You never receive the value, and must not ask for it in chat.";
}

export function declinedNote(): string {
  return "Sagax credential update: the person declined to share a login. Continue without signing in if possible, or briefly explain what you could not do. Do not ask for a password in chat.";
}

export function createCredentialVaultRoutes(deps: CredentialVaultRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const mine = path === "/api/me/credentials" || path.startsWith("/api/me/credentials/");
    const card = mine ? null : CARD.exec(path);
    if (!mine && !card) return PASS;
    res.setHeader("cache-control", "private, no-store");
    const principalId = deps.principal(auth);
    if (!principalId) return json(res, 403, { error: "Sign in to use your credential vault.", code: "no_person" });
    const body = async (): Promise<Record<string, unknown>> => {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) throw Object.assign(new Error("content-type must be application/json"), { status: 415 });
      const parsed = await readBody(req);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    };
    try {
      if (card) {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const [, botId, messageId, action] = card;
        const input = await body();
        const threadId = typeof input.threadId === "string" ? input.threadId : "";
        const secret = deps.cards.find(botId!, threadId, messageId!);
        if (!secret || secret.target !== VAULT_LOGIN_TARGET || !secret.vault) return json(res, 404, { error: "no such login request" });
        if (secret.vault.principalId !== principalId) return json(res, 403, { error: "Only the person this request was made for can answer it.", code: "not_yours" });
        if (secret.provided || secret.dismissed || secret.superseded) return json(res, 409, { error: "this login request was already answered" });
        if (action === "dismiss") {
          if (!deps.cards.resume(botId!, threadId, messageId!, "dismissed", declinedNote())) return json(res, 409, { error: "this login request is no longer available" });
          return json(res, 200, { dismissed: true });
        }
        const mode = input.mode;
        if (!isVaultGrantMode(mode)) return json(res, 400, { error: "mode must be once or always" });
        let item: VaultItemListing | null;
        if (typeof input.itemId === "string") item = deps.vault.item(principalId, input.itemId);
        else if (input.item && typeof input.item === "object") {
          item = deps.vault.create(principalId, input.item as VaultItemInput);
          deps.audit?.("credentials.create", auth, { id: item.id, kind: item.kind, via: "card" });
        } else return json(res, 400, { error: "send itemId or a new item" });
        if (!item) return json(res, 404, { error: "No such item", code: "unknown_item" });
        if (item.kind !== "login" && item.kind !== "apiKey") return json(res, 400, { error: "Only a login or an API key can be filled into a page." });
        if (!item.domains.length) return json(res, 400, { error: "This item has no site it may be filled on. Add one first.", code: "invalid_domains" });
        const granted = deps.vault.grant(principalId, item.id, { botId: botId!, mode, threadId });
        deps.audit?.("credentials.grant", auth, { id: item.id, botId, mode, via: "card" });
        deps.cards.patch(botId!, threadId, messageId!, { ...secret, vault: { ...secret.vault, itemId: item.id, itemName: item.name, mode } });
        if (!deps.cards.resume(botId!, threadId, messageId!, "provided", grantedNote(granted, mode))) {
          return json(res, 409, { error: "this login request is no longer available" });
        }
        return json(res, 200, { item: granted });
      }

      if (path === "/api/me/credentials/list") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const unavailable = deps.vault.unavailableReason(principalId);
        return json(res, 200, {
          items: unavailable ? [] : deps.vault.list(principalId),
          onePassword: await deps.onePassword.status(),
          ...(unavailable ? { unavailable } : {}),
        });
      }
      if (path === "/api/me/credentials") {
        if (method === "POST") {
          const item = deps.vault.create(principalId, await body() as VaultItemInput);
          deps.audit?.("credentials.create", auth, { id: item.id, kind: item.kind });
          return json(res, 201, { item });
        }
        return json(res, 405, { error: "POST only" });
      }
      if (path === "/api/me/credentials/onepassword/items") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const status = await deps.onePassword.status(true);
        if (!status.available) return json(res, 409, { error: "1Password is not available on this computer.", code: "onepassword_unavailable", onePassword: status });
        return json(res, 200, { items: await deps.onePassword.listItems() });
      }
      if (path === "/api/me/credentials/onepassword/import") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const input = await body();
        const status = await deps.onePassword.status();
        if (!status.available || !status.via) return json(res, 409, { error: "1Password is not available on this computer.", code: "onepassword_unavailable" });
        const vaultId = typeof input.vaultId === "string" ? input.vaultId : "";
        const itemId = typeof input.itemId === "string" ? input.itemId : "";
        const listed = (await deps.onePassword.listItems()).find((row) => row.id === itemId && row.vaultId === vaultId);
        if (!listed) return json(res, 404, { error: "No such 1Password item", code: "unknown_item" });
        const item = deps.vault.create(principalId, {
          kind: listed.category === "API_CREDENTIAL" ? "apiKey" : "login",
          name: typeof input.name === "string" && input.name.trim() ? input.name : listed.title || "1Password item",
          domains: input.domains ?? listed.domains,
        }, { source: "1password", onePassword: { via: status.via, vaultId, itemId } });
        deps.audit?.("credentials.create", auth, { id: item.id, kind: item.kind, via: "1password" });
        return json(res, 201, { item });
      }
      const match = ITEM.exec(path);
      if (!match) return json(res, 404, { error: "not found" });
      const [, id, sub, botId] = match;
      if (sub === "notes") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        return json(res, 200, { notes: deps.vault.revealNotes(principalId, id!) });
      }
      if (sub === "grants") {
        if (method === "POST" && !botId) {
          const input = await body();
          if (typeof input.botId !== "string" || !deps.botExists(input.botId)) return json(res, 404, { error: "no such bot" });
          if (input.mode !== "always") return json(res, 400, { error: "From Settings a bot is allowed always; a one-time grant comes from a request card." });
          const item = deps.vault.grant(principalId, id!, { botId: input.botId, mode: "always" });
          deps.audit?.("credentials.grant", auth, { id, botId: input.botId, mode: "always" });
          return json(res, 200, { item });
        }
        if (method === "DELETE" && botId) {
          const item = deps.vault.revoke(principalId, id!, botId);
          deps.audit?.("credentials.revoke", auth, { id, botId });
          return json(res, 200, { item });
        }
        return json(res, 405, { error: "POST /grants or DELETE /grants/:botId" });
      }
      if (method === "PATCH") return json(res, 200, { item: deps.vault.update(principalId, id!, await body() as VaultItemInput) });
      if (method === "DELETE") {
        if (!deps.vault.remove(principalId, id!)) return json(res, 404, { error: "No such item", code: "unknown_item" });
        deps.audit?.("credentials.delete", auth, { id });
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: "PATCH or DELETE" });
    } catch (error) {
      const refused = refusal(error);
      if (refused) return json(res, refused.status, refused.body);
      throw error;
    }
  };
}

/** Whose vault a request reads. An organization server: the signed-in
 * person only. Otherwise the one local vault, for a paired session, for the
 * desktop's own loopback (its mutations carry Electron's per-launch
 * capability), or for loopback on a headless server only when the operator
 * opted in: there a bot's shell is a loopback caller too. */
export function vaultPrincipalFor(auth: RequestAuth, context: { organization: boolean; desktop: boolean; loopbackOptIn: boolean; localPrincipal: string }): string | null {
  if (context.organization) {
    const id = auth.kind === "session" ? auth.session.principalId?.trim().toLowerCase() : undefined;
    return id || null;
  }
  if (auth.kind === "session") return context.localPrincipal;
  if (auth.trust === "service") return null;
  return context.desktop || context.loopbackOptIn ? context.localPrincipal : null;
}

/** A fresh vault card for a bot's request_login (kind "secret"). */
export function vaultRequestCard(input: { principalId: string; botName: string; name?: string; domain?: string; reason?: string }): SecretRequestCardData {
  const what = input.domain ?? input.name ?? "a site";
  return {
    target: VAULT_LOGIN_TARGET,
    label: `Login for ${what}`,
    description: `${input.botName} asks to sign in to ${what} with a login from your vault.${input.reason ? ` ${input.reason}` : ""} It can type it into that site's page but never read it.`,
    placeholder: "",
    helpUrl: "",
    requestKey: randomUUID(),
    vault: {
      principalId: input.principalId,
      ...(input.name ? { name: input.name } : {}),
      ...(input.domain ? { domain: input.domain } : {}),
    },
  };
}
