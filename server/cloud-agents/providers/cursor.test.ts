import { describe, expect, it } from "vitest";
import { createCursorProvider } from "./cursor.ts";
import type { HttpFetch } from "./types.ts";

describe("cursor cloud agent provider", () => {
  it("launches with basic auth and repo ref", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: HttpFetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        agent: { id: "bc-test", name: "Fix bug", status: "CREATING", url: "https://cursor.com/agents/bc-test" },
        run: { id: "run-1", status: "RUNNING" },
      }), { status: 201 });
    };
    const adapter = createCursorProvider(fetchImpl, "https://api.example");
    const result = await adapter.launch("secret-key", {
      provider: "cursor",
      prompt: "Fix the login bug",
      repos: [{ url: "https://github.com/acme/repo", ref: "main" }],
      model: "claude-sonnet",
    });
    expect(result.externalId).toBe("bc-test");
    expect(result.latestRunId).toBe("run-1");
    expect(calls[0]?.url).toBe("https://api.example/v1/agents");
    const auth = new Headers(calls[0]?.init?.headers).get("Authorization");
    expect(auth).toMatch(/^Basic /);
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.prompt.text).toBe("Fix the login bug");
    expect(body.repos[0]).toMatchObject({ url: "https://github.com/acme/repo", startingRef: "main" });
    expect(body.model).toEqual({ id: "claude-sonnet" });
  });

  it("tests credentials with a list call", async () => {
    let url = "";
    const fetchImpl: HttpFetch = async (u) => {
      url = String(u);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    };
    const adapter = createCursorProvider(fetchImpl, "https://api.example");
    await adapter.testToken("secret-key");
    expect(url).toBe("https://api.example/v1/agents?limit=1");
  });
});
