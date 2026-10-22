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
import { markSessionClosed } from "./remote-support-local.ts";
import { createRemoteControlSessions, type ControlAuditEvent, type ControlHandle, type OpenControl, type SpawnControl } from "./remote-control-session.ts";
import { createRemoteControlAudit } from "./remote-control-audit.ts";
import {
  bindFlowOwner,
  deleteRemoteCommand,
  flowHome as defaultFlowHome,
  inventoryCommand,
  normPrincipal,
  pruneSupportSessions,
  readTunnel,
  runCommand,
  screenshotPlan,
  sessionDir,
  stopCommand,
  supportOwnersOfId,
  tailcatCopyArgv,
  tailcatSshArgv,
  transferDirCommand,
  type RunCommand,
} from "./remote-session-probe.ts";
import { LIST_TIMEOUT_MS, listDirCommand, readListing, type ListResult } from "./remote-session-files.ts";
import { remoteJoin, safeRemoteDir } from "../shared/remote-files.ts";

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
  /** The OS was not given: ask the computer once the tunnel is here. */
  osGuessed?: boolean;
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
  /** Absent when nobody named it (the support page detected it): Sagax asks
   * the computer through the tunnel, and says Windows when it cannot. */
  os?: RemoteSessionOs;
  elevated: boolean;
  endAt: string;
  facts?: RemoteSessionFacts;
}

/** `ssh` exits 255 when the tunnel itself failed, so the computer never answered. */
const TRANSPORT_FAILED = 255;

