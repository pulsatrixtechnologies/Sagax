// Named OpenAI-compatible servers over HTTP (2026-10-30): add, edit, remove,
// an organization admin's only, never one in use, never another engine.
import { describe, expect, it } from "vitest";

import type { AppConfig } from "../config.ts";
import { createOpenAiCompatServerRoutes, type OpenAiCompatServerRouteDeps } from "./openai-compat-servers.ts";
import { PASS } from "./table.ts";

type Instances = NonNullable<AppConfig["instances"]>;

function harness(overrides: Partial<OpenAiCompatServerRouteDeps> = {}) {
  let instances: Instances = { claude: { driver: "claudeAgent" } };
  let keys: AppConfig["openaiCompatServers"] = {};
  const used = new Set<string>();
  const deps: OpenAiCompatServerRouteDeps = {
    allowed: () => true,
    instances: () => instances,
    keys: () => keys,
    persist: async (_id, next, nextKeys) => { instances = next; keys = nextKeys; },
    inUse: (id) => used.has(id),
    describe: async () => Object.keys(instances),
    exclusive: (work) => work(),
    ...overrides,
  };
  const route = createOpenAiCompatServerRoutes(deps);
  const call = async (method: string, path: string, body?: unknown) => {
    const sent: Array<{ status: number; body: any }> = [];
    const out = await route({
      req: { headers: { "content-type": "application/json" } } as never,
      res: {} as never, url: new URL(`http://localhost${path}`), path, method, auth: {} as never,
      json: ((_: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as never,
      readBody: (async () => body) as never,
    });
    return { out, sent: sent[0]! };
  };
  return { call, used, get: () => ({ instances, keys }) };
}

describe("named OpenAI-compatible server routes", () => {
  it("adds, renames, rekeys and removes a server; the key never comes back", async () => {
    const h = harness();
    const added = await h.call("POST", "/api/instances/openai-compat-servers", { displayName: "Gateway", url: "https://gw.example.test/v1", key: "k1" });
    expect(added.sent.status).toBe(201);
    const id = added.sent.body.instanceId as string;
    expect(id).toMatch(/^compat-/);
    expect(JSON.stringify(added.sent.body)).not.toContain("k1");
    expect(h.get().keys).toEqual({ [id]: { key: "k1" } });
    expect((await h.call("PATCH", `/api/instances/openai-compat-servers/${id}`, { displayName: "Gateway EU" })).sent.status).toBe(200);
    expect(h.get().instances[id]).toMatchObject({ displayName: "Gateway EU" });
    h.used.add(id);
    expect((await h.call("DELETE", `/api/instances/openai-compat-servers/${id}`)).sent.status).toBe(409);
    h.used.delete(id);
    expect((await h.call("DELETE", `/api/instances/openai-compat-servers/${id}`)).sent.status).toBe(200);
    expect(h.get()).toEqual({ instances: { claude: { driver: "claudeAgent" } }, keys: {} });
  });

  it("refuses a member, another engine, a bad address, and passes other paths", async () => {
    expect((await harness({ allowed: () => false }).call("POST", "/api/instances/openai-compat-servers", { displayName: "A", url: "https://a.example.test" })).sent.status).toBe(403);
    const h = harness();
    expect((await h.call("DELETE", "/api/instances/openai-compat-servers/claude")).sent.status).toBe(404);
    expect((await h.call("POST", "/api/instances/openai-compat-servers", { displayName: "A", url: "http://a.example.test" })).sent.status).toBe(400);
    expect((await h.call("PATCH", "/api/instances/openai-compat-servers", { displayName: "A" })).sent.status).toBe(404);
    expect((await h.call("GET", "/api/instances/openai-compat-servers")).out).toBe(PASS);
    expect((await h.call("POST", "/api/instances/claude-accounts", {})).out).toBe(PASS);
  });
});
