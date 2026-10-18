import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { vaultHandle } from "../../shared/credential-vault.ts";
import type { SecretRequestCardData } from "../../shared/wire.ts";
import { CredentialVault, LOCAL_VAULT_PRINCIPAL } from "../credential-vault.ts";
import { json, readBody } from "../harness/http.ts";
import { OnePassword } from "../onepassword.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { TOOL_POLICY_ROWS } from "../tool-policy.generated.ts";
import { createCredentialVaultRoutes, vaultPrincipalFor, vaultRequestCard } from "./credential-vault.ts";
import { createCredentialVaultInternalRoutes } from "./credential-vault-internal.ts";
import { dispatchInternalRoutes } from "./internal-route.ts";
import { dispatchRoutes } from "./table.ts";

// Fake values only.
const FAKE_PASSWORD = "fake-route-Pa55word";
const FAKE_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function serve(options: {
  principal?: string | null;
  exportGate?: Parameters<typeof createCredentialVaultRoutes>[0]["exportGate"];
  importGate?: Parameters<typeof createCredentialVaultRoutes>[0]["importGate"];
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-vault-routes-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const vault = new CredentialVault(dir, () => ({ kind: "key", key: Buffer.alloc(32, 5) }));
  const cards = new Map<string, SecretRequestCardData>();
  const resumed: Array<{ messageId: string; outcome: string; prompt: string }> = [];
  const audits: Array<{ action: string; detail: Record<string, unknown> }> = [];
  const routes = [createCredentialVaultRoutes({
    vault,
    audit: (action, _auth, detail) => { audits.push({ action, detail }); },
    ...(options.exportGate ? { exportGate: options.exportGate } : {}),
    ...(options.importGate ? { importGate: options.importGate } : {}),
    onePassword: new OnePassword({ env: {}, exec: async () => { throw new Error("absent"); }, organization: () => false }),
    principal: () => options.principal === undefined ? LOCAL_VAULT_PRINCIPAL : options.principal,
    botExists: (id) => id === "bot-a",
    cards: {
      find: (_botId, threadId, messageId) => cards.get(`${threadId}:${messageId}`) ?? null,
      patch: (_botId, threadId, messageId, secret) => { cards.set(`${threadId}:${messageId}`, secret); },
      resume: (_botId, threadId, messageId, outcome, prompt) => {
        const card = cards.get(`${threadId}:${messageId}`)!;
        cards.set(`${threadId}:${messageId}`, { ...card, ...(outcome === "provided" ? { provided: true } : { dismissed: true }), resumed: true });
        resumed.push({ messageId, outcome, prompt });
        return true;
      },
    },
  })];
  const auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
    if (!handled) json(res, 404, { from: "inline" });
  });
  cleanups.push(() => new Promise((done) => server.close(done)));
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, text, body: text ? JSON.parse(text) : null };
  };
  return { vault, cards, resumed, audits, call };
}

const login = { kind: "login", name: "Example", username: "ada.fake@example.test", password: FAKE_PASSWORD, totpSeed: FAKE_SEED, domains: ["example.test"], notes: "fake private note" };

