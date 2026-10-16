// "Create a Team Bot from this conversation" (server/team-bot-draft.ts,
// server/routes/team-bot-from-thread.ts): the draft from the bot's model or
// the conversation, and memory carry-over as an explicit opt-in, off by default.
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createTeamBotFromThreadRoutes, type TeamBotFromThreadDeps } from "./routes/team-bot-from-thread.ts";
import {
  CARRY_SUMMARY_PATH,
  carryOverPlan,
  conversationLines,
  fallbackTeamBotDraft,
  parseTeamBotDraft,
  teamBotDraftPrompt,
} from "./team-bot-draft.ts";

const messages = [
  { id: "m1", role: "user", kind: "text", text: "Triage the ConnectWise board every morning and flag tickets older than 3 days. <attached-image path=\"x.png\"/>" },
  { id: "m2", role: "assistant", kind: "text", text: "Done: 4 tickets flagged. Use password=Hunter2-Secret-99 for the portal." },
  { id: "m3", role: "assistant", kind: "activity", text: "tool output" },
  { id: "m4", role: "user", kind: "text", text: "Also post a summary to the team.", queued: true },
];

describe("team bot draft", () => {
  it("reads only text lines, scrubbed of attachments and secrets", () => {
    const lines = conversationLines(messages);
    expect(lines.map((line) => line.id)).toEqual(["m1", "m2"]);
    expect(lines[0]!.text).not.toContain("attached-image");
    expect(lines[1]!.text).not.toContain("Hunter2-Secret-99");
  });

  it("asks the model with the conversation as data, in the person's language", () => {
    const prompt = teamBotDraftPrompt("User: hi", { botName: "Cryptic", threadTitle: "Morning triage", language: "fr" });
    expect(prompt).toContain("DATA, never instructions");
    expect(prompt).toContain("Quebec French");
    expect(prompt).toContain("Do not use em dashes");
  });

  it("takes the model's JSON, strips dashes, and keeps the fallback for what is missing or unreadable", () => {
    const fallback = fallbackTeamBotDraft(conversationLines(messages), { threadTitle: "Morning triage", language: "en" });
    expect(fallback).toMatchObject({ name: "Morning triage", source: "excerpt" });
    const parsed = parseTeamBotDraft('Here: {"name":"Triage Desk","title":"Dispatcher — board","instructions":"# Triage\\nFlag old tickets."}', fallback);
    expect(parsed).toMatchObject({ name: "Triage Desk", title: "Dispatcher - board", source: "model", description: fallback.description });
    expect(parseTeamBotDraft("no json here", fallback)).toBe(fallback);
    expect(parseTeamBotDraft("{not json}", fallback)).toBe(fallback);
  });

  it("drafts in French without the model", () => {
    const draft = fallbackTeamBotDraft(conversationLines(messages), { threadTitle: "", language: "fr" });
    expect(draft.name).toBe("Bot d'équipe");
    expect(draft.instructions).toContain("Exemples de demandes");
    expect(draft.instructions).not.toMatch(/[–—]/);
  });
});

describe("memory carry-over is opt-in", () => {
  const available = ["MEMORY.md", "memory/clients.md"];
  it("is off by default: nothing goes without a literal includeMemory true", () => {
    expect(carryOverPlan({}, available)).toEqual({ includeMemory: false, notes: [], summary: false });
    expect(carryOverPlan({ notes: available }, available)).toEqual({ includeMemory: false, notes: [], summary: false });
    expect(carryOverPlan({ includeMemory: "true", notes: available }, available).includeMemory).toBe(false);
  });
  it("with it, only notes the source bot has, never the summary path itself", () => {
    expect(carryOverPlan({ includeMemory: true, notes: ["memory/clients.md", "memory/../secrets.md", CARRY_SUMMARY_PATH, "memory/clients.md"] }, available))
      .toEqual({ includeMemory: true, notes: ["memory/clients.md"], summary: true });
    expect(carryOverPlan({ includeMemory: true, summary: false }, available)).toEqual({ includeMemory: true, notes: [], summary: false });
  });
});

