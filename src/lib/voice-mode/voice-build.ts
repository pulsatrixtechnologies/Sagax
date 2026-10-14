// Which builds hear full-duplex by default (issue #292). None: the
// Advanced toggle turns it on, and the server honours it only with
// SAGAX_VOICE_FULL_DUPLEX=1.

/** Rev 3: the "on" every 0.5.x build stored as its default is dropped. */
export const FULL_DUPLEX_REV = 3;

export interface VoiceBuildChannel {
  /** Vite DEV / unpackaged Electron */
  dev?: boolean;
  /** iOS TestFlight (sandbox receipt) */
  testFlight?: boolean;
  /** App Store or an explicit public channel */
  publicRelease?: boolean;
}

/** Full-duplex is off by default on every channel. */
export function defaultFullDuplex(_channel: VoiceBuildChannel = {}): boolean {
  return false;
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