/** `uname -s` answers Darwin or Linux; Windows has no uname. */
export function osFromUname(stdout: string | undefined): RemoteSessionOs {
  const text = (stdout ?? "").toLowerCase();
  if (text.includes("darwin")) return "macos";
  if (text.includes("linux")) return "linux";
  return "windows";
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
  /** The folder where remote_support_open keeps the sessions Sagax opened. */
  supportDir?: () => string;
  /** remote_support_close at Perspicax for a session Sagax opened, as the
   * person closing it (their own credentials). Best effort. */
  closeRemote?(input: { principalId: string; botId: string; threadId: string; code: string }): Promise<unknown>;
  /** The live-control audit sink (default: a JSONL file in dataDir). */
  controlAudit?: { write(event: ControlAuditEvent): void };
  /** How the control helper is spawned (default: tailcat ssh over the tunnel). Tests inject a fake. */
  controlSpawn?: SpawnControl;
}) {
  const now = deps.now ?? (() => Date.now());
  const run = deps.run ?? runCommand;
  const home = deps.home ?? defaultFlowHome;
  const supportDir = deps.supportDir;
  const controls = createRemoteControlSessions({
    audit: deps.controlAudit ?? createRemoteControlAudit(deps.dataDir),
    now,
    ...(deps.controlSpawn ? { spawn: deps.controlSpawn } : {}),
  });
  // The tunnel of a row: its Flow folder, or the support folder of its code
  // when that folder names the row's person and bot as the opener.
  const tunnelOf = (row: Pick<StoredSession, "id" | "code" | "principalId" | "botId">) => readTunnel(home(), row, supportDir?.());
  /** Sagax opened it (its support folder names this row's owner). */
  const sagaxOpened = (row: StoredSession) => {
    const dir = supportDir?.();
    if (!dir) return false;
    return supportOwnersOfId(dir, row.id).some((owner) => owner.code === row.code && owner.principalId === row.principalId && owner.botId === row.botId);
  };
  const file = path.join(deps.dataDir, FILE);
  let rows: StoredSession[] = [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { sessions?: StoredSession[] };
    if (Array.isArray(parsed.sessions)) rows = parsed.sessions.filter((row) => row && typeof row.id === "string");
  } catch {
    rows = [];
  }
  // An ended row older than 48 hours, and a support folder untouched that long,
  // are dropped so neither grows without bound.
  const PRUNE_MS = 48 * 60 * 60 * 1000;
  let lastSweep = 0;
  const prune = (): boolean => {
    const cutoff = now() - PRUNE_MS;
    const kept = rows.filter((row) => !(row.state === "ended" && row.createdAt < cutoff));
    const changed = kept.length !== rows.length;
    rows = kept;
    if (now() - lastSweep > 60_000) {
      lastSweep = now();
      const dir = supportDir?.();
      if (dir) pruneSupportSessions(dir, now(), PRUNE_MS);
    }
    return changed;
  };
  prune();
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
    const tunnel = tunnelOf(session);
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
    targets(principalId, botId) {
      return rows
        .filter((row) => row.state === "connected" && row.principalId === principalId && (!botId || row.botId === botId))
        .filter((row) => tunnelOf(row))
        .map((row) => ({ id: row.id, hostLabel: hostLabel(row), label: "Session à distance" }));
    },
    tunnel(principalId, botId, id) {
      const row = rows.find((candidate) => candidate.id === id && candidate.state === "connected" && candidate.principalId === principalId && (!botId || candidate.botId === botId));
      return row ? tunnelOf(row) : null;
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
      const principalId = normPrincipal(input.principalId);
      const session = await exclusive(() => {
        prune();
        // The id is on the chat card: it never gives a session to someone
        // other than the person (and bot) who opened it.
        const theirs = rows.find((row) => row.id === input.id && (row.principalId !== principalId || row.botId !== input.botId));
        const dir = supportDir?.();
        const foreign = dir
          ? supportOwnersOfId(dir, input.id).some((owner) => owner.principalId !== principalId || owner.botId !== input.botId)
          : false;
        if (theirs || foreign) {
          throw Object.assign(new Error("That remote session belongs to someone else."), { status: 403 });
        }
        // A Flow session folder has no owner until its first publish: bind it
        // to this person and bot now, and refuse a later publish by anyone else.
        if (bindFlowOwner(home(), input.id, { principalId, botId: input.botId }) === "other") {
          throw Object.assign(new Error("That remote session belongs to someone else."), { status: 403 });
        }
        let row = rows.find((candidate) => candidate.id === input.id && candidate.botId === input.botId);
        if (row && row.state === "ended") {
          // closed from the panel or by remote_support_close: a late or
          // repeated "connected" never re-opens the card
          throw Object.assign(new Error("That remote session was closed."), { status: 409 });
        }
        if (!row) {
          row = {
            id: input.id,
            botId: input.botId,
            threadId: input.threadId,
            principalId,
            code: input.code,
            os: input.os ?? "windows",
            ...(input.os ? {} : { osGuessed: true }),
            elevated: input.elevated,
            endAt: input.endAt,
            state: "connected",
            createdAt: now(),
            focused: false,
          };
          rows.push(row);
        } else {
          row.threadId = input.threadId;
          row.code = input.code;
          if (input.os) {
            row.os = input.os;
            delete row.osGuessed;
          }
          row.elevated = input.elevated;
          row.endAt = input.endAt;
          row.state = "connected";
        }
        for (const other of rows) {
          if (other.threadId === input.threadId) other.focused = other.id === row.id;
        }
        applyFacts(row, input.facts);
        writeCard(row);
        persist();
        return row;
      });
      const reachable = Boolean(tunnelOf(session));
      if (!reachable) return { view: viewOf(session), reachable };
      // Asking the remote computer happens outside the critical section, so a
      // slow or dead tunnel never holds another publish or a close.
      const work: StoredSession = { ...session };
      if (work.osGuessed) {
        try {
          const uname = await ssh(work, "uname -s", 10_000);
          // 255: the tunnel failed, the computer did not answer: ask again next time
          if (uname && uname.code !== TRANSPORT_FAILED) {
            work.os = uname.code === 0 ? osFromUname(uname.stdout) : "windows";
            delete work.osGuessed;
          }
        } catch { /* ask again next time */ }
      }
      if (!work.osGuessed) {
        try { await probe(work); } catch { /* the card still shows what we were given */ }
      }
      return exclusive(() => {
        if (session.state === "connected") {
          for (const field of ["os", "hostname", "user", "model", "serial", "cpu", "osName", "ramGb", "ram", "disk", "diskFreePercent"] as const) {
            if (work[field] !== undefined) (session as unknown as Record<string, unknown>)[field] = work[field];
          }
          if (!work.osGuessed) delete session.osGuessed;
          writeCard(session);
          persist();
        }
        return { view: viewOf(session), reachable };
      });
    },
    async close(principalId: string, botId: string, id: string): Promise<RemoteSessionView | null> {
      const closing = await exclusive(() => {
        prune();
        const session = owned(principalId, botId, id);
        if (!session) return null;
        const wasConnected = session.state === "connected";
        session.state = "ended";
        session.focused = false;
        writeCard(session);
        persist();
        return { session, wasConnected };
      });
      if (!closing) return null;
      const { session, wasConnected } = closing;
      controls.closeSession(session.id);
      if (wasConnected) {
        const ours = sagaxOpened(session);
        try { await ssh(session, stopCommand(session.id), 8_000); } catch { /* the screen still closes */ }
        if (ours) {
          // Delete the address and leave a `closed` marker first, so even if
          // Perspicax cannot be reached the tunnel no longer resolves here and
          // a late "connected" status cannot write the address back.
          const dir = supportDir?.();
          if (dir) await markSessionClosed(dir, session.code).catch(() => {});
          try {
            await deps.closeRemote?.({ principalId: session.principalId, botId: session.botId, threadId: session.threadId, code: session.code });
          } catch { /* Perspicax ends it at its end time; the address is already gone */ }
        }
      }
      return viewOf(session);
    },
    /** The session behind a support code was closed elsewhere (remote_support_close):
     * mark its card closed. The end user's script already stops by itself. */
    async endByCode(principalId: string, botId: string, code: string): Promise<RemoteSessionView | null> {
      return exclusive(async () => {
        const session = rows.find((row) => row.code === code && row.botId === botId && row.principalId === principalId && row.state === "connected");
        if (!session) return null;
        session.state = "ended";
        session.focused = false;
        controls.closeSession(session.id);
        writeCard(session);
        persist();
        return viewOf(session);
      });
    },
    /** Open live control (screen + mouse + keyboard) for a session this
     * person owns and that is connected and reachable. Windows only for now;
     * the control manager answers an error otherwise. */
    openControl(input: {
      principalId: string;
      botId: string;
      id: string;
      technician?: string;
      onMeta: OpenControl["onMeta"];
      onFrame: OpenControl["onFrame"];
      onClosed: OpenControl["onClosed"];
    }): ControlHandle | { error: string } {
      const session = owned(input.principalId, input.botId, input.id);
      if (!session || session.state !== "connected") return { error: "That remote session is not open." };
      const tunnel = tunnelOf(session);
      if (!tunnel) return { error: "The tunnel for this remote computer is not on this server yet." };
      return controls.open({
        session: { id: session.id, os: session.os, endAt: session.endAt },
        tunnel,
        bin: tailcatBin(),
        principalId: input.principalId,
        botId: input.botId,
        ...(input.technician ? { technician: input.technician } : {}),
        onMeta: input.onMeta,
        onFrame: input.onFrame,
        onClosed: input.onClosed,
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
      if (!tunnelOf(session)) return { error: "The tunnel for this remote computer is not on this server yet." };
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
    /** `dir`: the folder the person chose in the remote file browser; without
     * it the file goes to the transfer folder. */
    async upload(principalId: string, botId: string, id: string, name: string, bytes: Buffer, dir?: string): Promise<{ name: string } | { error: string }> {
      const safeName = safeUploadName(name);
      const session = owned(principalId, botId, id);
      if (!session || session.state !== "connected") return { error: "That remote session is not open." };
      if (!safeName) return { error: "Choose a simple file name." };
      if (bytes.length === 0 || bytes.length > UPLOAD_MAX) return { error: "The file must be under 8 MB." };
      const chosen = dir === undefined ? "" : safeRemoteDir(dir, session.os);
      if (chosen === null) return { error: "That folder cannot receive a file." };
      if (!tunnelOf(session)) return { error: "The tunnel for this remote computer is not on this server yet." };
      let remoteDir = chosen;
      if (!remoteDir) {
        const listed = await ssh(session, transferDirCommand(session.os), 15_000);
        remoteDir = safeRemotePath(listed?.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? "") ?? "";
        if (!listed || listed.code !== 0 || !remoteDir) return { error: "The remote computer did not accept a folder for the file." };
      }
      const remotePath = remoteJoin(remoteDir, safeName, session.os);
      const localDir = path.join(deps.dataDir, "remote-session-transfers");
      mkdirSync(localDir, { recursive: true, mode: 0o700 });
      const local = path.join(localDir, `${randomBytes(8).toString("hex")}-${safeName.replaceAll(" ", "_")}`);
      writeFileSync(local, bytes, { mode: 0o600 });
      try {
        const tunnel = tunnelOf(session);
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
      const tunnel = tunnelOf(session);
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
    /** One folder of the remote computer, read only, for its owner. */
    async listDir(principalId: string, botId: string, id: string, requested: unknown): Promise<ListResult> {
      const session = owned(principalId, botId, id);
      if (!session || session.state !== "connected") return { status: 403, error: "That remote session is not open for you." };
      const dir = safeRemoteDir(requested, session.os);
      if (dir === null) return { status: 400, error: "That folder path cannot be listed." };
      if (!tunnelOf(session)) return { status: 409, error: "The tunnel for this remote computer is not on this server yet." };
      const result = await ssh(session, listDirCommand(session.os, dir), LIST_TIMEOUT_MS);
      return readListing(result, session.os);
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