describe("credential vault routes", () => {
  it("creates, lists, edits and deletes without ever answering a value", async () => {
    const { call } = await serve();
    const created = await call("POST", "/api/me/credentials", login);
    expect(created.status).toBe(201);
    const id = created.body.item.id as string;
    const listed = await call("POST", "/api/me/credentials/list", {});
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.onePassword).toEqual({ available: false, reason: "absent" });
    const patched = await call("PATCH", `/api/me/credentials/${id}`, { name: "Renamed" });
    expect(patched.body.item).toMatchObject({ name: "Renamed", hasPassword: true, hasTotp: true });
    for (const answer of [created, listed, patched]) {
      expect(answer.text).not.toContain(FAKE_PASSWORD);
      expect(answer.text).not.toContain(FAKE_SEED);
      expect(answer.text).not.toContain("fake private note");
    }
    // Reads are POSTs: a loopback GET (any local process) gets nothing.
    expect((await call("GET", "/api/me/credentials/list")).status).toBe(405);
    expect((await call("GET", `/api/me/credentials/${id}/notes`)).status).toBe(405);
    expect((await call("POST", `/api/me/credentials/${id}/notes`, {})).body).toEqual({ notes: "fake private note" });
    expect((await call("DELETE", `/api/me/credentials/${id}`)).status).toBe(200);
    expect((await call("POST", "/api/me/credentials/list", {})).body.items).toEqual([]);
  });

  it("allows a bot always from Settings, refuses a once grant there, and revokes", async () => {
    const { call } = await serve();
    const id = (await call("POST", "/api/me/credentials", login)).body.item.id as string;
    expect((await call("POST", `/api/me/credentials/${id}/grants`, { botId: "bot-x", mode: "always" })).status).toBe(404);
    expect((await call("POST", `/api/me/credentials/${id}/grants`, { botId: "bot-a", mode: "once" })).status).toBe(400);
    const allowed = await call("POST", `/api/me/credentials/${id}/grants`, { botId: "bot-a", mode: "always" });
    expect(allowed.body.item.grants).toMatchObject([{ botId: "bot-a", mode: "always" }]);
    const revoked = await call("DELETE", `/api/me/credentials/${id}/grants/bot-a`);
    expect(revoked.body.item.grants).toEqual([]);
  });

  it("answers a request card once or always, only for the person it was made for", async () => {
    const { call, cards, resumed, vault } = await serve();
    const id = (await call("POST", "/api/me/credentials", login)).body.item.id as string;
    cards.set("t1:m1", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "example.test" }));
    cards.set("t1:m2", vaultRequestCard({ principalId: "pr_someone_else", botName: "Ada", domain: "example.test" }));
    expect((await call("POST", "/api/bots/bot-a/vault-cards/m2/grant", { threadId: "t1", itemId: id, mode: "always" })).status).toBe(403);
    const once = await call("POST", "/api/bots/bot-a/vault-cards/m1/grant", { threadId: "t1", itemId: id, mode: "once" });
    expect(once.status).toBe(200);
    expect(vault.granted(LOCAL_VAULT_PRINCIPAL, id, "bot-a", "t1")).toBe(true);
    expect(vault.granted(LOCAL_VAULT_PRINCIPAL, id, "bot-a", "t2")).toBe(false);
    expect(resumed).toHaveLength(1);
    // The bot is told the handle and the fields, never a value.
    expect(resumed[0]!.prompt).toContain(vaultHandle(id));
    expect(resumed[0]!.prompt).toContain("password");
    expect(resumed[0]!.prompt).not.toContain(FAKE_PASSWORD);
    expect(cards.get("t1:m1")).toMatchObject({ provided: true, vault: { itemId: id, mode: "once" } });
    // An answered card cannot be answered again.
    expect((await call("POST", "/api/bots/bot-a/vault-cards/m1/grant", { threadId: "t1", itemId: id, mode: "always" })).status).toBe(409);

    // A new login saved from a card, allowed always.
    cards.set("t1:m3", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "other.test" }));
    const saved = await call("POST", "/api/bots/bot-a/vault-cards/m3/grant", { threadId: "t1", mode: "always", item: { kind: "login", name: "Other", password: FAKE_PASSWORD, domains: ["other.test"] } });
    expect(saved.status).toBe(200);
    expect(saved.text).not.toContain(FAKE_PASSWORD);
    expect(vault.granted(LOCAL_VAULT_PRINCIPAL, saved.body.item.id, "bot-a", "t9")).toBe(true);

    cards.set("t1:m4", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "x.test" }));
    expect((await call("POST", "/api/bots/bot-a/vault-cards/m4/dismiss", { threadId: "t1" })).body).toEqual({ dismissed: true });
    expect(resumed.at(-1)).toMatchObject({ outcome: "dismissed" });
  });

  it("refuses a caller with no person, and keeps the routes member scope and off for agents", async () => {
    const { call } = await serve({ principal: null });
    expect((await call("POST", "/api/me/credentials/list", {})).status).toBe(403);
    for (const [method, path] of [["POST", "/api/me/credentials/list"], ["POST", "/api/me/credentials"], ["PATCH", "/api/me/credentials/abcdef012345"], ["POST", "/api/bots/b1/vault-cards/m1/grant"]] as const) {
      expect(requiredScope(method, path), `${method} ${path}`).toBe("client");
    }
    expect(requiredScope("GET", "/api/me/credentials/list")).toBe("admin");
    // No agent tool may grant itself a login or read the vault.
    const rows = TOOL_POLICY_ROWS.filter((row) => row.route.includes("credentials") && row.route.includes("/api/me") || row.route.includes("vault-cards"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toMatchObject({ tier: "admin", defaultEnabled: false });
  });
});

