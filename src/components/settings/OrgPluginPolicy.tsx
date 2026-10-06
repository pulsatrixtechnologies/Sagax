// Settings > Organization > Plugins et GitHub (organization admin only):
// "Marketplaces autorisés", the organization's labeled GitHub access tokens
// (server/org-github-tokens.ts) and the GitHub OAuth App, whose device flow
// lets each person "Connecter GitHub" (server/github-connect.ts). The client
// id stays a public app setting. The tokens are access tokens.
import { useState } from "react";

import { t } from "@/lib/i18n";
import { loadPerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { MAX_ORG_GITHUB_TOKENS, ORG_GITHUB_TOKEN_HINT_SAVED, type OrgGithubTokenPublic } from "../../../shared/org-github-tokens";
import { Card } from "../SettingsPrimitives";

type Policy = { mode: "any" } | { mode: "list"; allow: string[] };

const fieldClass = "w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[12.5px] text-ink focus:border-border-strong focus:outline-none";

function hintText(hint: string): string {
  return hint === ORG_GITHUB_TOKEN_HINT_SAVED ? t("organization.githubTokens.savedHint") : hint;
}

export function OrgPluginPolicy({
  marketplaces,
  github,
  tokens = [],
  tokensUnavailable = false,
  onChanged,
}: {
  marketplaces: Policy;
  github: { clientId: string | null; fromEnvironment: boolean };
  tokens?: OrgGithubTokenPublic[];
  tokensUnavailable?: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<Policy["mode"]>(marketplaces.mode);
  const [list, setList] = useState(marketplaces.mode === "list" ? marketplaces.allow.join("\n") : "");
  const [clientId, setClientId] = useState(github.fromEnvironment ? "" : github.clientId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api("/api/org/settings", { method: "PATCH", body: JSON.stringify(body) });
      await loadPerspicaxOrg(true);
      await onChanged?.();
      setSaved(true);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card cardId="organization.plugins" title={t("organization.plugins.title")} collapsible defaultOpen={false}
      summary={mode === "any" ? t("organization.plugins.anySummary") : t("organization.plugins.listSummary")}>
      <div className="flex flex-col gap-3 text-[13px]" data-org-plugin-policy={mode}>
        <div className="flex flex-col gap-1.5">
          <span className="text-ink">{t("organization.plugins.marketplaces")}</span>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="radio" name="org-marketplaces" checked={mode === "any"} onChange={() => setMode("any")} />
            {t("organization.plugins.any")}
          </label>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="radio" name="org-marketplaces" checked={mode === "list"} onChange={() => setMode("list")} />
            {t("organization.plugins.list")}
          </label>
          {mode === "list" && (
            <textarea value={list} onChange={(event) => setList(event.target.value)} rows={3} placeholder={"pulsatrixtechnologies/marketplace\ngoxtechnologies/*"}
              aria-label={t("organization.plugins.list")}
              className={`${fieldClass} font-mono`} />
          )}
          <p className="text-[12px] leading-relaxed text-ink-secondary">{t("organization.plugins.hint")}</p>
          <div>
            <button type="button" className="ui-button" disabled={busy} onClick={() => void save({
              pluginMarketplaces: mode === "any" ? { mode: "any" } : { mode: "list", allow: list.split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean) },
            })}>{t("organization.plugins.save")}</button>
          </div>
        </div>
        <GithubAccessTokens tokens={tokens} unavailable={tokensUnavailable} busy={busy} save={save} />
        <div className="flex flex-col gap-1.5">
          <span className="text-ink">{t("organization.github.title")}</span>
          <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={github.fromEnvironment && github.clientId ? github.clientId : "Ov23li..."}
            aria-label={t("organization.github.clientId")}
            className={`${fieldClass} font-mono`} />
          <p className="text-[12px] leading-relaxed text-ink-secondary">{github.fromEnvironment ? t("organization.github.fromEnvironment") : t("organization.github.hint")}</p>
          <div>
            <button type="button" className="ui-button" disabled={busy} onClick={() => void save({ githubClientId: clientId.trim() || null })}>{t("organization.plugins.save")}</button>
          </div>
        </div>
        {saved && <p role="status" className="text-[12px] text-ink-secondary">{t("organization.plugins.saved")}</p>}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    </Card>
  );
}

function GithubAccessTokens({
  tokens,
  unavailable,
  busy,
  save,
}: {
  tokens: OrgGithubTokenPublic[];
  unavailable: boolean;
  busy: boolean;
  save: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [addLabel, setAddLabel] = useState("");
  const [addSecret, setAddSecret] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [replaceSecret, setReplaceSecret] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const atLimit = tokens.length >= MAX_ORG_GITHUB_TOKENS;

  const closeEditors = () => {
    setEditingId(null);
    setReplacingId(null);
    setReplaceSecret("");
    setConfirmingId(null);
  };

  return (
    <div className="flex flex-col gap-1.5" data-github-tokens={unavailable ? "unavailable" : tokens.length === 0 ? "empty" : atLimit ? "limit" : "list"}>
      <span className="text-ink">{t("organization.githubTokens.title")}</span>
      <p className="text-[12px] leading-relaxed text-ink-secondary">{t("organization.githubTokens.hint")}</p>
      {unavailable ? (
        <p role="status" data-github-tokens-unavailable className="text-[12px] text-danger">{t("organization.githubTokens.unavailable")}</p>
      ) : tokens.length === 0 ? (
        <p className="text-[12px] text-ink-secondary" data-github-tokens-empty>{t("organization.githubTokens.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline/40">
          {tokens.map((entry) => {
            const editing = editingId === entry.id;
            const replacing = replacingId === entry.id;
            const confirming = confirmingId === entry.id;
            return (
              <li key={entry.id} data-github-token={entry.id} className="flex flex-col gap-2 py-2">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] text-ink">{entry.label}</span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-secondary" data-github-token-hint>{hintText(entry.hint)}</span>
                </div>
                {editing ? (
                  <div className="flex flex-col gap-1.5">
                    <input value={labelDraft} onChange={(event) => setLabelDraft(event.target.value)} aria-label={t("organization.githubTokens.label")}
                      maxLength={80} className={fieldClass} />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="ui-button" disabled={busy || !labelDraft.trim()} onClick={() => void (async () => {
                        const ok = await save({ githubTokens: { op: "rename", id: entry.id, label: labelDraft.trim() } });
                        if (ok) closeEditors();
                      })()}>{t("organization.githubTokens.saveLabel")}</button>
                      <button type="button" className="ui-button" disabled={busy} onClick={closeEditors}>{t("organization.githubTokens.cancel")}</button>
                    </div>
                  </div>
                ) : replacing ? (
                  <div className="flex flex-col gap-1.5" data-github-token-replace={entry.id}>
                    <input type="password" value={replaceSecret} onChange={(event) => setReplaceSecret(event.target.value)}
                      aria-label={t("organization.githubTokens.secret")} autoComplete="off" spellCheck={false}
                      className={`${fieldClass} font-mono`} />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="ui-button" disabled={busy || !replaceSecret.trim()} onClick={() => void (async () => {
                        const ok = await save({ githubTokens: { op: "replace", id: entry.id, token: replaceSecret.trim() } });
                        if (ok) closeEditors();
                      })()}>{t("organization.githubTokens.saveSecret")}</button>
                      <button type="button" className="ui-button" disabled={busy} onClick={closeEditors}>{t("organization.githubTokens.cancel")}</button>
                    </div>
                  </div>
                ) : confirming ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] text-ink-secondary">{t("organization.githubTokens.confirmRemove")}</span>
                    <button type="button" className="ui-button text-danger" disabled={busy} onClick={() => void (async () => {
                      const ok = await save({ githubTokens: { op: "remove", id: entry.id } });
                      if (ok) closeEditors();
                    })()}>{t("organization.githubTokens.remove")}</button>
                    <button type="button" className="ui-button" disabled={busy} onClick={closeEditors}>{t("organization.githubTokens.cancel")}</button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="ui-button" disabled={busy} onClick={() => {
                      closeEditors();
                      setEditingId(entry.id);
                      setLabelDraft(entry.label);
                    }}>{t("organization.githubTokens.editLabel")}</button>
                    <button type="button" className="ui-button" disabled={busy} onClick={() => {
                      closeEditors();
                      setReplacingId(entry.id);
                    }}>{t("organization.githubTokens.replace")}</button>
                    <button type="button" className="ui-button text-danger" disabled={busy} onClick={() => {
                      closeEditors();
                      setConfirmingId(entry.id);
                    }}>{t("organization.githubTokens.remove")}</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!unavailable && atLimit && (
        <p className="text-[12px] text-ink-secondary">{t("organization.githubTokens.limit", { max: MAX_ORG_GITHUB_TOKENS })}</p>
      )}
      {!unavailable && !atLimit && (
        <div className="flex flex-col gap-1.5" data-github-token-add>
          <input value={addLabel} onChange={(event) => setAddLabel(event.target.value)} aria-label={t("organization.githubTokens.label")}
            placeholder={t("organization.githubTokens.labelPlaceholder")} maxLength={80} className={fieldClass} />
          <input type="password" value={addSecret} onChange={(event) => setAddSecret(event.target.value)}
            aria-label={t("organization.githubTokens.secret")} autoComplete="off" spellCheck={false}
            className={`${fieldClass} font-mono`} />
          <div>
            <button type="button" className="ui-button" disabled={busy || !addLabel.trim() || !addSecret.trim()} onClick={() => void (async () => {
              const ok = await save({ githubTokens: { op: "add", label: addLabel.trim(), token: addSecret.trim() } });
              if (ok) {
                setAddLabel("");
                setAddSecret("");
              }
            })()}>{t("organization.githubTokens.add")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
