// Each provider's request and the normalization of its answer, over a mocked
// fetch: no real network. The key rides on the request only, never in an
// error or the formatted result.
import { describe, expect, it } from "vitest";

import { formatWebSearchResults, normalizeBaseUrl, planWebSearch, runWebSearch, WebSearchError, type WebSearchConfig } from "./providers.ts";

const KEY = "test-key-not-real-0000-abcd";

type Seen = { url: string; init: RequestInit };
function mockFetch(status: number, body: unknown, seen: Seen[] = []) {
  return async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
}
const headers = (init: RequestInit) => init.headers as Record<string, string>;
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body));

describe("provider requests", () => {
  it("Brave: GET with the subscription token header", async () => {
    const seen: Seen[] = [];
    const results = await runWebSearch({ provider: "brave", key: KEY }, "sagax docs", {
      count: 3,
      fetch: mockFetch(200, { web: { results: [
        { title: "One <b>bold</b>", url: "https://one.example/", description: "First", page_age: "2026-10-01" },
        { title: "Dup", url: "https://one.example/", description: "dup" },
        { title: "Bad", url: "javascript:alert(1)", description: "no" },
        { title: "Two", url: "https://two.example/x", description: "Second", extra_snippets: ["more"] },
      ] } }, seen),
    });
    const url = new URL(seen[0]!.url);
    expect(url.origin + url.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(url.searchParams.get("q")).toBe("sagax docs");
    expect(url.searchParams.get("count")).toBe("3");
    expect(headers(seen[0]!.init)["x-subscription-token"]).toBe(KEY);
    expect(results).toEqual([
      { title: "One bold", url: "https://one.example/", snippet: "First", published: "2026-10-01" },
      { title: "Two", url: "https://two.example/x", snippet: "Second more" },
    ]);
  });

  it("Exa: POST with x-api-key", async () => {
    const seen: Seen[] = [];
    const results = await runWebSearch({ provider: "exa", key: KEY }, "q", {
      fetch: mockFetch(200, { results: [{ title: "E", url: "https://e.example/", highlights: ["a", "b"], publishedDate: "2026-09-09" }] }, seen),
    });
    expect(seen[0]!.url).toBe("https://api.exa.ai/search");
    expect(headers(seen[0]!.init)["x-api-key"]).toBe(KEY);
    expect(bodyOf(seen[0]!.init)).toMatchObject({ query: "q", numResults: 5 });
    expect(results).toEqual([{ title: "E", url: "https://e.example/", snippet: "a … b", published: "2026-09-09" }]);
  });

  it("Parallel: POST objective and queries with x-api-key", async () => {
    const seen: Seen[] = [];
    const results = await runWebSearch({ provider: "parallel", key: KEY }, "q", {
      count: 2,
      fetch: mockFetch(200, { results: [{ title: "P", url: "https://p.example/", excerpts: ["x"] }] }, seen),
    });
    expect(seen[0]!.url).toBe("https://api.parallel.ai/v1beta/search");
    expect(headers(seen[0]!.init)["x-api-key"]).toBe(KEY);
    expect(bodyOf(seen[0]!.init)).toMatchObject({ objective: "q", search_queries: ["q"], max_results: 2 });
    expect(results).toEqual([{ title: "P", url: "https://p.example/", snippet: "x" }]);
  });

  it("Firecrawl: POST with a bearer token, v2 and v1 answers", async () => {
    const seen: Seen[] = [];
    const v2 = await runWebSearch({ provider: "firecrawl", key: KEY }, "q", {
      fetch: mockFetch(200, { success: true, data: { web: [{ title: "F", url: "https://f.example/", description: "d" }] } }, seen),
    });
    expect(seen[0]!.url).toBe("https://api.firecrawl.dev/v2/search");
    expect(headers(seen[0]!.init).authorization).toBe(`Bearer ${KEY}`);
    expect(bodyOf(seen[0]!.init)).toMatchObject({ query: "q", limit: 5 });
    expect(v2).toEqual([{ title: "F", url: "https://f.example/", snippet: "d" }]);
    const v1 = await runWebSearch({ provider: "firecrawl", key: KEY }, "q", {
      fetch: mockFetch(200, { success: true, data: [{ title: "G", url: "https://g.example/", description: "e" }] }),
    });
    expect(v1).toEqual([{ title: "G", url: "https://g.example/", snippet: "e" }]);
  });

  it("SearXNG: GET on the instance, key optional", async () => {
    const seen: Seen[] = [];
    const results = await runWebSearch({ provider: "searxng", baseUrl: "http://localhost:8888/" }, "q", {
      fetch: mockFetch(200, { results: [{ title: "S", url: "https://s.example/", content: "c" }] }, seen),
    });
    const url = new URL(seen[0]!.url);
    expect(url.origin + url.pathname).toBe("http://localhost:8888/search");
    expect(url.searchParams.get("format")).toBe("json");
    expect(headers(seen[0]!.init).authorization).toBeUndefined();
    expect(results).toEqual([{ title: "S", url: "https://s.example/", snippet: "c" }]);
    const keyed = planWebSearch({ provider: "searxng", baseUrl: "https://s.example", key: KEY }, "q", 1);
    expect(headers(keyed.init).authorization).toBe(`Bearer ${KEY}`);
  });

  it("clamps the count", () => {
    expect(new URL(planWebSearch({ provider: "brave", key: KEY }, "q", 10).url).searchParams.get("count")).toBe("10");
  });
});

describe("errors never carry the key or the provider's body", () => {
  const configs: WebSearchConfig[] = [
    { provider: "brave", key: KEY }, { provider: "exa", key: KEY }, { provider: "parallel", key: KEY },
    { provider: "firecrawl", key: KEY }, { provider: "searxng", baseUrl: "https://s.example", key: KEY },
  ];
  for (const config of configs) {
    it(`${config.provider}: 401, 429, 500, bad JSON, network`, async () => {
      for (const [status, code] of [[401, "refused_key"], [403, "refused_key"], [429, "rate_limited"], [500, "upstream"]] as const) {
        const error = await runWebSearch(config, "q", { fetch: mockFetch(status, { echo: KEY }) }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(WebSearchError);
        expect((error as WebSearchError).code).toBe(code);
        expect((error as Error).message).not.toContain(KEY);
      }
      const bad = await runWebSearch(config, "q", { fetch: mockFetch(200, `not json ${KEY}`) }).catch((e: unknown) => e);
      expect((bad as WebSearchError).code).toBe("bad_answer");
      expect((bad as Error).message).not.toContain(KEY);
      const down = await runWebSearch(config, "q", { fetch: async () => { throw new Error(`boom ${KEY}`); } }).catch((e: unknown) => e);
      expect((down as WebSearchError).code).toBe("upstream");
      expect((down as Error).message).not.toContain(KEY);
    });
  }

  it("refuses to search without a key or an address", async () => {
    expect(() => planWebSearch({ provider: "brave" }, "q", 1)).toThrow(WebSearchError);
    expect(() => planWebSearch({ provider: "searxng" }, "q", 1)).toThrow(WebSearchError);
  });
});

describe("normalizeBaseUrl", () => {
  it("keeps http(s) without credentials or a query", () => {
    expect(normalizeBaseUrl(" https://search.example.org/ ")).toBe("https://search.example.org");
    expect(normalizeBaseUrl("http://192.168.1.5:8080/searx/")).toBe("http://192.168.1.5:8080/searx");
    for (const bad of ["ftp://x", "https://u:p@x.example", "https://x.example/?a=1", "nope"]) {
      expect(() => normalizeBaseUrl(bad)).toThrow(WebSearchError);
    }
  });
});

describe("formatWebSearchResults", () => {
  it("numbers the results and names the provider", () => {
    const text = formatWebSearchResults("q", "brave", [{ title: "T", url: "https://t.example/", snippet: "s", published: "2026" }]);
    expect(text).toBe("1 result from Brave Search for: q\n\n1. T\n   https://t.example/\n   2026\n   s");
    expect(formatWebSearchResults("q", "exa", [])).toBe("No results from Exa for: q");
  });
});
