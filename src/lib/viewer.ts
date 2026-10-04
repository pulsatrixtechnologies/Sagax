// Who "you" are, as the server described you in /api/config `viewer`
// (server/viewer-identity.ts). Older servers send no viewer: everything here
// then falls back to what the app did before.
import type { ConfigStatus, Message } from "@/state/store";
import type { ViewerCapabilities } from "../../shared/viewer-capabilities";

/** The id your bots and channel seats carry: your principal when the server
 * names one, else the profile email, else "local-owner" (older servers). */
export function viewerActorId(config: ConfigStatus | null | undefined): string {
  const principal = config?.viewer?.principalId?.trim();
  if (principal) return principal.toLowerCase();
  return config?.profile?.email?.trim().toLowerCase() || "local-owner";
}

/** Whether to offer "New bot": the server's word when it gives one. */
export function viewerCanCreateBots(config: ConfigStatus | null | undefined): boolean {
  return config?.viewer?.canCreateBots ?? true;
}

/** Organization server: a Perspicax admin lets this person use the bots
 * shared with them only (Perspicax `sagax_bots: use`). */
export function viewerBotsReadOnly(config: ConfigStatus | null | undefined): boolean {
  return config?.viewer?.botsReadOnly === true;
}

/** Organization server: a Perspicax admin manages this person's plugins,
 * skills and MCP servers (Perspicax `sagax_integrations: off`): they stay
 * usable, read-only, with a short notice. */
export function viewerIntegrationsManagedByAdmin(config: ConfigStatus | null | undefined): boolean {
  return config?.viewer?.integrationsManagedByAdmin === true;
}

/** Organization server: a member (not an admin, not the operator) reads
 * the server's engines without its own account or install details. */
export function viewerIsOrgMember(config: ConfigStatus | null | undefined): boolean {
  return config?.viewer?.role === "member";
}

/** A capability the server sent, or the safe fallback: a named member may
 * not change the installation, and everyone else (no viewer, an older
 * server, an owner or an admin) keeps the screen they had. */
function viewerCapability(config: ConfigStatus | null | undefined, key: keyof ViewerCapabilities): boolean {
  const caps = config?.viewer?.capabilities;
  if (caps) return caps[key];
  return config?.viewer?.role !== "member";
}

/** PUT/PATCH /api/config and the other installation writes. */
export function canEditConfig(config: ConfigStatus | null | undefined): boolean {
  return viewerCapability(config, "editConfig");
}

export function canManageKeys(config: ConfigStatus | null | undefined): boolean {
  return viewerCapability(config, "manageKeys");
}

/** The installation's Local VM, Boat and VPS inventories. A member's own
 * server environment is a different route and stays visible. */
export function canManageComputers(config: ConfigStatus | null | undefined): boolean {
  return viewerCapability(config, "manageComputers");
}

export function canViewUsage(config: ConfigStatus | null | undefined): boolean {
  return viewerCapability(config, "viewUsage");
}

export function canManageBackups(config: ConfigStatus | null | undefined): boolean {
  return viewerCapability(config, "manageBackups");
}

/** The name to show above a person's line, or null when the line is your
 * own. A line with a sender is theirs; a line without one was sent by the
 * operator at the server's computer. */
export function otherAuthorName(
  message: Pick<Message, "role" | "sender">,
  config: ConfigStatus | null | undefined,
): string | null {
  if (message.role !== "user") return null;
  const viewer = config?.viewer;
  if (!viewer) return null;
  const sender = message.sender;
  if (sender) {
    const id = sender.id?.trim().toLowerCase();
    if (id && viewer.principalId && id === viewer.principalId.toLowerCase()) return null;
    if (!id && viewer.email && sender.name.trim().toLowerCase() === viewer.email.toLowerCase()) return null;
    return sender.name.trim() || null;
  }
  return viewer.operator ? null : viewer.operatorName?.trim() || null;
}
