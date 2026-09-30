// The retro assistant's brain, kept pure so it can be tested without a DOM:
// the tip catalog and its search, when an eager guess may interrupt, the idle
// cycle, the owl looks, the motion plan and the saved preferences.
import type { LocaleKey } from "@/locales";
import type { MascotSkinId } from "../../../shared/mascot-skins";

export type TipAction = "shortcuts" | "appearance" | "botPanel" | "plugins" | "routines" | "gallery" | "options";

export interface RetroTip {
  id: string;
  text: LocaleKey;
  /** Lowercase search words, in both catalog languages, accents stripped. */
  keywords: string;
  /** Keyboard tips can be switched off in Options. */
  keyboard?: boolean;
  action?: TipAction;
}

export const RETRO_TIPS: readonly RetroTip[] = [
  { id: "shortcuts", text: "retro.tip.shortcuts", keywords: "keyboard shortcuts cheat sheet clavier raccourcis aide", keyboard: true, action: "shortcuts" },
  { id: "palette", text: "retro.tip.palette", keywords: "command palette search jump find commande palette chercher", keyboard: true },
  { id: "jump", text: "retro.tip.jump", keywords: "switch bot jump number conversation changer bot sauter numero", keyboard: true },
  { id: "newMessage", text: "retro.tip.newMessage", keywords: "new message compose write nouveau message ecrire", keyboard: true },
  { id: "newline", text: "retro.tip.newline", keywords: "new line return enter shift ligne retour entree majuscule", keyboard: true },
  { id: "editLast", text: "retro.tip.editLast", keywords: "edit last message arrow up modifier dernier message fleche", keyboard: true },
  { id: "find", text: "retro.tip.find", keywords: "find search conversation text trouver chercher rechercher", keyboard: true },
  { id: "skins", text: "retro.tip.skins", keywords: "skin theme look appearance color colour apparence theme couleur habillage", action: "appearance" },
  { id: "files", text: "retro.tip.files", keywords: "files documents download output fichiers telecharger", action: "botPanel" },
  { id: "mcp", text: "retro.tip.mcp", keywords: "mcp plugins apps sign in login connect connexion brancher applications", action: "plugins" },
  { id: "routines", text: "retro.tip.routines", keywords: "routines schedule cron automate calendar horaire planifier automatiser calendrier", action: "routines" },
  { id: "paste", text: "retro.tip.paste", keywords: "paste long text attachment coller texte piece jointe" },
  { id: "drag", text: "retro.tip.drag", keywords: "move drag owl assistant deplacer glisser hibou" },
  { id: "rightClick", text: "retro.tip.rightClick", keywords: "options right click menu look assistant clic droit apparence", action: "gallery" },
  { id: "escape", text: "retro.tip.escape", keywords: "escape hide balloon close cacher bulle fermer" },
  { id: "goodbye", text: "retro.tip.goodbye", keywords: "turn off hide disable quit bye desactiver quitter cacher au revoir" },
];

export const tipById = (id: string): RetroTip | undefined => RETRO_TIPS.find((tip) => tip.id === id);

/** Lowercase and strip accents so "éclair" and "eclair" meet. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Tips that match the query, best first: each word found in a tip's keywords
 * or translated text scores a point, the way the era's answer boxes ranked a
 * loose question. `textOf` resolves a tip's text in the active language.
 */
