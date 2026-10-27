// The engines that keep their own web search, and the ones that get
// sagax_web_search instead.
import { describe, expect, it } from "vitest";

import { CLAUDE_HOST_TOOLS, GEMINI_HOST_TOOLS, GROK_HOST_TOOL_NAMES, HERMES_HOST_TOOLS, KIMI_HOST_TOOLS, OPENCODE_HOST_TOOLS, QWEN_HOST_TOOLS } from "../drivers/host-tools.ts";
import { engineHasNativeWebSearch } from "./native.ts";

describe("engineHasNativeWebSearch", () => {
  it("keeps the engines' own search: they are never given the tool", () => {
    for (const engine of ["claudeAgent", "codex", "cursorAgent", "antigravityAgent", "grokAgent", "geminiAgent", "qwenAgent", "kimiAgent", "opencodeGo", "droidAgent", "hermesAgent"]) {
      expect(engineHasNativeWebSearch(engine, false), engine).toBe(true);
    }
  });

  it("gives the tool to engines without a search of their own", () => {
    for (const engine of ["openai-compat", "groq", "mistral", "cerebras", "minimax", "grok", "piAgent", "clineAgent", "customAcp", "someFutureEngine"]) {
      expect(engineHasNativeWebSearch(engine, false), engine).toBe(false);
    }
  });

  it("follows the withheld host tools on an organization turn", () => {
    expect(CLAUDE_HOST_TOOLS).not.toContain("WebSearch");
    expect(engineHasNativeWebSearch("claudeAgent", true)).toBe(true);
    expect(engineHasNativeWebSearch("codex", true)).toBe(true);
    expect(GROK_HOST_TOOL_NAMES).toContain("web_search");
    expect(GEMINI_HOST_TOOLS).toContain("google_web_search");
    expect(QWEN_HOST_TOOLS).toContain("web_search");
    expect(KIMI_HOST_TOOLS).toContain("WebSearch");
    expect(OPENCODE_HOST_TOOLS).toContain("websearch");
    expect(HERMES_HOST_TOOLS).toContain("web_search");
    for (const engine of ["grokAgent", "geminiAgent", "qwenAgent", "kimiAgent", "opencodeGo", "hermesAgent"]) {
      expect(engineHasNativeWebSearch(engine, true), engine).toBe(false);
    }
  });
});
