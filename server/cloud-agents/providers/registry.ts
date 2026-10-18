import { createClaudeCloudProvider } from "./claude.ts";
import { createCodexCloudProvider } from "./codex.ts";
import { createCursorProvider } from "./cursor.ts";
import { createPerspicaxProvider } from "./perspicax.ts";
import type { CloudAgentProviderAdapter, HttpFetch } from "./types.ts";
import type { CloudAgentProviderId } from "../../../shared/cloud-agents.ts";

export interface ProviderRegistryOptions {
  fetch?: HttpFetch;
  cursorBaseUrl?: string;
  claudeBaseUrl?: string;
  /** Perspicax's origin, or null on a solo server (no Perspicax runs). */
  perspicaxBaseUrl?: () => string | null;
}

export function createProviderRegistry(options: ProviderRegistryOptions = {}): Map<CloudAgentProviderId, CloudAgentProviderAdapter> {
  const fetchImpl = options.fetch ?? fetch;
  return new Map<CloudAgentProviderId, CloudAgentProviderAdapter>([
    ["cursor", createCursorProvider(fetchImpl, options.cursorBaseUrl)],
    ["claude", createClaudeCloudProvider(fetchImpl, options.claudeBaseUrl)],
    ["codex", createCodexCloudProvider()],
    ["perspicax", createPerspicaxProvider(fetchImpl, options.perspicaxBaseUrl ?? (() => null))],
  ]);
}
