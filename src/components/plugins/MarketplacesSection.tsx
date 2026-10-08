// Plugins > Manage > Marketplaces: add a Claude Code plugin marketplace by
// GitHub repository (owner/repo, with an optional branch), by https git
// address or by the address of its marketplace.json; fetch it again or
// remove it. Each marketplace becomes a chip and a section of Connect apps.
import { useState } from "react";
import { Loader2, Plus, RefreshCw, Store, Trash2 } from "lucide-react";

import { t } from "@/lib/i18n";

export interface MarketplaceSummary {
  name: string;
  source: string;
  ref?: string;
  description?: string;
  plugins: Array<{ name: string; installed: boolean }>;
}

export function MarketplacesSection({ marketplaces, busy, error, onAdd, onRefresh, onRemove, disabled }: {
  marketplaces: MarketplaceSummary[] | null;
  /** "add", or the name being refreshed or removed */
  busy: string | null;
  error: string | null;
  onAdd: (source: string, ref: string) => Promise<boolean>;
  onRefresh: (name: string) => void;
  onRemove: (name: string) => void;
  disabled?: boolean;
}) {
  const [source, setSource] = useState("");
  const [ref, setRef] = useState("");
  return (
    <section className="mt-6" data-plugins-marketplaces>
      <h3 className="mb-1 text-[13px] font-semibold text-ink">{t("connectApps.market.title")}</h3>
      <p className="mb-2 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.market.intro")}</p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!source.trim()) return;
          void onAdd(source.trim(), ref.trim()).then((ok) => {
            if (ok) {
              setSource("");
              setRef("");
            }
          });
        }}
      >
        <input
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder={t("connectApps.market.sourcePlaceholder")}
          aria-label={t("connectApps.market.sourceAria")}
          spellCheck={false}
          className="min-w-0 flex-[1_1_260px] rounded-lg border border-border bg-raised px-3 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent"
        />
        <input
          value={ref}
          onChange={(event) => setRef(event.target.value)}
          placeholder={t("connectApps.market.refPlaceholder")}
          aria-label={t("connectApps.market.refPlaceholder")}
          spellCheck={false}
          className="w-[130px] rounded-lg border border-border bg-raised px-3 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent"
        />
        <button type="submit" disabled={disabled || busy !== null || !source.trim()} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-accent-ink disabled:opacity-40">
          {busy === "add" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {t("connectApps.market.add")}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}
      {marketplaces && marketplaces.length > 0 && (
        <ul className="mt-3 divide-y divide-hairline/60 rounded-2xl border border-border bg-card">
          {marketplaces.map((market) => {
            const installed = market.plugins.filter((plugin) => plugin.installed).length;
            return (
              <li key={market.name} data-marketplace={market.name} className="flex items-center gap-3 px-4 py-2.5">
                <Store size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{market.name}</div>
                  <div className="truncate text-[11.5px] text-ink-secondary">
                    <span className="font-mono">{market.source}{market.ref ? `#${market.ref}` : ""}</span>
                    {" · "}{t("connectApps.market.pluginCount", { count: market.plugins.length, installed })}
                  </div>
                </div>
                <button type="button" disabled={disabled || busy !== null} onClick={() => onRefresh(market.name)} className="ui-icon-button disabled:opacity-40"
                  aria-label={t("connectApps.market.refreshAria", { name: market.name })} title={t("connectApps.market.refreshAria", { name: market.name })}>
                  <RefreshCw size={14} className={busy === `refresh:${market.name}` ? "animate-spin" : undefined} />
                </button>
                <button type="button" disabled={disabled || busy !== null || installed > 0} onClick={() => onRemove(market.name)}
                  className="rounded-md p-1.5 text-ink-secondary hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                  aria-label={t("connectApps.market.removeAria", { name: market.name })}
                  title={installed > 0 ? t("connectApps.market.removeBlocked") : t("connectApps.market.removeAria", { name: market.name })}>
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
