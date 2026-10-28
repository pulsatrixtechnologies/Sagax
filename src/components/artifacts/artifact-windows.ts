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
//
// In the desktop app a popped-out artifact can instead live in a real window
// of its own (electron/artifact-window.mjs): "Open in its own window", or its
// floating panel's title bar dragged out of the app. Which artifacts live
// there is remembered on this device too, so after a restart they come back
// in their own windows (each at its place, kept by the desktop app). The
// floating panel stays whole inside the app's window (`contain`).
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

/** Artifacts shown in a desktop window of their own, outside the app's frame
 * (#1140, electron/artifact-window.mjs). They stay popped out on the server;
 * only the place that draws them changes, so reconcile leaves their floating
 * window closed. Closing the desktop window docks the artifact, like closing a
 * floating one. */
export const OWN_WINDOWS_STORAGE_KEY = "omb.artifactOwnWindows.v1";
const MAX_OWN_WINDOWS = 100;

function readOwnWindows(): Set<string> {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(OWN_WINDOWS_STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && /^[a-zA-Z0-9:_-]{1,128}$/.test(id)).slice(-MAX_OWN_WINDOWS) : []);
  } catch {
    return new Set();
  }
}

function saveOwnWindows(): void {
  try {
    globalThis.localStorage?.setItem(OWN_WINDOWS_STORAGE_KEY, JSON.stringify([...ownWindows].slice(-MAX_OWN_WINDOWS)));
  } catch {
    /* private mode or quota: they still work for this session */
  }
}

const ownWindows = readOwnWindows();
/** Own windows asked for in this session (a restored one is asked once). */
const ownShown = new Set<string>();
/** Asked for and not answered yet: a list from before the ask must not close it. */
const ownPending = new Set<string>();

function forgetOwnWindow(artifactId: string): boolean {
  ownShown.delete(artifactId);
  ownPending.delete(artifactId);
  const had = ownWindows.delete(artifactId);
  if (had) saveOwnWindows();
  return had;
}

/** Tests: forget every own window of this session and device. */
export function resetOwnArtifactWindows(): void {
  ownWindows.clear();
  ownShown.clear();
  ownPending.clear();
  saveOwnWindows();
}

export function artifactHasOwnWindow(artifactId: string): boolean {
  return ownWindows.has(artifactId);
}

/** Whether this page can open an artifact in a window of its own (the desktop app). */
export function canOpenArtifactInOwnWindow(): boolean {
  return typeof window !== "undefined" && typeof window.ogb?.artifactWindow?.open === "function";
}

/** Open an artifact in a window of its own (or bring that window forward):
 * from the Library, its dialog, its floating panel, or the panel dragged out
 * of the app (`at`, the screen point it was let go). The artifact is popped
 * out on the server, so it comes back after a restart; its floating panel
 * closes. Resolves false (and changes nothing) when the desktop app refuses
 * or is not there. */
export async function openArtifactInOwnWindow(
  artifact: { id: string; botId: string; title: string; popped?: boolean },
  options: { at?: { x: number; y: number } } = {},
): Promise<boolean> {
  const bridge = typeof window !== "undefined" ? window.ogb?.artifactWindow : undefined;
  if (!bridge) return false;
  const already = ownWindows.has(artifact.id);
  ownWindows.add(artifact.id);
  ownPending.add(artifact.id);
  const undo = () => {
    ownPending.delete(artifact.id);
    if (!already) ownWindows.delete(artifact.id);
    return false;
  };
  // Popped out first, so the list the server sends next already says so.
  if (artifact.popped !== true) {
    const flagged = await setArtifactFlags(artifact.botId, artifact.id, { popped: true }).then(() => true, () => false);
    if (!flagged) return undo();
  }
  const result = await bridge.open({
    botId: artifact.botId,
    artifactId: artifact.id,
    title: artifact.title,
    ...(options.at ? { x: options.at.x, y: options.at.y } : {}),
  }).catch(() => "refused" as const);
  if (result === "refused") {
    undo();
    // It was asked for out of the Library: back as it was, docked.
    if (artifact.popped !== true) void setArtifactFlags(artifact.botId, artifact.id, { popped: false }).catch(() => {});
    return false;
  }
  ownPending.delete(artifact.id);
  ownShown.add(artifact.id);
  saveOwnWindows();
  closeArtifactWindow(artifact.id);
  return true;
}

