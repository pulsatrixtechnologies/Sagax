import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Command, Plus, Users, X } from "lucide-react";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { viewerActorId, viewerBotsReadOnly, viewerCanCreateBots } from "@/lib/viewer";
import { isViewersPrimaryBot } from "@/lib/primary-bot";
import { useStore, type Bot } from "@/state/store";
import { useOrgPeople, type OrgDirectoryPerson } from "@/lib/perspicax-org";
import { personAvatarSrc } from "@/lib/profile-management";
import { BotAvatar } from "./Avatar";
import { PersonAvatar } from "./MessageAuthor";
import { personInitials } from "@/lib/people-dm";
import { useCaptionChrome } from "./DesktopCapabilities";

type ComposeMode = "browse" | "group";
type ComposeRow = { kind: "create-bot" } | { kind: "create-group" } | { kind: "bot"; bot: Bot } | { kind: "person"; person: OrgDirectoryPerson };

function isExternalBot(bot: Bot, viewer: string): boolean {
  const owner = bot.ownerUserId?.trim().toLowerCase();
  if (!owner || owner === "local-owner") return false;
  return owner !== viewer.trim().toLowerCase();
}

function matches(bot: Bot, query: string): boolean {
  if (!query) return true;
  return `${bot.name} ${bot.title} ${bot.description ?? ""}`.toLowerCase().includes(query);
}

/** The organization's people one may write to directly: active persons of
 * the Perspicax directory, never a service account and never oneself. */
export function composePeople(people: Iterable<OrgDirectoryPerson>, viewer: string, query: string): OrgDirectoryPerson[] {
  const self = viewer.trim().toLowerCase();
  return [...people].filter((person) => !person.disabled && !person.service && person.principalId.toLowerCase() !== self &&
    (!query || `${person.name} ${person.login} ${person.email ?? ""}`.toLowerCase().includes(query)));
}

/** Rows under the To: field. Group mode keeps the confirm row, then the
 * bots. "New bot" is offered only when the server lets this viewer create one.
 * On an organization server the people follow the bots (browse mode only):
 * choosing one opens the direct conversation with them. */
export function composeRows(mode: ComposeMode, bots: Bot[], canCreateBots = true, people: OrgDirectoryPerson[] = []): ComposeRow[] {
  const botRows = bots.map((bot): ComposeRow => ({ kind: "bot", bot }));
  if (mode === "group") return [{ kind: "create-group" }, ...botRows];
  return [
    ...(canCreateBots ? [{ kind: "create-bot" } as const] : []),
    { kind: "create-group" },
    ...botRows,
    ...people.map((person): ComposeRow => ({ kind: "person", person })),
  ];
}

function KeyHint({ n }: { n: number }) {
  return (
    <kbd aria-hidden className="flex shrink-0 items-center gap-0.5 rounded-md border border-hairline/50 px-1.5 py-0.5 text-[11px] leading-none text-ink-secondary">
      {isMacPlatform() ? <Command size={11} /> : <span>Ctrl</span>}
      <span>{n}</span>
    </kbd>
  );
}

/**
 * Inline "To:" picker in the main column. Creating a bot or a group stays
 * here: no centered dialog. A bot row starts a new thread. Group mode
 * collects members in the same list, then creates the channel.
 */
