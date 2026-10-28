// Bring-your-own engine: any agent CLI that speaks ACP over stdio plugs in
// as an instance of this driver — no code, one config entry:
//
//   { "instances": { "my-agent": {
//       "driver": "customAcp",
//       "displayName": "My Agent",
//       "config": { "cli": "my-agent acp" } } } }
//
// The `cli` string carries the whole command (wrapper strings resolve via
// splitCliString, so "npx -y some-agent acp" works too). There is no auth
// story on purpose: the user's CLI is expected to be signed in from a
// terminal already, exactly like the qwen harness. Each bot picks a model
// and a thinking level from this agent's config. They ride the session,
// not argv, because -m conventions differ per CLI.
import { isEffortLevel, type EffortLevel } from "../../../shared/wire.ts";
import { createAcpDriver, type AcpConfig, type AcpSupport } from "./core.ts";

const PASSTHROUGH = { default: "agent-default", options: [{ id: "agent-default", label: "Agent default" }] };

function customCatalog(raw: unknown): AcpConfig["models"] | undefined {
  const models = raw && typeof raw === "object" ? (raw as { models?: unknown }).models : undefined;
  if (!Array.isArray(models)) return undefined;
  const options = models.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const id = typeof (row as { id?: unknown }).id === "string" ? (row as { id: string }).id.trim() : "";
    if (!id) return [];
    const labelRaw = (row as { label?: unknown }).label;
    const label = typeof labelRaw === "string" && labelRaw.trim() ? labelRaw.trim() : id;
    return [{ id, label }];
  });
  return options.length ? { default: options[0]!.id, options } : undefined;
}

function customEffort(raw: unknown): EffortLevel[] | undefined {
  const levels = raw && typeof raw === "object" ? (raw as { effortLevels?: unknown }).effortLevels : undefined;
  if (!Array.isArray(levels)) return undefined;
  const kept = levels.filter((level): level is EffortLevel => isEffortLevel(level));
  return kept.length ? kept : undefined;
}

const CONFIGURE_HINT =
  'a custom ACP engine needs its command — add "config": { "cli": "<your-agent> acp" } to this instance in config.json, or use Settings → Engines → Set CLI…';

const support: AcpSupport = {
  driverKind: "customAcp",
  displayName: "Custom (ACP)",
  access: "custom",
  // One passthrough id: the agent runs whatever it is configured for.
  // Advertising a made-up catalog would promise switching we cannot do.
  models: PASSTHROUGH,
  defaultCli: "",
  nativeSource: "custom.acp",
  loginNote: CONFIGURE_HINT,
  // Mode-entering args ride the cli string itself ("fx acp"), so nothing
  // extra here.
  spawnArgs: () => [],
  pickAuthMethod: () => null,
  authFailure: "continue",
  isAuthenticated: () => true,
  resolveModelsOnCreate: false,
  resolveModels(_env, config) {
    return config.models ?? PASSTHROUGH;
  },
  async configureSession(ctx) {
    const model = ctx.turn.model;
    if (model && model !== "agent-default" && model !== ctx.currentModelId) {
      await ctx.request("session/set_model", { sessionId: ctx.sessionId, modelId: model });
    }
    const effort = ctx.turn.effort;
    if (!effort) return;
    const option = ctx.configOptions.find((entry) => entry.id === "effort" || entry.id === "thought_level");
    if (typeof option?.id !== "string" || option.currentValue === effort) return;
    await ctx.request("session/set_config_option", { sessionId: ctx.sessionId, configId: option.id, value: effort });
  },
};

const base = createAcpDriver(support);

export const CustomAcpDriver: typeof base = {
  ...base,
  // decodeAcpConfig never throws (a missing cli falls back to defaultCli,
  // which is empty here). Turn every blank-command path into the same
  // teaching shadow row instead of a bare spawn ENOENT at first send.
  decodeConfig(raw) {
    const decoded = base.decodeConfig(raw);
    if (!decoded.cli.trim()) throw new Error(CONFIGURE_HINT);
    const models = customCatalog(raw);
    const effortLevels = customEffort(raw);
    return { ...decoded, ...(models ? { models } : {}), ...(effortLevels ? { effortLevels } : {}) };
  },
  async create(input) {
    if (!input.config.cli.trim()) throw new Error(CONFIGURE_HINT);
    const instance = await base.create(input);
    await instance.refreshModels?.();
    if (input.config.effortLevels?.length) instance.adapter.capabilities.effortLevels = [...input.config.effortLevels];
    return instance;
  },
};