export function searchTips(query: string, textOf: (tip: RetroTip) => string, tips: readonly RetroTip[] = RETRO_TIPS): RetroTip[] {
  const words = normalizeSearch(query).split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  if (words.length === 0) return [];
  return tips
    .map((tip, index) => {
      const haystack = `${tip.keywords} ${normalizeSearch(textOf(tip))}`;
      return { tip, index, score: words.filter((word) => haystack.includes(word)).length };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.tip);
}

export interface RetroOptions {
  sounds: boolean;
  keyboardTips: boolean;
  guessHelp: boolean;
  startupTip: boolean;
}

export const DEFAULT_OPTIONS: RetroOptions = { sounds: true, keyboardTips: true, guessHelp: true, startupTip: true };

/** The next tip to offer: skips dismissed ones and, if asked, keyboard ones. */
export function nextTip(
  options: Pick<RetroOptions, "keyboardTips">,
  dismissed: readonly string[],
  afterId: string | null,
  tips: readonly RetroTip[] = RETRO_TIPS,
): RetroTip | null {
  const pool = tips.filter((tip) => !dismissed.includes(tip.id) && (options.keyboardTips || !tip.keyboard));
  if (pool.length === 0) return null;
  const at = afterId ? pool.findIndex((tip) => tip.id === afterId) : -1;
  return pool[(at + 1) % pool.length];
}

/* ------------------------------------------------------------------ guesses */

export type GuessKind = "longMessage" | "paste" | "idle" | "switch";

export interface RetroGuess {
  kind: GuessKind;
  question: LocaleKey;
  help: LocaleKey;
  skip: LocaleKey;
  /** The tip "help" opens. */
  tip: string;
}

export const RETRO_GUESSES: Record<GuessKind, RetroGuess> = {
  longMessage: { kind: "longMessage", question: "retro.guess.longMessage", help: "retro.guess.longMessage.help", skip: "retro.guess.longMessage.skip", tip: "newline" },
  paste: { kind: "paste", question: "retro.guess.paste", help: "retro.guess.paste.help", skip: "retro.guess.skip", tip: "paste" },
  idle: { kind: "idle", question: "retro.guess.idle", help: "retro.guess.idle.help", skip: "retro.guess.skip", tip: "palette" },
  switch: { kind: "switch", question: "retro.guess.switch", help: "retro.guess.switch.help", skip: "retro.guess.skip", tip: "jump" },
};

/** A composer draft this long counts as "writing a long message". */
export const LONG_MESSAGE_CHARS = 160;
/** A paste this long counts as "pasting a big chunk". */
export const BIG_PASTE_CHARS = 80;
/** No two eager guesses closer than this, whatever their kind. */
export const GUESS_GAP_MS = 20_000;
/** The same guess waits this long before it may come back. */
export const GUESS_REPEAT_MS = 3 * 60_000;

export interface GuessGate {
  now: number;
  options: Pick<RetroOptions, "guessHelp">;
  dismissed: readonly string[];
  lastAt: Partial<Record<GuessKind, number>>;
  /** A balloon, menu or dialog already has the person's attention. */
  busy: boolean;
}

/** Overeager, as the era was, but never twice in a row or over something open. */
export function mayGuess(kind: GuessKind, gate: GuessGate): boolean {
  if (!gate.options.guessHelp || gate.busy) return false;
  if (gate.dismissed.includes(`guess:${kind}`)) return false;
  const times = Object.values(gate.lastAt).filter((value): value is number => typeof value === "number");
  if (times.some((at) => gate.now - at < GUESS_GAP_MS)) return false;
  const last = gate.lastAt[kind];
  return last === undefined || gate.now - last >= GUESS_REPEAT_MS;
}

/* --------------------------------------------------------------------- idle */

export type IdlePhase = "awake" | "look" | "bored" | "yawn" | "doze";

/** Looks around, gets bored and taps the glass, yawns, then dozes off. */
export const IDLE_STEPS: ReadonlyArray<readonly [number, IdlePhase]> = [
  [15_000, "look"],
  [30_000, "bored"],
  [45_000, "yawn"],
  [55_000, "doze"],
];

export function idlePhase(idleMs: number): IdlePhase {
  let phase: IdlePhase = "awake";
  for (const [after, step] of IDLE_STEPS) if (idleMs >= after) phase = step;
  return phase;
}

/* -------------------------------------------------------------------- looks */

export type RetroLookId = "normal" | "black" | "lightning" | "gold" | "neon" | "inferno" | "frost" | "carbon";

export interface RetroLook {
  id: RetroLookId;
  color: string;
  skin: MascotSkinId;
  name: LocaleKey;
  bio: LocaleKey;
}

export const RETRO_LOOKS: readonly RetroLook[] = [
  { id: "normal", color: "blue", skin: "none", name: "retro.look.normal.name", bio: "retro.look.normal.bio" },
  { id: "black", color: "black", skin: "none", name: "retro.look.black.name", bio: "retro.look.black.bio" },
  { id: "lightning", color: "blue", skin: "lightning", name: "retro.look.lightning.name", bio: "retro.look.lightning.bio" },
  { id: "gold", color: "yellow", skin: "gold", name: "retro.look.gold.name", bio: "retro.look.gold.bio" },
  { id: "neon", color: "purple", skin: "neon", name: "retro.look.neon.name", bio: "retro.look.neon.bio" },
  { id: "inferno", color: "red", skin: "inferno", name: "retro.look.inferno.name", bio: "retro.look.inferno.bio" },
  { id: "frost", color: "cyan", skin: "frost", name: "retro.look.frost.name", bio: "retro.look.frost.bio" },
  { id: "carbon", color: "black", skin: "carbon", name: "retro.look.carbon.name", bio: "retro.look.carbon.bio" },
];

export const lookById = (id: string | undefined): RetroLook =>
  RETRO_LOOKS.find((look) => look.id === id) ?? RETRO_LOOKS[0];

/* ------------------------------------------------------------------- motion */

export type RetroAnimation = "flap" | "spread" | "hoot" | "shake" | "tap" | "lookAround" | "yawn" | "envelope" | "takeoff";

/** What "Animate!" may pick from. */
export const RANDOM_ANIMATIONS: readonly RetroAnimation[] = ["flap", "spread", "hoot", "shake", "tap", "lookAround", "yawn", "envelope", "takeoff"];

export interface MotionPlan {
  entrance: "slide-bounce" | "appear";
  exit: "puff" | "vanish";
  /** Wing moves and hops. */
  flourish: boolean;
  /** Flying envelopes, taps, head tilts, floating Zzz. */
  travel: boolean;
  idleCycle: boolean;
}

/** Reduced motion keeps the owl present and readable but still. */
export function motionPlan(reduced: boolean): MotionPlan {
  return reduced
    ? { entrance: "appear", exit: "vanish", flourish: false, travel: false, idleCycle: false }
    : { entrance: "slide-bounce", exit: "puff", flourish: true, travel: true, idleCycle: true };
}

/* -------------------------------------------------------------------- prefs */

export interface RetroPrefs {
  options: RetroOptions;
  look: RetroLookId;
  /** Offsets from the viewport's bottom-right corner, or null to sit above the composer. */
  position: { right: number; bottom: number } | null;
  /** Tip ids and "guess:<kind>" entries the person asked not to see again. */
  dismissed: string[];
}

export const DEFAULT_PREFS: RetroPrefs = { options: DEFAULT_OPTIONS, look: "normal", position: null, dismissed: [] };

const PREFS_KEY = "omb.retro98.prefs";

type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

function storage(): PrefsStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Reads whatever was saved, keeping only well-formed fields. */
export function readPrefs(store: PrefsStorage | undefined = storage()): RetroPrefs {
  let raw: unknown = null;
  try {
    raw = JSON.parse(store?.getItem(PREFS_KEY) ?? "null");
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS, options: { ...DEFAULT_OPTIONS } };
  const value = raw as Partial<Record<keyof RetroPrefs, unknown>>;
  const options = { ...DEFAULT_OPTIONS };
  if (value.options && typeof value.options === "object") {
    for (const key of Object.keys(DEFAULT_OPTIONS) as (keyof RetroOptions)[]) {
      const flag = (value.options as Record<string, unknown>)[key];
      if (typeof flag === "boolean") options[key] = flag;
    }
  }
  const pos = value.position as { right?: unknown; bottom?: unknown } | null | undefined;
  const position =
    pos && typeof pos.right === "number" && typeof pos.bottom === "number" && Number.isFinite(pos.right) && Number.isFinite(pos.bottom)
      ? { right: pos.right, bottom: pos.bottom }
      : null;
  return {
    options,
    look: lookById(typeof value.look === "string" ? value.look : undefined).id,
    position,
    dismissed: Array.isArray(value.dismissed) ? value.dismissed.filter((entry): entry is string => typeof entry === "string") : [],
  };
}

export function writePrefs(prefs: RetroPrefs, store: PrefsStorage | undefined = storage()): void {
  try {
    store?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* the change still holds for this session */
  }
}

/** Keeps a dragged owl on screen: at least `margin` px of it stays visible. */
export function clampPosition(
  position: { right: number; bottom: number },
  viewport: { width: number; height: number },
  size: number,
  margin = 8,
): { right: number; bottom: number } {
  return {
    right: Math.min(Math.max(position.right, margin), Math.max(margin, viewport.width - size - margin)),
    bottom: Math.min(Math.max(position.bottom, margin), Math.max(margin, viewport.height - size - margin)),
  };
}
