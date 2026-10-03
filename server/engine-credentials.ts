// Which credentials a turn runs with on an organization server (slice 4,
// decision D8, revised 2026-10-01: the person who speaks pays). Replaces the
// slice 3 gate.
//
// Who pays (the payer):
//   - a person's turn, on their own bot or on a bot shared with them, and a
//     bot hop that speaks for that person: the person who speaks;
//   - a routine of the bot (a scheduled run, a run someone started by hand,
//     a run after someone edited the routine): always the bot's OWNER, never
//     whoever created, edited or started it;
//   - a bot hop a routine started: that routine's bot owner, carried along
//     the hops (TurnSpeaker routinePayer); else the person it speaks for.
//
// Order, first match wins:
//   1. the instance's CLI is not installed              -> engine_missing
//   2. the payer is disabled (the directory marked them
//      out, a back-channel logout)                      -> no_access (payer_disabled)
//   3. the payer is signed in to this engine with their
//      own subscription (Claude, Codex, Grok Build,
//      Kimi Code)                                       -> subscription
//   4. the payer keeps a key for the engine's provider
//      in Perspicax (claudeAgent: anthropic, codex:
//      openai, grokAgent: xai, geminiAgent: google,
//      kimiAgent: moonshot, piAgent: any of them)       -> owner-key (the payer owns
//                                                          the bot) or speaker-key
//   5. the server has a key for this engine (Settings >
//      Connections, set by an admin: the organization's
//      key), used automatically                         -> org-key
//   6. otherwise                                        -> no_access (no_credentials)
//
// JC, 2026-10-01, superseding the 2026-09-28 decision 7 ("the owner key
// serves everyone") and the slice 3 rules: the owner's credentials never pay
// for the people the bot is shared with; there is no organization switch
// for the org key any more (it serves whenever an admin set one); and the
// server's own sign-ins no longer serve admins' bots: everyone, admins
// included, signs in their own subscription. Solo mode is unchanged: the
// server's own configuration serves every turn.
//
// The key itself is fetched at dispatch (materializeEngineAccess) through
// the Perspicax link, kept in memory 60 s at most, and put into that one
// turn's environment. It is never written to disk or logged.
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// section 4 bis.
import { join } from "node:path";

import { routineLineage, speakerPrincipal, type EngineAccessRefusal, type TurnSpeaker } from "./engine-access.ts";
import type { ModelProvider, ProviderKeyResult } from "./perspicax-link.ts";

/** `server` is solo mode only (and rows written before 2026-10-01). */
export type AccessVia = "subscription" | "owner-key" | "speaker-key" | "server" | "org-key";

/** Every value of AccessVia, for readers of stored rows. */
export const ACCESS_VIAS: readonly AccessVia[] = ["subscription", "owner-key", "speaker-key", "server", "org-key"];

/** Who a turn's credentials belong to: the person who speaks, the bot's
 * owner (their own turn or the bot's routine), or the organization (the
 * server's access or the org key). */
export type AccessPayer = "speaker" | "owner" | "organization";

/** Why no credentials serve a turn. */
export type NoAccessCause = "payer_disabled" | "no_credentials";

/** A key of the payer's in Perspicax. */
export function keyVia(via: AccessVia | undefined): via is "owner-key" | "speaker-key" {
  return via === "owner-key" || via === "speaker-key";
}

/** What a driver receives for one turn (contracts.ts SendTurnInput.access). */
export interface TurnAccess {
  via: AccessVia;
  /** A non-secret label: subscription:<pid>, owner-key:<pid>:<fingerprint>,
   * speaker-key:<pid>:<fingerprint>, server, org-key. A retained engine
   * process is reused only for the same identity. */
  identity: string;
  /** Extra environment for this turn only (the payer's key). */
  environment?: Record<string, string>;
  /** Claude: the person's own login directory (CLAUDE_CONFIG_DIR). */
  claudeConfigDir?: string;
  /** Codex: the CODEX_HOME for this turn. */
  codexHome?: string;
  /** Codex: run on the payer's OpenAI key (the pulsa_owner provider). */
  codexOwnerKey?: boolean;
  /** Grok Build, Kimi Code, Gemini CLI, pi: the payer's own home for the
   * engine (their device sign-in, or an empty one for a key), so the
   * server's own login never serves the turn (engineHomeEnv). */
  engineHome?: string;
}

