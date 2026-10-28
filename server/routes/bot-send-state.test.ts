import { describe, expect, it, vi } from "vitest";

import { createBotSendStateRoutes } from "./bot-send-state.ts";
import { PASS, type RouteContext } from "./table.ts";

const context = (path: string, method = "GET", query = "") => {
  const headers = new Map<string, string>();
  const json = vi.fn();
  return {
    headers, json,
    ctx: {
      req: {}, res: { setHeader: (k: string, v: string) => headers.set(k, v) }, url: new URL(`http://x${path}${query}`),
      path, method, auth: { id: "auth" }, json, readBody: async () => ({}),
    } as unknown as RouteContext,
  };
};

describe("GET /api/bots/:id/send-state", () => {
  it("answers the block for the named bot and thread, uncached", async () => {
    const requestedTaskBot = vi.fn((id: string) => ({ id }));
    const sendStateFor = vi.fn(() => ({ kind: "connect" }) as never);
    const handler = createBotSendStateRoutes({ requestedTaskBot, sendStateFor });
    const { ctx, json, headers } = context("/api/bots/b-1/send-state", "GET", "?threadId=t-9");
    await handler(ctx);
    expect(requestedTaskBot).toHaveBeenCalledWith("b-1", "t-9");
    expect(sendStateFor).toHaveBeenCalledWith({ id: "b-1" }, { id: "auth" });
    expect(json).toHaveBeenCalledWith(expect.anything(), 200, { block: { kind: "connect" } });
    expect(headers.get("cache-control")).toBe("no-store");
  });

  it("answers no block when nothing certain stops the send", async () => {
    const handler = createBotSendStateRoutes({ requestedTaskBot: (id) => ({ id }), sendStateFor: () => null });
    const { ctx, json } = context("/api/bots/b-1/send-state");
    await handler(ctx);
    expect(json).toHaveBeenCalledWith(expect.anything(), 200, { block: null });
  });

  it("passes any other path and any other method", async () => {
    const handler = createBotSendStateRoutes({ requestedTaskBot: (id) => ({ id }), sendStateFor: () => null });
    expect(await handler(context("/api/bots/b-1/history").ctx)).toBe(PASS);
    expect(await handler(context("/api/bots/b-1/send-state", "POST").ctx)).toBe(PASS);
  });
});
