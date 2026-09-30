// Engine access on an organization server (slice 3, D13), the whole matrix.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { driverKeyBacked, type AppConfig } from "./config.ts";
import { accessCardForViewer, adminApprovalDecision, engineAccessFor, engineAccessNotice, keyRefusedCard, memberBotAdminApproval, memberOwnedBot, resolveTurnSpeaker, routineLineage, serverCommandApproval, speakerPrincipal, type EngineAccessInput } from "./engine-access.ts";

const ALICE = "pr_aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "pr_bbbbbbbb-0000-4000-8000-000000000002";

const base: EngineAccessInput = {
  identity: "perspicax",
  speaker: { origin: "person", principalId: ALICE },
  ownerPrincipalId: ALICE,
  ownerOrgRole: "admin",
  memberBotsUseOrgKey: false,
  driver: "claudeAgent",
  keyBacked: false,
  installed: true,
};

describe("engineAccessFor", () => {
  it("solo mode is unchanged, whatever the rest says", () => {
    expect(engineAccessFor({ ...base, identity: "solo", installed: false, speaker: { origin: "person", principalId: BOB }, ownerOrgRole: "member" })).toEqual({ ok: true, via: "server" });
  });

  it("an admin owner speaking to their own bot uses the server's access, key or login", () => {
    expect(engineAccessFor(base)).toEqual({ ok: true, via: "server" });
    expect(engineAccessFor({ ...base, driver: "codex" })).toEqual({ ok: true, via: "server" });
    // the owner's routine, the operator at this computer: the owner's own turn
    expect(engineAccessFor({ ...base, speaker: { origin: "owner-routine" }, driver: "grokAgent" })).toEqual({ ok: true, via: "server" });
    expect(engineAccessFor({ ...base, speaker: { origin: "operator" } })).toEqual({ ok: true, via: "server" });
  });

  it("someone else on an admin's bot needs the org key toggle AND a key-backed instance", () => {
    const bob = { ...base, speaker: { origin: "person" as const, principalId: BOB } };
    expect(engineAccessFor(bob)).toEqual({ ok: false, reason: "no_access" });
    expect(engineAccessFor({ ...bob, keyBacked: true })).toEqual({ ok: false, reason: "no_access" });
    expect(engineAccessFor({ ...bob, memberBotsUseOrgKey: true })).toEqual({ ok: false, reason: "no_access" });
    expect(engineAccessFor({ ...bob, memberBotsUseOrgKey: true, keyBacked: true })).toEqual({ ok: true, via: "org-key" });
    // a login-backed engine is never key-backed
    expect(engineAccessFor({ ...bob, memberBotsUseOrgKey: true, keyBacked: false, driver: "codex" })).toEqual({ ok: false, reason: "no_access" });
  });

  it("a member's own bot, and its routines, need the org key too", () => {
    const member = { ...base, speaker: { origin: "person" as const, principalId: BOB }, ownerPrincipalId: BOB, ownerOrgRole: "member" as const };
    expect(engineAccessFor(member)).toEqual({ ok: false, reason: "no_access" });
    expect(engineAccessFor({ ...member, speaker: { origin: "owner-routine" } })).toEqual({ ok: false, reason: "no_access" });
    expect(engineAccessFor({ ...member, memberBotsUseOrgKey: true, keyBacked: true })).toEqual({ ok: true, via: "org-key" });
    // an admin speaking to a member's bot is not its owner either
    expect(engineAccessFor({ ...member, speaker: { origin: "person", principalId: ALICE } })).toEqual({ ok: false, reason: "no_access" });
  });

  it("an engine that is not installed wins over everything", () => {
    expect(engineAccessFor({ ...base, installed: false })).toEqual({ ok: false, reason: "engine_missing" });
    expect(engineAccessFor({ ...base, installed: false, speaker: { origin: "person", principalId: BOB }, memberBotsUseOrgKey: true, keyBacked: true })).toEqual({ ok: false, reason: "engine_missing" });
  });

  it("fails closed: a person nobody named is never the owner", () => {
    expect(engineAccessFor({ ...base, speaker: { origin: "person" } })).toEqual({ ok: false, reason: "no_access" });
    expect(engineAccessFor({ ...base, speaker: { origin: "person", principalId: "" } })).toEqual({ ok: false, reason: "no_access" });
    expect(engineAccessFor({ ...base, speaker: { origin: "person" }, memberBotsUseOrgKey: true, keyBacked: true })).toEqual({ ok: true, via: "org-key" });
  });

  it("a bot hop speaks for the source turn's person, else the asking bot's owner", () => {
    // bob spoke to a bot that asked alice's bot: bob speaks
    expect(engineAccessFor({ ...base, speaker: { origin: "peer", principalId: BOB }, peerOwnerPrincipalId: ALICE })).toEqual({ ok: false, reason: "no_access" });
    // an unknown person behind the source turn: nobody is the owner
    expect(engineAccessFor({ ...base, speaker: { origin: "peer", principalId: "" }, peerOwnerPrincipalId: ALICE })).toEqual({ ok: false, reason: "no_access" });
    // no source turn known: the asking bot's owner, here a member
    expect(engineAccessFor({ ...base, speaker: { origin: "peer" }, peerOwnerPrincipalId: BOB })).toEqual({ ok: false, reason: "no_access" });
    expect(engineAccessFor({ ...base, speaker: { origin: "peer" } })).toEqual({ ok: false, reason: "no_access" });
    // alice's own bots between themselves keep the server's access
    expect(engineAccessFor({ ...base, speaker: { origin: "peer" }, peerOwnerPrincipalId: ALICE })).toEqual({ ok: true, via: "server" });
    expect(engineAccessFor({ ...base, speaker: { origin: "peer", principalId: ALICE }, peerOwnerPrincipalId: BOB })).toEqual({ ok: true, via: "server" });
  });

  it("compares principal ids without case", () => {
    expect(engineAccessFor({ ...base, speaker: { origin: "person", principalId: ALICE.toUpperCase() } })).toEqual({ ok: true, via: "server" });
  });
});

