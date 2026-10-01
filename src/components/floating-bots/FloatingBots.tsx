// The floating bots' brain, in the main app page (lazy: fetched only once a
// bot floats). For every bot put "on the desktop" it follows that bot's
// thread in the store, turns it into a pose and a balloon (brain.ts), and
// either sends the snapshot to the bot's own desktop window through main
// (electron/floating-bot-window.mjs) or, in a browser and on a phone, draws
// the bot over the app itself as a draggable overlay. Every API call happens
// here, through the store, exactly as if the message had been typed in the
// app: the floating windows never hold a session.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { openThread, useStore, useStreaming, type Bot } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { brand } from "@/lib/brand";
import { useRetroSkin } from "@/components/RetroChromeHost";
import { botAvatarProfile } from "../../../shared/bot-avatar";
import {
  floatingBotPrefs,
  floatingBots,
  setFloatingBotOnTop,
  setFloatingFlyAway,
  setFloatingBotPosition,
  subscribeFloatingBots,
  unfloatBot,
  type FloatingBotEntry,
} from "@/lib/floating-bots";
import {
  buildFloatingSnapshot,
  clampOverlayPosition,
  defaultOverlayPosition,
  floatingStatus,
  floatingTask,
  newFloatingSession,
  type FloatingLabels,
  type FloatingSession,
} from "./brain";
import { FloatingBotView, MASCOT_SIZE, type FloatingMover } from "./FloatingBotView";
import { moodNow, raiseMood, readMoods, writeMoods, type MoodGain, type MoodRecord } from "./mood";
import { isFloatingEvent, type FloatingAvatar, type FloatingBotsBridge, type FloatingEvent, type FloatingSnapshot } from "./protocol";

/** A picture bigger than this stays in the app; the window shows the owl instead. */
const AVATAR_BYTES_MAX = 280_000;
const CELEBRATE_MS = 1400;

function labelsFor(bot: Pick<Bot, "name">): FloatingLabels {
  const name = bot.name;
  return {
    character: t("floatingBots.aria", { name }),
    inputLabel: t("floatingBots.input.label", { name }),
    placeholder: t("floatingBots.input.placeholder", { name }),
    send: t("floatingBots.send"),
    open: t("floatingBots.open", { app: brand().name }),
    close: t("floatingBots.menu.hide"),
    hello: t("floatingBots.hello"),
    thinking: t("floatingBots.thinking"),
    approvalTitle: t("floatingBots.approval.title"),
    approval: t("floatingBots.approval", { name }),
    errorTitle: t("floatingBots.error.title"),
    error: t("floatingBots.error"),
    menuOpen: t("floatingBots.menu.openThread"),
    menuHide: t("floatingBots.menu.hide"),
    menuShow: t("floatingBots.menu.show"),
    menuTop: t("floatingBots.menu.top"),
    menuDock: t("floatingBots.menu.dock"),
    menuFly: t("floatingBots.menu.fly"),
    moodLow: t("floatingBots.mood.low", { name }),
    moodOk: t("floatingBots.mood.ok", { name }),
    moodHappy: t("floatingBots.mood.happy", { name }),
    working: t("floatingBots.working", { name }),
  };
}

