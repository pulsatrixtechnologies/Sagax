// Shadow, enforce, lockout and the activity log. The classifier's cases
// live in shared/misuse-guardrails.test.ts. Nothing here boots the server.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { adminActivityFileFor, flushAdminActivity } from "./admin-activity.ts";
import {
  misuseGuardrailMode,
  misusePathRefusal,
  misuseRefusal,
  misuseToolFrameText,
  resetMisuseGuardrailsForTests,
  setMisuseAlert,
  setMisuseDataDirForTests,
} from "./misuse-guardrails.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { callUserSandboxTool, type ToolExec } from "./user-sandbox-tools.ts";
import {
  DEFAULT_EGRESS_DENY,
  DEFAULT_SANDBOX_LIMITS,
  sandboxContainerSpec,
  sandboxdConfigFromEnv,
  sandboxIsolationProblems,
  sandboxKeyForPrincipal,
} from "./user-sandbox-spec.ts";

const dirs: string[] = [];

afterEach(async () => {
  delete process.env.SAGAX_MISUSE_GUARDRAILS;
  resetMisuseGuardrailsForTests();
  for (const dir of dirs.splice(0)) await removeTempDir(dir);
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-misuse-"));
  dirs.push(dir);
  setMisuseDataDirForTests(dir);
  return dir;
}

const context = { triage: false, principalId: "pr_ada", surface: "message" as const, botId: "bot1", threadId: "thread1" };

async function rows(dir: string): Promise<Array<{ action: string; category: string; after?: { category?: string; excerpt?: string } }>> {
  await flushAdminActivity(dir);
  const file = adminActivityFileFor(dir, new Date());
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { action: string; category: string; after?: { category?: string; excerpt?: string } });
}

describe("mode", () => {
  it("defaults to shadow and ignores an unknown value", () => {
    delete process.env.SAGAX_MISUSE_GUARDRAILS;
    expect(misuseGuardrailMode()).toBe("shadow");
    expect(misuseGuardrailMode({ SAGAX_MISUSE_GUARDRAILS: "sometimes" })).toBe("shadow");
    expect(misuseGuardrailMode({ SAGAX_MISUSE_GUARDRAILS: "enforce" })).toBe("enforce");
    expect(misuseGuardrailMode({ SAGAX_MISUSE_GUARDRAILS: "off" })).toBe("off");
  });

  it("records a shadow row and does not refuse", async () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "shadow";
    const dir = tempDir();
    const alerts: string[] = [];
    setMisuseAlert((alert) => alerts.push(alert.message));
    expect(misuseRefusal("sudo -i", context, 1_000)).toBeNull();
    const written = await rows(dir);
    expect(written.map((row) => row.action)).toEqual(["misuse.shadow"]);
    expect(written[0]?.category).toBe("security");
    expect(written[0]?.after?.category).toBe("privilege_escalation");
    expect(alerts).toEqual([]);
  });

  it("refuses in enforce mode and alerts the tenant admin", () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "enforce";
    tempDir();
    const alerts: string[] = [];
    setMisuseAlert((alert) => alerts.push(alert.message));
    const refusal = misuseRefusal("sudo -i", context, 1_000);
    expect(refusal).toMatchObject({ status: 403, code: "misuse_blocked" });
    expect(refusal?.message).toContain("élévation de privilèges");
    expect(alerts).toEqual([refusal?.message]);
  });

  it("does nothing when the flag is off", async () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "off";
    const dir = tempDir();
    expect(misuseRefusal("sudo -i", context, 1_000)).toBeNull();
    await flushAdminActivity(dir);
    expect(() => readFileSync(adminActivityFileFor(dir, new Date()), "utf8")).toThrow();
  });
});

