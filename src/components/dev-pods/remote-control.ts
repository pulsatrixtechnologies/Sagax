// Remote Control on the Environment pod. A link or a live session offers a
// switch, open and copy. A Tailcat socket alone still shows the row: open
// jumps to it, and only a short code or name is copied. The socket address
// itself is never shown or copied.
import { isTailcatAddress, type RemoteSessionView } from "../../../shared/remote-session";
import type { TerminalEmbed } from "../../../shared/terminal-resources";

export interface RemoteControlOffer {
  sessionId?: string;
  /** https link safe to open and copy. */
  link?: string;
  /** A support code or a short host name. Never a tunnel address. */
  copy?: string;
  /** The conversation row to scroll to when there is nothing else to open. */
  messageId?: string;
  /** A live session can take and release control. */
  controllable: boolean;
  /** Nothing but a Tailcat socket. The row stays. */
  socketOnly: boolean;
}

interface RemoteMessage {
  id: string;
  text?: string;
  remoteSession?: RemoteSessionView;
  terminalEmbed?: TerminalEmbed;
  tool?: { output?: string };
}

const LINK = /https:\/\/[^\s<>"')]+/g;
const CODE = /\b[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}\b/;

function httpsLink(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/tc[0-9A-Za-z_-]{8,}/g, " ");
  const found = cleaned.match(LINK)?.find((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  });
  return found;
}

function copyableName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const name = value.trim();
  if (!name || name.length > 80 || isTailcatAddress(name) || /nodekey:|[\s/\\]/.test(name)) return undefined;
  return name;
}

function hasSocket(text: string | undefined): boolean {
  if (!text) return false;
  return isTailcatAddress(text.trim()) || /(?:^|\s)tc[0-9A-Za-z_-]{8,}/.test(text);
}

/** What the pod can do with the remote control it can already see. */
export function remoteControlOffer(messages: readonly RemoteMessage[], sessions: readonly RemoteSessionView[] = []): RemoteControlOffer | null {
  const session = sessions.find((row) => row.state === "connected")
    ?? [...messages].reverse().find((message) => message.remoteSession?.state === "connected")?.remoteSession;
  const socketMessage = [...messages].reverse().find((message) =>
    (message.terminalEmbed?.provider === "tailcat" && message.terminalEmbed.status !== "ended")
    || hasSocket(message.text)
    || hasSocket(message.tool?.output));
  const link = messages.map((message) => httpsLink(message.text) ?? httpsLink(message.tool?.output)).find(Boolean);
  if (!session && !link && !socketMessage) return null;
  const code = session?.code ?? messages.map((message) => CODE.exec(message.text ?? "")?.[0] ?? CODE.exec(message.tool?.output ?? "")?.[0]).find(Boolean);
  const socketOnly = !session && !link && Boolean(socketMessage);
  const copy = link ?? code ?? (socketOnly ? copyableName(socketMessage?.terminalEmbed?.hostLabel) ?? code : code);
  return {
    ...(session ? { sessionId: session.id } : {}),
    ...(link ? { link } : {}),
    ...(copy ? { copy } : {}),
    ...(socketMessage ? { messageId: socketMessage.id } : {}),
    controllable: Boolean(session && session.state === "connected" && !session.headless),
    socketOnly,
  };
}
