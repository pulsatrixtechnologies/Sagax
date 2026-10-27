// install.sh (docs/install.md): the one-line self-hosted install. Every case
// runs against a fake `docker` on PATH, so nothing is pulled or started.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const installer = join(root, "install.sh");
const unix = process.platform !== "win32";
const dirs: string[] = [];

function sandbox(opts: { dockerRunning?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-install-"));
  dirs.push(dir);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "docker.log");
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/sh\necho "docker $*" >> "${log}"\ncase "$1 $2" in "compose version") exit 0;; "info "*) exit ${opts.dockerRunning === false ? 1 : 0};; "volume inspect") exit 1;; esac\nexit 0\n`,
  );
  chmodSync(join(bin, "docker"), 0o755);
  const home = join(dir, "home");
  mkdirSync(home);
  const run = (args: string[], script = installer, cwd = dir) =>
    spawnSync("bash", [script, ...args], {
      cwd,
      encoding: "utf8",
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home },
    });
  const dockerLog = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  return { dir, home, run, dockerLog, install: join(home, "sagax") };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.runIf(unix)("install.sh", () => {
  it("dry run writes nothing and starts nothing", () => {
    const box = sandbox();
    const result = box.run(["--dry-run", "--version", "0.8.3"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("ghcr.io/pulsatrixtechnologies/sagax:0.8.3");
    expect(result.stdout).toContain("dry run: would write");
    expect(existsSync(box.install)).toBe(false);
    expect(box.dockerLog()).not.toMatch(/docker (compose )?(pull|up|run|exec)/);
  });

  it("generates the vault key in a private .env and never prints it", () => {
    const box = sandbox();
    const result = box.run(["--no-start", "--no-link", "--version", "0.8.3"]);
    expect(result.status, result.stderr).toBe(0);
    const env = readFileSync(join(box.install, ".env"), "utf8");
    const key = /^SAGAX_MCP_OAUTH_KEY=([0-9a-f]{64})$/m.exec(env)?.[1];
    expect(key).toBeTruthy();
    expect(result.stdout + result.stderr).not.toContain(key!);
    expect(statSync(join(box.install, ".env")).mode & 0o777).toBe(0o600);
    expect(statSync(box.install).mode & 0o777).toBe(0o700);
    expect(box.dockerLog()).not.toMatch(/docker (compose )?(pull|up)/);
  });

  it("keeps an existing .env and its key on a re-run, and keeps the domain", () => {
    const box = sandbox();
    expect(box.run(["--no-start", "--no-link", "--version", "0.8.3", "--domain", "bots.example.com"]).status).toBe(0);
    const before = readFileSync(join(box.install, ".env"), "utf8");
    const again = box.run(["--no-start", "--no-link", "--version", "0.8.4"]);
    expect(again.status, again.stderr).toBe(0);
    const after = readFileSync(join(box.install, ".env"), "utf8");
    expect(after).toContain("SAGAX_VERSION=0.8.4");
    expect(after).toContain("SAGAX_DOMAIN=bots.example.com");
    expect(/^SAGAX_MCP_OAUTH_KEY=.*$/m.exec(after)?.[0]).toBe(/^SAGAX_MCP_OAUTH_KEY=.*$/m.exec(before)?.[0]);
    const compose = readFileSync(join(box.install, "compose.yaml"), "utf8");
    expect(compose).toContain('"443:443"');
    expect(readFileSync(join(box.install, "Caddyfile"), "utf8")).toContain("{$SAGAX_DOMAIN}");
  });

  it("serves on localhost only by default, behind Caddy, from the public image", () => {
    const box = sandbox();
    expect(box.run(["--no-start", "--no-link", "--version", "0.8.3"]).status).toBe(0);
    const compose = readFileSync(join(box.install, "compose.yaml"), "utf8");
    expect(compose).toContain('"${SAGAX_BIND:-127.0.0.1}:${SAGAX_HTTP_PORT:-8080}:80"');
    expect(compose).toContain("image: ${SAGAX_IMAGE:-ghcr.io/pulsatrixtechnologies/sagax}:${SAGAX_VERSION");
    expect(compose).toContain('network_mode: "service:omb"');
    expect(compose).toMatch(/^\s+init: true$/m);
    expect(compose).toMatch(/^\s+shm_size: 512m$/m);
    expect(compose).not.toContain("build:");
  });

  it("refuses to run without a running Docker, and says why", () => {
    const box = sandbox({ dockerRunning: false });
    const result = box.run(["--version", "0.8.3"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not running");
    expect(existsSync(box.install)).toBe(false);
  });

  it("sagax update pins the release it is given; dry run changes nothing", () => {
    const box = sandbox();
    expect(box.run(["--no-start", "--no-link", "--version", "0.8.3"]).status).toBe(0);
    const helper = join(box.install, "sagax");
    const dry = box.run(["update", "0.8.4", "--dry-run"], helper, box.install);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("0.8.3 -> 0.8.4");
    expect(readFileSync(join(box.install, ".env"), "utf8")).toContain("SAGAX_VERSION=0.8.3");
    const bad = box.run(["update", "latest-ish"], helper, box.install);
    expect(bad.status).not.toBe(0);
    expect(readFileSync(join(box.install, ".env"), "utf8")).toContain("SAGAX_VERSION=0.8.3");
  });

  it.runIf(spawnSync("shellcheck", ["--version"]).status === 0)("passes shellcheck, installer and generated helper", () => {
    const box = sandbox();
    expect(box.run(["--no-start", "--no-link", "--version", "0.8.3"]).status).toBe(0);
    for (const file of [installer, join(box.install, "sagax")]) {
      const check = spawnSync("shellcheck", ["-x", file], { encoding: "utf8" });
      expect(check.status, check.stdout).toBe(0);
    }
  });
});
