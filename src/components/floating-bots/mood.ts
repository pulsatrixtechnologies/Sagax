// A floating mascot's mood: a gentle Tamagotchi meter, per bot, kept on this
// device. Playing with it, stroking it and finished tasks raise it; it drifts
// down slowly while nobody looks, and never below a floor: a neglected
// mascot is a bit sleepy, never sick or gone. The brain (FloatingBots.tsx)
// owns it and sends the value in each snapshot; the window only shows it.

export interface MoodRecord {
  /** 0..1 at the moment it was saved. */
  value: number;
  /** When it was saved (ms since the epoch). */
  at: number;
}

export type MoodStorage = Pick<Storage, "getItem" | "setItem">;
export type MoodGain = "pet" | "play" | "task";

const KEY = "omb.floatingBots.mood.v1";
const BOT_ID = /^[a-zA-Z0-9:_-]{1,64}$/;
const HOUR = 3_600_000;

/** A new mascot starts content. */
export const MOOD_START = 0.6;
/** Neglect never takes it lower than this. */
export const MOOD_FLOOR = 0.2;
/** Lost per hour nobody plays with it (a full mascot reaches the floor in about a day). */
export const MOOD_DECAY_PER_HOUR = 0.03;
export const MOOD_GAINS: Record<MoodGain, number> = { pet: 0.03, play: 0.05, task: 0.08 };

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The mood now, after the slow drift since it was saved. */
export function moodNow(record: MoodRecord | undefined, now: number): number {
  if (!record) return MOOD_START;
  const hours = Math.max(0, now - record.at) / HOUR;
  const value = clamp01(record.value);
  if (value <= MOOD_FLOOR) return value;
  return Math.max(MOOD_FLOOR, value - hours * MOOD_DECAY_PER_HOUR);
}

/** The mood after a stroke, a game or a finished task. */
export function raiseMood(record: MoodRecord | undefined, gain: MoodGain, now: number): MoodRecord {
  return { value: Math.round(clamp01(moodNow(record, now) + MOOD_GAINS[gain]) * 1000) / 1000, at: now };
}

/** Three words for the meter's label. */
export function moodLevel(value: number): "low" | "ok" | "happy" {
  if (value < 0.4) return "low";
  if (value < 0.75) return "ok";
  return "happy";
}

function defaultStorage(): MoodStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Every bot's saved mood, keeping only well-formed records. */
export function readMoods(storage: MoodStorage | undefined = defaultStorage()): Record<string, MoodRecord> {
  let raw: unknown = null;
  try {
    raw = JSON.parse(storage?.getItem(KEY) ?? "null");
  } catch {
    raw = null;
  }
  const bots = raw && typeof raw === "object" ? (raw as { bots?: unknown }).bots : null;
  const moods: Record<string, MoodRecord> = {};
  if (!bots || typeof bots !== "object" || Array.isArray(bots)) return moods;
  for (const [botId, value] of Object.entries(bots).slice(0, 64)) {
    const record = value as Partial<MoodRecord> | null;
    if (!BOT_ID.test(botId) || !record || !finite(record.value) || !finite(record.at)) continue;
    moods[botId] = { value: clamp01(record.value), at: record.at };
  }
  return moods;
}

export function writeMoods(moods: Record<string, MoodRecord>, storage: MoodStorage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ bots: moods }));
  } catch {
    /* private mode or quota: the mood still lives for this session */
  }
}
