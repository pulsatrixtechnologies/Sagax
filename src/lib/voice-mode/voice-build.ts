// Which builds hear full-duplex by default (issue #292). Internal,
// TestFlight, Vite DEV and packaged Electron are ON so JC actually hears
// it. A public App Store / SAGAX_PUBLIC_RELEASE channel stays OFF. The
// Advanced toggle is the kill-switch either way.

export const FULL_DUPLEX_REV = 2;

export interface VoiceBuildChannel {
  /** Vite DEV / unpackaged Electron */
  dev?: boolean;
  /** iOS TestFlight (sandbox receipt) */
  testFlight?: boolean;
  /** App Store or an explicit public channel */
  publicRelease?: boolean;
}

/** Full-duplex is the call's default on every channel we ship today.
 * Public App Store is the only off-by-default channel. */
export function defaultFullDuplex(channel: VoiceBuildChannel = {}): boolean {
  if (channel.publicRelease) return false;
  return true;
}

function envFlag(name: string): boolean {
  try {
    const meta = import.meta as { env?: Record<string, unknown> };
    if (meta.env?.[name] === true || meta.env?.[name] === "true") return true;
  } catch {
    /* no import.meta.env */
  }
  try {
    if (typeof process !== "undefined" && process.env?.[name] === "1") return true;
  } catch {
    /* no process */
  }
  return false;
}

/** This computer's channel. Tests pass an explicit object instead. */
export function thisVoiceBuild(): VoiceBuildChannel {
  return {
    dev: envFlag("DEV"),
    publicRelease: envFlag("SAGAX_PUBLIC_RELEASE"),
  };
}
