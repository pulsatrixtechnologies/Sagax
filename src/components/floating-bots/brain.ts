// A floating bot's brain, kept pure so it can be tested without a DOM: where
// its reply is, what pose and balloon that means, and where an in-app overlay
// may stand. The main app page runs it for every floated bot and sends the
// result to that bot's window (desktop) or draws it itself (browser, phone).
import type { Bot, Message, Task } from "@/state/store";
import type { FloatingAvatar, FloatingBalloon, FloatingMenuItem, FloatingPose, FloatingSnapshot } from "./protocol";

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
});

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

export function floatingMenu(labels: FloatingLabels, session: FloatingSession, alwaysOnTop: boolean | null): FloatingMenuItem[] {
  return [
    { id: "open", label: labels.menuOpen },
    { id: "balloon", label: session.open ? labels.menuHide : labels.menuShow },
    ...(alwaysOnTop === null ? [] : [{ id: "top", label: labels.menuTop, checked: alwaysOnTop }]),
    { id: "dock", label: labels.menuDock },
  ];
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
  const common = { open: labels.open, close: labels.close, asked: session.asked ?? undefined };
  const input_ = { label: labels.inputLabel, placeholder: labels.placeholder, send: labels.send };
  let balloon: FloatingBalloon | null = null;
  if (session.open) {
    if (session.error) {
      balloon = { ...common, kind: "error", title: labels.errorTitle, text: labels.error, streaming: false, truncated: false, input: input_ };
    } else if (status.waiting) {
      balloon = { ...common, kind: "approval", title: labels.approvalTitle, text: labels.approval, streaming: false, truncated: false, input: null };
    } else if (status.busy && !status.reply) {
      balloon = { ...common, kind: "thinking", text: labels.thinking, streaming: false, truncated: false, input: input_ };
    } else {
      const reply = truncateReply(plainReply(status.reply));
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
    menu: floatingMenu(labels, session, input.alwaysOnTop),
    balloon,
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
