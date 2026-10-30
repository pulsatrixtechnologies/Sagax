/** The person's account metadata. No response contains a provider key. */
export const PERSONAL_PROVIDER_NAMES = {
  anthropic: "Anthropic", openai: "OpenAI", xai: "xAI", google: "Google", moonshot: "Moonshot",
  elevenlabs: "ElevenLabs", fish: "Fish Audio", openrouter: "OpenRouter", mistral: "Mistral",
  cerebras: "Cerebras", opencode: "OpenCode", cursor: "Cursor", factory: "Factory",
  minimax: "MiniMax", glm: "GLM", zai: "Z.ai", groq: "Groq",
} as const;
export type PersonalProvider = keyof typeof PERSONAL_PROVIDER_NAMES;
export interface PersonalProviderModel { id: string; label: string }
export interface PersonalProviderServer {
  instanceId: string;
  name: string;
  url: string;
  protocol: "openai" | "anthropic";
  models: PersonalProviderModel[];
}
export interface ProviderAccountKey { provider: string; last4: string | null }
export interface ProviderAccountsView {
  keys: ProviderAccountKey[];
  servers: PersonalProviderServer[];
}