describe("resolveTurnSpeaker", () => {
  it("keeps a stated speaker", () => {
    expect(resolveTurnSpeaker({ speaker: { origin: "operator" }, sender: { id: BOB } })).toEqual({ origin: "operator" });
  });
  it("reads the peer, the sender, a routine, the operator, in that order", () => {
    expect(resolveTurnSpeaker({ peerAsk: { botId: "b1" }, sender: { id: BOB } })).toEqual({ origin: "peer", fromBotId: "b1" });
    expect(resolveTurnSpeaker({ sender: { id: BOB }, trigger: { kind: "owner" } })).toEqual({ origin: "person", principalId: BOB });
    expect(resolveTurnSpeaker({ automationSource: "schedule" })).toEqual({ origin: "owner-routine" });
    expect(resolveTurnSpeaker({ trigger: { kind: "routine" } })).toEqual({ origin: "owner-routine" });
    expect(resolveTurnSpeaker({ trigger: { kind: "owner" } })).toEqual({ origin: "operator" });
  });
  it("fails closed when nothing names the speaker", () => {
    expect(resolveTurnSpeaker({})).toEqual({ origin: "person" });
    expect(resolveTurnSpeaker({ trigger: { kind: "user" } })).toEqual({ origin: "person" });
  });
});

describe("the helpers around it", () => {
  it("tells a routine's lineage apart: the routine itself and any hop marked from it", () => {
    expect(routineLineage({ origin: "owner-routine" })).toBe(true);
    expect(routineLineage({ origin: "peer", fromBotId: "b", principalId: "pr_alice", routine: true })).toBe(true);
    expect(routineLineage({ origin: "peer", fromBotId: "b", principalId: "pr_alice" })).toBe(false);
    expect(routineLineage({ origin: "person", principalId: "pr_alice" })).toBe(false);
    expect(routineLineage({ origin: "operator" })).toBe(false);
  });

  it("speaks for a routine's runAs, else the owner (slice 6)", () => {
    expect(speakerPrincipal({ origin: "owner-routine", principalId: BOB }, "pr_owner")).toBe(BOB);
    expect(speakerPrincipal({ origin: "owner-routine" }, "pr_owner")).toBe("pr_owner");
    expect(routineLineage({ origin: "owner-routine", principalId: BOB })).toBe(true);
  });

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

describe("the admin gate on a member's bot", () => {
  let data = "";
  let root = "";
  beforeAll(() => {
    data = realpathSync(mkdtempSync(join(tmpdir(), "omb-admin-gate-")));
    root = join(data, "task-workspaces", "bot-1");
    mkdirSync(join(root, "thread-1", "src"), { recursive: true });
    mkdirSync(join(data, ".claude"), { recursive: true });
    writeFileSync(join(data, ".claude", "settings.json"), "{}");
    symlinkSync(join(data, ".claude"), join(root, "thread-1", "escape"));
  });
  afterAll(() => rmSync(data, { recursive: true, force: true }));
  const gate = (tool: string, paths?: string[], command?: unknown) => memberBotAdminApproval({ tool, paths, command, workspaceRoot: root });

  it("lets the owner answer a file tool that stays inside the bot's own workspace", () => {
    expect(gate("Write", [join(root, "thread-1", "src", "new.ts")])).toBe(false);
    expect(gate("Edit", [join(root, "thread-1", "README.md")])).toBe(false);
    expect(gate("Read", [join(root, "thread-1", "src")])).toBe(false);
    expect(gate("Glob", [join(root, "thread-1")])).toBe(false);
  });
  it("needs an admin for a write, edit or read outside that workspace", () => {
    expect(gate("Write", [join(data, ".claude", "settings.json")])).toBe(true);
    expect(gate("Edit", [join(data, "config.json")])).toBe(true);
    expect(gate("MultiEdit", ["/run/secrets/pulsabot_idp_key"])).toBe(true);
    expect(gate("Read", ["/run/secrets/pulsabot_idp_key"])).toBe(true);
    expect(gate("Read", [join(data, ".claude", ".credentials.json")])).toBe(true);
    expect(gate("NotebookEdit", [join(data, "task-workspaces", "bot-2", "t", "n.ipynb")])).toBe(true);
    expect(gate("Write", [join(root, "thread-1", "..", "..", "bot-2", "x")])).toBe(true);
  });
  it("needs an admin through a symlink, into a dot folder, or without a known path", () => {
    expect(gate("Write", [join(root, "thread-1", "escape", "settings.json")])).toBe(true);
    // a project's .claude/settings.json can hold hooks that run commands
    expect(gate("Write", [join(root, "thread-1", ".claude", "settings.json")])).toBe(true);
    expect(gate("Write", [join(root, "thread-1", ".git", "hooks", "pre-commit")])).toBe(true);
    expect(gate("Write", [join(root, "thread-1", ".mcp.json")])).toBe(true);
    expect(gate("Write", [])).toBe(true);
    expect(gate("Write")).toBe(true);
    expect(gate("Write", ["relative/path.ts"])).toBe(true);
    // one path out is enough
    expect(gate("Edit", [join(root, "thread-1", "a.ts"), "/etc/passwd"])).toBe(true);
  });
  it("needs an admin for every other tool and every server command", () => {
    expect(gate("Bash", [join(root, "thread-1")], { command: "ls", cwd: root })).toBe(true);
    expect(gate("WebFetch")).toBe(true);
    expect(gate("mcp__computer__click")).toBe(true);
    expect(gate("Write", [join(root, "thread-1", "a.ts")], { command: "ls", cwd: root })).toBe(true);
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
