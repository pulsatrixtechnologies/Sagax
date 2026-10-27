// Proves, with the real Claude Code CLI on this machine, that an
// organization-server turn gives the engine no shell, file or fetch tool:
// the CLI starts with exactly the flags the driver adds
// (server/drivers/host-tools.ts) and its init event lists the tools the model
// can call. No model request is made: the API address is a closed local port
// and the configuration directory is a fresh temporary one.
//
//   node --experimental-strip-types scripts/smoke-host-tools.ts
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_ORG_TOOLS, claudeDisallowedTools, claudeOrgTools } from "../server/drivers/host-tools.ts";

const HOST_ACTING = ["Bash", "BashOutput", "KillShell", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Glob", "Grep", "LS", "WebFetch", "EnterWorktree", "ExitWorktree", "Workflow"];

/** Standing allow rules (SAGAX_CLAUDE_ALLOW): an allow never beats the
 * organization deny. */
const ORG_ALLOW = [
  "Bash(claude plugin marketplace add pulsatrixtechnologies/marketplace)",
  "Bash(claude plugin marketplace add example-org/marketplace)",
  "Bash(claude plugin marketplace add example-plugins/marketplace)",
];

async function initTools(withhold: boolean, allow: string[] = []): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "sagax-host-tools-"));
  const args = ["-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose", "--strict-mcp-config"];
  // the driver's flags (server/drivers/claude.ts): the allowlist, then the deny rules
  const orgTools = claudeOrgTools(undefined, withhold);
  if (orgTools !== null) args.push("--tools", orgTools);
  const denied = claudeDisallowedTools(undefined, withhold, orgTools !== null);
  if (denied.length) args.push("--disallowedTools", denied.join(","));
  if (allow.length) args.push("--allowedTools", allow.join(","));
  const child = spawn(process.env.CLAUDE_CLI ?? "claude", args, {
    cwd: dir,
    env: { PATH: process.env.PATH ?? "", HOME: dir, CLAUDE_CONFIG_DIR: join(dir, "cfg"), ANTHROPIC_BASE_URL: "http://127.0.0.1:9", ANTHROPIC_API_KEY: "sk-ant-smoke-not-a-key" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  child.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content: "Run `echo hi` with the Bash tool." } })}\n`);
  try {
    return await new Promise<string[]>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(new Error("no init event within 60 s")), 60_000);
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        for (const line of buffer.split("\n")) {
          try {
            const event = JSON.parse(line) as { type?: string; subtype?: string; tools?: string[] };
            if (event.type === "system" && event.subtype === "init") { clearTimeout(timer); resolve(event.tools ?? []); }
          } catch { /* partial line */ }
        }
      });
      child.on("exit", () => reject(new Error("the CLI exited before its init event")));
    });
  } finally {
    child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
}

const solo = await initTools(false);
const org = await initTools(true);
const orgWithAllow = await initTools(true, ORG_ALLOW);
let failed = 0;
const check = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };
check("control: a solo turn has Bash", solo.includes("Bash"));
const leaked = HOST_ACTING.filter((tool) => org.includes(tool));
check("organization turn: no shell, file or fetch tool on the Sagax server", leaked.length === 0, leaked.join(",") || `${org.length} tools left`);
check("organization turn: a Bash call cannot be made (tool absent)", !org.includes("Bash"));
const offList = org.filter((tool) => !tool.startsWith("mcp__") && !CLAUDE_ORG_TOOLS.includes(tool));
check("organization turn: every built-in left is on the allowlist (CLAUDE_ORG_TOOLS)", offList.length === 0, offList.join(",") || org.join(","));
check("organization turn with standing SAGAX_CLAUDE_ALLOW rules: Bash still absent (deny wins)", !orgWithAllow.includes("Bash"));
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
