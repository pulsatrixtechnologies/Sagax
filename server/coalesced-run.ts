// One run of `work` at a time. A caller that asks while a run is under way
// shares one more run that starts after it, so whatever it asked for is
// read after it asked, however many callers arrived meanwhile. The promise
// rejects when the last run did.
export function coalescedRun(work: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let failure: { error: unknown } | null = null;
      do {
        again = false;
        try {
          await work();
          failure = null;
        } catch (error) {
          failure = { error };
        }
      } while (again);
      if (failure) throw failure.error;
    })().finally(() => { running = null; });
    return running;
  };
}
