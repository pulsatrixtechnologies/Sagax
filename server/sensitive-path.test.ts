import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownEnvironmentSensitiveRead } from "./member-environment.ts";
import { credentialLocation, procSecretPath, resolvedReadRefusal, sensitiveEnvironmentPath } from "./sensitive-path.ts";
import { callUserSandboxTool, type ToolExec } from "./user-sandbox-tools.ts";

const hasPython = spawnSync("python3", ["-c", "print(1)"]).status === 0;

describe("process secrets and credential locations (2026-10-17)", () => {
  it("names every /proc environ, cmdline and mem, with or without a task", () => {
    for (const path of [
      "/proc/self/environ", "/proc/1/environ", "/proc/4242/cmdline", "/proc/thread-self/mem", "/proc/self/task/7/environ",
      "/proc/12/task/12/cmdline", "//proc//self/environ", "/proc/self/fd/3", "/proc/1/root/etc/shadow", "/dev/fd/3", "/proc/self/cwd",
    ]) {
      expect(procSecretPath(path), path).toBe(true);
      expect(sensitiveEnvironmentPath(path), path).toBe(true);
      expect(ownEnvironmentSensitiveRead(JSON.stringify({ path })), path).toBe(true);
    }
    for (const path of ["/proc/cpuinfo", "/proc/meminfo", "/workspace/proc/self/environ", "proc/self/environ"]) expect(procSecretPath(path), path).toBe(false);
  });

  it("knows credential locations by folder and by name", () => {
    for (const path of ["/workspace/.ssh/config", "/workspace/.git-credentials", "/workspace/.config/gh/hosts.yml", "/root/.aws/config", "/x/.kube/config", "/x/server.pem", "/x/id_ed25519", "/x/.env.local", "/proc/9/environ"]) {
      expect(credentialLocation(path), path).toBe(true);
    }
    for (const path of ["/workspace/notes.txt", "/workspace/.cache/x", "/workspace/.config/Code/settings.json", "/tmp"]) expect(credentialLocation(path), path).toBe(false);
  });

  it("refuses a read whose links lead somewhere its name did not say", () => {
    expect(resolvedReadRefusal("/workspace/notes.txt", { real: "/workspace/notes.txt", links: [] })).toBeNull();
    expect(resolvedReadRefusal("/workspace/notes.txt", { real: "/workspace/.git-credentials", links: ["/workspace/.git-credentials"] })).toMatch(/credential location/);
    expect(resolvedReadRefusal("/workspace/env", { real: "/proc/77/environ", links: ["/proc/77"] })).toMatch(/\/proc/);
    expect(resolvedReadRefusal("/workspace/rc", { real: "/workspace/.bashrc", links: ["/workspace/.bashrc"] })).toMatch(/dotfile/);
    // a dotfile named outright keeps its card upstream; no link, no refusal here
    expect(resolvedReadRefusal("/workspace/.bashrc", { real: "/workspace/.bashrc", links: [] })).toBeNull();
    // a link to an ordinary folder is fine
    expect(resolvedReadRefusal("/workspace/docs/a.txt", { real: "/workspace/real-docs/a.txt", links: ["/workspace/real-docs"] })).toBeNull();
  });
});

describe.skipIf(!hasPython)("reads in the environment follow no link into a credential location (real folders)", () => {
  let root: string;
  let workspace: string;
  let home: string;
  let ran: string[][];

  /** Runs each exec here, in `workspace`, as the sandbox would. */
  const local = (before?: (argv: string[]) => void): ToolExec => ({
    exec: async (input) => {
      ran.push(input.argv);
      before?.(input.argv);
      const [bin, ...rest] = input.argv;
      const out = spawnSync(bin!, rest, { cwd: workspace, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...input.env }, encoding: "utf8" });
      return { exitCode: out.status, stdout: out.stdout ?? "", stderr: out.stderr ?? "", truncated: false, timedOut: false };
    },
    overQuota: async () => false,
  });
  const body = (result: { content: Array<{ type: string; text?: string }> }) => result.content.map((part) => part.text ?? "").join("");

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "sagax-sensitive-path-")));
    workspace = join(root, "workspace");
    home = join(root, "home");
    mkdirSync(join(home, ".ssh"), { recursive: true });
    mkdirSync(join(workspace, "real-docs"), { recursive: true });
    writeFileSync(join(home, ".ssh", "id_rsa"), "PRIVATE KEY\n");
    writeFileSync(join(home, ".ssh", "config"), "Host x\n");
    writeFileSync(join(home, ".git-credentials"), "https://user:ghp_secret@github.com\n");
    writeFileSync(join(home, ".bashrc"), "export TOKEN=1\n");
    writeFileSync(join(workspace, "real-docs", "a.txt"), "plain words\n");
    symlinkSync(join(home, ".git-credentials"), join(workspace, "notes.txt"));
    symlinkSync(join(home, ".ssh"), join(workspace, "keys"));
    symlinkSync(join(home, ".bashrc"), join(workspace, "rc"));
    symlinkSync(join(workspace, "real-docs"), join(workspace, "docs"));
    symlinkSync("/proc/self", join(workspace, "me"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("refuses a file link to .git-credentials, a folder link to .ssh and a link to a dotfile", async () => {
    for (const path of ["notes.txt", `${workspace}/notes.txt`, "keys/config", "keys/id_rsa", "keys/not-there-yet", "docs/../keys/config", "rc"]) {
      ran = [];
      const result = await callUserSandboxTool("read_file", { path }, local());
      expect(result.isError, path).toBe(true);
      expect(body(result), path).not.toMatch(/ghp_secret|PRIVATE KEY|TOKEN/);
      // only the resolution ran, never the read
      expect(ran.map((argv) => argv[0]), path).toEqual(["python3"]);
    }
    ran = [];
    const listed = await callUserSandboxTool("list_files", { path: "keys" }, local());
    expect(listed.isError).toBe(true);
    expect(body(listed)).not.toContain("id_rsa");
  });

  it("refuses /proc secrets named outright or reached through a link", async () => {
    for (const path of ["/proc/self/environ", "/proc/1/cmdline", "/proc/thread-self/mem", "/proc/self/task/1/environ", "/dev/fd/0"]) {
      ran = [];
      const result = await callUserSandboxTool("read_file", { path }, local());
      expect(result.isError, path).toBe(true);
      expect(ran, path).toEqual([]);
    }
    ran = [];
    const linked = await callUserSandboxTool("read_file", { path: "me/environ" }, local());
    expect(linked.isError).toBe(true);
    expect(body(linked)).toMatch(/\/proc/);
  });

  it("reads through an ordinary link, on the resolved path", async () => {
    ran = [];
    const result = await callUserSandboxTool("read_file", { path: "docs/a.txt" }, local());
    expect(result.isError).not.toBe(true);
    expect(body(result)).toContain("plain words");
    const listed = await callUserSandboxTool("list_files", { path: "docs" }, local());
    expect(body(listed)).toContain("a.txt");
  });

  it("refuses when a link is swapped between the resolution and the read", async () => {
    const swap = join(workspace, "swap");
    symlinkSync(join(workspace, "real-docs"), swap);
    const result = await callUserSandboxTool("read_file", { path: "swap/a.txt" }, local((argv) => {
      if (argv[0] !== "sh") return;
      unlinkSync(swap);
      symlinkSync(home, swap);
    }));
    expect(result.isError).toBe(true);
    expect(body(result)).toMatch(/changed/);
  });
});