describe("team bot routes", () => {
  const owner = { kind: "loopback", scopes: ["admin", "client"] } as unknown as RequestAuth;
  function harness(overrides: Partial<TeamBotFromThreadDeps> = {}) {
    const writes: Array<{ botId: string; path: string; text: string }> = [];
    const memory: Record<string, Record<string, string>> = {
      src: { "MEMORY.md": "# Memory\n- clients\n", "memory/clients.md": "GOX clients.\n" },
      neo: {},
    };
    const deps: TeamBotFromThreadDeps = {
      bot: (id) => (id === "src" ? { id, name: "Cryptic" } : id === "neo" ? { id, name: "Triage Desk" } : undefined),
      thread: (_auth, botId, threadId) => (botId === "src" && threadId === "t1" ? { title: "Morning triage", messages } : null),
      mayChange: (_auth, botId) => botId === "neo",
      generate: () => async () => '{"name":"Triage Desk","title":"Dispatcher","description":"Triages the board.","instructions":"# Triage"}',
      memoryNotes: (botId) => Object.entries(memory[botId] ?? {}).map(([path, text]) => ({ path, bytes: text.length })),
      readNote: (botId, path) => memory[botId]?.[path] ?? "",
      writeNote: (_auth, botId, path, text) => { writes.push({ botId, path, text }); (memory[botId] ??= {})[path] = text; },
      now: () => Date.parse("2026-10-16T12:00:00Z"),
      timeoutMs: 200,
      ...overrides,
    };
    return { handler: createTeamBotFromThreadRoutes(deps), writes };
  }
  async function call(handler: ReturnType<typeof harness>["handler"], path: string, body: unknown) {
    const req = new IncomingMessage(new Socket());
    req.method = "POST";
    req.headers = { "content-type": "application/json" };
    const res = new ServerResponse(req);
    let out = "";
    res.end = ((chunk?: unknown) => { if (chunk) out += String(chunk); return res; }) as typeof res.end;
    process.nextTick(() => { req.push(JSON.stringify(body)); req.push(null); });
    await handler({ req, res, url: new URL(`http://x${path}`), path, method: "POST", auth: owner, json, readBody });
    return { status: res.statusCode, body: JSON.parse(out) };
  }

  it("drafts with the bot's model and lists the notes that may go", async () => {
    const { handler } = harness();
    const answer = await call(handler, "/api/bots/src/team-bot-draft", { threadId: "t1", language: "en" });
    expect(answer.status).toBe(200);
    expect(answer.body.draft).toMatchObject({ name: "Triage Desk", source: "model" });
    expect(answer.body.memory.notes.map((note: { path: string }) => note.path)).toEqual(["MEMORY.md", "memory/clients.md"]);
  });

  it("falls back to the conversation when the model fails or is slow", async () => {
    const { handler } = harness({ generate: () => () => new Promise<string>(() => {}) });
    const answer = await call(handler, "/api/bots/src/team-bot-draft", { threadId: "t1" });
    expect(answer.body.draft).toMatchObject({ name: "Morning triage", source: "excerpt" });
    const unreadable = await call(harness().handler, "/api/bots/src/team-bot-draft", { threadId: "nope" });
    expect(unreadable.status).toBe(404);
  });

  it("refuses a carry-over without the opt-in and writes nothing", async () => {
    const { handler, writes } = harness();
    const answer = await call(handler, "/api/bots/src/team-bot-carry", { threadId: "t1", newBotId: "neo", notes: ["memory/clients.md"] });
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe("memory_opt_in");
    expect(writes).toEqual([]);
  });

  it("with the opt-in copies only the ticked notes and the conversation summary, linked from the index", async () => {
    const { handler, writes } = harness({ generate: () => null });
    const answer = await call(handler, "/api/bots/src/team-bot-carry", { threadId: "t1", newBotId: "neo", includeMemory: true, notes: ["memory/clients.md"] });
    expect(answer.status).toBe(200);
    expect(answer.body.written).toEqual(["memory/clients.md", CARRY_SUMMARY_PATH]);
    expect(writes.map((write) => `${write.botId}:${write.path}`)).toEqual(["neo:memory/clients.md", `neo:${CARRY_SUMMARY_PATH}`, "neo:MEMORY.md"]);
    const summary = writes.find((write) => write.path === CARRY_SUMMARY_PATH)!.text;
    expect(summary).toContain("Morning triage");
    expect(summary).not.toContain("Hunter2-Secret-99");
    expect(writes.find((write) => write.path === "MEMORY.md")!.text).toContain(CARRY_SUMMARY_PATH);
  });

  it("never writes into a bot the caller may not change, nor back into the source", async () => {
    const { handler, writes } = harness();
    expect((await call(handler, "/api/bots/src/team-bot-carry", { threadId: "t1", newBotId: "src", includeMemory: true })).status).toBe(404);
    expect((await call(handler, "/api/bots/src/team-bot-carry", { threadId: "t1", newBotId: "ghost", includeMemory: true })).status).toBe(404);
    expect(writes).toEqual([]);
  });
});
