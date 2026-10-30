import { describe, expect, it } from "vitest";

import { createModelSwitchRoutes } from "./model-switches.ts";

function call(handler: ReturnType<typeof createModelSwitchRoutes>, method: string, body?: unknown, auth: unknown = { who: "p1" }) {
  let answer: { status: number; body: unknown } | null = null;
  const result = handler({
    req: { headers: { "content-type": "application/json" } } as never,
    res: { setHeader: () => {} } as never,
    path: "/api/me/models",
    method,
    auth: auth as never,
    json: ((_res: unknown, status: number, value: unknown) => { answer = { status, body: value }; }) as never,
    readBody: (async () => body) as never,
  } as never);
  return Promise.resolve(result).then(() => answer);
}

describe("GET/PUT /api/me/models", () => {
  it("reads both levels and saves the person's own list, cleaned", async () => {
    const saved = new Map<string, string[]>();
    const handler = createModelSwitchRoutes({
      org: () => ["claude/opus"],
      owner: (auth) => ((auth as { who?: string }).who ?? null),
      mine: (owner) => saved.get(owner) ?? [],
      save: (owner, list) => { saved.set(owner, list); },
    });
    expect(await call(handler, "GET")).toEqual({ status: 200, body: { org: ["claude/opus"], mine: [] } });
    expect(await call(handler, "PUT", { disabledModels: ["grok/fast", "grok/fast", "bad"] })).toEqual({ status: 200, body: { org: ["claude/opus"], mine: ["grok/fast"] } });
    expect((await call(handler, "PUT", { disabledModels: "grok/fast" }))?.status).toBe(400);
    expect((await call(handler, "GET", undefined, {}))?.status).toBe(403);
  });
});