export function ComposeToPicker({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const { dragStyle, noDragStyle, controlsShiftStyle } = useCaptionChrome();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ComposeMode>("browse");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const viewer = viewerActorId(state.config);
  const canCreateBots = viewerCanCreateBots(state.config);
  const botsReadOnly = viewerBotsReadOnly(state.config);
  const q = query.trim().toLowerCase();
  const bots = state.bots.filter((bot) => !bot.hidden && !isExternalBot(bot, viewer) && matches(bot, q));
  const orgPeople = useOrgPeople();
  const people = useMemo(() => composePeople(orgPeople.values(), viewer, q), [orgPeople, viewer, q]);
  const rows = useMemo(() => composeRows(mode, bots, canCreateBots, people), [mode, bots, canCreateBots, people]);
  const active = rows.length ? Math.min(cursor, rows.length - 1) : 0;

  useEffect(() => setCursor(0), [q, mode]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, rows.length]);

  const togglePicked = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setQuery("");
  };

  const activate = (row: ComposeRow | undefined) => {
    if (!row) return;
    if (row.kind === "create-bot") {
      if (state.botCreationPending || !canCreateBots) return;
      dispatch({ type: "newBot" });
      onCloseRef.current();
      return;
    }
    if (row.kind === "create-group") {
      if (mode === "browse") {
        setMode("group");
        setQuery("");
        return;
      }
      if (!picked.size) return;
      dispatch({ type: "createGroup", memberIds: [...picked] });
      track("room_created", { members: picked.size, context: false });
      onCloseRef.current();
      return;
    }
    if (row.kind === "person") {
      dispatch({ type: "openPeopleDm", principalId: row.person.principalId });
      onCloseRef.current();
      return;
    }
    if (mode === "group") {
      togglePicked(row.bot.id);
      setCursor(0);
      return;
    }
    dispatch({ type: "newTask", botId: row.bot.id });
    onCloseRef.current();
  };

  const activateRef = useRef(activate);
  activateRef.current = activate;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const inside = target instanceof Node && Boolean(rootRef.current?.contains(target));
      if (event.key === "Escape") {
        if (!inside && target instanceof HTMLElement && target.closest("[role=dialog], [role=alertdialog]")) return;
        event.preventDefault();
        event.stopPropagation();
        if (mode === "group") {
          setMode("browse");
          setPicked(new Set());
          setQuery("");
          return;
        }
        onCloseRef.current();
        return;
      }
      if (!inside) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && /^[1-9]$/.test(event.key)) {
        const row = rows[Number(event.key) - 1];
        if (!row) return;
        event.preventDefault();
        event.stopPropagation();
        activateRef.current(row);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setCursor((current) => {
          const index = rows.length ? Math.min(current, rows.length - 1) : 0;
          if (!rows.length) return 0;
          return event.key === "ArrowDown" ? (index + 1) % rows.length : (index - 1 + rows.length) % rows.length;
        });
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLButtonElement)) {
        event.preventDefault();
        event.stopPropagation();
        activateRef.current(rows[rows.length ? Math.min(active, rows.length - 1) : 0]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mode, rows, active]);

  const groupLabel = mode === "group" && picked.size > 1
    ? t("sidebar.newChannel.createMany", { count: picked.size })
    : mode === "group" && picked.size === 1
      ? t("sidebar.newChannel.createOne")
      : t("compose.createGroup");

  return (
    <div ref={rootRef} data-compose-to className="pointer-events-none absolute inset-x-0 top-0 z-20 text-ink">
      <div className="pointer-events-auto flex min-h-12 items-center gap-3 border-b border-hairline/40 bg-app px-4 py-2" style={dragStyle}>
        <span className="shrink-0 text-[15px] text-ink-secondary" style={noDragStyle}>{t("compose.to")}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" style={noDragStyle}>
          {mode === "group" && [...picked].map((id) => {
            const bot = state.bots.find((item) => item.id === id);
            if (!bot) return null;
            return (
              <span key={id} className="flex max-w-full items-center gap-1 rounded-full bg-raised py-0.5 pl-1 pr-1 text-[13px]">
                <BotAvatar bot={bot} state="idle" size={18} animated={false} />
                <span className="max-w-[8rem] truncate">{bot.name}</span>
                <button
                  type="button"
                  aria-label={`${t("compose.remove")} ${bot.name}`}
                  onClick={() => togglePicked(id)}
                  className="flex size-5 items-center justify-center rounded-full text-ink-secondary hover:bg-app hover:text-ink"
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === "group" ? t("compose.placeholderGroup") : t("compose.placeholder")}
            aria-label={mode === "group" ? t("compose.groupAria") : t("compose.placeholder")}
            aria-controls="compose-to-list"
            aria-activedescendant={rows[active] ? `compose-row-${active}` : undefined}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            className="min-w-[10rem] flex-1 bg-transparent py-1 text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
        </div>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
          style={{ ...noDragStyle, ...controlsShiftStyle }}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>
      <div className="relative">
        <div
          id="compose-to-list"
          role="listbox"
          aria-label={t("compose.placeholder")}
          className="pointer-events-auto absolute left-3 top-2 z-10 max-h-[min(440px,70vh)] w-[min(440px,calc(100%-1.5rem))] overflow-y-auto rounded-xl border border-hairline/50 bg-menu py-1.5 shadow-2xl shadow-black/50"
        >
          {botsReadOnly && (
            <p role="note" data-bots-read-only className="px-3 py-2 text-[12.5px] leading-snug text-ink-secondary">{t("bots.readOnly.notice")}</p>
          )}
          {rows.map((row, index) => {
            const shortcut = index < 9 ? index + 1 : undefined;
            const selected = index === active;
            if (row.kind === "create-bot") {
              return (
                <button
                  key="create-bot"
                  id={`compose-row-${index}`}
                  ref={selected ? activeRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-compose-action="create-bot"
                  disabled={state.botCreationPending}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => activate(row)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] text-ink disabled:opacity-40",
                    selected ? "bg-raised/80" : "hover:bg-raised/60",
                  )}
                >
                  <Plus size={16} className="shrink-0 text-ink-secondary" />
                  <span className="flex-1 truncate">{t("compose.createBot")}</span>
                  {shortcut && <KeyHint n={shortcut} />}
                </button>
              );
            }
            if (row.kind === "create-group") {
              const disabled = mode === "group" && picked.size === 0;
              return (
                <button
                  key="create-group"
                  id={`compose-row-${index}`}
                  ref={selected ? activeRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-compose-action="create-group"
                  disabled={disabled}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => activate(row)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] text-ink disabled:opacity-40",
                    selected ? "bg-raised/80" : "hover:bg-raised/60",
                  )}
                >
                  <Users size={16} className="shrink-0 text-ink-secondary" />
                  <span className="flex-1 truncate">{groupLabel}</span>
                  {shortcut && <KeyHint n={shortcut} />}
                </button>
              );
            }
            if (row.kind === "person") {
              const person = row.person;
              return (
                <button
                  key={`person:${person.principalId}`}
                  id={`compose-row-${index}`}
                  ref={selected ? activeRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-compose-person={person.principalId}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => activate(row)}
                  className={cn(
                    "group flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] text-ink",
                    selected ? "bg-raised/80" : "hover:bg-raised/60",
                  )}
                >
                  <PersonAvatar avatarUrl={personAvatarSrc(person.avatarUrl)} initials={personInitials(person.name || person.login)} size={28} />
                  <span className="min-w-0 flex-1 truncate">{person.name || person.login}</span>
                  <span className={cn("shrink-0 text-[13px] text-ink-secondary", selected ? "inline" : "hidden group-hover:inline")}>{t("compose.directMessage")}</span>
                  {shortcut && (
                    <span className={cn(selected ? "hidden" : "group-hover:hidden")}>
                      <KeyHint n={shortcut} />
                    </span>
                  )}
                </button>
              );
            }
            const bot = row.bot;
            const member = picked.has(bot.id);
            const hint = mode === "group"
              ? (member ? t("compose.remove") : t("compose.add"))
              : t("compose.newChat");
            return (
              <button
                key={bot.id}
                id={`compose-row-${index}`}
                ref={selected ? activeRef : undefined}
                type="button"
                role="option"
                aria-selected={selected || member}
                data-compose-bot={bot.id}
                onMouseEnter={() => setCursor(index)}
                onClick={() => activate(row)}
                className={cn(
                  "group flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] text-ink",
                  selected ? "bg-raised/80" : "hover:bg-raised/60",
                )}
              >
                <BotAvatar bot={bot} primary={isViewersPrimaryBot(bot, viewer)} primaryRingClassName="ring-elevated" state="idle" size={28} animated={false} />
                <span className="min-w-0 flex-1 truncate">{bot.name}</span>
                {mode === "group" && member && !selected && <Check size={14} className="shrink-0 text-ink-secondary group-hover:hidden" />}
                <span className={cn(
                  "shrink-0 text-[13px] text-ink-secondary",
                  selected ? "inline" : "hidden group-hover:inline",
                )}>{hint}</span>
                {shortcut && (
                  <span className={cn(selected ? "hidden" : "group-hover:hidden")}>
                    <KeyHint n={shortcut} />
                  </span>
                )}
              </button>
            );
          })}
          {q && bots.length === 0 && people.length === 0 && (
            <div className="px-3 py-2 text-[13px] text-ink-secondary">{t("sidebar.noMatch", { query: query.trim() })}</div>
          )}
          {!q && bots.length === 0 && (
            <div className="px-3 py-2 text-[13px] text-ink-secondary">{t("sidebar.newChannel.emptyHint")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
