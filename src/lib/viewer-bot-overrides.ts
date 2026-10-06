// The signed-in person's own model, effort and notifications for a shared
// bot. The server keeps them in viewer-bot-overrides.json. The bot record
// stays the owner's.
import { useEffect, useSyncExternalStore } from "react";

import type { ConfigStatus } from "@/state/store";
import { api } from "@/state/store";
import { viewerActorId } from "./viewer";
import {
  applyViewerModelOverride,
  sharedBotForViewer,
  type ViewerBotOverride,
  type ViewerBotOverridePatch,
} from "../../shared/viewer-bot-overrides";
import type { ModelSelection } from "../../shared/wire";

const PATH = "/api/me/bot-overrides";

let overrides: Record<string, ViewerBotOverride> = {};
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function viewerOverridesSnapshot(): Record<string, ViewerBotOverride> {
  return overrides;
}

export function subscribeViewerOverrides(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Member or admin on an organization server, looking at someone else's bot. */
export function viewerLocalBotSettings(
  config: ConfigStatus | null | undefined,
  bot: { ownerUserId?: string | null },
): boolean {
  const viewer = config?.viewer;
  if (!viewer || viewer.operator) return false;
  if (viewer.role !== "member" && viewer.role !== "admin") return false;
  return sharedBotForViewer(bot.ownerUserId, viewerActorId(config));
}

export function loadViewerBotOverrides(): Promise<void> {
  if (loaded) return Promise.resolve();
  loading ??= api<{ overrides?: Record<string, ViewerBotOverride> }>(PATH)
    .then((body) => {
      overrides = body.overrides ?? {};
      loaded = true;
      emit();
    })
    .catch(() => {
      loaded = true;
    });
  return loading;
}

export function useViewerBotOverride(botId: string, enabled: boolean): ViewerBotOverride | undefined {
  const all = useSyncExternalStore(subscribeViewerOverrides, viewerOverridesSnapshot, viewerOverridesSnapshot);
  useEffect(() => {
    if (enabled) void loadViewerBotOverrides();
  }, [enabled]);
  return enabled ? all[botId] : undefined;
}

/** What the settings screen shows: the viewer's choice over the bot's. */
export function botWithViewerSettings<T extends { modelSelection: ModelSelection; notifications?: boolean }>(
  bot: T,
  override: ViewerBotOverride | undefined,
): T {
  if (!override) return bot;
  const modelSelection = applyViewerModelOverride(bot.modelSelection, override, () => true);
  const notifications = override.notifications !== undefined ? override.notifications : bot.notifications;
  if (modelSelection === bot.modelSelection && notifications === bot.notifications) return bot;
  return { ...bot, modelSelection, notifications };
}

export async function saveViewerBotOverride(botId: string, patch: ViewerBotOverridePatch): Promise<boolean> {
  try {
    const body = await api<{ override: ViewerBotOverride | null }>(`${PATH}/${encodeURIComponent(botId)}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    const next = { ...overrides };
    if (body.override) next[botId] = body.override;
    else delete next[botId];
    overrides = next;
    loaded = true;
    emit();
    return true;
  } catch {
    return false;
  }
}
