import { describe, expect, it, vi } from "vitest";

import {
  ClaudeAiConnectorInventory,
  claudeAiConnectorsForTurn,
  claudeAiConnectorsPrompt,
  connectorPrincipalFor,
  createHarnessConnectorRoutes,
  parseClaudeAuthStatus,
  parseClaudeMcpList,
  type ClaudeAiTurnInput,
  type HarnessConnectorRouteDeps,
} from "./harness-connectors.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteContext } from "./routes/table.ts";
import type { SessionRecord } from "./sessions.ts";

const LOCAL = "pr_00000000-0000-4000-8000-000000000001";
const ADA = "pr_00000000-0000-4000-8000-00000000000a";
const BOB = "pr_00000000-0000-4000-8000-00000000000b";

describe("connectorPrincipalFor (whose connections a turn uses)", () => {
  const base = { ownerPrincipalId: ADA, localPrincipalId: LOCAL };
  it("a conversation uses its speaker's connections", () => {
    expect(connectorPrincipalFor({ ...base, identity: "perspicax", speaker: { origin: "person", principalId: BOB } })).toBe(BOB);
  });
  it("a routine uses its bot owner's connections", () => {
    expect(connectorPrincipalFor({ ...base, identity: "perspicax", speaker: { origin: "owner-routine", principalId: BOB } })).toBe(ADA);
  });
  it("an unknown person on an organization server is nobody, never the owner", () => {
    expect(connectorPrincipalFor({ ...base, identity: "perspicax", speaker: { origin: "person" } })).toBe("");
    expect(connectorPrincipalFor({ ...base, identity: "perspicax", speaker: { origin: "peer", fromBotId: "b1" } })).toBe("");
  });
  it("on a solo server an unnamed person and the operator are the operator", () => {
    expect(connectorPrincipalFor({ ...base, identity: "solo", speaker: { origin: "person" } })).toBe(LOCAL);
    expect(connectorPrincipalFor({ ...base, identity: "solo", speaker: { origin: "operator" } })).toBe(LOCAL);
  });
});

describe("claudeAiConnectorsForTurn", () => {
  const turn = (patch: Partial<ClaudeAiTurnInput>): ClaudeAiTurnInput => ({
    identity: "perspicax", restrictedByPolicy: false, driver: "claudeAgent",
    speaker: { origin: "person", principalId: ADA }, ownerPrincipalId: ADA, localPrincipalId: LOCAL, ...patch,
  });
  it("organization: only on the speaker's own subscription", () => {
    expect(claudeAiConnectorsForTurn(turn({ via: "subscription" }))).toBe(true);
    for (const via of ["owner-key", "server", "org-key"] as const) expect(claudeAiConnectorsForTurn(turn({ via }))).toBe(false);
    expect(claudeAiConnectorsForTurn(turn({}))).toBe(false);
  });
  it("solo: the operator and the operator's routines, nobody else", () => {
    expect(claudeAiConnectorsForTurn(turn({ identity: "solo", speaker: { origin: "operator" } }))).toBe(true);
    expect(claudeAiConnectorsForTurn(turn({ identity: "solo", ownerPrincipalId: LOCAL, speaker: { origin: "owner-routine" } }))).toBe(true);
    expect(claudeAiConnectorsForTurn(turn({ identity: "solo", speaker: { origin: "person", principalId: BOB } }))).toBe(false);
  });
  it("never when turned off, restricted by policy, or on another engine", () => {
    expect(claudeAiConnectorsForTurn(turn({ via: "subscription", restrictedByPolicy: true }))).toBe(false);
    expect(claudeAiConnectorsForTurn(turn({ via: "subscription", driver: "codex" }))).toBe(false);
  });
  it("tells the bot whose connectors they are only when they are mounted", () => {
    expect(claudeAiConnectorsPrompt(false)).toBe("");
    expect(claudeAiConnectorsPrompt(true)).toContain("mcp__claude_ai_");
    expect(claudeAiConnectorsPrompt(true)).not.toMatch(/[–—]/);
  });
});

