import { describe, expect, it } from "vitest";
import { dedupeConnectors, type McpServerSummary } from "./mcp-servers";

const server = (name: string, auth?: McpServerSummary["auth"]): McpServerSummary => ({ name, enabled: true, ...(auth ? { auth } : {}) });

describe("connector duplicates", () => {
  it("folds a repeated word into the connector named first", () => {
    const folded = dedupeConnectors([server("github"), server("github-github"), server("slack")]);
    expect(folded.map((entry) => entry.name)).toEqual(["github", "slack"]);
  });

  it("keeps the row that still needs a sign-in, under the first name", () => {
    const folded = dedupeConnectors([server("github", "connected"), server("github-github", "required")]);
    expect(folded).toEqual([server("github", "required")]);
  });

  it("leaves distinct connectors alone", () => {
    const list = [server("github"), server("gitlab"), server("acme-docs")];
    expect(dedupeConnectors(list).map((entry) => entry.name)).toEqual(["github", "gitlab", "acme-docs"]);
  });

  it("folds case and separators, not a different second word", () => {
    expect(dedupeConnectors([server("GitHub"), server("github_github")]).map((entry) => entry.name)).toEqual(["GitHub"]);
    expect(dedupeConnectors([server("github"), server("github-docs")]).map((entry) => entry.name)).toEqual(["github", "github-docs"]);
  });
});