/** The person closed an artifact's own window: the artifact is docked. */
export function ownArtifactWindowClosed(data: ArtifactWindowData): void {
  if (!forgetOwnWindow(data.artifactId)) return;
  dockArtifact(data);
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
    // whole inside the app's window, never cut at an edge
    contain: true,
    // its title bar let go outside the app: a window of its own, there
    ...(canOpenArtifactInOwnWindow()
      ? { onDetach: (at: { x: number; y: number }) => void openArtifactInOwnWindow({ id: artifact.id, botId: artifact.botId, title: artifact.title, popped: true }, { at }) }
      : {}),
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
  // An artifact docked (or deleted) while it has a window of its own: that window goes.
  const stillPopped = new Set(list.filter((artifact) => artifact.popped).map((artifact) => artifact.id));
  for (const artifactId of ownWindows) {
    if (stillPopped.has(artifactId) || ownPending.has(artifactId)) continue;
    const shown = ownShown.has(artifactId);
    forgetOwnWindow(artifactId);
    if (shown) void window.ogb?.artifactWindow?.close(artifactId).catch(() => {});
  }
  // One that lived in a window of its own last time (or before the page
  // reloaded) goes back there, without taking the focus; where the desktop
  // app is not there, it is a floating panel again.
  const canOwn = canOpenArtifactInOwnWindow();
  for (const artifact of list) {
    if (!artifact.popped || !ownWindows.has(artifact.id) || ownShown.has(artifact.id) || ownPending.has(artifact.id)) continue;
    if (!canOwn) {
      forgetOwnWindow(artifact.id);
      continue;
    }
    restoreOwnWindow(artifact, onDock, manager);
  }
  const popped = new Map(list.filter((artifact) => artifact.popped && !ownWindows.has(artifact.id)).map((artifact) => [artifactWindowId(artifact.id), artifact]));
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

function restoreOwnWindow(artifact: ArtifactSummary, onDock: (artifact: ArtifactWindowData) => void, manager: FloatingWindows): void {
  const bridge = window.ogb?.artifactWindow;
  if (!bridge) return;
  ownPending.add(artifact.id);
  void bridge.open({ botId: artifact.botId, artifactId: artifact.id, title: artifact.title, focus: false })
    .catch(() => "refused" as const)
    .then((result) => {
      ownPending.delete(artifact.id);
      if (!ownWindows.has(artifact.id)) return;
      if (result === "refused") {
        // the desktop app said no: a floating panel again
        forgetOwnWindow(artifact.id);
        openArtifactWindow(artifact, onDock, manager);
        return;
      }
      ownShown.add(artifact.id);
      closeArtifactWindow(artifact.id, manager);
    });
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
  // One with a window of its own already: asking again brings that one forward.
  if (ownShown.has(artifact.id)) {
    void window.ogb?.artifactWindow?.open({ botId: artifact.botId, artifactId: artifact.id, title: artifact.title }).catch(() => {});
    return Promise.resolve();
  }
  openArtifactWindow(artifact, dockArtifact);
  return setArtifactFlags(artifact.botId, artifact.id, { popped: true }).then(() => undefined).catch((reason: unknown) => {
    closeArtifactWindow(artifact.id);
    throw reason;
  });
}

/** Dock a popped-out artifact from anywhere (the Files tab's menu). */
export function dockArtifactWindow(artifact: { id: string; botId: string }): Promise<void> {
  closeArtifactWindow(artifact.id);
  const shown = ownShown.has(artifact.id);
  if (forgetOwnWindow(artifact.id) && shown) void window.ogb?.artifactWindow?.close(artifact.id).catch(() => {});
  return setArtifactFlags(artifact.botId, artifact.id, { popped: false }).then(() => undefined);
}
