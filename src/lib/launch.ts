// The launch screen: before the welcome tour, the desktop app asks how this
// computer is used. "No server" is the solo, local-first app as it always
// was. "Server" adds an organization's Sagax server (one that signs people
// in with Pulsatrix, through Perspicax) and starts that server's own
// "Sign in with Pulsatrix" (electron/org-join.mjs join). The choice is kept
// in the workspace config's onboarding record, like the tour itself, so it
// survives cleared site data. Pure, so the rules are tested without React.
import type { LocaleKey } from "@/locales";
import type { OnboardingStatus } from "./onboarding";

export type LaunchMode = "solo" | "server";

/** The organization server the Server mode offers first. A build for
 * another organization sets SAGAX_DEFAULT_SERVER (vite.config.ts). */
export const DEFAULT_SERVER_ADDRESS = "https://bot.pulsatrix.mcp.goxcloud.ca";

const BUILD_SERVER = typeof __SAGAX_DEFAULT_SERVER__ === "string" ? __SAGAX_DEFAULT_SERVER__ : "";

export function defaultServerAddress(override: string = BUILD_SERVER): string {
  return override.trim() || DEFAULT_SERVER_ADDRESS;
}

export interface LaunchBridges {
  environments: NonNullable<NonNullable<Window["ogb"]>["environments"]>;
  orgJoin: NonNullable<NonNullable<Window["ogb"]>["orgJoin"]>;
}

/** The bridges Server mode needs, on the desktop app's own window only. A
 * browser has none; a server page the desktop opened has no remoteClient
 * and may not add servers; a desktop acting as a remote client has neither
 * a first run nor a local workspace to choose for. */
export function launchBridges(ogb: { environments?: unknown; orgJoin?: unknown; remoteClient?: { active?: boolean } } | undefined): LaunchBridges | null {
  if (!ogb || ogb.remoteClient === undefined || ogb.remoteClient.active === true) return null;
  if (!ogb.environments || !ogb.orgJoin) return null;
  return { environments: ogb.environments, orgJoin: ogb.orgJoin } as LaunchBridges;
}

/** Whether the launch screen opens by itself. It waits for the config; it
 * shows on a first run (the tour is due and nothing was chosen yet), never
 * again after "No server", and after "Server" only once no server is saved
 * any more (it was forgotten, which signs this app out of it). */
export function launchDue(
  config: { onboarding?: Partial<OnboardingStatus> } | null | undefined,
  options: { welcomeDue: boolean; savedServers: number | null },
): boolean {
  if (!config) return false;
  const mode = config.onboarding?.launchMode;
  if (mode === "solo") return false;
  if (mode === "server") return options.savedServers === 0;
  return options.welcomeDue;
}

/** The config patch that remembers the choice (PUT /api/config). */
export function launchModePatch(mode: LaunchMode): { onboarding: { launchMode: LaunchMode } } {
  return { onboarding: { launchMode: mode } };
}

/** Product copy for a failed Server mode. The desktop's own messages are
 * matched, never shown: IPC errors can carry internal detail. */
export function launchErrorKey(error: unknown): LocaleKey {
  const message = error instanceof Error ? error.message : "";
  if (/could not be reached/.test(message)) return "launch.error.unreachable";
  if (/does not sign people in with Pulsatrix/.test(message)) return "launch.error.notPerspicax";
  if (/Enter an https/.test(message)) return "launch.error.address";
  return "launch.error.failed";
}
