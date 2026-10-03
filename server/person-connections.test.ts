import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parsePersonalMcpInput, personalAuthHeaders, PersonConnections, PersonConnectionsError, principalDir } from "./person-connections.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const key = { kind: "key" as const, key: Buffer.alloc(32, 7) };

function store() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-person-"));
  dirs.push(dir);
  return { dir, connections: new PersonConnections(dir, () => key) };
}

describe("parsePersonalMcpInput", () => {
  it("takes a remote server with a token, OAuth or the GitHub connection", () => {
    expect(parsePersonalMcpInput({ name: "github", url: "https://api.githubcopilot.com/mcp/", auth: "github" }, 1).server)
      .toEqual({ kind: "remote", type: "http", url: "https://api.githubcopilot.com/mcp/", auth: "github", enabled: true, addedAt: 1 });
    expect(parsePersonalMcpInput({ name: "docs", url: "https://docs.example.com/mcp", token: "abc" }, 1).server).toMatchObject({ auth: "token", token: "abc" });
    expect(parsePersonalMcpInput({ name: "notion", url: "https://mcp.notion.com/mcp", auth: "oauth" }, 1).server).toMatchObject({ auth: "oauth" });
  });
  it("takes a command that runs in the person's server environment", () => {
    expect(parsePersonalMcpInput({ name: "gh-local", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "x" } }, 1).server)
      .toEqual({ kind: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "x" }, runsIn: "environment", enabled: true, addedAt: 1 });
  });
  it("refuses http, credentials in the URL, reserved names and Sagax variables", () => {
    for (const bad of [
      { name: "a", url: "http://example.com/mcp" },
      { name: "a", url: "https://u:p@example.com/mcp" },
      { name: "agents", url: "https://example.com/mcp" },
      { name: "a", url: "https://example.com/mcp", auth: "token" },
      { name: "a", command: "npx", env: { SAGAX_SANDBOX_TOKEN: "x" } },
      { name: "A", url: "https://example.com/mcp" },
    ]) expect(() => parsePersonalMcpInput(bad), JSON.stringify(bad)).toThrow(PersonConnectionsError);
  });
});

describe("personalAuthHeaders", () => {
  it("sends a token as Bearer, the GitHub connection's token, or nothing", () => {
    const base = { kind: "remote" as const, type: "http" as const, url: "https://x.example/mcp", enabled: true, addedAt: 1 };
    expect(personalAuthHeaders({ ...base, auth: "token", token: "t1" }, undefined)).toEqual({ Authorization: "Bearer t1" });
    expect(personalAuthHeaders({ ...base, auth: "token", token: "Basic abc" }, undefined)).toEqual({ Authorization: "Basic abc" });
    expect(personalAuthHeaders({ ...base, auth: "token", token: "k", headerName: "X-API-Key" }, undefined)).toEqual({ "X-API-Key": "k" });
    expect(personalAuthHeaders({ ...base, auth: "github" }, { token: "gho_1", login: "jc", via: "device", connectedAt: 1 })).toEqual({ Authorization: "Bearer gho_1" });
    expect(personalAuthHeaders({ ...base, auth: "github" }, undefined)).toBeNull();
    expect(personalAuthHeaders({ ...base, auth: "none" }, undefined)).toEqual({});
  });
});

describe("PersonConnections", () => {
  it("keeps each person's servers and GitHub apart, encrypted, and lists no secret", () => {
    const { dir, connections } = store();
    connections.add("pr_a", "docs", parsePersonalMcpInput({ name: "docs", url: "https://docs.example.com/mcp", token: "secret-token-a" }).server);
    connections.setGithub("pr_a", { token: "gho_secret_a", login: "alice", via: "device", connectedAt: 1 });
    expect(connections.list("pr_b")).toEqual([]);
    expect(connections.github("pr_b")).toBeUndefined();
    const listed = connections.list("pr_a");
    expect(listed).toEqual([expect.objectContaining({ name: "docs", tokenConfigured: true, domain: "docs.example.com" })]);
    expect(JSON.stringify(listed)).not.toContain("secret-token-a");
    const onDisk = readFileSync(join(principalDir(dir, "pr_a"), "connections.enc"), "utf8");
    expect(onDisk).not.toContain("secret-token-a");
    expect(onDisk).not.toContain("gho_secret_a");
    // a second process with the same key reads it back
    const again = new PersonConnections(dir, () => key);
    expect(again.github("pr_a")?.login).toBe("alice");
    expect(again.servers("pr_a").docs).toMatchObject({ token: "secret-token-a" });
  });

  it("refuses a duplicate name, toggles and removes", () => {
    const { connections } = store();
    const server = parsePersonalMcpInput({ name: "docs", url: "https://docs.example.com/mcp" }).server;
    connections.add("pr_a", "docs", server);
    expect(() => connections.add("pr_a", "docs", server)).toThrow(PersonConnectionsError);
    connections.setEnabled("pr_a", "docs", false);
    expect(connections.list("pr_a")[0]).toMatchObject({ enabled: false });
    expect(connections.remove("pr_a", "docs")).toBe(true);
    expect(connections.remove("pr_a", "docs")).toBe(false);
  });

  it("never overwrites a file it cannot decrypt", () => {
    const { dir, connections } = store();
    connections.setGithub("pr_a", { token: "gho_1", login: "alice", via: "token", connectedAt: 1 });
    const wrong = new PersonConnections(dir, () => ({ kind: "key", key: Buffer.alloc(32, 9) }));
    expect(() => wrong.github("pr_a")).toThrow(PersonConnectionsError);
    expect(() => wrong.setGithub("pr_a", undefined)).toThrow(PersonConnectionsError);
    expect(new PersonConnections(dir, () => key).github("pr_a")?.login).toBe("alice");
  });

  it("refuses a person id that would leave the people folder", () => {
    expect(() => principalDir("/data", "../x")).toThrow(PersonConnectionsError);
    expect(() => principalDir("/data", "..")).toThrow(PersonConnectionsError);
  });
});
