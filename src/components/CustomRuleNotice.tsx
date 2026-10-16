// The rule notice: which of the person's custom rules approved, refused or
// held an action (shared/custom-rules.ts), in their own words, with a way
// to edit it. Shown on the approval box, on a settled card's receipt and
// under a step a rule answered with no card.
import { ShieldCheck, ShieldX, ShieldAlert } from "lucide-react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useStore } from "@/state/store";
import type { CustomRuleNotice as Notice, RiskClass } from "../../shared/custom-rules";

export const RISK_LABEL: Record<RiskClass, LocaleKey> = {
  destructive: "customRules.risk.destructive",
  irreversible: "customRules.risk.irreversible",
  money: "customRules.risk.money",
  "external-send": "customRules.risk.externalSend",
};

export function riskList(risks: readonly RiskClass[]): string {
  return risks.map((risk) => t(RISK_LABEL[risk])).join(", ");
}

/** The one line a notice reads as. */
export function customRuleNoticeLine(notice: Notice): string {
  if (notice.outcome === "approved") return t("customRules.notice.approved");
  if (notice.outcome === "denied") return t("customRules.notice.denied");
  if (notice.outcome === "held") return t("customRules.notice.held");
  return t("customRules.notice.risk", { kinds: riskList(notice.missing ?? []) });
}

export function EditCustomRuleLink({ botId }: { botId?: string | null }) {
  const { dispatch } = useStore();
  return (
    <button
      type="button"
      data-custom-rule-edit
      className="text-accent hover:underline"
      onClick={() => dispatch({ type: "toggleSettings", open: true, section: "permissions", ...(botId ? { botId } : {}) })}
    >
      {t("customRules.notice.edit")}
    </button>
  );
}

export function CustomRuleNoticeLine({ notice, botId, compact = false }: { notice: Notice; botId?: string | null; compact?: boolean }) {
  const Icon = notice.outcome === "approved" ? ShieldCheck : notice.outcome === "denied" ? ShieldX : ShieldAlert;
  const tone = notice.outcome === "approved" ? "text-success" : notice.outcome === "denied" ? "text-danger" : "text-warning";
  return (
    <div
      data-custom-rule-notice={notice.outcome}
      className={compact ? "flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11.5px] text-ink-secondary" : "mt-2 flex min-w-0 flex-wrap items-center gap-x-1.5 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink-secondary"}
    >
      <Icon size={compact ? 12 : 14} aria-hidden="true" className={`shrink-0 ${tone}`} />
      <span className="font-medium text-ink">{customRuleNoticeLine(notice)}</span>
      <span className="min-w-0 break-words">« {notice.when} »</span>
      <EditCustomRuleLink botId={notice.botId ?? botId} />
    </div>
  );
}

/** "Added to your Allow rules", under a card answered with Always allow this. */
export function CustomRuleSavedInset({ rule, botId }: { rule: { id: string; when: string }; botId?: string | null }) {
  return (
    <div data-custom-rule-saved={rule.id} className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink-secondary">
      <div className="font-medium text-ink">{t("customRules.saved")}</div>
      <div className="mt-0.5 break-words">« {rule.when} »</div>
      <EditCustomRuleLink botId={botId} />
    </div>
  );
}
