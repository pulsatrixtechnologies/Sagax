// Bot panel > Library > Plugins: Claude Code plugins on this bot
// (server/routes/bot-plugins.ts). The owner (or a person who manages the
// bot) adds a marketplace (owner/repo or an https git address; a private
// one reads with the token saved for it, their own GitHub connection, or the
// organization's GitHub tokens) and installs its plugins. When the git host
// refuses, the card says why (404 private, 401 bad token, 403 SAML sign-on,
// rate limit) and offers a token field for that marketplace;
// everyone else who uses the bot reads the list. Hooks and the plugin's own
// MCP servers are taken out at install: they would run on the server.
// When an admin manages the person's plugins (Perspicax
// `sagax_integrations: off`), the list is read-only under a short notice.
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import {
  addMarketplace, installPlugin, loadBotPlugins, MARKETPLACE_ACCESS_CODES, removeMarketplace, removeMarketplaceToken, setMarketplaceToken,
  setPluginEnabled, uninstallPlugin, updateMarketplace,
  type BotPluginsView,
} from "@/lib/my-connections";
import { Switch } from "../SettingsPrimitives";
import { IntegrationsManagedNotice } from "../settings/MyConnectionsSettings";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function BotPluginsCard({ bot, initial }: { bot: Pick<Bot, "id">; initial?: BotPluginsView }) {
  const [view, setView] = useState<BotPluginsView | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [token, setToken] = useState("");
  /** The add was refused for access: offer a token for it. */
  const [askToken, setAskToken] = useState(false);
  /** The marketplace whose token is being set. */
  const [tokenFor, setTokenFor] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await loadBotPlugins(bot.id));
      setError(null);
    } catch (failure) {
      setError(message(failure));
    }
  }, [bot.id]);
  const preloaded = useRef(Boolean(initial));
  useEffect(() => {
    if (preloaded.current) { preloaded.current = false; return; }
    void refresh();
  }, [refresh]);

  const run = async (key: string, work: () => Promise<BotPluginsView>) => {
    setBusy(key);
    setError(null);
    try {
      setView(await work());
      return true;
    } catch (failure) {
      setError(message(failure));
      if (failure instanceof ApiError && typeof failure.body?.code === "string" && MARKETPLACE_ACCESS_CODES.has(failure.body.code)) {
        if (key === "add") setAskToken(true);
        else if (key.startsWith("up:")) setTokenFor(key.slice(3));
      }
      return false;
    } finally {
      setBusy(null);
    }
  };
  const tokenInput = (label: string, onSubmit: () => void, id: string) => (
    <form className="flex gap-2" data-marketplace-token-form={id} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder={t("plugins.tokenPlaceholder")} aria-label={label}
        className="min-w-0 flex-1 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none" />
      <button type="submit" className="ui-button ui-button-primary" disabled={busy !== null || token.trim().length < 8}>{label}</button>
    </form>
  );

  if (!view) {
    return error ? <p role="alert" className="text-[12.5px] text-danger">{error}</p> : <p className="text-[12.5px] text-ink-secondary">{t("plugins.loading")}</p>;
  }
  const change = view.canChange;
  return (
    <div className="flex flex-col gap-4 text-[13px]" data-bot-plugins>
      <p className="text-[12.5px] leading-relaxed text-ink-secondary">{t("plugins.intro")}</p>
      {!view.engine.loadsPlugins && <p className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">{t("plugins.claudeOnly")}</p>}
      {view.managedByAdmin
        ? <IntegrationsManagedNotice />
        : !change && <p className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">{t("plugins.readOnly")}</p>}

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-ink">{t("plugins.installed")}</h3>
        {view.plugins.length === 0 ? (
          <p className="text-[12px] text-ink-secondary">{t("plugins.noneInstalled")}</p>
        ) : (
          <div className="divide-y divide-hairline/40 overflow-hidden rounded-lg border border-hairline/40">
            {view.plugins.map((plugin) => (
              <div key={plugin.key} className="flex items-center gap-3 px-3 py-2.5" data-plugin={plugin.key}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12.5px] text-ink">{plugin.name}<span className="text-ink-secondary">@{plugin.marketplace}</span>{plugin.version ? <span className="text-ink-secondary"> {plugin.version}</span> : null}</div>
                  {plugin.description && <div className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-secondary">{plugin.description}</div>}
                  {plugin.removed.length > 0 && <div className="mt-0.5 text-[11.5px] text-ink-secondary">{t("plugins.removed", { parts: plugin.removed.join(", ") })}</div>}
                  {plugin.declaredMcpServers.length > 0 && <div className="mt-0.5 text-[11.5px] text-ink-secondary">{t("plugins.declaredMcp", { names: plugin.declaredMcpServers.join(", ") })}</div>}
                </div>
                {change && (
                  <>
                    <Switch checked={plugin.enabled} disabled={busy !== null} aria-label={t("plugins.enabled", { name: plugin.name })} onClick={() => void run(`toggle:${plugin.key}`, () => setPluginEnabled(bot.id, plugin.key, !plugin.enabled))} />
                    <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void run(`rm:${plugin.key}`, () => uninstallPlugin(bot.id, plugin.key))}>{t("plugins.uninstall")}</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-ink">{t("plugins.marketplaces")}</h3>
        {view.policy.mode === "list" && <p className="text-[12px] text-ink-secondary">{t("plugins.policyList", { list: view.policy.allow.join(", ") || "-" })}</p>}
        {view.marketplaces.map((market) => (
          <div key={market.name} className="overflow-hidden rounded-lg border border-hairline/40" data-marketplace={market.name}>
            <div className="flex items-center gap-2 bg-inset px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-ink">{market.name} <span className="text-ink-secondary">({market.source})</span></div>
                {market.description && <div className="truncate text-[11.5px] text-ink-secondary">{market.description}</div>}
              </div>
              {market.hasToken && <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-ink-secondary" data-marketplace-has-token="">{t("plugins.tokenSaved")}</span>}
              {change && <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void run(`up:${market.name}`, () => updateMarketplace(bot.id, market.name))}>{t("plugins.update")}</button>}
              {change && <button type="button" className="ui-button" disabled={busy !== null} data-marketplace-token-open={market.name} onClick={() => { setToken(""); setTokenFor(tokenFor === market.name ? null : market.name); }}>{t("plugins.token")}</button>}
              {change && <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void run(`rmm:${market.name}`, () => removeMarketplace(bot.id, market.name))}>{t("plugins.removeMarketplace")}</button>}
            </div>
            {change && tokenFor === market.name && (
              <div className="flex flex-col gap-1.5 border-t border-hairline/40 px-3 py-2">
                <p className="text-[11.5px] text-ink-secondary">{t("plugins.tokenHint")}</p>
                {tokenInput(market.hasToken ? t("plugins.tokenReplace") : t("plugins.tokenSave"), () => void run(`tok:${market.name}`, async () => {
                  await setMarketplaceToken(bot.id, market.name, token.trim());
                  const next = await updateMarketplace(bot.id, market.name);
                  setToken("");
                  setTokenFor(null);
                  return next;
                }), market.name)}
                {market.hasToken && <button type="button" className="self-start text-[12px] text-ink-secondary underline" disabled={busy !== null}
                  onClick={() => void run(`untok:${market.name}`, async () => { const next = await removeMarketplaceToken(bot.id, market.name); setTokenFor(null); return next; })}>{t("plugins.tokenRemove")}</button>}
              </div>
            )}
            <div className="divide-y divide-hairline/40">
              {market.plugins.length === 0 && <div className="px-3 py-2 text-[12px] text-ink-secondary">{t("plugins.marketplaceEmpty")}</div>}
              {market.plugins.map((plugin) => (
                <div key={plugin.name} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[12.5px] text-ink">{plugin.name}{plugin.version ? <span className="text-ink-secondary"> {plugin.version}</span> : null}</div>
                    {plugin.description && <div className="line-clamp-2 text-[11.5px] text-ink-secondary">{plugin.description}</div>}
                  </div>
                  {change && (
                    <button type="button" className={plugin.installed ? "ui-button" : "ui-button ui-button-primary"} disabled={busy !== null} onClick={() => void run(`in:${market.name}:${plugin.name}`, () => installPlugin(bot.id, market.name, plugin.name))}>
                      {busy === `in:${market.name}:${plugin.name}` ? t("plugins.installing") : plugin.installed ? t("plugins.reinstall") : t("plugins.install")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {change && (
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setAskToken(false); void run("add", async () => { const next = await addMarketplace(bot.id, source.trim()); setSource(""); return next; }); }}>
            <input value={source} onChange={(event) => { setSource(event.target.value); setAskToken(false); }} placeholder={t("plugins.sourcePlaceholder")} aria-label={t("plugins.addMarketplace")}
              className="min-w-0 flex-1 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none" />
            <button type="submit" className="ui-button ui-button-primary" disabled={busy !== null || !source.trim()}>{busy === "add" ? t("plugins.adding") : t("plugins.addMarketplace")}</button>
          </form>
        )}
        {change && askToken && source.trim() && (
          <div className="flex flex-col gap-1.5 rounded-lg bg-inset px-3 py-2" data-marketplace-add-token="">
            <p className="text-[12px] text-ink-secondary">{t("plugins.tokenOffer")}</p>
            {tokenInput(t("plugins.addWithToken"), () => void run("add", async () => {
              const next = await addMarketplace(bot.id, source.trim(), token.trim());
              setSource("");
              setToken("");
              setAskToken(false);
              return next;
            }), "add")}
          </div>
        )}
      </section>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
