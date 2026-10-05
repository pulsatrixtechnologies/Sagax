// About and the Help menu both open the same dialog. A tiny bus keeps that
// call out of the store and out of prop drilling.

type ReleaseNotesListener = () => void;

const listeners = new Set<ReleaseNotesListener>();

export function requestReleaseNotes(): void {
  for (const listener of listeners) listener();
}

export function subscribeReleaseNotes(listener: ReleaseNotesListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