const DRIVER_PROVIDERS: Readonly<Record<string, readonly ModelProvider[]>> = {
  claudeAgent: ["anthropic"],
  codex: ["openai"],
  grokAgent: ["xai"],
  geminiAgent: ["google"],
  kimiAgent: ["moonshot"],
  // pi is BYOK across providers: any key the person keeps serves it, and the
  // model they pick decides which one a turn uses.
  piAgent: ["anthropic", "openai", "xai", "google", "moonshot"],
};

/** The model providers whose key can serve a driver, in preference order. */
export function providersOfDriver(driver: string): readonly ModelProvider[] {
  return DRIVER_PROVIDERS[driver] ?? [];
}

/** The model provider behind a driver, when a person's key can serve it
 * (the first one for a multi-provider engine). */
export function providerOfDriver(driver: string): ModelProvider | null {
  return providersOfDriver(driver)[0] ?? null;
}

/** The variable each provider's key reaches an engine as. Codex is apart: its
 * key rides SAGAX_OWNER_OPENAI_API_KEY through the pulsa_owner provider. */
export const PROVIDER_KEY_ENV: Readonly<Record<ModelProvider, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
  google: "GEMINI_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
};

export type SubscriptionDriver = "claudeAgent" | "codex" | "grokAgent" | "kimiAgent";

/** Drivers a person can sign in to with their own subscription: Claude and
 * Codex through their login controllers, Grok Build (`grok login
 * --device-auth`) and Kimi Code (`kimi login`) through a device code. */
export function subscriptionDriver(driver: string): driver is SubscriptionDriver {
  return driver === "claudeAgent" || driver === "codex" || driver === "grokAgent" || driver === "kimiAgent";
}

/** Drivers whose engine home is set per turn (engineHome), not a
 * Claude config dir or a CODEX_HOME. */
export function homeDriver(driver: string): driver is "grokAgent" | "kimiAgent" | "geminiAgent" | "piAgent" {
  return driver === "grokAgent" || driver === "kimiAgent" || driver === "geminiAgent" || driver === "piAgent";
}

/** What the server knows of a person: their Perspicax subject and whether
 * they are disabled. */
export interface PersonFacts {
  sub?: string;
  disabled?: boolean;
}

export interface EngineCredentialInput {
  identity: "solo" | "perspicax";
  speaker: TurnSpeaker;
  peerOwnerPrincipalId?: string;
  owner: { principalId: string; sub?: string; disabled?: boolean };
  instance: { instanceId: string; driver: string; installed: boolean };
  /** A person other than the owner, by principal id (undefined: unknown). */
  person?: (principalId: string) => PersonFacts | undefined;
  /** The person signed in to this driver with their own subscription (D10). */
  subscriptionSignedIn: (principalId: string, driver: string) => boolean;
  /** The directory lists this provider for the person (names only). */
  hasKey: (sub: string, provider: ModelProvider) => boolean;
  /** The instance's driver reads a key the server configured (Settings >
   * Connections): the organization's key. */
  keyBacked: boolean;
}

export type EngineCredentialPlan =
  | { ok: true; via: AccessVia; payer: AccessPayer; payerPrincipalId?: string; provider?: ModelProvider; routine?: true }
  | { ok: false; reason: EngineAccessRefusal; cause?: NoAccessCause; payer?: "speaker" | "owner"; payerPrincipalId?: string; routine?: true };

const key = (id: string | undefined) => id?.trim().toLowerCase() ?? "";

/** The person whose credentials a turn uses ("" for an unknown person, who
 * has none), and whether that is the bot's owner because the turn is the
 * bot's own routine. */
