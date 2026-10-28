import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { advanceWorkflow, parseWorkflowYaml, WorkflowStore, workflowScope, type WorkflowEffects } from "./workflows.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const YAML = `
name: follow-up
steps:
  - send: { bot: bot-a, thread: thread-a, text: Starting }
  - wait: { seconds: 5 }
  - approve: { prompt: Continue?, bot: bot-a, thread: thread-a }
  - send: { bot: bot-a, thread: thread-a, text: Done }
`;

describe("deterministic workflows", () => {
  it("sends, then waits, then stops until the person answers, then continues", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-workflows-"));
    dirs.push(dir);
    const store = new WorkflowStore(dir);
    const scope = workflowScope(false, null);
    expect(scope).toEqual({ organization: false });
    if (!scope) return;
    expect(typeof store.save(scope, YAML)).not.toBe("string");
    let now = 1_000_000;
    const sent: string[] = [];
    const effects = (): WorkflowEffects => ({
      now: () => now,
      deliver(_bot, _thread, text) { sent.push(text); },
    });
    const started = store.start(scope, "follow-up", now);
    expect(typeof started).not.toBe("string");
    if (typeof started === "string") return;
    const waiting = advanceWorkflow(started, effects());
    expect(waiting.status).toBe("waiting");
    expect(waiting.waitUntil).toBe(now + 5_000);
    expect(sent).toEqual(["Starting"]);
    const still = advanceWorkflow(waiting, effects());
    expect(still.waitUntil).toBe(waiting.waitUntil);
    expect(sent).toEqual(["Starting"]);
    now = waiting.waitUntil!;
    const gate = advanceWorkflow(still, effects());
    expect(gate.status).toBe("waiting");
    expect(gate.approval?.prompt).toBe("Continue?");
    expect(sent).toEqual(["Starting", "Continue?"]);
    const held = advanceWorkflow(gate, effects());
    expect(held.status).toBe("waiting");
    expect(sent).toEqual(["Starting", "Continue?"]);
    const done = advanceWorkflow(held, effects(), "yes");
    expect(done.status).toBe("done");
    expect(sent).toEqual(["Starting", "Continue?", "Done"]);
    const stopped = advanceWorkflow(gate, effects(), "no");
    expect(stopped.status).toBe("stopped");
    expect(sent).toEqual(["Starting", "Continue?", "Done"]);
  });

  it("refuses a step that is not send, wait or approve", () => {
    expect(parseWorkflowYaml("name: x\nsteps:\n  - model: { prompt: hi }\n")).toMatch(/send, wait or approve/);
  });
});
