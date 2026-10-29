// Connect apps > Providers (2026-10-27, named My accounts until 2026-10-28):
// what the person's own provider accounts
// bring, with one row of pills to pick a service: All, then GitHub (the one
// GitHub connection of every use, and the other credentials beside it,
// 2026-10-28), each engine with connectors (Claude, Grok, ChatGPT when its
// connectors are listed) and the person's own MCP servers. One click shows
// only that service. The published pages have their own tab (Pages).
// GitHub in All is one card, the model of Claude's and Grok's sections (its
// mark, its name, the account, one button): its whole content (the
// connection and the other credentials) is one level down, on its pill
// (owner, 2026-10-28: "since it's moved, why is it still shown there").
import { useState, type ReactNode } from "react";
import { GitBranch } from "lucide-react";

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
  /** the person's GitHub account and the other credentials beside it,
   * shown when the GitHub card is opened */
  github?: ReactNode;
  /** the GitHub card's account line in All (connected as, or not) */
  githubSummary?: ReactNode;
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

export function AccountsView({ groups, refreshing, onRefresh, github, githubSummary, servers, claudeCode, onSetUp, service: asked, onService }: AccountsViewProps) {
  const [own, setOwn] = useState<AccountService>("all");
  const chosen = asked ?? own;
  const setChosen = onService ?? setOwn;
  const services = accountServices(groups, Boolean(servers), Boolean(github));
  const service = services.includes(chosen) ? chosen : "all";
  const shows = (id: AccountService) => service === "all" || service === id;
  // GitHub opened: on its pill, or when there are no pills to open it with
  const githubOpen = service === "github" || services.length === 0;
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
      {github && githubOpen && (
        <div className="mb-6" data-plugins-github>
          {github}
        </div>
      )}
      {github && !githubOpen && service === "all" && (
        <section className="mb-6" data-plugins-github-card>
          <div className="flex items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center"><GitBranch size={16} aria-hidden="true" className="text-ink" /></span>
            <h3 className="min-w-0 truncate text-[13px] font-semibold text-ink">{t("myConnections.github.title")}</h3>
            {githubSummary && <span className="min-w-0 truncate text-[11.5px] text-ink-secondary" data-github-summary>{githubSummary}</span>}
            <span className="flex-1" />
            <button
              type="button"
              data-plugins-github-open
              onClick={() => setChosen("github")}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-control px-2.5 py-1 text-[11.5px] font-medium text-ink hover:bg-raised-hover"
            >
              {t("connectApps.accounts.openService", { provider: t("myConnections.github.title") })}
            </button>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-tertiary">{t("sources.github.intro")}</p>
        </section>
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
