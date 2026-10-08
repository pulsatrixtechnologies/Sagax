// A floating bot's brain, kept pure so it can be tested without a DOM: where
// its reply is, what pose and balloon that means, and where an in-app overlay
// may stand. The main app page runs it for every floated bot and sends the
// result to that bot's window (desktop) or draws it itself (browser, phone).
import type { Bot, Message, Task } from "@/state/store";
import type { FloatingAvatar, FloatingBalloon, FloatingMenuItem, FloatingPose, FloatingSnapshot, MascotTask } from "./protocol";
import { moodLevel } from "./mood";
import type { Liveliness } from "./behavior";
import type { FloatingContext } from "./gauge";
import type { MascotLook } from "../../../shared/mascot-look";

/** What the balloon keeps of a long reply; the rest is one click away in the app. */
export const BALLOON_REPLY_CHARS = 3000;

/** Per floated bot, in the brain: the conversation the balloon is following. */
export interface FloatingSession {
  open: boolean;
  /** The thread the last message from the balloon went to. */
  threadId: string | null;
  sendId: string | null;
  asked: string | null;
  error: boolean;
  /** Bumped when a reply settles. */
  sparkle: number;
  /** A short happy pose right after a reply settles. */
  celebrate: boolean;
  /** The last reply seen, kept while the app shows another of the bot's threads. */
  lastReply: string;
  /** Earlier exchanges of this conversation, oldest first. */
  history: { asked: string; text: string }[];
}

export const newFloatingSession = (): FloatingSession => ({
  open: false,
  threadId: null,
  sendId: null,
  asked: null,
  error: false,
  sparkle: 0,
  celebrate: false,
  lastReply: "",
  history: [],
});

/** Earlier exchanges kept in the balloon, and how much of each. */
export const BALLOON_HISTORY = 4;
const HISTORY_TEXT = 2000;

/** The conversation so far, before a new question: the last exchange joins the history. */
export function withHistory(session: FloatingSession): FloatingSession["history"] {
  if (!session.asked && !session.lastReply) return session.history;
  return [...session.history, { asked: session.asked ?? "", text: truncateReply(session.lastReply, HISTORY_TEXT).text }].slice(-BALLOON_HISTORY);
}

export interface FloatingLabels {
  character: string;
  inputLabel: string;
  placeholder: string;
  send: string;
  open: string;
  close: string;
  hello: string;
  thinking: string;
  approvalTitle: string;
  approval: string;
  errorTitle: string;
  error: string;
  menuOpen: string;
  menuHide: string;
  menuShow: string;
  menuTop: string;
  menuDock: string;
  menuFly: string;
  moodLow: string;
  moodOk: string;
  moodHappy: string;
  /** The parked badge's label while the bot works away from its spot. */
  working: string;
  /** The owl's hoot bubble. */
  hoot?: string;
  /** The balloon's "put back by the mascot" button. */
  pin?: string;
  /** "Activity: normal", the menu item that cycles the activity level. */
  menuLively?: string;
  /** The right-click menu as JC set it out (absent: the older, flat menu's labels). */
  menuTalk?: string;
  menuCloseChat?: string;
  menuCall?: string;
  menuHangUp?: string;
  menuSwitch?: string;
  menuMoves?: string;
  menuSnooze?: string;
  menuHideMascot?: string;
  menuOptions?: string;
  menuSettings?: string;
  /** The composer row's clip label. */
  attach?: string;
}

/** What the menu offers besides the brain's own state: the call, the person's bots, the character's moves. */
export interface FloatingMenuExtras {
  /** "start" where voice mode serves the bot, "end" during its call, null otherwise. */
  call?: "start" | "end" | null;
  /** The person's bots for "Switch bot": this one checked, one already on the desktop greyed. */
  bots?: { id: string; name: string; floating: boolean }[];
  /** The character's moves, named. */
  moves?: { clip: string; label: string }[];
}

export type FloatingBot = Pick<Bot, "id" | "name" | "color" | "mascotSkin" | "threadId" | "messages" | "busy" | "activity"> & {
  tasks?: Pick<Task, "threadId" | "busy" | "activity">[];
};

const optimisticId = (sendId: string) => `optimistic-${sendId}`;

/** The texts the bot said after the message sent from the balloon, oldest first. */
export function replyAfter(messages: readonly Message[], sendId: string): { found: boolean; text: string } {
  const at = messages.findIndex((message) => message.sendId === sendId || message.id === optimisticId(sendId));
  if (at < 0) return { found: false, text: "" };
  const texts = messages
    .slice(at + 1)
    .filter((message) => message.role === "bot" && message.kind === "text" && typeof message.text === "string" && message.text.trim())
    .map((message) => message.text!.trim());
  return { found: true, text: texts.join("\n\n") };
}

