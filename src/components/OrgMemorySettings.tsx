// Settings > Memory (desktop): the organization memory of Perspicax cached
// on this computer, for Obsidian (Perspicax lot A.4). Since 2026-10-14 it
// sets itself up from the organization server the person is signed in to
// (electron/org-memory-cache.mjs auto()): no address, no token to type. The
// page is a status line (synced with the organization, last sync, or why it
// failed with a Try again), the review items, and Open in Obsidian. The
// vault lives under Application Support, out of iCloud Drive, OneDrive and
// Time Machine, and is erased when the person leaves the organization.
import { useState } from "react";
import { t } from "@/lib/i18n";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import {
  orderedItems,
  orgMemoryStatus,
  runOrgMemoryAuto,
  tiersNeedingAttention,
  useOrgMemoryState,
  type OrgMemoryAutoError,
  type OrgMemoryBridge,
  type OrgMemoryItem,
  type OrgMemoryState,
  type OrgMemoryTier,
} from "@/lib/org-memory";
import type { LocaleKey } from "@/locales";
import { SettingRow } from "./SettingsPrimitives";

const STATUS_KEY: Record<OrgMemoryTier["status"], LocaleKey> = {
  cloned: "settings.memory.status.cloned",
  pushed: "settings.memory.status.pushed",
  "up-to-date": "settings.memory.status.up-to-date",
  refused: "settings.memory.status.refused",
  conflict: "settings.memory.status.conflict",
  error: "settings.memory.status.error",
};
const STATE_KEY: Record<OrgMemoryItem["state"], LocaleKey> = {
  pending: "settings.memory.state.pending",
  approved: "settings.memory.state.approved",
  refused: "settings.memory.state.refused",
  returned: "settings.memory.state.returned",
  expired: "settings.memory.state.expired",
};
const ERROR_KEY: Record<OrgMemoryAutoError, LocaleKey> = {
  unreachable: "settings.memory.error.unreachable",
  unsupported: "settings.memory.error.unsupported",
  memory_off: "settings.memory.error.memoryOff",
  not_member: "settings.memory.error.notMember",
  signed_out: "settings.memory.error.signedOut",
  no_org: "settings.memory.error.noOrg",
  cloud_folder: "settings.memory.error.cloudFolder",
};

export function OrgMemorySettings() {
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.orgMemory;
  const org = usePerspicaxOrg();
  if (!bridge) {
    return <p className="text-[13px] leading-relaxed text-ink-secondary">{t("settings.memory.desktopOnly")}</p>;
  }
  return <OrgMemoryPanel bridge={bridge} orgName={org?.org.name ?? null} />;
}

export function OrgMemoryPanel({ bridge, orgName, initial = null }: { bridge: OrgMemoryBridge; orgName: string | null; initial?: OrgMemoryState | null }) {
  const { state, running } = useOrgMemoryState(bridge, initial);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const status = orgMemoryStatus(state, running);
  const attention = tiersNeedingAttention(state);
  const items = orderedItems(state?.pending ?? []);
  const errorKey = state?.autoError ? ERROR_KEY[state.autoError] ?? ERROR_KEY.unreachable : null;

  const title = state?.connected
    ? t("settings.memory.syncedWith", { org: orgName || "Perspicax" })
    : status === "failed" ? t("settings.memory.notSynced") : t("settings.memory.settingUp");
  const subtitle = status === "syncing" || status === "setting-up"
    ? t("settings.memory.syncing")
    : status === "failed" && errorKey
      ? <span role="alert" className="text-warning">{t(errorKey)}</span>
      : state?.lastSyncAt ? t("settings.memory.lastSync", { when: new Date(state.lastSyncAt).toLocaleString() }) : t("settings.memory.neverSynced");

  const openInObsidian = async () => {
    setOpening(true);
    setOpenFailed(false);
    try {
      await bridge.openInObsidian();
    } catch {
      setOpenFailed(true);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-ink-secondary">{t("settings.memory.intro")}</p>
      {state?.cloudFolder && <p role="alert" className="text-[13px] text-danger">{t("settings.memory.cloudFolder", { place: state.cloudFolder })}</p>}
      {state?.lastError && !state.autoError && <p role="alert" className="text-[13px] text-warning">{state.lastError}</p>}

      <div className="rounded-[14px] border-[0.5px] border-border py-1">
        <SettingRow title={title} subtitle={subtitle}>
          <div className="flex flex-wrap gap-2">
            {status === "failed" && (
              <button type="button" className="ui-button" disabled={running} onClick={() => void runOrgMemoryAuto(bridge)}>
                {t("settings.memory.retry")}
              </button>
            )}
            {state?.cloned && (
              <button type="button" className="ui-button" disabled={opening} onClick={() => void openInObsidian()}>
                {t("settings.memory.openInObsidian")}
              </button>
            )}
          </div>
        </SettingRow>
        {(state?.pendingCount ?? 0) > 0 && (
          <SettingRow title={t("settings.memory.pending")} subtitle={t("settings.memory.pendingHint")}>
            <span className="text-[13px] tabular-nums">{t("settings.memory.pendingCount", { count: String(state?.pendingCount ?? 0) })}</span>
          </SettingRow>
        )}
      </div>
      {openFailed && <p role="alert" className="text-[13px] text-danger">{t("settings.memory.openFailed")}</p>}

      {attention.length > 0 && (
        <ul className="space-y-1 text-[13px]" aria-label={t("settings.memory.attention")}>
          {attention.map((tier) => (
            <li key={tier.name}>
              <span className="font-medium">{tier.label}</span>{": "}
              <span className="text-warning">{t(STATUS_KEY[tier.status] ?? STATUS_KEY.error)}</span>
              {tier.messages.length > 0 && (
                <ul className="ml-4 list-disc text-[12px] text-ink-secondary">
                  {tier.messages.slice(0, 8).map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <ul className="space-y-1 text-[13px]" aria-label={t("settings.memory.pending")}>
          {items.map((item, i) => (
            <li key={item.id ?? i}>
              <span className={item.state === "refused" ? "text-danger" : item.state === "pending" ? "text-warning" : "text-ink-secondary"}>{t(STATE_KEY[item.state] ?? STATE_KEY.pending)}</span>{" "}
              {item.title} <span className="text-ink-secondary">({item.tier}{item.edit_of ? `, ${t("settings.memory.edit")}` : ""})</span>
              {item.reason && <span className="text-ink-secondary">: {item.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
