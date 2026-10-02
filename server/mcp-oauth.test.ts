import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RemoteMcpSpec } from "./contracts.ts";
import { requiredScope } from "./request-auth.ts";
import {
  authorizationServerMetadataUrls,
  callbackPage,
  canonicalResource,
  McpOAuthManager,
  McpOAuthVault,
  parseBearerChallenge,
  PENDING_FLOW_TTL_MS,
  protectedResourceMetadataUrls,
  resolveVaultKey,
  type VaultKeySource,
} from "./mcp-oauth.ts";
import { startFakeOAuthMcp, type FakeOAuthMcp } from "./testing/fake-oauth-mcp-server.ts";

const REDIRECT = "http://127.0.0.1:65000/api/mcp-oauth/callback";
const FIXED_KEY: VaultKeySource = { kind: "key", key: Buffer.alloc(32, 7) };

let dir: string;
let fake: FakeOAuthMcp | undefined;
let clock: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcp-oauth-"));
  clock = 1_000_000;
});
afterEach(async () => {
  await fake?.close();
  fake = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function manager(key: () => VaultKeySource = () => FIXED_KEY): McpOAuthManager {
  return new McpOAuthManager({ vault: new McpOAuthVault(dir, key), now: () => clock, timeoutMs: 5_000 });
}

function remote(url: string, headers: Record<string, string> = {}): RemoteMcpSpec {
  return { type: "http", url, headers };
}

/** Probe, start, consent at the fake, and come back through the callback. */
async function signIn(oauth: McpOAuthManager, name: string, server: RemoteMcpSpec, extra: { clientId?: string } = {}) {
  await oauth.probe(name, server);
  const { authorizationUrl } = await oauth.start(name, server, { redirectUri: REDIRECT, ...extra });
  const back = await fake!.authorize(authorizationUrl);
  return oauth.callback(back.searchParams);
}

describe("discovery helpers", () => {
  it("reads a Bearer challenge with quoted and bare parameters", () => {
    expect(parseBearerChallenge('Bearer error="invalid_token", resource_metadata="https://a.example/.well-known/oauth-protected-resource", scope="a b"'))
      .toEqual({ error: "invalid_token", resource_metadata: "https://a.example/.well-known/oauth-protected-resource", scope: "a b" });
    expect(parseBearerChallenge('Basic realm="x", Bearer realm=api')).toEqual({ realm: "api" });
    expect(parseBearerChallenge("Basic realm=x")).toBeNull();
    expect(parseBearerChallenge(null)).toBeNull();
  });

  it("builds the well-known URLs in the order the spec lists them", () => {
    expect(protectedResourceMetadataUrls("https://mcp.example.com/public/mcp")).toEqual([
      "https://mcp.example.com/.well-known/oauth-protected-resource/public/mcp",
      "https://mcp.example.com/.well-known/oauth-protected-resource",
    ]);
    expect(authorizationServerMetadataUrls("https://auth.example.com/tenant1")).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server/tenant1",
      "https://auth.example.com/.well-known/openid-configuration/tenant1",
      "https://auth.example.com/tenant1/.well-known/openid-configuration",
    ]);
    expect(authorizationServerMetadataUrls("https://auth.example.com")).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server",
      "https://auth.example.com/.well-known/openid-configuration",
    ]);
    expect(canonicalResource("HTTPS://MCP.Example.com/")).toBe("https://mcp.example.com");
    expect(canonicalResource("https://mcp.example.com/mcp#x")).toBe("https://mcp.example.com/mcp");
  });
});

