// The pod registry. A pod is one file under ./pods/ that calls
// registerDevPod; ./all-pods.ts picks every such file up, so adding a pod
// is adding a file. Each pod owns its data (useData, run inside the pod's
// own error boundary), its loading, empty and error states, and its body.
import type { ComponentType, Dispatch } from "react";
import type { LucideIcon } from "lucide-react";
import type { ComputerStart } from "@/lib/computer-start";
import type { Action, Bot, Message, Task } from "@/state/store";

export interface DevPodContext {
  bot: Bot;
  task: Task | undefined;
  /** The visible branch of the open conversation. */
  messages: readonly Message[];
  /** bot id and thread id: where per-conversation choices are kept. */
  threadKey: string;
  computerStart: ComputerStart | undefined;
  dispatch: Dispatch<Action>;
}

export type DevPodData<T> =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message?: string; retry?: () => void }
  | { status: "ready"; data: T };

export interface DevPodDefinition<T = unknown> {
  id: string;
  /** Default place in the rail, smaller first; the person's order wins. */
  order: number;
  title: () => string;
  icon: LucideIcon;
  /** Collapsible pods keep their collapse state per pod. */
  collapsible: boolean;
  useData: (ctx: DevPodContext) => DevPodData<T>;
  Body: ComponentType<{ data: T; ctx: DevPodContext }>;
  /** A short figure beside the title (the Context pod's percent). */
  Summary?: ComponentType<{ data: T; ctx: DevPodContext }>;
}

const registry = new Map<string, DevPodDefinition>();
const listeners = new Set<() => void>();

/** Add a pod, or replace the one with the same id (hot reload). */
export function registerDevPod<T>(definition: DevPodDefinition<T>): void {
  registry.set(definition.id, definition as unknown as DevPodDefinition);
  for (const listener of listeners) listener();
}

export function unregisterDevPod(id: string): void {
  if (registry.delete(id)) for (const listener of listeners) listener();
}

/** Every registered pod in its default order. */
export function devPodDefinitions(): DevPodDefinition[] {
  return [...registry.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** The pods on screen: the person's saved order first (ids that no longer
 * exist fall away), then the others in their default order, minus the
 * hidden ones. */
export function arrangePods(definitions: readonly DevPodDefinition[], order: readonly string[], hidden: readonly string[]): DevPodDefinition[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const placed = order.flatMap((id) => {
    const definition = byId.get(id);
    if (!definition) return [];
    byId.delete(id);
    return [definition];
  });
  const rest = definitions.filter((definition) => byId.has(definition.id));
  const hiddenSet = new Set(hidden);
  return [...placed, ...rest].filter((definition) => !hiddenSet.has(definition.id));
}

export function subscribeDevPods(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let version = 0;
subscribeDevPods(() => { version += 1; });
/** Bumped on every register or unregister: a stable snapshot for useSyncExternalStore. */
export const devPodsVersion = () => version;
