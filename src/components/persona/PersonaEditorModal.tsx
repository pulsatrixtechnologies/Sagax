// The bot editor ("Edit bot"): one bot's whole profile in a modal shaped like
// Achievements (category-modal.ts: a left column of categories, one
// scrolling pane, the close button top right). The left column lists six
// groups (lib/persona-sections.ts, JC 2026-10-14); a group's page shows its
// sections one under the other, each the same body the bot panel used to
// show (useBotSectionContent), so both save through the same paths. A
// section this viewer may not change stays on its page and says why
// (botSectionLock); nothing is hidden for lack of a permission. Opened from
// the bot's "..." menu in the bot panel, and on Appearance from a click on
// the bot's avatar (store action openPersonaEditor).
import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Brain, ChevronRight, Cpu, History, LayoutDashboard, Lock, type LucideIcon, ScrollText, ShieldCheck, X } from "lucide-react";

import { useStore, type Bot, type BotSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { simpleHidesBotSection } from "@/lib/interface-visibility";
import { canEditBotField } from "@/lib/bot-capabilities";
import type { LocaleKey } from "@/locales";
import { useRetroSkin } from "../RetroChromeHost";
import { shortcutLabel } from "../ShortcutHint";
import { CATEGORY_MODAL, categoryNavItemClass, nextCategory, useCategoryModalKeyboard } from "../category-modal";
import { BOT_SECTIONS } from "../bot-settings/sections";
import { MemorySection } from "../bot-settings/MemorySection";
import { RulesSection } from "../bot-settings/RulesSection";
import { WorkspaceFilesSection } from "../bot-settings/WorkspaceFilesSection";
import { botSectionLock, useBotSectionAvailability, useBotSectionContent } from "../bot-settings/useBotSectionContent";
import {
  PERSONA_CATEGORIES,
  PERSONA_GROUPS,
  isPersonaCategory,
  personaCategoryForSection,
  personaGroupOf,
  type PersonaCategory,
  type PersonaGroup,
} from "@/lib/persona-sections";
import { PersonaOverview } from "./PersonaOverview";

export { PERSONA_CATEGORIES, PERSONA_GROUPS, isPersonaCategory, type PersonaCategory, type PersonaGroup };

const ENTRY = new Map(BOT_SECTIONS.map((entry) => [entry.id, entry]));

const GROUP_ICON: Record<PersonaGroup, LucideIcon> = {
  profile: LayoutDashboard,
  instructions: ScrollText,
  memoryFiles: Brain,
  modelTools: Cpu,
  behavior: ShieldCheck,
  activity: History,
};

export function personaCategoryLabel(id: BotSettingsSection): string {
  const entry = ENTRY.get(id);
  if (!entry) return id;
  return entry.labelKey ? t(entry.labelKey) : entry.label;
}

export function personaGroupLabel(id: PersonaGroup): string {
  return t(`persona.group.${id}`);
}

/** Sections that keep an unsaved draft (their own Save button): mounted on
 * every page, shown only on their group's page. */
const KEEP_MOUNTED: ReadonlySet<PersonaCategory> = new Set(["memory", "rules", "files"]);

function Note({ children, icon = true }: { children: ReactNode; icon?: boolean }) {
  return (
    <p role="note" data-persona-locked="" className="flex items-start gap-2 rounded-lg bg-raised/60 px-3 py-2 text-[12.5px] leading-snug text-ink-secondary">
      {icon && <Lock size={13} aria-hidden="true" className="mt-0.5 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 mt-8 text-[14px] font-medium text-ink">{children}</h3>;
}

export function PersonaEditorModal() {
  const { state, dispatch } = useStore();
  const editor = state.personaEditor;
  const bot = editor ? state.bots.find((candidate) => candidate.id === editor.botId) : undefined;
  // A bot deleted while its editor is open closes the editor.
  const gone = editor !== null && bot === undefined;
  useEffect(() => { if (gone) dispatch({ type: "closePersonaEditor" }); }, [gone, dispatch]);
  if (!editor || !bot) return null;
  return <PersonaEditor key={bot.id} bot={bot} section={editor.section} onClose={() => dispatch({ type: "closePersonaEditor" })} />;
}

function PersonaEditor({ bot, section, onClose }: { bot: Bot; section: BotSettingsSection; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  const retroSkin = useRetroSkin();
  const dialogRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const { available, slackUrl, perspicaxOrg } = useBotSectionAvailability(bot.id);

  // Simple mode hides the same sections it hides in the bot panel; their
  // saved values stay. A group left with no section is not listed.
  // Nothing here is hidden for lack of a permission.
  const shown = (id: PersonaCategory) => advanced || !simpleHidesBotSection(id);
  const groups = useMemo(
    () => PERSONA_GROUPS
      .map((group) => ({ id: group.id as PersonaGroup, sections: (group.sections as readonly PersonaCategory[]).filter((id) => advanced || !simpleHidesBotSection(id)) }))
      .filter((group) => group.sections.length > 0),
    [advanced],
  );
  const groupIds = groups.map((group) => group.id);
  const target = personaCategoryForSection(section) ?? "overview";
  const wanted = personaGroupOf(section);
  const current: PersonaGroup = shown(target) && groupIds.includes(wanted) ? wanted : "profile";
  const currentSections = groups.find((group) => group.id === current)?.sections ?? [];
  const choose = (id: PersonaGroup) => {
    const first = groups.find((group) => group.id === id)?.sections[0];
    if (first) dispatch({ type: "personaEditorSection", section: first });
  };
  const goTo = (id: BotSettingsSection) => {
    const category = personaCategoryForSection(id);
    if (category && shown(category)) dispatch({ type: "personaEditorSection", section: id });
  };

  // The server overview and the history load when their page is up.
  const { renderSectionBody, dialogs, derived } = useBotSectionContent(bot, {
    section: currentSections[0] ?? "overview",
    expanded: true,
    onOpenSection: (next) => {
      if (isPersonaCategory(next) || personaCategoryForSection(next) !== null) {
        goTo(next);
        return;
      }
      // Routines and the other Details sections live in the bot panel.
      onClose();
      dispatch({ type: "toggleSettings", open: true, section: next, botId: bot.id });
    },
    returnFocusRef: dialogRef,
    slackUrl,
  });

  // A link to a section further down a page scrolls to it.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    if (currentSections[0] === target) {
      pane.scrollTop = 0;
      return;
    }
    pane.querySelector(`[data-persona-section="${target}"]`)?.scrollIntoView?.({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, target]);

  useCategoryModalKeyboard(dialogRef, '[data-persona-nav] [aria-current="page"]', onClose);

  const onNavKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    const id = nextCategory(groupIds, current, event.key);
    if (id === null) return;
    event.preventDefault();
    choose(id);
    navRef.current?.querySelector<HTMLElement>(`[data-persona-category="${id}"]`)?.focus();
  };

  const lockOf = (id: BotSettingsSection): LocaleKey | null => botSectionLock(state.config, bot, id);
  const memoryAllowed = canEditBotField(state.config, bot, "memoryEnabled");
  const unavailable = (id: PersonaCategory) => id === "perspicax" && perspicaxOrg === null;
  const groupLocked = (sections: readonly PersonaCategory[]) =>
    sections.every((id) => id !== "overview" && id !== "appearance" && (lockOf(id) !== null || unavailable(id)));

  const body = (id: PersonaCategory): ReactNode => {
    if (id === "overview") {
      const sharing: BotSettingsSection | null = available("sharing") ? "sharing" : available("visibility") ? "visibility" : null;
      return (
        <div className="flex flex-col">
          <PersonaOverview bot={bot} derived={derived} />
          {sharing && (
            <>
              <SubHeading>{personaCategoryLabel(sharing)}</SubHeading>
              {renderSectionBody(sharing)}
            </>
          )}
          {/* What the server says the bot does, reaches and won't do, the
              prompt preview and the recent changes: one click away. */}
          <details data-persona-summary="" className="group mt-8 border-t border-hairline/40 pt-5">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-ink [&::-webkit-details-marker]:hidden">
              <ChevronRight size={14} aria-hidden="true" className="text-ink-secondary transition-transform group-open:rotate-90 motion-reduce:transition-none" />
              {t("persona.overview.summary")}
            </summary>
            <div className="mt-4">{renderSectionBody("overview")}</div>
          </details>
        </div>
      );
    }
    if (unavailable(id)) {
      return <Note icon={false}>{t("persona.unavailable.perspicax")}</Note>;
    }
    const lock = lockOf(id);
    if (lock) {
      return (
        <div className="flex flex-col gap-3">
          <Note>{t(lock)}</Note>
          {/* The soul is on the bot record: shown as it is, not editable. */}
          {id === "soul" && bot.soul?.trim() && (
            <pre data-persona-readonly="" aria-readonly="true" className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-card p-3 font-sans text-[13px] leading-relaxed text-ink-secondary">
              {bot.soul}
            </pre>
          )}
        </div>
      );
    }
    if (id === "access") {
      const worksOn = (advanced || !simpleHidesBotSection("worksOn")) && lockOf("worksOn") === null;
      return (
        <div className="flex flex-col">
          {/* Where it works first, then what it may reach. */}
          {worksOn && <div className="mb-5">{renderSectionBody("worksOn")}</div>}
          {renderSectionBody("access")}
          {available("slack") && (
            <div className="mt-5 border-t border-hairline/40 pt-5">
              <h4 className="mb-3 text-[13px] font-medium text-ink">{personaCategoryLabel("slack")}</h4>
              {renderSectionBody("slack")}
            </div>
          )}
        </div>
      );
    }
    return renderSectionBody(id);
  };

  // Memory, Rules and Files have an explicit Save button: they stay mounted
  // on every page so an unsaved draft survives a look at another group.
  const kept = (id: PersonaCategory, onPage: boolean): ReactNode => {
    if (id === "memory") {
      if (!memoryAllowed || lockOf("memory") !== null) return null;
      return <MemorySection bot={bot} active={onPage} onToggle={(enabled) => derived.patch({ memoryEnabled: enabled })} />;
    }
    if (lockOf(id) !== null) return null;
    if (id === "rules") return <RulesSection bot={bot} active={onPage} />;
    return (
      <WorkspaceFilesSection
        bot={bot}
        active={onPage}
        memoryEditable={memoryAllowed && lockOf("memory") === null}
        onOpenSection={goTo}
      />
    );
  };

  return (
    <div
      className={CATEGORY_MODAL.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="persona-modal-title"
        tabIndex={-1}
        data-persona-modal=""
        className={CATEGORY_MODAL.frame}
      >
        <span id="persona-modal-title" className="sr-only">{t("persona.titleFor", { name: bot.name })}</span>
        <nav
          ref={navRef}
          data-persona-nav=""
          aria-label={t("persona.categories")}
          onKeyDown={onNavKey}
          className={CATEGORY_MODAL.nav}
        >
          <div className={CATEGORY_MODAL.navTitle}>
            <div className="truncate">{t("persona.title")}</div>
            <div className="truncate text-[12px] font-normal text-ink-secondary">{bot.name}</div>
          </div>
          {groups.map(({ id, sections }) => {
            const Icon = GROUP_ICON[id];
            const locked = groupLocked(sections);
            return (
              <button
                key={id}
                type="button"
                data-persona-category={id}
                data-locked={locked ? "" : undefined}
                onClick={() => choose(id)}
                aria-current={current === id ? "page" : undefined}
                className={categoryNavItemClass(current === id)}
              >
                <Icon size={15} className="shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{personaGroupLabel(id)}</span>
                {locked && <Lock size={12} aria-label={t("persona.lockedBadge")} className="shrink-0 text-ink-tertiary" />}
              </button>
            );
          })}
        </nav>

        <div className={CATEGORY_MODAL.content}>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            title={`${t("common.close")} (${shortcutLabel("close-panel")})`}
            className={CATEGORY_MODAL.close}
          >
            <X size={18} />
          </button>
          <div className={CATEGORY_MODAL.mobileBar}>
            <select
              aria-label={t("persona.categories")}
              value={current}
              onChange={(event) => choose(event.target.value as PersonaGroup)}
              className={CATEGORY_MODAL.mobileSelect}
            >
              {groups.map(({ id }) => (
                <option key={id} value={id}>{personaGroupLabel(id)}</option>
              ))}
            </select>
          </div>
          <div ref={paneRef} className={CATEGORY_MODAL.pane} data-persona-pane={current}>
            <h2 className={CATEGORY_MODAL.heading}>{personaGroupLabel(current)}</h2>
            <div className={CATEGORY_MODAL.body}>
              {/* Every group keeps its place in the tree, so a section kept
                  mounted never remounts when the page changes. */}
              {groups.map(({ id: group, sections }) => {
                const onPage = group === current;
                return (
                  <div key={group} data-persona-group={group} hidden={!onPage}>
                    {sections.map((id, index) => {
                      const keep = KEEP_MOUNTED.has(id);
                      if (!onPage && !keep) return null;
                      const content = keep && !unavailable(id) && lockOf(id) === null && !(id === "memory" && !memoryAllowed)
                        ? kept(id, onPage)
                        : onPage ? body(id) : null;
                      if (!onPage && content === null) return null;
                      return (
                        <section key={id} data-persona-section={id}>
                          {/* The first section of a page is under the page title. */}
                          {index > 0 && <SubHeading>{personaCategoryLabel(id)}</SubHeading>}
                          {index === 0 && id !== "overview" && sections.length > 1 && (
                            <h3 className="mb-3 text-[14px] font-medium text-ink">{personaCategoryLabel(id)}</h3>
                          )}
                          {content}
                        </section>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          {retroSkin && (
            <div className="r98-dialog-footer">
              <button type="button" className="r98-dialog-ok" onClick={onClose}>
                {t("retro.button.ok")}
              </button>
            </div>
          )}
        </div>
      </div>
      {dialogs}
    </div>
  );
}
