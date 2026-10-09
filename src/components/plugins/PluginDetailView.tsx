// Plugins > one plugin: its accounts, its tools (each with a switch for an
// MCP server: off means no bot sees it) and where it comes from.
import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, FlaskConical, KeyRound, Loader2, LogOut, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { PluginItem } from "@/lib/plugins-model";
import { Switch } from "../SettingsPrimitives";
import { PluginCard, PluginIcon, PluginPageHeader, PluginStatusLabel } from "./PluginParts";

export interface DetailTool {
  name: string;
  description?: string;
  enabled: boolean;
}

export interface DetailAccount {
  id: string;
  label: string;
  status: "connected" | "needs_auth" | "pending" | "off";
  /** a short word under the name: the account id, the sign-in provider */
  detail?: string;
  /** a button beside the state, such as Sign in again */
  action?: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}

export interface PluginDetailProps {
  item: PluginItem;
  /** host or command line under the name */
  subtitle: string;
  onBack: () => void;
  onClose: () => void;
  busy: boolean;
  onUninstall?: () => void;
  /** a marketplace plugin the marketplace has a newer version of */
  onUpdate?: () => void;
  updating?: boolean;
  /** Edit and Test for an MCP server */
  onEdit?: () => void;
  onTest?: () => void;
  testing?: boolean;
  /** the server switch, for an MCP server or a skill */
  enabled?: { value: boolean; onToggle: () => void; label: string };
  accounts?: DetailAccount[];
  /** "+ Add another account" (connected apps), or a sign-in (MCP) */
  accountAction?: ReactNode;
  accountExtra?: ReactNode;
  tools?: {
    list: DetailTool[] | null;
    loading: boolean;
    error?: string;
    /** absent: the switches are read only (chosen per bot) */
    onToggle?: (tool: string, enabled: boolean) => void;
    note?: string;
    onLoad?: () => void;
  };
  details: Array<{ label: string; value: string; mono?: boolean }>;
  /** the editor, a skill's text, messages */
  children?: ReactNode;
}

