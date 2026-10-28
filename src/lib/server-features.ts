// What the connected server serves, by feature (shared/server-features.ts,
// 2026-10-28). A newer app may draw an older organization server: a feature
// whose route that server lacks is hidden or disabled, with the neutral
// "Available after the server update.", instead of a red "no route".
//
// Three sources, in order:
// - evidence that a route is missing (its call answered "no route", or the
//   admin-scope refusal of a member route that server did not open yet):
//   the feature is "no", whatever else says;
// - the server's own list (`capabilities.features` of its descriptor): a
//   feature it does not name is "no";
// - a server from before the list: "unknown" until the app learns it from
//   what it already gets (the routines listing carries `folders` only where
//   folders exist) or from a call's answer. The server's `version` is not
//   used: it is the base version, the same on every release.
import { useSyncExternalStore } from "react";

import { fetchEnvironmentDescriptor } from "@/lib/environment-descriptor";
import { isServerFeature, type ServerFeature } from "../../shared/server-features";

export type ServerFeatureState = "yes" | "no" | "unknown";

let listed: ReadonlySet<ServerFeature> | null = null;
const evidence = new Map<ServerFeature, boolean>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version += 1;
  for (const listener of listeners) listener();
}

export function serverFeature(feature: ServerFeature): ServerFeatureState {
  const seen = evidence.get(feature);
  if (seen === false) return "no";
  if (listed) return listed.has(feature) ? "yes" : "no";
  return seen === true ? "yes" : "unknown";
}

/** Read the descriptor's list; a descriptor without one leaves every
 * feature to the evidence. */
export function applyServerDescriptor(descriptor: unknown): void {
  const capabilities = descriptor && typeof descriptor === "object" ? Reflect.get(descriptor, "capabilities") : undefined;
  const features = capabilities && typeof capabilities === "object" ? Reflect.get(capabilities, "features") : undefined;
  listed = Array.isArray(features) ? new Set(features.filter(isServerFeature)) : null;
  changed();
}

/** What a call or a listing showed about one feature. */
export function noteServerFeature(feature: ServerFeature, present: boolean): void {
  if (evidence.get(feature) === present) return;
  // A missing route stays missing until the next load; a later success
  // (the server was updated meanwhile) clears it.
  evidence.set(feature, present);
  changed();
}

/** GET /api/routines: a server with routine folders always carries
 * `folders`, one from before them never does. */
export function noteRoutinesListing(body: unknown): void {
  const folders = body && typeof body === "object" ? Reflect.get(body, "folders") : undefined;
  noteServerFeature("routineFolders", Boolean(folders && typeof folders === "object"));
}

/** Ask the server once at start. A failure keeps the evidence path. */
export async function loadServerFeatures(load: () => Promise<Response> = () => fetchEnvironmentDescriptor({ signal: AbortSignal.timeout(5_000) })): Promise<void> {
  try {
    const response = await load();
    if (!response.ok) return;
    applyServerDescriptor(await response.json());
  } catch {
    /* unreachable or not JSON: the evidence decides */
  }
}

export function resetServerFeatures(): void {
  listed = null;
  evidence.clear();
  changed();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The feature's state, re-rendered when it changes. */
export function useServerFeature(feature: ServerFeature): ServerFeatureState {
  useSyncExternalStore(subscribe, () => version, () => version);
  return serverFeature(feature);
}