function useReducedMotion(): boolean {
  const query = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const [reduced, setReduced] = useState(() => Boolean(query?.matches));
  useEffect(() => {
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, [query]);
  return reduced;
}

/** The bot's own picture, when it has one: the app URL in the overlay, a data: URL for a desktop window. */
function avatarBase(bot: Bot): Omit<FloatingAvatar, "src"> & { url: string } | null {
  const profile = botAvatarProfile(bot);
  if (!profile.avatarUrl || profile.avatarCrop === "mascot") return null;
  return {
    url: profile.avatarUrl,
    crop: profile.avatarCrop,
    zoom: bot.avatarZoom ?? 1,
    focusX: bot.avatarFocusX ?? 0.5,
    focusY: bot.avatarFocusY ?? 0.5,
  };
}

/** Reads each picture once, same-origin with the page's own session, into a bounded data: URL. */
function useAvatarData(urls: string[], enabled: boolean): Record<string, string> {
  const [data, setData] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  const key = urls.join("|");
  useEffect(() => {
    if (!enabled) return;
    for (const url of urls) {
      if (asked.current.has(url)) continue;
      asked.current.add(url);
      void fetch(url, { credentials: "same-origin" })
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (!blob || blob.size > AVATAR_BYTES_MAX || !/^image\/(png|jpeg|gif|webp)$/.test(blob.type)) return null;
          return new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        })
        .then((src) => {
          if (src) setData((current) => ({ ...current, [url]: src }));
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return data;
}

function desktopBridge(): FloatingBotsBridge | null {
  if (typeof window === "undefined") return null;
  return (window.ogb?.floatingBots as FloatingBotsBridge | undefined) ?? null;
}

export function FloatingBots() {
  const { state, dispatch } = useStore();
  const { streaming } = useStreaming();
  const entries = useSyncExternalStore(subscribeFloatingBots, floatingBots, floatingBots);
  const prefs = useSyncExternalStore(subscribeFloatingBots, floatingBotPrefs, floatingBotPrefs);
  // each mascot's mood, kept on this device (mood.ts); refreshed now and then so it drifts down
  const [moods, setMoods] = useState<Record<string, MoodRecord>>(() => readMoods());
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 5 * 60_000);
    return () => clearInterval(timer);
  }, []);
  const cheer = useCallback((botId: string, gain: MoodGain) => {
    setMoods((current) => {
      const next = { ...current, [botId]: raiseMood(current[botId], gain, Date.now()) };
      writeMoods(next);
      return next;
    });
  }, []);
  const retro = useRetroSkin();
  const reduced = useReducedMotion();
  const bridge = useMemo(desktopBridge, []);
  const [sessions, setSessions] = useState<Record<string, FloatingSession>>({});
  const stateRef = useRef(state);
  stateRef.current = state;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const locale = activeLocale();

  const floated = entries
    .map((entry) => ({ entry, bot: state.bots.find((candidate) => candidate.id === entry.id) }))
    .filter((item): item is { entry: FloatingBotEntry; bot: Bot } => Boolean(item.bot));

  // A bot deleted or hidden since it was floated goes back (once the bots are loaded).
  useEffect(() => {
    if (state.bots.length === 0) return;
    for (const entry of entries) {
      const bot = state.bots.find((candidate) => candidate.id === entry.id);
      if (!bot || bot.hidden) unfloatBot(entry.id);
    }
  }, [entries, state.bots]);

  const patch = useCallback((botId: string, change: Partial<FloatingSession> | ((session: FloatingSession) => Partial<FloatingSession>)) => {
    setSessions((current) => {
      const session = current[botId] ?? newFloatingSession();
      const next = typeof change === "function" ? change(session) : change;
      return { ...current, [botId]: { ...session, ...next } };
    });
  }, []);

  const statuses = floated.map(({ bot }) => {
    const session = sessions[bot.id] ?? newFloatingSession();
    const threadId = session.threadId ?? bot.threadId;
    return { bot, session, status: floatingStatus(bot, session, streaming[threadId]) };
  });

  // A reply that settles: remember it, sparkle, hop; an approval opens the balloon.
  const previous = useRef<Record<string, { busy: boolean; waiting: boolean }>>({});
  const previousTask = useRef<Record<string, string>>({});
  const statusKey = statuses
    .map(({ bot, session, status }) => `${bot.id}:${status.busy}:${status.waiting}:${status.streaming}:${status.reply.length}:${floatingTask(bot, session, status)}`)
    .join("|");
  useEffect(() => {
    for (const { bot, session, status } of statuses) {
      const before = previous.current[bot.id];
      previous.current[bot.id] = { busy: status.busy, waiting: status.waiting };
      const task = floatingTask(bot, session, status);
      if (!before) previousTask.current[bot.id] = task;
      if (!status.streaming && status.reply && status.reply !== session.lastReply) patch(bot.id, { lastReply: status.reply });
      if (!before) continue;
      // a finished piece of work makes the mascot happier
      const wasWorking = previousTask.current[bot.id] === "working";
      previousTask.current[bot.id] = task;
      if (wasWorking && task === "idle") cheer(bot.id, "task");
      if (before.busy && !status.busy && session.sendId && status.reply && !status.waiting) {
        patch(bot.id, (current) => ({ sparkle: current.sparkle + 1, celebrate: true }));
        setTimeout(() => patch(bot.id, { celebrate: false }), CELEBRATE_MS);
      }
      if (!before.waiting && status.waiting && session.sendId) patch(bot.id, { open: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey]);

  const send = useCallback((bot: Bot, text: string) => {
    const threadId = bot.threadId;
    const sendId = crypto.randomUUID();
    patch(bot.id, { open: true, threadId, sendId, asked: text, error: false, lastReply: "", celebrate: false });
    dispatch({ type: "send", botId: bot.id, text, threadId, sendId, onError: () => patch(bot.id, { error: true, open: true }) });
  }, [dispatch, patch]);

  const handle = useCallback((botId: string, event: FloatingEvent) => {
    const bot = stateRef.current.bots.find((candidate) => candidate.id === botId);
    if (!bot) return;
    const session = sessionsRef.current[botId] ?? newFloatingSession();
    const openInApp = () => openThread(dispatch, { botId, threadId: session.threadId ?? bot.threadId }, stateRef.current);
    switch (event.type) {
      case "click":
        patch(botId, { open: !session.open });
        break;
      case "play":
        cheer(botId, "play");
        break;
      case "pet":
        cheer(botId, "pet");
        break;
      case "dismiss":
        patch(botId, { open: false });
        break;
      case "open":
        openInApp();
        break;
      case "send":
        send(bot, event.text);
        break;
      case "menu": {
        if (event.id === "open") openInApp();
        else if (event.id === "balloon") patch(botId, { open: !session.open });
        else if (event.id === "dock") unfloatBot(botId);
        else if (event.id === "fly") setFloatingFlyAway(!floatingBotPrefs().flyAway);
        else if (event.id === "top") {
          const entry = floatingBots().find((candidate) => candidate.id === botId);
          const top = !(entry?.top ?? true);
          setFloatingBotOnTop(botId, top);
          void bridge?.setAlwaysOnTop(botId, top).catch(() => undefined);
        }
        break;
      }
      default:
        break;
    }
  }, [bridge, cheer, dispatch, patch, send]);

  /* ------------------------------------------------------------ desktop */

  const avatarUrls = floated.map(({ bot }) => avatarBase(bot)?.url).filter((url): url is string => Boolean(url));
  const avatarData = useAvatarData(avatarUrls, Boolean(bridge));

  const snapshots = statuses.map(({ bot, session, status }) => {
    const base = avatarBase(bot);
    const entry = entries.find((candidate) => candidate.id === bot.id);
    const src = base ? (bridge ? avatarData[base.url] : base.url) : undefined;
    const avatar: FloatingAvatar | null = base && src ? { src, crop: base.crop, zoom: base.zoom, focusX: base.focusX, focusY: base.focusY } : null;
    return {
      bot,
      entry,
      snapshot: buildFloatingSnapshot({
        bot,
        session,
        status,
        labels: labelsFor(bot),
        avatar,
        retro,
        reduced,
        locale,
        alwaysOnTop: bridge ? (entry?.top ?? true) : null,
        mood: moodNow(moods[bot.id], clock),
        flyAway: prefs.flyAway,
      }),
    };
  });

  // Open a window per floated bot, close the ones taken back.
  const opened = useRef(new Map<string, boolean>());
  const sent = useRef(new Map<string, string>());
  const floatedKey = floated.map(({ entry }) => `${entry.id}:${entry.top}`).join("|");
  useEffect(() => {
    if (!bridge) return;
    const wanted = new Map(floated.map(({ entry }) => [entry.id, entry.top] as const));
    for (const [id, top] of wanted) {
      if (opened.current.get(id) === top) continue;
      opened.current.set(id, top);
      void bridge.open(id, top).catch(() => undefined);
    }
    for (const id of opened.current.keys()) {
      if (wanted.has(id)) continue;
      opened.current.delete(id);
      sent.current.delete(id);
      void bridge.close(id).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, floatedKey]);

  // Close them all when the brain goes away (the app page reloads or unmounts this).
  useEffect(() => () => {
    if (!bridge) return;
    for (const id of opened.current.keys()) void bridge.close(id).catch(() => undefined);
    opened.current.clear();
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    for (const { bot, snapshot } of snapshots) {
      const json = JSON.stringify(snapshot);
      if (sent.current.get(bot.id) === json) continue;
      sent.current.set(bot.id, json);
      bridge.update(bot.id, snapshot);
    }
  });

  useEffect(() => {
    if (!bridge) return;
    const offEvent = bridge.onEvent((value) => {
      if (value && typeof value.botId === "string" && isFloatingEvent(value.event)) handle(value.botId, value.event);
    });
    const offClosed = bridge.onClosed((value) => {
      if (!value || typeof value.botId !== "string") return;
      opened.current.delete(value.botId);
      sent.current.delete(value.botId);
      unfloatBot(value.botId);
    });
    return () => {
      offEvent();
      offClosed();
    };
  }, [bridge, handle]);

  if (bridge) return null;

  /* ------------------------------------------------ browser and phone */

  return (
    <>
      {snapshots.map(({ bot, entry, snapshot }, index) => (
        <FloatingOverlay key={bot.id} botId={bot.id} index={index} saved={entry?.pos} snapshot={snapshot} onEvent={(event) => handle(bot.id, event)} />
      ))}
    </>
  );
}

const STAGE = { width: MASCOT_SIZE.width + 8, height: MASCOT_SIZE.height + 8 };

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** Browser and phone: the bot floats inside the app window, dragged with the pointer. */
function FloatingOverlay({ botId, index, saved, snapshot, onEvent }: {
  botId: string;
  index: number;
  saved?: { right: number; bottom: number };
  snapshot: FloatingSnapshot;
  onEvent: (event: FloatingEvent) => void;
}) {
  const [pos, setPos] = useState(() => clampOverlayPosition(saved ?? defaultOverlayPosition(index, STAGE), viewport(), STAGE));
  const [view, setView] = useState(viewport);
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    const onResize = () => {
      setView(viewport());
      setPos((current) => clampOverlayPosition(current, viewport(), STAGE));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const mover = useMemo<FloatingMover>(() => ({
    coords: "client",
    moveBy: (dx, dy) => setPos((current) => clampOverlayPosition({ right: current.right - dx, bottom: current.bottom - dy }, viewport(), STAGE)),
    moved: () => setFloatingBotPosition(botId, posRef.current),
  }), [botId]);

  // Near the top the balloon folds under the bot; near the left edge it opens to the right.
  const top = view.height - pos.bottom - STAGE.height;
  const left = view.width - pos.right - STAGE.width;
  const below = top < 300;
  const onLeft = left + STAGE.width / 2 < view.width / 2;
  const style: React.CSSProperties = {
    ...(below ? { top } : { bottom: pos.bottom }),
    ...(onLeft ? { left, alignItems: "flex-start" } : { right: pos.right }),
  };
  return (
    <FloatingBotView
      className={onLeft ? "fb-overlay fb-left" : "fb-overlay"}
      style={style}
      below={below}
      snapshot={snapshot}
      onEvent={onEvent}
      mover={mover}
    />
  );
}

export default FloatingBots;
