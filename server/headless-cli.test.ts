import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { applyTeam, giveTask, parseTeamFile, settleTask, waitTask } from "./headless-cli.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("headless team commands", () => {
  it("applies a team from a file, queues a task, and waits without a window", async () => {
    const parsed = parseTeamFile(JSON.stringify({ bots: [{ name: "Ada", title: "Lead" }, { name: "Bea" }] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const dir = mkdtempSync(join(tmpdir(), "sagax-headless-"));
    dirs.push(dir);
    expect(applyTeam(dir, parsed.bots)).toEqual({ ok: true, bots: 2 });
    const given = giveTask(dir, "Ada", "Summarize the notes");
    expect(given.state).toBe("queued");
    const pending = waitTask(dir, given.id, 30, async () => {});
    settleTask(dir, given.id, "done", "two pages");
    await expect(pending).resolves.toEqual({ ok: true, id: given.id, state: "done", result: "two pages" });
    settleTask(dir, given.id, "failed", "blocked");
    await expect(waitTask(dir, given.id, 10, async () => {})).resolves.toMatchObject({ ok: false, state: "failed" });
    await expect(waitTask(dir, "missing", 0, async () => {})).resolves.toMatchObject({ state: "timeout" });
    expect(() => giveTask(dir, "Nobody", "hi")).toThrow(/applied team/);
    writeFileSync(join(dir, "nope.json"), "not json");
    expect(parseTeamFile("not json").ok).toBe(false);
  });
});
