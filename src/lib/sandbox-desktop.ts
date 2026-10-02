// The live view of the signed-in person's server environment desktop
// (server/routes/desktop-viewer.ts, target `sandbox/me`): where the Computer
// panel shows it, and how the server's answers read.
import type { DesktopBridgeStatus } from "./desktop-bridge";

export const SANDBOX_VIEWER_TARGET = "sandbox/me";

export function sandboxViewerPath(control: boolean, websocket = false): string {
  return `/api/desktop-viewer/${SANDBOX_VIEWER_TARGET}${websocket ? "/websockify" : ""}${control ? "?control=1" : ""}`;
}

export type SandboxViewerProblem = "closed" | "busy" | "unavailable";

export function sandboxViewerProblem(status: number): SandboxViewerProblem {
  if (status === 403 || status === 404) return "closed";
  if (status === 429) return "busy";
  return "unavailable";
}

/** Whether this bot's computer use runs on the person's server environment
 * desktop right now: an organization server (a bridge status exists) where
 * the person chose the server, or their computer is not connected, and the
 * bot has a computer at all. */
export function showsSandboxDesktop(bridge: DesktopBridgeStatus | null, computer: string | undefined): boolean {
  if (!bridge) return false;
  if (computer === "off" || computer === "browser") return false;
  return bridge.workplace.place === "server" || !bridge.connected;
}
