// The computer's idle state for presence (shared/presence.ts): the renderer
// asks before each heartbeat. Only whether the person is at this computer
// leaves the main process: "active", "idle" or "locked", and how many seconds
// since the last input. Nothing about what they were doing.

/** Idle this many seconds: the system says "idle" (the away threshold). */
export const SYSTEM_IDLE_THRESHOLD_SECONDS = 5 * 60;

const STATES = new Set(["active", "idle", "locked", "unknown"]);

/** powerMonitor's answer, made safe: never throws, always one of the states. */
export function systemIdleSnapshot(monitor, threshold = SYSTEM_IDLE_THRESHOLD_SECONDS) {
  let state = "unknown";
  let idleSeconds = 0;
  try {
    const answered = monitor?.getSystemIdleState?.(threshold);
    if (STATES.has(answered)) state = answered;
  } catch {
    state = "unknown";
  }
  try {
    const seconds = Number(monitor?.getSystemIdleTime?.());
    if (Number.isFinite(seconds) && seconds >= 0) idleSeconds = Math.floor(seconds);
  } catch {
    idleSeconds = 0;
  }
  return { state, idleSeconds };
}
