// Engine access on an organization server (slice 3, D13), the whole matrix.
import { describe, expect, it } from "vitest";

import { driverKeyBacked, type AppConfig } from "./config.ts";
import { accessCardForViewer, adminApprovalDecision, engineAccessFor, engineAccessNotice, keyRefusedCard, memberOwnedBot, serverCommandApproval, type EngineAccessInput } from "./engine-access.ts";

const ALICE = "pr_aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "pr_bbbbbbbb-0000-4000-8000-000000000002";

const base: EngineAccessInput = {
  identity: "perspicax",
  speakerPrincipalId: ALICE,
  ownerPrincipalId: ALICE,
  ownerOrgRole: "admin",
  memberBotsUseOrgKey: false,
  driver: "claudeAgent",
  keyBacked: false,
  installed: true,
};

describe("engineAccessFor", () => {
  it("solo mode is unchanged, whatever the rest says", () => {
    expect(engineAccessFor({ ...base, identity: "solo", installed: false, speakerPrincipalId: BOB, ownerOrgRole: "member" })).toEqual({ ok: true, via: "server" });
  });

  it("an admin owner speaking to their own bot uses the server's access, key or login", () => {
    expect(engineAccessFor(base)).toEqual({ ok: true, via: "server" });
    expect(engineAccessFor({ ...base, driver: "codex" })).toEqual({ ok: true, via: "server" });
    // no named speaker (a routine, a peer hop): the owner's own turn
    expect(engineAccessFor({ ...base, speakerPrincipalId: undefined, driver: "grokAgent" })).toEqual({ ok: true, via: "server" });
  });

  it("someone else on an admin's bot needs the org key toggle AND a key-backed instance", () => {
    const bob = { ...base, speakerPrincipalId: BOB };
    expect(engineAccessFor(bob)).toEqual({ ok: false, reason: "no_access" });
    expect(engineAccessFor({ ...bob, keyBacked: true })).toEqual({ ok: false, reason: "no_access" });
    expect(engineAccessFor({ ...bob, memberBotsUseOrgKey: true })).toEqual({ ok: false, reason: "no_access" });
    expect(engineAccessFor({ ...bob, memberBotsUseOrgKey: true, keyBacked: true })).toEqual({ ok: true, via: "org-key" });
    // a login-backed engine is never key-backed
    expect(engineAccessFor({ ...bob, memberBotsUseOrgKey: true, keyBacked: false, driver: "codex" })).toEqual({ ok: false, reason: "no_access" });
  });

  it("a member's own bot, and its routines, need the org key too", () => {
    const member = { ...base, speakerPrincipalId: BOB, ownerPrincipalId: BOB, ownerOrgRole: "member" as const };
    expect(engineAccessFor(member)).toEqual({ ok: false, reason: "no_access" });
    expect(engineAccessFor({ ...member, speakerPrincipalId: undefined })).toEqual({ ok: false, reason: "no_access" });
    expect(engineAccessFor({ ...member, memberBotsUseOrgKey: true, keyBacked: true })).toEqual({ ok: true, via: "org-key" });
    // an admin speaking to a member's bot is not its owner either
    expect(engineAccessFor({ ...member, speakerPrincipalId: ALICE })).toEqual({ ok: false, reason: "no_access" });
  });

  it("an engine that is not installed wins over everything", () => {
    expect(engineAccessFor({ ...base, installed: false })).toEqual({ ok: false, reason: "engine_missing" });
    expect(engineAccessFor({ ...base, installed: false, speakerPrincipalId: BOB, memberBotsUseOrgKey: true, keyBacked: true })).toEqual({ ok: false, reason: "engine_missing" });
  });

  it("compares principal ids without case", () => {
    expect(engineAccessFor({ ...base, speakerPrincipalId: ALICE.toUpperCase() })).toEqual({ ok: true, via: "server" });
  });
});

