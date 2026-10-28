// xAI API driver. Grok uses the OpenAI chat-completions wire contract and
// adds the shared transient-failure retry policy.
import type { ProviderDriver } from "../contracts.ts";
import { createOpenAIChatRuntime } from "./openai-chat.ts";
import { imageTransportAllowed } from "./chat-images.ts";
import { currentEnvName, readEnvName } from "../../electron/legacy-names.mjs";

const DRIVER_KIND = "grok";
const DEFAULT_URL = "https://api.x.ai/v1";
const MODELS = {
  default: "grok-4.7",
  options: [
    { id: "grok-4.7", label: "Grok 4.7", contextWindow: 500_000 },
    { id: "grok-4", label: "Grok 4" },
    { id: "grok-4-fast", label: "Grok 4 Fast" },
    { id: "grok-3-mini", label: "Grok 3 Mini" },
  ],
};

/** 2026-10-28: the xAI models that read images (Grok 4 and later, and any
 * vision model). The others keep the browser and computer tools, whose page
 * reads and snapshots are text, and never receive a screenshot. */
export function grokSeesImages(model: string): boolean {
  return /^grok-(?:[4-9]|\d{2,})/i.test(model) || /vision/i.test(model);
}

export interface GrokConfig {
  tools?: boolean;
  url: string;
  apiKeyEnv: string;
}

function decodeConfig(raw: unknown): GrokConfig {
  const config = (raw ?? {}) as Record<string, unknown>;
  if (config.tools !== undefined && typeof config.tools !== "boolean") throw new Error("tools must be a boolean");
  return {
    ...(config.tools !== undefined ? { tools: config.tools as boolean } : {}),
    url: typeof config.url === "string" ? config.url : DEFAULT_URL,
    apiKeyEnv: typeof config.apiKeyEnv === "string" ? currentEnvName(config.apiKeyEnv) : "XAI_API_KEY",
  };
}

export const GrokDriver: ProviderDriver<GrokConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Grok (API)", supportsMultipleInstances: true },
  models: MODELS,
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input) {
    const { config } = input;
    const apiKey = readEnvName(config.apiKeyEnv, input.environment) ?? readEnvName(config.apiKeyEnv) ?? "";
    return createOpenAIChatRuntime({
      input,
      driverKind: DRIVER_KIND,
      apiKey,
      apiUrl: config.url,
      tools: config.tools,
      // 2026-10-28: the browser and the computer through the same tool bridge
      // as the other chat engines, when the endpoint can carry them
      computerUse: imageTransportAllowed(config.url), imageInput: grokSeesImages,
      models: () => MODELS,
      requestBody: (model, messages, stream) => ({ model, messages, stream }),
      httpErrorLabel: "xAI",
      missingKeyError: `Save an xAI API key in Settings → API keys, or set ${config.apiKeyEnv}.`,
      unavailableReason: "No xAI API key — open Settings → API keys.",
      timeoutMs: 120_000,
      retryScale: Number(process.env.FAKE_GROK_RETRY_SCALE ?? "1"),
      generateModel: () => "grok-3-mini",
      permissionReview: true,
      warmSession: true,
      nativeLog: {
        source: "xai.chat.completions",
        outgoing: (_turn, messages, model) => ({ model, messageCount: messages.length }),
        incoming: ({ text, usage }) => ({ text, usage }),
      },
    });
  },
};
