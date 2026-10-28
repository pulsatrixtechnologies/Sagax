// A turn the desktop asked this computer to run. The organization server
// keeps the conversation. This process runs the engine that is installed
// here (pi uses its own PI_CODING_AGENT_DIR, or ~/.pi/agent) and the
// approval is delivered back to that same engine. Nothing here is a key.
import { randomBytes } from "node:crypto";
import type { EffortLevel } from "../shared/wire.ts";
import type { RuntimeEvent } from "../shared/runtime-events.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export interface MachineEngine {
  sendTurn(input: {
    threadId: string;
    botId?: string;
    text: string;
    model?: string;
    effort?: EffortLevel;
    /** Ask on this computer. The organization server only records the card. */
    approvalMode?: "ask";
    system?: string;
    transcript?: Array<{ role: "user" | "assistant"; text: string }>;
  }): Promise<{ turnId: string }>;
  respondToRequest(
    threadId: string,
    requestId: string,
    body: { behavior: "allow" | "deny" | "answer"; message?: string },
  ): Promise<unknown>;
}

export interface MachineRunNotice {
  kind: "progress" | "reply" | "failed" | "approval" | "done";
  runId: string;
  text?: string;
  requestId?: string;
  tool?: string;
  summary?: string;
}

interface MachineRun {
  id: string;
  threadId: string;
  engine: MachineEngine;
  listeners: Set<(notice: MachineRunNotice) => void>;
  pending: MachineRunNotice[];
  text: string;
  closed: boolean;
}

function emit(run: MachineRun, notice: Omit<MachineRunNotice, "runId">) {
  const full = { ...notice, runId: run.id };
  if (run.listeners.size === 0) {
    run.pending.push(full);
    return;
  }
  for (const listener of run.listeners) listener(full);
}

export function createMachineRuns(deps: {
  engine(instanceId: string): MachineEngine | null;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
}) {
  const runs = new Map<string, MachineRun>();
  const finish = (run: MachineRun, ok: boolean) => {
    if (run.closed) return;
    run.closed = true;
    if (ok && run.text.trim()) emit(run, { kind: "reply", text: run.text });
    else if (!ok) emit(run, { kind: "failed", text: run.text || "The turn failed." });
    emit(run, { kind: "done" });
    runs.delete(run.id);
  };
  deps.subscribe((event) => {
    const threadId = typeof event.threadId === "string" ? event.threadId : "";
    if (!threadId.startsWith("mrun-")) return;
    const run = [...runs.values()].find((entry) => entry.threadId === threadId);
    if (!run || run.closed) return;
    if (event.type === "content.delta" && event.streamKind === "assistant_text") {
      run.text += event.delta;
      emit(run, { kind: "progress", text: run.text });
    } else if (event.type === "item.completed" && event.itemType === "assistant_text" && event.text) {
      run.text = event.text;
    } else if (event.type === "request.opened" && event.requestType === "permission" && event.requestId) {
      emit(run, {
        kind: "approval",
        requestId: event.requestId,
        tool: event.tool || "tool",
        summary: typeof event.summary === "string" ? event.summary.slice(0, 500) : "",
      });
    } else if (event.type === "turn.completed") {
      finish(run, event.ok !== false);
    }
  });
  return {
    start(input: {
      instanceId: string;
      model: string;
      effort?: EffortLevel;
      prompt: string;
      system?: string;
      botId?: string;
      history?: Array<{ role: "user" | "assistant"; text: string }>;
    }): { runId: string } | { error: string } {
      const engine = deps.engine(input.instanceId);
      if (!engine) return { error: "That engine is not on this computer." };
      const id = randomBytes(12).toString("hex");
      const run: MachineRun = {
        id,
        threadId: `mrun-${id}`,
        engine,
        listeners: new Set(),
        pending: [],
        text: "",
        closed: false,
      };
      runs.set(id, run);
      // sendTurn resolves when the engine accepts the turn, not when it
      // finishes. Completion is turn.completed. Resolving here would post
      // the reply before an approval on this computer is answered.
      void engine.sendTurn({
        threadId: run.threadId,
        botId: input.botId,
        text: input.prompt,
        model: input.model,
        approvalMode: "ask",
        ...(input.effort ? { effort: input.effort } : {}),
        ...(input.system ? { system: input.system } : {}),
        ...(input.history?.length ? { transcript: input.history } : {}),
      }).catch((error: unknown) => {
        if (run.closed) return;
        run.text = run.text || (error instanceof Error ? error.message : "The turn failed.");
        finish(run, false);
      });
      return { runId: id };
    },
    answer(runId: string, requestId: string, behavior: "allow" | "deny" | "answer", message?: string): { ok: true } | { error: string } {
      const run = runs.get(runId);
      if (!run || run.closed) return { error: "The turn is no longer running." };
      void run.engine.respondToRequest(run.threadId, requestId, { behavior, ...(message ? { message } : {}) }).catch(() => undefined);
      return { ok: true };
    },
    listen(runId: string, listener: (notice: MachineRunNotice) => void): () => void {
      const run = runs.get(runId);
      if (!run) return () => undefined;
      run.listeners.add(listener);
      const queued = run.pending.splice(0);
      for (const notice of queued) listener(notice);
      return () => run.listeners.delete(listener);
    },
  };
}

