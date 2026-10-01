// What an idle mascot does next: a weighted random pick among small actions
// (look around, preen, scratch, hop, walk, fly...), with a cooldown per
// action and never the same one twice in a row, so it always looks alive
// and never repetitive. Livelier with a lively setting or a happy mood,
// calmer with a calm setting or a low mood; reduced motion keeps a gentle,
// in-place subset.
import type { TimedClip } from "./clips";

export type Liveliness = "calm" | "normal" | "lively";
export const LIVELINESS: readonly Liveliness[] = ["calm", "normal", "lively"];

/** What an idle action does: a clip in place, a turn around, or a move along the desk. */
export type IdleChoice = { kind: "clip"; clip: TimedClip } | { kind: "turn" } | { kind: "move"; style: "walk" | "fly" };

export interface IdleAction {
  id: string;
  choice: IdleChoice;
  weight: number;
  /** ms before it may be picked again. */
  cooldown: number;
  /** 0 calm, 1 lively, 2 very lively: scaled by the setting and the mood. */
  energy: 0 | 1 | 2;
  /** Gentle enough for reduced motion. */
  gentle?: boolean;
  /** Turns the character around in depth: only for a renderer with real depth (a 3D model). */
  rotates?: boolean;
}

const clip = (id: TimedClip, weight: number, cooldown: number, energy: 0 | 1 | 2, gentle = false): IdleAction => ({
  id,
  choice: { kind: "clip", clip: id },
  weight,
  cooldown,
  energy,
  gentle,
});

export const IDLE_ACTIONS: readonly IdleAction[] = [
  clip("look", 10, 6_000, 0, true),
  { ...clip("lookBack", 4, 20_000, 0), rotates: true },
  { ...clip("headSpin", 3, 40_000, 1), rotates: true },
  clip("tilt", 6, 10_000, 0, true),
  { id: "turn", choice: { kind: "turn" }, weight: 4, cooldown: 15_000, energy: 0, rotates: true },
  { ...clip("spin", 4, 25_000, 2), rotates: true },
  { ...clip("backflip", 1.5, 60_000, 2), rotates: true },
  clip("hop", 5, 8_000, 1),
  clip("hopForward", 3, 15_000, 1),
  clip("wave", 2, 40_000, 1),
  clip("dance", 1.5, 60_000, 2),
  clip("jump", 2, 30_000, 2),
  clip("stretch", 3, 30_000, 1),
  clip("wingStretch", 3, 25_000, 0),
  clip("preen", 5, 20_000, 0, true),
  clip("scratch", 3, 30_000, 0),
  clip("peck", 4, 15_000, 0),
  clip("bob", 6, 8_000, 0, true),
  clip("ruffle", 3, 30_000, 1),
  clip("shy", 1.5, 60_000, 1),
  clip("confused", 1.5, 60_000, 0),
  clip("think", 2, 40_000, 0, true),
  clip("hoot", 3, 30_000, 1),
  clip("wink", 2, 30_000, 0, true),
  clip("doubleBlink", 4, 10_000, 0, true),
  clip("yawn", 2, 60_000, 0, true),
  { id: "walk", choice: { kind: "move", style: "walk" }, weight: 6, cooldown: 12_000, energy: 1 },
  { id: "fly", choice: { kind: "move", style: "fly" }, weight: 2, cooldown: 45_000, energy: 2 },
];

export interface SchedulerMemory {
  /** When each action was last picked. */
  last: Record<string, number>;
  previous: string | null;
}

export const newSchedulerMemory = (): SchedulerMemory => ({ last: {}, previous: null });

export interface SchedulerOptions {
  liveliness: Liveliness;
  /** 0..1 */
  mood: number;
  reduced: boolean;
  /** Moves (walk, fly) need a window the mascot can move. */
  canMove: boolean;
  /** The renderer has real depth (a 3D model): spins, flips and turning in place are allowed. */
  depth?: boolean;
  random: () => number;
}

