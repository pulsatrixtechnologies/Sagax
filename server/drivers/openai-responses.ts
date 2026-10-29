// OpenAI's Responses API (/v1/responses) for the shared chat runtime
// (openai-chat.ts). OpenAI's newer models take function tools together with
// reasoning only there: /v1/chat/completions refuses "function tools with
// reasoning_effort", and some models are not chat-completions models at all.
// The runtime keeps its chat-completions transcript; these helpers turn it
// into Responses input items and read a Responses reply (JSON or stream)
// back into the same shape. The conversation is stateless (`store: false`):
// every request carries the whole history, as the chat path does, with the
// model's encrypted reasoning items echoed after a tool round.
import type { EffortLevel } from "../../shared/model-selection.ts";
import type { ChatToolDefinition } from "./chat-mcp-tools.ts";
import type { ChatContentPart } from "./chat-images.ts";
import { ChatProtocolError, ChatToolCalls, object, type ChatToolCall } from "./openai-chat-protocol.ts";

/** The runtime's message, as openai-chat.ts keeps it. */
export interface ResponsesSourceMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ChatContentPart[] | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  reasoning_details?: Record<string, unknown>[];
}

type InputItem = Record<string, unknown>;

function inputContent(content: ResponsesSourceMessage["content"]): string | InputItem[] {
  if (typeof content === "string" || content === null) return content ?? "";
  return content.map((part) => part.type === "image_url"
    ? { type: "input_image", image_url: part.image_url.url }
    : { type: "input_text", text: part.text });
}

/** The chat transcript as Responses input items. A tool round becomes the
 * model's reasoning items (when it returned encrypted ones), its text, then
 * one function_call per call; a tool result is a function_call_output. */
export function responsesInput(messages: readonly ResponsesSourceMessage[]): InputItem[] {
  const items: InputItem[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      items.push({ type: "function_call_output", call_id: message.tool_call_id ?? "", output: typeof message.content === "string" ? message.content : "" });
      continue;
    }
    if (message.role === "assistant") {
      for (const block of message.reasoning_details ?? []) {
        if (block.type === "reasoning" && typeof block.encrypted_content === "string") items.push(block);
      }
      const text = typeof message.content === "string" ? message.content : "";
      if (text) items.push({ role: "assistant", content: text });
      for (const call of message.tool_calls ?? []) {
        items.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments });
      }
      continue;
    }
    items.push({ role: message.role, content: inputContent(message.content) });
  }
  return items;
}

/** Chat tool definitions as Responses function tools. */
export function responsesTools(definitions: readonly ChatToolDefinition[]): InputItem[] {
  return definitions.map((definition) => ({
    type: "function",
    name: definition.function.name,
    description: definition.function.description,
    parameters: definition.function.parameters,
    strict: false,
  }));
}

/** Sagax's effort level as OpenAI's `reasoning.effort`. */
export function responsesEffort(level: EffortLevel | undefined): string | undefined {
  if (!level) return undefined;
  if (level === "max" || level === "ultracode") return "xhigh";
  return level;
}

export interface ResponsesUsage {
  input: number;
  output: number;
  cachedInput?: number;
}

export interface ResponsesReply {
  text: string;
  reasoning: string;
  usage: ResponsesUsage | null;
  toolCalls: ChatToolCall[];
  /** "stop", "tool_calls", or why the reply was cut ("length"). */
  finishReason: string | null;
  /** Encrypted reasoning items, echoed on the next request of the turn. */
  reasoningItems: Record<string, unknown>[];
  model?: string;
}

const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

function usageOf(value: unknown): ResponsesUsage | null {
  const usage = object(value);
  if (!usage) return null;
  const cached = count(object(usage.input_tokens_details)?.cached_tokens);
  return { input: count(usage.input_tokens) ?? 0, output: count(usage.output_tokens) ?? 0, ...(cached !== undefined ? { cachedInput: cached } : {}) };
}