describe("probe and discovery", () => {
  it("follows resource_metadata from the 401 to the authorization server", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    const status = await oauth.probe("notes", remote(fake.mcpUrl));
    expect(status).toMatchObject({ auth: "required", authClient: "dynamic" });
    const record = oauth.vault.get("notes")!;
    expect(record).toMatchObject({
      resource: fake.mcpUrl,
      issuer: fake.issuer,
      authorizationEndpoint: `${fake.issuer}/authorize`,
      tokenEndpoint: `${fake.issuer}/token`,
      registrationEndpoint: `${fake.issuer}/register`,
      revocationEndpoint: `${fake.issuer}/revoke`,
      scope: "notes:read",
    });
  });

  it("falls back to the well-known resource metadata and OpenID discovery", async () => {
    fake = await startFakeOAuthMcp({ metadataHint: "wellknown", asMetadata: "oidc" });
    const oauth = manager();
    expect((await oauth.probe("notes", remote(fake.mcpUrl))).auth).toBe("required");
    expect(oauth.vault.get("notes")!.tokenEndpoint).toBe(`${fake.issuer}/token`);
  });

  it("refuses metadata that names another origin, or lacks S256", async () => {
    fake = await startFakeOAuthMcp({ foreignResource: true });
    expect((await manager().probe("notes", remote(fake.mcpUrl))).auth).toBe("error");
    await fake.close();
    fake = await startFakeOAuthMcp({ noS256: true });
    const oauth = manager();
    expect(await oauth.probe("other", remote(fake.mcpUrl))).toMatchObject({ auth: "error", authError: expect.stringMatching(/does not offer OAuth/) });
  });

  it("reports none for a server that answers without a sign-in", async () => {
    fake = await startFakeOAuthMcp();
    fake.validAccess.add("static-fake-token");
    const oauth = manager();
    expect(await oauth.probe("notes", remote(fake.mcpUrl, { Authorization: "Bearer static-fake-token" }))).toEqual({ auth: "none" });
    expect(oauth.vault.get("notes")).toBeUndefined();
    expect(oauth.status("notes", remote(fake.mcpUrl, { Authorization: "Bearer static-fake-token" }))).toEqual({ auth: "none" });
  });
});

describe("client registration", () => {
  it("registers dynamically as a public client with the loopback redirect", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    await oauth.probe("notes", remote(fake.mcpUrl));
    await oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT });
    expect(fake.registrations).toEqual([expect.objectContaining({
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    })]);
    // a second start reuses the client
    await oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT });
    expect(fake.registrations).toHaveLength(1);
  });

  it("asks for a client id when the server offers no registration, then uses it", async () => {
    fake = await startFakeOAuthMcp({ registration: false });
    const oauth = manager();
    expect(await oauth.probe("notes", remote(fake.mcpUrl))).toMatchObject({ auth: "required", authClient: "needed" });
    await expect(oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT })).rejects.toMatchObject({ code: "client_required" });
    const result = await signIn(oauth, "notes", remote(fake.mcpUrl), { clientId: "user-registered-client" });
    expect(result).toEqual({ ok: true, name: "notes" });
    expect(fake.tokenRequests[0]).toMatchObject({ client_id: "user-registered-client", grant_type: "authorization_code" });
    expect(oauth.status("notes", remote(fake.mcpUrl))).toMatchObject({ auth: "connected", authClient: "manual" });
  });
});

