// Slice 4 (D8): the resolution order of a turn's credentials on an
// organization server, and what the driver receives.
import { describe, expect, it } from "vitest";

import { materializeEngineAccess, providerOfDriver, resolveEngineAccess, type EngineCredentialInput } from "./engine-credentials.ts";
import type { ProviderKeyResult } from "./perspicax-link.ts";

const OWNER = "pr_00000000-0000-4000-8000-000000000001";
const BOB = "pr_00000000-0000-4000-8000-000000000002";

function input(patch: Partial<EngineCredentialInput> & { signedIn?: boolean; hasKey?: boolean } = {}): EngineCredentialInput {
  const { signedIn = false, hasKey = false, ...rest } = patch;
  return {
    identity: "perspicax",
    speaker: { origin: "person", principalId: OWNER },
    owner: { principalId: OWNER, sub: "SUB-OWNER", orgRole: "member" },
    instance: { instanceId: "claude", driver: "claudeAgent", installed: true },
    subscriptionSignedIn: () => signedIn,
    ownerHasKey: () => hasKey,
    memberBotsUseOrgKey: false,
    keyBacked: true,
    ...rest,
  };
}

describe("resolveEngineAccess", () => {
  it("solo mode: the server's configuration, always", () => {
    expect(resolveEngineAccess(input({ identity: "solo", instance: { instanceId: "x", driver: "claudeAgent", installed: false } }))).toEqual({ ok: true, via: "server" });
  });

  it("an engine that is not installed wins over everything", () => {
    expect(resolveEngineAccess(input({ signedIn: true, hasKey: true, instance: { instanceId: "ghost", driver: "claudeAgent", installed: false } }))).toEqual({ ok: false, reason: "engine_missing" });
  });

  it("the owner's subscription serves only the owner speaking, their routines included", () => {
    expect(resolveEngineAccess(input({ signedIn: true, hasKey: true }))).toEqual({ ok: true, via: "subscription" });
    expect(resolveEngineAccess(input({ signedIn: true, speaker: { origin: "owner-routine" } }))).toEqual({ ok: true, via: "subscription" });
    expect(resolveEngineAccess(input({ signedIn: true, speaker: { origin: "person", principalId: BOB } }))).toEqual({ ok: false, reason: "no_access" });
    // an unknown person is never the owner
    expect(resolveEngineAccess(input({ signedIn: true, speaker: { origin: "person" } }))).toEqual({ ok: false, reason: "no_access" });
    // no subscription for an engine without personal sign-in
    expect(resolveEngineAccess(input({ signedIn: true, instance: { instanceId: "grok", driver: "grokAgent", installed: true } }))).toEqual({ ok: false, reason: "no_access" });
  });

  it("the owner's key serves every speaker, by the driver's provider", () => {
    expect(resolveEngineAccess(input({ hasKey: true, speaker: { origin: "person", principalId: BOB } }))).toEqual({ ok: true, via: "owner-key", provider: "anthropic" });
    expect(resolveEngineAccess(input({ hasKey: true, instance: { instanceId: "codex", driver: "codex", installed: true } }))).toEqual({ ok: true, via: "owner-key", provider: "openai" });
    expect(resolveEngineAccess(input({ hasKey: true, owner: { principalId: OWNER, orgRole: "member" } }))).toEqual({ ok: false, reason: "no_access" });
    expect(providerOfDriver("grokAgent")).toBeNull();
  });

  it("an admin owner speaking falls back to the server; anyone else to the org key when allowed", () => {
    const admin = { principalId: OWNER, sub: "SUB-OWNER", orgRole: "admin" as const };
    expect(resolveEngineAccess(input({ owner: admin }))).toEqual({ ok: true, via: "server" });
    expect(resolveEngineAccess(input({ owner: admin, speaker: { origin: "person", principalId: BOB } }))).toEqual({ ok: false, reason: "no_access" });
    expect(resolveEngineAccess(input({ owner: admin, speaker: { origin: "person", principalId: BOB }, memberBotsUseOrgKey: true }))).toEqual({ ok: true, via: "org-key" });
    expect(resolveEngineAccess(input({ memberBotsUseOrgKey: true, keyBacked: false }))).toEqual({ ok: false, reason: "no_access" });
    expect(resolveEngineAccess(input())).toEqual({ ok: false, reason: "no_access" });
  });
});

