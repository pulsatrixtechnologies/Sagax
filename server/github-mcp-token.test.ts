import { describe, expect, it } from "vitest";

import { readsGithubToken, withGithubToken } from "./github-mcp-token.ts";

const PLUGIN = { type: "http" as const, url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" } };
const OTHER = { type: "http" as const, url: "https://mcp.example.test/mcp", headers: { Authorization: "Bearer fixed-value" } };
const COMMAND = { command: "github-mcp-server", args: ["stdio"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN:-}" } };

describe("the GitHub plugin's server reads the one GitHub connection", () => {
  it("knows a server that takes its token from the GitHub connection", () => {
    expect(readsGithubToken(PLUGIN)).toBe(true);
    expect(readsGithubToken(COMMAND)).toBe(true);
    expect(readsGithubToken(OTHER)).toBe(false);
    expect(readsGithubToken({ ...OTHER, headers: { Authorization: "Bearer ${SOMETHING_ELSE}" } })).toBe(false);
  });

  it("fills the placeholder with the person's token for the turn, and leaves every other server as it is", () => {
    const servers = { "github-github": PLUGIN, docs: OTHER, local: COMMAND };
    const filled = withGithubToken(servers, "person-token-1234");
    expect(filled["github-github"]).toEqual({ ...PLUGIN, headers: { Authorization: "Bearer person-token-1234" } });
    expect(filled.local).toEqual({ ...COMMAND, env: { GITHUB_PERSONAL_ACCESS_TOKEN: "person-token-1234" } });
    expect(filled.docs).toBe(OTHER);
    // the configuration itself never holds the token
    expect(JSON.stringify(servers)).not.toContain("person-token-1234");
  });

  it("without a connection the servers go as they are", () => {
    const servers = { "github-github": PLUGIN };
    expect(withGithubToken(servers, undefined)).toBe(servers);
  });
});
