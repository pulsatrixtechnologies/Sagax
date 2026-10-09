// The persona editor: one bot's whole profile in a modal shaped like
// Achievements (category-modal.ts: a left column of categories, one
// scrolling pane, the close button top right). Each category shows the same
// section the bot panel used to show under More (useBotSectionContent), so both
// save through the same paths. A section this viewer may not change stays
// in the list and says why (botSectionLock); nothing is hidden for lack of a
// permission. Opened from the mascot's menu in the bot panel (store action
// openPersonaEditor).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Lock, Search, X } from "lucide-react";

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
import { botSectionLock, useBotSectionAvailability, useBotSectionContent } from "../bot-settings/useBotSectionContent";
import { PERSONA_CATEGORIES, isPersonaCategory, type PersonaCategory } from "@/lib/persona-sections";
import { PersonaOverview } from "./PersonaOverview";

export { PERSONA_CATEGORIES, isPersonaCategory, type PersonaCategory };

const ENTRY = new Map(BOT_SECTIONS.map((entry) => [entry.id, entry]));

export function personaCategoryLabel(id: BotSettingsSection): string {
  const entry = ENTRY.get(id);
  if (!entry) return id;
  return entry.labelKey ? t(entry.labelKey) : entry.label;
}

/** Search over the category names and the words each section answers to. */
export function personaCategoryMatches(id: BotSettingsSection, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const entry = ENTRY.get(id);
  return [personaCategoryLabel(id), entry?.label ?? id, ...(entry?.keywords ?? [])].some((part) => part.toLowerCase().includes(q));
}

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
  const [query, setQuery] = useState("");
  const { available, slackUrl, perspicaxOrg } = useBotSectionAvailability(bot.id);

  // Simple mode hides the same sections it hides in the bot panel; their
  // saved values stay. Nothing here is hidden for lack of a permission.
  const categories = useMemo(
    () => PERSONA_CATEGORIES.filter((id) => advanced || !simpleHidesBotSection(id)),
    [advanced],
  );
  const listed = categories.filter((id) => personaCategoryMatches(id, query));
  const current: PersonaCategory = isPersonaCategory(section) && categories.includes(section) ? section : "overview";
  const choose = (id: PersonaCategory) => dispatch({ type: "personaEditorSection", section: id });

  const { renderSectionBody, dialogs, derived } = useBotSectionContent(bot, {
    section: current,
    expanded: true,
    onOpenSection: (target) => {
      if (isPersonaCategory(target)) {
        if (advanced || !simpleHidesBotSection(target)) choose(target);
        return;
      }
      // Routines and the other Details sections live in the bot panel.
      onClose();
      dispatch({ type: "toggleSettings", open: true, section: target, botId: bot.id });
    },
    returnFocusRef: dialogRef,
    slackUrl,
  });

  useCategoryModalKeyboard(dialogRef, '[data-persona-nav] [aria-current="page"]', onClose);

  const onNavKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const id = nextCategory(listed, current, event.key);
    if (id === null) return;
    event.preventDefault();
    choose(id);
    navRef.current?.querySelector<HTMLElement>(`[data-persona-category="${id}"]`)?.focus();
  };

  const lockOf = (id: BotSettingsSection): LocaleKey | null => botSectionLock(state.config, bot, id);
  const memoryAllowed = canEditBotField(state.config, bot, "memoryEnabled");

  const body = (id: PersonaCategory): ReactNode => {
    if (id === "overview") {
      const sharing: BotSettingsSection | null = available("sharing") ? "sharing" : available("visibility") ? "visibility" : null;
      return (
        <div className="flex flex-col">
          <PersonaOverview bot={bot} derived={derived} onClose={onClose} />
          <SubHeading>{t("persona.overview.summary")}</SubHeading>
          {renderSectionBody("overview")}
          {sharing && (
            <>
              <SubHeading>{personaCategoryLabel(sharing)}</SubHeading>
              {renderSectionBody(sharing)}
            </>
          )}
        </div>
      );
    }
    if (id === "perspicax" && perspicaxOrg === null) {
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
    if (id === "memory") return null; // mounted below so an unsaved draft survives
    if (id === "access") {
      const worksOn = (advanced || !simpleHidesBotSection("worksOn")) && lockOf("worksOn") === null;
      return (
        <div className="flex flex-col">
          {renderSectionBody("access")}
          {worksOn && (
            <>
              <SubHeading>{personaCategoryLabel("worksOn")}</SubHeading>
              {renderSectionBody("worksOn")}
            </>
          )}
          {available("slack") && (
            <>
              <SubHeading>{personaCategoryLabel("slack")}</SubHeading>
              {renderSectionBody("slack")}
            </>
          )}
        </div>
      );
    }
    return renderSectionBody(id);
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
          <label className="mb-1.5 flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline-weak bg-elevated px-2 py-1">
            <Search size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && listed[0]) {
                  event.preventDefault();
                  choose(listed[0]);
                }
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery("");
                }
              }}
              placeholder={t("persona.search")}
              aria-label={t("persona.searchLabel")}
              data-persona-search=""
              className="w-full min-w-0 bg-transparent text-[12.5px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </label>
          {listed.map((id) => {
            const Icon = ENTRY.get(id)?.icon;
            const locked = id !== "overview" && (lockOf(id) !== null || (id === "perspicax" && perspicaxOrg === null));
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
                {Icon && <Icon size={15} className="shrink-0" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate">{personaCategoryLabel(id)}</span>
                {locked && <Lock size={12} aria-label={t("persona.lockedBadge")} className="shrink-0 text-ink-tertiary" />}
              </button>
            );
          })}
          {listed.length === 0 && (
            <div className="px-2 py-2 text-[12.5px] leading-relaxed text-ink-secondary">{t("persona.noMatch", { query: query.trim() })}</div>
          )}
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
              onChange={(event) => choose(event.target.value as PersonaCategory)}
              className={CATEGORY_MODAL.mobileSelect}
            >
              {categories.map((id) => (
                <option key={id} value={id}>{personaCategoryLabel(id)}</option>
              ))}
            </select>
          </div>
          <div className={CATEGORY_MODAL.pane} data-persona-pane={current}>
            <h2 className={CATEGORY_MODAL.heading}>{personaCategoryLabel(current)}</h2>
            <div className={CATEGORY_MODAL.body}>
              {body(current)}
              {/* Memory has an explicit Save button: it stays mounted so an
                  unsaved draft survives a look at another category. */}
              {memoryAllowed && lockOf("memory") === null && (
                <div hidden={current !== "memory"}>
                  <MemorySection bot={bot} active={current === "memory"} onToggle={(enabled) => derived.patch({ memoryEnabled: enabled })} />
                </div>
              )}
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
