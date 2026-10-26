// The wizard's six steps (shared/bot-wizard.ts WIZARD_STEPS), each over the
// real bot being made: the bot editor's own sections where one exists
// (identity and look, soul, the approval level, MCP, browser, works on), and
// the wizard's suggestions around them (role, answers, rules, routines). The
// manual form and the guided panel draw the same steps; the recap draws them
// all on one page.
import { useState, type ReactNode } from "react";
import { Check, Loader2, Sparkles, Wand2 } from "lucide-react";

import { api, useStore, type Bot } from "@/state/store";
import { BOT_ROLES, botRole } from "@/lib/bot-roles";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { canEditBotField } from "@/lib/bot-capabilities";
import {
  answerSuggestion,
  scheduleLabel,
  setSuggestedRule,
  writeSoulForMe,
  type WireWizardDraft,
  type WizardSuggestions,
} from "@/lib/bot-wizard";
import { WIZARD_ANSWER_KEYS, WIZARD_TOOLS, type WizardAnswers, type WizardPatch, type WizardStep, type WizardTool } from "../../../shared/bot-wizard";
import { IdentitySection } from "../bot-settings/IdentitySection";
import { SoulSection } from "../bot-settings/SoulSection";
import { PermissionsSection } from "../bot-settings/PermissionsSection";
import { AccessSection } from "../bot-settings/AccessSection";
import { PaneSection } from "../bot-settings/PaneSection";
import { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { WorksOnSetting } from "../computer/WorksOnSetting";
import { PILL, SwitchRow } from "../SettingsPrimitives";

export interface StepProps {
  bot: Bot;
  draft: WireWizardDraft;
  suggestions: WizardSuggestions;
  /** The wizard draft's own patch (answers, picks, role, step). */
  patch: (patch: WizardPatch) => Promise<void>;
  language: string;
  /** Recap: a shorter form of the step, under its title. */
  compact?: boolean;
}

export function stepTitle(step: WizardStep): string {
  return t(`botWizard.step.${step}` as LocaleKey);
}

export function stepIntro(step: WizardStep): string {
  return t(`botWizard.step.${step}.intro` as LocaleKey);
}

const ANSWER_ROWS: Record<keyof WizardAnswers, { rows: number }> = {
  tone: { rows: 1 }, language: { rows: 1 }, does: { rows: 3 }, never: { rows: 3 }, speech: { rows: 2 },
};

const textArea = "w-full resize-y rounded-lg border-[0.5px] border-border bg-inset px-3 py-2 text-[13px] leading-[19px] text-ink placeholder:text-ink-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

function Chip({ children, onClick, selected, ...rest }: { children: ReactNode; onClick: () => void; selected?: boolean } & Record<`data-${string}`, string | undefined>) {
  return (
    <button type="button" {...rest} onClick={onClick} aria-pressed={selected}
      className={cn("inline-flex min-h-[32px] items-center gap-1.5 rounded-full border-[0.5px] px-3 text-[12.5px] transition-colors motion-reduce:transition-none",
        selected ? "border-accent-border bg-selected text-ink" : "border-border text-ink-secondary hover:bg-hover hover:text-ink")}>
      {selected && <Check size={13} aria-hidden="true" />}
      {children}
    </button>
  );
}

// ── 1 Identity ──────────────────────────────────────────────────────────

export function IdentityStep({ bot, draft, patch }: StepProps) {
  const derived = useBotSettingsDerived(bot);
  const { dispatch } = useStore();
  const { state } = useStore();
  const [primaryError, setPrimaryError] = useState<string | null>(null);
  const chooseRole = (roleId: string) => {
    void patch({ roleId });
    const role = botRole(roleId);
    // The role fills what is still empty or still the previous role's; the
    // person's own words stay.
    if (!role) return;
    const previous = botRole(draft.roleId);
    const replaceable = (value: string | undefined, before: string | undefined) => !value?.trim() || value === before;
    derived.patch({
      ...(replaceable(bot.title, previous?.title) ? { title: role.title } : {}),
      ...(replaceable(bot.description, previous?.description) ? { description: role.description } : {}),
      ...(replaceable(bot.soul, previous?.soul) ? { soul: role.soul } : {}),
    });
  };
  const togglePrimary = () => {
    setPrimaryError(null);
    void api<{ bot: Bot }>(`/api/bots/${bot.id}/primary`, { method: bot.chiefOfStaff ? "DELETE" : "POST" })
      .then((response) => dispatch({ type: "botPatched", bot: response.bot }))
      .catch((error: unknown) => setPrimaryError(error instanceof Error ? error.message : String(error)));
  };
  const showPrimary = canEditBotField(state.config, bot, "chiefOfStaff");
  return (
    <div className="flex flex-col gap-5" data-wizard-step-body="identity">
      <PaneSection title={t("botWizard.identity.role")} help={t("botWizard.identity.roleHelp")}>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("botWizard.identity.role")}>
          {BOT_ROLES.map((role) => (
            <Chip key={role.id} data-wizard-role={role.id} selected={draft.roleId === role.id} onClick={() => chooseRole(role.id)}>
              {t(`botWizard.role.${role.id}` as LocaleKey)}
            </Chip>
          ))}
          <Chip data-wizard-role="" selected={draft.roleId === ""} onClick={() => void patch({ roleId: "" })}>{t("botWizard.role.custom")}</Chip>
        </div>
      </PaneSection>
      <IdentitySection bot={bot} patch={derived.patch} activeState={derived.activeState} mascotMotion={derived.mascotMotion} part="main" />
      <p className="-mt-3 px-1 text-[12px] text-ink-secondary">{t("botWizard.identity.descriptionHint")}</p>
      {showPrimary && (
        <div className="rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-3">
          <SwitchRow
            label={t("botWizard.identity.primary")}
            description={bot.chiefOfStaff ? t("botWizard.identity.primaryOn") : derived.currentChief ? t("botPanel.permissions.handOver", { name: derived.currentChief.name }) : t("botWizard.identity.primaryOff")}
            checked={Boolean(bot.chiefOfStaff)}
            onChange={togglePrimary}
          />
          {primaryError && <p role="alert" className="mt-2 text-[12px] text-danger">{primaryError}</p>}
        </div>
      )}
    </div>
  );
}