describe("lockout", () => {
  it("locks the fifth attempt for fifteen minutes and still allows an ordinary message", async () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "enforce";
    const dir = tempDir();
    const start = 1_700_000_000_000;
    for (let i = 0; i < 4; i += 1) {
      expect(misuseRefusal("nmap 203.0.113.10", context, start + i)?.code).toBe("misuse_blocked");
    }
    expect(misuseRefusal("nmap 203.0.113.10", context, start + 4)?.code).toBe("misuse_locked");
    expect(misuseRefusal("nmap 203.0.113.10", context, start + 5)?.status).toBe(429);
    expect(misuseRefusal("Résume mes courriels.", context, start + 6)).toBeNull();
    const written = await rows(dir);
    expect(written.filter((row) => row.action === "misuse.lockout").length).toBeGreaterThanOrEqual(1);
    expect(misuseRefusal("nmap 203.0.113.10", context, start + 4 + 15 * 60_000)?.code).toBe("misuse_blocked");
  });

  it("counts the same window in shadow without refusing", async () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "shadow";
    const dir = tempDir();
    const start = 1_700_000_000_000;
    for (let i = 0; i < 5; i += 1) expect(misuseRefusal("sudo -i", context, start + i)).toBeNull();
    const written = await rows(dir);
    expect(written.at(-1)?.action).toBe("misuse.lockout");
  });
});

describe("paths, frames and the command clock", () => {
  it("follows the mode for a platform path", () => {
    process.env.SAGAX_MISUSE_GUARDRAILS = "shadow";
    expect(misusePathRefusal("/proc/1/environ", context, 1_000)).toBeNull();
    process.env.SAGAX_MISUSE_GUARDRAILS = "enforce";
    expect(misusePathRefusal("/proc/1/environ", context, 2_000)?.code).toBe("misuse_blocked");
    expect(misusePathRefusal("/workspace/notes.txt", context, 3_000)).toBeNull();
  });

  it("classifies a tools/call and ignores other frames", () => {
    const frame = { message: { method: "tools/call", params: { name: "flow_action", arguments: { command: "printenv" } } } };
    expect(misuseToolFrameText(frame)).toContain("printenv");
    expect(misuseToolFrameText({ message: { method: "tools/list" } })).toBeNull();
  });

  it("stops a command at ten minutes", async () => {
    const calls: Array<{ timeoutSec?: number }> = [];
    const exec: ToolExec = {
      exec: async (input) => {
        calls.push(input);
        return { exitCode: 0, stdout: "", stderr: "", truncated: false, timedOut: false };
      },
      overQuota: async () => false,
    };
    await callUserSandboxTool("run_command", { command: "ls", timeout_seconds: 99_999 }, exec);
    expect(calls[0]?.timeoutSec).toBe(600);
  });
});

describe("sandbox hard limits", () => {
  it("keeps metadata and private networks unreachable, and masks host proc", () => {
    expect(DEFAULT_EGRESS_DENY).toContain("169.254.0.0/16");
    expect(DEFAULT_EGRESS_DENY).toEqual(expect.arrayContaining(["10.0.0.0/8", "127.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]));
    expect(DEFAULT_SANDBOX_LIMITS).toMatchObject({ memoryBytes: 1536 * 1024 * 1024, nanoCpus: 1_000_000_000, pidsLimit: 512 });
    const key = sandboxKeyForPrincipal("gox", "pr_00000000-0000-4000-8000-000000000001");
    const config = sandboxdConfigFromEnv({
      SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test",
      SAGAX_SANDBOX_INSTANCE: "gox",
    });
    const spec = sandboxContainerSpec(config, key) as { HostConfig: Record<string, unknown> };
    expect(sandboxIsolationProblems(spec, key)).toEqual([]);
    expect(spec.HostConfig.Memory).toBe(config.limits.memoryBytes);
    expect(spec.HostConfig.NanoCpus).toBe(config.limits.nanoCpus);
    expect(spec.HostConfig.PidsLimit).toBe(config.limits.pidsLimit);
    expect(spec.HostConfig.MaskedPaths).toEqual(expect.arrayContaining(["/proc/kcore", "/sys/firmware"]));
    expect(spec.HostConfig.ReadonlyPaths).toEqual(expect.arrayContaining(["/proc/sys", "/proc/sysrq-trigger"]));
    const ulimits = spec.HostConfig.Ulimits as Array<{ Name: string; Soft: number }>;
    expect(ulimits.find((limit) => limit.Name === "fsize")?.Soft).toBe(config.limits.maxFileBytes);
  });
});
