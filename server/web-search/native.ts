// Which engines already search the web by themselves (2026-10-26). Those keep
// their own search and are never given sagax_web_search: the tool is for the
// others (OpenAI-compatible endpoints and the local models served through
// them, Groq, Mistral, Cerebras, MiniMax, the xAI API, pi, Cline, a custom
// ACP agent, and any engine added later until it is listed here).
//
// On an organization server some engines lose their own search with the rest
// of their host tools (server/drivers/host-tools.ts: the withheld lists name
// it): there they get sagax_web_search too, which runs on this server with
// the person's key, never on anyone's computer.

/** Engines with a built-in web search, as each real CLI offers it. */
const NATIVE_WEB_SEARCH: Readonly<Record<string, { keptWhenWithheld: boolean }>> = {
  // WebSearch is not in CLAUDE_HOST_TOOLS: it stays on an organization turn.
  claudeAgent: { keptWhenWithheld: true },
  // web_search runs on OpenAI's side; codexHostToolArgs removes only the shell.
  codex: { keptWhenWithheld: true },
  // Cursor's and Antigravity's searches run on their own side.
  cursorAgent: { keptWhenWithheld: true },
  antigravityAgent: { keptWhenWithheld: true },
  // web_search is in GROK_HOST_TOOL_NAMES.
  grokAgent: { keptWhenWithheld: false },
  // google_web_search is in GEMINI_HOST_TOOLS.
  geminiAgent: { keptWhenWithheld: false },
  // web_search is in QWEN_HOST_TOOLS.
  qwenAgent: { keptWhenWithheld: false },
  // WebSearch is in KIMI_HOST_TOOLS.
  kimiAgent: { keptWhenWithheld: false },
  // websearch is in OPENCODE_HOST_TOOLS.
  opencodeGo: { keptWhenWithheld: false },
  // WebSearch is in DROID_HOST_TOOLS (Droid is refused on an organization server).
  droidAgent: { keptWhenWithheld: false },
  // web_search is in HERMES_HOST_TOOLS.
  hermesAgent: { keptWhenWithheld: false },
};

/** Whether this engine searches the web by itself on this turn. */
export function engineHasNativeWebSearch(driverKind: string, withheldHostTools: boolean): boolean {
  const native = NATIVE_WEB_SEARCH[driverKind];
  if (!native) return false;
  return !withheldHostTools || native.keptWhenWithheld;
}

/** The engines listed above, for tests and the docs. */
export const NATIVE_WEB_SEARCH_ENGINES: readonly string[] = Object.keys(NATIVE_WEB_SEARCH);