const ENERGY_SCALE: Record<Liveliness, [number, number, number]> = {
  calm: [1.3, 0.5, 0.15],
  normal: [1, 1, 1],
  lively: [0.8, 1.4, 2],
};

/** Each action's weight now (0 when it may not be picked). */
export function idleWeights(memory: SchedulerMemory, now: number, options: SchedulerOptions): { action: IdleAction; weight: number }[] {
  return IDLE_ACTIONS.map((action) => {
    let weight = action.weight * ENERGY_SCALE[options.liveliness][action.energy];
    if (options.mood >= 0.75 && action.energy === 2) weight *= 1.5;
    if (options.mood < 0.4 && action.energy === 2) weight *= 0.4;
    if (options.mood < 0.4 && action.id === "yawn") weight *= 2;
    const last = memory.last[action.id];
    const resting = last !== undefined && now - last < action.cooldown;
    const blocked =
      resting ||
      memory.previous === action.id ||
      (options.reduced && !action.gentle) ||
      (action.rotates && !options.depth) ||
      (action.choice.kind === "move" && !options.canMove);
    return { action, weight: blocked ? 0 : weight };
  });
}

/** Picks the next idle action, or null when everything is resting (it then just breathes). */
export function pickIdleAction(memory: SchedulerMemory, now: number, options: SchedulerOptions): { action: IdleAction | null; memory: SchedulerMemory } {
  const weights = idleWeights(memory, now, options);
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return { action: null, memory };
  let roll = options.random() * total;
  let chosen = weights.find((entry) => entry.weight > 0)!.action;
  for (const entry of weights) {
    if (entry.weight <= 0) continue;
    roll -= entry.weight;
    if (roll < 0) {
      chosen = entry.action;
      break;
    }
  }
  return { action: chosen, memory: { last: { ...memory.last, [chosen.id]: now }, previous: chosen.id } };
}

/** How long it rests between idle actions (ms). */
export function idleGapMs(options: Pick<SchedulerOptions, "liveliness" | "mood" | "reduced" | "random">): number {
  const [low, high] = options.liveliness === "calm" ? [7000, 14000] : options.liveliness === "lively" ? [2000, 5000] : [3500, 8000];
  const moody = options.mood < 0.4 ? 1.4 : options.mood >= 0.75 ? 0.85 : 1;
  return (low + options.random() * (high - low)) * moody * (options.reduced ? 1.6 : 1);
}

/** How long a quiet, idle mascot stays up before it yawns and naps (ms). */
export function sleepAfterMs(liveliness: Liveliness, mood: number): number {
  const base = liveliness === "calm" ? 75_000 : liveliness === "lively" ? 200_000 : 120_000;
  return base * (mood < 0.4 ? 0.7 : 1);
}

/** The side to move toward: the one with more room, and never into an edge. */
export function chooseDirection(room: { left: number; right: number } | null, random: () => number, minRoom = 80): -1 | 1 | 0 {
  if (!room) return random() < 0.5 ? -1 : 1;
  const canLeft = room.left >= minRoom;
  const canRight = room.right >= minRoom;
  if (!canLeft && !canRight) return 0;
  if (!canLeft) return 1;
  if (!canRight) return -1;
  // lean toward the roomier side
  return random() < room.right / (room.left + room.right) ? 1 : -1;
}

/** How far to move (px), kept off the edge; sometimes all the way across. */
export function moveDistance(style: "walk" | "fly", room: number, random: () => number): number {
  const margin = 16;
  const reach = Math.max(0, room - margin);
  if (style === "fly") return Math.round(Math.min(reach, 200 + random() * 400));
  // now and then a long walk to the other side
  if (random() < 0.12) return Math.round(reach);
  return Math.round(Math.min(reach, 60 + random() * 160));
}

/** How long a move takes (ms): an owl waddles slowly and flies fast. */
export function moveDuration(style: "walk" | "fly", distance: number, takeoff = 0): number {
  if (style === "fly") return Math.round(takeoff + Math.min(3000, Math.max(1000, (distance / 380) * 1000)));
  return Math.round(Math.min(9000, Math.max(1100, (distance / 75) * 1000)));
}
