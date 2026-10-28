import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { memoryReadersOf } from "./memory-audience.ts";
import { memoryMayShow } from "./memory-audience.ts";
import { BriefStore, briefReadTools, briefToolAllowed, datedBriefPiece, keptMemoryLine, readConnectedBrief, runBriefPass } from "./background-brief.ts";

const piece = { piece: "Inbox, Monday note", asOf: "2026-10-26", text: "Three invoices arrived, 3 in all." };

describe("background brief", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("reads only, cites every number, skips a rejection, and stays with the person", () => {
    expect(briefToolAllowed("list_messages")).toBe(true);
    expect(briefToolAllowed("send_mail")).toBe(false);
    expect(briefToolAllowed("browse")).toBe(false);
    expect(briefToolAllowed("write_file")).toBe(false);
    expect(runBriefPass({ tools: ["send_mail"], pieces: [piece], costUsd: 0.01, fastModel: "fast-1" }).ok).toBe(false);
    expect(runBriefPass({ tools: ["list_messages"], pieces: [piece], costUsd: 0.01, fastModel: "" }).ok).toBe(false);
    const uncited = runBriefPass({ tools: ["list_messages"], pieces: [{ piece: "note", asOf: "Monday", text: "About 12 items" }], costUsd: 0.02, fastModel: "fast-1" });
    expect(uncited.ok && uncited.suggestions).toEqual([]);
    const pass = runBriefPass({ tools: ["read_inbox"], pieces: [piece], costUsd: 0.02, fastModel: "fast-1" }, ["three invoices arrived, 3 in all"]);
    expect(pass.ok && pass.suggestions).toEqual([]);
    const open = runBriefPass({ tools: ["read_inbox"], pieces: [piece], costUsd: 0.02, fastModel: "fast-1" });
    expect(open.ok && open.suggestions[0]).toMatchObject({ costUsd: 0.02, model: "fast-1", sources: [piece] });
    const line = keptMemoryLine("Three invoices arrived, 3 in all.", new Date(2026, 9, 27));
    expect(memoryReadersOf(line)).toEqual({ kind: "person" });
    expect(memoryMayShow({ kind: "person" }, { kind: "room", id: "garden" })).toBe(false);
    expect(line).toContain("readers person");
  });

  it("stores the cadence the person chose and does not rewrite a rejection", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-brief-"));
    dirs.push(dir);
    const store = new BriefStore(join(dir, "background-brief.json"), () => 1_000);
    expect(store.due("bot-1")).toBe(false);
    store.saveSettings("bot-1", { enabled: true, everyHours: 6, subjects: ["invoices"] });
    expect(store.view("bot-1").settings).toEqual({ enabled: true, everyHours: 6, subjects: ["invoices"] });
    expect(store.due("bot-1", 1_000)).toBe(true);
    const pass = runBriefPass({ tools: ["read_inbox"], pieces: [piece], costUsd: 0.02, fastModel: "fast-1" });
    if (!pass.ok) throw new Error(pass.error);
    const [added] = store.recordPass("bot-1", pass);
    expect(added?.costUsd).toBe(0.02);
    expect(store.due("bot-1", 1_000 + 5 * 3_600_000)).toBe(false);
    expect(store.due("bot-1", 1_000 + 6 * 3_600_000)).toBe(true);
    expect(store.reject("bot-1", added!.id)?.status).toBe("rejected");
    expect(store.recordPass("bot-1", pass)).toEqual([]);
    expect(store.view("bot-1").costUsd).toBe(0);
  });

  it("reads a connected app, drops a number with no date, and stays empty when nothing is connected", async () => {
    expect(briefReadTools(["list_messages", "send_mail", "browser_open", "write_file"])).toEqual(["list_messages"]);
    expect(datedBriefPiece("Inbox", "list_messages", "Three invoices arrived")).toBeNull();
    const none = await readConnectedBrief({ apps: () => [], read: async () => "3" }, { costUsd: 0, fastModel: "fast-1" });
    expect(none).toMatchObject({ ok: true, apps: 0, notice: "no_apps", suggestions: [] });
    const called: string[] = [];
    const read = await readConnectedBrief({
      apps: () => [{ name: "Inbox", tools: ["list_messages", "send_mail"] }],
      read: async (app, tool) => {
        called.push(`${app}:${tool}`);
        return tool === "list_messages" ? "Monday note 2026-10-26: 3 invoices arrived" : "sent";
      },
    }, { costUsd: 0, fastModel: "fast-1" });
    expect(called).toEqual(["Inbox:list_messages"]);
    expect(read.ok && read.suggestions[0]).toMatchObject({ sources: [{ piece: "Inbox / list_messages", asOf: "2026-10-26" }] });
    expect(read.ok && read.suggestions[0]?.text).toContain("3");
    expect(read.ok && read.suggestions[0]?.text).toContain("2026-10-26");
  });
});
