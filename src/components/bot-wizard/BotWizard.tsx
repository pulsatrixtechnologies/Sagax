// The bot creation wizard (2026-10-26): a dedicated screen with the look of
// the guided first run (onboarding/GuidedFirstRun.tsx: the card, the mark,
// the progress dots, Back and the step count), beside New bot's quick dialog.
//
// - First screen: two cards, "Guided with my bot" and "I'll fill it in
//   myself", and the drafts left to resume. Choosing one creates the bot
//   (Auto defaults, as New bot) and its wizard draft on the server.
//   2026-10-27: New bot opens this screen directly. What its old dialog
//   offered stays under "Other ways to start": a template (the full form,
//   with Start from and More options), Browse templates, Import (zip, Grok
//   Bot or Claude Code, #1178) and Quick create (the server's defaults).
// - Guided never waits on a bot the person lacks: with no bot to guide, it
//   creates the Bot designer (src/lib/bot-wizard.ts), the person's own bot,
//   which leads. With no engine connected, the card says so and opens
//   Settings > Engines instead of a dead end.
// - Six steps over that real bot (WizardSteps.tsx), each skippable. The mode
//   can change at any time from the header; nothing is lost, it is one field
//   of the same draft.
// - Guided: the conversation with the person's Primary Bot on the left, the
//   steps on the right, filled live (the bot changes the bot's fields with
//   sagax_settings and the wizard's with bot.wizard; the panel reads them
//   back) and editable by hand.
// - Recap: every step on one page, and Try it, the first test message to
//   the new bot, before Finish.
//
// Later (Escape, Later) keeps the draft: the bot stays a draft until the
// person finishes, and the creation menu or the bot's panel resume it.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ClipboardList, Download, LayoutTemplate, Library, Loader2, MessagesSquare, PlugZap, Send, Trash2, Zap } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { engineSummary, organisationSignIn } from "@/lib/onboarding";
import { openModelKeysSettings } from "@/lib/settings-link";
import { templatesEntryActions } from "@/lib/templates-entry";
import { showBotZipImport } from "@/lib/bot-zip";
import { canEditBotField } from "@/lib/bot-capabilities";
import { memberNewBotSettings } from "@/lib/member-new-bot-settings";
import {
  createDesignerBot,
  createWizardBot,
  deleteWizardDraft,
  finishWizard,
  guideBot,
  listWizardDrafts,
  openWizardThread,
  patchWizardDraft,
  pendingRules,
  readWizardDraft,
  sendWizardMessage,
  setSuggestedRule,
  startWizardDraft,
  wizardSuggestions,
  type WireWizardDraft,
} from "@/lib/bot-wizard";
import {
  WIZARD_STEPS,
  applyWizardPatch,
  guidedKickoff,
  nextWizardStep,
  previousWizardStep,
  tryItMessage,
  wizardStepIndex,
  type WizardMode,
  type WizardPatch,
  type WizardStep,
} from "../../../shared/bot-wizard";
import { PulsatrixMark } from "../PulsatrixMark";
import { BotAvatar } from "../Avatar";
import { ProgressDots } from "../onboarding/ProgressDots";
import { PrimaryButton, QuietButton } from "../onboarding/beats/shared";
import { StepBody, stepIntro, stepTitle, type StepProps } from "./WizardSteps";
import { WizardConversation } from "./WizardConversation";
import { engineReady } from "../EngineLibrary";
import { BotZipImportDialog } from "../BotZipImport";
import { AgentImportDialog } from "../AgentImport";

/** How often the guided panel reads the draft back while the Primary Bot fills it. */
const GUIDED_POLL_MS = 2_500;

