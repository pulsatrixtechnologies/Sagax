// Organization server, per engine: a withheld turn (withholdHostTools) starts
// the CLI with the tool profile that leaves it no shell, file or web tool of
// its own on the Sagax server, in an empty folder Sagax owns, and a request
// to run a command there is declined before any card or Full-access
// auto-accept. The real CLIs are checked by scripts/verify-org-host-tools.ts
// (AGENTS.md "Engines on an organization server"); this pins the driver side
// against the scripted ACP peer.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { ensureDirs } from "../../config.ts";
import type { ProviderDriver, ProviderInstance } from "../../contracts.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import { recordEvents } from "../../testing/events.ts";
import {
  acpHostToolRequest, GEMINI_HOST_TOOLS, hermesOrgConfig, HERMES_HOST_TOOLSETS, KIMI_HOST_TOOLS, OPENCODE_HOST_PERMISSIONS, QWEN_HOST_TOOLS, QWEN_KEPT_TOOLS, sagaxMcpServerNames, withheldWorkspace,
} from "../host-tools.ts";
import type { AcpConfig } from "./core.ts";
import { GeminiAgentDriver } from "./gemini.ts";
import { HermesAgentDriver } from "./hermes.ts";
import { KimiAgentDriver } from "./kimi.ts";
import { createOpenCodeDriver } from "./opencode-go.ts";
import { QwenAgentDriver } from "./qwen.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "../../testing/fake-acp-cli.ts");
const OpenCodeDriver = createOpenCodeDriver(async () => ({
  default: "opencode/fixture-model",
  options: [{ id: "opencode/fixture-model", label: "Fixture model" }],
}));
const directories: string[] = [];
const instances: ProviderInstance[] = [];
afterEach(async () => {
  for (const instance of instances.splice(0)) await instance.dispose();
  for (const directory of directories.splice(0)) await removeTempDir(directory);
});

async function fixture(driver: ProviderDriver<AcpConfig>, environment: Record<string, string> = {}) {
  ensureDirs();
  const home = mkdtempSync(join(tmpdir(), "omb-org-host-tools-")); directories.push(home);
  const dump = join(home, "spawn.json"), answer = join(home, "permission.txt");
  const instance = await driver.create({
    instanceId: `org-${driver.driverKind}`, displayName: "Org fixture", enabled: true,
    config: { cli: FAKE_CLI, fullAuto: true },
    environment: {
      HOME: home, USERPROFILE: home, SAGAX_PROBE_LOCAL_INJECT: "0",
      FAKE_ACP_DUMP: dump, FAKE_ACP_PERMISSION_ANSWER: answer, OPENCODE_API_KEY: "fixture-only", ...environment,
    },
  });
  instances.push(instance);
  return { instance, home, dump, answer, recorder: recordEvents(instance.adapter) };
}

/** One turn; returns what the CLI was started with. */
async function turn(f: Awaited<ReturnType<typeof fixture>>, withholdHostTools: boolean, extra: Record<string, unknown> = {}) {
  const work = join(f.home, "work"); mkdirSync(work, { recursive: true });
  const { turnId } = await f.instance.adapter.sendTurn({
    threadId: `org-${withholdHostTools}`, cwd: work, text: "Fixture", approvalMode: "full",
    ...(withholdHostTools ? { withholdHostTools: true } : {}), ...extra,
  });
  await f.recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);
  return { ...JSON.parse(readFileSync(f.dump, "utf8")) as { argv: string[]; env: Record<string, string>; cwd: string }, work, turnId };
}

const real = (path: string) => realpathSync(path);