/** Markdown read aloud in a balloon: emphasis, headings, links and fences lose their marks. */
export function plainReply(text: string): string {
  return text
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Keeps the start of a long reply, cut at a word, with an ellipsis. */
export function truncateReply(text: string, max = BALLOON_REPLY_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return { text: `${(space > max * 0.8 ? cut.slice(0, space) : cut).trimEnd()}…`, truncated: true };
}

export interface FloatingStatus {
  busy: boolean;
  waiting: boolean;
  /** The reply so far: settled texts plus what is streaming now. */
  reply: string;
  streaming: boolean;
}

/** What the thread the balloon follows is doing, from the store and the live stream. */
export function floatingStatus(bot: FloatingBot, session: FloatingSession, stream: string | undefined): FloatingStatus {
  const threadId = session.threadId ?? bot.threadId;
  const task = bot.tasks?.find((candidate) => candidate.threadId === threadId);
  const onScreen = bot.threadId === threadId;
  const busy = Boolean(task?.busy ?? (onScreen ? bot.busy : false));
  const activity = task?.activity ?? (onScreen ? bot.activity : undefined);
  let settled = session.lastReply;
  if (session.sendId && onScreen) {
    const found = replyAfter(bot.messages, session.sendId);
    if (found.found) settled = found.text;
  }
  const live = stream?.trim() ? stream : "";
  return {
    busy,
    waiting: activity === "waiting-on-you",
    reply: [settled, live].filter(Boolean).join("\n\n"),
    streaming: Boolean(live),
  };
}

/** Bots offered in "Switch bot" (a native submenu stays short). */
export const SWITCH_BOTS_MAX = 24;

/**
 * The mascot's right-click menu: Talk, Start a voice call, Open in the app;
 * Switch bot and Moves (submenus); Hide for 1 hour and Hide; the desktop
 * options (always on top, fly away, activity) and Settings. Ids: "balloon",
 * "call", "open", "switch:<botId>", "move:<clip>", "snooze", "dock", "top",
 * "fly", "lively", "settings".
 */
export function floatingMenu(labels: FloatingLabels, session: FloatingSession, alwaysOnTop: boolean | null, flyAway = true, extras: FloatingMenuExtras = {}, botId = ""): FloatingMenuItem[] {
  const options: FloatingMenuItem[] = [
    ...(alwaysOnTop === null ? [] : [{ id: "top", label: labels.menuTop, checked: alwaysOnTop }]),
    { id: "fly", label: labels.menuFly, checked: flyAway },
    ...(labels.menuLively ? [{ id: "lively", label: labels.menuLively }] : []),
  ];
  const bots = (extras.bots ?? []).slice(0, SWITCH_BOTS_MAX);
  const moves = extras.moves ?? [];
  const sep = (n: number): FloatingMenuItem => ({ id: `sep-${n}`, label: "", type: "separator" });
  return [
    { id: "balloon", label: session.open ? labels.menuCloseChat ?? labels.menuHide : labels.menuTalk ?? labels.menuShow },
    ...(extras.call ? [{ id: "call", label: extras.call === "end" ? labels.menuHangUp ?? "" : labels.menuCall ?? "" }] : []),
    { id: "open", label: labels.menuOpen },
    ...(bots.length > 1 || moves.length ? [sep(1)] : []),
    ...(bots.length > 1 && labels.menuSwitch
      ? [{
          id: "switch",
          label: labels.menuSwitch,
          items: bots.map((bot) => ({
            id: `switch:${bot.id}`,
            label: bot.name,
            ...(bot.id === botId ? { checked: true } : {}),
            ...(bot.floating && bot.id !== botId ? { enabled: false } : {}),
          })),
        }]
      : []),
    ...(moves.length && labels.menuMoves ? [{ id: "moves", label: labels.menuMoves, items: moves.map((move) => ({ id: `move:${move.clip}`, label: move.label })) }] : []),
    sep(2),
    ...(labels.menuSnooze ? [{ id: "snooze", label: labels.menuSnooze }] : []),
    { id: "dock", label: labels.menuHideMascot ?? labels.menuDock },
    sep(3),
    ...(labels.menuOptions ? [{ id: "options", label: labels.menuOptions, items: options }] : options),
    ...(labels.menuSettings ? [{ id: "settings", label: labels.menuSettings }] : []),
  ];
}

/**
 * What the mascot should do about the bot's work: fly off while any of its
 * threads runs, come back for an approval, look sad after a failed send.
 */
export function floatingTask(bot: FloatingBot, session: FloatingSession, status: FloatingStatus): MascotTask {
  if (session.error) return "error";
  const tasks = bot.tasks ?? [];
  if (status.waiting || bot.activity === "waiting-on-you" || tasks.some((task) => task.activity === "waiting-on-you")) return "waiting";
  if (status.busy || bot.busy || tasks.some((task) => task.busy)) return "working";
  return "idle";
}

export interface FloatingInput {
  bot: FloatingBot;
  session: FloatingSession;
  status: FloatingStatus;
  labels: FloatingLabels;
  avatar: FloatingAvatar | null;
  retro: boolean;
  reduced: boolean;
  locale: string;
  /** null where there is no desktop window to keep on top (browser, phone). */
  alwaysOnTop: boolean | null;
  /** The mascot's mood, 0..1 (mood.ts); a new mascot when absent. */
  mood?: number;
  /** The "Fly away during tasks" setting; on when absent. */
  flyAway?: boolean;
  /** The "Activity level" setting. */
  liveliness?: Liveliness;
  /** The followed thread's context use (context.ts), for the energy bar. */
  context?: FloatingContext | null;
  /** The character the bot wears on the desktop. */
  mascot?: MascotLook;
  /** The menu's call item, the person's bots and the character's moves. */
  menu?: FloatingMenuExtras;
  /** The composer row's model chip: the text the app's chip shows, and its title. */
  model?: { label: string; title?: string } | null;
}

/** The pose and balloon for this moment, as one snapshot. */
export function buildFloatingSnapshot(input: FloatingInput): FloatingSnapshot {
  const { bot, session, status, labels } = input;
  const pose: FloatingPose = session.error || status.waiting
    ? "alert"
    : status.streaming
      ? "speak"
      : status.busy
        ? "think"
        : session.celebrate
          ? "celebrate"
          : "idle";
  const common = { open: labels.open, close: labels.close, asked: session.asked ?? undefined, history: session.history ?? [] };
  const mood = Math.round(Math.min(1, Math.max(0, input.mood ?? 0.6)) * 100) / 100;
  const level = moodLevel(mood);
  const flyAway = input.flyAway !== false;
  const input_ = {
    label: labels.inputLabel,
    placeholder: labels.placeholder,
    send: labels.send,
    ...(labels.attach ? { attach: labels.attach } : {}),
    ...(input.model?.label ? { model: input.model.label, ...(input.model.title ? { modelTitle: input.model.title } : {}) } : {}),
  };
  let balloon: FloatingBalloon | null = null;
  if (session.open) {
    if (session.error) {
      balloon = { ...common, kind: "error", title: labels.errorTitle, text: labels.error, streaming: false, truncated: false, input: input_ };
    } else if (status.waiting) {
      balloon = { ...common, kind: "approval", title: labels.approvalTitle, text: labels.approval, streaming: false, truncated: false, input: null };
    } else if (status.busy && !status.reply) {
      balloon = { ...common, kind: "thinking", text: labels.thinking, streaming: false, truncated: false, input: input_ };
    } else {
      // the reply as markdown: the balloon renders it like the chat
      const reply = truncateReply(status.reply);
      balloon = {
        ...common,
        kind: "chat",
        text: session.sendId ? reply.text : reply.text || labels.hello,
        streaming: status.streaming,
        truncated: reply.truncated,
        input: input_,
      };
    }
  }
  return {
    v: 1,
    id: bot.id,
    name: bot.name,
    label: labels.character,
    color: bot.color,
    skin: bot.mascotSkin ?? "none",
    avatar: input.avatar,
    pose,
    reduced: input.reduced,
    retro: input.retro,
    sparkle: session.sparkle,
    locale: input.locale,
    menu: floatingMenu(labels, session, input.alwaysOnTop, flyAway, input.menu, bot.id),
    balloon,
    task: floatingTask(bot, session, status),
    mood,
    flyAway,
    hints: {
      mood: level === "low" ? labels.moodLow : level === "happy" ? labels.moodHappy : labels.moodOk,
      working: labels.working,
      ...(labels.hoot ? { hoot: labels.hoot } : {}),
      ...(labels.pin ? { pin: labels.pin } : {}),
    },
    liveliness: input.liveliness ?? "normal",
    context: input.context ?? null,
    mascot: input.mascot ?? { character: "owl" },
  };
}

/**
 * Keeps an in-app floating bot on screen: at least `margin` px from every
 * edge of the viewport, whatever size the window was when it was dropped.
 */
export function clampOverlayPosition(
  position: { right: number; bottom: number },
  viewport: { width: number; height: number },
  size: { width: number; height: number },
  margin = 8,
): { right: number; bottom: number } {
  const maxRight = Math.max(margin, viewport.width - size.width - margin);
  const maxBottom = Math.max(margin, viewport.height - size.height - margin);
  return {
    right: Math.round(Math.min(Math.max(position.right, margin), maxRight)),
    bottom: Math.round(Math.min(Math.max(position.bottom, margin), maxBottom)),
  };
}

/** Where a newly floated in-app bot lands: along the bottom right, one step per bot. */
export function defaultOverlayPosition(index: number, size: { width: number }): { right: number; bottom: number } {
  return { right: 24 + (index % 6) * (size.width + 8), bottom: 96 + Math.floor(index / 6) * 120 };
}