export function createMachineRunRoutes(deps: {
  organization: boolean;
  runs: ReturnType<typeof createMachineRuns>;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const answerPath = path.match(/^\/api\/machine-runs\/([0-9a-f]{24})\/answer$/);
    const start = method === "POST" && path === "/api/machine-runs";
    if (!start && !(answerPath && method === "POST")) return PASS;
    if (deps.organization || auth.kind !== "loopback" || auth.trust === "service") {
      return json(res, 403, { error: "A local model runs on this computer, not on the organization server." });
    }
    if (answerPath) {
      const body = await readBody(req);
      const behavior = body?.behavior;
      const requestId = typeof body?.requestId === "string" ? body.requestId : "";
      if (behavior !== "allow" && behavior !== "deny" && behavior !== "answer") {
        return json(res, 400, { error: "behavior is required" });
      }
      if (!requestId) return json(res, 400, { error: "requestId is required" });
      const answered = deps.runs.answer(answerPath[1]!, requestId, behavior, typeof body?.message === "string" ? body.message : undefined);
      if ("error" in answered) return json(res, 404, { error: answered.error });
      return json(res, 200, { ok: true });
    }
    const body = await readBody(req);
    const instanceId = typeof body?.instanceId === "string" ? body.instanceId.trim() : "";
    const model = typeof body?.model === "string" ? body.model.trim() : "";
    const prompt = typeof body?.prompt === "string" ? body.prompt : "";
    if (!instanceId || !model || !prompt.trim()) return json(res, 400, { error: "instanceId, model and prompt are required" });
    const history = Array.isArray(body?.history)
      ? body.history.flatMap((row: unknown) => {
        if (!row || typeof row !== "object") return [];
        const item = row as { role?: unknown; text?: unknown };
        if ((item.role !== "user" && item.role !== "assistant") || typeof item.text !== "string" || !item.text) return [];
        return [{ role: item.role, text: item.text.slice(0, 8_000) }];
      }).slice(-20)
      : [];
    const started = deps.runs.start({
      instanceId,
      model,
      prompt,
      ...(typeof body?.effort === "string" ? { effort: body.effort as EffortLevel } : {}),
      ...(typeof body?.system === "string" && body.system.trim() ? { system: body.system.slice(0, 8_000) } : {}),
      ...(typeof body?.botId === "string" ? { botId: body.botId } : {}),
      history,
    });
    if ("error" in started) return json(res, 400, { error: started.error });
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    const stop = deps.runs.listen(started.runId, (notice) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(notice)}\n\n`);
      if (notice.kind === "done") res.end();
    });
    req.on("close", () => stop());
  };
}