describe("authorization code with PKCE and state", () => {
  it("sends S256, resource and state, and redeems the code once", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    await oauth.probe("notes", remote(fake.mcpUrl));
    const { authorizationUrl } = await oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT });
    const params = new URL(authorizationUrl).searchParams;
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get("resource")).toBe(fake.mcpUrl);
    expect(params.get("scope")).toBe("notes:read");
    expect(params.get("redirect_uri")).toBe(REDIRECT);
    expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(oauth.pendingFor("notes")).toBe(true);

    const back = await fake.authorize(authorizationUrl);
    expect(await oauth.callback(back.searchParams)).toEqual({ ok: true, name: "notes" });
    expect(fake.tokenRequests[0]).toMatchObject({ grant_type: "authorization_code", resource: fake.mcpUrl, redirect_uri: REDIRECT });
    expect(oauth.pendingFor("notes")).toBe(false);
    // replaying the same redirect is refused: the state was single use
    expect(await oauth.callback(back.searchParams)).toMatchObject({ ok: false, error: expect.stringMatching(/expired or was already used/) });
  });

  it("rejects an unknown state and an expired one", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    expect(await oauth.callback(new URLSearchParams({ code: "x", state: "forged" }))).toMatchObject({ ok: false });
    await oauth.probe("notes", remote(fake.mcpUrl));
    const { authorizationUrl } = await oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT });
    const back = await fake.authorize(authorizationUrl);
    clock += PENDING_FLOW_TTL_MS + 1;
    expect(await oauth.callback(back.searchParams)).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    expect(fake.tokenRequests).toHaveLength(0);
    expect(oauth.status("notes", remote(fake.mcpUrl))?.auth).toBe("required");
  });

  it("records a refusal at the authorization server without tokens", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    await oauth.probe("notes", remote(fake.mcpUrl));
    const { authorizationUrl } = await oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT });
    const state = new URL(authorizationUrl).searchParams.get("state")!;
    expect(await oauth.callback(new URLSearchParams({ error: "access_denied", state }))).toEqual({ ok: false, name: "notes", error: "The sign-in was cancelled." });
    expect(oauth.status("notes", remote(fake.mcpUrl))).toMatchObject({ auth: "required", authError: "The sign-in was cancelled." });
  });

  it("refuses a callback from another issuer (RFC 9207)", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    await oauth.probe("notes", remote(fake.mcpUrl));
    const { authorizationUrl } = await oauth.start("notes", remote(fake.mcpUrl), { redirectUri: REDIRECT });
    const back = await fake.authorize(authorizationUrl);
    back.searchParams.set("iss", "https://attacker.example");
    expect(await oauth.callback(back.searchParams)).toMatchObject({ ok: false, error: expect.stringMatching(/unexpected authorization server/) });
    expect(fake.tokenRequests).toHaveLength(0);
  });
});

describe("tokens for engines", () => {
  it("injects the bearer, replacing a typed Authorization header only for that server", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    const server = remote(fake.mcpUrl, { authorization: "Bearer stale", "X-Org": "acme" });
    await signIn(oauth, "notes", server);
    const access = [...fake.validAccess][0]!;
    const mounted = oauth.withAuthHeaders({
      notes: server,
      other: remote("https://other.example/mcp", { Authorization: "Bearer keep" }),
      local: { command: "npx", args: [], env: {} },
    });
    expect(mounted.notes).toEqual({ type: "http", url: fake.mcpUrl, headers: { "X-Org": "acme", Authorization: `Bearer ${access}` } });
    expect(mounted.other).toEqual(remote("https://other.example/mcp", { Authorization: "Bearer keep" }));
    expect(mounted.local).toEqual({ command: "npx", args: [], env: {} });
    // a server whose address changed never receives the old token
    expect(oauth.withAuthHeaders({ notes: remote(`${fake.base}/moved`) }).notes.headers).toEqual({});
    // an expired access token is not sent
    clock += 3_600_000;
    expect(oauth.withAuthHeaders({ notes: server }).notes.headers).toEqual({ authorization: "Bearer stale", "X-Org": "acme" });
  });

  it("refreshes before expiry and after the server refuses the token", async () => {
    fake = await startFakeOAuthMcp({ accessTtl: 120 });
    const oauth = manager();
    const server = remote(fake.mcpUrl);
    await signIn(oauth, "notes", server);
    const first = oauth.vault.get("notes")!.tokens!.access;
    await oauth.refreshDue({ notes: server });
    expect(oauth.vault.get("notes")!.tokens!.access).toBe(first); // not due yet
    clock += 90_000; // within the 60 s margin
    await oauth.refreshDue({ notes: server });
    const second = oauth.vault.get("notes")!.tokens!.access;
    expect(second).not.toBe(first);
    expect(fake.tokenRequests.at(-1)).toMatchObject({ grant_type: "refresh_token", resource: fake.mcpUrl });

    // the server drops the token: the probe refreshes once and stays connected
    fake.validAccess.delete(second!);
    expect((await oauth.probe("notes", server)).auth).toBe("connected");
    expect(oauth.vault.get("notes")!.tokens!.access).not.toBe(second);
  });

  it("marks the server expired when the refresh token is refused", async () => {
    fake = await startFakeOAuthMcp({ accessTtl: 30, refuseRefresh: true });
    const oauth = manager();
    const server = remote(fake.mcpUrl);
    await signIn(oauth, "notes", server);
    expect(await oauth.refresh("notes", server)).toBe(false);
    expect(oauth.status("notes", server)).toMatchObject({ auth: "expired" });
    expect(oauth.vault.get("notes")!.tokens).toBeUndefined();
    expect(oauth.withAuthHeaders({ notes: server }).notes.headers).toEqual({});
  });

  it("disconnect revokes both tokens and keeps the client", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    const server = remote(fake.mcpUrl);
    await signIn(oauth, "notes", server);
    const tokens = oauth.vault.get("notes")!.tokens!;
    await oauth.disconnect("notes", server);
    expect(fake.revoked).toEqual([tokens.refresh, tokens.access]);
    expect(oauth.status("notes", server)).toMatchObject({ auth: "required" });
    expect(oauth.vault.get("notes")!.client?.id).toBe("client-1");
    await oauth.forget("notes");
    expect(oauth.vault.get("notes")).toBeUndefined();
  });
});

