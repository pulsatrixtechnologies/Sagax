import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicRequest, anthropicTransport } from "./anthropic-compat.ts";
import { OpenAICompatDriver } from "./openai-compat.ts";
import { recordEvents } from "../testing/events.ts";

afterEach(() => vi.unstubAllGlobals());
const event = (type: string, value: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;

describe("Anthropic-compatible personal servers", () => {
  it("replays system, images, tools and tool results in Messages format", () => {
    const result = anthropicRequest({ model: "vendor/model", stream: true, messages: [
      { role: "system", content: "System" }, { role: "user", content: [{ type: "text", text: "Look" }, { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }] },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: '{"id":1}' } }] },
      { role: "tool", tool_call_id: "c1", content: "Read" }, { role: "user", content: "Continue" },
    ], tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }] });
    expect(result).toMatchObject({ model: "vendor/model", max_tokens: 8192, system: [{ type: "text", text: "System" }],
      messages: [ { role: "user", content: [{ type: "text", text: "Look" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } }] },
        { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "read", input: { id: 1 } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: [{ type: "text", text: "Read" }] }, { type: "text", text: "Continue" }] } ],
      tools: [{ name: "read", input_schema: { type: "object" } }] });
  });

  it("streams text and usage through the real runtime using only this turn's personal key", async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init: RequestInit) => {
      expect(String(url)).toBe("https://api.example.com/v1/messages"); requests.push(init);
      const stream = event("message_start", { message: { usage: { input_tokens: 10, cache_read_input_tokens: 3 } } }) +
        event("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Bonjour" } }) +
        event("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }) + event("message_stop", {});
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }));
    const instance = await OpenAICompatDriver.create({ instanceId: "personal-test", displayName: "Lab", enabled: true,
      environment: { SAGAX_COMPAT_SERVER_API_KEY: "test-old-instance-key" },
      config: OpenAICompatDriver.decodeConfig({ url: "https://api.example.com/v1", protocol: "anthropic", apiKeyEnv: "SAGAX_COMPAT_SERVER_API_KEY", managedModels: ["vendor/model"], modelNames: { "vendor/model": "My model" } }) });
    const events = recordEvents(instance.adapter);
    await instance.adapter.sendTurn({ threadId: "chat", text: "Bonjour", access: { via: "owner-key", identity: "person-a", environment: { SAGAX_PERSONAL_PROVIDER_KEY: "test-person-a-key" } } });
    expect(await events.until((value) => value.type === "turn.completed")).toMatchObject({ ok: true, usage: { input: 13, output: 2 } });
    expect(requests[0]!.headers).toMatchObject({ "x-api-key": "test-person-a-key", "anthropic-version": "2023-06-01" });
    expect(String(requests[0]!.body)).not.toContain("test-person-a-key");
    expect(instance.models.options[0]!.label).toBe("My model");
    await expect(instance.adapter.sendTurn({ threadId: "missing", text: "Bonjour", access: { via: "owner-key", identity: "missing", environment: {} } })).rejects.toThrow("API key");
    expect(requests).toHaveLength(1);
    events.stop(); await instance.dispose();
  });

  it("keeps split JSON tool arguments and safely handles JSON completions and provider failures", async () => {
    let mode = "stream";
    const send = anthropicTransport("https://api.example.com/v1", (async () => {
      if (mode === "error") return new Response("test-secret-provider-key", { status: 401 });
      if (mode === "json") return Response.json({ content: [{ type: "tool_use", id: "t1", name: "read", input: { id: 1 } }], stop_reason: "tool_use", usage: { input_tokens: 3, output_tokens: 4 } });
      return new Response(event("content_block_start", { index: 1, content_block: { type: "tool_use", id: "t1", name: "read", input: {} } }) + event("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: '{"id":' } }) + event("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: "1}" } }) + event("message_delta", { delta: { stop_reason: "tool_use" }, usage: { output_tokens: 4 } }), { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch);
    const payload = JSON.stringify({ model: "lab", messages: [{ role: "user", content: "Hi" }], stream: true });
    const response = await send(payload, "test-secret-provider-key", new AbortController().signal);
    const frames = (await response.text()).split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
    expect(frames[0].choices[0].delta.tool_calls[0]).toMatchObject({ index: 1, id: "t1", function: { name: "read", arguments: "" } });
    expect(frames.slice(1, 3).map((frame) => frame.choices[0].delta.tool_calls[0].function.arguments).join("")).toBe('{"id":1}');
    mode = "json";
    expect(await (await send(payload, "key", new AbortController().signal)).json()).toMatchObject({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ function: { name: "read", arguments: '{"id":1}' } }] } }] });
    mode = "error";
    expect(await (await send(payload, "key", new AbortController().signal)).text()).not.toContain("test-secret-provider-key");
  });
});
