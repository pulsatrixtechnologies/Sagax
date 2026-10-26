// Connect apps > Manage plugins and skills (2026-10-26, JC's redesign): four
// tabs instead of one long page.
//
//   - Installed: one line per thing the person has (installedEntries folds
//     a server added by hand, the same address brought by a plugin and the
//     plugin itself into one), its real logo, a readable name, what it
//     brings, its state and a "..." menu (Update, For which bots, Remove);
//     then the private skills, only when there are some.
//   - Discover: the catalog and its search (what can still be added).
//   - My accounts: the person's own connections and the connectors of their
//     engine accounts (Claude and Grok, grouped by engine).
//   - Sources: the marketplaces, add or remove one.
//
// Every section with nothing in it is hidden. Nothing here is for an admin
// only: what is organization-wide lives in Settings > Organization.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, ClipboardPaste, MoreHorizontal, Plus, RefreshCw, RotateCw, Trash2, Users } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { InstalledBrings, InstalledEntry } from "@/lib/installed-model";
import type { PluginItem } from "@/lib/plugins-model";
import type { Crumb } from "../Breadcrumb";
import { categoryChipClass } from "../category-modal";
import { PluginIcon, PluginPageHeader, PluginStatusLabel } from "./PluginParts";

export type ManageTab = "installed" | "discover" | "accounts" | "sources";
export const MANAGE_TABS: readonly ManageTab[] = ["installed", "discover", "accounts", "sources"];

const TAB_KEY = {
  installed: "connectApps.manage.tab.installed",
  discover: "connectApps.manage.tab.discover",
  accounts: "connectApps.manage.tab.accounts",
  sources: "connectApps.manage.tab.sources",
} as const;

/** What an entry brings, in one short line: "app + 2 connectors",
 * "plugin (claude-plugins-official) · 3 skills", "1 connector". */
export function bringsLabel(brings: InstalledBrings): string {
  const counts: string[] = [];
  if (brings.connectors > 0) counts.push(brings.connectors === 1 ? t("connectApps.count.connectorOne") : t("connectApps.count.connectorMany", { count: brings.connectors }));
  if (brings.skills > 0) counts.push(brings.skills === 1 ? t("connectApps.count.skillOne") : t("connectApps.count.skillMany", { count: brings.skills }));
  const head: string[] = [];
  if (brings.plugin) head.push(t("connectApps.brings.plugin", { source: brings.plugin }));
  if (brings.app) head.push(t("connectApps.brings.app"));
  if (head.length === 0) return counts.join(" · ") || t("connectApps.count.connectorOne");
  if (!brings.plugin) return [head[0]!, ...counts].join(" + ");
  return [...head, ...counts].join(" · ");
}

/** The "..." menu of an installed entry; an action left out is not offered. */
export interface EntryActions {
  update?: () => void;
  bots?: () => void;
  remove?: () => void;
}

export interface ManageViewProps {
  tab: ManageTab;
  onTab: (tab: ManageTab) => void;
  /** tabs with nothing to show are left out (Sources when no route reads
   * the marketplaces) */
  tabs?: readonly ManageTab[];
  onBack: () => void;
  trail?: readonly Crumb[];
  /** the install scope (everyone, or one bot) above the tabs */
  scope?: ReactNode;
  notices?: ReactNode;
  entries: InstalledEntry[];
  skills: PluginItem[];
  sourceLabel: (source: string) => string;
  onOpenEntry: (entry: InstalledEntry) => void;
  onOpenSkill: (skill: PluginItem) => void;
  entryActions: (entry: InstalledEntry) => EntryActions;
  /** add an MCP server by hand, paste a config (absent: not offered) */
  onAddServer?: () => void;
  onPasteConfig?: () => void;
  addDisabled?: boolean;
  onNewSkill?: () => void;
  /** the add and paste forms, reserved-name warnings and messages */
  forms?: ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
  loading?: boolean;
  discover?: ReactNode;
  accounts?: ReactNode;
  sources?: ReactNode;
}

