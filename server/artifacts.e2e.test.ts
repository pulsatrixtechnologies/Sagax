// Artifacts through a real server on an isolated fixture: a turn's own
// capability saves one on the internal route (as save_artifact does), the
// person's routes list it, star it, refuse any other change and delete it
// (docs/superpowers/specs/2026-10-16-artifacts-design.md).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { removeTempDir } from "./testing/cleanup.ts";

it("a bot saves an artifact in its turn; the person sees it, stars it and deletes it", async () => {
  const gates = mkdtempSync(join(tmpdir(), "omb-artifacts-"));
  const gate = join(gates, "finish");
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate });
  const api = async (method: string, path: string, body?: unknown, expected = 200, token?: string) => {
    const response = await fetch(fixture.info.url + path, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as any;
    expect(response.status, JSON.stringify(result)).toBe(expected);
    return result;
  };
  try {
    const bot = (await api("POST", "/api/bots", { name: "Scout" }, 201)).bot;
    await runControlOmb(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Keep a CPU widget", "--url", fixture.info.url]);
    let token = "";
    await expect.poll(() => {
      try { token = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN; }
      catch { return false; }
      return Boolean(token);
    }, { timeout: 15_000 }).toBe(true);

    const tool = (name: string, args: Record<string, unknown>, expected = 200) => api("POST", "/api/internal/artifacts", { tool: name, args }, expected, token);
    expect(await tool("save_artifact", { title: "CPU", html: "" }, 400)).toMatchObject({ error: expect.stringContaining("html") });
    const saved = (await tool("save_artifact", { title: "CPU", html: "<p id=v></p>", source: { kind: "command", command: "cat cpu.json" }, interval_seconds: 60 }, 201)).artifact;
    expect(saved).toMatchObject({ title: "CPU", interval_seconds: 60, favorite: false, popped: false, refresh: { state: "idle" } });
    expect((await tool("list_artifacts", {})).artifacts.map((artifact: any) => artifact.id)).toEqual([saved.id]);

    // The person's side: a summary in the list, the document when opened.
    const listed = (await api("GET", `/api/bots/${bot.id}/artifacts`)).artifacts;
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("html");
    expect(listed[0]).toMatchObject({ id: saved.id, botId: bot.id, threadId: bot.threadId });
    expect((await api("GET", `/api/bots/${bot.id}/artifacts/${saved.id}`)).artifact.html).toBe("<p id=v></p>");
    expect((await api("PATCH", `/api/bots/${bot.id}/artifacts/${saved.id}`, { interval_seconds: 30 }, 400)).error).toContain("Ask the bot");
    expect((await api("PATCH", `/api/bots/${bot.id}/artifacts/${saved.id}`, { favorite: true })).artifact.favorite).toBe(true);
    expect((await api("GET", "/api/artifacts")).artifacts.map((artifact: any) => [artifact.id, artifact.favorite])).toEqual([[saved.id, true]]);

    // The bot sees the star the person set; the person deletes it.
    expect((await tool("list_artifacts", {})).artifacts[0].favorite).toBe(true);
    await api("DELETE", `/api/bots/${bot.id}/artifacts/${saved.id}`);
    expect((await api("GET", `/api/bots/${bot.id}/artifacts`)).artifacts).toEqual([]);
    expect(await tool("delete_artifact", { artifact_id: saved.id }, 404)).toMatchObject({ error: expect.any(String) });
    writeFileSync(gate, "finish");
  } finally {
    await fixture.close();
    await removeTempDir(gates);
  }
}, 120_000);
