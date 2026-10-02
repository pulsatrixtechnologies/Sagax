// The live view of the signed-in person's server environment desktop
// (server/routes/desktop-viewer.ts, target `sandbox/me`): where the Computer
// panel shows it, and how the server's answers read.
import type { DesktopBridgeStatus } from "./desktop-bridge";

export const SANDBOX_VIEWER_TARGET = "sandbox/me";

export function sandboxViewerPath(control: boolean, websocket = false): string {
  return `/api/desktop-viewer/${SANDBOX_VIEWER_TARGET}${websocket ? "/websockify" : ""}${control ? "?control=1" : ""}`;
}

export type SandboxViewerProblem = "closed" | "busy" | "outdated" | "unavailable";

/** `code`: the reason the server gives with the status (an environment from
 * before the desktop that could not be updated while a bot works there). */
export function sandboxViewerProblem(status: number, code?: unknown): SandboxViewerProblem {
  if (status === 403 || status === 404) return "closed";
  if (status === 429) return "busy";
  if (code === "outdated") return "outdated";
  return "unavailable";
}

/** What a key does in the large take-control window, seen before anything
 * else (capture phase), so the panels behind it never see it.
 * Cmd/Ctrl+Shift+Escape always closes it; a plain Escape closes it only when
 * the key is not for the remote screen (focus outside the VNC canvas). */
export function takeoverKey(event: Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey">, inScreen: boolean): "close" | null {
  if (event.key !== "Escape") return null;
  if (event.shiftKey && (event.metaKey || event.ctrlKey)) return "close";
  if (!inScreen && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) return "close";
  return null;
}

/** Whether the person's bots do computer work on their server environment
 * desktop right now: an organization server (a bridge status exists) where
 * the person chose the server, or their computer is not connected. */
export function showsSandboxDesktop(bridge: DesktopBridgeStatus | null): boolean {
  if (!bridge) return false;
  return bridge.workplace.place === "server" || !bridge.connected;
}