describe("materializeEngineAccess", () => {
  const deps = (answer: ProviderKeyResult) => {
    const invalidated: string[] = [];
    return {
      invalidated,
      dataDir: "/data",
      resolveKey: async () => answer,
      invalidate: (sub: string, provider: string) => { invalidated.push(`${sub}/${provider}`); },
      loginDir: (principalId: string, driver: "claudeAgent" | "codex") => `/data/principals/${principalId}/${driver === "claudeAgent" ? "claude" : "codex"}`,
    };
  };

  it("puts an Anthropic owner key in the turn environment, never a subscription dir", async () => {
    const inp = input({ hasKey: true, speaker: { origin: "person", principalId: BOB } });
    const out = await materializeEngineAccess(inp, resolveEngineAccess(inp), deps({ ok: true, key: "sk-ant-test-alice-key-0001", fingerprint: "fp1" }));
    expect(out).toEqual({ ok: true, access: { via: "owner-key", identity: `owner-key:${OWNER}:fp1`, environment: { ANTHROPIC_API_KEY: "sk-ant-test-alice-key-0001" } } });
  });

  it("runs Codex on the owner's OpenAI key from an empty home of its own", async () => {
    const inp = input({ hasKey: true, instance: { instanceId: "codex", driver: "codex", installed: true } });
    const out = await materializeEngineAccess(inp, resolveEngineAccess(inp), deps({ ok: true, key: "sk-test-openai-000000000001", fingerprint: "fp2" }));
    expect(out).toEqual({ ok: true, access: { via: "owner-key", identity: `owner-key:${OWNER}:fp2`, environment: { OMB_OWNER_OPENAI_API_KEY: "sk-test-openai-000000000001" }, codexHome: `/data/principals/${OWNER}/codex-key`, codexOwnerKey: true } });
  });

  it("a subscription points the driver at the person's login directory", async () => {
    const claude = input({ signedIn: true });
    expect(await materializeEngineAccess(claude, resolveEngineAccess(claude), deps({ ok: false, error: "no_key" }))).toEqual({ ok: true, access: { via: "subscription", identity: `subscription:${OWNER}`, claudeConfigDir: `/data/principals/${OWNER}/claude` } });
    const codex = input({ signedIn: true, instance: { instanceId: "codex", driver: "codex", installed: true } });
    expect(await materializeEngineAccess(codex, resolveEngineAccess(codex), deps({ ok: false, error: "no_key" }))).toEqual({ ok: true, access: { via: "subscription", identity: `subscription:${OWNER}`, codexHome: `/data/principals/${OWNER}/codex` } });
  });

  it("a key Perspicax no longer gives falls through (and is dropped); an unreachable Perspicax is no_access", async () => {
    const admin = input({ hasKey: true, owner: { principalId: OWNER, sub: "SUB-OWNER", orgRole: "admin" } });
    const gone = deps({ ok: false, error: "no_key" });
    expect(await materializeEngineAccess(admin, resolveEngineAccess(admin), gone)).toEqual({ ok: true, access: { via: "server", identity: "server" } });
    expect(gone.invalidated).toEqual(["SUB-OWNER/anthropic"]);
    const bob = input({ hasKey: true, speaker: { origin: "person", principalId: BOB } });
    expect(await materializeEngineAccess(bob, resolveEngineAccess(bob), deps({ ok: false, error: "user_inactive" }))).toEqual({ ok: false, reason: "no_access" });
    const orgKey = input({ hasKey: true, speaker: { origin: "person", principalId: BOB }, memberBotsUseOrgKey: true });
    expect(await materializeEngineAccess(orgKey, resolveEngineAccess(orgKey), deps({ ok: false, error: "no_key" }))).toEqual({ ok: true, access: { via: "org-key", identity: "org-key" } });
    expect(await materializeEngineAccess(bob, resolveEngineAccess(bob), deps({ ok: false, error: "unreachable" }))).toEqual({ ok: false, reason: "no_access", detail: "perspicax_unreachable" });
  });
});