describe("parsing the CLI", () => {
  it("keeps only claude.ai connectors from `claude mcp list`, without URLs", () => {
    const listed = parseClaudeMcpList([
      "Checking MCP server health…",
      "",
      "claude.ai Microsoft 365: https://microsoft365.mcp.claude.com/mcp - ! Needs authentication",
      "claude.ai GitHub: https://api.githubcopilot.com/mcp/ - ✔ Connected",
      "claude.ai Broken: https://x.example/mcp - ✘ Failed to connect",
      "pulsatrix_dispatch: https://host.example/mcp (HTTP) - ✔ Connected",
    ].join("\n"));
    expect(listed).toEqual([
      { name: "Microsoft 365", status: "needs_auth" },
      { name: "GitHub", status: "connected" },
      { name: "Broken", status: "failed" },
    ]);
    expect(JSON.stringify(listed)).not.toContain("https://");
  });
  it("reads the login method only", () => {
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "x@y.z" }))).toBe("subscription");
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: true, authMethod: "api_key" }))).toBe("key");
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: false }))).toBe("none");
    expect(parseClaudeAuthStatus("not json")).toBe("unknown");
  });
});

describe("ClaudeAiConnectorInventory", () => {
  it("lists connectors only for a subscription, cached per account", async () => {
    let clock = 0;
    const run = vi.fn(async ({ args, env }: { args: string[]; env: NodeJS.ProcessEnv }) => {
      if (args[0] === "auth") return JSON.stringify({ loggedIn: true, authMethod: env.CLAUDE_CONFIG_DIR === "/ada" ? "claude.ai" : "api_key" });
      return "claude.ai GitHub: https://g.example - ✔ Connected\n";
    });
    const inventory = new ClaudeAiConnectorInventory({ run, now: () => clock });
    const ada = await inventory.read("person:ada", { cli: "claude", env: { CLAUDE_CONFIG_DIR: "/ada" } });
    const bob = await inventory.read("person:bob", { cli: "claude", env: { CLAUDE_CONFIG_DIR: "/bob" } });
    expect(ada.connectors).toEqual([{ name: "GitHub", status: "connected" }]);
    expect(bob).toMatchObject({ auth: "key", connectors: [] });
    // bob's key never ran `mcp list`
    expect(run.mock.calls.filter(([input]) => input.args[0] === "mcp")).toHaveLength(1);
    await inventory.read("person:ada", { cli: "claude", env: { CLAUDE_CONFIG_DIR: "/ada" } });
    expect(run).toHaveBeenCalledTimes(3);
    clock += 10 * 60_000;
    await inventory.read("person:ada", { cli: "claude", env: { CLAUDE_CONFIG_DIR: "/ada" } });
    expect(run).toHaveBeenCalledTimes(5);
  });
});

function session(principalId: string, scopes: Array<"admin" | "client">): RequestAuth {
  return { kind: "session", via: "cookie", scopes, session: { id: `s-${principalId}`, label: "web", scopes, createdAt: 1, lastSeenAt: 1, principalId } as SessionRecord };
}

function harness(overrides: Partial<HarnessConnectorRouteDeps> = {}) {
  const accounts: string[] = [];
  const deps: HarnessConnectorRouteDeps = {
    organization: true,
    restrictedByPolicy: () => false,
    principalFor: (auth) => (auth.kind === "session" ? auth.session.principalId ?? "" : LOCAL),
    localPrincipalId: () => LOCAL,
    isAdmin: (auth) => auth.kind === "session" && auth.session.principalId === ADA,
    claudeAccountFor: (principalId) => {
      accounts.push(principalId);
      return principalId === BOB ? { unavailable: "not_signed_in" } : { cli: "claude", env: { CLAUDE_CONFIG_DIR: `/logins/${principalId}` }, key: `person:${principalId}` };
    },
    inventory: { read: async (key) => ({ auth: "subscription", connectors: [{ name: `M365 of ${key}`, status: "connected" }], at: 1 }) },
    ...overrides,
  };
  const route = createHarnessConnectorRoutes(deps);
  const call = async (input: { method: string; path: string; auth: RequestAuth; body?: unknown }) => {
    const out: { status?: number; body?: any } = {};
    const ctx = {
      req: { headers: { "content-type": "application/json" } },
      res: { setHeader: () => {}, headersSent: false, writableEnded: false },
      url: new URL(`http://localhost${input.path}`), path: input.path, method: input.method, auth: input.auth,
      json: (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body; },
      readBody: async () => input.body ?? {},
    } as unknown as RouteContext;
    const result = await route(ctx);
    return { ...out, passed: result === PASS };
  };
  return { call, accounts };
}

