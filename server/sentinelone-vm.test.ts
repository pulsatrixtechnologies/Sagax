// SentinelOne on a persistent local virtual machine. A fake guest stands in
// for the container runtime: nothing here contacts SentinelOne.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  INSTALLING_PROBLEM,
  S1_TOKEN_ENV,
  TIMEOUT_ERROR,
  TOKEN_LEFT_ERROR,
  commandGuestTransport,
  guestExecArgv,
  guestScripts,
  probeScript,
} from "../electron/sentinelone-vm.mjs";
import { adminActivityFileFor, flushAdminActivity } from "./admin-activity.ts";
import { localVmDesktopSpec } from "./container-computer.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import {
  containerGuestTransport,
  decorateDesktopLocalVmResult,
  presentContainerStatus,
  resetSentinelOneForTests,
  sentinelOneSettled,
} from "./sentinelone-vm.ts";

const TOKEN = "s1-site-token-DO-NOT-LEAK-9f3a";
const dirs: string[] = [];
const logs: string[] = [];
const consoleNames = ["log", "info", "warn", "error", "debug"] as const;
const originalConsole = new Map<string, (...args: unknown[]) => void>();

type GuestCall = { kind?: string; stdin?: string; argv: string[]; script: string };

function containsToken(value: unknown): boolean {
  return JSON.stringify(value ?? "").includes(TOKEN);
}

function guest(answer: (call: GuestCall) => { code?: number; stdout?: string; stderr?: string } | Promise<{ code?: number; stdout?: string; stderr?: string }>) {
  const calls: GuestCall[] = [];
  const transport = commandGuestTransport({
    os: "linux-deb",
    token: TOKEN,
    container: "vm-1",
    runtime: "docker",
    exec: async (call: GuestCall) => {
      const recorded = { kind: call.kind, stdin: call.stdin, argv: call.argv, script: call.script };
      calls.push(recorded);
      return answer(recorded);
    },
  });
  return { calls, transport };
}

/** First probe is offline, the install succeeds, the next probe is online. */
function onlineGuest() {
  let probes = 0;
  return guest(async (call) => {
    if (call.kind === "env") return { code: 0, stdout: "PATH=/usr/bin" };
    if (call.kind === "write" || call.kind === "wipe") return { code: 0 };
    if (call.script.includes("dpkg") || call.script.includes("rpm -U")) return { code: 0, stdout: "installed" };
    probes += 1;
    return probes === 1 ? { code: 1, stdout: "not registered" } : { code: 0, stdout: "Agent is online" };
  });
}

const running = { ready: true, problem: null as string | null, container: "running", container_name: "box", runtime: "docker" };

beforeEach(() => {
  resetSentinelOneForTests();
  logs.length = 0;
  for (const name of consoleNames) {
    originalConsole.set(name, console[name] as (...args: unknown[]) => void);
    console[name] = ((...args: unknown[]) => {
      logs.push(args.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(" "));
    }) as typeof console.log;
  }
});

afterEach(async () => {
  resetSentinelOneForTests();
  for (const name of consoleNames) {
    const original = originalConsole.get(name);
    if (original) console[name] = original as typeof console.log;
  }
  for (const dir of dirs.splice(0)) await removeTempDir(dir);
});

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-s1-"));
  dirs.push(dir);
  return dir;
}

