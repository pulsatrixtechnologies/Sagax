// Connect apps > Manage > Advanced > Organization sources and access (an
// organization admin only, 2026-10-15; it was the "Plugins and GitHub" card
// of Settings > Organization): "Allowed marketplaces", the organization's
// labeled GitHub access tokens (server/org-github-tokens.ts) and the GitHub
// OAuth App, whose device flow lets each person "Connect GitHub"
// (server/github-connect.ts). The client id stays a public app setting. The
// tokens are access tokens: a saved one is a label and a hint, never shown
// again.
//
// Each block saves through PATCH /api/org/settings and shows its own result
// beside its button. The answer carries the organization's settings, so the
// list and the fields follow what the server kept.
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { loadPerspicaxOrg, type PerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { MAX_ORG_GITHUB_TOKENS, ORG_GITHUB_TOKEN_HINT_SAVED, type OrgGithubTokenPublic } from "../../../shared/org-github-tokens";

type Settings = PerspicaxOrg["settings"];
type Policy = NonNullable<Settings["pluginMarketplaces"]>;
type Block = "marketplaces" | "tokens" | "github";
type Status = { block: Block; kind: "saved" | "error"; text: string } | null;
type Save = (block: Block, body: Record<string, unknown>) => Promise<boolean>;

const fieldClass = "w-full rounded-lg border border-border bg-raised px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent";

function hintText(hint: string): string {
  return hint === ORG_GITHUB_TOKEN_HINT_SAVED ? t("organization.githubTokens.savedHint") : hint;
}

function policyList(policy: Policy): string {
  return policy.mode === "list" ? policy.allow.join("\n") : "";
}

/** Connect apps > Manage shows the section to an organization admin, in the
 * "Everyone" scope; a member never sees it (the server refuses them too). */
export function showOrgSourcesAccess(org: Pick<PerspicaxOrg, "viewerRole"> | null, scope: "workspace" | "bot"): boolean {
  return org?.viewerRole === "admin" && scope === "workspace";
}

/** The marketplace list an admin typed: one per line or comma separated. */
export function marketplacePolicyBody(mode: Policy["mode"], list: string): Policy {
  return mode === "any" ? { mode: "any" } : { mode: "list", allow: list.split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean) };
}

function StatusLine({ status, block }: { status: Status; block: Block }) {
  if (!status || status.block !== block) return null;
  return status.kind === "saved"
    ? <p role="status" data-org-access-saved={block} className="text-[12px] text-ink-secondary">{status.text}</p>
    : <p role="alert" data-org-access-error={block} className="text-[12px] text-danger">{status.text}</p>;
}