/** The message of a failed response (`response.failed`, an `error` event). */
function failureMessage(value: unknown): string {
  const error = object(value);
  const message = typeof error?.message === "string" ? error.message : "unknown error";
  const code = typeof error?.code === "string" && /^[a-z][a-z0-9_]*$/.test(error.code) ? ` (${error.code})` : "";
  return `${message.slice(0, 300)}${code}`;
}

/** Reads one Responses reply, from its JSON body or its stream events. */
export class ResponsesReader {
  text = "";
  reasoning = "";
  usage: ResponsesUsage | null = null;
  finishReason: string | null = null;
  model: string | undefined;
  /** Set once the response completed, failed or was cut. */
  done = false;
  private readonly calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
  private readonly reasoningItems: Record<string, unknown>[] = [];

  private readonly onDelta?: (delta: string, kind: "assistant_text" | "reasoning_text") => void;

  constructor(onDelta?: (delta: string, kind: "assistant_text" | "reasoning_text") => void) {
    this.onDelta = onDelta;
  }

  private item(value: unknown, fromStream: boolean): void {
    const item = object(value);
    if (!item) return;
    if (item.type === "function_call") {
      if (typeof item.call_id !== "string" || typeof item.name !== "string") throw new ChatProtocolError("provider returned an incomplete tool call");
      this.calls.push({ id: item.call_id, type: "function", function: { name: item.name, arguments: typeof item.arguments === "string" ? item.arguments : "" } });
    } else if (item.type === "reasoning") {
      if (typeof item.encrypted_content === "string") this.reasoningItems.push(item);
      if (!fromStream) {
        for (const part of Array.isArray(item.summary) ? item.summary : []) {
          const text = object(part)?.text;
          if (typeof text === "string") this.reasoning += (this.reasoning ? "\n\n" : "") + text;
        }
      }
    } else if (item.type === "message" && !fromStream) {
      for (const part of Array.isArray(item.content) ? item.content : []) {
        const entry = object(part);
        const text = entry?.type === "output_text" ? entry.text : entry?.type === "refusal" ? entry.refusal : undefined;
        if (typeof text === "string") this.text += text;
      }
    }
  }

  private finish(response: unknown): void {
    const body = object(response);
    if (!body) return;
    if (typeof body.model === "string") this.model = body.model;
    const usage = usageOf(body.usage);
    if (usage) this.usage = usage;
    if (body.status === "failed" || object(body.error)) throw new ChatProtocolError(`provider returned a completion error: ${failureMessage(body.error)}`);
    if (body.status === "incomplete") {
      const reason = object(body.incomplete_details)?.reason;
      this.finishReason = reason === "max_output_tokens" ? "length" : typeof reason === "string" ? reason : "incomplete";
    }
    this.done = true;
  }

  /** A whole (non-streamed) response object. */
  json(value: unknown): void {
    const body = object(value);
    if (!body) throw new ChatProtocolError("provider returned no response");
    if (object(body.error) && !Array.isArray(body.output)) throw new ChatProtocolError(`provider returned a completion error: ${failureMessage(body.error)}`);
    if (!Array.isArray(body.output)) throw new ChatProtocolError("provider returned no response output");
    for (const item of body.output) this.item(item, false);
    this.finish(body);
  }

  /** One stream event (its `data:` JSON). */
  event(value: unknown): void {
    const event = object(value);
    if (!event) return;
    switch (event.type) {
      case "response.output_text.delta":
      case "response.refusal.delta":
        if (typeof event.delta === "string" && event.delta) {
          this.text += event.delta;
          this.onDelta?.(event.delta, "assistant_text");
        }
        return;
      case "response.reasoning_summary_text.delta":
        if (typeof event.delta === "string" && event.delta) {
          this.reasoning += event.delta;
          this.onDelta?.(event.delta, "reasoning_text");
        }
        return;
      case "response.output_item.done":
        this.item(event.item, true);
        return;
      case "response.completed":
      case "response.incomplete":
      case "response.failed":
        this.finish(event.response);
        return;
      case "error":
        throw new ChatProtocolError(`provider returned a streaming completion error: ${failureMessage(event.error ?? event)}`);
      default:
        return;
    }
  }