async function auditText(dir: string): Promise<string> {
  await flushAdminActivity(dir);
  const file = adminActivityFileFor(dir, new Date());
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

describe("SentinelOne on a persistent local virtual machine", () => {
  it("keeps the site token out of the Computer tab recipe", () => {
    const spec = localVmDesktopSpec();
    expect(spec.persistent).toBe(true);
    expect(containsToken(spec)).toBe(false);
    expect(JSON.stringify(spec).includes(S1_TOKEN_ENV)).toBe(false);
  });

  it("installs once, then reports the agent online, and the token stays out of the answer, the audit and the logs", async () => {
    const dir = dataDir();
    const { calls, transport } = onlineGuest();
    const first = presentContainerStatus(running, {
      key: "vm-1", persistent: true, enabled: true, dataDir: dir, transport,
      env: { [S1_TOKEN_ENV]: TOKEN },
    });
    expect(first.ready).toBe(false);
    expect(first.problem).toBe(INSTALLING_PROBLEM);
    expect(first.protection).toEqual({ state: "installing" });
    expect(containsToken(first)).toBe(false);
    await sentinelOneSettled("vm-1");
    const second = presentContainerStatus(running, {
      key: "vm-1", persistent: true, enabled: true, dataDir: dir, transport,
      env: { [S1_TOKEN_ENV]: TOKEN },
    });
    expect(second.ready).toBe(true);
    expect(second.protection).toEqual({ state: "active" });
    expect(containsToken(second)).toBe(false);
    expect(calls.some((call) => call.kind === "write" && call.stdin === TOKEN)).toBe(true);
    expect(calls.some((call) => call.argv.join("\n").includes(TOKEN) || call.script.includes(TOKEN))).toBe(false);
    expect(calls.filter((call) => call.kind === "wipe").length).toBeGreaterThan(0);
    const audit = await auditText(dir);
    expect(audit.includes("computer.sentinelone_install")).toBe(true);
    expect(audit.includes("Pulsatrix Technologies Inc.")).toBe(true);
    expect(audit.includes("detect-only")).toBe(true);
    expect(audit.includes(TOKEN)).toBe(false);
    expect(logs.some((line) => line.includes(TOKEN))).toBe(false);
  });

  it("skips an ephemeral machine, a stopped machine, a missing token and a turned-off organization", async () => {
    const { calls, transport } = onlineGuest();
    const env = { [S1_TOKEN_ENV]: TOKEN };
    const skipped = [
      presentContainerStatus(running, { key: "eph", persistent: false, enabled: true, transport, env }),
      presentContainerStatus({ ...running, container: "stopped" }, { key: "stopped", persistent: true, enabled: true, transport, env }),
      presentContainerStatus(running, { key: "notoken", persistent: true, enabled: true, transport, env: {} }),
      presentContainerStatus(running, { key: "off", persistent: true, enabled: false, transport, env }),
    ];
    for (const status of skipped) {
      expect(status.protection).toBeNull();
      expect(status.ready).toBe(true);
    }
    expect(calls).toEqual([]);
  });

  it("fails on the time limit, keeps the error clear, and a retry can succeed", async () => {
    const dir = dataDir();
    let clock = 1_000;
    let installs = 0;
    const { calls, transport } = guest(async (call) => {
      if (call.kind === "env") return { code: 0, stdout: "PATH=/usr/bin" };
      if (call.kind === "write" || call.kind === "wipe") return { code: 0 };
      if (call.script.includes("dpkg")) {
        installs += 1;
        return installs === 1 ? { code: 0, stdout: "installed" } : { code: 0, stdout: "Agent is online" };
      }
      return installs < 2 ? { code: 1, stdout: "not registered" } : { code: 0, stdout: "Agent is online" };
    });
    const opts = {
      key: "vm-timeout", persistent: true, enabled: true, dataDir: dir, transport,
      env: { [S1_TOKEN_ENV]: TOKEN }, now: () => clock, sleep: async (ms: number) => { clock += ms; },
    };
    presentContainerStatus(running, opts);
    await sentinelOneSettled("vm-timeout");
    const failed = presentContainerStatus(running, opts);
    expect(failed.ready).toBe(false);
    expect(failed.protection?.state).toBe("failed");
    expect(failed.protection?.code).toBe("timeout");
    expect(failed.problem).toBe(TIMEOUT_ERROR);
    expect(containsToken(failed)).toBe(false);
    const again = presentContainerStatus(running, { ...opts, retry: true });
    expect(again.protection?.state).toBe("installing");
    await sentinelOneSettled("vm-timeout");
    const active = presentContainerStatus(running, opts);
    expect(active.protection).toEqual({ state: "active" });
    expect(active.ready).toBe(true);
    expect(calls.some((call) => call.argv.join("\n").includes(TOKEN))).toBe(false);
    expect((await auditText(dir)).includes(TOKEN)).toBe(false);
  });

  it("redacts a token the guest printed, including one left in the environment", async () => {
    const dir = dataDir();
    const leaked = guest(async (call) => {
      if (call.kind === "write" || call.kind === "wipe") return { code: 0 };
      if (call.script.includes("dpkg")) return { code: 1, stderr: `dpkg: ${TOKEN}` };
      return { code: 1, stdout: "not registered" };
    });
    presentContainerStatus(running, {
      key: "leak", persistent: true, enabled: true, dataDir: dir, transport: leaked.transport,
      env: { [S1_TOKEN_ENV]: TOKEN },
    });
    await sentinelOneSettled("leak");
    const failed = presentContainerStatus(running, {
      key: "leak", persistent: true, enabled: true, dataDir: dir, transport: leaked.transport,
      env: { [S1_TOKEN_ENV]: TOKEN },
    });
    expect(failed.protection?.state).toBe("failed");
    expect(containsToken(failed)).toBe(false);
    expect(failed.protection?.error?.includes("[hidden]")).toBe(true);
    expect((await auditText(dir)).includes(TOKEN)).toBe(false);

    resetSentinelOneForTests();
    const left = guest(async (call) => {
      if (call.kind === "env") return { code: 0, stdout: `PATH=/usr/bin\nSITE=${TOKEN}` };
      if (call.kind === "write" || call.kind === "wipe") return { code: 0 };
      if (call.script.includes("dpkg")) return { code: 0, stdout: "installed" };
      return { code: 1, stdout: "not registered" };
    });
    presentContainerStatus(running, {
      key: "left", persistent: true, enabled: true, dataDir: dir, transport: left.transport,
      env: { [S1_TOKEN_ENV]: TOKEN },
    });
    await sentinelOneSettled("left");
    const held = presentContainerStatus(running, {
      key: "left", persistent: true, enabled: true, dataDir: dir, transport: left.transport,
      env: { [S1_TOKEN_ENV]: TOKEN },
    });
    expect(held.protection).toMatchObject({ state: "failed", code: "token_left", error: TOKEN_LEFT_ERROR });
    expect(containsToken(held)).toBe(false);
    expect(TOKEN_LEFT_ERROR.includes(TOKEN)).toBe(false);
  });

  it("starts a single install when two polls arrive together", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered = 0;
    const { transport } = guest(async () => {
      entered += 1;
      await gate;
      return { code: 0, stdout: "Agent is online" };
    });
    const opts = {
      key: "once", persistent: true, enabled: true, transport, env: { [S1_TOKEN_ENV]: TOKEN },
    };
    const first = presentContainerStatus(running, opts);
    const second = presentContainerStatus(running, opts);
    expect(first.protection?.state).toBe("installing");
    expect(second.protection?.state).toBe("installing");
    expect(entered).toBe(1);
    release();
    await sentinelOneSettled("once");
  });

  it("does not put the site token on the runtime command line or in the child environment", async () => {
    const argv = guestExecArgv({ runtime: "docker", container: "box", os: "linux-deb", script: "echo hi", token: TOKEN });
    expect(argv.join("\n").includes(TOKEN)).toBe(false);
    expect(() => guestExecArgv({
      runtime: "docker", container: "box", os: "linux-deb", script: "echo hi", token: TOKEN, env: { [S1_TOKEN_ENV]: TOKEN },
    })).toThrow(/secret variable/);
    for (const os of ["linux-deb", "linux-rpm", "windows", "macos"]) {
      const scripts = guestScripts(os);
      for (const script of [scripts.write, scripts.wipe, scripts.env, scripts.probe, scripts.install]) {
        expect(script.includes(TOKEN)).toBe(false);
        expect(/https?:\/\//.test(script)).toBe(false);
      }
    }
    expect(probeScript("windows").includes("C:\\Program Files\\SentinelOne")).toBe(true);

    const previous = process.env[S1_TOKEN_ENV];
    process.env[S1_TOKEN_ENV] = TOKEN;
    try {
      let childEnv: NodeJS.ProcessEnv | undefined;
      const transport = containerGuestTransport({
        runtime: "docker",
        container: "box",
        token: TOKEN,
        spawnImpl: (_command, _args, opts) => {
          childEnv = opts.env;
          throw new Error(`spawn ${TOKEN}`);
        },
      });
      const answer = await transport.run("echo hi");
      expect(childEnv?.[S1_TOKEN_ENV]).toBeUndefined();
      expect(Object.values(childEnv ?? {}).some((value) => String(value).includes(TOKEN))).toBe(false);
      expect(String(answer.stderr).includes(TOKEN)).toBe(false);
      expect(String(answer.stderr).includes("[hidden]")).toBe(true);
    } finally {
      if (previous === undefined) delete process.env[S1_TOKEN_ENV];
      else process.env[S1_TOKEN_ENV] = previous;
    }
  });

  it("decorates a desktop status without waiting, and redacts a token the desktop echoed", async () => {
    const dir = dataDir();
    const plain = { content: [{ type: "text", text: "ok" }] };
    let protects = 0;
    expect(decorateDesktopLocalVmResult({
      person: "ada", result: plain, dataDir: dir, env: { [S1_TOKEN_ENV]: TOKEN },
      protect: async () => { protects += 1; return plain; },
    })).toBe(plain);
    expect(protects).toBe(0);

    const status = {
      content: [{ type: "text", text: JSON.stringify({
        runtime: { found: true }, vm: { state: "running", name: "openmausbot-computer" }, ready: true, persistent: true,
      }) }],
    };
    const first = decorateDesktopLocalVmResult({
      person: "ada", result: status, dataDir: dir, env: { [S1_TOKEN_ENV]: TOKEN },
      protect: async () => ({
        content: [{ type: "text", text: JSON.stringify({ protection: { state: "failed", error: `echo ${TOKEN}`, code: "install_failed" }, audited: true }) }],
      }),
    });
    expect(containsToken(first)).toBe(false);
    await sentinelOneSettled("desktop:ada:openmausbot-computer");
    const second = decorateDesktopLocalVmResult({
      person: "ada", result: status, dataDir: dir, env: { [S1_TOKEN_ENV]: TOKEN },
      protect: async () => { throw new Error("second install"); },
    }) as { content: { text: string }[] };
    const parsed = JSON.parse(second.content[0]!.text) as { protection: { state: string; error?: string }; ready: boolean };
    expect(parsed.protection.state).toBe("failed");
    expect(parsed.ready).toBe(false);
    expect(parsed.protection.error?.includes(TOKEN)).toBe(false);
    expect(parsed.protection.error?.includes("[hidden]")).toBe(true);
    expect((await auditText(dir)).includes(TOKEN)).toBe(false);
  });

  it("does not audit an agent that was already online", async () => {
    const dir = dataDir();
    const { calls, transport } = guest(async (call) => {
      if (call.kind === "wipe") return { code: 0 };
      return { code: 0, stdout: "Agent is online" };
    });
    presentContainerStatus(running, {
      key: "already", persistent: true, enabled: true, dataDir: dir, transport,
      env: { [S1_TOKEN_ENV]: TOKEN },
    });
    await sentinelOneSettled("already");
    const status = presentContainerStatus(running, {
      key: "already", persistent: true, enabled: true, dataDir: dir, transport,
      env: { [S1_TOKEN_ENV]: TOKEN },
    });
    expect(status.protection).toEqual({ state: "active" });
    expect(status.ready).toBe(true);
    expect(calls.some((call) => call.kind === "write")).toBe(false);
    expect((await auditText(dir)).includes("computer.sentinelone_install")).toBe(false);
  });
});