export function turnPayer(input: Pick<EngineCredentialInput, "speaker" | "owner" | "peerOwnerPrincipalId">): { principalId: string; routine: boolean } {
  // The bot's routine: its owner pays, whoever started, created or edited
  // the run (its runAs is who it acts as for MCP, not who pays).
  if (input.speaker.origin === "owner-routine") return { principalId: input.owner.principalId.trim(), routine: true };
  // A hop the routine started: still the routine's bot owner, carried along.
  if (input.speaker.origin === "peer" && input.speaker.routine && input.speaker.routinePayer) return { principalId: input.speaker.routinePayer.trim(), routine: true };
  return { principalId: speakerPrincipal(input.speaker, input.owner.principalId, input.peerOwnerPrincipalId).trim(), routine: routineLineage(input.speaker) };
}

/** The resolution order above, pure. `skip.key` drops step 4 (the key went
 * away between admission and dispatch). */
export function resolveEngineAccess(input: EngineCredentialInput, skip: { key?: boolean } = {}): EngineCredentialPlan {
  if (input.identity !== "perspicax") return { ok: true, via: "server", payer: "organization" };
  const payer = turnPayer(input);
  const routine = payer.routine ? { routine: true as const } : {};
  const isOwner = payer.principalId !== "" && key(payer.principalId) === key(input.owner.principalId);
  const who = { payer: isOwner ? "owner" as const : "speaker" as const, ...(payer.principalId ? { payerPrincipalId: payer.principalId } : {}), ...routine };
  // who it is for: the card goes to that person only (accessCardAudience)
  if (!input.instance.installed) return { ok: false, reason: "engine_missing", ...who };
  const facts: PersonFacts | undefined = payer.principalId === "" ? undefined : isOwner ? input.owner : input.person?.(payer.principalId);
  // A disabled person's credentials serve nobody, and their turn (their
  // routines included) does not fall back on the organization either (S4-14).
  if (facts?.disabled) return { ok: false, reason: "no_access", cause: "payer_disabled", ...who };
  const driver = input.instance.driver;
  if (payer.principalId && subscriptionDriver(driver) && input.subscriptionSignedIn(payer.principalId, driver)) {
    return { ok: true, via: "subscription", ...who };
  }
  const provider = facts?.sub ? providersOfDriver(driver).find((candidate) => input.hasKey(facts.sub!, candidate)) : undefined;
  if (!skip.key && provider && facts?.sub) {
    return { ok: true, via: isOwner ? "owner-key" : "speaker-key", ...who, provider };
  }
  if (input.keyBacked) return { ok: true, via: "org-key", payer: "organization", ...routine };
  return { ok: false, reason: "no_access", cause: "no_credentials", ...who };
}

export interface MaterializeDeps {
  dataDir: string;
  resolveKey: (sub: string, provider: ModelProvider) => Promise<ProviderKeyResult>;
  invalidate: (sub: string, provider: ModelProvider) => void;
  /** The person's login directory for a driver (principal-engine-logins.ts). */
  loginDir: (principalId: string, driver: SubscriptionDriver) => string;
}

export type MaterializedAccess =
  | { ok: true; access: TurnAccess; plan: Extract<EngineCredentialPlan, { ok: true }> }
  | { ok: false; reason: EngineAccessRefusal; detail?: "perspicax_unreachable"; plan?: Extract<EngineCredentialPlan, { ok: false }> };

/** The payer's facts again, for the key step at dispatch. */
function payerFacts(input: EngineCredentialInput, principalId: string): PersonFacts | undefined {
  return key(principalId) === key(input.owner.principalId) ? input.owner : input.person?.(principalId);
}

/** Turn a plan into what the driver needs, fetching the payer's key when the
 * plan uses it. A key Perspicax no longer has (no_key, user_inactive) falls
 * through to the next steps; an unreachable Perspicax is no_access. */
