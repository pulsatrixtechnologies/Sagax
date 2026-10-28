// 2026-10-28: the xAI, Mistral and MiniMax chat engines get the browser and
// the computer through the same tool bridge as the other chat engines
// (openai-chat.ts computerUse, chat-mcp-tools.ts mountChatTools), when the
// model takes tools and the endpoint can carry them. A model that reads no
// image keeps the tools, whose page reads and snapshots are text.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureDirs } from "../config.ts";
import type { ProviderInstance } from "../contracts.ts";
import { imageTransportAllowed } from "./chat-images.ts";
import { GrokDriver, grokSeesImages } from "./grok.ts";
import { MinimaxDriver } from "./minimax.ts";
import { MistralDriver, mistralSeesImages } from "./mistral.ts";

const created: ProviderInstance[] = [];
const keep = async (promise: Promise<ProviderInstance>) => {
  const instance = await promise;
  created.push(instance);
  return instance;
};
const COMPUTER = { computerMcp: true, localComputerMcp: true, browserMcp: true, agentsMcp: true };

describe("chat engines with the browser and the computer", () => {
  beforeEach(() => { ensureDirs(); });
  afterEach(async () => { for (const instance of created.splice(0)) await instance.dispose(); });

  it("the xAI API", async () => {
    const on = await keep(GrokDriver.create({ instanceId: "grok-computer", displayName: "Grok", enabled: true, environment: {}, config: GrokDriver.defaultConfig() }));
    expect(on.adapter.capabilities).toMatchObject(COMPUTER);
    const off = await keep(GrokDriver.create({ instanceId: "grok-bare", displayName: "Grok", enabled: true, environment: {}, config: { ...GrokDriver.defaultConfig(), tools: false } }));
    expect(off.adapter.capabilities.computerMcp).toBeFalsy();
    expect(off.adapter.capabilities.browserMcp).toBeFalsy();
    // a remote endpoint over plain HTTP cannot carry them
    const plain = await keep(GrokDriver.create({ instanceId: "grok-http", displayName: "Grok", enabled: true, environment: {}, config: { ...GrokDriver.defaultConfig(), url: "http://grok.example.com/v1" } }));
    expect(plain.adapter.capabilities.computerMcp).toBeFalsy();
  });

  it("Mistral", async () => {
    const on = await keep(MistralDriver.create({ instanceId: "mistral-computer", displayName: "Mistral", enabled: true, environment: {}, config: MistralDriver.defaultConfig() }));
    expect(on.adapter.capabilities).toMatchObject(COMPUTER);
    const off = await keep(MistralDriver.create({ instanceId: "mistral-bare", displayName: "Mistral", enabled: true, environment: {}, config: { ...MistralDriver.defaultConfig(), tools: false } }));
    expect(off.adapter.capabilities.computerMcp).toBeFalsy();
  });

  it("MiniMax", async () => {
    const on = await keep(MinimaxDriver.create({ instanceId: "minimax-computer", displayName: "MiniMax", enabled: true, environment: { MINIMAX_API_KEY: "" }, config: MinimaxDriver.defaultConfig() }));
    expect(on.adapter.capabilities).toMatchObject(COMPUTER);
    const off = await keep(MinimaxDriver.create({ instanceId: "minimax-bare", displayName: "MiniMax", enabled: true, environment: { MINIMAX_API_KEY: "" }, config: { ...MinimaxDriver.defaultConfig(), tools: false } }));
    expect(off.adapter.capabilities.computerMcp).toBeFalsy();
  });

  it("sends a screenshot only to a model that reads images", () => {
    expect(grokSeesImages("grok-4.7")).toBe(true);
    expect(grokSeesImages("grok-4-fast")).toBe(true);
    expect(grokSeesImages("grok-3-mini")).toBe(false);
    expect(grokSeesImages("grok-2-vision-1212")).toBe(true);
    expect(mistralSeesImages("pixtral-large-latest")).toBe(true);
    expect(mistralSeesImages("mistral-small-latest")).toBe(true);
    expect(mistralSeesImages("codestral-latest")).toBe(false);
    expect(mistralSeesImages("mistral-large-latest", new Set(["mistral-large-latest"]))).toBe(true);
  });

  it("carries images only over HTTPS, or HTTP on loopback", () => {
    expect(imageTransportAllowed("https://api.x.ai/v1")).toBe(true);
    expect(imageTransportAllowed("http://127.0.0.1:8000/v1")).toBe(true);
    expect(imageTransportAllowed("http://api.example.com/v1")).toBe(false);
    expect(imageTransportAllowed("not a url")).toBe(false);
  });
});
