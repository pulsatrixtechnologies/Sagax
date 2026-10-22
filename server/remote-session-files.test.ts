// The remote file browser of a Tailcat session (2026-10-21, JC: Télécharger
// and Envoyer un fichier open a browser of the remote computer). A folder is
// listed only for the session's owner, the path travels as data, and the
// listing never carries the tunnel address.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import type { Message, Store } from "./store.ts";
import { TerminalResourceRegistry } from "./terminal-resources/registry.ts";
import { createRemoteSessionService } from "./remote-sessions.ts";
import type { RunCommand } from "./remote-session-probe.ts";
import { rememberSession } from "./remote-support-local.ts";
import { listDirCommand, readListing } from "./remote-session-files.ts";
import { createRemoteSessionFileRoutes } from "./routes/remote-session-files.ts";
import { dispatchRoutes } from "./routes/table.ts";

const ADDRESS = "tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd";
const ID = "0123456789ab";
const CODE = "BQDHS7";
const A = "person-a";
const B = "person-b";
const BOT = "bot-1";
const THREAD = "thread-1";
const END = new Date(Date.now() + 2 * 3_600_000).toISOString();
const INJECTION = "/tmp/x'; touch /tmp/pwned; echo '$(id)`id`";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

function temp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function decodeWindows(command: string): string {
  const encoded = /-EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(command)?.[1];
  if (!encoded) throw new Error("no encoded command");
  return Buffer.from(encoded, "base64").toString("utf16le");
}

