// A thread runs on its bot's model unless a person picked another model in
// that thread. The server stores no model for a thread that follows its bot;
// the wire carries the model the thread runs on plus followsBotModel, so the
// app and the phones read one effective model either way.
import type { ModelSelection } from "./wire.ts";

/** The same engine, model, effort and variant. */
export function sameModelSelection(a: ModelSelection | undefined, b: ModelSelection | undefined): boolean {
  if (!a || !b) return a === b;
  return a.instanceId === b.instanceId && a.model === b.model && a.effort === b.effort && a.variant === b.variant;
}
