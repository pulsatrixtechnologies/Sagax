// Manage > My accounts: the connectors of the person's engine accounts,
// grouped by engine, one row each with the app's real logo (providerMark,
// the sidebar foot's resolution since #1143), its name and its state.
// Claude's come from GET /api/me/harness-connectors (the caller's own
// claude.ai account: a name and a status); Grok's are the xAI account's
// cloud connectors, managed on grok.com. Both read the same way. A group
// with no connector is hidden.
import { ExternalLink, RefreshCw } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { providerMark } from "@/lib/plugins-model";
import { GROK_CONNECTORS_URL } from "../../../shared/grok-cloud-connectors";
import { CATEGORY_MODAL } from "../category-modal";
import { ConnectFromEngine } from "../ConnectFromEngine";
import { ClaudeMark, GrokMark } from "../ProviderIcons";
import { PluginIcon } from "./PluginParts";
import { CapabilityTags, EngineCapabilities } from "./EngineCapabilities";
import { claudeAiConnectorCapabilities, engineConnectorOffers, grokConnectorCapabilities } from "../../../shared/engine-connectors";

export type HarnessConnectorStatus = "connected" | "needs_auth" | "failed" | "unknown";

export interface HarnessConnectorGroup {
  id: "claude" | "grok";
  name: string;
  manageUrl: string;
  /** the engine account's line: an email or "Signed in" (absent: none) */
  account?: string;
  /** `id`: a Grok connector's id (its capabilities) */
  connectors: Array<{ name: string; id?: string; status?: HarnessConnectorStatus }>;
}

const STATUS_KEY: Record<HarnessConnectorStatus, LocaleKey> = {
  connected: "harnessConnectors.status.connected",
  needs_auth: "harnessConnectors.status.needsAuth",
  failed: "harnessConnectors.status.failed",
  unknown: "harnessConnectors.status.unknown",
};

/** The groups to show: an engine with at least one connector. */
export function connectorGroups(input: {
  claude?: { available: boolean; connectors: Array<{ name: string; status: HarnessConnectorStatus }>; manageUrl?: string; account?: string } | null;
  grok?: { connectors: readonly { id: string; name: string }[]; account?: string } | null;
}): HarnessConnectorGroup[] {
  const groups: HarnessConnectorGroup[] = [];
  const claude = input.claude;
  if (claude?.available) {
    const connectors = claude.connectors.filter((connector) => connector.name.trim() !== "");
    if (connectors.length) groups.push({ id: "claude", name: "Claude", manageUrl: claude.manageUrl ?? "https://claude.ai/customize/connectors", ...(claude.account ? { account: claude.account } : {}), connectors });
  }
  if (input.grok && input.grok.connectors.length) {
    groups.push({ id: "grok", name: "Grok", manageUrl: GROK_CONNECTORS_URL, ...(input.grok.account ? { account: input.grok.account } : {}), connectors: input.grok.connectors.map((connector) => ({ id: connector.id, name: connector.name })) });
  }
  return groups;
}

export function HarnessConnectorGroups({ groups, refreshing, onRefresh }: { groups: HarnessConnectorGroup[]; refreshing?: boolean; onRefresh?: () => void }) {
  if (groups.length === 0) return null;
  // what mail, calendar, Teams and SharePoint go through (parité R9 + R11)
  const offers = engineConnectorOffers({
    claude: groups.find((group) => group.id === "claude")?.connectors ?? null,
    grok: groups.some((group) => group.id === "grok"),
  });
  return (
    <>
      {groups.map((group) => (
        <section key={group.id} className="mt-6 first:mt-0" data-harness-group={group.id}>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center">{group.id === "claude" ? <ClaudeMark size={16} /> : <GrokMark size={16} />}</span>
            <h3 className="min-w-0 truncate text-[13px] font-semibold text-ink">{t("connectApps.accounts.harness", { provider: group.name })}</h3>
            {group.account && <span className="min-w-0 truncate text-[11.5px] text-ink-secondary">{group.account}</span>}
            <span className="flex-1" />
            {group.id === "claude" && onRefresh && (
              <button type="button" onClick={onRefresh} disabled={refreshing} className="ui-icon-button disabled:opacity-50" aria-label={t("harnessConnectors.refresh")} title={t("harnessConnectors.refresh")}>
                <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
              </button>
            )}
            <button
              type="button"
              data-harness-manage={group.id}
              onClick={() => void openExternalLink(group.manageUrl).catch(() => undefined)}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-control px-2.5 py-1 text-[11.5px] font-medium text-ink hover:bg-raised-hover"
            >
              <ExternalLink size={12} /> {t("connectApps.providers.manage", { provider: group.name })}
            </button>
          </div>
          <div className={CATEGORY_MODAL.grid}>
            {group.connectors.map((connector) => {
              const mark = providerMark(connector.name);
              const missing = connector.status === "needs_auth" || connector.status === "failed";
              return (
                <div key={connector.name} data-harness-connector={`${group.id}:${connector.name}`} className="flex items-center gap-3 rounded-2xl p-2.5 hover:bg-ink/5">
                  <PluginIcon item={{ kind: "app", name: connector.name, logo: mark.logo, domain: mark.site }} className="size-11" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-[13px] font-medium leading-[18px] text-ink">{connector.name}</span>
                      <CapabilityTags capabilities={group.id === "claude" ? claudeAiConnectorCapabilities(connector.name) : grokConnectorCapabilities(connector.id ?? "")} name={connector.name} />
                    </span>
                    <span
                      className={cn("block truncate text-[12px] leading-[18px]", connector.status === "connected" ? "text-success" : missing ? "text-warning" : "text-ink-secondary")}
                      data-harness-status={connector.status ?? "managed"}
                    >
                      {connector.status ? t(STATUS_KEY[connector.status] ?? STATUS_KEY.unknown) : t("connectApps.grok.description")}
                    </span>
                  </span>
                  {missing && <ConnectFromEngine missing manageUrl={group.manageUrl} />}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {offers.length > 0 && <div className="mt-6"><EngineCapabilities offers={offers} /></div>}
    </>
  );
}