export function OrgSourcesAccess({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState<Settings>(initial);
  const marketplaces: Policy = settings.pluginMarketplaces ?? { mode: "any" };
  const github = settings.github ?? { clientId: null, fromEnvironment: false };
  const [mode, setMode] = useState<Policy["mode"]>(marketplaces.mode);
  const [list, setList] = useState(policyList(marketplaces));
  const [clientId, setClientId] = useState(github.fromEnvironment ? "" : github.clientId ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  // The settings as the server has them now (another admin, or another
  // window, may have changed them since the organization was first read).
  useEffect(() => {
    let alive = true;
    void loadPerspicaxOrg(true).then((org) => {
      if (!alive || !org) return;
      setSettings(org.settings);
      const policy = org.settings.pluginMarketplaces ?? { mode: "any" as const };
      setMode(policy.mode);
      setList(policyList(policy));
      const app = org.settings.github;
      setClientId(app && !app.fromEnvironment ? app.clientId ?? "" : "");
    });
    return () => { alive = false; };
  }, []);

  const save: Save = async (block, body) => {
    setBusy(true);
    setStatus(null);
    try {
      const answer = await api<{ settings?: Settings }>("/api/org/settings", { method: "PATCH", body: JSON.stringify(body) });
      if (answer?.settings) setSettings(answer.settings);
      void loadPerspicaxOrg(true);
      setStatus({ block, kind: "saved", text: t("organization.plugins.saved") });
      return true;
    } catch (failure) {
      setStatus({ block, kind: "error", text: failure instanceof Error ? failure.message : String(failure) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6" data-plugins-org-access data-org-plugin-policy={mode}>
      <h3 className="mb-1 text-[13px] font-semibold text-ink">{t("connectApps.orgAccess.title")}</h3>
      <p className="mb-3 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.orgAccess.intro")}</p>
      <div className="flex flex-col gap-5 text-[13px]">
        <div className="flex flex-col gap-1.5" data-org-access="marketplaces">
          <span className="font-medium text-ink">{t("organization.plugins.marketplaces")}</span>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="radio" name="org-marketplaces" checked={mode === "any"} onChange={() => setMode("any")} />
            {t("organization.plugins.any")}
          </label>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="radio" name="org-marketplaces" checked={mode === "list"} onChange={() => setMode("list")} />
            {t("organization.plugins.list")}
          </label>
          {mode === "list" && (
            <textarea value={list} onChange={(event) => setList(event.target.value)} rows={3} placeholder={"pulsatrixtechnologies/marketplace\nexample-org/*"}
              aria-label={t("organization.plugins.list")}
              className={`${fieldClass} font-mono`} />
          )}
          <p className="text-[12px] leading-relaxed text-ink-secondary">{t("organization.plugins.hint")}</p>
          <div>
            <button type="button" className="ui-button" disabled={busy || (mode === "list" && !list.trim())}
              onClick={() => void save("marketplaces", { pluginMarketplaces: marketplacePolicyBody(mode, list) })}>{t("organization.plugins.save")}</button>
          </div>
          <StatusLine status={status} block="marketplaces" />
        </div>
        <GithubAccessTokens tokens={settings.githubTokens ?? []} unavailable={settings.githubTokensUnavailable === true} busy={busy} save={save} status={status} />
        <div className="flex flex-col gap-1.5" data-org-access="github">
          <span className="font-medium text-ink">{t("organization.github.title")}</span>
          <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={github.fromEnvironment && github.clientId ? github.clientId : "Ov23li..."}
            aria-label={t("organization.github.clientId")}
            className={`${fieldClass} font-mono`} />
          <p className="text-[12px] leading-relaxed text-ink-secondary">{github.fromEnvironment ? t("organization.github.fromEnvironment") : t("organization.github.hint")}</p>
          <div>
            <button type="button" className="ui-button" disabled={busy} onClick={() => void save("github", { githubClientId: clientId.trim() || null })}>{t("organization.plugins.save")}</button>
          </div>
          <StatusLine status={status} block="github" />
        </div>
      </div>
    </section>
  );
}

function GithubAccessTokens({
  tokens,
  unavailable,
  busy,
  save,
  status,
}: {
  tokens: OrgGithubTokenPublic[];
  unavailable: boolean;
  busy: boolean;
  save: Save;
  status: Status;
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
  const change = (body: Record<string, unknown>) => save("tokens", { githubTokens: body });

  return (
    <div className="flex flex-col gap-1.5" data-org-access="tokens" data-github-tokens={unavailable ? "unavailable" : tokens.length === 0 ? "empty" : atLimit ? "limit" : "list"}>
      <span className="font-medium text-ink">{t("organization.githubTokens.title")}</span>
      <p className="text-[12px] leading-relaxed text-ink-secondary">{t("organization.githubTokens.hint")}</p>
      {unavailable ? (
        <p role="status" data-github-tokens-unavailable className="text-[12px] text-danger">{t("organization.githubTokens.unavailable")}</p>
      ) : tokens.length === 0 ? (
        <p className="text-[12px] text-ink-secondary" data-github-tokens-empty>{t("organization.githubTokens.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline/60 rounded-2xl border border-border bg-card px-3">
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
                        if (await change({ op: "rename", id: entry.id, label: labelDraft.trim() })) closeEditors();
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
                        const ok = await change({ op: "replace", id: entry.id, token: replaceSecret.trim() });
                        setReplaceSecret("");
                        if (ok) closeEditors();
                      })()}>{t("organization.githubTokens.saveSecret")}</button>
                      <button type="button" className="ui-button" disabled={busy} onClick={closeEditors}>{t("organization.githubTokens.cancel")}</button>
                    </div>
                  </div>
                ) : confirming ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] text-ink-secondary">{t("organization.githubTokens.confirmRemove")}</span>
                    <button type="button" className="ui-button text-danger" disabled={busy} onClick={() => void (async () => {
                      if (await change({ op: "remove", id: entry.id })) closeEditors();
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
              const ok = await change({ op: "add", label: addLabel.trim(), token: addSecret.trim() });
              // the secret field never keeps a token, saved or refused
              setAddSecret("");
              if (ok) setAddLabel("");
            })()}>{t("organization.githubTokens.add")}</button>
          </div>
        </div>
      )}
      <StatusLine status={status} block="tokens" />
    </div>
  );
}
