// Slice 4 (D8), revised 2026-10-01: the person who speaks pays. The whole
// decision table of a turn's credentials on an organization server, and
// what the driver receives.
import { describe, expect, it } from "vitest";

import type { TurnSpeaker } from "./engine-access.ts";
import { materializeEngineAccess, providerOfDriver, resolveEngineAccess, turnPayer, type EngineCredentialInput, type PersonFacts } from "./engine-credentials.ts";
import type { ModelProvider, ProviderKeyResult } from "./perspicax-link.ts";

const OWNER = "pr_00000000-0000-4000-8000-000000000001";
const BOB = "pr_00000000-0000-4000-8000-000000000002";
const CAROL = "pr_00000000-0000-4000-8000-000000000003";

type Facts = { signedIn?: string[]; keys?: string[]; people?: Record<string, PersonFacts> };

/** signedIn: "<pid>/<driver>"; keys: "<sub>/<provider>". */
function input(patch: Partial<EngineCredentialInput> & Facts = {}): EngineCredentialInput {
  const { signedIn = [], keys = [], people = { [BOB]: { sub: "SUB-BOB" }, [CAROL]: { sub: "SUB-CAROL" } }, ...rest } = patch;
  return {
    identity: "perspicax",
    speaker: { origin: "person", principalId: OWNER },
    owner: { principalId: OWNER, sub: "SUB-OWNER" },
    instance: { instanceId: "claude", driver: "claudeAgent", installed: true },
    person: (principalId) => people[principalId],
    subscriptionSignedIn: (principalId, driver) => signedIn.includes(`${principalId}/${driver}`),
    hasKey: (sub, provider) => keys.includes(`${sub}/${provider}`),
    keyBacked: false,
    ...rest,
  };
}

const CLAUDE = { instanceId: "claude", driver: "claudeAgent", installed: true };
const CODEX = { instanceId: "codex", driver: "codex", installed: true };
const GROK = { instanceId: "grok", driver: "grokAgent", installed: true };
const bob: TurnSpeaker = { origin: "person", principalId: BOB };
const routine: TurnSpeaker = { origin: "owner-routine" };

