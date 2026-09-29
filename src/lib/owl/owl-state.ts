// How the app's mascot vocabulary drives the owl. The app still speaks in
// MausState (the 39 engine states, plus the ten legacy names stored on older
// bots) and MausMotion one-shot beats; the owl has six states. Pure, so every
// value is pinned by a unit test.
import { normalizeState, type MausMotion, type MausState } from "@/lib/mascot";
import type { OwlState, OwlWingMove } from "./owl-art";

export interface OwlStateMapping {
  state: OwlState;
  /** Play once when the bot enters this state, then rest as idle. */
  oneShot: boolean;
}

/** Every MausState, by the owl state it shows. Anything absent is idle. */
const OWL_STATE_OF: Partial<Record<MausState, OwlState>> = {
  // busy-like: the bot is doing something
  working: "working",
  loading: "working",
  writing: "working",
  dictating: "working",
  sending: "working",
  receiving: "working",
  uploading: "working",
  progress: "working",
  orbit: "working",
  humming: "working",
  dragging: "working",
  // reading / pondering
  thinking: "thinking",
  curious: "thinking",
  searching: "thinking",
  listening: "thinking",
  confused: "thinking",
  suspicious: "thinking",
  radar: "thinking",
  // pleased: a hop, once
  happy: "success",
  proud: "success",
  excited: "success",
  celebrate: "success",
  laughing: "success",
  bouncing: "success",
  // needs attention: a startle, once
  alerting: "alert",
  surprised: "alert",
  scared: "alert",
  angry: "alert",
  notifying: "alert",
  // winding down
  drowsy: "sleepy",
  sleeping: "sleepy",
  bored: "sleepy",
  "powering-down": "sleepy",
};

const ONE_SHOT: ReadonlySet<OwlState> = new Set<OwlState>(["success", "alert"]);

/**
 * A MausState (or a legacy/junk stored value) -> the owl state. success and
 * alert are one-shots: they play when the bot enters the state, then the owl
 * rests as idle.
 */
export function owlStateForMaus(value: MausState | string | null | undefined): OwlStateMapping {
  const normalized = normalizeState(value);
  const state = (normalized && OWL_STATE_OF[normalized]) || "idle";
  return { state, oneShot: ONE_SHOT.has(state) };
}

export interface OwlBeat {
  /** A transient state to play (success/alert run once, others hold). */
  play?: OwlState;
  blink?: boolean;
  /** Open the wings for this move at the same time. */
  wings?: OwlWingMove;
}

/** MausMotion one-shot beats -> a transient owl state and/or a blink. */
export const OWL_BEAT_OF: Record<Exclude<MausMotion, "none">, OwlBeat> = {
  arrive: { play: "success" },
  switch: { blink: true },
  customize: { play: "success", blink: true },
  alert: { play: "alert" },
  thinking: { play: "thinking" },
  working: { play: "working" },
  launch: { play: "working", wings: "takeoff" },
  success: { play: "success", wings: "spread" },
  celebrate: { play: "success", wings: "flap" },
  blink: { blink: true },
  surprise: { play: "alert", blink: true },
  failure: { play: "sleepy" },
  "spread-wings": { wings: "spread" },
  flap: { wings: "flap" },
  "take-off": { wings: "takeoff" },
  shake: { wings: "shake", blink: true },
  hoot: { wings: "hoot", blink: true },
};

export function owlBeatForMotion(motion: MausMotion | null | undefined): OwlBeat | null {
  if (!motion || motion === "none") return null;
  return OWL_BEAT_OF[motion] ?? null;
}

/** How long a held beat (thinking/working/sleepy) lasts before the bot's own state returns. */
export const OWL_BEAT_MS = 1400;