describe("GET /api/me/harness-connectors", () => {
  it("answers each person with their own account only", async () => {
    const h = harness();
    const ada = await h.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(ADA, ["client"]) });
    expect(ada.status).toBe(200);
    expect(ada.body.claude).toEqual({ available: true, connectors: [{ name: `M365 of person:${ADA}`, status: "connected" }] });
    const bob = await h.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(BOB, ["client"]) });
    expect(bob.body.claude).toEqual({ available: false, reason: "not_signed_in", connectors: [] });
    expect(h.accounts).toEqual([ADA, BOB]);
    expect(ada.body.manageUrl).toBe("https://claude.ai/customize/connectors");
    expect(ada.body.codex.available).toBe(false);
  });
  it("says why when the turns cannot get them", async () => {
    const key = harness({ inventory: { read: async () => ({ auth: "key", connectors: [], at: 1 }) } });
    expect((await key.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(ADA, ["client"]) })).body.claude.reason).toBe("key");
    const policy = harness({ restrictedByPolicy: () => true });
    expect((await policy.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(ADA, ["client"]) })).body.claude.reason).toBe("managed_policy");
    const solo = harness({ organization: false });
    expect((await solo.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(BOB, ["client"]) })).body.claude.reason).toBe("not_operator");
  });
  it("refuses a caller who is not a person", async () => {
    const h = harness({ principalFor: () => "" });
    expect((await h.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(ADA, ["client"]) })).status).toBe(403);
  });
  it("passes other paths", async () => {
    expect((await harness().call({ method: "GET", path: "/api/me/engines", auth: session(ADA, ["client"]) })).passed).toBe(true);
  });
});

describe("PUT /api/harness-connectors/settings (retired)", () => {
  it("is a no-op: Claude connectors stay allowed whatever an admin sends", async () => {
    const h = harness();
    const member = await h.call({ method: "PUT", path: "/api/harness-connectors/settings", auth: session(BOB, ["admin", "client"]), body: { claudeAi: false } });
    expect(member.status).toBe(403);
    const admin = await h.call({ method: "PUT", path: "/api/harness-connectors/settings", auth: session(ADA, ["admin", "client"]), body: { claudeAi: false } });
    expect(admin).toMatchObject({ status: 200, body: { claudeAi: true } });
    const seen = await h.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(BOB, ["client"]) });
    expect(seen.body).toMatchObject({ enabled: true });
    expect(seen.body.claude.reason).not.toBe("disabled");
    const ada = await h.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(ADA, ["client"]) });
    expect(ada.body.claude.available).toBe(true);
  });
  it("accepts only { claudeAi: boolean }", async () => {
    const h = harness();
    const bad = await h.call({ method: "PUT", path: "/api/harness-connectors/settings", auth: session(ADA, ["admin", "client"]), body: { claudeAi: "no", extra: 1 } });
    expect(bad.status).toBe(400);
  });
});

describe("a stored claudeAi: false", () => {
  it("is ignored: the config still loads and the turn keeps the connectors", async () => {
    const { parseStoredConfig } = await import("./config.ts");
    expect(() => parseStoredConfig({ harnessConnectors: { claudeAi: false } })).not.toThrow();
    expect(claudeAiConnectorsForTurn({
      identity: "perspicax", restrictedByPolicy: false, driver: "claudeAgent", via: "subscription",
      speaker: { origin: "person", principalId: ADA }, ownerPrincipalId: ADA, localPrincipalId: LOCAL,
    } as ClaudeAiTurnInput)).toBe(true);
  });
});