describe("resolveEngineAccess: the person who speaks pays", () => {
  it("solo mode: the server's configuration, always", () => {
    expect(resolveEngineAccess(input({ identity: "solo", instance: { ...CLAUDE, installed: false } }))).toEqual({ ok: true, via: "server", payer: "organization" });
  });

  it("an engine that is not installed wins over everything", () => {
    expect(resolveEngineAccess(input({ signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"], keyBacked: true, instance: { ...CLAUDE, installed: false } }))).toEqual({ ok: false, reason: "engine_missing" });
  });

  // The decision table: speaker (owner, someone shared with) x what that
  // person has (subscription, key, nothing) x org key x engine.
  const table: Array<[string, Partial<EngineCredentialInput> & Facts, unknown]> = [
    // the owner speaking to their own bot
    ["owner, own subscription, claude", { signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"], keyBacked: true }, { ok: true, via: "subscription", payer: "owner", payerPrincipalId: OWNER }],
    ["owner, own subscription, codex", { instance: CODEX, signedIn: [`${OWNER}/codex`] }, { ok: true, via: "subscription", payer: "owner", payerPrincipalId: OWNER }],
    ["owner, own key, claude", { keys: ["SUB-OWNER/anthropic"], keyBacked: true }, { ok: true, via: "owner-key", payer: "owner", payerPrincipalId: OWNER, provider: "anthropic" }],
    ["owner, own key, codex", { instance: CODEX, keys: ["SUB-OWNER/openai"] }, { ok: true, via: "owner-key", payer: "owner", payerPrincipalId: OWNER, provider: "openai" }],
    ["owner, nothing, org key", { keyBacked: true }, { ok: true, via: "org-key", payer: "organization" }],
    ["owner, nothing, no org key", {}, { ok: false, reason: "no_access", cause: "no_credentials", payer: "owner", payerPrincipalId: OWNER }],
    // someone the bot is shared with: their own credentials, never the owner's
    ["bob, his subscription, claude", { speaker: bob, signedIn: [`${BOB}/claudeAgent`, `${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic", "SUB-BOB/anthropic"] }, { ok: true, via: "subscription", payer: "speaker", payerPrincipalId: BOB }],
    ["bob, his subscription, codex", { speaker: bob, instance: CODEX, signedIn: [`${BOB}/codex`] }, { ok: true, via: "subscription", payer: "speaker", payerPrincipalId: BOB }],
    ["bob, his key, claude", { speaker: bob, signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic", "SUB-BOB/anthropic"], keyBacked: true }, { ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, provider: "anthropic" }],
    ["bob, his key, codex", { speaker: bob, instance: CODEX, keys: ["SUB-BOB/openai"] }, { ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, provider: "openai" }],
    ["bob, a key for the other provider only", { speaker: bob, instance: CODEX, keys: ["SUB-BOB/anthropic"] }, { ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB }],
    ["bob, nothing, owner has everything, org key", { speaker: bob, signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"], keyBacked: true }, { ok: true, via: "org-key", payer: "organization" }],
    ["bob, nothing, owner has everything, no org key", { speaker: bob, signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"] }, { ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB }],
    // an engine without personal sign-in or Perspicax key (grokAgent, ACP)
    ["other engine, owner signed in elsewhere", { instance: GROK, signedIn: [`${OWNER}/grokAgent`], keys: ["SUB-OWNER/anthropic"] }, { ok: false, reason: "no_access", cause: "no_credentials", payer: "owner", payerPrincipalId: OWNER }],
    ["other engine, key-backed by the server", { instance: GROK, speaker: bob, keyBacked: true }, { ok: true, via: "org-key", payer: "organization" }],
    // disabled people
    ["bob disabled: refused, not the org key", { speaker: bob, people: { [BOB]: { sub: "SUB-BOB", disabled: true } }, signedIn: [`${BOB}/claudeAgent`], keys: ["SUB-BOB/anthropic"], keyBacked: true }, { ok: false, reason: "no_access", cause: "payer_disabled", payer: "speaker", payerPrincipalId: BOB }],
    ["owner disabled, bob speaks: bob's own key still serves", { speaker: bob, owner: { principalId: OWNER, sub: "SUB-OWNER", disabled: true }, keys: ["SUB-BOB/anthropic"] }, { ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, provider: "anthropic" }],
    ["owner disabled, owner speaks", { owner: { principalId: OWNER, sub: "SUB-OWNER", disabled: true }, signedIn: [`${OWNER}/claudeAgent`], keyBacked: true }, { ok: false, reason: "no_access", cause: "payer_disabled", payer: "owner", payerPrincipalId: OWNER }],
    // unknown people have no credentials of their own
    ["an unknown person: the org key or nothing", { speaker: { origin: "person" }, signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"] }, { ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker" }],
    ["an unknown person, org key", { speaker: { origin: "person", principalId: "" }, keyBacked: true }, { ok: true, via: "org-key", payer: "organization" }],
    ["a person the server does not know: no subject, no key", { speaker: { origin: "person", principalId: CAROL }, people: {}, keys: ["SUB-CAROL/anthropic"] }, { ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: CAROL }],
  ];
  it.each(table)("%s", (_name, patch, expected) => {
    expect(resolveEngineAccess(input(patch))).toEqual(expected);
  });

  it("compares principal ids without case", () => {
    expect(resolveEngineAccess(input({ speaker: { origin: "person", principalId: OWNER.toUpperCase() }, keys: ["SUB-OWNER/anthropic"] }))).toMatchObject({ ok: true, via: "owner-key", payer: "owner" });
  });
});

describe("the bot's routines run on the owner's credentials", () => {
  it("a scheduled run: owner's subscription, then owner's key, then the org key", () => {
    expect(resolveEngineAccess(input({ speaker: routine, signedIn: [`${OWNER}/claudeAgent`] }))).toEqual({ ok: true, via: "subscription", payer: "owner", payerPrincipalId: OWNER, routine: true });
    expect(resolveEngineAccess(input({ speaker: routine, keys: ["SUB-OWNER/anthropic"] }))).toEqual({ ok: true, via: "owner-key", payer: "owner", payerPrincipalId: OWNER, provider: "anthropic", routine: true });
    expect(resolveEngineAccess(input({ speaker: routine, keyBacked: true }))).toEqual({ ok: true, via: "org-key", payer: "organization", routine: true });
  });

  it("a run someone else started or edited (its runAs) still runs on the owner's credentials", () => {
    // bob (run or edit level) started the run by hand: his own subscription and key never serve it
    const byBob: TurnSpeaker = { origin: "owner-routine", principalId: BOB };
    expect(turnPayer({ speaker: byBob, owner: { principalId: OWNER } })).toEqual({ principalId: OWNER, routine: true });
    expect(resolveEngineAccess(input({ speaker: byBob, signedIn: [`${BOB}/claudeAgent`], keys: ["SUB-BOB/anthropic", "SUB-OWNER/anthropic"] }))).toEqual({ ok: true, via: "owner-key", payer: "owner", payerPrincipalId: OWNER, provider: "anthropic", routine: true });
    expect(resolveEngineAccess(input({ speaker: byBob, signedIn: [`${BOB}/claudeAgent`], keys: ["SUB-BOB/anthropic"] }))).toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "owner", payerPrincipalId: OWNER, routine: true });
  });

  it("an owner disabled since: the routine is refused, never the org key", () => {
    const erin = { principalId: OWNER, sub: "SUB-OWNER", disabled: true };
    expect(resolveEngineAccess(input({ speaker: routine, owner: erin, signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"], keyBacked: true }))).toEqual({ ok: false, reason: "no_access", cause: "payer_disabled", payer: "owner", payerPrincipalId: OWNER, routine: true });
  });

  it("an owner with no credential and no org key: refused", () => {
    expect(resolveEngineAccess(input({ speaker: routine }))).toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "owner", payerPrincipalId: OWNER, routine: true });
  });

  it("a hop a routine started speaks, and pays, for the person that routine runs for", () => {
    // carol's routine asked the owner's bot: carol's credentials, marked routine
    const hop: TurnSpeaker = { origin: "peer", principalId: CAROL, routine: true };
    expect(resolveEngineAccess(input({ speaker: hop, keys: ["SUB-CAROL/anthropic", "SUB-OWNER/anthropic"] }))).toEqual({ ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: CAROL, provider: "anthropic", routine: true });
    // a person's hop: that person pays
    expect(resolveEngineAccess(input({ speaker: { origin: "peer", principalId: BOB }, keys: ["SUB-OWNER/anthropic"] }))).toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB });
    // no source turn known: the asking bot's owner
    expect(resolveEngineAccess(input({ speaker: { origin: "peer" }, peerOwnerPrincipalId: BOB, keys: ["SUB-BOB/anthropic"] }))).toMatchObject({ ok: true, via: "speaker-key", payerPrincipalId: BOB });
  });

  it("the operator at this computer is the owner", () => {
    expect(resolveEngineAccess(input({ speaker: { origin: "operator" }, signedIn: [`${OWNER}/claudeAgent`] }))).toMatchObject({ ok: true, via: "subscription", payer: "owner" });
  });

  it("providers by driver", () => {
    expect(providerOfDriver("claudeAgent")).toBe("anthropic");
    expect(providerOfDriver("codex")).toBe("openai");
    expect(providerOfDriver("grokAgent")).toBeNull();
  });
});

describe("materializeEngineAccess", () => {
  const deps = (answer: ProviderKeyResult | ((sub: string, provider: ModelProvider) => ProviderKeyResult)) => {
    const invalidated: string[] = [];
    const resolved: string[] = [];
    return {
      invalidated,
      resolved,
      dataDir: "/data",
      resolveKey: async (sub: string, provider: ModelProvider) => {
        resolved.push(`${sub}/${provider}`);
        return typeof answer === "function" ? answer(sub, provider) : answer;
      },
      invalidate: (sub: string, provider: string) => { invalidated.push(`${sub}/${provider}`); },
      loginDir: (principalId: string, driver: "claudeAgent" | "codex") => `/data/principals/${principalId}/${driver === "claudeAgent" ? "claude" : "codex"}`,
    };
  };
  const BOB_PID = BOB.toLowerCase();

  it("puts the speaker's own Anthropic key in the turn environment, read with the speaker's subject", async () => {
    const inp = input({ speaker: bob, keys: ["SUB-BOB/anthropic", "SUB-OWNER/anthropic"] });
    const d = deps({ ok: true, key: "sk-ant-test-bob-key-000001", fingerprint: "fp1" });
    const out = await materializeEngineAccess(inp, resolveEngineAccess(inp), d);
    expect(out).toMatchObject({ ok: true, access: { via: "speaker-key", identity: `speaker-key:${BOB_PID}:fp1`, environment: { ANTHROPIC_API_KEY: "sk-ant-test-bob-key-000001" } } });
    expect(d.resolved).toEqual(["SUB-BOB/anthropic"]);
  });

  it("runs Codex on the payer's OpenAI key from an empty home of their own", async () => {
    const inp = input({ instance: CODEX, keys: ["SUB-OWNER/openai"] });
    const out = await materializeEngineAccess(inp, resolveEngineAccess(inp), deps({ ok: true, key: "sk-test-openai-000000000001", fingerprint: "fp2" }));
    expect(out).toMatchObject({ ok: true, access: { via: "owner-key", identity: `owner-key:${OWNER}:fp2`, environment: { SAGAX_OWNER_OPENAI_API_KEY: "sk-test-openai-000000000001" }, codexHome: `/data/principals/${OWNER}/codex-key`, codexOwnerKey: true } });
    const bobs = input({ speaker: bob, instance: CODEX, keys: ["SUB-BOB/openai"] });
    expect(await materializeEngineAccess(bobs, resolveEngineAccess(bobs), deps({ ok: true, key: "sk-test-openai-000000000002", fingerprint: "fp3" }))).toMatchObject({ ok: true, access: { via: "speaker-key", codexHome: `/data/principals/${BOB_PID}/codex-key`, codexOwnerKey: true } });
  });

  it("a subscription points the driver at the speaker's own login directory", async () => {
    const claude = input({ speaker: bob, signedIn: [`${BOB}/claudeAgent`] });
    expect(await materializeEngineAccess(claude, resolveEngineAccess(claude), deps({ ok: false, error: "no_key" }))).toMatchObject({ ok: true, access: { via: "subscription", identity: `subscription:${BOB_PID}`, claudeConfigDir: `/data/principals/${BOB_PID}/claude` } });
    const codex = input({ instance: CODEX, signedIn: [`${OWNER}/codex`] });
    expect(await materializeEngineAccess(codex, resolveEngineAccess(codex), deps({ ok: false, error: "no_key" }))).toMatchObject({ ok: true, access: { via: "subscription", identity: `subscription:${OWNER}`, codexHome: `/data/principals/${OWNER}/codex` } });
  });

  it("S4-14: a key plan for a payer disabled since never reads the (cached) key", async () => {
    const live = input({ speaker: routine, keys: ["SUB-OWNER/anthropic"], keyBacked: true });
    const plan = resolveEngineAccess(live);
    const erin = { ...live, owner: { ...live.owner, disabled: true } };
    const cached = deps({ ok: true, key: "sk-ant-test-erin-key-00001", fingerprint: "fp" });
    expect(await materializeEngineAccess(erin, plan, cached)).toMatchObject({ ok: false, reason: "no_access", plan: { cause: "payer_disabled", payer: "owner", routine: true } });
    expect(cached.invalidated).toEqual(["SUB-OWNER/anthropic"]);
    expect(cached.resolved).toEqual([]);
  });

  it("a key Perspicax no longer has falls through to the org key; an inactive payer is refused; an unreachable Perspicax is no_access", async () => {
    const withOrg = input({ speaker: bob, keys: ["SUB-BOB/anthropic"], keyBacked: true });
    const gone = deps({ ok: false, error: "no_key" });
    expect(await materializeEngineAccess(withOrg, resolveEngineAccess(withOrg), gone)).toMatchObject({ ok: true, access: { via: "org-key", identity: "org-key" } });
    expect(gone.invalidated).toEqual(["SUB-BOB/anthropic"]);
    const noOrg = input({ speaker: bob, keys: ["SUB-BOB/anthropic"] });
    expect(await materializeEngineAccess(noOrg, resolveEngineAccess(noOrg), deps({ ok: false, error: "no_key" }))).toMatchObject({ ok: false, reason: "no_access", plan: { cause: "no_credentials", payer: "speaker" } });
    expect(await materializeEngineAccess(withOrg, resolveEngineAccess(withOrg), deps({ ok: false, error: "user_inactive" }))).toMatchObject({ ok: false, reason: "no_access", plan: { cause: "payer_disabled", payer: "speaker" } });
    expect(await materializeEngineAccess(noOrg, resolveEngineAccess(noOrg), deps({ ok: false, error: "unreachable" }))).toEqual({ ok: false, reason: "no_access", detail: "perspicax_unreachable" });
  });

  it("never reads the owner's key for someone else's turn", async () => {
    const inp = input({ speaker: bob, keys: ["SUB-OWNER/anthropic"], keyBacked: true });
    const d = deps({ ok: true, key: "sk-ant-test-owner-key-0001", fingerprint: "fp" });
    expect(await materializeEngineAccess(inp, resolveEngineAccess(inp), d)).toMatchObject({ ok: true, access: { via: "org-key" } });
    expect(d.resolved).toEqual([]);
  });
});
