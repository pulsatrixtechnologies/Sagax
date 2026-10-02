// Proves, with the real Claude Code CLI (and Codex when installed) on this
// machine, that the engine lists its slash commands the way a bot's turn
// would load them, without a model call: no user message is sent, the API
// address is a closed local port, and the folder is a fresh temporary one
// with one project command and one project skill.
//
//   node --experimental-strip-types scripts/smoke-harness-commands.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { probeClaudeCommands, probeCodexSkills } from "../server/drivers/harness-command-probe.ts";
import { resolveTypedCommand } from "../shared/harness-commands.ts";

function check(ok: boolean, label: string): void {
  console.log(`${ok ? "ok" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
}

const dir = mkdtempSync(join(tmpdir(), "sagax-harness-commands-"));
try {
  mkdirSync(join(dir, ".claude", "commands"), { recursive: true });
  writeFileSync(join(dir, ".claude", "commands", "deploy-notes.md"), "---\ndescription: Write deploy notes\nargument-hint: <version>\n---\nWrite deploy notes for $ARGUMENTS.\n");
  mkdirSync(join(dir, ".claude", "skills", "release-check"), { recursive: true });
  writeFileSync(join(dir, ".claude", "skills", "release-check", "SKILL.md"), "---\nname: release-check\ndescription: Check a release before it ships\n---\nCheck the release.\n");
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  };
  const started = Date.now();
  const claude = await probeClaudeCommands({ cli: process.env.CLAUDE_CLI ?? "claude", args: ["--strict-mcp-config", "--setting-sources", "project"], env, cwd: dir });
  console.log(`claude listed ${claude.length} commands in ${Date.now() - started} ms`);
  const named = (name: string) => claude.find((command) => command.name === name);
  check(Boolean(named("compact")) && !named("compact")?.unavailable, "built-in /compact is listed and runnable");
  check(named("deploy-notes")?.argumentHint === "<version>", "project command /deploy-notes is listed with its hint");
  check(Boolean(named("release-check")), "project skill /release-check is listed");
  check(named("model")?.unavailable === "managed", "/model is listed as managed by Sagax");
  check(!claude.some((command) => command.name.startsWith("__")), "hidden commands are left out");
  check(resolveTypedCommand("/deploy-notes 1.2.0", claude).kind === "engine", "a typed project command passes through");

  if (process.env.SMOKE_CODEX !== "0") {
    try {
      const codex = await probeCodexSkills({ cli: process.env.CODEX_CLI ?? "codex", args: ["app-server"], env: process.env, cwd: dir, clientVersion: "smoke" });
      console.log(`codex listed ${codex.length} skills`);
      check(codex.every((command) => Boolean(command.path)), "every Codex skill carries its file");
    } catch (error) {
      console.log(`skip  codex: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
