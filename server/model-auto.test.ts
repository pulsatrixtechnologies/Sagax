import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CLASS_TIER,
  TIER_TABLE,
  attachmentsInText,
  bareModelId,
  classifyTask,
  concrete,
  explainPick,
  familyOfModel,
  isModelRefusal,
  modelForTier,
  nextInChain,
  orderEngines,
  pickOrchestrationModel,
  pickWorkerModel,
  type AutoEngine,
  type CatalogFacts,
  type CatalogLookup,
} from "./model-auto.ts";
import { unpackCatalog } from "./model-catalog/trim.ts";

// A small fixture catalogue: what models.dev says, by bare id.
const FACTS: Record<string, CatalogFacts> = {
  "claude-opus-5-5": { name: "Claude Opus 5.5", reasoning: true, vision: true, context: 1_000_000, costInput: 4, costOutput: 20, releaseDate: "2026-09-22" },
  "claude-opus-5": { name: "Claude Opus 5", reasoning: true, vision: true, context: 1_000_000, costInput: 5, costOutput: 25, releaseDate: "2026-07-24" },
  "claude-fable-5-1": { name: "Claude Fable 5.1", reasoning: true, vision: true, context: 1_000_000, costInput: 10, costOutput: 50, releaseDate: "2026-09-01" },
  "claude-sonnet-5-5": { name: "Claude Sonnet 5.5", reasoning: true, vision: true, context: 1_000_000, costInput: 2, costOutput: 10, releaseDate: "2026-09-28" },
  "claude-sonnet-5": { name: "Claude Sonnet 5", reasoning: true, vision: true, context: 1_000_000, costInput: 2, costOutput: 10, releaseDate: "2026-06-30" },
  "claude-haiku-4-5": { name: "Claude Haiku 4.5", reasoning: true, vision: true, context: 200_000, costInput: 1, costOutput: 5, releaseDate: "2025-10-16" },
  "gpt-6-astra": { name: "GPT-6 Astra", reasoning: true, vision: true, context: 1_050_000, costInput: 10, costOutput: 50, releaseDate: "2026-09-04" },
  "gpt-6-sol": { name: "GPT-6 Sol", reasoning: true, vision: true, context: 1_050_000, costInput: 2, costOutput: 10, releaseDate: "2026-09-22" },
  "gpt-5.6-sol": { name: "GPT-5.6 Sol", reasoning: true, vision: true, context: 1_050_000, costInput: 5, costOutput: 30, releaseDate: "2026-07-09" },
  "gpt-5.6-luna": { name: "GPT-5.6 Luna", reasoning: true, vision: true, context: 1_050_000, costInput: 0.2, costOutput: 1.2, releaseDate: "2026-07-09" },
  "gpt-5.5-codex": { name: "GPT-5.5 Codex", reasoning: true, vision: false, context: 400_000, costInput: 1.25, costOutput: 10, releaseDate: "2026-05-01" },
  "grok-4.7": { name: "Grok 4.7", reasoning: true, vision: true, context: 500_000, costInput: 2, costOutput: 6, releaseDate: "2026-09-21" },
  "grok-4-fast": { name: "Grok 4 Fast", reasoning: true, vision: true, context: 2_000_000, costInput: 0.2, costOutput: 0.5, releaseDate: "2025-09-23" },
  "local-big": { name: "Local Big", reasoning: true, vision: false, context: 128_000, costInput: 0, costOutput: 0 },
  "local-small": { name: "Local Small", reasoning: false, vision: false, context: 32_000 },
};
const catalog: CatalogLookup = (_driver, id) => FACTS[bareModelId(id)];

