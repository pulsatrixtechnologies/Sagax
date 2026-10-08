// Who pays for a person's turns on an organization server, as the model
// picker shows it. The server decides (server/engine-credentials.ts, the
// person who speaks pays, 2026-10-01) and answers it per engine as
// `myTurns` on GET /api/me/engines; this module only lays out the rows in
// that order and never recomputes the choice. A routine pays as the bot's
// owner. Solo servers have no payer order.
import type { MyEngine } from "@/lib/perspicax-org";

/** A payer the person's own turns can use, in engine-credentials.ts order:
 * their subscription, their key in Perspicax, the organization's key. */
export type PayerId = Exclude<MyEngine["myTurns"], "none">;

export const PAYER_ORDER: readonly PayerId[] = ["subscription", "key", "org-key"];

export interface PayerRow {
  id: PayerId;
  /** This payer is available to the person (it may still not be first). */
  ready: boolean;
}

export interface PayerOrder {
  rows: PayerRow[];
  /** The server's answer: the payer the person's turns use now, or null. */
  current: PayerId | null;
}

type EngineFacts = Pick<MyEngine, "installed" | "notAvailable" | "subscription" | "myKey" | "orgKey" | "myTurns"> & { driver: string };

/** Drivers whose provider key a person can keep in Perspicax
 * (server/engine-credentials.ts providersOfDriver). */
export function keyProviderDriver(driver: string): boolean {
  return ["claudeAgent", "codex", "grokAgent", "geminiAgent", "kimiAgent", "piAgent"].includes(driver);
}

export function payerOrder(engine: EngineFacts): PayerOrder {
  const ready: Record<PayerId, boolean> = { subscription: engine.subscription.signedIn, key: engine.myKey, "org-key": engine.orgKey };
  const rows = PAYER_ORDER
    .filter((id) => (id === "subscription" ? engine.subscription.supported : id === "key" ? keyProviderDriver(engine.driver) : true))
    .map((id) => ({ id, ready: ready[id] }));
  return { rows, current: engine.myTurns === "none" ? null : engine.myTurns };
}

export type OrgEngineState = "connected" | "signInRequired" | "noAccess" | "notInstalled" | "notAvailable";

/** One word for the provider column: connected, or what is missing. */
export function orgEngineState(engine: EngineFacts): OrgEngineState {
  if (!engine.installed) return engine.notAvailable ? "notAvailable" : "notInstalled";
  if (engine.myTurns !== "none") return "connected";
  return engine.subscription.supported ? "signInRequired" : "noAccess";
}
