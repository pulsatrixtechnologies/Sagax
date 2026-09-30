// Hibou 98: a late-90s desktop assistant. Loaded lazily the first time the
// easter egg is switched on (see src/lib/retro98.ts), so none of this costs
// anything on a device that never finds it.
//
// It recreates the era's behaviour with our own assets: an eager helper that
// perks up and taps the glass when you write a long message, paste, switch
// conversations or come back from a break; a balloon with a question, round
// bullet choices and a "What would you like to do?" search; a light bulb when
// a tip is waiting; an idle cycle that ends in a doze; a context menu, an
// assistant gallery and an options dialog. Trombi the paperclip is the
// default; the app's owl and the person's own pictures can stand in instead.
// Every word, icon and sound here is original.
//
// On the desktop app the assistant can also leave the window ("Detach from
// the window"): this component stays the brain and sends a plain snapshot of
// what to draw to a small always-on-top window (DetachedAssistant.tsx), which
// reports clicks back.
import "./retro-assistant.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { OwlAvatar, type OwlAvatarHandle } from "@/components/OwlAvatar";
import type { OwlGaze } from "@/lib/owl/owl-art";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { onRetroSignal, setRetroEnabled } from "@/lib/retro98";
import { useStore } from "@/state/store";
import type { LocaleKey } from "@/locales";
import {
  BIG_PASTE_CHARS,
  LONG_MESSAGE_CHARS,
  RANDOM_ANIMATIONS,
  RETRO_GUESSES,
  RETRO_LOOKS,
  assistantPose,
  characterBox,
  clampPosition,
  idlePhase,
  lookById,
  mayGuess,
  motionPlan,
  nextTip,
  readPrefs,
  searchTips,
  tipById,
  writePrefs,
  type GuessKind,
  type IdlePhase,
  type RetroAnimation,
  type RetroCharacter,
  type RetroGuess,
  type RetroLookId,
  type RetroOptions,
  type RetroPrefs,
  type RetroTip,
  type TipAction,
} from "./logic";
import { createRetroSounds } from "./sounds";
import { BulbIcon, Envelope, Notebook, OwlFaceIcon, Puff, TapMarks, Zzz } from "./RetroArt";
import { Win98Button, Win98Check, Win98Window } from "./Win98";
import { AssistantArt, useCustomArtUrls, type CustomArtUrls } from "./AssistantArt";
import { Trombi } from "./Trombi";
import { CUSTOM_STATES, clearCustomArt, customArtReady, loadCustomArt, saveCustomArt, type CustomArtProblem, type CustomState } from "./custom-art";
import type { DetachedEvent, DetachedSnapshot } from "./detached-protocol";

const TIP_EVERY_MS = 45_000;
const COMPOSER = '[data-tour="composer"]';

type Balloon =
  | { kind: "welcome" }
  | { kind: "tip"; tip: RetroTip }
  | { kind: "guess"; guess: RetroGuess }
  | { kind: "results"; query: string; tips: RetroTip[] };

type Act = { name: RetroAnimation | "enter" | "leave" | "celebrate"; n: number };

export type MenuItem = "hide" | "options" | "gallery" | "animate" | "detach" | "attach";

/**
 * The right-click menu. "Detach from the window" appears only where the
 * desktop app can host the assistant in its own window; once detached, the
 * same slot offers to put it back.
 */
export function assistantMenu(canDetach: boolean, detached: boolean): Array<{ id: MenuItem; label: LocaleKey; separator?: boolean }> {
  const items: Array<{ id: MenuItem; label: LocaleKey; separator?: boolean }> = [
    { id: "hide", label: "retro.menu.hide" },
    { id: "options", label: "retro.menu.options", separator: true },
    { id: "gallery", label: "retro.menu.choose" },
    { id: "animate", label: "retro.menu.animate", separator: true },
  ];
  if (canDetach) items.push(detached ? { id: "attach", label: "retro.menu.attach", separator: true } : { id: "detach", label: "retro.menu.detach", separator: true });
  return items;
}

/** A balloon described as data, so the page and the detached window draw the same one. */
export interface BalloonModel {
  tipHead?: boolean;
  text?: string;
  question?: string;
  bullets: Array<{ id: string; label: string; run: () => void }>;
  buttons: Array<{ id: string; label: string; primary?: boolean; run: () => void }>;
  ask?: boolean;
}

export interface RetroAssistantProps {
  /** True once the mode was switched off: play the exit, then call onGone. */
  leaving?: boolean;
  /** Switched on just now (a welcome), rather than restored at startup. */
  fresh?: boolean;
  onGone?: () => void;
  /** Tests and previews pin reduced motion; undefined follows the OS. */
  reducedMotion?: boolean;
  /** The app language; a change re-renders every balloon string. */
  locale?: string;
}

function useReducedMotion(forced?: boolean): boolean {
  const query = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  const [reduced, setReduced] = useState(() => query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, [query]);
  return forced ?? reduced;
}

function inComposer(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && Boolean(target.closest(COMPOSER));
}

/**
 * Where the assistant stands by default: bottom right of the conversation,
 * just above the composer, so it never sits on a field or on the Send button.
 */
