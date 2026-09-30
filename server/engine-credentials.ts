// Which credentials a turn runs with on an organization server (slice 4,
// decision D8). Replaces the slice 3 gate (engine-access.ts engineAccessFor
// stays as a thin wrapper for its tests).
//
// Order, first match wins:
//   1. the instance's CLI is not installed              -> engine_missing
//   2. the owner speaks and is signed in to this engine
//      with their own subscription                      -> subscription
//   3. the owner keeps a key for the engine's provider
//      in Perspicax (claudeAgent: anthropic, codex:
//      openai); any speaker                             -> owner-key
//   4. the owner speaks and is an organization admin    -> server
//   5. memberBotsUseOrgKey and a key-backed instance    -> org-key
//   6. otherwise                                        -> no_access
//
// A subscription serves only its owner speaking (their routines count as
// them); an owner key serves everyone the bot is shared with, and its cost
// lands on the owner's account. Solo mode is unchanged: the server's own
// configuration serves every turn.
//
// The key itself is fetched at dispatch (materializeEngineAccess) through
// the Perspicax link, kept in memory 60 s at most, and put into that one
// turn's environment. It is never written to disk or logged.
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// section 4 bis.
import { join } from "node:path";

import { speakerPrincipal, type EngineAccessRefusal, type TurnSpeaker } from "./engine-access.ts";
import type { ModelProvider, ProviderKeyResult } from "./perspicax-link.ts";

export type AccessVia = "subscription" | "owner-key" | "server" | "org-key";

/** What a driver receives for one turn (contracts.ts SendTurnInput.access). */
export interface TurnAccess {
  via: AccessVia;
  /** A non-secret label: subscription:<pid>, owner-key:<pid>:<fingerprint>,
   * server, org-key. A retained engine process is reused only for the same
   * identity. */
  identity: string;
  /** Extra environment for this turn only (the owner's key). */
  environment?: Record<string, string>;
  /** Claude: the person's own login directory (CLAUDE_CONFIG_DIR). */
  claudeConfigDir?: string;
  /** Codex: the CODEX_HOME for this turn. */
  codexHome?: string;
  /** Codex: run on the owner's OpenAI key (the pulsa_owner provider). */
  codexOwnerKey?: boolean;
}

/** The model provider behind a driver, when an owner key can serve it. */
export function providerOfDriver(driver: string): ModelProvider | null {
  if (driver === "claudeAgent") return "anthropic";
  if (driver === "codex") return "openai";
  return null;
}

/** Drivers a person can sign in to with their own subscription. */
export function subscriptionDriver(driver: string): driver is "claudeAgent" | "codex" {
  return driver === "claudeAgent" || driver === "codex";
}

export interface EngineCredentialInput {
  identity: "solo" | "perspicax";
  speaker: TurnSpeaker;
  peerOwnerPrincipalId?: string;
  owner: { principalId: string; sub?: string; orgRole: "admin" | "member" | undefined; disabled?: boolean };
  instance: { instanceId: string; driver: string; installed: boolean };
  /** The owner signed in to this driver with their own subscription (D10). */
  subscriptionSignedIn: (principalId: string, driver: string) => boolean;
  /** The directory lists this provider for the owner (names only). */
  ownerHasKey: (sub: string, provider: ModelProvider) => boolean;
  memberBotsUseOrgKey: boolean;
  keyBacked: boolean;
}

export type EngineCredentialPlan =
  | { ok: true; via: AccessVia; provider?: ModelProvider }
  | { ok: false; reason: EngineAccessRefusal };

const key = (id: string | undefined) => id?.trim().toLowerCase() ?? "";

