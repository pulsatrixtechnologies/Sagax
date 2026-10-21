// Live Tailcat sessions for one Sagax server. The tunnel address stays in
// the session folder on disk (0600). This store and every API answer carry
// only what the chat may show.
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  formatDisk,
  formatGigabytes,
  parseInventory,
  publicText,
  remoteSessionSuggestions,
  safeRemotePath,
  safeUploadName,
  type RemoteSessionFacts,
  type RemoteSessionOs,
  type RemoteSessionView,
} from "../shared/remote-session.ts";
import { TERMINAL_DEFAULT_COLS, TERMINAL_DEFAULT_ROWS, terminalResourceKey } from "../shared/terminal-resources.ts";
import type { Store } from "./store.ts";
import type { TerminalAccess } from "./terminal-resources/types.ts";
import type { TerminalResourceRegistry } from "./terminal-resources/registry.ts";
import type { createTerminalSessionManager } from "./terminal-sessions.ts";
import { createTailcatAdapter } from "./terminal-resources/adapters/tailcat.ts";
import { resolveTailcatBinary } from "./tailcat-bin.ts";
import {
  deleteRemoteCommand,
  flowHome as defaultFlowHome,
  inventoryCommand,
  readTunnel,
  runCommand,
  screenshotPlan,
  sessionDir,
  stopCommand,
  tailcatCopyArgv,
  tailcatSshArgv,
  transferDirCommand,
  type RunCommand,
} from "./remote-session-probe.ts";

const FILE = "remote-sessions.json";
const UPLOAD_MAX = 8 * 1024 * 1024;
const DOWNLOAD_MAX = 32 * 1024 * 1024;

interface StoredSession {
  id: string;
  botId: string;
  threadId: string;
  principalId: string;
  code: string;
  os: RemoteSessionOs;
  elevated: boolean;
  endAt: string;
  state: "connected" | "ended";
  hostname?: string;
  osName?: string;
  user?: string;
  model?: string;
  serial?: string;
  cpu?: string;
  ram?: string;
  disk?: string;
  diskFreePercent?: number;
  ramGb?: number;
  messageId?: string;
  focused?: boolean;
  createdAt: number;
}

export interface PublishedRemoteSession {
  view: RemoteSessionView;
  /** The tunnel folder is on this host. Never the address itself. */
  reachable: boolean;
}

export interface PublishRemoteSession {
  id: string;
  botId: string;
  threadId: string;
  principalId: string;
  code: string;
  os: RemoteSessionOs;
  elevated: boolean;
  endAt: string;
  facts?: RemoteSessionFacts;
}

function viewOf(session: StoredSession): RemoteSessionView {
  const text = (value: string | undefined) => publicText(value);
  const facts: RemoteSessionFacts = {
    hostname: text(session.hostname),
    osName: text(session.osName),
    user: text(session.user),
    model: text(session.model),
    serial: text(session.serial),
    cpu: text(session.cpu),
    ram: text(session.ram),
    disk: text(session.disk),
    diskFreePercent: session.diskFreePercent,
    ramGb: session.ramGb,
  };
  return {
    id: session.id,
    code: session.code,
    state: session.state,
    os: session.os,
    elevated: session.elevated,
    endAt: session.endAt,
    ...(facts.hostname ? { hostname: facts.hostname } : {}),
    ...(facts.osName ? { osName: facts.osName } : {}),
    ...(facts.user ? { user: facts.user } : {}),
    ...(facts.model ? { model: facts.model } : {}),
    ...(facts.serial ? { serial: facts.serial } : {}),
    ...(facts.cpu ? { cpu: facts.cpu } : {}),
    ...(facts.ram ? { ram: facts.ram } : {}),
    ...(facts.disk ? { disk: facts.disk } : {}),
    ...(session.focused ? { focused: true } : {}),
    suggestions: session.state === "connected" ? remoteSessionSuggestions(facts, session.elevated) : [],
  };
}

