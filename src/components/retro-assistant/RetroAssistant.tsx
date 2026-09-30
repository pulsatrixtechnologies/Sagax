// Hibou 98: the owl as a late-90s desktop assistant. Loaded lazily the first
// time the easter egg is switched on (see src/lib/retro98.ts), so none of this
// costs anything on a device that never finds it.
//
// It recreates the era's behaviour with our own assets: an eager helper that
// perks up and taps the glass when you write a long message, paste, switch
// conversations or come back from a break; a balloon with a question, round
// bullet choices and a "What would you like to do?" search; a light bulb when
// a tip is waiting; an idle cycle that ends in a doze; a context menu, an
// assistant gallery and an options dialog. The owl is the app's own
// (OwlAvatar, unchanged); every word, icon and sound here is original.
import "./retro-assistant.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { OwlAvatar, type OwlAvatarHandle } from "@/components/OwlAvatar";
import type { OwlGaze, OwlState } from "@/lib/owl/owl-art";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { onRetroSignal, setRetroEnabled } from "@/lib/retro98";
import { useStore } from "@/state/store";
import {
  BIG_PASTE_CHARS,
  LONG_MESSAGE_CHARS,
  RANDOM_ANIMATIONS,
  RETRO_GUESSES,
  RETRO_LOOKS,
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
  type RetroGuess,
  type RetroOptions,
  type RetroPrefs,
  type RetroTip,
  type TipAction,
} from "./logic";
import { createRetroSounds } from "./sounds";
import { BulbIcon, Envelope, Notebook, OwlFaceIcon, Puff, TapMarks, Zzz } from "./RetroArt";
import { Win98Button, Win98Check, Win98Window } from "./Win98";

const OWL_SIZE = 96;
const TIP_EVERY_MS = 45_000;
const COMPOSER = '[data-tour="composer"]';

type Balloon =
  | { kind: "welcome" }
  | { kind: "tip"; tip: RetroTip }
  | { kind: "guess"; guess: RetroGuess }
  | { kind: "results"; query: string; tips: RetroTip[] };

type Act = { name: RetroAnimation | "enter" | "leave" | "celebrate"; n: number };