describe("whose vault a request reads", () => {
  const loopback: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
  const service: RequestAuth = { kind: "loopback", scopes: ["client"], trust: "service" };
  const session = (principalId?: string) => ({ kind: "session", via: "cookie", scopes: ["client"], session: { id: "s1", ...(principalId ? { principalId } : {}) } }) as unknown as RequestAuth;
  const solo = { organization: false, desktop: false, loopbackOptIn: false, localPrincipal: "local" };
  it("answers loopback only on the desktop or with the operator's opt-in, never a service caller", () => {
    expect(vaultPrincipalFor(loopback, solo)).toBeNull();
    expect(vaultPrincipalFor(loopback, { ...solo, desktop: true })).toBe("local");
    expect(vaultPrincipalFor(loopback, { ...solo, loopbackOptIn: true })).toBe("local");
    expect(vaultPrincipalFor(service, { ...solo, desktop: true, loopbackOptIn: true })).toBeNull();
    expect(vaultPrincipalFor(session(), solo)).toBe("local");
  });
  it("on an organization server, answers the signed-in person only", () => {
    const org = { ...solo, organization: true, desktop: true, loopbackOptIn: true };
    expect(vaultPrincipalFor(loopback, org)).toBeNull();
    expect(vaultPrincipalFor(session("PR_Alice"), org)).toBe("pr_alice");
    expect(vaultPrincipalFor(session(), org)).toBeNull();
  });
});

describe("request_login internal route", () => {
  it("returns a granted handle at once, or posts a card", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-vault-internal-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const vault = new CredentialVault(dir, () => ({ kind: "key", key: Buffer.alloc(32, 6) }));
    const item = vault.create(LOCAL_VAULT_PRINCIPAL, login);
    const posted: SecretRequestCardData[] = [];
    const routes = [createCredentialVaultInternalRoutes({
      vault,
      principalForThread: () => LOCAL_VAULT_PRINCIPAL,
      botName: () => "Ada",
      postCard: (_botId, _threadId, secret) => { posted.push(secret); return `m${posted.length}`; },
    })];
    const ask = async (body: Record<string, unknown>) => {
      let answer: { status: number; body: unknown } | null = null;
      const res = { headersSent: false, writableEnded: false } as unknown as Parameters<typeof dispatchInternalRoutes>[1]["res"];
      await dispatchInternalRoutes(routes, {
        res, path: "/api/internal/credentials/request", method: "POST",
        json: ((_res: unknown, status: number, value: unknown) => { answer = { status, body: value }; }) as never,
        capability: { botId: "bot-a", threadId: "t1", generation: "g" },
        readBody: async () => body,
      });
      return answer!;
    };
    expect((await ask({})).status).toBe(400);
    expect((await ask({ domain: "not a site!" })).status).toBe(400);
    const first = await ask({ domain: "example.test", reason: "to read the invoice" });
    expect(first.status).toBe(201);
    expect(posted[0]).toMatchObject({ target: "vaultLogin", vault: { domain: "example.test", principalId: LOCAL_VAULT_PRINCIPAL } });
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    const second = await ask({ domain: "example.test" });
    expect(second).toMatchObject({ status: 200, body: { granted: [{ handle: vaultHandle(item.id), name: "Example", domains: ["example.test"], fields: ["username", "password", "totp"] }] } });
    expect(JSON.stringify(second)).not.toContain(FAKE_PASSWORD);
    expect(posted).toHaveLength(1);
  });
});