export function ManageView(props: ManageViewProps) {
  const { tab, onTab, tabs = MANAGE_TABS, onBack, trail, scope, notices, refreshing, onRefresh } = props;
  const shown = tabs.includes(tab) ? tab : tabs[0] ?? "installed";
  return (
    <>
      <PluginPageHeader titleId="plugins-title" title={t("connectApps.manage.title")} trail={trail} onBack={onBack} plainBack />
      <div className="flex flex-wrap items-center gap-2 px-6 pb-1 pt-1 sm:px-8" data-plugins-manage-bar>
        <div role="tablist" aria-label={t("connectApps.manage.tabsAria")} className="flex min-w-0 flex-1 flex-wrap gap-1.5" data-plugins-manage-tabs>
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`plugins-tab-${id}`}
              aria-selected={shown === id}
              aria-controls={`plugins-tabpanel-${id}`}
              data-plugins-tab={id}
              onClick={() => onTab(id)}
              className={categoryChipClass(shown === id)}
            >
              {t(TAB_KEY[id])}
            </button>
          ))}
        </div>
        <button type="button" onClick={onRefresh} disabled={refreshing} className="ui-icon-button disabled:opacity-50" aria-label={t("connectors.refreshTitle")} title={t("connectors.refreshTitle")}>
          <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
        </button>
      </div>
      {notices}
      <div
        role="tabpanel"
        id={`plugins-tabpanel-${shown}`}
        aria-labelledby={`plugins-tab-${shown}`}
        className="min-h-0 flex-1 overflow-y-auto px-6 pb-7 pt-3 sm:px-8"
        data-plugins-manage={shown}
      >
        {/* the install scope is about plugins: My accounts is the person's own */}
        {scope && shown !== "accounts" && <div className="mb-4">{scope}</div>}
        {shown === "installed" && <InstalledTab {...props} />}
        {shown === "discover" && props.discover}
        {shown === "accounts" && (props.accounts ?? <EmptyLine>{t("connectApps.manage.accountsEmpty")}</EmptyLine>)}
        {shown === "sources" && props.sources}
      </div>
    </>
  );
}

function EmptyLine({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary" data-plugins-empty>
      <span>{children}</span>
      {action}
    </div>
  );
}