describe("the helpers around it", () => {
  it("says why in plain words, never with provider text", () => {
    expect(engineAccessNotice("no_access", "Claude")).toBe("This bot can't answer: no key for Claude. Its owner has to add one.");
    expect(engineAccessNotice("engine_missing", "Codex")).toBe("This bot uses Codex, which is not installed on this server.");
    expect(engineAccessNotice("key_refused", "Claude")).toBe("The provider refused this bot's key.");
  });

  it("finds a key-backed driver from the configured keys only", () => {
    const cfg = { anthropic: { key: "sk-ant-test" }, mistral: {}, xai: { key: "xai-test" } } as unknown as AppConfig;
    expect(driverKeyBacked(cfg, "claudeAgent")).toBe(true);
    expect(driverKeyBacked(cfg, "grok")).toBe(true);
    expect(driverKeyBacked(cfg, "mistral")).toBe(false);
    expect(driverKeyBacked(cfg, "codex")).toBe(false);
    expect(driverKeyBacked(cfg, "grokAgent")).toBe(false);
    expect(driverKeyBacked({} as AppConfig, "claudeAgent")).toBe(false);
  });

  it("marks a bot owned by a non-admin in organization mode only", () => {
    expect(memberOwnedBot({ identity: "perspicax", ownerOrgRole: "member" })).toBe(true);
    expect(memberOwnedBot({ identity: "perspicax", ownerOrgRole: undefined })).toBe(true);
    expect(memberOwnedBot({ identity: "perspicax", ownerOrgRole: "admin" })).toBe(false);
    expect(memberOwnedBot({ identity: "solo", ownerOrgRole: "member" })).toBe(false);
  });

  it("recognizes a server command approval", () => {
    expect(serverCommandApproval({ tool: "Bash" })).toBe(true);
    expect(serverCommandApproval({ tool: "exec_command" })).toBe(true);
    expect(serverCommandApproval({ tool: "mcp__shell__run" })).toBe(true);
    expect(serverCommandApproval({ tool: "Edit", command: { command: "ls" } })).toBe(true);
    expect(serverCommandApproval({ tool: "Edit" })).toBe(false);
    expect(serverCommandApproval({ tool: "WebFetch" })).toBe(false);
  });
});

describe("the key_refused card", () => {
  const input = {
    identity: "perspicax" as const, setup: true, claudeUpdate: false, keyBacked: true,
    message: "Invalid API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 · Please run /login",
    botId: "x", ownerPrincipalId: ALICE, engine: "Claude",
    redact: (text: string) => text.replace(/sk-ant-[\w-]+/g, "[redacted]"),
  };

  it("replaces a key-backed setup error on an organization server, redacted and bounded", () => {
    const card = keyRefusedCard(input);
    expect(card).toMatchObject({ reason: "key_refused", engine: "Claude", botId: "x", ownerPrincipalId: ALICE });
    expect(card?.detail).toContain("[redacted]");
    expect(card?.detail).not.toContain("sk-ant-api03");
    expect(keyRefusedCard({ ...input, message: "x".repeat(500) })?.detail).toHaveLength(200);
  });

  it("leaves every other error alone", () => {
    expect(keyRefusedCard({ ...input, identity: "solo" })).toBeNull();
    expect(keyRefusedCard({ ...input, setup: false })).toBeNull();
    expect(keyRefusedCard({ ...input, keyBacked: false })).toBeNull();
    expect(keyRefusedCard({ ...input, claudeUpdate: true })).toBeNull();
  });

  it("shows the provider's words to the owner and admins only", () => {
    const message = { kind: "access", access: { reason: "key_refused", engine: "Claude", botId: "x", ownerPrincipalId: ALICE, detail: "quota" } };
    expect(accessCardForViewer(message, { principalId: ALICE, admin: false }).access.detail).toBe("quota");
    expect(accessCardForViewer(message, { principalId: BOB, admin: true }).access.detail).toBe("quota");
    expect(accessCardForViewer(message, { principalId: BOB, admin: false }).access).not.toHaveProperty("detail");
    expect(message.access.detail).toBe("quota");
  });
});

describe("who answers a server command of a member's bot", () => {
  const card = { adminApproval: true };
  it("an organization admin answers it, the owner and anyone else get admin_approval_required", () => {
    expect(adminApprovalDecision({ identity: "perspicax", card, callerIsOrgAdmin: true })).toBe("admin");
    expect(adminApprovalDecision({ identity: "perspicax", card, callerIsOrgAdmin: false })).toBe("refused");
  });
  it("leaves ordinary cards, settled cards and solo servers alone", () => {
    expect(adminApprovalDecision({ identity: "perspicax", card: { adminApproval: false }, callerIsOrgAdmin: false })).toBeNull();
    expect(adminApprovalDecision({ identity: "perspicax", card: { ...card, answered: "Allow" }, callerIsOrgAdmin: false })).toBeNull();
    expect(adminApprovalDecision({ identity: "perspicax", card: { ...card, dismissed: true }, callerIsOrgAdmin: false })).toBeNull();
    expect(adminApprovalDecision({ identity: "perspicax", card: null, callerIsOrgAdmin: false })).toBeNull();
    expect(adminApprovalDecision({ identity: "solo", card, callerIsOrgAdmin: false })).toBeNull();
  });
});