describe("import and export routes", () => {
  const items = [
    { kind: "login", name: "Imported", username: "kim.fake@example.test", password: FAKE_PASSWORD, totpSeed: FAKE_SEED, domains: ["https://Imported.example.test/login"], extra: "dropped" },
    { kind: "note", name: "Imported note", notes: "fake imported note", domains: [] },
  ];

  it("imports parsed items, merges or leaves duplicates, and audits counts only", async () => {
    const { call, audits, vault } = await serve();
    const first = await call("POST", "/api/me/credentials/import", { format: "chrome-csv", duplicates: "skip", items });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ created: 2, merged: 0, duplicates: 0, inFile: 0, overLimit: 0, refused: 0 });
    expect(vault.list(LOCAL_VAULT_PRINCIPAL).map((item) => item.domains)).toEqual([["imported.example.test"], []]);
    const again = await call("POST", "/api/me/credentials/import", { format: "chrome-csv", duplicates: "skip", items });
    expect(again.body).toMatchObject({ created: 0, merged: 0, duplicates: 2 });
    const merged = await call("POST", "/api/me/credentials/import", { format: "bitwarden-json", duplicates: "merge", items: [{ ...items[0], password: "fake-new-pass", domains: ["imported.example.test", "www.imported.example.test"] }] });
    expect(merged.body).toMatchObject({ created: 0, merged: 1 });
    expect(vault.list(LOCAL_VAULT_PRINCIPAL)[0]!.domains).toEqual(["imported.example.test", "www.imported.example.test"]);
    const bad = await call("POST", "/api/me/credentials/import", { format: "chrome-csv", duplicates: "skip", items: [{ kind: "login", name: "Bad seed", username: "u", totpSeed: "not base32 !", domains: ["bad.example.test"] }] });
    expect(bad.body).toMatchObject({ created: 0, refused: 1 });
    for (const answer of [first, again, merged, bad]) expect(answer.text).not.toContain(FAKE_PASSWORD);
    expect(audits.filter((row) => row.action === "credentials.import")).toHaveLength(4);
    const auditText = JSON.stringify(audits);
    for (const value of [FAKE_PASSWORD, FAKE_SEED, "fake-new-pass", "kim.fake@example.test", "Imported", "imported.example.test", "fake imported note"]) expect(auditText).not.toContain(value);
  });

  it("refuses an import the gate refuses (a bot acting for its person)", async () => {
    const { call, vault } = await serve({ importGate: () => ({ status: 403, body: { code: "not_person" } }) });
    expect((await call("POST", "/api/me/credentials/import", { format: "chrome-csv", duplicates: "skip", items })).body).toEqual({ code: "not_person" });
    expect(vault.list(LOCAL_VAULT_PRINCIPAL)).toEqual([]);
  });

  it("refuses a malformed import", async () => {
    const { call } = await serve();
    expect((await call("POST", "/api/me/credentials/import", { format: "word", duplicates: "skip", items: [] })).status).toBe(400);
    expect((await call("POST", "/api/me/credentials/import", { format: "chrome-csv", duplicates: "all", items: [] })).status).toBe(400);
    expect((await call("POST", "/api/me/credentials/import", { format: "chrome-csv", duplicates: "skip", items: [{ kind: "card", name: "x" }] })).status).toBe(400);
    expect((await call("GET", "/api/me/credentials/import")).status).toBe(405);
  });

  it("exports only past the gate, with a plaintext acknowledgement, and audits without content", async () => {
    let refuse = true;
    const asked: unknown[] = [];
    const { call, audits, vault } = await serve({
      exportGate: (_auth, input) => {
        asked.push(input);
        return refuse ? { status: 403, body: { error: "Confirm this change with your security key.", code: "step_up_required", target: { kind: "settings", action: "credentials.export", detail: { format: input.format } } } } : null;
      },
    });
    vault.create(LOCAL_VAULT_PRINCIPAL, login);
    expect((await call("POST", "/api/me/credentials/export", { format: "chrome-csv" })).body).toMatchObject({ code: "acknowledge_required" });
    expect((await call("POST", "/api/me/credentials/export", { format: "pdf", acknowledge: "plaintext" })).status).toBe(400);
    const refused = await call("POST", "/api/me/credentials/export", { format: "bitwarden-json", acknowledge: "plaintext" });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "step_up_required", target: { action: "credentials.export" } });
    expect(refused.text).not.toContain(FAKE_PASSWORD);
    refuse = false;
    const answered = await call("POST", "/api/me/credentials/export", { format: "bitwarden-json", acknowledge: "plaintext", stepUp: "ceremony-id" });
    expect(answered.status).toBe(200);
    expect(answered.body.items).toEqual([{ kind: "login", name: "Example", username: "ada.fake@example.test", password: FAKE_PASSWORD, totpSeed: FAKE_SEED, notes: "fake private note", domains: ["example.test"] }]);
    expect(answered.body.onePassword).toBe(0);
    expect(asked.at(-1)).toEqual({ format: "bitwarden-json", stepUp: "ceremony-id" });
    const exports = audits.filter((row) => row.action === "credentials.export");
    expect(exports).toEqual([{ action: "credentials.export", detail: { format: "bitwarden-json", count: 1, referencesLeftOut: 0, notInFormat: 0 } }]);
  });

  it("refuses an export where no gate is wired, and keeps both routes member scope and off for agents", async () => {
    const { call, vault } = await serve();
    vault.create(LOCAL_VAULT_PRINCIPAL, login);
    const answer = await call("POST", "/api/me/credentials/export", { format: "chrome-csv", acknowledge: "plaintext" });
    expect(answer.status).toBe(403);
    expect(answer.text).not.toContain(FAKE_PASSWORD);
    for (const path of ["/api/me/credentials/import", "/api/me/credentials/export"]) {
      expect(requiredScope("POST", path)).toBe("client");
      expect(requiredScope("GET", path)).toBe("admin");
      for (const row of TOOL_POLICY_ROWS.filter((entry) => entry.route === path)) expect(row).toMatchObject({ tier: "admin", defaultEnabled: false });
    }
  });
});