export async function materializeEngineAccess(input: EngineCredentialInput, plan: EngineCredentialPlan, deps: MaterializeDeps): Promise<MaterializedAccess> {
  if (!plan.ok) return { ok: false, reason: plan.reason, plan };
  const driver = input.instance.driver;
  const payer = plan.payerPrincipalId ?? "";
  if (plan.via === "subscription" && subscriptionDriver(driver) && payer) {
    const dir = deps.loginDir(payer, driver);
    const where = driver === "claudeAgent" ? { claudeConfigDir: dir } : driver === "codex" ? { codexHome: dir } : { engineHome: dir };
    return { ok: true, plan, access: { via: "subscription", identity: `subscription:${payer}`, ...where } };
  }
  if (keyVia(plan.via) && plan.provider && payer) {
    const facts = payerFacts(input, payer);
    const sub = facts?.sub;
    if (!sub) return materializeEngineAccess(input, resolveEngineAccess(input, { key: true }), deps);
    if (facts?.disabled) {
      // disabled since admission: never read the (cached) key
      deps.invalidate(sub, plan.provider);
      return materializeEngineAccess(input, resolveEngineAccess(input, { key: true }), deps);
    }
    const result = await deps.resolveKey(sub, plan.provider);
    if (result.ok && homeDriver(driver)) {
      // An empty home of the payer's for the engine: their key, never the
      // server's own login (a Grok cached token outranks a key).
      const environment: Record<string, string> = { [PROVIDER_KEY_ENV[plan.provider]]: result.key };
      const fingerprints = [result.fingerprint || "key"];
      if (driver === "piAgent") {
        // pi reaches every provider the payer keeps a key for; the picked
        // model decides which one a turn uses.
        for (const other of providersOfDriver(driver)) {
          if (other === plan.provider || !input.hasKey(sub, other)) continue;
          const more = await deps.resolveKey(sub, other);
          if (!more.ok) continue;
          environment[PROVIDER_KEY_ENV[other]] = more.key;
          fingerprints.push(more.fingerprint || "key");
        }
      }
      return {
        ok: true,
        plan,
        access: {
          via: plan.via,
          identity: `${plan.via}:${payer}:${fingerprints.join("+")}`,
          environment,
          engineHome: join(deps.dataDir, "principals", payer, `${driver}-key`),
        },
      };
    }
    if (result.ok) {
      const identity = `${plan.via}:${payer}:${result.fingerprint || "key"}`;
      if (plan.provider === "anthropic") return { ok: true, plan, access: { via: plan.via, identity, environment: { ANTHROPIC_API_KEY: result.key } } };
      return {
        ok: true,
        plan,
        access: {
          via: plan.via,
          identity,
          environment: { SAGAX_OWNER_OPENAI_API_KEY: result.key },
          codexHome: join(deps.dataDir, "principals", payer, "codex-key"),
          codexOwnerKey: true,
        },
      };
    }
    if (result.error === "no_key") {
      deps.invalidate(sub, plan.provider);
      return materializeEngineAccess(input, resolveEngineAccess(input, { key: true }), deps);
    }
    if (result.error === "user_inactive") {
      // Perspicax says the payer is out: refused, never the organization's
      deps.invalidate(sub, plan.provider);
      const refused = { ok: false as const, reason: "no_access" as const, cause: "payer_disabled" as const, payer: plan.payer === "owner" ? "owner" as const : "speaker" as const, payerPrincipalId: payer, ...(plan.routine ? { routine: true as const } : {}) };
      return { ok: false, reason: "no_access", plan: refused };
    }
    return { ok: false, reason: "no_access", detail: "perspicax_unreachable" };
  }
  if (plan.via === "org-key") {
    // The organization's key comes from the instance's own environment; an
    // engine with a home of its own still gets an empty one, never the
    // server's login.
    const home = homeDriver(driver) ? { engineHome: join(deps.dataDir, "org", `${driver}-key`) } : {};
    return { ok: true, plan, access: { via: "org-key", identity: "org-key", ...home } };
  }
  return { ok: true, plan, access: { via: "server", identity: "server" } };
}