// ── 2 Soul ──────────────────────────────────────────────────────────────

export function SoulStep({ bot, draft, suggestions, patch, language, compact }: StepProps) {
  const derived = useBotSettingsDerived(bot);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<WizardAnswers>(draft.answers);
  // the server's answers lead when they change elsewhere (the other mode,
  // the Primary Bot); what the person is typing leads otherwise
  const [seen, setSeen] = useState(draft.answers);
  if (seen !== draft.answers) {
    setSeen(draft.answers);
    setAnswers(draft.answers);
  }
  const role = botRole(draft.roleId);
  const setAnswer = (key: keyof WizardAnswers, value: string) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    void patch({ answers: { [key]: value } });
  };
  const writeForMe = async () => {
    setWriting(true);
    setError(null);
    try {
      await patch({ answers });
      const written = await writeSoulForMe(bot.id, language);
      derived.patch({ soul: written.soul });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWriting(false);
    }
  };
  return (
    <div className="flex flex-col gap-4" data-wizard-step-body="soul">
      {!compact && WIZARD_ANSWER_KEYS.map((key) => {
        const suggestion = answerSuggestion(suggestions, key, answers[key]);
        return (
          <div key={key} className="flex flex-col gap-1.5" data-wizard-answer={key}>
            <label htmlFor={`wizard-answer-${key}`} className="px-1 text-[13px] text-ink-secondary">{t(`botWizard.soul.${key}` as LocaleKey)}</label>
            <textarea id={`wizard-answer-${key}`} rows={ANSWER_ROWS[key].rows} value={answers[key]} maxLength={1200}
              placeholder={t(`botWizard.soul.${key}.placeholder` as LocaleKey)}
              onChange={(event) => setAnswer(key, event.target.value)} className={textArea} />
            {suggestion && (
              <button type="button" data-wizard-suggest={key} onClick={() => setAnswer(key, suggestion)}
                className="self-start rounded-full px-2 py-0.5 text-left text-[12px] text-accent-text hover:underline">
                {t("botWizard.soul.useSuggestion", { text: suggestion })}
              </button>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-wizard-write-soul disabled={writing} onClick={() => void writeForMe()} className={cn(PILL, "ui-button-primary")}>
          {writing ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Wand2 size={14} aria-hidden="true" />}
          {writing ? t("botWizard.soul.writing") : t("botWizard.soul.writeForMe")}
        </button>
        {role && bot.soul !== role.soul && (
          <button type="button" data-wizard-template onClick={() => derived.patch({ soul: role.soul })} className={PILL}>
            <Sparkles size={14} aria-hidden="true" />{t("botWizard.soul.useTemplate", { role: t(`botWizard.role.${role.id}` as LocaleKey) })}
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      <SoulSection bot={bot} patch={derived.patch} />
    </div>
  );
}

// ── 3 Rules ─────────────────────────────────────────────────────────────

const BEHAVIOR: Record<"allow" | "ask" | "deny", LocaleKey> = {
  allow: "botPanel.rules.allow",
  ask: "botPanel.rules.ask",
  deny: "botPanel.rules.deny",
};

export function RulesStep({ bot, draft, suggestions, patch, language }: StepProps) {
  const derived = useBotSettingsDerived(bot);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const on = !draft.rules[id];
      const rules = await setSuggestedRule(draft, id, on, language);
      if (Object.keys(rules).length) await patch({ rules });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-5" data-wizard-step-body="rules">
      <PermissionsSection bot={bot} derived={derived} part="approval" />
      <PaneSection title={t("botWizard.rules.suggested")} help={t("botWizard.rules.help")}>
        <div className="flex flex-col divide-y divide-hairline/40 rounded-xl border-[0.5px] border-border bg-elevated">
          {suggestions.rules.map((rule) => {
            const on = Boolean(draft.rules[rule.id]);
            return (
              <label key={rule.id} data-wizard-rule={rule.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 px-3.5 py-2">
                <input type="checkbox" checked={on} disabled={busy === rule.id} onChange={() => void toggle(rule.id)} className="size-4 accent-[var(--accent)]" />
                <span className="min-w-0 flex-1 text-[13px] text-ink">{rule.when}</span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11.5px]",
                  rule.behavior === "deny" ? "bg-danger/10 text-danger" : rule.behavior === "ask" ? "bg-warning/10 text-warning" : "bg-success/10 text-success")}>
                  {t(BEHAVIOR[rule.behavior])}
                </span>
              </label>
            );
          })}
        </div>
      </PaneSection>
      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}

// ── 4 Tools and apps ────────────────────────────────────────────────────

export function ToolsStep({ bot, suggestions, compact }: StepProps) {
  const derived = useBotSettingsDerived(bot);
  const { dispatch } = useStore();
  const [all, setAll] = useState(false);
  const tools: readonly WizardTool[] = all ? WIZARD_TOOLS : suggestions.tools;
  const openApps = () => dispatch({ type: "togglePlugins", open: true, surface: "apps", botId: bot.id, ...(suggestions.apps.length ? { focusApps: suggestions.apps } : {}) });
  return (
    <div className="flex flex-col gap-5" data-wizard-step-body="tools">
      {tools.includes("apps") && (
        <PaneSection title={t("botWizard.tools.apps")} data-wizard-tool="apps">
          <div className="flex flex-col gap-2 rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-3">
            <p className="text-[12.5px] text-ink-secondary">
              {suggestions.apps.length ? t("botWizard.tools.appsFor", { apps: suggestions.apps.join(", ") }) : t("botWizard.tools.appsAny")}
            </p>
            <button type="button" data-wizard-connect-apps onClick={openApps} className={cn(PILL, "self-start")}>{t("botWizard.tools.connectApps")}</button>
          </div>
        </PaneSection>
      )}
      {tools.includes("mcp") && <div data-wizard-tool="mcp"><AccessSection bot={bot} derived={derived} part="mcp" /></div>}
      {tools.includes("computer") && (
        <PaneSection title={t("computer.worksOn")} data-wizard-tool="computer">
          <div className="rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-3"><WorksOnSetting bot={bot} /></div>
        </PaneSection>
      )}
      {tools.includes("browser") && <div data-wizard-tool="browser"><AccessSection bot={bot} derived={derived} part="browser" /></div>}
      {!compact && !all && suggestions.tools.length < WIZARD_TOOLS.length && (
        <button type="button" data-wizard-all-tools onClick={() => setAll(true)} className="self-start text-[12.5px] text-accent-text hover:underline">{t("botWizard.tools.showAll")}</button>
      )}
    </div>
  );
}

// ── 5 Routines ──────────────────────────────────────────────────────────

const DAY_KEYS: LocaleKey[] = ["botWizard.day.0", "botWizard.day.1", "botWizard.day.2", "botWizard.day.3", "botWizard.day.4", "botWizard.day.5", "botWizard.day.6"] as LocaleKey[];

export function RoutinesStep({ draft, suggestions, patch }: StepProps) {
  const toggle = (id: string) => {
    const routines = draft.routines.includes(id) ? draft.routines.filter((each) => each !== id) : [...draft.routines, id];
    void patch({ routines });
  };
  const days = DAY_KEYS.map((key) => t(key));
  return (
    <div className="flex flex-col gap-3" data-wizard-step-body="routines">
      <div className="flex flex-col divide-y divide-hairline/40 rounded-xl border-[0.5px] border-border bg-elevated">
        {suggestions.routines.map((routine) => (
          <label key={routine.id} data-wizard-routine={routine.id} className="flex cursor-pointer items-start gap-3 px-3.5 py-2.5">
            <input type="checkbox" checked={draft.routines.includes(routine.id)} onChange={() => toggle(routine.id)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] text-ink">
                {routine.name}
                <span className="text-[12px] text-ink-secondary">{scheduleLabel(routine.time, routine.weekdays, days, t("botWizard.routines.weekdays"), t("botWizard.routines.everyDay"))}</span>
              </span>
              <span className="text-[12px] leading-relaxed text-ink-secondary">{routine.prompt}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="px-1 text-[12px] text-ink-secondary">{t("botWizard.routines.when")}</p>
    </div>
  );
}

export function StepBody(props: StepProps & { step: Exclude<WizardStep, "recap"> }) {
  if (props.step === "identity") return <IdentityStep {...props} />;
  if (props.step === "soul") return <SoulStep {...props} />;
  if (props.step === "rules") return <RulesStep {...props} />;
  if (props.step === "tools") return <ToolsStep {...props} />;
  return <RoutinesStep {...props} />;
}
