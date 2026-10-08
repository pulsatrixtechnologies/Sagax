// Plugins > Manage: what is installed (apps, MCP servers, marketplace
// plugins), the private skills of this installation, and the ways to add an
// MCP server by hand (a command or an address) or by pasting a config.
import { useState, type ReactNode } from "react";
import { ClipboardPaste, Plus, RefreshCw } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { installedPlugins, type PluginItem } from "@/lib/plugins-model";
import { PluginIcon, PluginPageHeader, PluginStatusLabel } from "./PluginParts";

const INSTALLED_PREVIEW = 8;

export interface ManageViewProps {
  items: PluginItem[];
  /** the subline under an installed card: "1 connector", "3 accounts" */
  countLabel: (item: PluginItem) => string;
  sourceLabel: (source: string) => string;
  onBack: () => void;
  onClose: () => void;
  onOpenItem: (item: PluginItem) => void;
  onAddManually: () => void;
  onPasteConfig: () => void;
  addDisabled?: boolean;
  addTitle?: string;
  refreshing: boolean;
  onRefresh: () => void;
  /** the MCP add / paste forms and their messages */
  forms?: ReactNode;
  /** sections after the skills (marketplaces, settings) */
  children?: ReactNode;
  /** the Providers tab: engine accounts and the connectors they bring */
  providers?: ReactNode;
}

export type ManageTab = "plugins" | "providers";

export function ManageView(props: ManageViewProps) {
  const { items, countLabel, sourceLabel, onBack, onClose, onOpenItem, onAddManually, onPasteConfig, addDisabled, addTitle, refreshing, onRefresh, forms, children, providers } = props;
  const [showAll, setShowAll] = useState(false);
  const [tab, setTab] = useState<ManageTab>("plugins");
  const installed = installedPlugins(items);
  const shown = showAll ? installed : installed.slice(0, INSTALLED_PREVIEW);
  const skills = items.filter((item) => item.kind === "skill").sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PluginPageHeader titleId="plugins-title" title={t("connectApps.manage.title")} backLabel={t("connectApps.backToMain")} onBack={onBack} onClose={onClose} />
      {providers && (
        <div className="px-6 sm:px-8">
          <div className="flex gap-1 border-b border-hairline/60" role="tablist" aria-label={t("connectApps.manage.tabsAria")}>
            {(["plugins", "providers"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                onClick={() => setTab(item)}
                className={cn(
                  "-mb-px border-b-2 px-2.5 pb-2 text-[13px] transition-colors",
                  tab === item ? "border-accent font-medium text-ink" : "border-transparent text-ink-secondary hover:text-ink",
                )}
              >
                {t(item === "plugins" ? "connectApps.manage.tabPlugins" : "connectApps.manage.tabProviders")}
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === "providers" && providers ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-7 pt-4 sm:px-8" role="tabpanel" data-plugins-manage="providers">{providers}</div>
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-7 pt-3 sm:px-8" data-plugins-manage>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onAddManually} disabled={addDisabled} title={addTitle} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-accent-ink disabled:opacity-40">
            <Plus size={14} /> {t("connectApps.manage.addManually")}
          </button>
          <button type="button" onClick={onPasteConfig} disabled={addDisabled} title={addTitle} className="flex items-center gap-1.5 rounded-lg bg-control px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-raised-hover disabled:opacity-40">
            <ClipboardPaste size={14} /> {t("mcp.import")}
          </button>
          <button type="button" onClick={onRefresh} disabled={refreshing} className="ui-icon-button ml-auto disabled:opacity-50" aria-label={t("connectors.refreshTitle")} title={t("connectors.refreshTitle")}>
            <RefreshCw size={16} className={cn(refreshing && "animate-spin")} />
          </button>
        </div>
        {forms}

        <section className="mt-5" data-plugins-installed>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("connectApps.manage.installed")}</h3>
          {installed.length === 0 ? (
            <p className="rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary">{t("connectApps.manage.noneInstalled")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {shown.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  data-plugin-card={item.key}
                  onClick={() => onOpenItem(item)}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 text-left hover:bg-hover"
                >
                  <PluginIcon item={item} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{item.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-secondary">
                      {countLabel(item)}
                      {item.source !== "manual" && item.source !== "composio" ? ` · ${sourceLabel(item.source)}` : ""}
                    </span>
                  </span>
                  <PluginStatusLabel status={item.status} />
                </button>
              ))}
            </div>
          )}
          {installed.length > INSTALLED_PREVIEW && (
            <button type="button" onClick={() => setShowAll((value) => !value)} className="mt-2 text-[12.5px] text-ink-secondary underline-offset-2 hover:text-ink hover:underline">
              {showAll ? t("connectApps.manage.showFewer") : t("connectApps.manage.showAll", { count: installed.length })}
            </button>
          )}
        </section>

        <section className="mt-6" data-plugins-skills>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("connectApps.manage.skills")}</h3>
          {skills.length === 0 ? (
            <p className="rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary">{t("connectApps.manage.noSkills")}</p>
          ) : (
            <ul className="divide-y divide-hairline/60 rounded-2xl border border-border bg-card">
              {skills.map((skill) => (
                <li key={skill.key}>
                  <button type="button" onClick={() => onOpenItem(skill)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{skill.name}</span>
                      <span className="block truncate text-[11.5px] text-ink-secondary">
                        {skill.source === "local" ? t("connectApps.skill.createdLocally") : t("connectApps.skill.from", { source: sourceLabel(skill.source) })}
                        {skill.description ? ` · ${skill.description}` : ""}
                      </span>
                    </span>
                    {skill.status === "off" && <PluginStatusLabel status="off" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {children}
      </div>
      )}
    </>
  );
}