export interface RetroAssistantProps {
  /** True once the mode was switched off: play the exit, then call onGone. */
  leaving?: boolean;
  /** Switched on just now (a welcome), rather than restored at startup. */
  fresh?: boolean;
  onGone?: () => void;
  /** Tests and previews pin reduced motion; undefined follows the OS. */
  reducedMotion?: boolean;
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

/** Where the owl perches by default: just above the composer's right end. */
function perchAboveComposer(): { right: number; bottom: number } {
  const composer = typeof document === "undefined" ? null : document.querySelector(COMPOSER);
  if (!composer) return { right: 24, bottom: 120 };
  const rect = composer.getBoundingClientRect();
  return {
    right: Math.max(8, window.innerWidth - rect.right + 6),
    bottom: Math.max(8, window.innerHeight - rect.top + 10),
  };
}

export default function RetroAssistant({ leaving = false, fresh = false, onGone, reducedMotion }: RetroAssistantProps) {
  const { state, dispatch } = useStore();
  const reduced = useReducedMotion(reducedMotion);
  const plan = motionPlan(reduced);

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
  const [dialog, setDialog] = useState<"options" | "gallery" | null>(null);
  const [mood, setMood] = useState<IdlePhase>("awake");
  const [act, setAct] = useState<Act | null>(null);
  const [envelopes, setEnvelopes] = useState<number[]>([]);
  const [gaze, setGaze] = useState<OwlGaze | undefined>(undefined);
  const [perch, setPerch] = useState(() => perchAboveComposer());
  const [query, setQuery] = useState("");

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

  const look = lookById(prefs.look);
  const position = prefs.position ?? perch;

  /* ------------------------------------------------------------ animations */

  const play = useCallback((name: Act["name"], ms: number) => {
    counter.current += 1;
    const n = counter.current;
    setAct({ name, n });
    later(ms, () => setAct((current) => (current?.n === n ? null : current)));
  }, [later]);

  const sendEnvelope = useCallback(() => {
    if (!plan.travel) return;
    counter.current += 1;
    const n = counter.current;
    setEnvelopes((list) => [...list, n]);
    later(1400, () => setEnvelopes((list) => list.filter((value) => value !== n)));
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

  const search = (event: FormEvent) => {
    event.preventDefault();
    const found = searchTips(query, (tip) => t(tip.text));
    sounds.play("click");
    openBalloon({ kind: "results", query, tips: found }, null);
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
        if (kind !== "send") return;
        longArmed.current = true;
        setBalloon((current) => (current?.kind === "guess" && current.guess.kind === "longMessage" ? null : current));
        runAnimation("envelope");
      }),
    [runAnimation],
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

  // Scribble while any bot works; celebrate when one finishes a reply.
  const busyIds = state.bots.filter((bot) => bot.busy).map((bot) => bot.id).join(",");
  const previousBusy = useRef(busyIds);
  useEffect(() => {
    const before = previousBusy.current ? previousBusy.current.split(",") : [];
    const now = busyIds ? busyIds.split(",") : [];
    previousBusy.current = busyIds;
    if (before.some((id) => !now.includes(id))) {
      owl.current?.flourish("spread");
      owl.current?.play("success");
      if (plan.travel) play("celebrate", 1200);
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
        const clamped = clampPosition(prefsRef.current.position, { width: window.innerWidth, height: window.innerHeight }, OWL_SIZE);
        setPrefsState((current) => ({ ...current, position: clamped }));
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ------------------------------------------------------------------ drag */

  const drag = useRef<{ x: number; y: number; right: number; bottom: number; moved: boolean; id: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ right: number; bottom: number } | null>(null);

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
    setDragPos(clampPosition({ right: start.right - dx, bottom: start.bottom - dy }, { width: window.innerWidth, height: window.innerHeight }, OWL_SIZE));
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
    sounds.play("click");
    if (balloon) setBalloon(null);
    else if (bulb) openTip(bulb);
    else openBalloon({ kind: "welcome" });
  };
  const onContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    sounds.play("click");
    setBalloon(null);
    setMenu({ x: event.clientX, y: event.clientY });
  };
  const onOwlKey = (event: ReactKeyboardEvent) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu({ x: box.left, y: box.top });
    }
  };

  const at = dragPos ?? position;
  const owlTop = typeof window === "undefined" ? 600 : window.innerHeight - at.bottom - OWL_SIZE;
  const balloonBelow = owlTop < 300;

  /* ---------------------------------------------------------------- render */

  const owlState: OwlState = state.bots.some((bot) => bot.busy)
    ? "working"
    : mood === "doze"
      ? "sleepy"
      : "idle";

  const bullets = (items: Array<{ key: string; label: string; onClick: () => void }>) => (
    <ul className="r98-bullets">
      {items.map((item) => (
        <li key={item.key}>
          <button type="button" onClick={() => { sounds.play("click"); item.onClick(); }}>
            <span className="r98-dot" aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );

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

  let body: React.ReactNode = null;
  if (balloon?.kind === "welcome") {
    body = (
      <>
        <p className="r98-question">{t("retro.welcome")}</p>
        {bullets([
          { key: "tip", label: t("retro.welcome.tip"), onClick: () => openTip(pickTip()) },
          { key: "look", label: t("retro.welcome.look"), onClick: () => { setBalloon(null); setDialog("gallery"); } },
          { key: "none", label: t("retro.welcome.nothing"), onClick: () => setBalloon(null) },
        ])}
        {askBox(true)}
      </>
    );
  } else if (balloon?.kind === "tip") {
    const tip = balloon.tip;
    body = (
      <>
        <div className="r98-tip-head">
          <BulbIcon size={18} />
          <strong>{t("retro.tip.title")}</strong>
        </div>
        <p>{t(tip.text)}</p>
        <p className="r98-question">{tip.action ? t("retro.tip.showMe") : t("retro.tip.another")}</p>
        <div className="r98-row r98-row-3">
          <Win98Button className="r98-default" onClick={() => (tip.action ? runAction(tip.action) : openTip(pickTip()))}>{t("retro.button.yes")}</Win98Button>
          <Win98Button onClick={() => setBalloon(null)}>{t("retro.button.noThanks")}</Win98Button>
          <Win98Button onClick={() => { dismiss(tip.id); setBalloon(null); }}>{t("retro.button.never")}</Win98Button>
        </div>
      </>
    );
  } else if (balloon?.kind === "guess") {
    const guess = balloon.guess;
    body = (
      <>
        <p className="r98-question">{t(guess.question)}</p>
        {bullets([
          { key: "help", label: t(guess.help), onClick: () => openTip(guess.kind === "idle" ? pickTip() : tipById(guess.tip) ?? null) },
          { key: "skip", label: t(guess.skip), onClick: () => setBalloon(null) },
          { key: "never", label: t("retro.guess.never"), onClick: () => { dismiss(`guess:${guess.kind}`); setBalloon(null); } },
        ])}
        {askBox(false)}
      </>
    );
  } else if (balloon?.kind === "results") {
    body = (
      <>
        <p className="r98-question">{balloon.tips.length ? t("retro.results.found") : t("retro.results.none")}</p>
        {balloon.tips.length > 0 &&
          bullets(balloon.tips.slice(0, 5).map((tip) => ({ key: tip.id, label: t(tip.text), onClick: () => openTip(tip) })))}
        {askBox(true)}
      </>
    );
  }

  return (
    <div className="r98-root" data-reduced={reduced ? "" : undefined}>
      <div
        className={cn("r98-stage", act && `r98-act-${act.name}`, `r98-mood-${mood}`)}
        style={{ right: at.right, bottom: at.bottom, width: OWL_SIZE, height: OWL_SIZE }}
        data-retro-owl=""
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
            aria-label={t("retro.aria.owl")}
            aria-haspopup="menu"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => { drag.current = null; setDragPos(null); }}
            onContextMenu={onContextMenu}
            onKeyDown={onOwlKey}
          >
            <OwlAvatar
              ref={owl}
              color={look.color}
              skin={look.skin}
              size={OWL_SIZE}
              state={owlState}
              gaze={gaze}
              reducedMotion={reducedMotion}
              label={null}
            />
          </button>
          {owlState === "working" && <Notebook />}
          {mood === "doze" && plan.travel && <Zzz />}
          {act?.name === "tap" && <TapMarks />}
        </div>
        {envelopes.map((id) => (
          <span key={id} className="r98-envelope">
            <Envelope />
          </span>
        ))}
        {leaving && plan.exit === "puff" && <Puff />}
      </div>

      {balloon && body && (
        <div
          role="dialog"
          aria-label={t("retro.aria.balloon")}
          className={cn("r98-balloon", balloonBelow && "r98-balloon-below")}
          style={
            balloonBelow
              ? { right: Math.max(8, at.right - 6), top: window.innerHeight - at.bottom + 12 }
              : { right: Math.max(8, at.right - 6), bottom: at.bottom + OWL_SIZE + 12 }
          }
        >
          <span className="r98-balloon-shade" aria-hidden="true" />
          <div className="r98-balloon-face">
            <span className="r98-tail" aria-hidden="true" />
            {body}
          </div>
        </div>
      )}

      {menu && <OwlMenu at={menu} onClose={() => setMenu(null)} onPick={(item) => {
        setMenu(null);
        sounds.play("click");
        if (item === "hide") setRetroEnabled(false);
        else if (item === "options") setDialog("options");
        else if (item === "gallery") setDialog("gallery");
        else runAnimation(RANDOM_ANIMATIONS[Math.floor(Math.random() * RANDOM_ANIMATIONS.length)]);
      }} />}

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
          current={prefs.look}
          onClose={() => setDialog(null)}
          onPick={(id) => {
            setPrefs((current) => ({ ...current, look: id }));
            setDialog(null);
            later(50, () => owl.current?.flourish("spread"));
            sounds.play("chime");
          }}
        />
      )}
    </div>
  );
}

type MenuItem = "hide" | "options" | "gallery" | "animate";

function OwlMenu({ at, onClose, onPick }: { at: { x: number; y: number }; onClose: () => void; onPick: (item: MenuItem) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const items: Array<{ id: MenuItem; label: string; separator?: boolean }> = [
    { id: "hide", label: t("retro.menu.hide") },
    { id: "options", label: t("retro.menu.options"), separator: true },
    { id: "gallery", label: t("retro.menu.choose") },
    { id: "animate", label: t("retro.menu.animate"), separator: true },
  ];
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [onClose]);
  const width = 176;
  const left = Math.min(at.x, window.innerWidth - width - 4);
  const top = Math.min(at.y, window.innerHeight - 110);
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
          <button type="button" role="menuitem" className="r98-menu-item" onClick={() => onPick(item.id)}>
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

function GalleryDialog({ current, onPick, onClose }: { current: string; onPick: (id: RetroPrefs["look"]) => void; onClose: () => void }) {
  const [index, setIndex] = useState(() => Math.max(0, RETRO_LOOKS.findIndex((look) => look.id === current)));
  const preview = useRef<OwlAvatarHandle>(null);
  const look = RETRO_LOOKS[index];
  const step = (delta: number) => {
    setIndex((value) => (value + delta + RETRO_LOOKS.length) % RETRO_LOOKS.length);
    setTimeout(() => preview.current?.flourish("hoot"), 30);
  };
  return (
    <Win98Window title={t("retro.gallery.title")} onClose={onClose} icon={<OwlFaceIcon />} width={380}>
      <p className="r98-hint">{t("retro.gallery.intro")}</p>
      <div className="r98-gallery">
        <div className="r98-sunken r98-gallery-stage">
          <OwlAvatar ref={preview} key={look.id} color={look.color} skin={look.skin} size={112} skinAnimated label={t(look.name)} />
        </div>
        <div className="r98-gallery-text">
          <strong className="r98-gallery-name">{t(look.name)}</strong>
          <p>{t(look.bio)}</p>
          <span className="r98-hint">{t("retro.gallery.count", { index: index + 1, total: RETRO_LOOKS.length })}</span>
        </div>
      </div>
      <div className="r98-row r98-row-split">
        <div className="r98-row">
          <Win98Button onClick={() => step(-1)}>{t("retro.button.back")}</Win98Button>
          <Win98Button onClick={() => step(1)}>{t("retro.button.next")}</Win98Button>
        </div>
        <div className="r98-row">
          <Win98Button className="r98-default" onClick={() => onPick(look.id)}>{t("retro.button.ok")}</Win98Button>
          <Win98Button onClick={onClose}>{t("retro.button.cancel")}</Win98Button>
        </div>
      </div>
    </Win98Window>
  );
}
