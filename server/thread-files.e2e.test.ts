// The Files tab's server half through a real harness and the fake Claude
// CLI: a Write call in a turn is recorded on its activity message, listed as
// a file of that conversation, and served by id and through the message
// route, while another conversation of the same bot does not list it.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";

type Listed = { id: string; messageId: string; source: string; path: string; name: string; size: number | null; available: boolean; mime?: string };

describe("conversation files through the harness", () => {
  let session: VerificationServer;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${session.info.url}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json().catch(() => null) as any };
  };

  beforeAll(async () => {
    session = await launchVerificationServer({
      ...process.env,
      FAKE_CLAUDE_TOOL_CALLS: JSON.stringify([
        { name: "Write", input: { file_path: "report.md", content: "# Findings" }, output: "File written" },
        { name: "Write", input: { file_path: "remote-only/never-here.png", content: "" }, output: "File written" },
        { name: "Write", input: { file_path: "refused.md", content: "" }, ok: false, output: "denied" },
      ]),
      FAKE_CLAUDE_REPLIES: JSON.stringify(["Wrote the report."]),
    });
  }, 30_000);

  afterAll(async () => {
    await session?.close();
  });

  it("lists what a turn wrote and serves it only from that conversation", async () => {
    const bot = (await api("POST", "/api/bots", {})).body.bot;
    expect((await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } })).status).toBe(200);
    const workspace = join(session.info.dataDir, "workspaces", bot.id);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "report.md"), "# Findings");

    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Write the report" })).status).toBe(202);
    let files: Listed[] = [];
    await expect.poll(async () => {
      files = (await api("GET", `/api/threads/${bot.threadId}/files`)).body.files;
      return files.map((file) => file.name).sort();
    }, { timeout: 20_000 }).toEqual(["never-here.png", "report.md"]);

    const report = files.find((file) => file.name === "report.md")!;
    expect(report).toMatchObject({ source: "written", path: "report.md", size: 10, available: true, mime: "text/markdown; charset=utf-8" });
    expect(files.find((file) => file.name === "never-here.png")).toMatchObject({ available: false, size: null });

    // The activity message carries the record, and is the download grant.
    const dump = await api("GET", `/api/threads/${bot.threadId}/export?format=json`);
    const activity = (dump.body.messages as Array<{ id: string; kind: string; tool?: { name: string; files?: string[] } }>)
      .find((message) => message.id === report.messageId)!;
    expect(activity).toMatchObject({ kind: "activity", tool: { name: "Write", files: ["report.md"] } });

    const byId = await fetch(`${session.info.url}/api/threads/${bot.threadId}/files/${report.id}`);
    expect(byId.status).toBe(200);
    expect(byId.headers.get("content-disposition")).toContain("report.md");
    expect(await byId.text()).toBe("# Findings");
    // Only images stream inline.
    expect((await fetch(`${session.info.url}/api/threads/${bot.threadId}/files/${report.id}?preview=1`)).status).toBe(415);
    expect((await fetch(`${session.info.url}/api/threads/${bot.threadId}/files/${"0".repeat(24)}`)).status).toBe(404);

    const viaMessage = await fetch(`${session.info.url}/api/threads/${bot.threadId}/messages/${report.messageId}/file`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "report.md" }),
    });
    expect(viaMessage.status).toBe(200);
    expect(await viaMessage.text()).toBe("# Findings");
    // The activity message grants only the file its tool wrote.
    const other = await fetch(`${session.info.url}/api/threads/${bot.threadId}/messages/${report.messageId}/file`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../../config.json" }),
    });
    expect(other.status).toBe(403);

    // A second conversation of the same bot has its own, empty, file list,
    // and cannot reach the first one's file by its id.
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, {});
    const secondThread = task.body.task?.threadId ?? task.body.threadId;
    expect(typeof secondThread).toBe("string");
    expect((await api("GET", `/api/threads/${secondThread}/files`)).body.files).toEqual([]);
    expect((await fetch(`${session.info.url}/api/threads/${secondThread}/files/${report.id}`)).status).toBe(404);
    expect((await api("GET", "/api/threads/no-such-thread/files")).status).toBe(404);
  }, 40_000);
});