export function PluginDetailView(props: PluginDetailProps) {
  const { item, subtitle, onBack, onClose, busy, onUninstall, onUpdate, updating, onEdit, onTest, testing, enabled, accounts, accountAction, accountExtra, tools, details, children } = props;
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolList = tools?.list ?? null;
  const enabledCount = toolList?.filter((tool) => tool.enabled).length ?? 0;
  useEffect(() => {
    if (toolsOpen && toolList === null && !tools?.loading) tools?.onLoad?.();
    // load once when opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolsOpen]);

  return (
    <>
      <PluginPageHeader titleId="plugins-title" title={item.name} backLabel={t("connectApps.back")} onBack={onBack} onClose={onClose} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-7 pt-1 sm:px-8" data-plugins-detail={item.key}>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 sm:px-5">
          <PluginIcon item={item} className="size-12" />
          <div className="min-w-0 flex-[1_1_200px]">
            <div className="truncate text-[15px] font-semibold text-ink">{item.name}</div>
            <div className="truncate font-mono text-[11.5px] text-ink-secondary" title={subtitle}>{subtitle}</div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {onUpdate && (
              <button type="button" disabled={busy} onClick={onUpdate} className="ui-button ui-button-primary flex items-center gap-1.5 text-[12px] disabled:opacity-40" data-plugin-update>
                {updating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {t("connectApps.plugin.update")}
              </button>
            )}
            {onTest && (
              <button type="button" disabled={busy} onClick={onTest} className="ui-button flex items-center gap-1.5 text-[12px] disabled:opacity-40">
                {testing ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} {t("mcp.test")}
              </button>
            )}
            {onEdit && (
              <button type="button" disabled={busy} onClick={onEdit} className="ui-button flex items-center gap-1.5 text-[12px] disabled:opacity-40" aria-label={t("mcp.editAria", { name: item.name })}>
                <Pencil size={13} /> {t("connectApps.detail.edit")}
              </button>
            )}
            {onUninstall && (
              <button type="button" disabled={busy} onClick={onUninstall} className="flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/10 disabled:opacity-40">
                <Trash2 size={13} /> {t("connectApps.detail.uninstall")}
              </button>
            )}
          </div>
        </div>

        {children}

        {accounts && (
          <PluginCard title={t("connectApps.detail.accounts")}>
            <ul className="divide-y divide-hairline/60">
              {accounts.map((account) => (
                <li key={account.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-ink">{account.label}</div>
                    {account.detail && <div className="truncate text-[11px] text-ink-secondary">{account.detail}</div>}
                  </div>
                  <PluginStatusLabel status={account.status} />
                  {account.action}
                  {account.onRemove && (
                    <button type="button" disabled={busy} onClick={account.onRemove} aria-label={account.removeLabel} title={account.removeLabel}
                      className="rounded-md p-1.5 text-ink-secondary hover:bg-danger/10 hover:text-danger disabled:opacity-40">
                      <LogOut size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {accountAction}
            {accountExtra}
          </PluginCard>
        )}

        {tools && (
          <PluginCard>
            <button
              type="button"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen((open) => !open)}
              className="flex w-full items-center gap-2 text-left"
              data-plugin-tools-toggle
            >
              <span className="flex-1 text-[13px] font-semibold text-ink">{t("connectApps.detail.tools")}</span>
              <span className="text-[12px] text-ink-secondary">
                {toolList ? t("connectApps.detail.toolsEnabled", { enabled: enabledCount, total: toolList.length }) : tools.loading ? t("connectApps.detail.toolsLoading") : t("connectApps.detail.toolsUnknown")}
              </span>
              {toolsOpen ? <ChevronDown size={15} className="text-ink-secondary" /> : <ChevronRight size={15} className="text-ink-secondary" />}
            </button>
            {toolsOpen && (
              <div className="mt-2">
                {tools.note && <p className="mb-2 text-[11.5px] leading-relaxed text-ink-secondary">{tools.note}</p>}
                {tools.error && <p role="alert" className="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{tools.error}</p>}
                {tools.loading && !toolList && (
                  <div className="flex items-center gap-2 py-2 text-[12px] text-ink-secondary"><Loader2 size={13} className="animate-spin" /> {t("connectApps.detail.toolsLoading")}</div>
                )}
                {toolList && toolList.length === 0 && <p className="py-1 text-[12px] text-ink-secondary">{t("mcp.probe.noTools")}</p>}
                {toolList && toolList.length > 0 && (
                  <ul className="divide-y divide-hairline/60" data-plugin-tools>
                    {toolList.map((tool) => (
                      <li key={tool.name} className="flex items-center gap-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[12px] text-ink">{tool.name}</div>
                          {tool.description && <div className="line-clamp-2 text-[11px] text-ink-secondary">{tool.description}</div>}
                        </div>
                        {tools.onToggle ? (
                          <Switch
                            checked={tool.enabled}
                            disabled={busy}
                            onClick={() => tools.onToggle!(tool.name, !tool.enabled)}
                            aria-label={t(tool.enabled ? "connectApps.detail.toolOffAria" : "connectApps.detail.toolOnAria", { name: tool.name })}
                          />
                        ) : (
                          <CheckCircle2 size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {!toolList && !tools.loading && tools.onLoad && (
                  <button type="button" onClick={tools.onLoad} className="ui-button text-[12px]">{t("connectApps.detail.loadTools")}</button>
                )}
              </div>
            )}
          </PluginCard>
        )}

        <PluginCard title={t("connectApps.detail.details")}>
          <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            {enabled && (
              <>
                <dt className="self-center text-ink-secondary">{t("connectApps.detail.enabled")}</dt>
                <dd className="flex justify-end">
                  <Switch checked={enabled.value} disabled={busy} onClick={enabled.onToggle} aria-label={enabled.label} />
                </dd>
              </>
            )}
            {details.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-ink-secondary">{row.label}</dt>
                <dd className={cn("min-w-0 break-all text-right text-ink", row.mono && "font-mono text-[11.5px]")}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </PluginCard>
      </div>
    </>
  );
}

/** "+ Add another account" under the accounts. */
export function AddAccountButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="mt-1 flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-[12.5px] font-medium text-ink-secondary hover:text-ink disabled:opacity-40">
      <Plus size={14} /> {label}
    </button>
  );
}

/** Sign in to an MCP server's account (OAuth), shown where its account is. */
export function SignInButton({ label, onClick, busy, disabled }: { label: string; onClick: () => void; busy: boolean; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="ui-button ui-button-primary mt-2 flex items-center gap-1.5 text-[12px] font-medium">
      {busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} {label}
    </button>
  );
}