describe("vault", () => {
  it("keeps tokens encrypted at rest, 0600, and unreadable with another key", async () => {
    fake = await startFakeOAuthMcp();
    const oauth = manager();
    await signIn(oauth, "notes", remote(fake.mcpUrl));
    const tokens = oauth.vault.get("notes")!.tokens!;
    const file = join(dir, "mcp-oauth.enc");
    const onDisk = readFileSync(file, "utf8");
    for (const secret of [tokens.access!, tokens.refresh!, "client-1", fake.issuer]) expect(onDisk).not.toContain(secret);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);

    const other = new McpOAuthVault(dir, () => ({ kind: "key", key: Buffer.alloc(32, 9) }));
    expect(other.get("notes")).toBeUndefined();
    expect(other.unavailableReason()).toMatch(/could not be decrypted/);
    // a wrong key never overwrites what is saved
    expect(() => other.set("x", undefined)).toThrow();
    expect(readFileSync(file, "utf8")).toBe(onDisk);
  });

  it("uses the desktop key, refuses to invent one under the desktop, and makes a 0600 key file otherwise", () => {
    const hex = "ab".repeat(32);
    expect(resolveVaultKey(dir, { SAGAX_MCP_OAUTH_KEY: hex })).toEqual({ kind: "key", key: Buffer.from(hex, "hex") });
    expect(resolveVaultKey(dir, { SAGAX_DESKTOP_PARENT: "1" })).toMatchObject({ kind: "unavailable" });
    const made = resolveVaultKey(dir, {});
    expect(made.kind).toBe("key");
    expect(resolveVaultKey(dir, {})).toEqual(made);
    if (process.platform !== "win32") expect(statSync(join(dir, "mcp-oauth.key")).mode & 0o777).toBe(0o600);
  });

  it("reports an unavailable store as an error and injects nothing", () => {
    const oauth = manager(() => ({ kind: "unavailable", reason: "The encrypted credential store could not be read on this launch." }));
    expect(oauth.status("notes", remote("https://mcp.example.com/mcp"))).toMatchObject({ auth: "error" });
    const servers = { notes: remote("https://mcp.example.com/mcp") };
    expect(oauth.withAuthHeaders(servers)).toBe(servers);
  });
});

describe("routes", () => {
  it("keeps every sign-in route owner/admin only", () => {
    for (const action of ["start", "disconnect", "probe"]) expect(requiredScope("POST", `/api/mcp/servers/notes/oauth/${action}`)).toBe("admin");
    expect(requiredScope("GET", "/api/mcp/servers/notes/oauth/status")).toBe("admin");
  });
});

describe("callback page", () => {
  it("escapes the message and carries no secret", () => {
    const page = callbackPage({ ok: false, name: "notes", error: "<script>alert(1)</script>" }, "en-US");
    expect(page.html).not.toContain("<script>alert(1)</script>");
    expect(page.html).toContain("&lt;script&gt;");
    expect(page.html).toContain(`nonce="${page.nonce}"`);
    const done = callbackPage({ ok: true, name: "notes" }, "fr-CA,fr;q=0.9");
    expect(done.html).toContain("Connexion terminée, vous pouvez fermer cet onglet.");
    expect(done.html).toContain("window.close()");
    expect(callbackPage({ ok: true, name: "notes" }, "en").html).toContain("Sign-in complete. You can close this tab.");
  });
});
