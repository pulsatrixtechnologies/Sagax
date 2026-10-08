// About and the Help menu both open the same dialog. A tiny bus keeps that
// call out of the store and out of prop drilling.

/** "current" is the running version alone; "browse" adds the version picker. */
export type ReleaseNotesMode = "current" | "browse";

type ReleaseNotesListener = (mode: ReleaseNotesMode) => void;

const listeners = new Set<ReleaseNotesListener>();

export function requestReleaseNotes(mode: ReleaseNotesMode = "current"): void {
  for (const listener of listeners) listener(mode);
}

export function subscribeReleaseNotes(listener: ReleaseNotesListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
