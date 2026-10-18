// The model providers (engines) offered to one person: the one answer every
// list of providers or models reads, on the server (GET /api/instances,
// GET /api/me/engines, the Primary Bot's team setup catalog) and in the app
// (the composer's model menu and window, New bot, a bot's backups and
// recovery, Settings > Models and voice, onboarding). 2026-10-18 (JC): a
// provider the organization hid in Perspicax appears nowhere.
//
// - Solo server (no organization): every engine, nothing changes.
// - Organization server: an engine outside the organization's list
//   (`allowedEngines`, shared/org-allowed-engines.ts: null or absent is
//   every engine, [] is none since Sagax 0.5.12) is "notAllowed" and
//   dropped everywhere, even when the person connected it before.
// - An engine the organization pays for but has not given this person
//   (`sagax_server_engines`, GET /api/me/engines `orgKeyNotGiven`) and that
//   nothing of their own serves is "notGiven": not offered to pick, still
//   listed in Settings, where the person can connect their own account.
import { engineAllowed, type AllowedEngines } from "./org-allowed-engines.ts";

export type EngineOffer = "offered" | "notAllowed" | "notGiven";

/** A person's own access to one engine, as GET /api/me/engines says it. */
export interface PersonEngineAccess {
  instanceId: string;
  orgKeyNotGiven?: boolean;
  myTurns?: string;
}

export interface EngineOfferContext {
  /** An organization server (Perspicax sign-in). */
  organization: boolean;
  /** The organization's list (`allowedEngines`). */
  allowedEngines: AllowedEngines;
  /** The person's own access, when known (null while loading). */
  mine?: readonly PersonEngineAccess[] | null;
}

/** Whether this engine is offered to the person, and why not. */
export function engineOffer(context: EngineOfferContext, instanceId: string): EngineOffer {
  if (!context.organization) return "offered";
  if (!engineAllowed(context.allowedEngines, instanceId)) return "notAllowed";
  const access = context.mine?.find((engine) => engine.instanceId === instanceId);
  if (access?.orgKeyNotGiven === true && access.myTurns === "none") return "notGiven";
  return "offered";
}

/**
 * The engines offered, in their order. `pick` (the default) keeps only the
 * ones the person can pick a model from; `settings` also keeps the ones the
 * organization did not give them, so they can connect their own account.
 */
export function offeredEngines<T extends { instanceId: string }>(
  instances: readonly T[],
  context: EngineOfferContext,
  purpose: "pick" | "settings" = "pick",
): T[] {
  if (!context.organization) return [...instances];
  return instances.filter((instance) => {
    const offer = engineOffer(context, instance.instanceId);
    return offer === "offered" || (purpose === "settings" && offer === "notGiven");
  });
}

/** A bot moved off an engine the organization no longer allows: the names
 * of the engine it left and of the one Auto now starts on. */
export interface OrgEngineMove {
  from: string;
  to: string;
}

/** The plain line a moved bot's conversation keeps, for a client that does
 * not draw `tool.engineMove` in its own language. */
export function orgEngineMoveLine(move: OrgEngineMove): string {
  return `Your organization no longer offers ${move.from}. This bot now uses Auto, starting on ${move.to}.`;
}