/** The resolution order above, pure. */
export function resolveEngineAccess(input: EngineCredentialInput, skip: { ownerKey?: boolean } = {}): EngineCredentialPlan {
  if (input.identity !== "perspicax") return { ok: true, via: "server" };
  if (!input.instance.installed) return { ok: false, reason: "engine_missing" };
  const speaker = key(speakerPrincipal(input.speaker, input.owner.principalId, input.peerOwnerPrincipalId));
  const ownerSpeaks = speaker !== "" && speaker === key(input.owner.principalId);
  const driver = input.instance.driver;
  if (ownerSpeaks && subscriptionDriver(driver) && input.subscriptionSignedIn(input.owner.principalId, driver)) {
    return { ok: true, via: "subscription" };
  }
  const provider = providerOfDriver(driver);
  // A disabled owner's key serves nobody (S4-14): the back-channel logout or
  // the directory marked them out, whatever the key cache still holds.
  if (!skip.ownerKey && !input.owner.disabled && provider && input.owner.sub && input.ownerHasKey(input.owner.sub, provider)) {
    return { ok: true, via: "owner-key", provider };
  }
  if (ownerSpeaks && input.owner.orgRole === "admin") return { ok: true, via: "server" };
  if (input.memberBotsUseOrgKey && input.keyBacked) return { ok: true, via: "org-key" };
  return { ok: false, reason: "no_access" };
}

export interface MaterializeDeps {
  dataDir: string;
  resolveKey: (sub: string, provider: ModelProvider) => Promise<ProviderKeyResult>;
  invalidate: (sub: string, provider: ModelProvider) => void;
  /** The person's login directory for a driver (principal-engine-logins.ts). */
  loginDir: (principalId: string, driver: "claudeAgent" | "codex") => string;
}

export type MaterializedAccess =
  | { ok: true; access: TurnAccess }
  | { ok: false; reason: EngineAccessRefusal; detail?: "perspicax_unreachable" };

/** Turn a plan into what the driver needs, fetching the owner key when the
 * plan uses it. A key Perspicax no longer has (no_key, user_inactive) falls
 * through to the next steps; an unreachable Perspicax is no_access. */
export async function materializeEngineAccess(input: EngineCredentialInput, plan: EngineCredentialPlan, deps: MaterializeDeps): Promise<MaterializedAccess> {
  if (!plan.ok) return plan;
  const owner = input.owner.principalId;
  const driver = input.instance.driver;
  if (plan.via === "subscription" && subscriptionDriver(driver)) {
    const dir = deps.loginDir(owner, driver);
    return { ok: true, access: { via: "subscription", identity: `subscription:${owner}`, ...(driver === "claudeAgent" ? { claudeConfigDir: dir } : { codexHome: dir }) } };
  }
  if (plan.via === "owner-key" && plan.provider && input.owner.sub) {
    if (input.owner.disabled) {
      deps.invalidate(input.owner.sub, plan.provider);
      return materializeEngineAccess(input, resolveEngineAccess(input, { ownerKey: true }), deps);
    }
    const result = await deps.resolveKey(input.owner.sub, plan.provider);
    if (result.ok) {
      const identity = `owner-key:${owner}:${result.fingerprint || "key"}`;
      if (plan.provider === "anthropic") return { ok: true, access: { via: "owner-key", identity, environment: { ANTHROPIC_API_KEY: result.key } } };
      return {
        ok: true,
        access: {
          via: "owner-key",
          identity,
          environment: { OMB_OWNER_OPENAI_API_KEY: result.key },
          codexHome: join(deps.dataDir, "principals", owner, "codex-key"),
          codexOwnerKey: true,
        },
      };
    }
    if (result.error === "no_key" || result.error === "user_inactive") {
      deps.invalidate(input.owner.sub, plan.provider);
      return materializeEngineAccess(input, resolveEngineAccess(input, { ownerKey: true }), deps);
    }
    return { ok: false, reason: "no_access", detail: "perspicax_unreachable" };
  }
  if (plan.via === "server") return { ok: true, access: { via: "server", identity: "server" } };
  return { ok: true, access: { via: "org-key", identity: "org-key" } };
}
