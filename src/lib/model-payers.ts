// Who pays for a turn on an organization server, as the model picker shows
// it. Mirrors the order of server/engine-credentials.ts (first match wins):
// the person's own subscription, then their model key in Perspicax, then
// (organization admins only) the server's own account, then the
// organization key. Solo servers have no payer order: the server's own
// configuration serves every turn.
import type { MyEngine } from "@/lib/perspicax-org";

export type PayerId = "subscription" | "ownerKey" | "server" | "orgKey";

export interface PayerRow {
  id: PayerId;
  /** This payer can serve a turn now. */
  ready: boolean;
}

export interface PayerOrder {
  rows: PayerRow[];
  /** The first ready payer: the one a turn uses now. Null when none is. */
  current: PayerId | null;
}

/** Drivers whose provider key a person can keep in Perspicax. */
function keyProviderDriver(driver: string): boolean {
  return driver === "claudeAgent" || driver === "codex";
}

export function payerOrder(
  engine: Pick<MyEngine, "driver" | "installed" | "subscription" | "ownerKey" | "orgKey">,
  options: { admin: boolean; serverSignedIn: boolean },
): PayerOrder {
  const rows: PayerRow[] = [];
  if (engine.subscription.supported) rows.push({ id: "subscription", ready: engine.subscription.signedIn });
  if (keyProviderDriver(engine.driver)) rows.push({ id: "ownerKey", ready: engine.ownerKey });
  if (options.admin) rows.push({ id: "server", ready: options.serverSignedIn });
  rows.push({ id: "orgKey", ready: engine.orgKey });
  const current = engine.installed ? rows.find((row) => row.ready)?.id ?? null : null;
  return { rows, current };
}

export type OrgEngineState = "connected" | "signInRequired" | "noAccess" | "notInstalled";

/** One word for the provider column: connected, or what is missing. */
export function orgEngineState(
  engine: Pick<MyEngine, "driver" | "installed" | "subscription" | "ownerKey" | "orgKey">,
  options: { admin: boolean; serverSignedIn: boolean },
): OrgEngineState {
  if (!engine.installed) return "notInstalled";
  if (payerOrder(engine, options).current) return "connected";
  return engine.subscription.supported ? "signInRequired" : "noAccess";
}