describe("organization server: each admitted ACP engine withholds its own tools", () => {
  it("Gemini CLI: an admin policy denying every host tool, no extension, only Sagax's MCP servers, an empty folder", async () => {
    const f = await fixture(GeminiAgentDriver);
    const solo = await turn(f, false);
    expect(solo.argv).not.toContain("--admin-policy");
    expect(real(solo.cwd)).toBe(real(solo.work));
    const org = await turn(f, true, { integrations: { custom: { notes: { command: "node", args: ["notes"], env: {} } } } });
    const policyPath = org.argv[org.argv.indexOf("--admin-policy") + 1]!;
    const policy = readFileSync(policyPath, "utf8");
    for (const tool of GEMINI_HOST_TOOLS) expect(policy).toContain(JSON.stringify(tool));
    expect(policy).toMatch(/decision = "deny"\npriority = 999/);
    expect(org.argv.slice(org.argv.indexOf("--extensions"), org.argv.indexOf("--extensions") + 2)).toEqual(["--extensions", "none"]);
    expect(org.argv.slice(org.argv.indexOf("--allowed-mcp-server-names"))).toEqual(["--allowed-mcp-server-names", "notes"]);
    expect(org.argv).toContain("--skip-trust");
    expect(real(org.cwd)).toBe(real(withheldWorkspace()));
  });

  it("Qwen Code: a core-tools allowlist, the host tools excluded, no background memory agent or hook", async () => {
    const f = await fixture(QwenAgentDriver);
    const org = await turn(f, true);
    const core = org.argv.slice(org.argv.indexOf("--core-tools") + 1, org.argv.indexOf("--exclude-tools"));
    expect(core).toEqual([...QWEN_KEPT_TOOLS]);
    expect(org.argv).toEqual(expect.arrayContaining([...QWEN_HOST_TOOLS]));
    expect(org.argv.slice(org.argv.indexOf("--allowed-mcp-server-names"))).toEqual(["--allowed-mcp-server-names", "sagax-none"]);
    const settings = JSON.parse(readFileSync(org.env.QWEN_CODE_SYSTEM_SETTINGS_PATH!, "utf8"));
    expect(settings.memory).toEqual({ enableManagedAutoMemory: false, enableManagedAutoDream: false, enableAutoSkill: false, enableTeamMemory: false });
    expect(settings.disableAllHooks).toBe(true);
    expect(settings.tools.core).toEqual([...QWEN_KEPT_TOOLS]);
    expect(real(org.cwd)).toBe(real(withheldWorkspace()));
  });

  it("Kimi Code: the default agent profile replaced by an allowlist of Sagax MCP tools and conversation state", async () => {
    const f = await fixture(KimiAgentDriver);
    const org = await turn(f, true);
    const profile = readFileSync(join(f.home, ".kimi-code", "agents", "agent.md"), "utf8");
    expect(profile).toMatch(/^---\nname: agent\n/);
    expect(profile).toContain("override: true");
    expect(profile).toMatch(/^tools: \[AskUserQuestion, .*mcp__\*\]$/m);
    for (const tool of KIMI_HOST_TOOLS) expect(profile.match(/^disallowedTools: \[(.*)\]$/m)![1]!.split(", ")).toContain(tool);
    expect(profile).toContain("${base_prompt}");
    expect(real(org.cwd)).toBe(real(withheldWorkspace()));
  });

  it("OpenCode: every host permission denied (a denied tool is not offered), no project configuration", async () => {
    const f = await fixture(OpenCodeDriver);
    const org = await turn(f, true);
    const permission = JSON.parse(org.env.OPENCODE_PERMISSION!);
    for (const key of OPENCODE_HOST_PERMISSIONS) expect(permission[key]).toBe("deny");
    expect(permission["*"]).toBe("allow");
    expect(org.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    expect(real(org.cwd)).toBe(real(withheldWorkspace()));
  });

  it("Hermes Agent: a home of Sagax's whose config enables no ACP toolset and disables every host one", async () => {
    const f = await fixture(HermesAgentDriver, {});
    mkdirSync(join(f.home, ".hermes"), { recursive: true });
    writeFileSync(join(f.home, ".hermes", "config.yaml"), [
      "model:", "  default: fixture", "  provider: custom",
      "mcp_servers:", "  ambient:", "    command: touch", "    args: [/tmp/never]",
      "hooks:", "  pre_tool_call:", "    - command: touch /tmp/never",
      "platform_toolsets:", "  acp: [hermes-acp]", "",
    ].join("\n"));
    writeFileSync(join(f.home, ".hermes", ".env"), "FIXTURE=1\n");
    const org = await turn(f, true);
    expect(org.env.HERMES_HOME).not.toBe(join(f.home, ".hermes"));
    const config = parseYaml(readFileSync(join(org.env.HERMES_HOME!, "config.yaml"), "utf8"));
    expect(config.platform_toolsets).toEqual({ acp: [] });
    expect(config.agent.disabled_toolsets).toEqual([...HERMES_HOST_TOOLSETS]);
    expect(config.mcp_servers).toBeUndefined();
    expect(config.hooks).toBeUndefined();
    expect(config.model).toEqual({ default: "fixture", provider: "custom" });
    expect(readFileSync(join(org.env.HERMES_HOME!, ".env"), "utf8")).toBe("FIXTURE=1\n");
    expect(real(org.cwd)).toBe(real(withheldWorkspace()));
  });

  it("refuses a Hermes configuration it cannot read rather than run it unchanged", () => {
    expect(() => hermesOrgConfig("model: [unclosed")).toThrow(/cannot be held back/);
  });

  it.each([
    ["Gemini CLI", GeminiAgentDriver],
    ["Qwen Code", QwenAgentDriver],
    ["Kimi Code", KimiAgentDriver],
    ["OpenCode", OpenCodeDriver],
    ["Hermes Agent", HermesAgentDriver],
  ] as const)("%s: a request to run a command on the server is declined, even in Full access", async (_name, driver) => {
    const f = await fixture(driver, { FAKE_ACP_MODE: "permission" });
    // no approvalMode with fullAuto: the path that accepts every request
    const org = await turn(f, true, { approvalMode: undefined });
    expect(readFileSync(f.answer, "utf8")).toBe("reject");
    expect(f.recorder.events.some((event) => event.type === "request.opened" && event.turnId === org.turnId)).toBe(false);
    // the same request on a solo turn in Full access is accepted, so the
    // refusal above is the organization rule and not the fixture
    await turn(f, false, { approvalMode: undefined });
    expect(readFileSync(f.answer, "utf8")).toBe("allow-once");
  });

  it("lets a call to one of Sagax's MCP tools through and declines commands, edits, moves and deletes", () => {
    expect(acpHostToolRequest({ kind: "execute", title: "echo hi" })).toBe(true);
    expect(acpHostToolRequest({ kind: "edit", title: "write notes.txt" })).toBe(true);
    expect(acpHostToolRequest({ kind: "delete", title: "rm" })).toBe(true);
    expect(acpHostToolRequest({ kind: "move", title: "mv" })).toBe(true);
    expect(acpHostToolRequest({ kind: "execute", title: "mcp__agents__list_bots" })).toBe(false);
    expect(acpHostToolRequest({ kind: "other", title: "anything" })).toBe(false);
    expect(acpHostToolRequest({ kind: "fetch", title: "mcp_notes_read" })).toBe(false);
  });

  it("names exactly the MCP servers Sagax passes a turn", () => {
    expect(sagaxMcpServerNames(undefined)).toEqual([]);
    expect(sagaxMcpServerNames({ agents: {}, browser: {}, custom: { notes: {}, agents: {} } })).toEqual(["agents", "browser", "notes"]);
  });
});
