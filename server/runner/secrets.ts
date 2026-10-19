// The environment's secrets inside the Pod (spec CA-6, section 6): one file
// per secret, mode 0400, in a memory-backed directory (the Pod's /dev/shm,
// medium Memory; /tmp is a disk emptyDir there). The setup script sees every
// secret (files and variables); the `setup_only` ones (the default) are
// erased before the engine starts, so the agent only ever sees the secrets
// the environment exposes to it.
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { RunnerSecret } from "./protocol.ts";

export const DEFAULT_SECRETS_DIR = "/dev/shm/px-secrets";
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** Names a secret may not take as a variable: the runner's own wiring. */
const RESERVED = /^(PATH|HOME|USER|SHELL|LANG|TMPDIR|PWD|NODE_OPTIONS|NODE_PATH|LD_.*|DYLD_.*|BASH_ENV|ENV|GIT_.*|PX_.*|SAGAX_.*|ANTHROPIC_.*|OPENAI_.*|CODEX_.*|CLAUDE_.*|HTTPS?_PROXY|NO_PROXY|https?_proxy|no_proxy)$/;

export interface SecretProblem { name: string; reason: string }

export class SecretStore {
  private secrets: RunnerSecret[] = [];
  private wiped = false;

  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Write each secret once. Returns the names refused (malformed or
   * reserved), which are never written or exported. */
  write(secrets: RunnerSecret[]): SecretProblem[] {
    const problems: SecretProblem[] = [];
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
    const seen = new Set<string>();
    for (const secret of secrets) {
      if (!NAME_RE.test(secret.name)) { problems.push({ name: secret.name.slice(0, 64), reason: "nom invalide" }); continue; }
      if (RESERVED.test(secret.name)) { problems.push({ name: secret.name, reason: "nom réservé au runner" }); continue; }
      if (seen.has(secret.name)) { problems.push({ name: secret.name, reason: "nom en double" }); continue; }
      seen.add(secret.name);
      const file = join(this.dir, secret.name);
      rmSync(file, { force: true });
      writeFileSync(file, secret.value, { mode: 0o400, flag: "wx" });
      chmodSync(file, 0o400);
      this.secrets.push(secret);
    }
    return problems;
  }

  /** Variables for the setup script: every secret. */
  setupEnv(): Record<string, string> {
    return this.envOf(this.secrets);
  }

  /** Variables for the engine: only the secrets exposed to the agent. */
  agentEnv(): Record<string, string> {
    return this.envOf(this.secrets.filter((secret) => !secret.setup_only));
  }

  private envOf(list: RunnerSecret[]): Record<string, string> {
    const env: Record<string, string> = { PX_SECRETS_DIR: this.dir };
    for (const secret of list) env[secret.name] = secret.value;
    return env;
  }

  /** The setup_only values still held (before eraseSetupOnly). */
  setupOnlyValues(): string[] {
    return this.secrets.filter((s) => s.setup_only && s.value.length >= 6).map((s) => s.value);
  }

  /** Erase the setup_only secrets: their files and the runner's copy. */
  eraseSetupOnly(): string[] {
    const erased: string[] = [];
    for (const secret of this.secrets.filter((s) => s.setup_only)) {
      rmSync(join(this.dir, secret.name), { force: true });
      erased.push(secret.name);
    }
    this.secrets = this.secrets.filter((s) => !s.setup_only);
    return erased;
  }

  /** At the end of the runner: nothing stays in memory-backed files. */
  wipeAll(): void {
    if (this.wiped) return;
    this.wiped = true;
    this.secrets = [];
    if (!existsSync(this.dir)) return;
    for (const name of readdirSync(this.dir)) rmSync(join(this.dir, name), { force: true });
    rmSync(this.dir, { recursive: true, force: true });
  }

  get count(): number {
    return this.secrets.length;
  }
}
