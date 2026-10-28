// Connect apps > Providers (2026-10-27, named My accounts until 2026-10-28):
// what the person's own provider accounts
// bring, with one row of pills to pick a service: All, then GitHub (the one
// GitHub connection of every use, and the other credentials beside it,
// 2026-10-28), each engine with connectors (Claude, Grok, ChatGPT when its
// connectors are listed) and the person's own MCP servers. One click shows
// only that service. The published pages have their own tab (Pages).
import { useState, type ReactNode } from "react";

import { t } from "@/lib/i18n";
import { categoryChipClass } from "../category-modal";
import { HarnessConnectorGroups, type HarnessConnectorGroup, type HarnessEngine } from "./HarnessConnectorGroups";

export type AccountService = "all" | "github" | HarnessEngine | "servers";

/** The pills: All, GitHub, each engine with a group, then the person's
 * servers. Fewer than two services: no pills at all (there is nothing to
 * pick). */
export function accountServices(groups: readonly Pick<HarnessConnectorGroup, "id">[], servers: boolean, github = false): AccountService[] {
  const services: AccountService[] = [...(github ? ["github" as const] : []), ...groups.map((group) => group.id), ...(servers ? ["servers" as const] : [])];
  return services.length >= 2 ? ["all", ...services] : [];
}

function serviceLabel(service: AccountService, groups: readonly HarnessConnectorGroup[]): string {
  if (service === "all") return t("connectApps.filter.all");
  if (service === "github") return t("myConnections.github.title");
  if (service === "servers") return t("myConnections.servers.title");
  return groups.find((group) => group.id === service)?.name ?? service;
}

export interface AccountsViewProps {
  groups: HarnessConnectorGroup[];
  refreshing?: boolean;
  onRefresh?: () => void;
  /** the person's GitHub account and the other credentials beside it */
  github?: ReactNode;
  /** the person's own MCP servers (organization server) */
  servers?: ReactNode;
  /** Claude Code on this computer (a solo installation): Claude's */
  claudeCode?: ReactNode;
  /** set an engine up, from a section with no account (Settings > Models and voice) */
  onSetUp?: (engine: HarnessEngine) => void;
  /** the pill to show, when the parent opens a service (a link to GitHub) */
  service?: AccountService;
  onService?: (service: AccountService) => void;
}

export function AccountsView({ groups, refreshing, onRefresh, github, servers, claudeCode, onSetUp, service: asked, onService }: AccountsViewProps) {
  const [own, setOwn] = useState<AccountService>("all");
  const chosen = asked ?? own;
  const setChosen = onService ?? setOwn;
  const services = accountServices(groups, Boolean(servers), Boolean(github));
  const service = services.includes(chosen) ? chosen : "all";
  const shows = (id: AccountService) => service === "all" || service === id;
  const shownGroups = groups.filter((group) => shows(group.id));
  const empty = groups.length === 0 && !servers && !claudeCode && !github;
  return (
    <div data-plugins-accounts data-accounts-service={service}>
      {services.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5" role="toolbar" aria-label={t("connectApps.accounts.servicesAria")} data-accounts-services>
          {services.map((id) => (
            <button key={id} type="button" aria-pressed={service === id} data-accounts-service-pill={id} onClick={() => setChosen(id)} className={categoryChipClass(service === id)}>
              {serviceLabel(id, groups)}
            </button>
          ))}
        </div>
      )}
      {empty && (
        <div className="rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary" data-plugins-empty>{t("connectApps.manage.accountsEmpty")}</div>
      )}
      {github && shows("github") && (
        <div className="mb-6" data-plugins-github>
          {github}
        </div>
      )}
      <HarnessConnectorGroups groups={shownGroups} refreshing={refreshing} onRefresh={onRefresh} onSetUp={onSetUp} />
      {servers && shows("servers") && (
        <section className="mt-6 first:mt-0" data-plugins-personal>
          {servers}
        </section>
      )}
      {claudeCode && shows("claude") && (
        <section className="mt-6 first:mt-0" data-plugins-claude-code>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("connectApps.accounts.claudeCode")}</h3>
          {claudeCode}
        </section>
      )}
    </div>
  );
}