function perchAboveComposer(): { right: number; bottom: number } {
  const composer = typeof document === "undefined" ? null : document.querySelector(COMPOSER);
  if (!composer) return { right: 24, bottom: 120 };
  const rect = composer.getBoundingClientRect();
  return {
    right: Math.max(8, window.innerWidth - rect.right + 22),
    bottom: Math.max(8, window.innerHeight - rect.top + 6),
  };
}

/** The assistant's accessible name and greeting follow the character. */
function characterStrings(character: RetroCharacter): { aria: LocaleKey; welcome: LocaleKey } {
  if (character === "owl") return { aria: "retro.aria.owl", welcome: "retro.welcome" };
  if (character === "custom") return { aria: "retro.aria.custom", welcome: "retro.welcome.custom" };
  return { aria: "retro.aria.trombi", welcome: "retro.welcome.trombi" };
}

export default function RetroAssistant({ leaving = false, fresh = false, onGone, reducedMotion, locale }: RetroAssistantProps) {
  const { state, dispatch } = useStore();
  const reduced = useReducedMotion(reducedMotion);
  const plan = motionPlan(reduced);
  const language = locale ?? activeLocale();

  const [prefs, setPrefsState] = useState<RetroPrefs>(() => readPrefs());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const setPrefs = useCallback((update: (current: RetroPrefs) => RetroPrefs) => {
    setPrefsState((current) => {
      const next = update(current);
      writePrefs(next);
      return next;
    });
  }, []);

  const [balloon, setBalloon] = useState<Balloon | null>(null);
  const [bulb, setBulb] = useState<RetroTip | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<"options" | "gallery" | "custom" | null>(null);
  const [mood, setMood] = useState<IdlePhase>("awake");
  const [act, setAct] = useState<Act | null>(null);
  const [envelopes, setEnvelopes] = useState<number[]>([]);
  const [gaze, setGaze] = useState<OwlGaze | undefined>(undefined);
  const [perch, setPerch] = useState(() => perchAboveComposer());
  const [query, setQuery] = useState("");
  const [artVersion, setArtVersion] = useState(0);

  const owl = useRef<OwlAvatarHandle>(null);
  const lastActivity = useRef(Date.now());
  const lastGuess = useRef<Partial<Record<GuessKind, number>>>({});
  const lastTipAt = useRef(0);
  const lastTipId = useRef<string | null>(null);
  const longArmed = useRef(true);
  const counter = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const attention = useRef(false);
  attention.current = Boolean(balloon || menu || dialog);

  const later = useCallback((ms: number, run: () => void) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      run();
    }, ms);
    timers.current.add(id);
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) clearTimeout(id);
      pending.clear();
    };
  }, []);

  const sounds = useMemo(() => createRetroSounds(() => prefsRef.current.options.sounds), []);
  useEffect(() => () => sounds.close(), [sounds]);

  const character = prefs.character;
  const look = lookById(prefs.look);
  const box = characterBox(character);
  const size = Math.max(box.width, box.height);
  const position = prefs.position ?? perch;
  const custom = useCustomArtUrls(character === "custom" || dialog === "gallery" || dialog === "custom", artVersion);
  const names = characterStrings(character);

  // The desktop app can show the assistant in its own window.
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.retroAssistant;
  const detached = Boolean(bridge) && prefs.detached && !leaving;

  /* ------------------------------------------------------------ animations */

  const play = useCallback((name: Act["name"], ms: number) => {
    counter.current += 1;
    const n = counter.current;
    setAct({ name, n });
    later(ms, () => setAct((current) => (current?.n === n ? null : current)));
  }, [later]);

  const sendEnvelope = useCallback(() => {
    counter.current += 1;
    const n = counter.current;
    setEnvelopes((list) => [...list, n]);
    later(plan.travel ? 3600 : 1800, () => setEnvelopes((list) => list.filter((value) => value !== n)));
  }, [later, plan.travel]);

  const lookAround = useCallback(() => {
    const steps: Array<[number, OwlGaze | undefined]> = [
      [0, { x: -1, y: 0 }],
      [700, { x: 1, y: -0.3 }],
      [1400, { x: -0.6, y: 0.4 }],
      [2100, undefined],
    ];
    for (const [at, value] of steps) later(at, () => setGaze(value));
    if (plan.travel) play("lookAround", 2200);
  }, [later, play, plan.travel]);

  const runAnimation = useCallback((name: RetroAnimation) => {
    switch (name) {
      case "flap":
      case "spread":
      case "hoot":
      case "shake":
      case "takeoff":
        owl.current?.flourish(name);
        if (prefsRef.current.character !== "owl") play("celebrate", 1300);
        sounds.play(name === "hoot" ? "chime" : "pop");
        break;
      case "tap":
        if (plan.travel) play("tap", 1100);
        sounds.play("tap");
        break;
      case "lookAround":
        lookAround();
        break;
      case "yawn":
        owl.current?.play("sleepy", 2200);
        if (plan.travel) play("yawn", 2200);
        break;
      case "envelope":
        owl.current?.flourish("flap");
        sendEnvelope();
        sounds.play("whoosh");
        break;
    }
  }, [lookAround, play, plan.travel, sendEnvelope, sounds]);

  /* --------------------------------------------------------------- balloon */

  const openBalloon = useCallback((next: Balloon, sound: "pop" | null = "pop") => {
    setBulb(null);
    setMenu(null);
    setBalloon(next);
    if (sound) sounds.play(sound);
    lastActivity.current = Date.now();
    setMood("awake");
  }, [sounds]);

  const openTip = useCallback((tip: RetroTip | null) => {
    if (!tip) return;
    lastTipAt.current = Date.now();
    lastTipId.current = tip.id;
    openBalloon({ kind: "tip", tip });
  }, [openBalloon]);

  const pickTip = useCallback(() => nextTip(prefsRef.current.options, prefsRef.current.dismissed, lastTipId.current), []);

  /** The era's eager interruption: perk up, tap the glass, then ask. */
  const tryGuess = useCallback((kind: GuessKind) => {
    const now = Date.now();
    const gate = { now, options: prefsRef.current.options, dismissed: prefsRef.current.dismissed, lastAt: lastGuess.current, busy: attention.current };
    if (!mayGuess(kind, gate)) return;
    lastGuess.current = { ...lastGuess.current, [kind]: now };
    owl.current?.play("alert", 700);
    if (plan.travel) play("tap", 1100);
    sounds.play("tap");
    later(reduced ? 0 : 650, () => {
      if (!attention.current) openBalloon({ kind: "guess", guess: RETRO_GUESSES[kind] });
    });
  }, [later, openBalloon, play, plan.travel, reduced, sounds]);

  const runAction = useCallback((action: TipAction) => {
    setBalloon(null);
    switch (action) {
      case "shortcuts":
        dispatch({ type: "toggleShortcuts", open: true });
        break;
      case "appearance":
        dispatch({ type: "toggleAppSettings", open: true, section: "appearance" });
        break;
      case "botPanel":
        dispatch({ type: "toggleSettings", open: true });
        break;
      case "plugins":
        dispatch({ type: "togglePlugins", open: true, surface: "mcp" });
        break;
      case "routines":
        dispatch({ type: "showRoutines" });
        break;
      case "gallery":
      case "options":
        setDialog(action);
        break;
    }
  }, [dispatch]);

  const dismiss = useCallback((entry: string) => {
    setPrefs((current) => (current.dismissed.includes(entry) ? current : { ...current, dismissed: [...current.dismissed, entry] }));
  }, [setPrefs]);

  const runSearch = useCallback((text: string) => {
    const found = searchTips(text, (tip) => t(tip.text));
    sounds.play("click");
    openBalloon({ kind: "results", query: text, tips: found }, null);
  }, [openBalloon, sounds]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    runSearch(query);
  };

  /* -------------------------------------------------------- entrance, exit */

  useEffect(() => {
    // The switch was a keypress or a send, so the page has seen a gesture:
    // sounds may start now. Otherwise they wait for the first interaction.
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (activation?.hasBeenActive) sounds.unlock();
    play("enter", reduced ? 200 : 1100);
    sounds.play("hello");
    if (fresh) later(reduced ? 150 : 1000, () => openBalloon({ kind: "welcome" }));
    else if (prefsRef.current.options.startupTip) later(reduced ? 150 : 1200, () => openTip(pickTip()));
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!leaving) return;
    setBalloon(null);
    setMenu(null);
    setDialog(null);
    setBulb(null);
    play("leave", 900);
    sounds.play("bye");
    later(plan.exit === "puff" ? 750 : 120, () => onGone?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  /* ------------------------------------------------------------- listeners */

  useEffect(() => {
    const unlock = () => sounds.unlock();
    const activity = () => {
      lastActivity.current = Date.now();
      setMood((current) => {
        if (current === "doze") {
          owl.current?.play("alert", 900);
          later(600, () => tryGuess("idle"));
        }
        return current === "awake" ? current : "awake";
      });
    };
    const onKey = (event: KeyboardEvent) => {
      // Some hosts emit synthetic "Unidentified" keys; they are nobody typing.
      if (event.key === "Unidentified") return;
      unlock();
      activity();
      if (event.key !== "Escape") return;
      if (menu) setMenu(null);
      else if (dialog) setDialog(null);
      else if (balloon) setBalloon(null);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!inComposer(event.target)) return;
      // Wait a beat: a guess prompted by the same moment (a conversation
      // switch focuses the composer too) is the better thing to say.
      later(900, () => {
        if (attention.current) return;
        if (bulb) openTip(bulb);
        else if (Date.now() - lastTipAt.current > TIP_EVERY_MS) openTip(pickTip());
      });
    };
    const onInput = (event: Event) => {
      activity();
      const target = event.target;
      if (!inComposer(target) || !(target instanceof HTMLTextAreaElement)) return;
      const length = target.value.length;
      if (length < 20) longArmed.current = true;
      if (length >= LONG_MESSAGE_CHARS && longArmed.current) {
        longArmed.current = false;
        tryGuess("longMessage");
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!inComposer(event.target)) return;
      const text = event.clipboardData?.getData("text") ?? "";
      if (text.length >= BIG_PASTE_CHARS) later(250, () => tryGuess("paste"));
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("pointermove", activity, { passive: true });
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("input", onInput, true);
    document.addEventListener("paste", onPaste, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("pointermove", activity);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("paste", onPaste, true);
    };
  }, [balloon, bulb, dialog, later, menu, openTip, pickTip, sounds, tryGuess]);

  useEffect(
    () =>
      onRetroSignal((kind) => {
        if (kind === "send") {
          longArmed.current = true;
          setBalloon((current) => (current?.kind === "guess" && current.guess.kind === "longMessage" ? null : current));
          runAnimation("envelope");
        } else if (kind === "tip") {
          openTip(pickTip());
        } else if (kind === "gallery" || kind === "options") {
          setBalloon(null);
          setDialog(kind);
        }
      }),
    [openTip, pickTip, runAnimation],
  );

  // Idle cycle, the waiting tip and the perch, on one slow clock.
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      if (attention.current || leaving) lastActivity.current = now;
      const next = idlePhase(now - lastActivity.current);
      setMood((current) => (current === next ? current : next));
      if (!attention.current && !leaving && now - lastTipAt.current > TIP_EVERY_MS) {
        lastTipAt.current = now;
        const tip = nextTip(prefsRef.current.options, prefsRef.current.dismissed, lastTipId.current);
        if (tip) {
          lastTipId.current = tip.id;
          setBulb(tip);
          sounds.play("bulb");
        }
      }
      if (!prefsRef.current.position) {
        const spot = perchAboveComposer();
        setPerch((current) => (current.right === spot.right && current.bottom === spot.bottom ? current : spot));
      }
    }, 1000);
    lastTipAt.current = Date.now();
    return () => clearInterval(tick);
  }, [leaving, sounds]);

  // What each idle step does, once, as it begins.
  useEffect(() => {
    if (mood === "look") lookAround();
    if (mood === "yawn") {
      owl.current?.play("sleepy", 2400);
      if (plan.travel) play("yawn", 2400);
    }
    if (mood !== "bored") return;
    runAnimation("tap");
    const again = setInterval(() => runAnimation("tap"), 4000);
    return () => clearInterval(again);
  }, [lookAround, mood, play, plan.travel, runAnimation]);

  // Think while any bot works; celebrate when one finishes a reply.
  const busyIds = state.bots.filter((bot) => bot.busy).map((bot) => bot.id).join(",");
  const previousBusy = useRef(busyIds);
  useEffect(() => {
    const before = previousBusy.current ? previousBusy.current.split(",") : [];
    const now = busyIds ? busyIds.split(",") : [];
    previousBusy.current = busyIds;
    if (before.some((id) => !now.includes(id))) {
      owl.current?.flourish("spread");
      owl.current?.play("success");
      play("celebrate", plan.travel ? 2600 : 1600);
      sounds.play("chime");
    }
  }, [busyIds, play, plan.travel, sounds]);

  // Switching conversations is a reason to offer a shortcut.
  const selected = state.selectedId;
  const previousSelected = useRef(selected);
  useEffect(() => {
    if (previousSelected.current === selected) return;
    previousSelected.current = selected;
    tryGuess("switch");
  }, [selected, tryGuess]);

  useLayoutEffect(() => {
    const onResize = () => {
      setPerch(perchAboveComposer());
      if (prefsRef.current.position) {
        const clamped = clampPosition(prefsRef.current.position, { width: window.innerWidth, height: window.innerHeight }, size);
        setPrefsState((current) => ({ ...current, position: clamped }));
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [size]);

  /* ------------------------------------------------------------------ drag */

  const drag = useRef<{ x: number; y: number; right: number; bottom: number; moved: boolean; id: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ right: number; bottom: number } | null>(null);

  const clickCharacter = useCallback(() => {
    sounds.play("click");
    if (balloon) setBalloon(null);
    else if (bulb) openTip(bulb);
    else openBalloon({ kind: "welcome" });
  }, [balloon, bulb, openBalloon, openTip, sounds]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, right: position.right, bottom: position.bottom, moved: false, id: event.pointerId };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 5) return;
    start.moved = true;
    setDragPos(clampPosition({ right: start.right - dx, bottom: start.bottom - dy }, { width: window.innerWidth, height: window.innerHeight }, size));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start || start.id !== event.pointerId) return;
    if (start.moved && dragPos) {
      const spot = dragPos;
      setPrefs((current) => ({ ...current, position: spot }));
      setDragPos(null);
      return;
    }
    setDragPos(null);
    clickCharacter();
  };
  const onContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    sounds.play("click");
    setBalloon(null);
    setMenu({ x: event.clientX, y: event.clientY });
  };
  const onCharacterKey = (event: ReactKeyboardEvent) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu({ x: rect.left, y: rect.top });
    }
  };

  const at = dragPos ?? position;
  const stageTop = typeof window === "undefined" ? 600 : window.innerHeight - at.bottom - box.height;
  const balloonBelow = stageTop < 300;

  /* ---------------------------------------------------------------- render */

  const busy = state.bots.some((bot) => bot.busy);
  const pose = assistantPose({
    act: act?.name,
    sending: envelopes.length > 0,
    busy,
    mood,
    talking: Boolean(balloon),
  });

  const menuItems = useMemo(() => {
    return assistantMenu(Boolean(bridge), prefs.detached).map((item) => ({ ...item, label: t(item.label) }));
    // language changes the labels
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, prefs.detached, language]);

  const pickMenu = useCallback((item: MenuItem) => {
    setMenu(null);
    sounds.play("click");
    if (item === "hide") setRetroEnabled(false);
    else if (item === "options") setDialog("options");
    else if (item === "gallery") setDialog("gallery");
    else if (item === "detach") setPrefs((current) => ({ ...current, detached: true }));
    else if (item === "attach") setPrefs((current) => ({ ...current, detached: false }));
    else runAnimation(RANDOM_ANIMATIONS[Math.floor(Math.random() * RANDOM_ANIMATIONS.length)]);
  }, [runAnimation, setPrefs, sounds]);

  const model: BalloonModel | null = useMemo(() => {
    if (!balloon) return null;
    if (balloon.kind === "welcome") {
      return {
        question: t(names.welcome),
        bullets: [
          { id: "tip", label: t("retro.welcome.tip"), run: () => openTip(pickTip()) },
          { id: "look", label: t("retro.welcome.look"), run: () => { setBalloon(null); setDialog("gallery"); } },
          { id: "none", label: t("retro.welcome.nothing"), run: () => setBalloon(null) },
        ],
        buttons: [],
        ask: true,
      };
    }
    if (balloon.kind === "tip") {
      const tip = balloon.tip;
      return {
        tipHead: true,
        text: t(tip.text),
        question: tip.action ? t("retro.tip.showMe") : t("retro.tip.another"),
        bullets: [],
        buttons: [
          { id: "yes", label: t("retro.button.yes"), primary: true, run: () => (tip.action ? runAction(tip.action) : openTip(pickTip())) },
          { id: "no", label: t("retro.button.noThanks"), run: () => setBalloon(null) },
          { id: "never", label: t("retro.button.never"), run: () => { dismiss(tip.id); setBalloon(null); } },
        ],
      };
    }
    if (balloon.kind === "guess") {
      const guess = balloon.guess;
      return {
        question: t(guess.question),
        bullets: [
          { id: "help", label: t(guess.help), run: () => openTip(guess.kind === "idle" ? pickTip() : tipById(guess.tip) ?? null) },
          { id: "skip", label: t(guess.skip), run: () => setBalloon(null) },
          { id: "never", label: t("retro.guess.never"), run: () => { dismiss(`guess:${guess.kind}`); setBalloon(null); } },
        ],
        buttons: [],
        ask: true,
      };
    }
    return {
      question: balloon.tips.length ? t("retro.results.found") : t("retro.results.none"),
      bullets: balloon.tips.slice(0, 5).map((tip) => ({ id: `r:${tip.id}`, label: t(tip.text), run: () => openTip(tip) })),
      buttons: [],
      ask: true,
    };
    // language changes every label
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balloon, dismiss, names.welcome, openTip, pickTip, runAction, language]);

  /* ------------------------------------------------------ detached window */

  const handlers = useRef({ model, click: clickCharacter, menu: pickMenu, search: runSearch, bulb: () => { if (bulb) openTip(bulb); } });
  handlers.current = { model, click: clickCharacter, menu: pickMenu, search: runSearch, bulb: () => { if (bulb) openTip(bulb); } };

  useEffect(() => {
    if (!bridge) return;
    void bridge.setDetached(detached).catch(() => undefined);
  }, [bridge, detached]);
  useEffect(() => () => void bridge?.setDetached(false).catch(() => undefined), [bridge]);

  useEffect(() => {
    if (!bridge) return;
    const offChanged = bridge.onDetachedChanged((on) => {
      if (!on && prefsRef.current.detached) setPrefs((current) => ({ ...current, detached: false }));
    });
    const offEvent = bridge.onEvent((event: DetachedEvent) => {
      const current = handlers.current;
      if (event.type === "click") current.click();
      else if (event.type === "bulb") current.bulb();
      else if (event.type === "dismiss") setBalloon(null);
      else if (event.type === "options") { setBalloon(null); setDialog("options"); }
      else if (event.type === "search") current.search(event.query);
      else if (event.type === "menu") { if (MENU_IDS.has(event.id)) current.menu(event.id as MenuItem); }
      else if (event.type === "bullet") current.model?.bullets.find((item) => item.id === event.id)?.run();
      else if (event.type === "button") current.model?.buttons.find((item) => item.id === event.id)?.run();
    });
    return () => {
      offChanged();
      offEvent();
    };
  }, [bridge, setPrefs]);

  const snapshot: DetachedSnapshot | null = detached
    ? {
        v: 1,
        character,
        pose,
        reduced,
        locale: language,
        label: t(names.aria),
        bulb: bulb && !balloon ? t("retro.bulb") : null,
        look: character === "owl" ? { color: look.color, skin: look.skin } : null,
        menu: menuItems.map((item) => ({ id: item.id, label: item.label })),
        balloon: model
          ? {
              title: model.tipHead ? t("retro.tip.title") : undefined,
              text: model.text,
              question: model.question,
              bullets: model.bullets.map(({ id, label }) => ({ id, label })),
              buttons: model.buttons.map(({ id, label, primary }) => ({ id, label, ...(primary ? { default: true } : {}) })),
              ask: model.ask ? { label: t("retro.ask.label"), placeholder: t("retro.ask.placeholder"), search: t("retro.ask.search"), options: t("retro.ask.options") } : undefined,
            }
          : null,
      }
    : null;
  const snapshotKey = snapshot ? JSON.stringify(snapshot) : "";
  useEffect(() => {
    if (bridge && snapshotKey) bridge.update(JSON.parse(snapshotKey) as DetachedSnapshot);
  }, [bridge, snapshotKey]);

  /* -------------------------------------------------------- in-page view */

  const askBox = (autoFocus: boolean) => (
    <form className="r98-ask" onSubmit={search}>
      <label className="r98-ask-label" htmlFor="r98-ask-input">{t("retro.ask.label")}</label>
      <input
        id="r98-ask-input"
        className="r98-field"
        value={query}
        placeholder={t("retro.ask.placeholder")}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus={autoFocus}
        autoComplete="off"
      />
      <div className="r98-row">
        <Win98Button onClick={() => { setBalloon(null); setDialog("options"); }}>{t("retro.ask.options")}</Win98Button>
        <Win98Button type="submit" className="r98-default">{t("retro.ask.search")}</Win98Button>
      </div>
    </form>
  );

  const body: ReactNode = model ? (
    <>
      {model.tipHead && (
        <div className="r98-tip-head">
          <BulbIcon size={18} />
          <strong>{t("retro.tip.title")}</strong>
        </div>
      )}
      {model.text && <p>{model.text}</p>}
      {model.question && <p className="r98-question">{model.question}</p>}
      {model.bullets.length > 0 && (
        <ul className="r98-bullets">
          {model.bullets.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => { sounds.play("click"); item.run(); }}>
                <span className="r98-dot" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {model.buttons.length > 0 && (
        <div className="r98-row r98-row-3">
          {model.buttons.map((item) => (
            <Win98Button key={item.id} className={item.primary ? "r98-default" : undefined} onClick={item.run}>{item.label}</Win98Button>
          ))}
        </div>
      )}
      {model.ask && askBox(balloon?.kind !== "guess")}
    </>
  ) : null;

  return (
    <div className="r98-root" data-reduced={reduced ? "" : undefined} lang={language}>
      {!detached && (
        <div
          className={cn("r98-stage", act && `r98-act-${act.name}`, `r98-mood-${mood}`, `r98-char-${character}`)}
          style={{ right: at.right, bottom: at.bottom, width: box.width, height: box.height }}
          data-retro-owl=""
          data-character={character}
          data-pose={pose}
          data-mood={mood}
        >
          <span className="r98-floor" aria-hidden="true" />
          {bulb && !balloon && !leaving && (
            <button type="button" className="r98-bulb" title={t("retro.bulb")} aria-label={t("retro.bulb")} onClick={() => openTip(bulb)}>
              <BulbIcon />
            </button>
          )}
          <div className="r98-body">
            <button
              type="button"
              className="r98-owl"
              aria-label={t(names.aria)}
              aria-haspopup="menu"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => { drag.current = null; setDragPos(null); }}
              onContextMenu={onContextMenu}
              onKeyDown={onCharacterKey}
            >
              <AssistantArt
                ref={owl}
                character={character}
                pose={pose}
                reduced={reduced}
                look={{ color: look.color, skin: look.skin }}
                gaze={gaze}
                custom={custom}
              />
            </button>
            {character === "owl" && busy && <Notebook />}
            {character === "owl" && mood === "doze" && plan.travel && <Zzz />}
            {act?.name === "tap" && <TapMarks />}
          </div>
          {character === "owl" && envelopes.map((id) => (
            <span key={id} className="r98-envelope">
              <Envelope />
            </span>
          ))}
          {leaving && plan.exit === "puff" && <Puff />}
        </div>
      )}

      {!detached && balloon && body && (
        <div
          role="dialog"
          aria-label={t("retro.aria.balloon")}
          className={cn("r98-balloon", balloonBelow && "r98-balloon-below")}
          style={
            balloonBelow
              ? { right: Math.max(8, at.right - 6), top: window.innerHeight - at.bottom + 12 }
              : { right: Math.max(8, at.right - 6), bottom: at.bottom + box.height + 8 }
          }
        >
          <span className="r98-balloon-shade" aria-hidden="true" />
          <div className="r98-balloon-face">
            <span className="r98-tail" aria-hidden="true" />
            {body}
          </div>
        </div>
      )}

      {menu && <OwlMenu at={menu} items={menuItems} onClose={() => setMenu(null)} onPick={pickMenu} />}

      {dialog === "options" && (
        <OptionsDialog
          options={prefs.options}
          onReset={() => setPrefs((current) => ({ ...current, dismissed: [] }))}
          onClose={() => setDialog(null)}
          onSave={(options) => {
            setPrefs((current) => ({ ...current, options }));
            setDialog(null);
          }}
        />
      )}
      {dialog === "gallery" && (
        <GalleryDialog
          character={prefs.character}
          look={prefs.look}
          custom={custom}
          onClose={() => setDialog(null)}
          onCustomize={() => setDialog("custom")}
          onPick={(choice) => {
            setPrefs((current) => ({ ...current, character: choice.character, look: choice.look ?? current.look }));
            setDialog(null);
            later(50, () => owl.current?.flourish("spread"));
            sounds.play("chime");
          }}
        />
      )}
      {dialog === "custom" && (
        <CustomAssistantDialog
          custom={custom}
          onChanged={() => setArtVersion((value) => value + 1)}
          onClose={() => setDialog("gallery")}
          onUse={() => {
            setPrefs((current) => ({ ...current, character: "custom" }));
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

const MENU_IDS = new Set<string>(["hide", "options", "gallery", "animate", "detach", "attach"]);

function OwlMenu({ at, items, onClose, onPick }: { at: { x: number; y: number }; items: Array<{ id: MenuItem; label: string; separator?: boolean }>; onClose: () => void; onPick: (item: MenuItem) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [onClose]);
  const width = 196;
  const left = Math.min(at.x, window.innerWidth - width - 4);
  const top = Math.min(at.y, window.innerHeight - 24 * items.length - 20);
  const onKeyDown = (event: ReactKeyboardEvent) => {
    const list = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      list[(index + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
    }
  };
  return (
    <div ref={ref} role="menu" aria-label={t("retro.menu.aria")} className="r98-menu" style={{ left, top, width }} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <div key={item.id}>
          {item.separator && <div className="r98-menu-sep" role="separator" />}
          <button type="button" role="menuitem" className="r98-menu-item" data-menu-item={item.id} onClick={() => onPick(item.id)}>
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}

function OptionsDialog({
  options,
  onSave,
  onClose,
  onReset,
}: {
  options: RetroOptions;
  onSave: (options: RetroOptions) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(options);
  const [resetDone, setResetDone] = useState(false);
  const flag = (key: keyof RetroOptions) => (value: boolean) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Win98Window title={t("retro.options.title")} onClose={onClose} icon={<OwlFaceIcon />} width={360}>
      <fieldset className="r98-group">
        <legend>{t("retro.options.group")}</legend>
        <Win98Check checked={draft.sounds} onChange={flag("sounds")}>{t("retro.options.sounds")}</Win98Check>
        <Win98Check checked={draft.keyboardTips} onChange={flag("keyboardTips")}>{t("retro.options.keyboardTips")}</Win98Check>
        <Win98Check checked={draft.guessHelp} onChange={flag("guessHelp")}>{t("retro.options.guessHelp")}</Win98Check>
        <Win98Check checked={draft.startupTip} onChange={flag("startupTip")}>{t("retro.options.startupTip")}</Win98Check>
      </fieldset>
      <fieldset className="r98-group">
        <legend>{t("retro.options.tipsGroup")}</legend>
        <p className="r98-hint">{t("retro.options.resetHint")}</p>
        <div className="r98-row r98-row-start">
          <Win98Button onClick={() => { onReset(); setResetDone(true); }}>{t("retro.options.reset")}</Win98Button>
          {resetDone && <span className="r98-hint" role="status">{t("retro.options.resetDone")}</span>}
        </div>
      </fieldset>
      <div className="r98-row">
        <Win98Button className="r98-default" onClick={() => onSave(draft)}>{t("retro.button.ok")}</Win98Button>
        <Win98Button onClick={onClose}>{t("retro.button.cancel")}</Win98Button>
      </div>
    </Win98Window>
  );
}

type GalleryEntry =
  | { kind: "trombi" }
  | { kind: "owl"; look: RetroLookId }
  | { kind: "custom" };

/** Trombi first, then the owl in each of its looks, then the person's own pictures. */
export const GALLERY: readonly GalleryEntry[] = [
  { kind: "trombi" },
  ...RETRO_LOOKS.map((look) => ({ kind: "owl" as const, look: look.id })),
  { kind: "custom" },
];

function galleryIndex(character: RetroCharacter, look: RetroLookId): number {
  const index = GALLERY.findIndex((entry) => entry.kind === character && (entry.kind !== "owl" || entry.look === look));
  return Math.max(0, index);
}

function GalleryDialog({
  character,
  look,
  custom,
  onPick,
  onClose,
  onCustomize,
}: {
  character: RetroCharacter;
  look: RetroLookId;
  custom: CustomArtUrls;
  onPick: (choice: { character: RetroCharacter; look?: RetroLookId }) => void;
  onClose: () => void;
  onCustomize: () => void;
}) {
  const [index, setIndex] = useState(() => galleryIndex(character, look));
  const preview = useRef<OwlAvatarHandle>(null);
  const entry = GALLERY[index];
  const step = (delta: number) => {
    setIndex((value) => (value + delta + GALLERY.length) % GALLERY.length);
    setTimeout(() => preview.current?.flourish("hoot"), 30);
  };
  const owlLook = entry.kind === "owl" ? lookById(entry.look) : null;
  const name = entry.kind === "trombi" ? t("retro.character.trombi.name") : entry.kind === "custom" ? t("retro.character.custom.name") : t(owlLook!.name);
  const bio = entry.kind === "trombi" ? t("retro.character.trombi.bio") : entry.kind === "custom" ? t("retro.character.custom.bio") : t(owlLook!.bio);
  const customMissing = entry.kind === "custom" && !custom.idle;
  return (
    <Win98Window title={t("retro.gallery.title")} onClose={onClose} icon={<OwlFaceIcon />} width={390}>
      <p className="r98-hint">{t("retro.gallery.intro")}</p>
      <div className="r98-gallery">
        <div className="r98-sunken r98-gallery-stage">
          {entry.kind === "trombi" && <Trombi pose="idle" size={92} label={name} />}
          {owlLook && <OwlAvatar ref={preview} key={owlLook.id} color={owlLook.color} skin={owlLook.skin} size={112} skinAnimated label={name} />}
          {entry.kind === "custom" && (custom.idle ? <img className="r98-custom-art" src={custom.idle} alt={name} width={110} height={110} /> : <span className="r98-gallery-empty">{t("retro.custom.none")}</span>)}
        </div>
        <div className="r98-gallery-text">
          <strong className="r98-gallery-name">{name}</strong>
          <p>{bio}</p>
          {entry.kind === "custom" && (
            <div className="r98-row r98-row-start">
              <Win98Button onClick={onCustomize}>{t("retro.custom.configure")}</Win98Button>
            </div>
          )}
          <span className="r98-hint">{t("retro.gallery.count", { index: index + 1, total: GALLERY.length })}</span>
        </div>
      </div>
      <div className="r98-row r98-row-split">
        <div className="r98-row">
          <Win98Button onClick={() => step(-1)}>{t("retro.button.back")}</Win98Button>
          <Win98Button onClick={() => step(1)}>{t("retro.button.next")}</Win98Button>
        </div>
        <div className="r98-row">
          <Win98Button
            className="r98-default"
            disabled={customMissing}
            onClick={() => onPick(entry.kind === "owl" ? { character: "owl", look: entry.look } : { character: entry.kind })}
          >
            {t("retro.button.ok")}
          </Win98Button>
          <Win98Button onClick={onClose}>{t("retro.button.cancel")}</Win98Button>
        </div>
      </div>
    </Win98Window>
  );
}

const STATE_LABELS: Record<CustomState, LocaleKey> = {
  idle: "retro.custom.state.idle",
  speak: "retro.custom.state.speak",
  think: "retro.custom.state.think",
  sleep: "retro.custom.state.sleep",
  celebrate: "retro.custom.state.celebrate",
  send: "retro.custom.state.send",
};

const PROBLEMS: Record<CustomArtProblem, LocaleKey> = {
  type: "retro.custom.problem.type",
  size: "retro.custom.problem.size",
  storage: "retro.custom.problem.storage",
};

/** "Custom assistant": one picture per moment, stored on this computer only. */
function CustomAssistantDialog({ custom, onChanged, onClose, onUse }: { custom: CustomArtUrls; onChanged: () => void; onClose: () => void; onUse: () => void }) {
  const [problem, setProblem] = useState<CustomArtProblem | null>(null);
  const [ready, setReady] = useState(Boolean(custom.idle));
  useEffect(() => {
    void loadCustomArt().then((art) => setReady(customArtReady(art)));
  }, [custom]);
  const pick = async (state: CustomState, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const result = await saveCustomArt(state, file);
    setProblem(result);
    if (!result) onChanged();
  };
  return (
    <Win98Window title={t("retro.custom.title")} onClose={onClose} icon={<OwlFaceIcon />} width={400}>
      <p className="r98-hint">{t("retro.custom.intro")}</p>
      <fieldset className="r98-group">
        <legend>{t("retro.custom.group")}</legend>
        <div className="r98-custom-grid">
          {CUSTOM_STATES.map((state) => {
            const inputId = `r98-custom-${state}`;
            const src = custom[state];
            return (
              <div key={state} className="r98-custom-row" data-custom-state={state}>
                <span className="r98-sunken r98-custom-thumb">{src ? <img src={src} alt="" width={28} height={28} /> : null}</span>
                <span className="r98-custom-label">{t(STATE_LABELS[state])}</span>
                <label className="r98-btn r98-file" htmlFor={inputId}>
                  {t("retro.custom.browse")}
                  <input id={inputId} type="file" accept="image/png,image/gif" onChange={(event) => void pick(state, event)} />
                </label>
                <Win98Button disabled={!src} onClick={() => void clearCustomArt(state).then(onChanged)}>{t("retro.custom.clear")}</Win98Button>
              </div>
            );
          })}
        </div>
      </fieldset>
      {problem && <p className="r98-hint r98-problem" role="alert">{t(PROBLEMS[problem])}</p>}
      <div className="r98-row">
        <Win98Button className="r98-default" disabled={!ready} onClick={onUse}>{t("retro.custom.use")}</Win98Button>
        <Win98Button onClick={onClose}>{t("retro.button.cancel")}</Win98Button>
      </div>
    </Win98Window>
  );
}