describe("listDirCommand", () => {
  it("hands Windows the folder as base64 inside an encoded script, never as text", () => {
    const dir = "C:\\Users\\O'Brien\"; Remove-Item C:\\ -Recurse; $env:x";
    const command = listDirCommand("windows", dir);
    expect(command).toMatch(/^powershell\.exe -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
    expect(command).not.toContain("Remove-Item");
    const script = decodeWindows(command);
    expect(script).not.toContain("Remove-Item");
    expect(script).toContain(`FromBase64String('${Buffer.from(dir, "utf8").toString("base64")}')`);
    expect(script).toContain("Get-ChildItem -LiteralPath");
    expect(script).toContain("$env:USERPROFILE");
    // reads only
    for (const verb of ["Remove-Item", "Set-Content", "New-Item", "Move-Item", "Invoke-Expression", "iex "]) expect(script).not.toContain(verb);
  });

  it("hands sh the folder as a base64 argument, never inside the script", () => {
    const command = listDirCommand("linux", INJECTION);
    expect(command.startsWith("sh -c '")).toBe(true);
    expect(command).not.toContain("touch /tmp/pwned");
    expect(command.endsWith(` sagax-ls ${Buffer.from(INJECTION, "utf8").toString("base64")}`)).toBe(true);
    for (const verb of ["rm ", "mv ", "> \"", "eval"]) expect(command).not.toContain(verb);
  });

  it.skipIf(process.platform === "win32")("lists a real folder through a login shell, with odd names, and runs nothing it was given", async () => {
    const os = process.platform === "darwin" ? "macos" : "linux";
    const root = temp("sagax-ls-");
    const odd = path.join(root, "a'b $(touch pwned) `id`");
    mkdirSync(odd);
    writeFileSync(path.join(odd, "rapport final.pdf"), "x".repeat(2048));
    writeFileSync(path.join(odd, "notes à lire.txt"), "hello");
    writeFileSync(path.join(odd, ".cache"), "hidden");
    mkdirSync(path.join(odd, "Documents"));
    symlinkSync(path.join(odd, "missing"), path.join(odd, "lien brisé"));
    const run = (dir: string) => new Promise<string>((resolve) => {
      execFile("/bin/sh", ["-c", listDirCommand(os, dir)], { cwd: root, encoding: "utf8" }, (_error, stdout) => resolve(stdout));
    });
    const stdout = await run(odd);
    expect(existsSync(path.join(root, "pwned"))).toBe(false);
    const listed = readListing({ code: 0, stdout, stderr: "" }, os);
    if (!("listing" in listed)) throw new Error(listed.error);
    expect(listed.listing.entries.map((entry) => entry.name)).toEqual(["Documents", "lien brisé", "notes à lire.txt", "rapport final.pdf"]);
    expect(listed.listing.entries.find((entry) => entry.name === "rapport final.pdf")).toMatchObject({ kind: "file", size: 2048 });
    expect(listed.listing.entries[0]).toMatchObject({ kind: "dir" });
    expect(listed.listing.path.endsWith("a'b $(touch pwned) `id`")).toBe(true);
    expect(listed.listing.roots).toEqual(["/"]);

    expect(readListing({ code: 0, stdout: await run(path.join(root, "nope")), stderr: "" }, os)).toMatchObject({ status: 404 });
    expect(readListing({ code: 0, stdout: await run(path.join(odd, "notes à lire.txt")), stderr: "" }, os)).toMatchObject({ status: 400 });
  });
});

describe("readListing", () => {
  it("says the computer did not answer when the tunnel failed", () => {
    expect(readListing(null, "linux")).toMatchObject({ status: 409 });
    expect(readListing({ code: 255, stdout: "", stderr: ADDRESS }, "linux")).toMatchObject({ status: 409 });
    expect(JSON.stringify(readListing({ code: 255, stdout: "", stderr: ADDRESS }, "linux"))).not.toContain(ADDRESS);
  });

  it("reads a Windows answer", () => {
    const stdout = "PWD\tC:\\Users\\usager\r\nHOME\tC:\\Users\\usager\r\nROOT\tC:\\\r\nd\t0\t1761051600\tDocuments\r\nf\t10\t1761051600\ta.txt\r\n";
    expect(readListing({ code: 0, stdout, stderr: "" }, "windows")).toEqual({
      listing: expect.objectContaining({ path: "C:\\Users\\usager", parent: "C:\\Users", roots: ["C:\\"] }),
    });
  });
});

function fakeStore(messages: Message[]): Store {
  return {
    bot: (id: string) => ({ id, name: "Melonie", color: "#336699" }),
    appendMessage: (_thread: string, partial: Partial<Message>) => {
      const message = { id: `m${messages.length}`, at: 1, role: "bot", kind: "text", ...partial } as Message;
      messages.push(message);
      return message;
    },
    patchMessage: () => null,
  } as unknown as Store;
}

async function connected(run: RunCommand, os: "windows" | "linux" = "windows") {
  const dir = temp("sagax-support-");
  writeFileSync(path.join(dir, "technician.private.json"), "{}\n", { mode: 0o600 });
  await rememberSession(dir, CODE, ID, { rights: "standard", end_at: END, principalId: A, botId: BOT });
  writeFileSync(path.join(dir, "sessions", CODE, "address"), `${ADDRESS}\n`, { mode: 0o600 });
  const svc = createRemoteSessionService({
    dataDir: temp("sagax-data-"),
    supportDir: () => dir,
    store: fakeStore([]),
    registry: new TerminalResourceRegistry(),
    sessions: { open: async () => ({ id: "term-1", status: "connecting" }) } as never,
    access: () => ({ organization: true, admin: false, ownsBot: true }),
    owner: () => A,
    run,
    home: () => temp("sagax-flow-"),
  });
  await svc.publish({ id: ID, code: CODE, botId: BOT, threadId: THREAD, principalId: A, os, elevated: false, endAt: END });
  return svc;
}

const WINDOWS_LISTING = "PWD\tC:\\Users\\usager\r\nHOME\tC:\\Users\\usager\r\nROOT\tC:\\\r\nROOT\tD:\\\r\nd\t0\t1761051600\tDocuments\r\nf\t2048\t1761051600\trapport.pdf\r\n";

/** Answers the listing command, records every command and copy. */
function recorder() {
  const commands: string[][] = [];
  const run: RunCommand = async (argv) => {
    commands.push(argv);
    const last = argv.at(-1) ?? "";
    if (last.includes("-EncodedCommand")) return { code: 0, stdout: WINDOWS_LISTING, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { run, commands };
}

describe("the session's listDir and upload destination", () => {
  it("lists a folder for the owner only, over the session's tunnel", async () => {
    const { run, commands } = recorder();
    const svc = await connected(run);
    commands.length = 0;
    const mine = await svc.listDir(A, BOT, ID, "C:\\Users\\usager");
    expect(mine).toMatchObject({ listing: { path: "C:\\Users\\usager", roots: ["C:\\", "D:\\"] } });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain(ADDRESS);
    expect(JSON.stringify(mine)).not.toContain(ADDRESS);
    expect(JSON.stringify(mine)).not.toContain(ID);

    commands.length = 0;
    expect(await svc.listDir(B, BOT, ID, "")).toEqual({ status: 403, error: expect.any(String) });
    expect(await svc.listDir(A, "bot-2", ID, "")).toMatchObject({ status: 403 });
    expect(await svc.listDir(A, BOT, "ffffffffffff", "")).toMatchObject({ status: 403 });
    expect(commands).toEqual([]);
  });

  it("refuses a bad path before anything reaches the computer", async () => {
    const { run, commands } = recorder();
    const svc = await connected(run);
    commands.length = 0;
    for (const bad of ["Users", "\\\\serveur\\c$", "C:\\..\\x", "C:\\a\nb", 7]) {
      expect(await svc.listDir(A, BOT, ID, bad)).toMatchObject({ status: 400 });
    }
    expect(commands).toEqual([]);
  });

  it("stops listing a closed session", async () => {
    const { run } = recorder();
    const svc = await connected(run);
    await svc.close(A, BOT, ID);
    expect(await svc.listDir(A, BOT, ID, "")).toMatchObject({ status: 403 });
  });

  it("sends a file into the folder the person chose, without asking for the transfer folder", async () => {
    const { run, commands } = recorder();
    const svc = await connected(run);
    commands.length = 0;
    expect(await svc.upload(A, BOT, ID, "rapport.pdf", Buffer.from("pdf"), "D:/Partage")).toEqual({ name: "rapport.pdf" });
    expect(commands).toHaveLength(1);
    expect(commands[0]![1]).toBe("cp");
    expect(commands[0]!.at(-1)).toBe(`${ADDRESS}:D:\\Partage\\rapport.pdf`);
  });

  it("refuses a bad destination, and keeps the 8 MB limit", async () => {
    const { run, commands } = recorder();
    const svc = await connected(run);
    commands.length = 0;
    expect(await svc.upload(A, BOT, ID, "a.txt", Buffer.from("x"), "..\\x")).toEqual({ error: expect.any(String) });
    expect(await svc.upload(A, BOT, ID, "a.txt", Buffer.alloc(8 * 1024 * 1024 + 1), "C:\\")).toEqual({ error: "The file must be under 8 MB." });
    expect(await svc.upload(B, BOT, ID, "a.txt", Buffer.from("x"), "C:\\")).toEqual({ error: "That remote session is not open." });
    expect(commands).toEqual([]);
  });
});

async function serve(sessions: Parameters<typeof createRemoteSessionFileRoutes>[0]["sessions"]) {
  const routes = [createRemoteSessionFileRoutes({
    sessions,
    principalId: (auth) => (auth.kind === "session" ? auth.session.principalId : undefined),
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const who = req.headers["x-viewer"];
    const auth = typeof who === "string" ? { kind: "session", scopes: ["admin"], session: { id: who, principalId: who } } : { kind: "loopback", scopes: ["admin"] };
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: auth as never, json, readBody });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("POST /api/bots/:id/remote-sessions/:sid/ls", () => {
  const ls = async (base: string, body: unknown, viewer: string | null = A, sid = ID, method = "POST") => {
    const res = await fetch(`${base}/api/bots/${BOT}/remote-sessions/${sid}/ls`, {
      method,
      headers: { "content-type": "application/json", ...(viewer ? { "x-viewer": viewer } : {}) },
      ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  it("lists the owner's folder and answers 403 to anyone else", async () => {
    const { run } = recorder();
    const base = await serve(await connected(run));
    const mine = await ls(base, { path: "C:\\Users\\usager" });
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ path: "C:\\Users\\usager", parent: "C:\\Users", entries: [{ name: "Documents", kind: "dir" }, { name: "rapport.pdf", kind: "file", size: 2048 }] });
    expect(JSON.stringify(mine.body)).not.toContain(ADDRESS);
    expect((await ls(base, { path: "" }, B)).status).toBe(403);
  });

  it("validates the method, the sign-in, the body and the path", async () => {
    const { run, commands } = recorder();
    const base = await serve(await connected(run));
    commands.length = 0;
    expect((await ls(base, null, A, ID, "GET")).status).toBe(405);
    expect((await ls(base, {}, null)).status).toBe(401);
    expect((await ls(base, "{not json")).status).toBe(400);
    expect((await ls(base, { path: "C:\\", command: "dir" })).status).toBe(400);
    expect((await ls(base, ["C:\\"])).status).toBe(400);
    expect((await ls(base, { path: "relative" })).status).toBe(400);
    expect((await ls(base, { path: `C:\\${"a".repeat(5000)}` })).status).toBe(400);
    expect(commands).toEqual([]);
  });

  it("leaves other session paths to the session routes", async () => {
    const { run } = recorder();
    const base = await serve(await connected(run));
    const res = await fetch(`${base}/api/bots/${BOT}/remote-sessions/${ID}/download`, { method: "POST", body: "{}" });
    expect(await res.json()).toEqual({ from: "inline routes" });
  });
});
