// The group's right side panel. It is the bot panel (BotSettingsDialog)
// adapted to a group: the same docked shell, top bar, big avatar, name and
// tab strip, so a group and a bot read as one design. Group-specific bodies
// (members on Details; responder and folder on Advanced, like a bot's own
// folder) come from GroupView, which owns their state. Every group setting
// lives here: there is no separate setup dialog.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelRight } from "lucide-react";

import { useStore, type Bot, type Group } from "@/state/store";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { BotAvatar } from "./Avatar";
import { ExportTranscriptMenu } from "./ExportTranscriptMenu";
import { inputCls } from "./bot-settings/field";
import { useCaptionChrome, useMacInsetChrome } from "./DesktopCapabilities";
import { normalizeState } from "@/lib/mascot";

export const GROUP_PANEL_TABS = ["details", "instructions", "advanced"] as const;
export type GroupPanelTab = (typeof GROUP_PANEL_TABS)[number];

// The bot panel's width is the user's panel width: one remembered size.
const SETTINGS_WIDTH_KEY = "omb-settings-panel-width";
const SETTINGS_MIN_WIDTH = 320;
const SETTINGS_MAX_WIDTH = 720;
const SETTINGS_DEFAULT_WIDTH = 360;

function readSettingsWidth(): number {
  try {
    const stored = Number(localStorage.getItem(SETTINGS_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= SETTINGS_MIN_WIDTH && stored <= SETTINGS_MAX_WIDTH) return stored;
  } catch { /* default width */ }
  return SETTINGS_DEFAULT_WIDTH;
}

const tabLabel = (tab: GroupPanelTab) =>
  tab === "instructions" ? t("groupPanel.tab.instructions") : t(`botPanel.tab.${tab}`);

/** Up to three member faces overlapped in a square, the group's avatar. */
export function GroupAvatarStack({ members, size }: { members: Bot[]; size: number }) {
  const shown = members.slice(0, 3);
  if (shown.length <= 1) {
    return (
      <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden="true">
        {shown[0] && <BotAvatar bot={shown[0]} state="happy" size={size} animated={false} />}
      </span>
    );
  }
  const face = Math.round(size * (shown.length === 2 ? 0.62 : 0.56));
  const spots = shown.length === 2
    ? ["left-0 top-0", "right-0 bottom-0"]
    : ["left-0 top-0", "right-0 top-[18%]", "left-[22%] bottom-0"];
  return (
    <span className="relative block shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      {shown.map((bot, index) => (
        <span key={bot.id} className={cn("absolute rounded-full", spots[index])}>
          <BotAvatar bot={bot} state={normalizeState(bot.mascotExpression) ?? "happy"} size={face} animated={false} />
        </span>
      ))}
    </span>
  );
}