const claude: AutoEngine = {
  instanceId: "claude",
  driverKind: "claudeAgent",
  displayName: "Claude Code",
  via: "subscription",
  effortLevels: ["low", "medium", "high"],
  models: {
    default: "claude-sonnet-5",
    options: [
      { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-opus-5", label: "Claude Opus 5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
      { id: "claude-unlisted-9", label: "Not in the catalogue" },
    ],
  },
};
const codex: AutoEngine = {
  instanceId: "codex",
  driverKind: "codex",
  displayName: "Codex",
  via: "speaker-key",
  models: {
    default: "gpt-5.6-sol",
    options: [
      { id: "gpt-6-astra", label: "GPT-6 Astra" },
      { id: "gpt-6-sol", label: "GPT-6 Sol" },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
      { id: "gpt-5.5-codex", label: "GPT-5.5 Codex" },
    ],
  },
};
const grok: AutoEngine = {
  instanceId: "grok-build",
  driverKind: "grokAgent",
  displayName: "Grok Build",
  via: "org-key",
  models: { default: "grok-4.7", options: [{ id: "grok-4.7", label: "Grok 4.7" }, { id: "grok-4-fast", label: "Grok 4 Fast" }] },
};
const local: AutoEngine = {
  instanceId: "ollama",
  driverKind: "openai-compat",
  displayName: "Ollama",
  models: { default: "local-small", options: [{ id: "local-big", label: "Local Big" }, { id: "local-small", label: "Local Small" }] },
};

const claudeBase = { instanceId: "claude", model: "claude-sonnet-5", effort: "high" as const, auto: true as const };
const codexBase = { instanceId: "codex", model: "gpt-5.6-sol", auto: true as const };

describe("classifyTask", () => {
  const cases: Array<[string, Parameters<typeof classifyTask>[0], string]> = [
    ["an attached image", { text: 'What is wrong here? <attached-image path="/a/shot.png" name="shot.png" />' }, "vision"],
    ["an image by file name", { text: "check this", attachments: [{ kind: "file", name: "mockup.PNG" }] }, "vision"],
    ["a huge paste", { text: "x ".repeat(40_000) }, "large-context"],
    ["big attachments", { text: "go through these", attachments: [{ kind: "file", name: "a.pdf", bytes: 900_000 }] }, "large-context"],
    ["many files", { text: "compare", attachments: Array.from({ length: 5 }, (_, i) => ({ kind: "file" as const, name: `f${i}.txt` })) }, "large-context"],
    ["a summary", { text: "Summarize the quarterly report and list the three risks it names for the board." }, "long-reading"],
    ["a summary in French", { text: "Résume ce rapport en cinq points pour la direction, s'il te plaît." }, "long-reading"],
    ["a document attachment", { text: "what does it say?", attachments: [{ kind: "file", name: "contract.pdf" }] }, "long-reading"],
    ["a refactor", { text: "Refactor the session store so the tests stop flaking, then fix the bug in server/store.ts." }, "coding"],
    ["a code fence", { text: "Why does this fail?\n```ts\nconst a: number = 'x';\n```" }, "coding"],
    ["a bug in French", { text: "Corrige le bogue dans la fonction de facturation et ajoute des tests unitaires." }, "coding"],
    ["a plan", { text: "Design the architecture for the new billing flow and weigh the trade-offs of each option before we decide." }, "reasoning"],
    ["a plan in French", { text: "Planifie la feuille de route du trimestre et évalue les compromis." }, "reasoning"],
    ["tool-heavy work", { text: "Sync the tickets from ConnectWise, export them, then upload the backup to the shared drive." }, "automation"],
    ["a lookup", { text: "Translate this line to Spanish." }, "quick"],
    ["a short message with no signal", { text: "hello there" }, "quick"],
    ["a long message with no signal", { text: "We talked about many things yesterday at the meeting and ".repeat(8) }, "general"],
  ];
  it.each(cases)("%s", (_name, input, expected) => {
    expect(classifyTask(input).taskClass).toBe(expected);
  });

  it("lets the bot's role break a tie", () => {
    expect(classifyTask({ text: "Take care of the thing we discussed this morning with the whole team, carefully and completely, please. ".repeat(3), role: "Senior software engineer" }).taskClass).toBe("coding");
    expect(classifyTask({ text: "Take care of the thing we discussed this morning with the whole team, carefully and completely, please. ".repeat(3), role: "Research analyst" }).taskClass).toBe("long-reading");
  });

  it("is deterministic and names its signals", () => {
    const input = { text: "Refactor the parser and fix the failing test" };
    expect(classifyTask(input)).toEqual(classifyTask(input));
    expect(classifyTask(input).signals).toContain("coding words");
  });

  it("does not count a word inside another word", () => {
    expect(classifyTask({ text: "Give me the latest explanation of the contest results in our newsletter please, the full one ".repeat(4) }).taskClass).not.toBe("coding");
  });
});

describe("attachmentsInText", () => {
  it("reads image and file tags and removes them", () => {
    const parsed = attachmentsInText('see <attached-image path="/x/a.png" name="a.png" /> and <attached-file path="/x/b.pdf" name="b.pdf" />');
    expect(parsed.attachments).toEqual([{ kind: "image", name: "a.png", path: "/x/a.png" }, { kind: "file", name: "b.pdf", path: "/x/b.pdf" }]);
    expect(parsed.text).not.toContain("attached");
  });
});

describe("the tier table", () => {
  it("maps every class to a tier the table defines", () => {
    for (const tier of Object.values(CLASS_TIER)) {
      for (const family of Object.values(TIER_TABLE)) expect(family[tier].length).toBeGreaterThan(0);
    }
  });

  it("names patterns, never model ids", () => {
    for (const family of Object.values(TIER_TABLE)) {
      for (const patterns of Object.values(family)) {
        for (const pattern of patterns) expect(pattern).toBeInstanceOf(RegExp);
      }
    }
  });

  it("knows each engine family", () => {
    expect(familyOfModel("claudeAgent", "anything")).toBe("anthropic");
    expect(familyOfModel("piAgent", "anthropic/claude-opus-5")).toBe("anthropic");
    expect(familyOfModel("piAgent", "openai/gpt-6-sol")).toBe("openai");
    expect(familyOfModel("piAgent", "kimi-code/k3")).toBe("moonshot");
    expect(familyOfModel("openai-compat", "llama-4")).toBeNull();
  });
});

describe("modelForTier", () => {
  it("picks per tier on Claude", () => {
    expect(modelForTier(claude, "top", catalog)?.id).toBe("claude-opus-5-5");
    expect(modelForTier(claude, "coding", catalog)?.id).toBe("claude-sonnet-5-5");
    expect(modelForTier(claude, "fast", catalog)?.id).toBe("claude-haiku-4-5");
    expect(modelForTier(claude, "vision", catalog)?.id).toBe("claude-sonnet-5-5");
  });

  it("picks per tier on Codex", () => {
    expect(modelForTier(codex, "top", catalog)?.id).toBe("gpt-6-astra");
    expect(modelForTier(codex, "coding", catalog)?.id).toBe("gpt-5.5-codex");
    expect(modelForTier(codex, "fast", catalog)?.id).toBe("gpt-5.6-luna");
    // the codex model has no image input in the catalogue
    expect(modelForTier(codex, "vision", catalog)?.id).toBe("gpt-6-sol");
  });

  it("takes the largest context for long work", () => {
    expect(modelForTier(grok, "long", catalog)?.id).toBe("grok-4-fast");
  });

  it("falls back on catalogue facts for an unknown family", () => {
    expect(modelForTier(local, "top", catalog)?.id).toBe("local-big");
    expect(modelForTier(local, "fast", catalog)?.id).toBe("local-small");
    expect(modelForTier(local, "vision", catalog)).toBeNull();
  });

  it("never picks a model the catalogue does not list", () => {
    const onlyUnknown: AutoEngine = { ...claude, models: { default: "x", options: [{ id: "claude-unlisted-9", label: "?" }] } };
    expect(modelForTier(onlyUnknown, "top", catalog)).toBeNull();
  });

  it("skips a refused model", () => {
    expect(modelForTier(claude, "top", catalog, [{ instanceId: "claude", model: "claude-opus-5-5" }])?.id).toBe("claude-opus-5");
  });
});

describe("pickOrchestrationModel", () => {
  it("takes the strongest model on the bot's own engine and keeps its effort", () => {
    const pick = pickOrchestrationModel({ base: claudeBase, engines: [codex, grok, claude], catalog });
    expect(pick.selection).toEqual({ instanceId: "claude", model: "claude-opus-5-5", effort: "high" });
    expect(pick.reason).toBe("strongest-own");
    expect(pick.role).toBe("orchestration");
    expect(explainPick(pick)).toBe("Auto: Claude Opus 5.5 for this bot, because it is the strongest general model your subscription can run on Claude Code, the engine this bot runs on.");
  });

  it("moves to the next engine the payer can use when the bot's own is not", () => {
    const pick = pickOrchestrationModel({ base: claudeBase, engines: [grok, codex], catalog });
    expect(pick.selection).toEqual({ instanceId: "codex", model: "gpt-6-astra" });
    expect(pick.reason).toBe("strongest-other");
    expect(explainPick(pick)).toContain("the next engine your own key can pay for");
  });

  it("falls back on the base model when nothing is usable", () => {
    const pick = pickOrchestrationModel({ base: claudeBase, engines: [], catalog });
    expect(pick.reason).toBe("base");
    expect(pick.selection).toEqual({ instanceId: "claude", model: "claude-sonnet-5", effort: "high" });
    expect(pick.selection.auto).toBeUndefined();
  });

  it("is deterministic whatever the engine order", () => {
    const one = pickOrchestrationModel({ base: codexBase, engines: [claude, codex, grok], catalog });
    const two = pickOrchestrationModel({ base: codexBase, engines: [grok, codex, claude], catalog });
    expect(one).toEqual(two);
    expect(one.selection.model).toBe("gpt-6-astra");
  });
});

describe("pickWorkerModel", () => {
  it("gives coding to the strong coding model on the bot's engine", () => {
    const pick = pickWorkerModel({ base: codexBase, engines: [claude, codex], catalog, task: { text: "Refactor the parser and fix the failing unit tests" } });
    expect(pick.selection).toEqual({ instanceId: "codex", model: "gpt-5.5-codex" });
    expect(pick.taskClass).toBe("coding");
    expect(explainPick(pick)).toBe("Auto: worker Codex · GPT-5.5 Codex (coding), the coding tier your own key can pay for.");
  });

  it("sends cheap tasks to cheap models", () => {
    const pick = pickWorkerModel({ base: claudeBase, engines: [claude], catalog, task: { text: "Translate this line to Spanish." } });
    expect(pick.selection.model).toBe("claude-haiku-4-5");
    expect(pick.tier).toBe("fast");
  });

  it("sends deep reasoning to the top tier", () => {
    const pick = pickWorkerModel({ base: claudeBase, engines: [claude], catalog, task: { text: "Plan the migration strategy and weigh the trade-offs" } });
    expect(pick.selection.model).toBe("claude-opus-5-5");
  });

  it("uses the target's role", () => {
    const pick = pickWorkerModel({ base: claudeBase, engines: [claude], catalog, task: { text: "Please handle what Marie asked for in this morning's meeting, all of it, end to end, and tell me when it is finished. ".repeat(3), role: "Software engineer" } });
    expect(pick.taskClass).toBe("coding");
  });

  it("climbs to the next tier when no engine has the tier", () => {
    const pick = pickWorkerModel({ base: { instanceId: "ollama", model: "local-small", auto: true }, engines: [local], catalog, task: { text: 'what is this? <attached-image path="/a.png" name="a.png" />' } });
    expect(pick.taskClass).toBe("vision");
    expect(pick.reason).toBe("tier-fallback");
    expect(pick.selection.model).toBe("local-big");
  });

  it("keeps a chain of fallbacks that ends on the base model", () => {
    const pick = pickWorkerModel({ base: claudeBase, engines: [claude, codex, grok], catalog, task: { text: "Fix the bug in the parser" } });
    expect(pick.chain[0]).toEqual({ instanceId: "claude", model: "claude-sonnet-5-5" });
    expect(pick.chain.length).toBeLessThanOrEqual(4);
    expect(pick.chain.at(-1)).toEqual({ instanceId: "claude", model: "claude-sonnet-5" });
    expect(nextInChain(pick, pick.chain[0]!)).toEqual(pick.chain[1]);
    expect(nextInChain(pick, pick.chain.at(-1)!)).toBeNull();
  });

  it("never picks an engine the payer cannot use (only what is passed)", () => {
    const pick = pickWorkerModel({ base: claudeBase, engines: [grok], catalog, task: { text: "Refactor the parser" } });
    expect(pick.selection.instanceId).toBe("grok-build");
    expect(pick.chain.every((entry) => entry.instanceId === "grok-build")).toBe(true);
  });
});

describe("helpers", () => {
  it("orders engines own first, then the fixed order, then by id", () => {
    expect(orderEngines([local, grok, codex, claude], "ollama").map((engine) => engine.instanceId)).toEqual(["ollama", "claude", "codex", "grok-build"]);
  });

  it("recognizes an engine refusing a model, and nothing else", () => {
    expect(isModelRefusal("This model is not available to the selected ChatGPT plan.")).toBe(true);
    expect(isModelRefusal("Grok could not confirm the selected model")).toBe(false);
    expect(isModelRefusal("the selected model could not confirm access")).toBe(true);
    expect(isModelRefusal("400 invalid_request: model 'gpt-9' does not exist")).toBe(true);
    expect(isModelRefusal("rate limit reached, try again later")).toBe(false);
  });

  it("drops the Auto flag from a concrete selection", () => {
    expect(concrete({ instanceId: "a", model: "b", auto: true })).toEqual({ instanceId: "a", model: "b" });
  });
});

describe("with the shipped catalogue and the drivers' own model lists", () => {
  const snapshot = JSON.parse(readFileSync(join(import.meta.dirname, "model-catalog", "models-dev.snapshot.json"), "utf8")) as { providers: unknown };
  const providers = unpackCatalog(snapshot.providers) as Record<string, { models: Record<string, { name: string; reasoning: boolean; modalities: { input: string[] }; limit?: { context: number }; cost?: { input?: number; output?: number }; release_date?: string }> }>;
  const real: CatalogLookup = (driver, id) => {
    const provider = { claudeAgent: "anthropic", codex: "openai", grokAgent: "xai" }[driver];
    const row = provider ? providers[provider]?.models[bareModelId(id)] : undefined;
    return row ? { name: row.name, reasoning: row.reasoning, vision: row.modalities.input.includes("image"), context: row.limit?.context, costInput: row.cost?.input, costOutput: row.cost?.output, releaseDate: row.release_date } : undefined;
  };
  const claudeReal: AutoEngine = { ...claude, models: { default: "claude-sonnet-5", options: claude.models.options.filter((option) => option.id !== "claude-unlisted-9") } };

  it("picks Claude Opus 5.5 to orchestrate a Claude bot", () => {
    expect(pickOrchestrationModel({ base: claudeBase, engines: [claudeReal], catalog: real }).modelLabel).toBe("Claude Opus 5.5");
  });

  it("picks Haiku for a quick task", () => {
    expect(pickWorkerModel({ base: claudeBase, engines: [claudeReal], catalog: real, task: { text: "rename these files" } }).selection.model).toBe("claude-haiku-4-5");
  });
});
