// Popped-out artifacts as floating windows (src/lib/floating-windows.ts, the
// generic manager the terminal uses too; docs/superpowers/specs/2026-10-16-artifacts-design.md).
//
// Whether an artifact is popped out is the server's (`popped`: the bot may
// set it, Pop out and Dock change it). Where its window sits is this
// device's: the manager remembers each id's place in localStorage, and a
// popped window is `persist`, so it is back at its place the moment Sagax
// starts, before the server answers. Then reconcile() makes the windows
// match the server: a docked or deleted artifact's window closes, a popped
// one opens. Closing a window is docking it.
import { floatingWindows, type FloatingWindows } from "@/lib/floating-windows";
import { setArtifactFlags } from "@/lib/artifacts";
import { ARTIFACT_LIMITS, type ArtifactBounds, type ArtifactSummary } from "../../../shared/artifacts";

export const ARTIFACT_WINDOW_KIND = "artifact";
const DEFAULT_SIZE = { width: 520, height: 380 };

export interface ArtifactWindowData {
  botId: string;
  artifactId: string;
}

export function artifactWindowId(artifactId: string): string {
  return `artifact:${artifactId}`;
}

export function artifactWindowData(value: unknown): ArtifactWindowData | null {
  if (!value || typeof value !== "object") return null;
  const { botId, artifactId } = value as Record<string, unknown>;
  return typeof botId === "string" && typeof artifactId === "string" ? { botId, artifactId } : null;
}

/** Windows closed by reconcile or Dock, not by the person's close button:
 * their close must not dock the artifact a second time. */
const quietSets = new WeakMap<FloatingWindows, Set<string>>();
/** Windows whose close handler is set in this session. A window restored
 * from the last session has none until reconcile opens it again. */
const boundSets = new WeakMap<FloatingWindows, Set<string>>();
function setOf(map: WeakMap<FloatingWindows, Set<string>>, manager: FloatingWindows): Set<string> {
  let set = map.get(manager);
  if (!set) map.set(manager, set = new Set());
  return set;
}

type Artifactish = Pick<ArtifactSummary, "id" | "botId" | "title"> & { bounds?: ArtifactBounds };

/** Open (or bring forward) an artifact's window. `onDock` runs when the
 * person closes it. The bot's bounds place it the first time only: after
 * that the place the person left it wins. */
export function openArtifactWindow(artifact: Artifactish, onDock: (artifact: ArtifactWindowData) => void, manager: FloatingWindows = floatingWindows()): void {
  const id = artifactWindowId(artifact.id);
  const quiet = setOf(quietSets, manager);
  const bound = setOf(boundSets, manager);
  const data: ArtifactWindowData = { botId: artifact.botId, artifactId: artifact.id };
  const fresh = !manager.isOpen(id) && !manager.rememberedRect(id);
  manager.open({
    id,
    kind: ARTIFACT_WINDOW_KIND,
    title: artifact.title,
    data,
    persist: true,
    size: artifact.bounds ? { width: artifact.bounds.width, height: artifact.bounds.height } : DEFAULT_SIZE,
    minWidth: ARTIFACT_LIMITS.minWidth,
    minHeight: ARTIFACT_LIMITS.minHeight,
    onClose: () => {
      bound.delete(id);
      if (quiet.delete(id)) return;
      onDock(data);
    },
  });
  bound.add(id);
  if (fresh && artifact.bounds) manager.setRect(id, artifact.bounds);
}

/** Close an artifact's window without docking it again. */
export function closeArtifactWindow(artifactId: string, manager: FloatingWindows = floatingWindows()): void {
  const id = artifactWindowId(artifactId);
  if (!manager.isOpen(id)) return;
  const quiet = setOf(quietSets, manager);
  quiet.add(id);
  manager.close(id);
  quiet.delete(id);
}

/** Make the open windows match the server's list of artifacts. */
export function reconcileArtifactWindows(list: readonly ArtifactSummary[], onDock: (artifact: ArtifactWindowData) => void, manager: FloatingWindows = floatingWindows()): void {
  const popped = new Map(list.filter((artifact) => artifact.popped).map((artifact) => [artifactWindowId(artifact.id), artifact]));
  for (const entry of manager.snapshot().windows) {
    if (entry.kind !== ARTIFACT_WINDOW_KIND || popped.has(entry.id)) continue;
    const data = artifactWindowData(entry.data);
    if (data) closeArtifactWindow(data.artifactId, manager);
    else manager.close(entry.id);
  }
  // A window already open in this session stays where it is in the stack;
  // a restored one gets its close handler back (in stack order); a new one opens.
  const bound = setOf(boundSets, manager);
  const order = manager.snapshot().windows.map((entry) => entry.id);
  const ranked = [...popped.entries()].sort(([a], [b]) => rank(order, a) - rank(order, b));
  for (const [id, artifact] of ranked) {
    if (manager.isOpen(id) && bound.has(id)) continue;
    openArtifactWindow(artifact, onDock, manager);
  }
}

function rank(order: readonly string[], id: string): number {
  const index = order.indexOf(id);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

/** Closing a window docks its artifact: it does not reopen next start. */
export function dockArtifact(data: ArtifactWindowData): void {
  void setArtifactFlags(data.botId, data.artifactId, { popped: false }).catch(() => {});
}

/** Pop an artifact out: its window opens now and comes back at its place
 * when Sagax starts again, until it is docked. */
export function popOutArtifact(artifact: { id: string; botId: string; title: string; bounds?: { x: number; y: number; width: number; height: number } }): Promise<void> {
  openArtifactWindow(artifact, dockArtifact);
  return setArtifactFlags(artifact.botId, artifact.id, { popped: true }).then(() => undefined).catch((reason: unknown) => {
    closeArtifactWindow(artifact.id);
    throw reason;
  });
}

/** Dock a popped-out artifact from anywhere (the Files tab's menu). */
export function dockArtifactWindow(artifact: { id: string; botId: string }): Promise<void> {
  closeArtifactWindow(artifact.id);
  return setArtifactFlags(artifact.botId, artifact.id, { popped: false }).then(() => undefined);
}
