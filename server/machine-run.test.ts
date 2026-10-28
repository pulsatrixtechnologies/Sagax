import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "../shared/runtime-events.ts";
import { createMachineRuns, type MachineEngine } from "./machine-run.ts";

describe("machine runs", () => {
  it("runs the computer's engine and keeps the approval on that engine", async () => {
    const listeners = new Set<(event: RuntimeEvent) => void>();
    const answered: string[] = [];
    const engine: MachineEngine = {
      async sendTurn(input) {
        for (const listener of listeners) {
          listener({ type: "content.delta", threadId: input.threadId, streamKind: "assistant_text", delta: "bonjour", turnId: "t", eventId: "e", provider: "pi", providerInstanceId: "pi", createdAt: "" } as RuntimeEvent);
          listener({ type: "request.opened", threadId: input.threadId, requestType: "permission", requestId: "req-1", tool: "Bash", summary: "list files", turnId: "t", eventId: "e2", provider: "pi", providerInstanceId: "pi", createdAt: "" } as RuntimeEvent);
        }
        return { turnId: "t" };
      },
      async respondToRequest(_threadId, requestId, body) {
        answered.push(`${requestId}:${body.behavior}`);
        return "allowed-once";
      },
    };
    const runs = createMachineRuns({
      engine: (instanceId) => instanceId === "pi" ? engine : null,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    const notices: string[] = [];
    const started = runs.start({ instanceId: "pi", model: "qwen", prompt: "salut" });
    expect("runId" in started).toBe(true);
    if (!("runId" in started)) return;
    runs.listen(started.runId, (notice) => notices.push(notice.kind));
    expect(notices).toContain("progress");
    expect(notices).toContain("approval");
    expect(runs.answer(started.runId, "req-1", "allow")).toEqual({ ok: true });
    expect(answered).toEqual(["req-1:allow"]);
    expect(runs.start({ instanceId: "missing", model: "x", prompt: "no" })).toEqual({
      error: "That engine is not on this computer.",
    });
    for (const listener of listeners) {
      listener({ type: "turn.completed", threadId: `mrun-${started.runId}`, ok: true, turnId: "t", eventId: "e3", provider: "pi", providerInstanceId: "pi", createdAt: "" } as RuntimeEvent);
    }
    expect(notices.at(-1)).toBe("done");
    expect(runs.answer(started.runId, "req-1", "deny")).toEqual({ error: "The turn is no longer running." });
  });
});
