// The bot editor ("Edit bot"): one bot's whole profile in a modal shaped like
// Achievements (category-modal.ts: a left column of categories, one
// scrolling pane, the close button top right). The left column lists the
// groups (lib/persona-sections.ts); each section is its own page (JC
// 2026-10-15), listed under its group while that group is open, each the
// same body the bot panel used to show (useBotSectionContent), so both save
// through the same paths. A
// section this viewer may not change stays on its page and says why
// (botSectionLock); nothing is hidden for lack of a permission. Opened from
// the bot's "..." menu in the bot panel, and on Appearance from a click on
// the bot's avatar (store action openPersonaEditor).
import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Coins, FolderTree, Cpu, History, LayoutDashboard, Lock, type LucideIcon, Mic, ScrollText, ShieldCheck, X } from "lucide-react";

import { useStore, type Bot, type BotSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { simpleHidesBotSection } from "@/lib/interface-visibility";
import { canEditBotField } from "@/lib/bot-capabilities";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { useRetroSkin } from "../RetroChromeHost";
import { shortcutLabel } from "../ShortcutHint";
import { CATEGORY_MODAL, categoryNavItemClass, nextCategory, useCategoryModalKeyboard } from "../category-modal";
import { BOT_SECTIONS } from "../bot-settings/sections";
import { RulesSection } from "../bot-settings/RulesSection";
import { WorkspaceFilesSection } from "../bot-settings/WorkspaceFilesSection";
import { botSectionLock, useBotSectionAvailability, useBotSectionContent } from "../bot-settings/useBotSectionContent";
import {
  PERSONA_CATEGORIES,
  PERSONA_GROUPS,
  isPersonaCategory,
  personaCategoryForSection,
  personaGroupOf,
  personaGroupSections,
  type PersonaCategory,
  type PersonaGroup,
} from "@/lib/persona-sections";
import { PersonaOverview } from "./PersonaOverview";

export { PERSONA_CATEGORIES, PERSONA_GROUPS, isPersonaCategory, type PersonaCategory, type PersonaGroup };

const ENTRY = new Map(BOT_SECTIONS.map((entry) => [entry.id, entry]));

const GROUP_ICON: Record<PersonaGroup, LucideIcon> = {
  profile: LayoutDashboard,
  instructions: ScrollText,
  memoryFiles: FolderTree,
  modelTools: Cpu,
  permissions: ShieldCheck,
  voice: Mic,
  usage: Coins,
  changes: History,
};

export function personaCategoryLabel(id: BotSettingsSection): string {
  const entry = ENTRY.get(id);
  if (!entry) return id;
  return entry.labelKey ? t(entry.labelKey) : entry.label;
}

/** A group that is one page, or that opens on a page of its own name, is
 * named after that page (Permissions, Voice, Usage, Changes). */
export function personaGroupLabel(id: PersonaGroup): string {
  const pages = personaGroupSections(id);
  if (pages.length === 1) return personaCategoryLabel(pages[0]!);
  if (isPersonaCategory(id as BotSettingsSection)) return personaCategoryLabel(id as BotSettingsSection);
  return t(`persona.group.${id}` as LocaleKey);
}

/** Sections that keep an unsaved draft (their own Save button): mounted on
 * every page, shown only on their own. */
const KEEP_MOUNTED: ReadonlySet<PersonaCategory> = new Set(["rules", "files"]);

function Note({ children, icon = true }: { children: ReactNode; icon?: boolean }) {
  return (
    <p role="note" data-persona-locked="" className="flex items-start gap-2 rounded-lg bg-raised/60 px-3 py-2 text-[12.5px] leading-snug text-ink-secondary">
      {icon && <Lock size={13} aria-hidden="true" className="mt-0.5 shrink-0" />}
      <span>{children}</span>
    </p>
  );
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
  const focusNav = useRef(false);
  const { available, slackUrl, perspicaxOrg } = useBotSectionAvailability(bot.id);

  // Simple mode hides the same sections it hides in the bot panel; their
  // saved values stay. A page this server does not offer (Slack without an
  // Admin page, Shared with off Perspicax, Who can see it where one person
  // signs in) is not listed, and a group left with no page goes. Nothing
  // here is hidden for lack of a permission.
  const offered = (id: PersonaCategory) =>
    id === "slack" || id === "sharing" || id === "visibility" ? available(id) : true;
  const shown = (id: PersonaCategory) => (advanced || !simpleHidesBotSection(id)) && offered(id);
  const groups = useMemo(
    () => PERSONA_GROUPS
      .map((group) => ({ id: group.id as PersonaGroup, sections: (group.sections as readonly PersonaCategory[]).filter(shown) }))
      .filter((group) => group.sections.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [advanced, slackUrl, perspicaxOrg, available("visibility")],
  );
  const pages = groups.flatMap((group) => group.sections);
  const target = personaCategoryForSection(section) ?? "overview";
  // A link to a page this viewer does not get lands on its stand-in: Who
  // can see it and Shared with stand for each other, else the group's home.
  const current: PersonaCategory = pages.includes(target) ? target
    : target === "visibility" && pages.includes("sharing") ? "sharing"
      : target === "sharing" && pages.includes("visibility") ? "visibility"
        : groups.find((group) => group.id === personaGroupOf(target))?.sections[0] ?? "overview";
  const currentGroup: PersonaGroup = personaGroupOf(current);
  const choose = (id: PersonaGroup) => {
    const first = groups.find((group) => group.id === id)?.sections[0];
    if (first) dispatch({ type: "personaEditorSection", section: first });
  };
  const choosePage = (id: PersonaCategory) => dispatch({ type: "personaEditorSection", section: id });
  const goTo = (id: BotSettingsSection) => {
    const category = personaCategoryForSection(id);
    if (category && shown(category)) dispatch({ type: "personaEditorSection", section: id });
  };

  // The server overview loads on What it does, the history on Changes.
  const { renderSectionBody, dialogs, derived } = useBotSectionContent(bot, {
    section: current === "summary" ? "overview" : current,
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

  // A new page starts at the top; after a key in the list, focus follows
  // the page (its entry exists only once its group is open).
  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
    if (!focusNav.current) return;
    focusNav.current = false;
    const nav = navRef.current;
    (nav?.querySelector<HTMLElement>(`[data-persona-page="${current}"]`)
      ?? nav?.querySelector<HTMLElement>(`[data-persona-category="${currentGroup}"]`))?.focus();
  }, [current, currentGroup]);

  useCategoryModalKeyboard(dialogRef, '[data-persona-nav] [aria-current="page"]', onClose);

  // Up and Down walk every page in order, opening its group on the way.
  const onNavKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    const id = nextCategory(pages, current, event.key);
    if (id === null) return;
    event.preventDefault();
    focusNav.current = true;
    choosePage(id);
  };

  const lockOf = (id: BotSettingsSection): LocaleKey | null => botSectionLock(state.config, bot, id);
  const memoryAllowed = canEditBotField(state.config, bot, "memoryEnabled");
  const unavailable = (id: PersonaCategory) => id === "perspicax" && perspicaxOrg === null;
  const groupLocked = (sections: readonly PersonaCategory[]) =>
    sections.every((id) => lockOf(id) !== null || unavailable(id));

  const body = (id: PersonaCategory): ReactNode => {
    if (id === "overview") return <PersonaOverview bot={bot} derived={derived} />;
    // What the server says the bot does, reaches and won't do, the prompt
    // preview and the recent changes.
    if (id === "summary") return renderSectionBody("overview");
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
    return renderSectionBody(id);
  };

  // Rules and the Bot folder have an explicit Save button: they stay
  // mounted on every page so an unsaved draft survives a look at another
  // page. The Bot folder is also where the memory is managed: "Use memory"
  // heads it for a viewer who may change it.
  const kept = (id: PersonaCategory, onPage: boolean): ReactNode => {
    if (lockOf(id) !== null) return null;
    if (id === "rules") return <RulesSection bot={bot} active={onPage} />;
    const memoryEditable = memoryAllowed && lockOf("memory") === null;
    return (
      <WorkspaceFilesSection
        bot={bot}
        active={onPage}
        memoryEditable={memoryEditable}
        memory={memoryEditable ? { enabled: bot.memoryEnabled !== false, busy: Boolean(bot.busy), onToggle: (enabled) => derived.patch({ memoryEnabled: enabled }) } : undefined}
        onOpenSection={goTo}
      />
    );
  };

  // The page title: the group's name on its home and on a group of one
  // page, the page's own name otherwise.
  const groupPages = groups.find((group) => group.id === currentGroup)?.sections ?? [];
  const title = current === "overview" || groupPages.length === 1 ? personaGroupLabel(currentGroup) : personaCategoryLabel(current);

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
            const open = currentGroup === id;
            // A group of several pages lists them under it while it is open.
            const subPages = open && sections.length > 1 ? sections : [];
            return (
              <div key={id} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  data-persona-category={id}
                  data-locked={locked ? "" : undefined}
                  onClick={() => choose(id)}
                  aria-current={open ? (subPages.length > 0 ? "true" : "page") : undefined}
                  aria-expanded={sections.length > 1 ? open : undefined}
                  className={categoryNavItemClass(open && subPages.length === 0)}
                >
                  <Icon size={15} className="shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{personaGroupLabel(id)}</span>
                  {locked && <Lock size={12} aria-label={t("persona.lockedBadge")} className="shrink-0 text-ink-tertiary" />}
                </button>
                {subPages.length > 0 && (
                  <ul data-persona-subnav={id} aria-label={personaGroupLabel(id)} className="mb-1 ml-[17px] flex flex-col gap-0.5 border-l border-hairline/60 pl-2">
                    {subPages.map((page) => (
                      <li key={page}>
                        <button
                          type="button"
                          data-persona-page={page}
                          data-locked={lockOf(page) !== null || unavailable(page) ? "" : undefined}
                          onClick={() => choosePage(page)}
                          aria-current={current === page ? "page" : undefined}
                          className={cn(categoryNavItemClass(current === page), "w-full py-[5px] text-[12.5px]", current === page ? "" : "text-ink-secondary")}
                        >
                          <span className="min-w-0 flex-1 truncate">{personaCategoryLabel(page)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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
              onChange={(event) => choosePage(event.target.value as PersonaCategory)}
              className={CATEGORY_MODAL.mobileSelect}
            >
              {groups.map(({ id, sections }) => sections.length === 1 ? (
                <option key={id} value={sections[0]}>{personaGroupLabel(id)}</option>
              ) : (
                <optgroup key={id} label={personaGroupLabel(id)}>
                  {sections.map((page) => <option key={page} value={page}>{personaCategoryLabel(page)}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div ref={paneRef} className={CATEGORY_MODAL.pane} data-persona-pane={currentGroup} data-persona-current={current}>
            <h2 className={CATEGORY_MODAL.heading}>{title}</h2>
            <div className={CATEGORY_MODAL.body}>
              {/* Every page keeps its place in the tree, so a section kept
                  mounted never remounts when the page changes. */}
              {pages.map((id) => {
                const onPage = id === current;
                const keep = KEEP_MOUNTED.has(id);
                if (!onPage && !keep) return null;
                const content = keep && !unavailable(id) && lockOf(id) === null
                  ? kept(id, onPage)
                  : onPage ? body(id) : null;
                if (!onPage && content === null) return null;
                return (
                  <section key={id} data-persona-section={id} hidden={!onPage}>
                    {content}
                  </section>
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
