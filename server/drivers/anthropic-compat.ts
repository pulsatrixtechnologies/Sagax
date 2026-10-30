// Translate only the transport. The common runtime still owns approvals,
// tools, transcript replay, cancellation and usage. Messages/SSE contract:
// https://platform.claude.com/docs/en/build-with-claude/streaming
import type { OpenAIChatMessage } from "./openai-chat.ts";

type Block = Record<string, unknown>;
type Input = { model: string; messages: OpenAIChatMessage[]; stream?: boolean; max_tokens?: number;
  tools?: Array<{ type: string; function: { name: string; description?: string; parameters?: unknown } }> };

function content(value: OpenAIChatMessage["content"]): Block[] {
  if (typeof value === "string") return value ? [{ type: "text", text: value }] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((part): Block[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }];
    if (part.type !== "image_url") return [];
    const url = part.image_url.url;
    const data = url.match(/^data:([^;,]+);base64,(.+)$/s);
    return [{ type: "image", source: data ? { type: "base64", media_type: data[1], data: data[2] } : { type: "url", url } }];
  });
}

export function anthropicRequest(input: Input): object {
  const system: Block[] = [];
  const messages: Array<{ role: "user" | "assistant"; content: Block[] }> = [];
  for (const message of input.messages) {
    if (message.role === "system") { system.push(...content(message.content)); continue; }
    const blocks = message.role === "tool"
      ? [{ type: "tool_result", tool_use_id: message.tool_call_id, content: content(message.content) }]
      : content(message.content);
    for (const call of message.tool_calls ?? []) blocks.push({ type: "tool_use", id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments || "{}") });
    if (!blocks.length) continue;
    const role = message.role === "assistant" ? "assistant" : "user";
    const previous = messages.at(-1);
    if (previous?.role === role) previous.content.push(...blocks);
    else messages.push({ role, content: blocks });
  }
  return { model: input.model, messages, ...(system.length ? { system } : {}), stream: Boolean(input.stream), max_tokens: input.max_tokens ?? 8192,
    ...(input.tools?.length ? { tools: input.tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters ?? { type: "object", properties: {} } })) } : {}) };
}

type Message = { content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }>;
  stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } };
const finish = (reason?: string) => reason === "tool_use" ? "tool_calls" : reason === "max_tokens" ? "length" : "stop";
const usage = (value: Message["usage"]) => ({ prompt_tokens: (value?.input_tokens ?? 0) + (value?.cache_creation_input_tokens ?? 0) + (value?.cache_read_input_tokens ?? 0), completion_tokens: value?.output_tokens ?? 0 });
export function anthropicCompletion(message: Message): object {
  return { choices: [{ index: 0, finish_reason: finish(message.stop_reason), message: {
    role: "assistant", content: (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join(""),
    tool_calls: (message.content ?? []).filter((block) => block.type === "tool_use").map((block) => ({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } })),
  } }], usage: usage(message.usage) };
}

export function anthropicTransport(api: string, doFetch: typeof fetch = fetch) {
  const base = api.replace(/\/+$/, "").replace(/\/messages$/, "");
  return async (payload: string, key: string, signal: AbortSignal): Promise<Response> => {
    const input = JSON.parse(payload) as Input;
    const response = await doFetch(`${base}/messages`, { method: "POST", redirect: "error", signal,
      headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}), "anthropic-version": "2023-06-01" }, body: JSON.stringify(anthropicRequest(input)) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return Response.json({ error: { message: `The Anthropic-compatible server refused the request (HTTP ${response.status}).` } }, { status: response.status });
    }
    if (!input.stream || response.headers.get("content-type")?.includes("application/json")) return Response.json(anthropicCompletion(await response.json() as Message));
    if (!response.body) throw new Error("The Anthropic-compatible server returned no response stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder(); const encoder = new TextEncoder();
    let pending = ""; let inputTokens = 0; let outputTokens = 0;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (delta: object, reason: string | null = null, counts?: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: reason }], ...(counts ? { usage: counts } : {}) })}\n\n`));
        const line = (text: string) => {
          if (!text.startsWith("data:")) return;
          const value: unknown = JSON.parse(text.slice(5).trim());
          if (!value || typeof value !== "object") return;
          const event = value as { type?: string; index?: number; content_block?: NonNullable<Message["content"]>[number]; delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string }; message?: Message; usage?: Message["usage"] };
          if (event.type === "error") throw new Error("The Anthropic-compatible server interrupted the response.");
          if (event.type === "message_start") { const counts = usage(event.message?.usage); inputTokens = counts.prompt_tokens; outputTokens = counts.completion_tokens; }
          if (event.type === "content_block_start" && event.content_block?.type === "tool_use") send({ tool_calls: [{ index: event.index ?? 0, id: event.content_block.id, type: "function", function: { name: event.content_block.name, arguments: Object.keys((event.content_block.input ?? {}) as object).length ? JSON.stringify(event.content_block.input) : "" } }] });
          if (event.type === "content_block_start" && event.content_block?.type === "text" && event.content_block.text) send({ content: event.content_block.text });
          if (event.type === "content_block_delta") {
            if (event.delta?.type === "text_delta") send({ content: event.delta.text ?? "" });
            if (event.delta?.type === "thinking_delta") send({ reasoning_content: event.delta.thinking ?? "" });
            if (event.delta?.type === "input_json_delta") send({ tool_calls: [{ index: event.index ?? 0, function: { arguments: event.delta.partial_json ?? "" } }] });
          }
          if (event.type === "message_delta") {
            outputTokens = event.usage?.output_tokens ?? outputTokens;
            send({}, finish(event.delta?.stop_reason), { prompt_tokens: inputTokens, completion_tokens: outputTokens });
          }
        };
        try {
          for (;;) {
            const { done, value } = await reader.read();
            pending += decoder.decode(value, { stream: !done });
            const lines = pending.split(/\r?\n/); pending = lines.pop() ?? "";
            for (const text of lines) line(text);
            if (done) break;
          }
          if (pending) line(pending);
          controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close();
        } catch (error) { controller.error(error); await reader.cancel().catch(() => {}); }
        finally { reader.releaseLock(); }
      },
      cancel(reason) { return reader.cancel(reason); },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  };
}
