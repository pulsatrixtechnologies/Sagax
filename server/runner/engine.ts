// The engine of a run, seen by the runner: a Sagax provider adapter
// (server/drivers/claude.ts or codex.ts, created by engine-drivers.ts) run
// headless. The runner sends turns, answers asks and steers through the
// adapter, and turns its canonical runtime events into the protocol's events
// with the same normalization the app uses (no new engine code).
import type { ProviderAdapter, RuntimeEvent, SendTurnInput } from "../contracts.ts";
import type { RunnerEngineName, RunnerEvent } from "./protocol.ts";
import { truncateUtf8 } from "./relay.ts";

export type RunnerAdapter = Pick<ProviderAdapter, "sendTurn" | "interruptTurn" | "respondToRequest" | "onEvent" | "stopAll"> & {
  steer?: ProviderAdapter["steer"];
};

export interface RunnerEngineHandle {
  adapter: RunnerAdapter;
  /** What every turn carries besides its text (model, effort, approval
   * mode, working folder). */
  turnDefaults: Omit<SendTurnInput, "threadId" | "text">;
  dispose(): Promise<void>;
}

export interface EngineFactoryInput {
  engine: RunnerEngineName;
  model: string | null;
  effort: string | null;
  cwd: string;
  /** The engine's environment: model proxy, git identity, agent secrets. */
  environment: Record<string, string>;
  /** Writable home for the engine's own state (CODEX_HOME and the like). */
  stateDir: string;
  /** The bootstrap's approval_level (default auto). */
  approvalMode?: "ask" | "edits" | "auto" | "full";
}

export type EngineFactory = (input: EngineFactoryInput) => Promise<RunnerEngineHandle>;

/** Permission choices offered for a permission ask, in the protocol's words
 * (the option the `approve` command sends back). */
export const PERMISSION_CHOICES = ["allow", "deny"] as const;
export const PERMISSION_SESSION_CHOICE = "allow_session";

export interface PendingAsk {
  approvalId: string;
  requestId: string;
  requestType: "permission" | "question";
  choices: string[];
}

const SUMMARY_BYTES = 4 * 1024;

/** One runtime event into zero or more protocol events. Pure: the runner
 * tracks turns and asks itself. */
export function mapRuntimeEvent(event: RuntimeEvent): { events: RunnerEvent[]; ask?: PendingAsk } {
  switch (event.type) {
    case "item.completed":
      if (event.itemType === "assistant_text") {
        return event.text.trim() ? { events: [{ kind: "message", data: { role: "assistant", text: event.text } }] } : { events: [] };
      }
      if (event.itemType === "tool") {
        return {
          events: [{
            kind: "tool_result",
            data: { id: event.itemId ?? event.eventId, ok: event.ok, output_summary: truncateUtf8(event.output ?? "", SUMMARY_BYTES) },
          }],
        };
      }
      return { events: [] };
    case "item.started":
      if (event.itemType !== "tool") return { events: [] };
      return {
        events: [{
          kind: "tool_call",
          data: {
            id: event.itemId ?? event.eventId,
            name: event.title ?? "tool",
            input_summary: truncateUtf8(event.summary ?? event.input ?? "", SUMMARY_BYTES),
          },
        }],
      };
    case "session.started":
      return event.sessionId ? { events: [{ kind: "session", data: { session_id: event.sessionId } }] } : { events: [] };
    case "runtime.error":
      return { events: [{ kind: "warning", data: { text: event.message } }] };
    case "runtime.notice":
      return { events: [{ kind: "warning", data: { text: event.message } }] };
    case "turn.retrying":
      return { events: [{ kind: "warning", data: { text: `Nouvel essai du moteur (${event.attempt}) : ${event.reason}` } }] };
    case "request.opened": {
      const requestId = event.requestId ?? event.eventId;
      const questionChoices = event.requestType === "question"
        ? (event.choices?.length ? event.choices : event.questions?.[0]?.options?.map((option) => option.label) ?? [])
        : [];
      const choices = event.requestType === "question"
        ? questionChoices
        : [...PERMISSION_CHOICES, ...(event.allowSession ? [PERMISSION_SESSION_CHOICE] : [])];
      const detail = [event.summary, event.command ? `$ ${event.command.command}` : "", event.input ?? ""].filter(Boolean).join("\n\n");
      return {
        events: [{
          kind: "approval",
          data: { approval_id: requestId, title: event.tool || event.summary || "Approbation", detail: truncateUtf8(detail, SUMMARY_BYTES), choices },
        }],
        ask: { approvalId: requestId, requestId, requestType: event.requestType, choices },
      };
    }
    default:
      return { events: [] };
  }
}

/** The answer an `approve` command's option gives an ask. */
export function decisionFor(ask: PendingAsk, option: string): { behavior: "allow" | "deny" | "answer"; message?: string; always?: boolean } {
  if (ask.requestType === "question") return { behavior: "answer", message: option };
  if (option === "allow") return { behavior: "allow" };
  if (option === PERMISSION_SESSION_CHOICE && ask.choices.includes(PERMISSION_SESSION_CHOICE)) return { behavior: "allow", always: true };
  // Anything else, an unknown option included, is a refusal (fail closed).
  return { behavior: "deny", message: "Refusé par la personne qui suit le run." };
}
