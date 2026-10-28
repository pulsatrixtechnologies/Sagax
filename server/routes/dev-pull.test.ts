import { describe, expect, it } from "vitest";
import type { RequestAuth } from "../request-auth.ts";
import type { GitExec } from "../code-branches.ts";
import { createDevPullRoutes } from "./dev-pull.ts";

const opened = {
  at: 1,
  tool: { name: "Bash", ok: true, summary: "gh pr create --title \"Fix\"", output: "https://github.com/acme/app/pull/12\n" },
};

function route(exec: GitExec) {
  const sent: { status?: number; body?: unknown } = {};
  const handler = createDevPullRoutes({
    viewerId: () => "person",
    threadWritable: () => true,
    messages: () => ({ messages: [opened] }),
    credentials: () => ({ git: {}, publish: { push: {}, gh: { GH_TOKEN: "token" } } }),
    organization: () => false,
    audit: () => undefined,
    exec,
  });
  const json = ((_res: unknown, status: number, body: unknown) => { sent.status = status; sent.body = body; }) as never;
  const call = (method: string, path: string, body?: unknown) => handler({
    req: {} as never,
    res: {} as never,
    url: new URL(`http://local${path}`),
    path: path.split("?")[0]!,
    method,
    auth: {} as RequestAuth,
    json,
    readBody: async () => body,
  });
  return { sent, call };
}

const answer = { number: 12, additions: 10, deletions: 4, state: "OPEN", isDraft: false, url: "https://github.com/acme/app/pull/12" };

describe("dev pull route", () => {
  it("returns the forge's counts for a pull request this conversation opened", async () => {
    const seen: string[][] = [];
    const exec: GitExec = async (_program, args) => {
      seen.push(args);
      return { code: 0, stdout: JSON.stringify(answer), stderr: "" };
    };
    const { sent, call } = route(exec);
    await call("GET", "/api/bots/bot-1/code/pull?threadId=thread-1&repo=acme/app&number=12");
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ pull: { number: 12, additions: 10, deletions: 4, state: "open" }, canAct: true });
    expect(seen[0]?.slice(0, 3)).toEqual(["pr", "view", "12"]);
  });

  it("refuses a pull request the conversation did not open, and never calls gh", async () => {
    const exec: GitExec = async () => { throw new Error("gh should not run"); };
    const { sent, call } = route(exec);
    await call("GET", "/api/bots/bot-1/code/pull?threadId=thread-1&repo=acme/app&number=99");
    expect(sent.status).toBe(404);
  });

  it("converts to a draft with the same gh verb", async () => {
    const seen: string[][] = [];
    const exec: GitExec = async (_program, args) => {
      seen.push(args);
      return { code: 0, stdout: args[1] === "view" ? JSON.stringify({ ...answer, isDraft: true }) : "", stderr: "" };
    };
    const { sent, call } = route(exec);
    await call("POST", "/api/bots/bot-1/code/pull", { threadId: "thread-1", repo: "acme/app", number: 12, action: "draft" });
    expect(sent.status).toBe(200);
    expect(seen[0]?.slice(0, 4)).toEqual(["pr", "ready", "12", "--undo"]);
  });
});
