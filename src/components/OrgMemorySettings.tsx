// Settings > Memory (desktop): the organization memory of Perspicax cached
// on this computer, for Obsidian (Perspicax lot A.4). Since 2026-10-14 it
// sets itself up from the organization server the person is signed in to
// (electron/org-memory-cache.mjs auto()): no address, no token to type. The
// page is a status line (synced with the organization, last sync, or why it
// failed with a Try again), how many changes wait for a review (a count
// only: the items, their titles, reasons and team ids stay in Perspicax and
// the _pending folder), and Open in Obsidian. The
// vault lives under Application Support, out of iCloud Drive, OneDrive and
// Time Machine, and is erased when the person leaves the organization.
import { useState } from "react";
import { t } from "@/lib/i18n";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import {
  orgMemoryStatus,
  refusedCount,
  runOrgMemoryAuto,
  tiersNeedingAttention,
  useOrgMemoryState,
  type OrgMemoryAutoError,
  type OrgMemoryBridge,
  type OrgMemoryOpenResult,
  type OrgMemoryState,
} from "@/lib/org-memory";
import type { LocaleKey } from "@/locales";
import { SettingRow } from "./SettingsPrimitives";

/** What the page says when Obsidian did not open the vault. */
type OpenProblem = "not_installed" | "add_vault" | "failed";
const OPEN_KEY: Record<OpenProblem, LocaleKey> = {
  not_installed: "settings.memory.obsidianMissing",
  add_vault: "settings.memory.obsidianAddVault",
  failed: "settings.memory.openFailed",
};

function openProblem(result: OrgMemoryOpenResult): OpenProblem | null {
  if (result === true || result.ok) return null;
  return result.reason in OPEN_KEY ? result.reason : "failed";
}

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

export function OrgMemoryPanel({ bridge, orgName, initial = null, initialOpenProblem = null }: { bridge: OrgMemoryBridge; orgName: string | null; initial?: OrgMemoryState | null; initialOpenProblem?: OpenProblem | null }) {
  const { state, running } = useOrgMemoryState(bridge, initial);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<OpenProblem | null>(initialOpenProblem);
  const status = orgMemoryStatus(state, running);
  const attention = tiersNeedingAttention(state).length;
  const refused = refusedCount(state?.pending ?? []);
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
    setProblem(null);
    try {
      setProblem(openProblem(await bridge.openInObsidian()));
    } catch {
      setProblem("failed");
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
      {problem && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className={problem === "add_vault" ? "text-ink-secondary" : "text-danger"}>{t(OPEN_KEY[problem])}</span>
          {state?.cloned && typeof bridge.showFolder === "function" && (
            <button type="button" className="ui-button" onClick={() => void bridge.showFolder().catch(() => false)}>
              {t("settings.memory.showFolder")}
            </button>
          )}
        </div>
      )}

      {(attention > 0 || refused > 0) && (
        <p className="text-[12px] text-ink-secondary">
          {[
            attention > 0 ? t("settings.memory.attentionCount", { count: String(attention) }) : null,
            refused > 0 ? t("settings.memory.refusedCount", { count: String(refused) }) : null,
          ].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
  );
}