function InstalledTab({ entries, skills, sourceLabel, onOpenEntry, onOpenSkill, entryActions, onAddServer, onPasteConfig, addDisabled, onNewSkill, forms, onTab, tabs = MANAGE_TABS, loading }: ManageViewProps) {
  const tools = onAddServer || onPasteConfig || onNewSkill;
  return (
    <>
      {tools && (
        <div className="mb-3 flex flex-wrap items-center gap-2" data-plugins-installed-tools>
          {onAddServer && (
            <button type="button" onClick={onAddServer} disabled={addDisabled} data-plugins-add-server className="flex items-center gap-1.5 rounded-lg bg-control px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised-hover disabled:opacity-40">
              <Plus size={14} /> {t("connectApps.manage.addServer")}
            </button>
          )}
          {onPasteConfig && (
            <button type="button" onClick={onPasteConfig} disabled={addDisabled} data-plugins-paste-config className="flex items-center gap-1.5 rounded-lg bg-control px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised-hover disabled:opacity-40">
              <ClipboardPaste size={14} /> {t("mcp.import")}
            </button>
          )}
          {onNewSkill && (
            <button type="button" onClick={onNewSkill} data-plugins-new-skill className="flex items-center gap-1.5 rounded-lg bg-control px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised-hover">
              <Plus size={14} /> {t("connectApps.skill.new")}
            </button>
          )}
        </div>
      )}
      {forms}
      {entries.length === 0 && skills.length === 0 && !loading && (
        <EmptyLine action={tabs.includes("discover") ? (
          <button type="button" onClick={() => onTab("discover")} className="text-[12.5px] font-medium text-accent-text hover:underline">{t("connectApps.manage.tab.discover")}</button>
        ) : undefined}>
          {t("connectApps.manage.nothingInstalled")}
        </EmptyLine>
      )}
      {entries.length > 0 && (
        <section data-plugins-installed>
          <ul className="divide-y divide-hairline/60 rounded-2xl border border-border bg-card">
            {entries.map((entry) => (
              <li key={entry.key}>
                <InstalledRow entry={entry} onOpen={() => onOpenEntry(entry)} actions={entryActions(entry)} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {skills.length > 0 && (
        <section className="mt-6" data-plugins-skills>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("connectApps.manage.skills")}</h3>
          <ul className="divide-y divide-hairline/60 rounded-2xl border border-border bg-card">
            {skills.map((skill) => (
              <li key={skill.key}>
                <button type="button" data-plugin-skill={skill.id} onClick={() => onOpenSkill(skill)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary"><BookOpen size={15} aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{skill.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-secondary">
                      {skill.source === "local" ? t("connectApps.skill.createdLocally") : t("connectApps.skill.from", { source: sourceLabel(skill.source) })}
                      {skill.description ? ` · ${skill.description}` : ""}
                    </span>
                  </span>
                  {skill.status === "off" && <span className="shrink-0 text-[12px] text-ink-secondary">{t("connectApps.status.off")}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** One installed entry: logo, name, what it brings, its state, "...". */
export function InstalledRow({ entry, onOpen, actions }: { entry: InstalledEntry; onOpen: () => void; actions: EntryActions }) {
  const icon = { key: entry.primary.key, kind: entry.primary.kind === "plugin" && (entry.logo || entry.domain) ? "app" as const : entry.primary.kind, name: entry.name, logo: entry.logo, domain: entry.domain };
  return (
    <div className="flex items-center gap-3 px-3 py-2" data-installed-entry={entry.key}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-hover" aria-label={t("connectApps.openAria", { name: entry.name })}>
        <PluginIcon item={icon} className="size-9" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{entry.name}</span>
          <span className="block truncate text-[11.5px] text-ink-secondary" data-installed-brings>{bringsLabel(entry.brings)}</span>
        </span>
      </button>
      <PluginStatusLabel status={entry.status} />
      <EntryMenu name={entry.name} actions={actions} updateWaiting={entry.updateAvailable} />
    </div>
  );
}

function EntryMenu({ name, actions, updateWaiting }: { name: string; actions: EntryActions; updateWaiting: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // the menu takes Escape before the panel steps back
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const items: Array<{ id: "update" | "bots" | "remove"; label: string; icon: ReactNode; run: () => void; danger?: boolean }> = [];
  if (actions.update) items.push({ id: "update", label: t("connectApps.plugin.update"), icon: <RotateCw size={14} />, run: actions.update });
  if (actions.bots) items.push({ id: "bots", label: t("connectApps.entry.bots"), icon: <Users size={14} />, run: actions.bots });
  if (actions.remove) items.push({ id: "remove", label: t("connectApps.entry.remove"), icon: <Trash2 size={14} />, run: actions.remove, danger: true });
  if (items.length === 0) return <span className="size-7 shrink-0" aria-hidden="true" />;
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        data-entry-menu
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("connectApps.entry.menuAria", { name })}
        onClick={() => setOpen((value) => !value)}
        className="ui-icon-button relative"
      >
        <MoreHorizontal size={16} />
        {updateWaiting && actions.update && <span data-entry-update-dot className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" aria-hidden="true" />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-20 min-w-44 rounded-xl border border-border bg-card p-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-entry-action={item.id}
              onClick={() => { setOpen(false); item.run(); }}
              className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[12.5px] hover:bg-hover", item.danger ? "text-danger" : "text-ink")}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
