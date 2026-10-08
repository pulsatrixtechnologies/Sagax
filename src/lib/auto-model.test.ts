import { afterEach, describe, expect, it } from "vitest";

import { autoChipLabel, autoReasonSentence, autoTaskClassLabel, autoWorkerLine } from "./auto-model";
import { setLocale } from "./i18n";
import { statusActivity } from "./activity-runs";
import { AUTO_TASK_CLASSES, type AutoModelRecord } from "../../shared/auto-model";
import type { Message } from "@/state/store";

afterEach(() => { setLocale("en"); });

const orchestration: AutoModelRecord = {
  instanceId: "claude", model: "claude-fable-5-1", engineLabel: "Claude Code", modelLabel: "Claude Fable 5.1",
  role: "orchestration", tier: "top", reason: "strongest-own", via: "subscription", at: 1,
};
const worker: AutoModelRecord = {
  instanceId: "codex", model: "gpt-5.5-codex", engineLabel: "Codex", modelLabel: "GPT-5.5 Codex",
  role: "worker", tier: "coding", taskClass: "coding", reason: "strongest-other", via: "speaker-key", fromEngineLabel: "Claude Code", at: 1,
};

describe("Auto words", () => {
  it("labels the chip", () => {
    expect(autoChipLabel(orchestration)).toBe("Auto · Claude Fable 5.1");
    expect(autoChipLabel(null)).toBe("Auto");
  });

  it("says why in one sentence, per reason and payer", () => {
    expect(autoReasonSentence(orchestration)).toBe("Auto: Claude Fable 5.1 for this bot, because it is the strongest general model your subscription can run on Claude Code, the engine this bot runs on.");
    expect(autoReasonSentence({ ...orchestration, reason: "strongest-other", engineLabel: "Codex", fromEngineLabel: "Claude Code", via: "org-key" }))
      .toBe("Auto: Claude Fable 5.1 for this bot, because Claude Code is not available for this turn and Codex is the next engine the organization's key can pay for.");
    expect(autoReasonSentence({ ...orchestration, reason: "base", via: undefined })).toContain("no other model is available");
  });

  it("names a worker's model and class", () => {
    expect(autoWorkerLine(worker)).toBe("Auto: worker Codex · GPT-5.5 Codex (coding)");
    expect(autoReasonSentence(worker)).toBe(autoWorkerLine(worker));
  });

  it("has a label for every class, in French too", () => {
    for (const cls of AUTO_TASK_CLASSES) expect(autoTaskClassLabel(cls)).not.toMatch(/^model\.auto/);
    setLocale("fr");
    expect(autoWorkerLine(worker)).toBe("Auto : exécutant Codex · GPT-5.5 Codex (code)");
    setLocale("pt-BR");
    expect(autoTaskClassLabel("quick")).toBe("tarefa rápida");
  });

  it("draws the worker's activity row in the person's language", () => {
    const row = { id: "m", at: 1, role: "bot", kind: "activity", autoModel: worker,
      tool: { name: "notice: Auto: worker Codex · GPT-5.5 Codex (coding), the coding tier your own key can pay for.", ok: true } } as unknown as Message;
    setLocale("fr");
    expect(statusActivity(row)).toEqual({ kind: "notice", text: "Auto : exécutant Codex · GPT-5.5 Codex (code)" });
  });
});