export function BotWizard() {
  const { state, dispatch } = useStore();
  const opened = state.botWizard;
  const language = activeLocale();
  const [botId, setBotId] = useState<string | null>(opened?.botId ?? null);
  const [draft, setDraft] = useState<WireWizardDraft | null>(null);
  const [phase, setPhase] = useState<"loading" | "choose" | "steps">(opened?.botId ? "loading" : "choose");
  const [drafts, setDrafts] = useState<WireWizardDraft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<WireWizardDraft | null>(null);
  draftRef.current = draft;
  const bot = botId ? state.bots.find((candidate) => candidate.id === botId) ?? null : null;
  const guide = useMemo(() => {
    if (draft?.guidedBotId) return state.bots.find((candidate) => candidate.id === draft.guidedBotId) ?? null;
    return guideBot(state.bots, botId);
  }, [draft?.guidedBotId, state.bots, botId]);

  // An engine that can run the guide's turns (the first run's own test).
  const engineReadyNow = useMemo(() => {
    const instances = state.instances ?? [];
    // not listed yet (the first /api/instances answer): no verdict, no flash
    if (instances.length === 0) return true;
    const summary = engineSummary(instances, engineReady, { company: Boolean(organisationSignIn(typeof window === "undefined" ? undefined : window.ogb, { hosted: false })) });
    return summary.ready.length > 0 || summary.company > 0 || instances.some(engineReady);
  }, [state.instances]);
  const [importing, setImporting] = useState<"zip" | "agent" | null>(null);

  const close = useCallback(() => dispatch({ type: "closeBotWizard" }), [dispatch]);
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));

  // A bot's own wizard (Redo, Resume): its open draft resumes in its mode;
  // otherwise the mode choice, prefilled from the bot.
  useEffect(() => {
    let cancelled = false;
    if (opened?.botId) {
      void readWizardDraft(opened.botId, language)
        .then(({ draft: found }) => {
          if (cancelled) return;
          if (found.status === "draft" && !opened.redo) { setDraft(found); setPhase("steps"); }
          else setPhase("choose");
        })
        .catch(() => { if (!cancelled) setPhase("choose"); });
    } else {
      void listWizardDrafts().then((found) => { if (!cancelled) setDrafts(found); }).catch(() => {});
    }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The draft's own patch: shown at once, then the server's answer. */
  const patch = useCallback(async (value: WizardPatch) => {
    const current = draftRef.current;
    if (!current) return;
    setDraft(applyWizardPatch(current, value, Date.now()) as WireWizardDraft);
    try {
      const saved = await patchWizardDraft(current.botId, value);
      setDraft((shown) => shown && shown.botId === saved.botId ? saved : shown);
    } catch (cause) {
      fail(cause);
    }
  }, []);

  /** The guided conversation: a new topic with the guide, opened by the
   * person's own request naming the bot. Once per draft. With no bot to
   * guide, the Bot designer is created first (the person's own bot). */
  const ensureGuided = useCallback(async (current: WireWizardDraft, target: Bot | null) => {
    if (current.guidedThreadId) return;
    let leader: Bot | null = guide;
    if (!leader) {
      if (!engineReadyNow) return;
      leader = await createDesignerBot(language);
      dispatch({ type: "botAdded", bot: leader, preserveSelection: true });
    }
    const name = target?.name ?? current.botName ?? "";
    const threadId = await openWizardThread(leader.id, t("botWizard.guided.threadTitle", { name }));
    await patch({ guidedBotId: leader.id, guidedThreadId: threadId });
    await sendWizardMessage(leader.id, threadId, guidedKickoff({ botName: name, language }));
  }, [guide, engineReadyNow, language, patch, dispatch]);

  const connectEngine = () => {
    close();
    openModelKeysSettings(dispatch);
  };

  // Other ways to start: what New bot's old dialog offered, kept here.
  const startFromTemplate = () => { close(); dispatch({ type: "toggleNewBot", open: true }); };
  const browseTemplates = () => { for (const action of templatesEntryActions("botWizard")) dispatch(action); };
  const quickCreate = () => {
    if (state.botCreationPending) return;
    dispatch({ type: "newBot", settings: memberNewBotSettings(state.config, {}), onCreated: () => close(), onError: (message) => setError(message) });
  };

  const choose = async (mode: WizardMode, resume?: WireWizardDraft) => {
    if (busy) return;
    setBusy(mode);
    setError(null);
    try {
      let target = resume ? state.bots.find((candidate) => candidate.id === resume.botId) ?? null : bot;
      let origin: "new" | "redo" = resume?.origin ?? (opened?.botId ? "redo" : "new");
      if (!target) {
        const created = await createWizardBot(undefined, { noMcp: canEditBotField(state.config, {}, "mcpServers", { draft: true }) });
        // in the sidebar at once, without leaving what is open behind
        dispatch({ type: "botAdded", bot: created, preserveSelection: true });
        target = created;
        origin = "new";
      }
      const started = await startWizardDraft(target.id, { origin, mode, ...(opened?.redo ? { restart: true } : {}) });
      setBotId(target.id);
      setDraft(started);
      setPhase("steps");
      if (mode === "guided") await ensureGuided(started, target);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  };

  const switchMode = async (mode: WizardMode) => {
    if (!draft || draft.mode === mode) return;
    await patch({ mode });
    if (mode === "guided") await ensureGuided({ ...draft, mode }, bot).catch(fail);
  };

  // Guided: the Primary Bot fills the draft; read it back while it works,
  // and make the rules it marked "pending" with the person's own session.
  useEffect(() => {
    if (phase !== "steps" || draft?.mode !== "guided" || !botId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const { draft: fresh } = await readWizardDraft(botId, language);
        if (stopped) return;
        if (fresh.updatedAt !== draftRef.current?.updatedAt) setDraft(fresh);
        for (const id of pendingRules(fresh)) {
          const rules = await setSuggestedRule(fresh, id, true, language);
          if (Object.keys(rules).length) await patch({ rules });
        }
      } catch {
        // the next beat tries again
      }
    };
    const timer = setInterval(() => void tick(), GUIDED_POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [phase, draft?.mode, botId, language, patch]);

  const goTo = (step: WizardStep) => void patch({ step });
  const skip = () => { if (draft) void patch({ skip: draft.step }); };
  const next = () => {
    if (!draft) return;
    const after = nextWizardStep(draft.step);
    if (after) goTo(after);
  };

  const finish = async () => {
    if (!draft || busy) return;
    setBusy("finish");
    setError(null);
    try {
      const { failed } = await finishWizard(draft, language);
      close();
      dispatch({ type: "select", id: draft.botId });
      if (failed.length) dispatch({ type: "error", message: t("botWizard.finish.routineFailed", { names: failed.join(", ") }) });
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  };

  const discard = async (target: WireWizardDraft) => {
    setError(null);
    try {
      await deleteWizardDraft(target.botId);
      // a bot the wizard made goes with its draft, the way Delete removes one
      if (target.origin === "new") dispatch({ type: "deleteBot", botId: target.botId });
      setDrafts((all) => all.filter((each) => each.botId !== target.botId));
    } catch (cause) {
      fail(cause);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest("textarea, input, [role=menu], [role=dialog]:not([data-bot-wizard])")) return;
    event.preventDefault();
    close();
  };

  const guided = phase === "steps" && draft?.mode === "guided";
  const step = draft?.step ?? "identity";
  const index = wizardStepIndex(step);
  const previous = previousWizardStep(step);
  const suggestions = useMemo(() => wizardSuggestions(draft?.roleId ?? "", language), [draft?.roleId, language]);
  const stepProps: StepProps | null = bot && draft ? { bot, draft, suggestions, patch, language } : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app p-3 sm:p-6" data-bot-wizard-screen="">
      <div
        ref={cardRef}
        role="dialog"
        data-bot-wizard=""
        aria-modal="true"
        aria-label={t("botWizard.dialog")}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="welcome-card relative flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-hairline/40 bg-panel shadow-[0_30px_80px_-28px_rgba(0,0,0,0.45),0_8px_24px_-12px_rgba(0,0,0,0.25)] outline-none"
        style={{ maxWidth: guided ? 1180 : 760, height: phase === "steps" ? "min(860px, 100%)" : undefined }}
      >
        <header className="flex shrink-0 items-center gap-3 px-5 pb-3 pt-5 sm:px-8 sm:pt-7">
          <span className="flex shrink-0"><PulsatrixMark size={36} ground="app" /></span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-semibold text-ink">
              {phase === "steps" ? stepTitle(step) : t("botWizard.title")}
            </h1>
            {phase === "steps" && bot && <p className="truncate text-[12.5px] text-ink-secondary">{t("botWizard.subtitle", { name: bot.name })}</p>}
          </div>
          {phase === "steps" && draft && (
            <div role="radiogroup" aria-label={t("botWizard.mode")} className="hidden shrink-0 gap-0.5 rounded-lg bg-control p-0.5 sm:flex" data-wizard-mode-switch="">
              {(["guided", "manual"] as const).map((mode) => (
                <button key={mode} type="button" role="radio" aria-checked={draft.mode === mode} data-wizard-mode={mode}
                  onClick={() => void switchMode(mode)}
                  className={cn("flex min-h-[30px] items-center gap-1.5 rounded-md border px-2.5 text-[12px]",
                    draft.mode === mode ? "border-accent-border bg-selected font-medium text-ink shadow-sm" : "border-transparent text-ink-secondary hover:bg-raised-hover hover:text-ink")}>
                  {mode === "guided" ? <MessagesSquare size={13} aria-hidden="true" /> : <ClipboardList size={13} aria-hidden="true" />}
                  {t(`botWizard.mode.${mode}.short`)}
                </button>
              ))}
            </div>
          )}
          <QuietButton onClick={close} className="shrink-0" data-wizard-later="">{t("botWizard.later")}</QuietButton>
        </header>

        {error && <p role="alert" className="mx-5 mb-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-[13px] text-danger sm:mx-8">{error}</p>}

        {phase === "loading" && (
          <div role="status" className="flex items-center justify-center gap-2 px-8 py-16 text-[13px] text-ink-secondary">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />{t("botWizard.loading")}
          </div>
        )}

        {phase === "choose" && (
          <ModeChoice busy={busy} redoName={opened?.botId ? bot?.name : undefined} guideName={guide?.name ?? null}
            engineReady={engineReadyNow} onConnectEngine={connectEngine}
            drafts={drafts} onChoose={(mode) => void choose(mode)}
            onResume={(entry) => void choose(entry.mode, entry)} onDiscard={(entry) => void discard(entry)}
            otherStarts={opened?.botId ? undefined : {
              onTemplate: startFromTemplate,
              onBrowse: browseTemplates,
              onImport: showBotZipImport(state.config) ? setImporting : undefined,
              onQuick: quickCreate,
              quickBusy: Boolean(state.botCreationPending),
            }} />
        )}
        {importing === "zip" && <BotZipImportDialog onClose={() => setImporting(null)} onImported={() => close()} />}
        {importing === "agent" && <AgentImportDialog onClose={() => setImporting(null)} onImported={() => close()} />}

        {phase === "steps" && draft && !bot && (
          <div role="status" className="flex items-center justify-center gap-2 px-8 py-16 text-[13px] text-ink-secondary">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />{t("botWizard.loading")}
          </div>
        )}

        {phase === "steps" && stepProps && draft && (
          <div className={cn("flex min-h-0 flex-1", guided ? "flex-col lg:flex-row" : "flex-col")}>
            {guided && (
              <section aria-label={t("botWizard.guided.conversation")} className="relative flex min-h-[320px] flex-1 flex-col overflow-hidden border-hairline/40 max-lg:border-b lg:max-w-[520px] lg:border-r" data-wizard-guided-chat="">
                {draft.guidedThreadId && draft.guidedBotId
                  ? <WizardConversation botId={draft.guidedBotId} threadId={draft.guidedThreadId} title={t("botWizard.guided.conversation")} />
                  : <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-[13px] text-ink-secondary">
                      {!guide && !engineReadyNow
                        ? <NeedsEngine onConnect={connectEngine} />
                        : <><Loader2 size={16} className="animate-spin" aria-hidden="true" />{guide ? t("botWizard.guided.opening", { name: guide.name }) : t("botWizard.guided.creatingDesigner")}</>}
                    </div>}
              </section>
            )}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-8" data-wizard-step={step}>
                <p className="mb-4 text-[13.5px] leading-relaxed text-ink-secondary">{stepIntro(step)}</p>
                {step === "recap"
                  ? <Recap {...stepProps} onEdit={goTo} />
                  : <StepBody key={step} {...stepProps} step={step} />}
              </div>
              <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline/40 px-5 py-4 sm:px-8">
                {previous ? <QuietButton onClick={() => goTo(previous)} data-wizard-back="">{t("onboarding.back")}</QuietButton> : <span />}
                <div className="flex items-center gap-3">
                  <ProgressDots items={WIZARD_STEPS.map((id) => ({ id, label: stepTitle(id) }))} index={index}
                    onSelect={(target) => goTo(WIZARD_STEPS[target]!)} label={t("botWizard.steps")} />
                  <span className="text-[11px] text-ink-secondary" aria-live="polite">{t("onboarding.progress", { current: index + 1, total: WIZARD_STEPS.length })}</span>
                </div>
                <div className="flex items-center gap-3">
                  {step !== "recap" && <QuietButton onClick={skip} data-wizard-skip="">{t("botWizard.skip")}</QuietButton>}
                  {step === "recap"
                    ? <PrimaryButton onClick={() => void finish()} disabled={busy === "finish"} className="w-auto px-5" data-wizard-finish="">
                        {busy === "finish" ? t("botWizard.finishing") : t("botWizard.finish")}
                      </PrimaryButton>
                    : <PrimaryButton onClick={next} className="w-auto px-5" data-wizard-next="">{t("onboarding.continue")}</PrimaryButton>}
                </div>
              </footer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Guided with no engine to run the guide: what to do, not a grey card. */
function NeedsEngine({ onConnect, compact }: { onConnect: () => void; compact?: boolean }) {
  return (
    <span className={cn("flex flex-col gap-2", compact ? "items-start" : "items-center")} data-wizard-needs-engine="">
      <span className="text-[13px] leading-relaxed text-ink-secondary">{t("botWizard.guided.needsEngine")}</span>
      <button type="button" onClick={onConnect} data-wizard-connect-engine=""
        className="ui-button inline-flex min-h-[36px] items-center gap-1.5 md:min-h-0">
        <PlugZap size={14} aria-hidden="true" />{t("botWizard.guided.connectEngine")}
      </button>
    </span>
  );
}

export interface OtherStarts {
  /** The full form: Start from (presets, built-in roles), More options. */
  onTemplate: () => void;
  /** Browse Bots on Templates. */
  onBrowse: () => void;
  /** Import a zip, or an agent from Grok Bot or Claude Code (#1178); absent where import is not offered. */
  onImport?: (kind: "zip" | "agent") => void;
  /** Quick create: the server's defaults, no step. */
  onQuick: () => void;
  quickBusy?: boolean;
}

export function ModeChoice({ busy, redoName, guideName, engineReady = true, onConnectEngine, drafts, onChoose, onResume, onDiscard, otherStarts }: {
  busy: string | null;
  redoName?: string;
  guideName: string | null;
  /** An engine can run the guide (with no bot to guide, the Bot designer is created). */
  engineReady?: boolean;
  onConnectEngine?: () => void;
  drafts: WireWizardDraft[];
  onChoose: (mode: WizardMode) => void;
  onResume: (draft: WireWizardDraft) => void;
  onDiscard: (draft: WireWizardDraft) => void;
  /** New bot's other ways to start (absent on a bot's own Redo). */
  otherStarts?: OtherStarts;
}) {
  const needsEngine = !guideName && !engineReady;
  const card = "group flex min-h-[180px] flex-1 flex-col items-start gap-3 rounded-2xl border border-hairline/50 bg-elevated p-5 text-left transition-[border-color,transform] duration-150 hover:border-accent-border active:scale-[0.99] disabled:opacity-50 motion-reduce:transition-none";
  return (
    <div className="flex flex-col gap-6 overflow-y-auto px-5 pb-7 sm:px-8" data-wizard-mode-choice="">
      <p className="text-[13.5px] leading-relaxed text-ink-secondary">
        {redoName ? t("botWizard.choose.redo", { name: redoName }) : t("botWizard.choose.intro")}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {needsEngine
          // no engine to run the guide: the card says what to do and does it
          ? <div className={cn(card, "hover:border-hairline/50 active:scale-100")} data-wizard-choose="guided" data-wizard-guided-state="needs-engine">
              <span className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent"><MessagesSquare size={22} aria-hidden="true" /></span>
              <span className="text-[16px] font-semibold text-ink">{t("botWizard.mode.guided")}</span>
              {onConnectEngine && <NeedsEngine onConnect={onConnectEngine} compact />}
            </div>
          : <button type="button" className={card} disabled={busy !== null} onClick={() => onChoose("guided")} data-wizard-choose="guided"
              data-wizard-guided-state={guideName ? "guide" : "designer"}>
              <span className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent"><MessagesSquare size={22} aria-hidden="true" /></span>
              <span className="text-[16px] font-semibold text-ink">{t("botWizard.mode.guided")}</span>
              <span className="text-[13px] leading-relaxed text-ink-secondary">
                {guideName ? t("botWizard.mode.guided.body", { name: guideName }) : t("botWizard.mode.guided.bodyDesigner")}
              </span>
              {busy === "guided" && <Loader2 size={16} className="animate-spin text-ink-secondary" aria-hidden="true" />}
            </button>}
        <button type="button" className={card} disabled={busy !== null} onClick={() => onChoose("manual")} data-wizard-choose="manual">
          <span className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent"><ClipboardList size={22} aria-hidden="true" /></span>
          <span className="text-[16px] font-semibold text-ink">{t("botWizard.mode.manual")}</span>
          <span className="text-[13px] leading-relaxed text-ink-secondary">{t("botWizard.mode.manual.body")}</span>
          {busy === "manual" && <Loader2 size={16} className="animate-spin text-ink-secondary" aria-hidden="true" />}
        </button>
      </div>
      <p className="text-[12px] text-ink-secondary">{t("botWizard.choose.switchAnytime")}</p>
      {otherStarts && <OtherStartsRow {...otherStarts} busy={busy !== null} />}
      {drafts.length > 0 && (
        <section aria-label={t("botWizard.drafts")} className="flex flex-col gap-2" data-wizard-drafts="">
          <h2 className="px-1 text-[13px] font-medium text-ink">{t("botWizard.drafts")}</h2>
          <div className="flex flex-col divide-y divide-hairline/40 rounded-xl border-[0.5px] border-border bg-elevated">
            {drafts.map((entry) => (
              <div key={entry.botId} className="flex min-h-[48px] items-center gap-3 px-3.5 py-2" data-wizard-draft-row={entry.botId}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{entry.botName || t("botWizard.unnamed")}</span>
                  <span className="block truncate text-[12px] text-ink-secondary">{t("botWizard.draftAt", { step: stepTitle(entry.step) })}</span>
                </span>
                <button type="button" onClick={() => onResume(entry)} className="ui-button min-h-[36px] md:min-h-0">{t("botWizard.resume")}</button>
                <button type="button" onClick={() => onDiscard(entry)} aria-label={t("botWizard.discard", { name: entry.botName || t("botWizard.unnamed") })} title={t("botWizard.discard", { name: entry.botName || t("botWizard.unnamed") })} className="ui-button min-h-[36px] md:min-h-0"><Trash2 size={14} aria-hidden="true" /></button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** New bot's old dialog, as secondary options: nothing it offered is lost. */
function OtherStartsRow({ onTemplate, onBrowse, onImport, onQuick, quickBusy, busy }: OtherStarts & { busy: boolean }) {
  const option = "ui-button inline-flex min-h-[36px] items-center gap-1.5 md:min-h-0 disabled:opacity-50";
  return (
    <section aria-labelledby="wizard-other-starts" className="flex flex-col gap-2 border-t border-hairline/40 pt-4" data-wizard-other-starts="">
      <h2 id="wizard-other-starts" className="px-1 text-[13px] font-medium text-ink">{t("botWizard.other.title")}</h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={option} disabled={busy} onClick={onTemplate} data-wizard-other="template" title={t("botWizard.other.templateHint")}>
          <LayoutTemplate size={14} aria-hidden="true" />{t("botWizard.other.template")}
        </button>
        <button type="button" className={option} disabled={busy} onClick={onBrowse} data-wizard-other="browse">
          <Library size={14} aria-hidden="true" />{t("botWizard.other.browse")}
        </button>
        {onImport && <>
          <button type="button" className={option} disabled={busy} onClick={() => onImport("agent")} data-wizard-other="import-agent">
            <Download size={14} aria-hidden="true" />{t("botWizard.other.importAgent")}
          </button>
          <button type="button" className={option} disabled={busy} onClick={() => onImport("zip")} data-wizard-other="import-zip">
            <Download size={14} aria-hidden="true" />{t("botWizard.other.importZip")}
          </button>
        </>}
        <button type="button" className={option} disabled={busy || quickBusy} onClick={onQuick} data-wizard-other="quick" title={t("botWizard.other.quickHint")}>
          {quickBusy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Zap size={14} aria-hidden="true" />}{t("botWizard.other.quick")}
        </button>
      </div>
    </section>
  );
}

/** Step 6: every step on one page, each editable where it stands, and Try it. */
function Recap(props: StepProps & { onEdit: (step: WizardStep) => void }) {
  const { bot, draft, patch, language, onEdit } = props;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tryIt = async () => {
    setSending(true);
    setError(null);
    try {
      let threadId = draft.testThreadId;
      if (!threadId) {
        threadId = await openWizardThread(bot.id, t("botWizard.recap.testTitle"));
        await patch({ testThreadId: threadId });
      }
      await sendWizardMessage(bot.id, threadId, tryItMessage(language));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };
  const sections = WIZARD_STEPS.filter((step): step is Exclude<WizardStep, "recap"> => step !== "recap");
  return (
    <div className="flex flex-col gap-6" data-wizard-recap="">
      <div className="flex items-center gap-3 rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-3">
        <BotAvatar bot={bot} state="happy" size={44} animated={false} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink">{bot.name}</span>
          <span className="block truncate text-[12.5px] text-ink-secondary">{bot.description || bot.title}</span>
        </span>
        <PrimaryButton onClick={() => void tryIt()} disabled={sending} className="w-auto px-4" data-wizard-try="">
          <span className="inline-flex items-center gap-1.5">{sending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}{t("botWizard.recap.try")}</span>
        </PrimaryButton>
      </div>
      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      {draft.testThreadId && (
        <div className="relative flex h-[340px] flex-col overflow-hidden rounded-xl border-[0.5px] border-border" data-wizard-test-chat="">
          <WizardConversation botId={bot.id} threadId={draft.testThreadId} title={t("botWizard.recap.testTitle")} />
        </div>
      )}
      {sections.map((step) => (
        <section key={step} className="flex flex-col gap-3" data-wizard-recap-section={step}>
          <div className="flex items-center justify-between gap-3 border-b border-hairline/40 pb-1.5">
            <h2 className="text-[14px] font-semibold text-ink">
              {stepTitle(step)}
              {draft.skipped.includes(step) && <span className="ml-2 text-[12px] font-normal text-ink-tertiary">{t("botWizard.recap.skipped")}</span>}
            </h2>
            <QuietButton onClick={() => onEdit(step)}>{t("botWizard.recap.open")}</QuietButton>
          </div>
          <StepBody {...props} step={step} compact />
        </section>
      ))}
    </div>
  );
}
