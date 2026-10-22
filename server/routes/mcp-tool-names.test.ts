import { describe, expect, it } from "vitest";

import { createMcpToolNameRoutes } from "./mcp-tool-names.ts";
import { PASS } from "./table.ts";

describe("GET /api/mcp/tool-names", () => {
  const ctx = (path: string, method = "GET") => {
    const sent: Array<{ status: number; body: unknown }> = [];
    const res = { setHeader: () => undefined } as never;
    return { sent, ctx: { res, path, method, json: ((_: unknown, status: number, body: unknown) => { sent.push({ status, body }); }) as never } as never };
  };

  it("serves the gates' reports and passes other paths", async () => {
    const route = createMcpToolNameRoutes(() => [{ server: "perspicax_profil_ottoline_limited", status: "renamed" }]);
    const ok = ctx("/api/mcp/tool-names");
    await route(ok.ctx);
    expect(ok.sent).toEqual([{ status: 200, body: { reports: [{ server: "perspicax_profil_ottoline_limited", status: "renamed" }] } }]);
    expect(await route(ctx("/api/mcp/servers").ctx)).toBe(PASS);
    const post = ctx("/api/mcp/tool-names", "POST");
    await route(post.ctx);
    expect(post.sent[0]!.status).toBe(405);
  });
});
