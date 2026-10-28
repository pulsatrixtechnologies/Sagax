import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { IncomingMessage, ServerResponse } from "node:http";

import { json } from "./harness/http.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createWorkflowRoutes } from "./routes/workflows.ts";
import { advanceWorkflow, parseWorkflowYaml, WorkflowStore, workflowScope, workflowScopeKey, type WorkflowEffects } from "./workflows.ts";

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

  it("keeps each person on a shared server in their own folder", () => {
    const local = workflowScope(false, null);
    const guest = workflowScope(false, null, "guest-a");
    const other = workflowScope(false, null, "guest-b");
    expect(local).toEqual({ organization: false });
    if (!guest || !other) throw new Error("a person scope is missing");
    expect(workflowScopeKey(guest)).not.toBe("local");
    expect(workflowScopeKey(guest)).not.toBe(workflowScopeKey(other));
  });

  it("drops finished runs after an hour and does not scan them every tick", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-workflows-"));
    dirs.push(dir);
    const store = new WorkflowStore(dir);
    store.writeRun({
      id: "wf_0123456789abcdef",
      name: "follow-up",
      scopeKey: "local",
      steps: [],
      index: 0,
      status: "done",
      updatedAt: 2_000,
    });
    expect(store.getRun("wf_0123456789abcdef")?.status).toBe("done");
    expect(store.pruneFinished(2_000 + 59 * 60 * 1000)).toBe(0);
    expect(store.getRun("wf_0123456789abcdef")?.status).toBe("done");
    expect(store.pruneFinished(2_000 + 60 * 60 * 1000)).toBe(1);
    expect(store.getRun("wf_0123456789abcdef")).toBeNull();
    expect(store.due(9_000_000)).toEqual([]);
  });
});

describe("workflow routes", () => {
  it("refuses a step on someone else's conversation without replacing the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-workflows-"));
    dirs.push(dir);
    const store = new WorkflowStore(dir);
    const scope = workflowScope(false, null);
    if (!scope) return;
    const kept = "name: follow-up\nsteps:\n  - wait: { seconds: 5 }\n";
    expect(typeof store.save(scope, kept)).not.toBe("string");
    const handler = createWorkflowRoutes({
      store,
      scope: () => scope,
      owns: (_auth, _bot, thread) => thread === "thread-a",
      deliver() {},
      now: () => 1,
    });
    const res = {
      status: 0,
      body: "",
      setHeader() {},
      writeHead(status: number) { this.status = status; },
      end(data?: string) { this.body = data ?? ""; },
    };
    await handler({
      req: {} as IncomingMessage,
      res: res as unknown as ServerResponse,
      url: new URL("http://127.0.0.1/api/me/workflows"),
      path: "/api/me/workflows",
      method: "PUT",
      auth: { kind: "session", scopes: ["client"], via: "bearer", session: { id: "s" } } as unknown as RequestAuth,
      json,
      readBody: async () => ({ yaml: "name: follow-up\nsteps:\n  - send: { bot: bot-a, thread: other, text: hi }\n" }),
    });
    expect(res.status).toBe(403);
    expect(store.read(scope, "follow-up")?.steps[0]?.kind).toBe("wait");
  });
});
