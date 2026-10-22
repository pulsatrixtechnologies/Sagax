// One live-control process per remote session. It spawns the control helper
// over the session's tunnel, forwards the technician's input to it only while
// control is granted, streams the helper's frames back to the viewer, and
// tears everything down on release, on a lost connection, or at a hard
// deadline. Nothing the person typed reaches the helper: every event is
// re-validated here and encoded as a fixed line. Input is audited by control
// action, never keystroke by keystroke (Loi 25 minimisation: no key logging).
import { spawn } from "node:child_process";

import {
  coalesceEvents,
  createHelperFrameDecoder,
  encodeControlEvent,
  parseControlEvent,
  type ControlEvent,
  type HelperMeta,
} from "../shared/remote-control.ts";
import type { RemoteSessionOs } from "../shared/remote-session.ts";
import { controlHelperCommand, controlSupported } from "./remote-control-helper.ts";
import { tailcatSshArgv } from "./remote-session-probe.ts";

export type ControlStopReason = "released" | "closed" | "deadline" | "helper_exit" | "protocol" | "replaced";

export interface ControlAuditEvent {
  at: number;
  sessionId: string;
  principalId: string;
  botId: string;
  kind: "control.start" | "control.grant" | "control.release" | "control.stop" | "control.input_blocked";
  reason?: ControlStopReason;
  os?: RemoteSessionOs;
  /** Counts since the last grant, logged on release (never the keys themselves). */
  moves?: number;
  clicks?: number;
  keys?: number;
  chars?: number;
}

/** A spawned helper process, abstracted so a test can drive it. */
export interface ControlProcess {
  writeLine(line: string): void;
  onStdout(cb: (chunk: Uint8Array) => void): void;
  onExit(cb: () => void): void;
  kill(): void;
}

export type SpawnControl = (argv: string[]) => ControlProcess;

export interface OpenControl {
  session: { id: string; os: RemoteSessionOs; endAt: string };
  tunnel: { keyPath: string; address: string };
  bin: string;
  principalId: string;
  botId: string;
  /** Deliver the remote screen size to the viewer (once, and on change). */
  onMeta(meta: HelperMeta): void;
  /** Deliver one JPEG frame to the viewer. */
  onFrame(bytes: Uint8Array): void;
  /** The session ended on the server side; the viewer should stop. */
  onClosed(reason: ControlStopReason): void;
}

export interface ControlHandle {
  setControl(granted: boolean): void;
  input(events: readonly ControlEvent[]): void;
  close(reason: ControlStopReason): void;
  readonly granted: boolean;
}

const MAX_SECONDS = 26 * 60 * 60;
const FPS = 6;
const QUALITY = 60;

function defaultSpawn(argv: string[]): ControlProcess {
  const child = spawn(argv[0]!, argv.slice(1), { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  return {
    writeLine(line) { try { child.stdin.write(`${line}\n`); } catch { /* the process is gone; close follows */ } },
    onStdout(cb) { child.stdout.on("data", (chunk: Buffer) => cb(chunk)); },
    onExit(cb) { child.on("close", cb); child.on("error", cb); },
    kill() { try { child.kill("SIGTERM"); } catch { /* already gone */ } },
  };
}

export function createRemoteControlSessions(deps: {
  audit: { write(event: ControlAuditEvent): void };
  now?: () => number;
  spawn?: SpawnControl;
}) {
  const now = deps.now ?? (() => Date.now());
  const spawnControl = deps.spawn ?? defaultSpawn;
  const handles = new Map<string, InternalHandle>();

  interface InternalHandle extends ControlHandle {
    id: string;
  }

  function open(input: OpenControl): ControlHandle | { error: string } {
    if (!controlSupported(input.session.os)) {
      return { error: "Live control is available on Windows for now. The screen stays view-only on this computer." };
    }
    const built = controlHelperCommand(input.session.os, { fps: FPS, quality: QUALITY, maxSeconds: deadlineSeconds(input.session.endAt) });
    if (!built) return { error: "Live control is not available on this computer." };

    // A second open for the same session replaces the first (a viewer
    // reconnect): the old process is stopped so it never keeps injecting.
    handles.get(input.session.id)?.close("replaced");

    const proc = spawnControl(tailcatSshArgv(input.bin, input.tunnel.keyPath, input.tunnel.address, built.command));
    const decode = createHelperFrameDecoder();
    let granted = false;
    let closed = false;
    let blockedLogged = false;
    let moves = 0;
    let clicks = 0;
    let keys = 0;
    let chars = 0;

    const audit = (kind: ControlAuditEvent["kind"], extra: Partial<ControlAuditEvent> = {}) => {
      deps.audit.write({ at: now(), sessionId: input.session.id, principalId: input.principalId, botId: input.botId, kind, ...extra });
    };

    const resetCounts = () => { moves = 0; clicks = 0; keys = 0; chars = 0; };

    const close = (reason: ControlStopReason) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (granted) {
        granted = false;
        audit("control.release", { moves, clicks, keys, chars });
      }
      handles.delete(input.session.id);
      proc.kill();
      audit("control.stop", { reason });
      input.onClosed(reason);
    };

    proc.onStdout((chunk) => {
      if (closed) return;
      const result = decode(chunk);
      if (!Array.isArray(result)) { close("protocol"); return; }
      for (const message of result) {
        if (message.kind === "meta") input.onMeta(message.meta);
        else input.onFrame(message.bytes);
      }
    });
    proc.onExit(() => close("helper_exit"));

    const timer = setTimeout(() => close("deadline"), deadlineSeconds(input.session.endAt) * 1000);
    if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();

    audit("control.start", { os: input.session.os });

    const handle: InternalHandle = {
      id: input.session.id,
      get granted() { return granted; },
      setControl(on: boolean) {
        if (closed || on === granted) return;
        granted = on;
        if (on) {
          blockedLogged = false;
          resetCounts();
          audit("control.grant");
        } else {
          audit("control.release", { moves, clicks, keys, chars });
          resetCounts();
        }
      },
      input(events) {
        if (closed) return;
        if (!granted) {
          if (!blockedLogged) { blockedLogged = true; audit("control.input_blocked"); }
          return;
        }
        for (const ev of coalesceEvents(events)) {
          const valid = parseControlEvent(ev);
          if (!valid) continue;
          if (valid.t === "m") moves++;
          else if (valid.t === "d") clicks++;
          else if (valid.t === "k") { if (valid.d === 1) keys++; }
          else if (valid.t === "x") chars += valid.s.length;
          proc.writeLine(encodeControlEvent(valid));
        }
      },
      close,
    };
    handles.set(input.session.id, handle);
    return handle;
  }

  function deadlineSeconds(endAt: string): number {
    const end = Date.parse(endAt);
    if (!Number.isFinite(end)) return 60;
    const seconds = Math.floor((end - now()) / 1000);
    return Math.max(1, Math.min(MAX_SECONDS, seconds));
  }

  return {
    open,
    /** Stop control for one session (its stage-1 row was closed). */
    closeSession(id: string, reason: ControlStopReason = "closed") {
      handles.get(id)?.close(reason);
    },
    has(id: string) {
      return handles.has(id);
    },
  };
}

export type RemoteControlSessions = ReturnType<typeof createRemoteControlSessions>;
