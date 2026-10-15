import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createPerspicaxClaimsInternalRoutes, type ClaimsInternalContext } from "./perspicax-claims-internal.ts";
import { PASS } from "./table.ts";

const capability = { botId: "bot-1", threadId: "t-1", generation: "g-1" };

function call(body: Record<string, unknown>, over: Partial<ClaimsInternalContext> = {}) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const ctx: ClaimsInternalContext = {
    res: {} as ServerResponse,
    path: "/api/internal/perspicax/claims",
    method: "POST",
    json: ((_res: ServerResponse, status: number, out: unknown) => { sent.push({ status, body: out }); }) as ClaimsInternalContext["json"],
    capability,
    readBody: async () => body,
    ...over,
  };
  return { ctx, sent };
}

describe("POST /api/internal/perspicax/claims", () => {
  it("passes other paths and methods", async () => {
    const route = createPerspicaxClaimsInternalRoutes({ perspicaxMcp: () => null, review: async () => null });
    expect(await route(call({}, { path: "/api/internal/perspicax/mcp" }).ctx)).toBe(PASS);
    expect(await route(call({}, { method: "GET" }).ctx)).toBe(PASS);
  });

  it("forwards a reviewed claim as the capability's bot", async () => {
    const callTool = vi.fn(async () => ({ ok: true as const, isError: false, value: { ok: true, id: "c1" } }));
    const review = vi.fn(async () => null);
    const route = createPerspicaxClaimsInternalRoutes({ perspicaxMcp: () => ({ callTool }), review });
    const { ctx, sent } = call({ tool: "claim", args: { resource: "ticket:1", purpose: "fix" } });
    await route(ctx);
    expect(review).toHaveBeenCalledOnce();
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({ botId: "bot-1", threadId: "t-1", generation: "g-1", name: "claim" }));
    expect(sent).toEqual([{ status: 200, body: { result: { ok: true, id: "c1" }, isError: false } }]);
  });

  it("answers the review's refusal without calling Perspicax", async () => {
    const callTool = vi.fn();
    const route = createPerspicaxClaimsInternalRoutes({ perspicaxMcp: () => ({ callTool }), review: async () => "held for review" });
    const { ctx, sent } = call({ tool: "claim", args: { resource: "ticket:1" } });
    await route(ctx);
    expect(callTool).not.toHaveBeenCalled();
    expect(sent).toEqual([{ status: 200, body: { result: "held for review", isError: true } }]);
  });

  it("does not review claim_list and answers 409 when Perspicax is not linked", async () => {
    const review = vi.fn(async () => "never");
    const route = createPerspicaxClaimsInternalRoutes({ perspicaxMcp: () => null, review });
    const { ctx, sent } = call({ tool: "claim_list", args: {} });
    await route(ctx);
    expect(review).not.toHaveBeenCalled();
    expect(sent[0]?.status).toBe(409);
  });
});
