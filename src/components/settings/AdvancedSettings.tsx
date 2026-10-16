// Settings > General > Advanced (0.5.6, JC: Grok Bot's layout). Grey
// headings over cards of rows: the organization's bots (on a desktop with no
// server only: Organization is hidden there), people's tool access (when
// some exist), event log cleanup, and Diagnostics. Every value keeps its
// route and applies whether or not anyone looks.
import { useState } from "react";

import { launchBridges } from "@/lib/launch";
import { t } from "@/lib/i18n";
import { canEditConfig } from "@/lib/viewer";
import { useStore, type ConfigStatus } from "@/state/store";
import { DescribedRow, PILL, SettingsGroup } from "../SettingsPrimitives";
import { ThreadCleanupSettings } from "../ThreadCleanupSettings";
import { PeopleToolAccessSettings } from "../ToolAccessSettings";
import { OrganizationBotRows } from "./OrganizationBotRules";

/** The desktop app in "No server" mode: Settings > Organization is hidden
 * there (nothing to show until it joins one). */
export function isSoloDesktop(config: ConfigStatus | null | undefined): boolean {
  const remoteActive = window.ogb?.remoteClient?.active === true;
  return !remoteActive && Boolean(launchBridges(window.ogb)) && config?.onboarding?.launchMode !== "server";
}

/** Whether General > Advanced holds anything for this viewer: its rows are
 * an installation editor's, but for Diagnostics, which is the desktop app's. */
export function generalAdvancedShown(config: ConfigStatus | null | undefined): boolean {
  return canEditConfig(config) || Boolean(typeof window !== "undefined" && window.ogb?.exportDiagnostics);
}

export function GeneralAdvancedSettings() {
  const { state } = useStore();
  const editConfig = canEditConfig(state.config);
  return (
    <div className="flex flex-col gap-5" data-general-advanced="">
      {isSoloDesktop(state.config) && (
        <SettingsGroup title={t("organization.group.bots")} groupId="organizationBots">
          <OrganizationBotRows />
        </SettingsGroup>
      )}
      {editConfig && (
        <>
          {/* 2026-10-15: Tool access, Parallel conversations and Automatic
              recovery are each bot's own, in its editor (Permissions and
              Model pages). A person's grants stay here. */}
          <PeopleToolAccessSettings />
          <ThreadCleanupSettings />
        </>
      )}
      <SettingsGroup title={t("settings.diagnostics.title")} groupId="diagnostics">
        <DiagnosticsRow />
      </SettingsGroup>
    </div>
  );
}

/** Writes a redacted diagnostics file to a location the user picks. The
 * report holds versions, configured-or-not booleans and the server.log tail:
 * never credential values (the desktop shell does not read secret fields). */
export function DiagnosticsRow() {
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  if (!window.ogb?.exportDiagnostics) return null;

  const exportDiagnostics = async () => {
    if (!window.ogb?.exportDiagnostics || exporting) return;
    setExporting(true);
    setResult(null);
    try {
      const path = await window.ogb.exportDiagnostics();
      if (path) setResult({ kind: "success", message: t("settings.diagnostics.saved", { path }) });
    } catch (e) {
      setResult({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div data-settings-card="general.diagnostics">
      <DescribedRow
        label={t("settings.diagnostics.title")}
        rowId="diagnostics"
        description={result
          ? <span role={result.kind === "error" ? "alert" : "status"} className={result.kind === "error" ? "break-all text-danger" : "break-all text-success"}>{result.message}</span>
          : t("settings.diagnostics.short")}
      >
        <button type="button" onClick={() => void exportDiagnostics()} disabled={exporting} aria-label={t("settings.diagnostics.aria")} className={PILL}>
          {exporting ? t("settings.diagnostics.exporting") : t("settings.diagnostics.export")}
        </button>
      </DescribedRow>
    </div>
  );
}
