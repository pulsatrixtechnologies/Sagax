// A shared bot's model, effort and notifications as one viewer keeps them.
// The bot record stays the owner's. A viewer's turn reads the override when
// they set one and the bot's own values when they did not.
import type { EffortLevel, ModelSelection } from "./wire.ts";
import { isEffortLevel } from "./wire.ts";

/** Someone else's bot: a real owner who is not this viewer. `local-owner`
 * and an empty owner are the solo operator's bot, not a share. */
export function sharedBotForViewer(ownerUserId: string | null | undefined, viewerId: string | null | undefined): boolean {
  const owner = ownerUserId?.trim().toLowerCase() ?? "";
  if (!owner || owner === "local-owner") return false;
  return owner !== (viewerId?.trim().toLowerCase() ?? "");
}

export interface ViewerModelPin {
  instanceId: string;
  model: string;
}

/** Absent means "use the bot". `null` effort or variant means this person
 * chose the provider default (send nothing). */
export interface ViewerBotOverride {
  model?: ViewerModelPin;
  effort?: EffortLevel | null;
  variant?: string | null;
  notifications?: boolean;
  updatedAt: number;
}

/** What a PUT may change. A present `null` clears that choice. An absent
 * field keeps the previous one. */
export interface ViewerBotOverridePatch {
  model?: ViewerModelPin | null;
  effort?: EffortLevel | null;
  variant?: string | null;
  notifications?: boolean | null;
}

/** The owner's model or notification switch, which they would see change. */
export function crossOwnerSettingsRefusal(input: {
  organization: boolean;
  ownerUserId: string | null | undefined;
  actorId: string | null | undefined;
  writesModel: boolean;
  writesNotifications: boolean;
}): "model" | "notifications" | null {
  if (!input.organization) return null;
  if (!input.writesModel && !input.writesNotifications) return null;
  if (!sharedBotForViewer(input.ownerUserId, input.actorId)) return null;
  if (input.writesModel) return "model";
  return "notifications";
}

/** The selection a person's turn runs. Does not write the bot. Effort the
 * target engine does not offer is dropped rather than sent. */
export function applyViewerModelOverride(
  selection: ModelSelection,
  override: ViewerBotOverride | undefined,
  effortOffered: (level: EffortLevel, instanceId: string) => boolean,
): ModelSelection {
  if (!override || (override.model === undefined && override.effort === undefined && override.variant === undefined)) return selection;
  const next: ModelSelection = { ...selection };
  if (override.model) {
    const changed = override.model.instanceId !== selection.instanceId || override.model.model !== selection.model;
    next.instanceId = override.model.instanceId;
    next.model = override.model.model;
    if (changed) delete next.variant;
  }
  if (override.effort !== undefined) {
    if (override.effort === null || !effortOffered(override.effort, next.instanceId)) delete next.effort;
    else next.effort = override.effort;
  }
  if (override.variant !== undefined) {
    if (override.variant === null) delete next.variant;
    else next.variant = override.variant;
  }
  return next;
}

/** Whether this stream should buzz for the bot. The owner follows the bot
 * switch. Another person follows their override when they set one, and the
 * bot switch when they did not. Spend notices are not this function's. */
export function viewerWantsBotNotification(input: {
  botNotifications: boolean | undefined;
  ownerId: string;
  viewerId: string | undefined;
  override: boolean | undefined;
}): boolean {
  const ownerOn = input.botNotifications !== false;
  const viewer = input.viewerId?.trim().toLowerCase() ?? "";
  const owner = input.ownerId.trim().toLowerCase();
  if (!viewer || !owner || owner === "local-owner" || viewer === owner) return ownerOn;
  if (input.override !== undefined) return input.override;
  return ownerOn;
}

export function isViewerModelPin(value: unknown): value is ViewerModelPin {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as { instanceId?: unknown; model?: unknown };
  return typeof row.instanceId === "string" && /^[\w.-]+$/.test(row.instanceId) && row.instanceId.length <= 200
    && typeof row.model === "string" && row.model.trim().length > 0 && row.model.length <= 500;
}

export function isViewerOverridePatch(value: unknown): value is ViewerBotOverridePatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (key !== "model" && key !== "effort" && key !== "variant" && key !== "notifications") return false;
  }
  if ("model" in row && row.model !== null && !isViewerModelPin(row.model)) return false;
  if ("effort" in row && row.effort !== null && !isEffortLevel(row.effort)) return false;
  if ("variant" in row && row.variant !== null && (typeof row.variant !== "string" || !row.variant.trim() || row.variant.length > 200 || /[\r\n]/.test(row.variant))) return false;
  if ("notifications" in row && row.notifications !== null && typeof row.notifications !== "boolean") return false;
  return true;
}
