// Connect apps > Sources > Organization sources and access (an organization
// admin only; it moved between Connect apps and Settings, and since
// 2026-10-27 it is the admin part of Sources; Settings > Organization keeps
// one link): "Allowed marketplaces". Since 2026-10-28 (owner: one option,
// one place) the organization's GitHub access tokens are in the one
// credential list of the GitHub plugin's page (marked Organization), and the GitHub
// OAuth App's client id, a server setting, is in Settings > Organization
// (OrgGithubApp).
//
// The block saves through PATCH /api/org/settings and shows its result
// beside its button. The answer carries the organization's settings, so the
// field follows what the server kept.
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { loadPerspicaxOrg, type PerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";

type Settings = PerspicaxOrg["settings"];
type Policy = NonNullable<Settings["pluginMarketplaces"]>;
type Block = "marketplaces";
type Status = { block: Block; kind: "saved" | "error"; text: string } | null;
type Save = (block: Block, body: Record<string, unknown>) => Promise<boolean>;

const fieldClass = "w-full rounded-lg border border-border bg-raised px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent";

function policyList(policy: Policy): string {
  return policy.mode === "list" ? policy.allow.join("\n") : "";
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

export function OrgSourcesAccess({ initial, flat = false }: { initial: Settings; /** inside a Settings group that carries the title */ flat?: boolean }) {
  const [settings, setSettings] = useState<Settings>(initial);
  const marketplaces: Policy = settings.pluginMarketplaces ?? { mode: "any" };
  const [mode, setMode] = useState<Policy["mode"]>(marketplaces.mode);
  const [list, setList] = useState(policyList(marketplaces));
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
      setStatus({ block, kind: "error", text: readableError(failure) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={flat ? undefined : "mt-6"} data-plugins-org-access data-org-plugin-policy={mode}>
      {!flat && <h3 className="mb-1 text-[13px] font-semibold text-ink">{t("connectApps.orgAccess.title")}</h3>}
      <p className="mb-3 text-[12px] leading-relaxed text-ink-secondary">{t("sources.orgAccess.intro")}</p>
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
      </div>
    </section>
  );
}

