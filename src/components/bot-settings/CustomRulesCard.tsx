// Custom rules (2026-10-16): the person's own approval rules in plain words,
// like Grok Bot's "Règles personnalisées": "Quand <bot> veut :" a short
// phrase, "Il devrait :" Autoriser automatiquement, Demander d'abord or
// Refuser. Refuser wins over Demander d'abord, which wins over Autoriser.
// An allow covers a risky action (a deletion, something irreversible, money,
// an external send) only when the person ticks that kind here.
//
// The server keeps the rules to the person (GET/POST/PATCH/DELETE
// /api/custom-rules, server/routes/custom-rules.ts). The text is compiled on
// both sides by shared/custom-rules.ts: the editor warns when the words name
// nothing the reviewer can test, since such a rule allows nothing.
import { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { api, ApiError, type Bot } from "@/state/store";
import { compileRule, RISK_CLASSES, type CustomRule, type CustomRuleBehavior, type RiskClass } from "../../../shared/custom-rules";
import { RISK_LABEL, riskList } from "../CustomRuleNotice";
import { PaneEmpty, PaneSection } from "./PaneSection";

export type CustomRuleRow = CustomRule & { compiled?: { recognized: boolean } };

export const CUSTOM_BEHAVIOR_LABEL: Record<CustomRuleBehavior, LocaleKey> = {
  allow: "customRules.behavior.allow",
  ask: "customRules.behavior.ask",
  deny: "customRules.behavior.deny",
};

export interface CustomRuleDraft {
  when: string;
  behavior: CustomRuleBehavior;
  allBots: boolean;
  riskScope: RiskClass[];
}

/** The rules one bot meets: its own first, then those for all bots. */
export function customRulesForBot(rules: readonly CustomRuleRow[], botId: string): CustomRuleRow[] {
  return rules
    .filter((rule) => rule.botId === botId || rule.botId === null)
    .sort((a, b) => Number(a.botId === null) - Number(b.botId === null) || a.createdAt - b.createdAt);
}

export function customRuleError(failure: unknown): string {
  if (failure instanceof ApiError && failure.body?.code === "rule_not_covering") return t("customRules.notCovering");
  if (failure instanceof ApiError && failure.body?.code === "shell_family_allow") return t("customRules.shellFamily");
  if (failure instanceof ApiError && failure.body?.code === "exact_command_from_card") return t("customRules.exactFromCard");
  if (failure instanceof ApiError && failure.body?.code === "exact_command_no_cwd") return t("customRules.exactNoCwd");
  if (failure instanceof ApiError && failure.body?.code === "exact_command_one_bot") return t("customRules.exactOneBot");
  return t("customRules.error", { error: failure instanceof Error ? failure.message : String(failure) });
}

/** The editor of one rule. `risks` are the kinds the person must tick for
 * the rule to cover a given card (from "Toujours permettre ceci"). */
export function CustomRuleForm({ botName, initial, risks, saveLabel, onCancel, onSave, busy = false, fromCard = false }: {
  botName: string;
  initial: CustomRuleDraft;
  risks?: readonly RiskClass[];
  saveLabel?: string;
  onCancel: () => void;
  onSave: (draft: CustomRuleDraft) => void;
  busy?: boolean;
  /** Made from an approval card ("Toujours permettre ceci"): an exact
   * command may be allowed, bound to that card. */
  fromCard?: boolean;
}) {
  const [when, setWhen] = useState(initial.when);
  const [behavior, setBehavior] = useState<CustomRuleBehavior>(initial.behavior);
  const [allBots, setAllBots] = useState(initial.allBots);
  const [riskScope, setRiskScope] = useState<RiskClass[]>(initial.riskScope);
  const compiled = when.trim() ? compileRule(when) : null;
  const recognized = compiled ? compiled.recognized : true;
  const shellFamily = behavior === "allow" && compiled?.shellFamily === true;
  const exactOutsideCard = behavior === "allow" && !fromCard && (compiled?.commands.length ?? 0) > 0;
  const blocked = shellFamily || exactOutsideCard;
  const shownRisks = risks?.length ? RISK_CLASSES.filter((risk) => risks.includes(risk) || riskScope.includes(risk)) : RISK_CLASSES;
  return (
    <form
      className="flex flex-col gap-2 rounded-lg bg-inset px-3 py-2.5"
      data-custom-rule-form
      onSubmit={(event) => {
        event.preventDefault();
        if (!when.trim() || busy || blocked) return;
        onSave({ when: when.trim(), behavior, allBots, riskScope: behavior === "allow" ? riskScope : [] });
      }}
    >
      <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
        {t("customRules.form.when", { name: botName })}
        <textarea
          value={when}
          maxLength={500}
          rows={2}
          autoFocus
          placeholder={t("customRules.form.placeholder")}
          onChange={(event) => setWhen(event.target.value)}
          className="rounded-md bg-raised px-2 py-1.5 text-[13px] text-ink outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      {!recognized && <p role="note" className="text-[12px] text-warning" data-custom-rule-unrecognized>{t("customRules.unrecognized")}</p>}
      {shellFamily && <p role="alert" className="text-[12px] text-danger" data-custom-rule-shell-family>{t("customRules.shellFamily")}</p>}
      {exactOutsideCard && <p role="alert" className="text-[12px] text-danger" data-custom-rule-exact-card>{t("customRules.exactFromCard")}</p>}
      <label className="flex items-center justify-between gap-3 text-[12.5px] text-ink-secondary">
        {t("customRules.form.should")}
        <select
          value={behavior}
          onChange={(event) => setBehavior(event.target.value as CustomRuleBehavior)}
          className="rounded-md bg-raised px-2 py-1 text-[13px] text-ink"
        >
          {(["allow", "ask", "deny"] as const).map((value) => <option key={value} value={value}>{t(CUSTOM_BEHAVIOR_LABEL[value])}</option>)}
        </select>
      </label>
      <label className="flex items-center justify-between gap-3 text-[12.5px] text-ink-secondary">
        {t("customRules.form.appliesTo")}
        <select
          value={allBots ? "all" : "this"}
          onChange={(event) => setAllBots(event.target.value === "all")}
          className="rounded-md bg-raised px-2 py-1 text-[13px] text-ink"
        >
          <option value="this">{t("customRules.form.thisBot")}</option>
          <option value="all">{t("customRules.form.allBots")}</option>
        </select>
      </label>
      {behavior === "allow" && (
        <fieldset className="flex flex-col gap-1 text-[12.5px] text-ink-secondary" data-custom-rule-risks>
          <legend className="mb-0.5">{t("customRules.form.riskTitle")}</legend>
          {shownRisks.map((risk) => (
            <label key={risk} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={riskScope.includes(risk)}
                onChange={(event) => setRiskScope((current) => event.target.checked ? [...current, risk] : current.filter((value) => value !== risk))}
              />
              <span className={cn(riskScope.includes(risk) && "text-warning")}>{t(RISK_LABEL[risk])}</span>
            </label>
          ))}
          <p className="text-[11.5px] text-ink-tertiary">{t("customRules.form.riskHint")}</p>
        </fieldset>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-full px-3 py-1 text-[13px] text-ink-secondary hover:bg-control">
          {t("customRules.form.cancel")}
        </button>
        <button
          type="submit"
          disabled={!when.trim() || busy || blocked}
          className="rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-40"
        >
          {saveLabel ?? t("customRules.form.save")}
        </button>
      </div>
    </form>
  );
}

export function CustomRulesCard({ bot }: { bot: Pick<Bot, "id" | "name"> }) {
  const [rules, setRules] = useState<CustomRuleRow[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api<{ rules: CustomRuleRow[] }>(`/api/custom-rules?botId=${encodeURIComponent(bot.id)}`)
    .then((body) => setRules(customRulesForBot(body.rules ?? [], bot.id)))
    .catch(() => setRules(null)), [bot.id]);

  useEffect(() => {
    setEditing(null);
    void load();
  }, [load]);

  const fail = (failure: unknown) => setError(customRuleError(failure));

  const create = (draft: CustomRuleDraft) => {
    setError(null);
    void api(`/api/custom-rules`, {
      method: "POST",
      body: JSON.stringify({ when: draft.when, behavior: draft.behavior, botId: draft.allBots ? null : bot.id, riskScope: draft.riskScope }),
    }).then(() => {
      setEditing(null);
      return load();
    }).catch(fail);
  };

  const update = (rule: CustomRuleRow, patch: Record<string, unknown>) => {
    setError(null);
    void api(`/api/custom-rules/${rule.id}`, { method: "PATCH", body: JSON.stringify(patch) })
      .then(() => {
        setEditing(null);
        return load();
      })
      .catch(fail);
  };

  const remove = (rule: CustomRuleRow) => {
    setError(null);
    void api(`/api/custom-rules/${rule.id}`, { method: "DELETE" }).then(() => load()).catch(fail);
  };

  // the server answers only a signed-in person: nothing to show otherwise
  if (rules === null) return null;

  return (
    <PaneSection title={t("customRules.title")} help={t("customRules.help")} data-custom-rules={String(rules.length)}>
      {rules.length === 0 && editing !== "new" && <PaneEmpty>{t("customRules.empty")}</PaneEmpty>}
      {rules.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-hairline/40">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-hairline/40 bg-inset px-3 py-1.5 text-[12px] font-medium text-ink-secondary">
            <span>{t("customRules.form.when", { name: bot.name })}</span>
            <span>{t("customRules.form.should")}</span>
            <span className="sr-only">{t("customRules.edit")}</span>
          </div>
          <div className="divide-y divide-hairline/40">
            {rules.map((rule) => (
              <div key={rule.id} className="px-3 py-2" data-custom-rule-row={rule.behavior}>
                {editing === rule.id ? (
                  <CustomRuleForm
                    botName={bot.name}
                    initial={{ when: rule.when, behavior: rule.behavior, allBots: rule.botId === null, riskScope: rule.riskScope }}
                    onCancel={() => setEditing(null)}
                    onSave={(draft) => update(rule, { when: draft.when, behavior: draft.behavior, botId: draft.allBots ? null : bot.id, riskScope: draft.riskScope })}
                  />
                ) : (
                  <div className={cn("grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3", !rule.enabled && "opacity-60")}>
                    <div className="min-w-0">
                      <span className="break-words text-[13px] text-ink">{rule.when}</span>
                      <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11.5px] text-ink-tertiary">
                        {rule.botId === null && <span>{t("customRules.form.allBots")}</span>}
                        {rule.riskScope.length > 0 && <span className="text-warning">{t("customRules.mayCover", { kinds: riskList(rule.riskScope) })}</span>}
                        {rule.compiled && !rule.compiled.recognized && <span className="text-warning">{t("customRules.unrecognizedShort")}</span>}
                      </div>
                    </div>
                    <span className={cn("whitespace-nowrap text-[12.5px]", rule.behavior === "deny" ? "text-danger" : rule.behavior === "allow" ? "text-success" : "text-ink-secondary")}>
                      {t(CUSTOM_BEHAVIOR_LABEL[rule.behavior])}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <label className="flex items-center gap-1 px-1 text-[11.5px] text-ink-secondary" title={t("customRules.toggle")}>
                        <input
                          type="checkbox"
                          aria-label={t("customRules.toggle")}
                          checked={rule.enabled}
                          onChange={(event) => update(rule, { enabled: event.target.checked })}
                        />
                      </label>
                      <button
                        type="button"
                        aria-label={t("customRules.edit")}
                        title={t("customRules.edit")}
                        onClick={() => setEditing(rule.id)}
                        className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={t("customRules.remove")}
                        title={t("customRules.remove")}
                        onClick={() => remove(rule)}
                        className="rounded-md p-1 text-ink-secondary hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {editing === "new" ? (
        <div className="mt-2">
          <CustomRuleForm
            botName={bot.name}
            initial={{ when: "", behavior: "allow", allBots: false, riskScope: [] }}
            onCancel={() => setEditing(null)}
            onSave={create}
          />
        </div>
      ) : (
        <button type="button" onClick={() => setEditing("new")} className="mt-2 rounded-full border border-hairline/50 px-3 py-1 text-[13px] text-ink hover:bg-control" data-custom-rule-add>
          {t("customRules.add")}
        </button>
      )}
      {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
    </PaneSection>
  );
}
