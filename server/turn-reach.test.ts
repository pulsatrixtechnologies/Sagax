import { afterEach, describe, expect, it } from "vitest";
import { reachContributions, reachSummaryPrompt, registerReachProvider, resetReachProviders } from "./turn-reach.ts";

afterEach(() => resetReachProviders());

describe("reachSummaryPrompt", () => {
  it("names what the turn mounted in one short line, with the no-tool rule", () => {
    const text = reachSummaryPrompt({ servers: ["remote", "perspicax_connectwise_psa"], builtins: ["the browser"], claudeAi: true });
    expect(text).toContain("MCP servers perspicax_connectwise_psa, remote");
    expect(text).toContain("the browser");
    expect(text).toContain("claude.ai connectors");
    expect(text).toContain("without calling a tool");
    expect(text.length).toBeLessThan(600);
  });

  it("names the speaker's own grok.com connectors when they ride the turn", () => {
    expect(reachSummaryPrompt({ servers: [], builtins: [], grokCloud: true })).toContain("grok.com connectors");
    expect(reachSummaryPrompt({ servers: ["a"], builtins: [] })).not.toContain("grok.com");
  });

  it("says nothing when the turn reaches nothing", () => {
    expect(reachSummaryPrompt({ servers: [], builtins: [] })).toBe("");
  });

  it("stays bounded with many servers", () => {
    const servers = Array.from({ length: 60 }, (_, i) => `server_${String(i).padStart(2, "0")}`);
    const text = reachSummaryPrompt({ servers, builtins: [] });
    expect(text).toContain("and 36 more");
    expect(text.length).toBeLessThan(900);
  });

  it("is the same text for the same reach in any order (no prompt churn)", () => {
    expect(reachSummaryPrompt({ servers: ["b", "a"], builtins: [] })).toBe(reachSummaryPrompt({ servers: ["a", "b", "a"], builtins: [] }));
  });
});

describe("reach providers", () => {
  it("adds a provider's line and tools, bounded and validated", () => {
    registerReachProvider("remote-session", ({ threadId }) => threadId === "t1"
      ? { line: "Remote session open on MAC-DEMO-01", tools: ["agents__remote_session_snapshot", "not a tool", "agents__remote_session_exec"] }
      : null);
    expect(reachContributions({ threadId: "t1" })).toEqual({
      lines: ["Remote session open on MAC-DEMO-01"],
      tools: ["agents__remote_session_exec", "agents__remote_session_snapshot"],
    });
    expect(reachContributions({ threadId: "t2" })).toEqual({ lines: [], tools: [] });
    const text = reachSummaryPrompt({ servers: [], builtins: [], lines: reachContributions({ threadId: "t1" }).lines });
    expect(text).toContain("Remote session open on MAC-DEMO-01.");
  });

  it("ignores a provider that throws, and removes one on request", () => {
    registerReachProvider("bad", () => { throw new Error("boom"); });
    const off = registerReachProvider("good", () => ({ line: "ok" }));
    expect(reachContributions({}).lines).toEqual(["ok"]);
    off();
    expect(reachContributions({}).lines).toEqual([]);
  });
});
