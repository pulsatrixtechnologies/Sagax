// 2026-10-17 (#695 follow-up): a saved MCP server whose name is now reserved
// is renamed from the MCP settings, saved off, its sign-ins forgotten and the
// bots that listed it moved along. Never back under a reserved name.
import { describe, expect, it, vi } from "vitest";

import { createMcpServerRenameRoutes, type McpServerRenameDeps } from "./mcp-server-rename.ts";
import { PASS } from "./table.ts";

function harness(initial: Record<string, unknown>, overrides: Partial<McpServerRenameDeps> = {}) {
  let saved = initial;
  let busy = false;
  const forgotten: string[] = [];
  const moved: Array<[string, string]> = [];
  const deps: McpServerRenameDeps = {
    servers: () => saved,
    acquire: () => (busy ? false : (busy = true)),
    release: () => { busy = false; },
    refusal: () => undefined,
    persist: (next) => { saved = next; },
    forgetSignIn: async (name) => { forgotten.push(name); },
    renameInBots: (from, to) => { moved.push([from, to]); },
    afterRename: async () => undefined,
    response: () => ({ servers: Object.keys(saved) }),
    log: () => undefined,
    ...overrides,
  };
  const route = createMcpServerRenameRoutes(deps);
  const call = async (path: string, body: unknown, method = "POST", contentType = "application/json") => {
    const sent: Array<{ status: number; body: unknown }> = [];
    const out = await route({
      req: { headers: { "content-type": contentType } } as never,
      res: {} as never,
      url: new URL(`http://localhost${path}`),
      path,
      method,
      auth: {} as never,
      json: ((_: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as never,
      readBody: (async () => body) as never,
    });
    return { out, sent: sent[0] };
  };
  return { call, saved: () => saved, forgotten, moved, setBusy: (value: boolean) => { busy = value; } };
}

describe("POST /api/mcp/servers/:name/rename", () => {
  it("renames a reserved name, saved off, sign-ins forgotten, bots moved", async () => {
    const h = harness({ notes: { command: "n" }, mcp: { command: "npx", enabled: true } });
    const { sent } = await h.call("/api/mcp/servers/mcp/rename", { to: "my-mcp" });
    expect(sent).toEqual({ status: 200, body: { servers: ["notes", "my-mcp"], renamed: { from: "mcp", to: "my-mcp" } } });
    expect(h.saved()["my-mcp"]).toMatchObject({ command: "npx", enabled: false });
    expect(h.saved().mcp).toBeUndefined();
    expect(h.forgotten).toEqual(["mcp", "my-mcp"]);
    expect(h.moved).toEqual([["mcp", "my-mcp"]]);
  });

  it("refuses a name that is not reserved, a reserved or taken target, a policy refusal, and a busy writer", async () => {
    const h = harness({ notes: { command: "n" }, "sagax-x": { command: "x" } });
    expect((await h.call("/api/mcp/servers/notes/rename", { to: "notes2" })).sent.status).toBe(400);
    expect((await h.call("/api/mcp/servers/sagax-x/rename", { to: "sagax-y" })).sent.status).toBe(400);
    expect((await h.call("/api/mcp/servers/sagax-x/rename", { to: "notes" })).sent.status).toBe(409);
    expect((await h.call("/api/mcp/servers/sagax-x/rename", {})).sent.status).toBe(400);
    expect((await h.call("/api/mcp/servers/sagax-x/rename", { to: "x" }, "GET")).sent.status).toBe(405);
    expect((await h.call("/api/mcp/servers/sagax-x/rename", { to: "x" }, "POST", "text/plain")).sent.status).toBe(415);
    h.setBusy(true);
    expect((await h.call("/api/mcp/servers/sagax-x/rename", { to: "x" })).sent.status).toBe(409);
    h.setBusy(false);
    expect(Object.keys(h.saved())).toEqual(["notes", "sagax-x"]);

    const refusal = vi.fn((): { error: string; code: string } | undefined => ({ error: "Not approved.", code: "managed_policy" }));
    const managed = harness({ "sagax-x": { command: "x" } }, { refusal });
    expect((await managed.call("/api/mcp/servers/sagax-x/rename", { to: "x" })).sent).toEqual({ status: 403, body: { error: "Not approved.", code: "managed_policy" } });
    expect(refusal).toHaveBeenCalledWith("x", expect.objectContaining({ command: "x", enabled: false }));
    expect(Object.keys(managed.saved())).toEqual(["sagax-x"]);
  });

  it("passes other paths", async () => {
    const h = harness({});
    expect((await h.call("/api/mcp/servers", {})).out).toBe(PASS);
    expect((await h.call("/api/mcp/servers/mcp/test", {})).out).toBe(PASS);
  });
});
