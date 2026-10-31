/** Wait until `child` exits. After `graceMs`, SIGKILL so a wedged sidecar
 * (open upgraded WebSockets ignoring SIGTERM) cannot leave Settings stuck or
 * keep port 8810. */
export function waitCompanionExit(child, graceMs = 5_000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    child.once("exit", finish);
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      finish();
    }, graceMs);
    timer.unref?.();
  });
}
