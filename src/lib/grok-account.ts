// Whether this person has linked a Grok account. Shapes stays hidden until
// they have: a Grok sign-in on this server, or their own xAI key. An
// organization key they did not add does not count. The editor reads the
// flag; the achievements boot records it once so the unlock follows the person.
import { useSyncExternalStore } from "react";

export interface GrokAccountInput {
  /** Settings saved an xAI key for this server (solo) or this person. */
  xaiConfigured?: boolean;
  instances?: readonly { driverKind?: string; snapshot?: { authenticated?: boolean; account?: unknown } }[];
  /** The person's own engines on an organization server. Null on a solo server. */
  engines?: readonly { driver: string; subscription?: { signedIn?: boolean }; myKey?: boolean }[] | null;
}

/** True when a Grok account is linked for this person, not merely offered by the organization. */
export function grokAccountLinked(input: GrokAccountInput): boolean {
  if (input.xaiConfigured) return true;
  for (const instance of input.instances ?? []) {
    if (instance.driverKind !== "grokAgent" && instance.driverKind !== "grok") continue;
    if (instance.snapshot?.authenticated === true || instance.snapshot?.account) return true;
  }
  for (const engine of input.engines ?? []) {
    if (engine.driver !== "grokAgent") continue;
    if (engine.subscription?.signedIn || engine.myKey) return true;
  }
  return false;
}

let linked = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readGrokAccountLinked(): boolean {
  return linked;
}

/** The achievements boot writes this. The look editor reads it. */
export function setGrokAccountLinked(value: boolean): void {
  if (linked === value) return;
  linked = value;
  for (const listener of listeners) listener();
}

export function useGrokAccountLinked(): boolean {
  // The look editor renders in the client bundle. The same read serves the
  // static markup tests, which take the server snapshot.
  return useSyncExternalStore(subscribe, readGrokAccountLinked, readGrokAccountLinked);
}
