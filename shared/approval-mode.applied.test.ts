// 2026-10-28 (one source of truth): what the selector shows is what the
// server applies. A conversation that runs a level other than its bot's
// setting says why; a stale exception nobody chose gives way at start-up,
// never narrowing a level.
import { describe, expect, it } from "vitest";

import { appliedLevelReason, botApprovalSetting, staleThreadException } from "./approval-mode";

describe("appliedLevelReason", () => {
  it("is absent when the conversation runs the bot's setting", () => {
    expect(appliedLevelReason("full", "full", {})).toBeUndefined();
  });

  it("names the conversation's own level first, after a pending grant", () => {
    expect(appliedLevelReason("full", "ask", { threadException: "engine", threadLevel: "ask" })).toBe("engine");
    expect(appliedLevelReason("full", "ask", { threadException: "thread", threadLevel: "ask" })).toBe("thread");
    expect(appliedLevelReason("full", "ask", { pending: true, threadException: "thread", threadLevel: "ask" })).toBe("pending");
  });

  it("names the owner's missing confirmation for Full, then the organization's policy", () => {
    expect(appliedLevelReason("full", "ask", { consentMissing: true })).toBe("consent");
    expect(appliedLevelReason("auto", "ask", { memberPolicy: true })).toBe("member-policy");
    expect(appliedLevelReason("full", "ask", { guest: true, consentMissing: true })).toBe("guest");
    expect(appliedLevelReason("full", "ask", { mail: true })).toBe("mail");
  });

  it("falls back to the engine when nothing else explains it", () => {
    expect(appliedLevelReason("full", "ask", {})).toBe("engine-unsupported");
  });
});

describe("staleThreadException", () => {
  it("lets an engine or unfinished-grant exception follow a wider bot setting the engine runs", () => {
    expect(staleThreadException({ exception: "engine", threadLevel: "ask", setting: "full", engineRunsSetting: true })).toBe(true);
    expect(staleThreadException({ exception: "safety", threadLevel: "ask", setting: "full", engineRunsSetting: true })).toBe(true);
  });

  it("keeps the person's own choice, a Primary Bot's handoff, an engine that cannot run it, and never narrows", () => {
    expect(staleThreadException({ exception: "thread", threadLevel: "ask", setting: "full", engineRunsSetting: true })).toBe(false);
    expect(staleThreadException({ exception: "delegated", threadLevel: "ask", setting: "full", engineRunsSetting: true })).toBe(false);
    expect(staleThreadException({ exception: "engine", threadLevel: "ask", setting: "full", engineRunsSetting: false })).toBe(false);
    expect(staleThreadException({ exception: "engine", threadLevel: "full", setting: "ask", engineRunsSetting: true })).toBe(false);
    expect(staleThreadException({ exception: "engine", threadLevel: "ask", setting: "custom", engineRunsSetting: true })).toBe(false);
  });
});

describe("botApprovalSetting", () => {
  it("reads the bot's own setting, never the open conversation's level", () => {
    expect(botApprovalSetting({ approvalSetting: "full", approvalMode: "ask" })).toBe("full");
    expect(botApprovalSetting({ approvalMode: "auto" })).toBe("auto");
    expect(botApprovalSetting({ approvalSetting: "nonsense", autoApprove: true })).toBe("auto");
  });
});
