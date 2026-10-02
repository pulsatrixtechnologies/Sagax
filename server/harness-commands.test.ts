import { describe, expect, it, vi } from "vitest";

import type { HarnessCommand } from "../shared/harness-commands.ts";
import {
  createHarnessCommandRoutes,
  HarnessCommandCatalog,
  harnessEngineFor,
  typedCommandForTurn,
  unavailableCommandError,
  type HarnessCommandSource,
} from "./harness-commands.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteContext } from "./routes/table.ts";

const COMMANDS: HarnessCommand[] = [
  { name: "compact", description: "Compact", group: "engine", argumentHint: "<instructions>" },
  { name: "goal", description: "Engine goal", group: "engine" },
  { name: "model", description: "Model", group: "engine", unavailable: "managed" },
  { name: "pulsatrix-flow:using-px-flow", description: "Flow", group: "plugins", aliases: ["using-px-flow"] },
];

function source(list: HarnessCommandSource["list"] = async () => COMMANDS, cwd = "/bots/b1"): HarnessCommandSource {
  return { botId: "b1", instanceId: "claude", engine: "claude", scope: { botId: "b1", cwd }, list };
}

describe("HarnessCommandCatalog", () => {
  it("reads once per scope, again after the TTL or on refresh, and keeps the last good list", async () => {
    let now = 1_000;
    const catalog = new HarnessCommandCatalog({ now: () => now, ttlMs: 100 });
    const list = vi.fn(async () => COMMANDS);
    const a = source(list);
    const [first, second] = await Promise.all([catalog.read(a), catalog.read(a)]);
    expect(first).toEqual({ engine: "claude", commands: COMMANDS, at: 1_000 });
    expect(second).toBe(first);
    expect(list).toHaveBeenCalledTimes(1);
    await catalog.read(source(list, "/elsewhere"));
    expect(list).toHaveBeenCalledTimes(2);
    now += 50;
    await catalog.read(a);
    expect(list).toHaveBeenCalledTimes(2);
    await catalog.read(a, true);
    expect(list).toHaveBeenCalledTimes(3);
    list.mockRejectedValueOnce(new Error("cli gone"));
    now += 500;
    expect((await catalog.read(a)).commands).toEqual(COMMANDS);
    await expect(catalog.read(source(async () => { throw new Error("no"); }, "/new"))).rejects.toThrow("no");
  });
});

describe("typedCommandForTurn", () => {
  it("passes engine commands through and lets Sagax win a collision", async () => {
    const catalog = new HarnessCommandCatalog();
    expect(await typedCommandForTurn("/compact keep the plan", source(), catalog)).toMatchObject({ kind: "engine", engineText: "/compact keep the plan" });
    expect(await typedCommandForTurn("/using-px-flow billet 5", source(), catalog)).toMatchObject({ kind: "engine", engineText: "/using-px-flow billet 5" });
    expect(await typedCommandForTurn("/goal ship", source(), catalog)).toEqual({ kind: "sagax", name: "goal" });
    expect(await typedCommandForTurn("/engine:goal ship", source(), catalog)).toMatchObject({ kind: "engine", engineText: "/goal ship" });
    expect(await typedCommandForTurn("/model opus", source(), catalog)).toMatchObject({ kind: "unavailable", reason: "managed" });
  });

  it("never asks the engine about an ordinary message or a Sagax command", async () => {
    const list = vi.fn(async () => COMMANDS);
    const catalog = new HarnessCommandCatalog();
    for (const text of ["hello", "/usr/bin is mine", "/setup", "/learn how", "see /compact"]) {
      expect((await typedCommandForTurn(text, source(list), catalog)).kind).not.toBe("engine");
    }
    expect(list).not.toHaveBeenCalled();
    expect(await typedCommandForTurn("/compact", null, catalog)).toEqual({ kind: "none" });
  });

  it("treats a command as an ordinary message when the engine cannot answer", async () => {
    const catalog = new HarnessCommandCatalog();
    expect(await typedCommandForTurn("/compact", source(async () => { throw new Error("down"); }), catalog)).toEqual({ kind: "none" });
  });

  it("says why a command cannot run", () => {
    const managed = unavailableCommandError({ kind: "unavailable", command: COMMANDS[2]!, reason: "managed" });
    expect(managed.code).toBe("harness_command_managed");
    expect(unavailableCommandError({ kind: "unavailable", command: { name: "color", description: "", group: "engine" }, reason: "interactive" }).code)
      .toBe("harness_command_interactive");
  });
});

describe("harnessEngineFor", () => {
  it("lists Claude and Codex only", () => {
    expect(harnessEngineFor("claudeAgent")).toBe("claude");
    expect(harnessEngineFor("codex")).toBe("codex");
    expect(harnessEngineFor("grok")).toBeNull();
  });
});

describe("GET /api/bots/:id/harness-commands", () => {
  const auth = { kind: "session", scopes: ["client"], session: { principalId: "p1" } } as unknown as RequestAuth;
  const call = async (path: string, sourceFor: Parameters<typeof createHarnessCommandRoutes>[0]["sourceFor"], method = "GET") => {
    const route = createHarnessCommandRoutes({ catalog: new HarnessCommandCatalog(), sourceFor });
    const out: { status?: number; body?: any } = {};
    const url = new URL(`http://localhost${path}`);
    const ctx = {
      req: { headers: {} },
      res: { setHeader: () => {} },
      url, path: url.pathname, method, auth,
      json: (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body; },
    } as unknown as RouteContext;
    const result = await route(ctx);
    return { ...out, passed: result === PASS };
  };

  it("lists the bot's engine commands for the asked conversation", async () => {
    const seen: Array<string | null> = [];
    const answer = await call("/api/bots/b1/harness-commands?threadId=t-1", (_auth, botId, threadId) => {
      seen.push(`${botId}:${threadId}`);
      return source();
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ available: true, engine: "claude", commands: COMMANDS });
    expect(seen).toEqual(["b1:t-1"]);
  });

  it("answers a refusal, an engine without commands, and a failed read", async () => {
    expect((await call("/api/bots/b1/harness-commands", () => ({ status: 404, error: "no such bot" }))).status).toBe(404);
    expect((await call("/api/bots/b1/harness-commands", () => null)).body).toEqual({ available: false, reason: "not_supported", commands: [] });
    expect((await call("/api/bots/b1/harness-commands", () => source(async () => { throw new Error("x"); }))).body)
      .toEqual({ available: false, reason: "unavailable", engine: "claude", commands: [] });
    expect((await call("/api/bots/b1/harness-commands?threadId=../x", () => source())).status).toBe(400);
    expect((await call("/api/bots/b1/harness-commands", () => source(), "POST")).status).toBe(405);
    expect((await call("/api/bots/b1/other", () => source())).passed).toBe(true);
  });
});
