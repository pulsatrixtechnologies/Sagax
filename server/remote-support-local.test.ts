import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, type ToolCallContext } from "./drivers/agents-call.ts";
import { availableTools } from "./drivers/agents-catalog.ts";
import type { HarnessClient } from "./drivers/agents-client.ts";
import { GUIDES } from "../scripts/self-knowledge/guides.ts";
import {
  REMOTE_SUPPORT_TEMPLATE,
  ensureTechnicianNodekey,
  handleRemoteSupportCall,
  type TailcatRun,
} from "./remote-support-local.ts";

const PUBLIC = `nodekey:${"cd".repeat(32)}`;
const OTHER = `nodekey:${"ee".repeat(32)}`;
const PRIVATE = `privkey:${"ab".repeat(32)}`;
const ADDRESS = "tcExampleAddressValue12";
const NOW = new Date("2026-10-21T15:00:00.000Z");
const CODE = "K7QMNP";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-rs-"));
  dirs.push(dir);
  return dir;
}

function fakeRun(opts: { pingCode?: number; missing?: boolean } = {}) {
  const calls: string[][] = [];
  const run: TailcatRun = async (args) => {
    calls.push([...args]);
    if (opts.missing) return { code: null, stdout: "", stderr: "", error: "missing" };
    if (args[0] === "genkey") {
      writeFileSync(String(args[3]), `{"Private":"${PRIVATE}"}\n`, { mode: 0o644 });
      return { code: 0, stdout: `${PUBLIC}\n`, stderr: "# wrote file\n" };
    }
    if (args.includes("printpub")) return { code: 0, stdout: `${PUBLIC}\n`, stderr: "" };
    if (args.includes("ping")) return { code: opts.pingCode ?? 0, stdout: "pong\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };
  return { calls, run };
}

function local(dir: string, run: TailcatRun) {
  return {
    dir,
    technicianName: "Ada Lovelace",
    orgName: "Acme",
    now: () => NOW,
    run,
    sessionId: () => "0123456789ab",
  };
}

describe("remote support on this computer", () => {
  it("creates the technician key once, mode 0600, and reuses the public half", async () => {
    const dir = tempDir();
    const first = fakeRun();
    const created = await ensureTechnicianNodekey(dir, first.run);
    expect(created).toEqual({ ok: true, nodekey: PUBLIC, keyPath: join(dir, "technician.private.json") });
    expect(statSync(join(dir, "technician.private.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "technician.nodekey")).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const again = fakeRun();
    expect(await ensureTechnicianNodekey(dir, again.run)).toMatchObject({ ok: true, nodekey: PUBLIC });
    expect(again.calls).toEqual([]);
    expect(readFileSync(join(dir, "technician.nodekey"), "utf8").trim()).toBe(PUBLIC);
  });

  it("reads an existing private file with printpub and does not rewrite it", async () => {
    const dir = tempDir();
    const keyPath = join(dir, "technician.private.json");
    writeFileSync(keyPath, `{"Private":"${PRIVATE}"}\n`, { mode: 0o600 });
    const { calls, run } = fakeRun();
    expect(await ensureTechnicianNodekey(dir, run)).toMatchObject({ ok: true, nodekey: PUBLIC });
    expect(calls).toEqual([["--key", keyPath, "printpub"]]);
    expect(readFileSync(keyPath, "utf8")).toContain(PRIVATE);
  });

  it("does not invent a key when tailcat is missing", async () => {
    const dir = tempDir();
    const { run } = fakeRun({ missing: true });
    const created = await ensureTechnicianNodekey(dir, run);
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error).toContain("not installed");
    expect(created.ok === false && created.error.includes(PRIVATE)).toBe(false);
  });

  it("opens from one call: defaults, local key, link and code, private key stays put", async () => {
    const dir = tempDir();
    const { calls, run } = fakeRun();
    const posted: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const answer = await handleRemoteSupportCall({
      name: "remote_support_open",
      args: {
        nodekey: OTHER,
        template: "nope",
        session: "ffffffffffff",
        end_at: "2026-10-23T15:00:00Z",
      },
      local: local(dir, run),
      post: async (tool, args) => {
        posted.push({ tool, args });
        return {
          status: 200,
          body: {
            text: JSON.stringify({
              code: CODE,
              page_url: `https://support.example.test/assist/${CODE}`,
              line_windows: `irm https://support.example.test/tc/${CODE}/win | iex`,
              line_unix: `curl -fsSL https://support.example.test/tc/${CODE}/sh | sh`,
              address_url: `https://support.example.test/tc/${CODE}/address`,
              nodekey: PUBLIC,
            }),
          },
        };
      },
    });
    expect(answer.isError).toBeUndefined();
    expect(answer.text).toBe([
      `Link: https://support.example.test/assist/${CODE}`,
      `Code: ${CODE}`,
      `Windows: irm https://support.example.test/tc/${CODE}/win | iex`,
      `macOS or Linux: curl -fsSL https://support.example.test/tc/${CODE}/sh | sh`,
    ].join("\n"));
    expect(answer.text).not.toContain(PUBLIC);
    expect(answer.text).not.toContain(PRIVATE);
    expect(answer.text).not.toContain("address");
    expect(posted).toEqual([{
      tool: "remote_support_open",
      args: {
        template: REMOTE_SUPPORT_TEMPLATE,
        nodekey: PUBLIC,
        session: "0123456789ab",
        rights: "standard",
        technician: "Ada Lovelace, Acme",
        end_at: "2026-10-22T15:00:00.000Z",
      },
    }]);
    expect(JSON.stringify(posted)).not.toContain(PRIVATE);
    expect(JSON.stringify(posted)).not.toContain(OTHER);
    expect(calls.map((args) => args[0])).toEqual(["genkey"]);
    const second = fakeRun();
    await handleRemoteSupportCall({
      name: "remote_support_open",
      args: { rights: "elevated", os: "windows", technician: "Ada" },
      local: local(dir, second.run),
      post: async () => ({ status: 200, body: { text: JSON.stringify({ code: "MNP234", page_url: "https://support.example.test/assist/MNP234" }) } }),
    });
    expect(second.calls).toEqual([]);
  });

  it("connects with the local key and does not hand the address back", async () => {
    const dir = tempDir();
    const { calls, run } = fakeRun();
    await ensureTechnicianNodekey(dir, run);
    calls.length = 0;
    const posted: Array<Record<string, unknown>> = [];
    const answer = await handleRemoteSupportCall({
      name: "remote_support_status",
      args: { code: "K7Q-MNP" },
      local: local(dir, run),
      post: async (_tool, args) => {
        posted.push(args);
        const marked = args.mark_connected === true;
        return {
          status: 200,
          body: {
            text: JSON.stringify({
              state: marked ? "connected" : "started",
              fetch_ip_count: 1,
              address: marked ? null : ADDRESS,
            }),
          },
        };
      },
    });
    expect(answer.isError).toBeUndefined();
    expect(answer.text).not.toContain(ADDRESS);
    expect(answer.text).toContain("connected");
    expect(posted[0]).toEqual({ code: "K7Q-MNP" });
    expect(posted[1]).toEqual({ code: "K7Q-MNP", mark_connected: true });
    expect(calls.some((args) => args.includes("ping") && args.includes(ADDRESS))).toBe(true);
    const addressFile = join(dir, "sessions", "K7QMNP", "address");
    expect(readFileSync(addressFile, "utf8").trim()).toBe(ADDRESS);
    expect(statSync(addressFile).mode & 0o777).toBe(0o600);
    expect(calls.some((args) => args.includes(PRIVATE))).toBe(false);
  });

  it("does not connect when a second address fetched the script", async () => {
    const dir = tempDir();
    const { calls, run } = fakeRun();
    await ensureTechnicianNodekey(dir, run);
    calls.length = 0;
    const answer = await handleRemoteSupportCall({
      name: "remote_support_status",
      args: { code: CODE },
      local: local(dir, run),
      post: async () => ({ status: 200, body: { text: JSON.stringify({ state: "fetched", fetch_ip_count: 2, address: ADDRESS }) } }),
    });
    expect(answer.text).toContain("refused");
    expect(answer.text).not.toContain(ADDRESS);
    expect(calls.some((args) => args.includes("ping"))).toBe(false);
  });

  it("the catalog and the guide no longer ask for a nodekey", () => {
    const tools = availableTools({
      externalRuntime: false, coordinating: false, ownThreadCreation: false, skillAuthoring: false,
      sharedComputers: false, voiceNotes: false, cloudHome: false, chief: false, botId: "b", perspicax: true,
    }) as Array<{ name: string; description: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } }>;
    const open = tools.find((tool) => tool.name === "remote_support_open");
    expect(open?.inputSchema.properties.nodekey).toBeUndefined();
    expect(open?.inputSchema.properties.template).toBeUndefined();
    expect(open?.inputSchema.properties.session).toBeUndefined();
    expect(open?.inputSchema.required ?? []).not.toContain("nodekey");
    expect(open?.description).not.toContain("tailcat_session.py");
    expect(open?.description).toContain("private key");
    const guide = GUIDES.find((entry) => entry.id === "remote-support");
    expect(guide?.text).not.toContain("tailcat_session.py");
    expect(guide?.text).toContain("creates the technician key once");
    expect(guide?.text).toContain("donne-moi le lien");
    expect(guide?.text).not.toMatch(/[–—]/);
  });
});

describe("callTool remote support", () => {
  it("refuses without a local directory and otherwise drops a supplied nodekey", async () => {
    const api = vi.fn<HarnessClient["api"]>(async () => ({}));
    const bare: ToolCallContext = {
      botId: "bot", threadId: "thread", depth: 0, externalRuntime: false, coordinating: false, sharedComputers: false,
      client: { api, apiResponse: vi.fn<HarnessClient["apiResponse"]>(async () => ({ ok: true, status: 200, body: {} })) },
    };
    expect((await callTool("remote_support_open", {}, bare)).isError).toBe(true);
    expect(bare.client.apiResponse).not.toHaveBeenCalled();

    const dir = tempDir();
    const { run } = fakeRun();
    const apiResponse = vi.fn<HarnessClient["apiResponse"]>(async (_path, init) => {
      const body = JSON.parse(String(init?.body)) as { tool: string; args: { nodekey?: string } };
      expect(body.args.nodekey).toBe(PUBLIC);
      return { ok: true, status: 200, body: { text: JSON.stringify({ code: CODE, page_url: `https://support.example.test/assist/${CODE}` }) } };
    });
    const context: ToolCallContext = { ...bare, client: { api, apiResponse }, remoteSupport: local(dir, run) };
    const result = await callTool("remote_support_open", { nodekey: OTHER, template: "nope", session: "ffffffffffff" }, context);
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain(`Code: ${CODE}`);
    expect(result.text).not.toContain(PRIVATE);
    expect(statSync(join(dir, "technician.private.json")).mode & 0o777).toBe(0o600);
  });
});