  reply(): ResponsesReply {
    const calls = new ChatToolCalls();
    calls.add(this.calls, false);
    const reason = this.finishReason ?? (this.calls.length ? "tool_calls" : "stop");
    return {
      text: this.text,
      reasoning: this.reasoning,
      usage: this.usage,
      toolCalls: calls.finish(reason, false),
      finishReason: reason,
      reasoningItems: this.reasoningItems,
      ...(this.model ? { model: this.model } : {}),
    };
  }
}

function errorEnvelope(body: string): { message: string; param: string; code: string; type: string } | null {
  let parsed: Record<string, unknown> | undefined;
  try { parsed = object(JSON.parse(body)); } catch { return null; }
  const error = object(parsed?.error);
  const message = typeof error?.message === "string" ? error.message : typeof parsed?.error === "string" ? parsed.error : "";
  if (!error && !message) return null;
  return {
    message,
    param: typeof error?.param === "string" ? error.param : "",
    code: typeof error?.code === "string" ? error.code : "",
    type: typeof error?.type === "string" ? error.type : "",
  };
}

/** A 400 that refuses one optional part of a Responses request, which a
 * resend without it may pass: the encrypted reasoning (`include`), or the
 * reasoning effort. Nothing ran upstream. */
export function refusedResponsesOption(status: number, body: string): "include" | "reasoning" | null {
  if (status !== 400) return null;
  const error = errorEnvelope(body);
  if (!error) return null;
  if (error.param === "include" || /\bencrypted[_ ]content\b|\breasoning\.encrypted_content\b/i.test(error.message)) return "include";
  if (error.param.startsWith("reasoning") || /\breasoning\.effort\b|\breasoning_effort\b|\breasoning\b[^\n]{0,40}\bnot supported\b/i.test(error.message)) return "reasoning";
  return null;
}

/** /v1/responses itself does not serve this model (an older endpoint, a
 * compatible server without it): the chat-completions path may. */
export function refusesResponsesEndpoint(status: number, body: string): boolean {
  if (status === 404 || status === 405) {
    const error = errorEnvelope(body);
    return !error || !/\bmodel\b/i.test(error.message) || /\bv1\/responses\b|\bresponses endpoint\b/i.test(error.message);
  }
  if (status !== 400) return false;
  const message = errorEnvelope(body)?.message ?? "";
  return /\bnot supported (?:in|by|on|with) (?:the )?(?:v1\/)?responses\b|\bresponses api\b[^\n]{0,40}\bnot supported\b/i.test(message);
}

/** The provider refused the request because of the model itself: not a
 * chat model, not served on this endpoint, unknown, or unable to take the
 * request's tools. Nothing ran, and another model may answer the same turn.
 * A refused key, a spent balance or an oversized request is never this. */
export function refusesModel(status: number, body: string): boolean {
  if (status !== 400 && status !== 404 && status !== 422) return false;
  const error = errorEnvelope(body);
  if (!error) return false;
  if (error.code === "model_not_found" || (error.param === "model" && error.type === "invalid_request_error")) return true;
  return /\bnot a chat model\b/i.test(error.message)
    || /\bnot supported in the v1\/(?:chat\/completions|completions|responses) endpoint\b/i.test(error.message)
    || /\bonly supported in v1\/(?:responses|completions|chat\/completions)\b/i.test(error.message)
    || /\bfunction tools with reasoning_effort are not supported\b/i.test(error.message)
    || /\bthe model\b[^\n]{0,80}\b(?:does not exist|is not supported|not supported)\b/i.test(error.message);
}
