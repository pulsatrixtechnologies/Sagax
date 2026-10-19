// The real engines of a run: Sagax's own Claude Code and Codex drivers,
// created once per Pod and driven headless. Nothing here is engine code; it
// only picks the driver and the configuration that points it at Perspicax's
// model proxy (spec CA-10) with the run token as its key.
//
// Loaded with a dynamic import by sagax-runner.ts, after SAGAX_DATA_DIR is
// set: the drivers read it when their modules load.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { ApprovalMode } from "../../shared/approval-mode.ts";
import { EFFORT_LEVELS, type EffortLevel } from "../../shared/wire.ts";
import type { DriverCreateInput, ProviderInstance } from "../contracts.ts";
import type { EngineFactory, EngineFactoryInput, RunnerEngineHandle } from "./engine.ts";

/** The default approval level of a run (the bootstrap's approval_level
 * overrides it): the engine's own reviewer decides; what it still asks
 * becomes an `approval` event (spec 7.1). */
export const RUN_APPROVAL_MODE: ApprovalMode = "auto";

export interface DriverPlan {
  driver: "claude" | "codex";
  instanceId: string;
  config: Record<string, unknown>;
  environment: Record<string, string>;
  model: string | undefined;
  effort: EffortLevel | undefined;
}

/** The driver and its configuration for a run. Pure, for tests. */
export function driverPlan(input: EngineFactoryInput, options: { claudeCli?: string; codexCli?: string; codexDefaultModel?: string } = {}): DriverPlan {
  const effort = input.effort && (EFFORT_LEVELS as readonly string[]).includes(input.effort) ? input.effort as EffortLevel : undefined;
  const token = input.environment.ANTHROPIC_API_KEY ?? input.environment.OPENAI_API_KEY ?? "";
  if (input.engine === "claude-code") {
    return {
      driver: "claude",
      instanceId: "runner-claude",
      // The key is set on purpose in the instance environment, so the
      // driver keeps it (claudeEnvironment) and Claude Code talks to the
      // proxy at ANTHROPIC_BASE_URL.
      config: { cli: options.claudeCli ?? "claude", permissionMode: "acceptEdits" },
      environment: { ...input.environment, ANTHROPIC_API_KEY: token },
      model: input.model ?? undefined,
      effort,
    };
  }
  // Codex: the driver's Company provider is exactly "a Responses endpoint
  // and a key in the environment" (managedCodexArgs). Its endpoint is the
  // proxy's OpenAI base, its key the run token; nothing is stored by Codex
  // (cli_auth_credentials_store="ephemeral").
  const model = input.model ?? options.codexDefaultModel;
  if (!model) throw new Error("Codex a besoin d'un modèle pour ce run");
  const codexHome = join(input.stateDir, "codex");
  mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  return {
    driver: "codex",
    instanceId: "runner-codex",
    config: { cli: options.codexCli ?? "codex", fullAuto: false, managed: { url: input.environment.OPENAI_BASE_URL, models: [model] } },
    environment: { ...input.environment, SAGAX_COMPANY_API_KEY: token, CODEX_HOME: codexHome },
    model,
    effort,
  };
}

export function realEngineFactory(options: { claudeCli?: string; codexCli?: string } = {}): EngineFactory {
  return async (input) => {
    let codexDefaultModel: string | undefined;
    if (input.engine === "codex" && !input.model) {
      codexDefaultModel = (await import("../drivers/codex-catalog.ts")).STATIC_CODEX_MODELS.default;
    }
    const plan = driverPlan(input, { ...options, codexDefaultModel });
    const driver = plan.driver === "claude"
      ? (await import("../drivers/claude.ts")).ClaudeDriver
      : (await import("../drivers/codex.ts")).CodexDriver;
    const create: DriverCreateInput<unknown> = {
      instanceId: plan.instanceId,
      displayName: undefined,
      environment: plan.environment,
      enabled: true,
      config: driver.decodeConfig(plan.config),
    };
    const instance: ProviderInstance = await (driver.create as (input: DriverCreateInput<unknown>) => Promise<ProviderInstance>)(create);
    const handle: RunnerEngineHandle = {
      adapter: instance.adapter,
      turnDefaults: {
        cwd: input.cwd,
        model: plan.model,
        effort: plan.effort,
        approvalMode: input.approvalMode ?? RUN_APPROVAL_MODE,
      },
      dispose: async () => {
        await instance.adapter.stopAll().catch(() => undefined);
        await instance.dispose().catch(() => undefined);
      },
    };
    return handle;
  };
}