function applyFacts(session: StoredSession, facts: RemoteSessionFacts | undefined) {
  if (!facts) return;
  const text = (value: string | undefined) => publicText(value);
  if (text(facts.hostname)) session.hostname = text(facts.hostname);
  if (text(facts.osName)) session.osName = text(facts.osName);
  if (text(facts.user)) session.user = text(facts.user);
  if (text(facts.model)) session.model = text(facts.model);
  if (text(facts.serial)) session.serial = text(facts.serial);
  if (text(facts.cpu)) session.cpu = text(facts.cpu);
  if (text(facts.ram)) session.ram = text(facts.ram);
  if (text(facts.disk)) session.disk = text(facts.disk);
  if (typeof facts.diskFreePercent === "number" && facts.diskFreePercent >= 0 && facts.diskFreePercent <= 100) {
    session.diskFreePercent = facts.diskFreePercent;
  }
  if (typeof facts.ramGb === "number" && facts.ramGb > 0 && facts.ramGb < 4096) session.ramGb = facts.ramGb;
}

export function createRemoteSessionService(deps: {
  dataDir: string;
  store: Store;
  registry: TerminalResourceRegistry;
  sessions: ReturnType<typeof createTerminalSessionManager>;
  access(principalId: string, botId: string): TerminalAccess;
  owner(botId: string, threadId: string): string;
  now?: () => number;
  run?: RunCommand;
  home?: () => string;
}) {
  const now = deps.now ?? (() => Date.now());
  const run = deps.run ?? runCommand;
  const home = deps.home ?? defaultFlowHome;
  const file = path.join(deps.dataDir, FILE);
  let rows: StoredSession[] = [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { sessions?: StoredSession[] };
    if (Array.isArray(parsed.sessions)) rows = parsed.sessions.filter((row) => row && typeof row.id === "string");
  } catch {
    rows = [];
  }
  let chain: Promise<unknown> = Promise.resolve();
  const persist = () => {
    mkdirSync(deps.dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ sessions: rows }), { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* windows */ }
  };
  const exclusive = <T>(work: () => Promise<T> | T): Promise<T> => {
    const runWork = chain.then(work, work);
    chain = runWork.then(() => undefined, () => undefined);
    return runWork;
  };

  const owned = (principalId: string, botId: string, id: string) =>
    rows.find((row) => row.id === id && row.botId === botId && row.principalId === principalId) ?? null;

  const hostLabel = (session: StoredSession) => session.hostname || session.code;

  const tailcatBin = () => resolveTailcatBinary() ?? "tailcat";

  async function ssh(session: StoredSession, command: string, timeoutMs: number) {
    const tunnel = readTunnel(home(), session.id);
    if (!tunnel) return null;
    return run(tailcatSshArgv(tailcatBin(), tunnel.keyPath, tunnel.address, command), timeoutMs);
  }

  async function probe(session: StoredSession) {
    const result = await ssh(session, inventoryCommand(session.os), 20_000);
    if (!result || !result.stdout.trim()) return;
    const parsed = parseInventory(result.stdout);
    if (parsed.hostname) session.hostname = parsed.hostname;
    if (parsed.user) session.user = parsed.user;
    if (parsed.model) session.model = parsed.model;
    if (parsed.serial) session.serial = parsed.serial;
    if (parsed.cpu) session.cpu = parsed.cpu;
    if (parsed.osName) session.osName = parsed.osName;
    if (parsed.ramGb) {
      session.ramGb = parsed.ramGb;
      session.ram = formatGigabytes(parsed.ramGb);
    }
    if (parsed.diskFreeGb !== undefined && parsed.diskTotalGb !== undefined) {
      const disk = formatDisk(parsed.diskFreeGb, parsed.diskTotalGb);
      if (disk.text) session.disk = disk.text;
      if (disk.freePercent !== undefined) session.diskFreePercent = disk.freePercent;
    }
  }

  function writeCard(session: StoredSession) {
    const view = viewOf(session);
    const bot = deps.store.bot(session.botId);
    const from = bot ? { botId: bot.id, name: bot.name, color: bot.color } : undefined;
    if (session.messageId) {
      deps.store.patchMessage(session.threadId, session.messageId, { remoteSession: view });
      return;
    }
    const message = deps.store.appendMessage(session.threadId, {
      role: "bot",
      kind: "text",
      text: "",
      ...(from ? { from } : {}),
      remoteSession: view,
    });
    session.messageId = message.id;
  }

  deps.registry.register(createTailcatAdapter({
    home,
    targets(principalId, botId) {
      return rows
        .filter((row) => row.state === "connected" && row.principalId === principalId && (!botId || row.botId === botId))
        .filter((row) => readTunnel(home(), row.id))
        .map((row) => ({ id: row.id, hostLabel: hostLabel(row), label: "Session à distance" }));
    },
  }));

  return {
    viewOf,
    principalFor(botId: string, threadId: string): string {
      return deps.owner(botId, threadId).trim().toLowerCase();
    },
    list(principalId: string, botId: string): RemoteSessionView[] {
      return rows
        .filter((row) => row.principalId === principalId && row.botId === botId && row.state === "connected")
        .map(viewOf);
    },
    active(principalId: string, botId: string, threadId: string): StoredSession | null {
      const mine = rows.filter((row) => row.principalId === principalId && row.botId === botId && row.threadId === threadId && row.state === "connected");
      return mine.find((row) => row.focused) ?? mine[mine.length - 1] ?? null;
    },
    async publish(input: PublishRemoteSession): Promise<PublishedRemoteSession> {
      return exclusive(async () => {
        let session = rows.find((row) => row.id === input.id && row.botId === input.botId);
        if (session && session.principalId !== input.principalId) {
          throw Object.assign(new Error("That remote session belongs to someone else."), { status: 403 });
        }
        if (!session) {
          session = {
            id: input.id,
            botId: input.botId,
            threadId: input.threadId,
            principalId: input.principalId,
            code: input.code,
            os: input.os,
            elevated: input.elevated,
            endAt: input.endAt,
            state: "connected",
            createdAt: now(),
            focused: false,
          };
          rows.push(session);
        } else {
          session.threadId = input.threadId;
          session.code = input.code;
          session.os = input.os;
          session.elevated = input.elevated;
          session.endAt = input.endAt;
          session.state = "connected";
        }
        for (const row of rows) {
          if (row.threadId === input.threadId) row.focused = row.id === session!.id;
        }
        applyFacts(session, input.facts);
        const reachable = Boolean(readTunnel(home(), session.id));
        if (reachable) {
          try { await probe(session); } catch { /* the card still shows what we were given */ }
        }
        writeCard(session);
        persist();
        return { view: viewOf(session), reachable };
      });
    },
    async close(principalId: string, botId: string, id: string): Promise<RemoteSessionView | null> {
      return exclusive(async () => {
        const session = owned(principalId, botId, id);
        if (!session) return null;
        if (session.state === "connected") {
          try { await ssh(session, stopCommand(session.id), 8_000); } catch { /* the screen still closes */ }
        }
        session.state = "ended";
        session.focused = false;
        writeCard(session);
        persist();
        return viewOf(session);
      });
    },
    focus(principalId: string, botId: string, id: string): RemoteSessionView | null {
      const session = owned(principalId, botId, id);
      if (!session || session.state !== "connected") return null;
      for (const row of rows) {
        if (row.botId === botId && row.principalId === principalId) row.focused = row.id === id;
      }
      persist();
      return viewOf(session);
    },
    async openShell(args: { principalId: string; botId: string; threadId: string; id?: string }): Promise<{ hostLabel: string; messageId: string } | { error: string } | null> {
      const session = args.id
        ? owned(args.principalId, args.botId, args.id)
        : this.active(args.principalId, args.botId, args.threadId);
      if (!session || session.state !== "connected") return null;
      if (!readTunnel(home(), session.id)) return { error: "The tunnel for this remote computer is not on this server yet." };
      const access: TerminalAccess = {
        ...deps.access(args.principalId, args.botId),
        ownsConversation: deps.owner(args.botId, args.threadId).trim().toLowerCase() === args.principalId || session.principalId === args.principalId,
      };
      try {
        const opened = await deps.sessions.open({
          principalId: args.principalId,
          botId: args.botId,
          threadId: session.threadId,
          resourceKey: terminalResourceKey("tailcat", session.id),
          label: "Session à distance",
          hostLabel: hostLabel(session),
          access,
          cols: TERMINAL_DEFAULT_COLS,
          rows: TERMINAL_DEFAULT_ROWS,
        });
        const bot = deps.store.bot(args.botId);
        const message = deps.store.appendMessage(session.threadId, {
          role: "bot",
          kind: "text",
          text: "",
          ...(bot ? { from: { botId: bot.id, name: bot.name, color: bot.color } } : {}),
          terminalEmbed: {
            sessionId: opened.id,
            resourceId: session.id,
            provider: "tailcat",
            hostLabel: hostLabel(session),
            label: "Session à distance",
            status: opened.status,
          },
        });
        return { hostLabel: hostLabel(session), messageId: message.id };
      } catch (error) {
        const text = error instanceof Error ? error.message : "";
        if (text === "session_limit") return { error: "Three terminals are already open. Close one, then ask again." };
        return { error: "This remote computer did not open a shell." };
      }
    },
    async upload(principalId: string, botId: string, id: string, name: string, bytes: Buffer): Promise<{ name: string } | { error: string }> {
      const safeName = safeUploadName(name);
      const session = owned(principalId, botId, id);
      if (!session || session.state !== "connected") return { error: "That remote session is not open." };
      if (!safeName) return { error: "Choose a simple file name." };
      if (bytes.length === 0 || bytes.length > UPLOAD_MAX) return { error: "The file must be under 8 MB." };
      if (!readTunnel(home(), session.id)) return { error: "The tunnel for this remote computer is not on this server yet." };
      const listed = await ssh(session, transferDirCommand(session.os), 15_000);
      const remoteDir = safeRemotePath(listed?.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? "");
      if (!listed || listed.code !== 0 || !remoteDir) return { error: "The remote computer did not accept a folder for the file." };
      const remotePath = session.os === "windows" ? `${remoteDir}\\${safeName}` : `${remoteDir}/${safeName}`;
      const localDir = path.join(deps.dataDir, "remote-session-transfers");
      mkdirSync(localDir, { recursive: true, mode: 0o700 });
      const local = path.join(localDir, `${randomBytes(8).toString("hex")}-${safeName.replaceAll(" ", "_")}`);
      writeFileSync(local, bytes, { mode: 0o600 });
      try {
        const tunnel = readTunnel(home(), session.id);
        if (!tunnel) return { error: "The tunnel for this remote computer is not on this server yet." };
        const copied = await run(tailcatCopyArgv(tailcatBin(), tunnel.keyPath, local, `${tunnel.address}:${remotePath}`), 60_000);
        if (copied.code !== 0) return { error: "The file did not arrive on the remote computer." };
        return { name: safeName };
      } finally {
        rmSync(local, { force: true });
      }
    },
    async download(principalId: string, botId: string, id: string, remotePath: string): Promise<{ name: string; bytes: Buffer } | { error: string }> {
      const safe = safeRemotePath(remotePath);
      const session = owned(principalId, botId, id);
      if (!session || session.state !== "connected") return { error: "That remote session is not open." };
      if (!safe) return { error: "That path cannot be downloaded." };
      const tunnel = readTunnel(home(), session.id);
      if (!tunnel) return { error: "The tunnel for this remote computer is not on this server yet." };
      const localDir = path.join(deps.dataDir, "remote-session-transfers");
      mkdirSync(localDir, { recursive: true, mode: 0o700 });
      const name = safe.split(/[\\/]/).pop() || "download";
      const local = path.join(localDir, `${randomBytes(8).toString("hex")}`);
      const copied = await run(tailcatCopyArgv(tailcatBin(), tunnel.keyPath, `${tunnel.address}:${safe}`, local), 60_000);
      try {
        if (copied.code !== 0) return { error: "That file could not be read on the remote computer." };
        const bytes = readFileSync(local);
        if (bytes.length > DOWNLOAD_MAX) return { error: "That file is over 32 MB." };
        return { name, bytes };
      } catch {
        return { error: "That file could not be read on the remote computer." };
      } finally {
        rmSync(local, { force: true });
      }
    },
    async screen(principalId: string, botId: string, id: string): Promise<Buffer | null> {
      const session = owned(principalId, botId, id);
      if (!session || session.state !== "connected") return null;
      const plan = screenshotPlan(session.os);
      const shot = await ssh(session, plan.command, 20_000);
      const remotePath = safeRemotePath(shot?.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? "");
      if (!shot || shot.code !== 0 || !remotePath || !remotePath.endsWith("px-sagax-shot.png")) return null;
      const pulled = await this.download(principalId, botId, id, remotePath);
      try { await ssh(session, deleteRemoteCommand(session.os, remotePath), 8_000); } catch { /* the png is already local */ }
      if ("error" in pulled) return null;
      if (pulled.bytes.length < 8 || pulled.bytes[0] !== 0x89) return null;
      return pulled.bytes;
    },
    sessionDir(id: string) {
      return sessionDir(home(), id);
    },
  };
}

export type RemoteSessionService = ReturnType<typeof createRemoteSessionService>;
