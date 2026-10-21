import { expect } from "vitest";

type HarnessSpec = { args?: string[]; type?: string; url?: string };

/** The cloud computer the engine receives. The default is the HTTP mount
 * (server/harness-mcp-http.ts). SAGAX_HARNESS_MCP_HTTP=0 keeps the stdio proxy. */
export function isHarnessComputer(server: HarnessSpec | undefined): boolean {
  if (server?.type === "http") return (server.url ?? "").endsWith("/api/internal/computer/mcp-http");
  const args = server?.args;
  return args?.at(-1) === "computer" && /harness-mcp-proxy/.test(args[0] ?? "");
}

export function expectHarnessComputer(server: HarnessSpec | undefined): void {
  if (server?.type === "http") {
    expect(server.url?.endsWith("/api/internal/computer/mcp-http")).toBe(true);
    return;
  }
  expect(server?.args).toEqual([expect.stringMatching(/harness-mcp-proxy\.(?:ts|js|mjs)$/), "computer"]);
}
