import { describe, expect, it, vi } from "vitest";

import { GithubConnect, githubAuthorizedFetch, githubGitEnvironment, githubOrigins, githubSandboxArgv } from "./github-connect.ts";
import type { GithubConnection } from "./person-connections.ts";

function fakeGithub(options: { pendingPolls?: number; deny?: boolean } = {}) {
  let polls = 0;
  const calls: Array<{ url: string; body?: string; auth?: string | null }> = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined, auth: new Headers(init?.headers).get("authorization") });
    if (url === "https://github.com/login/device/code") {
      return Response.json({ device_code: "dev-123", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 1 });
    }
    if (url === "https://github.com/login/oauth/access_token") {
      polls += 1;
      if (options.deny) return Response.json({ error: "access_denied" });
      if (polls <= (options.pendingPolls ?? 1)) return Response.json({ error: "authorization_pending" });
      return Response.json({ access_token: "gho_from_device", token_type: "bearer", scope: "repo,read:org" });
    }
    if (url === "https://api.github.com/user") {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth === "Bearer bad") return new Response("{}", { status: 401 });
      return new Response(JSON.stringify({ login: auth === "Bearer gho_from_device" ? "octo-device" : "octo-pat", name: "Octo" }), { headers: { "x-oauth-scopes": "repo, gist" } });
    }
    return new Response("not found", { status: 404 });
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

describe("GithubConnect", () => {
  it("runs the device flow for one person and saves the token for that person only", async () => {
    const saved = new Map<string, GithubConnection | undefined>();
    const connected: string[] = [];
    const github = fakeGithub();
    const connect = new GithubConnect({
      clientId: () => "Iv1.client", fetch: github.fetcher, minIntervalMs: 5,
      save: (principalId, connection) => saved.set(principalId, connection),
      onConnected: (principalId) => connected.push(principalId),
    });
    const started = await connect.startDeviceFlow("pr_a");
    expect(started).toMatchObject({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" });
    expect(connect.status("pr_a", saved.get("pr_a"))).toMatchObject({ state: "pending", userCode: "ABCD-1234" });
    expect(connect.status("pr_b", undefined)).toMatchObject({ state: "none" });
    await vi.waitFor(() => expect(saved.get("pr_a")).toBeTruthy(), { timeout: 5_000, interval: 10 });
    expect(saved.get("pr_a")).toMatchObject({ token: "gho_from_device", login: "octo-device", via: "device", scopes: ["repo", "read:org"] });
    expect(saved.has("pr_b")).toBe(false);
    expect(connected).toEqual(["pr_a"]);
    expect(connect.status("pr_a", saved.get("pr_a"))).toMatchObject({ state: "connected", login: "octo-device" });
    expect(JSON.stringify(connect.status("pr_a", saved.get("pr_a")))).not.toContain("gho_from_device");
    // the client id went to GitHub, no secret
    expect(github.calls[0]!.body).toContain("client_id=Iv1.client");
  });

  it("reports a refusal on GitHub", async () => {
    const github = fakeGithub({ deny: true });
    const connect = new GithubConnect({ clientId: () => "Iv1.client", fetch: github.fetcher, minIntervalMs: 5, save: () => {} });
    await connect.startDeviceFlow("pr_a");
    await vi.waitFor(() => expect(connect.status("pr_a", undefined)).toMatchObject({ state: "error" }), { timeout: 5_000, interval: 10 });
  });

  it("explains that the device flow needs the organization's OAuth App, and takes a pasted token instead", async () => {
    const saved = new Map<string, GithubConnection | undefined>();
    const github = fakeGithub();
    const connect = new GithubConnect({ clientId: () => undefined, fetch: github.fetcher, save: (principalId, connection) => saved.set(principalId, connection) });
    expect(connect.status("pr_a", undefined)).toEqual({ state: "none", deviceFlow: false });
    await expect(connect.startDeviceFlow("pr_a")).rejects.toMatchObject({ code: "device_flow_unavailable" });
    await expect(connect.connectWithToken("pr_a", "bad")).rejects.toMatchObject({ code: "token_refused" });
    const connection = await connect.connectWithToken("pr_a", " github_pat_ok ");
    expect(connection).toMatchObject({ login: "octo-pat", via: "token", token: "github_pat_ok", scopes: ["repo", "gist"] });
    connect.disconnect("pr_a");
    expect(saved.get("pr_a")).toBeUndefined();
  });
});

describe("where the token goes", () => {
  it("adds the token for GitHub's hosts only", async () => {
    const seen: Array<[string, string | null]> = [];
    const base = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push([String(input), new Headers(init?.headers).get("authorization")]);
      return new Response("ok");
    }) as typeof fetch;
    const authorized = githubAuthorizedFetch("tok", base);
    await authorized("https://api.github.com/repos/a/b/contents/skills");
    await authorized("https://raw.githubusercontent.com/a/b/main/SKILL.md");
    await authorized("https://skills.sh/a/b");
    expect(seen).toEqual([
      ["https://api.github.com/repos/a/b/contents/skills", "Bearer tok"],
      ["https://raw.githubusercontent.com/a/b/main/SKILL.md", "Bearer tok"],
      ["https://skills.sh/a/b", null],
    ]);
  });

  it("gives git the token in an extra header, never prompting", () => {
    expect(githubGitEnvironment(undefined)).toEqual({ GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/false", GCM_INTERACTIVE: "never" });
    const env = githubGitEnvironment("tok");
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(Buffer.from(env.GIT_CONFIG_VALUE_0!.replace("AUTHORIZATION: basic ", ""), "base64").toString()).toBe("x-access-token:tok");
  });

  it("writes gh and git credentials in the environment from variables, never the argv", () => {
    const set = githubSandboxArgv({ token: "gho_secret", login: "octo" });
    expect(set.argv.join(" ")).not.toContain("gho_secret");
    expect(set.env).toEqual({ SAGAX_GH_TOKEN: "gho_secret", SAGAX_GH_LOGIN: "octo" });
    expect(set.argv[2]).toContain(".config/gh/hosts.yml");
    expect(set.argv[2]).toContain("umask 077");
    expect(githubSandboxArgv(null).env).toEqual({});
    expect(() => githubSandboxArgv({ token: "t", login: "bad;rm" })).toThrow();
  });

  it("lets only a loopback stand-in replace github.com", () => {
    expect(githubOrigins({ SAGAX_GITHUB_WEB_ORIGIN: "http://127.0.0.1:9000" }).web).toBe("http://127.0.0.1:9000");
    expect(githubOrigins({ SAGAX_GITHUB_WEB_ORIGIN: "https://evil.example" }).web).toBe("https://github.com");
  });
});
