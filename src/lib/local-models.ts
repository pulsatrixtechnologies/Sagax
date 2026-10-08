// Local models in the model picker: which rows are local, whether the
// engine being browsed can run them, and the probe that runs when the
// picker opens (so a server started after launch shows up).
import { isDesktopModelId, localModelUnavailable, type LocalModelUnavailable } from "../../shared/local-model-engines";

export { isDesktopModelId };

type Row = { id: string; local?: boolean; custom?: boolean; anthropic?: boolean };

/** Local rows for the Local group. On an organization server only the
 * person's own computer counts: the server's own loopback models would run
 * on the server's machine, so they are never offered there. */
export function localModelRows<T extends Row>(options: readonly T[], orgMode: boolean): T[] {
  return options.filter((option) => orgMode
    ? isDesktopModelId(option.id)
    : option.local === true || isDesktopModelId(option.id));
}

/** Null when the engine can run this row, else why it cannot. */
export function localRowUnavailable(driverKind: string | undefined, id: string, speaksAnthropic?: boolean): LocalModelUnavailable | null {
  return localModelUnavailable(driverKind, isDesktopModelId(id) ? "desktop" : "loopback", speaksAnthropic);
}

/** Whether this engine lists and runs this machine's loopback models (solo). */
export function runsLoopbackModels(driverKind: string | undefined): boolean {
  return localModelUnavailable(driverKind, "loopback") === null;
}

/** How long a probe answer stays fresh: reopening the picker right away does
 * not probe again. */
export const LOCAL_REFRESH_FRESH_MS = 10_000;

const lastRefresh = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

/** Test hook. */
export function resetLocalRefreshCache(): void {
  lastRefresh.clear();
  inFlight.clear();
}

/**
 * Probe local models for the picker that just opened, at most once per
 * LOCAL_REFRESH_FRESH_MS per key.
 * - Solo: re-reads the engine's catalog (`refreshModels`), which probes this
 *   machine's loopback servers.
 * - Organization server: asks this desktop app to probe the person's own
 *   computer and publish (`bridgeRefresh`), then reloads the catalog the
 *   server overlays for this person (`reload`).
 * Never rejects: an offline app keeps its last catalog.
 */
export function refreshLocalModelsOnOpen(input: {
  key: string;
  orgMode: boolean;
  refreshModels?: () => Promise<void>;
  bridgeRefresh?: () => Promise<unknown>;
  reload?: () => Promise<void>;
  now?: () => number;
}): Promise<void> {
  const now = input.now ?? Date.now;
  const key = `${input.orgMode ? "org" : "solo"}:${input.key}`;
  const running = inFlight.get(key);
  if (running) return running;
  const last = lastRefresh.get(key);
  if (last !== undefined && now() - last < LOCAL_REFRESH_FRESH_MS) return Promise.resolve();
  const work = (async () => {
    try {
      if (input.orgMode) {
        if (!input.bridgeRefresh) return;
        await input.bridgeRefresh();
        await input.reload?.();
      } else {
        await input.refreshModels?.();
      }
    } catch {
      // Keep the last known catalog.
    }
  })().finally(() => {
    lastRefresh.set(key, now());
    inFlight.delete(key);
  });
  inFlight.set(key, work);
  return work;
}