export function GroupPanel({
  group,
  members,
  details,
  advanced,
  canEdit,
  readOnlyNote = false,
}: {
  group: Group;
  members: Bot[];
  /** People and bots, rendered by GroupView. */
  details: ReactNode;
  /** Default responder and working folder, rendered by GroupView; null for a remote client. */
  advanced: ReactNode;
  /** Rename and instructions: the group's owner, never a remote client. */
  canEdit: boolean;
  /** Organization server: someone else owns the group; say why it is read-only. */
  readOnlyNote?: boolean;
}) {
  const { dispatch } = useStore();
  const { padClass } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  const dialogRef = useRef<HTMLElement | null>(null);
  const [tab, setTab] = useState<GroupPanelTab>("details");
  // A remote client edits neither the responder nor the folder: no Advanced tab.
  const tabs: readonly GroupPanelTab[] = advanced == null ? GROUP_PANEL_TABS.filter((id) => id !== "advanced") : GROUP_PANEL_TABS;
  const [settingsWidth, setSettingsWidth] = useState(readSettingsWidth);
  const settingsResize = useRef<{ x: number; width: number; current: number } | null>(null);
  const [name, setName] = useState(group.name);
  const [bulletin, setBulletin] = useState(group.bulletin);
  useEffect(() => setName(group.name), [group.name]);
  useEffect(() => setBulletin(group.bulletin), [group.bulletin]);

  const closePanel = () => dispatch({ type: "toggleSettings", open: false });
  const saveName = () => {
    const next = name.trim();
    if (!next || next === group.name) return setName(group.name);
    dispatch({ type: "patchGroup", groupId: group.id, patch: { name: next } });
  };
  const saveBulletin = () => {
    if (bulletin !== group.bulletin) dispatch({ type: "patchGroup", groupId: group.id, patch: { bulletin } });
  };

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const onKey = (event: KeyboardEvent) => {
      // A dialog opened from inside this one owns Escape while it is up.
      const nested = dialog?.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      if (nested && nested.getClientRects().length > 0) return;
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "toggleSettings", open: false });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [dispatch]);

  return (
    <aside
      ref={dialogRef}
      role="dialog"
      aria-labelledby="group-panel-title"
      tabIndex={-1}
      data-testid="group-panel"
      style={{ width: settingsWidth }}
      className="app-docked-panel animate-panel-in relative flex h-full min-w-0 shrink-0 flex-col border-l-[0.5px] border-hairline-weak bg-app outline-none max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-auto"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize settings"
        aria-valuemin={SETTINGS_MIN_WIDTH}
        aria-valuemax={SETTINGS_MAX_WIDTH}
        aria-valuenow={settingsWidth}
        tabIndex={0}
        onPointerDown={(event) => {
          settingsResize.current = { x: event.clientX, width: settingsWidth, current: settingsWidth };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = settingsResize.current;
          if (!from) return;
          const next = Math.min(SETTINGS_MAX_WIDTH, Math.max(SETTINGS_MIN_WIDTH, from.width + (from.x - event.clientX)));
          settingsResize.current = { ...from, current: next };
          setSettingsWidth(next);
        }}
        onPointerUp={(event) => {
          const width = settingsResize.current?.current;
          if (width == null) return;
          settingsResize.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          try { localStorage.setItem(SETTINGS_WIDTH_KEY, String(width)); } catch { /* session only */ }
        }}
        onKeyDown={(event) => {
          const delta = event.key === "ArrowLeft" ? 24 : event.key === "ArrowRight" ? -24 : 0;
          if (!delta) return;
          event.preventDefault();
          setSettingsWidth((current) => {
            const next = Math.min(SETTINGS_MAX_WIDTH, Math.max(SETTINGS_MIN_WIDTH, current + delta));
            try { localStorage.setItem(SETTINGS_WIDTH_KEY, String(next)); } catch { /* session only */ }
            return next;
          });
        }}
        className="app-resize-handle absolute inset-y-0 -left-1.5 z-10 hidden w-3 cursor-col-resize focus-visible:bg-accent/40 lg:block"
      />
      {(macInset || browser) && <div className="content-topbar-strip" />}
      <div className={cn("content-topbar relative flex h-12 shrink-0 items-center justify-between px-3", padClass)}>
        <span />
        <div className="flex items-center gap-2">
          <ExportTranscriptMenu title={group.name} messages={group.messages} isGroup />
          <button type="button" onClick={closePanel} aria-label="Close" title="Close" className={CIRCLE_BUTTON}>
            <PanelRight size={18} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="content-card-body flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex shrink-0 flex-col items-center px-4 pb-3">
          <div className="py-3">
            <GroupAvatarStack members={members} size={112} />
          </div>
          <span id="group-panel-title" className="mt-2 max-w-full truncate text-[17px] font-medium leading-6 text-ink">{group.name}</span>
          <span className="mt-0.5 max-w-full truncate text-[12px] leading-4 text-ink-secondary">
            {members.length === 1 ? t("groupPanel.botOne") : t("groupPanel.botMany", { count: members.length })}
          </span>
          <div
            role="tablist"
            aria-label={t("groupPanel.tabsAria")}
            onKeyDown={(event) => {
              const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]!;
              setTab(next);
              event.currentTarget.querySelector<HTMLElement>(`[data-panel-tab="${next}"]`)?.focus();
            }}
            className="mt-4 flex max-w-full flex-wrap items-center justify-center gap-0.5"
          >
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                data-panel-tab={id}
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                className={cn(
                  "rounded-md px-1.5 py-1 text-[13px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  tab === id ? "bg-elevated-hover text-ink" : "text-ink-secondary hover:text-ink",
                )}
              >
                {tabLabel(id)}
              </button>
            ))}
          </div>
        </div>

        {readOnlyNote && (
          <p role="note" className="mx-4 mb-3 rounded-lg bg-card px-3 py-2 text-[12px] text-ink-secondary">{t("groupPanel.ownerOnly")}</p>
        )}

        {tab === "details" && (
          <div className="flex flex-col gap-6 px-4 pb-6 pt-2">
            {canEdit && (
              <div>
                <label htmlFor={`group-name-${group.id}`} className="mb-1.5 block text-[13px] text-ink-secondary">{t("groupPanel.name")}</label>
                <input
                  id={`group-name-${group.id}`}
                  className={inputCls}
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={saveName}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setName(group.name);
                    }
                  }}
                />
              </div>
            )}
            {details}
          </div>
        )}

        {tab === "instructions" && (
          <div className="flex flex-col gap-2 px-4 pb-6 pt-2">
            <label htmlFor={`group-bulletin-${group.id}`} className="text-[13px] text-ink-secondary">{t("groupPanel.instructions")}</label>
            <p className="text-[12px] text-ink-secondary">{t("groupPanel.instructionsDetail")}</p>
            <textarea
              id={`group-bulletin-${group.id}`}
              value={bulletin}
              readOnly={!canEdit}
              onChange={(event) => setBulletin(event.target.value)}
              onBlur={saveBulletin}
              rows={10}
              placeholder={t("groupPanel.instructionsPlaceholder")}
              className={cn(inputCls, "resize-y leading-relaxed")}
            />
          </div>
        )}

        {tab === "advanced" && advanced != null && (
          <div className="flex flex-col gap-4 px-4 pb-6 pt-2">
            {advanced}
          </div>
        )}
      </div>
    </aside>
  );
}
