// Edit an existing room's roster in one place (#1240, #1260): its people and
// its bots, ticked for who is in, saved together. The group panel's two
// "+ Add" rows and "Manage members" all open it, on the section they name.
// The owner edits everything; anyone else ticks only their own bots
// (server/group-ownership.ts). Membership is the only thing this touches:
// the transcript keeps every message a departing member already sent.
import { viewerActorId } from "@/lib/viewer";
import { useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { useStore, type Group } from "@/state/store";
import { BotPickerList } from "./BotPickerList";
import { nextHumanIds, nextMemberIds, rosterBotChoices } from "@/lib/room-members";
import { groupPeopleCandidates } from "@/lib/private-threads";
import type { OrgDirectory } from "@/lib/perspicax-org";
import { personLabel } from "@/lib/human-label";
import { Check, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { InitialsAvatar } from "./Avatar";
import { PersonLabelTag } from "./LabelTag";
import { PresenceDot } from "./PresenceDot";
import { PILL, PRIMARY_PILL, SettingsGroup, DIALOG } from "./SettingsPrimitives";

export type RosterFocus = "people" | "bots";

export type RosterPerson = { id: string; label?: string; detail?: string; avatarUrl?: string };

const norm = (id: string) => id.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initialsFor(label: string): string {
  const parts = label.trim().split(/[\s@._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (letters || label.slice(0, 2)).toUpperCase();
}

function sameList(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function PersonRow({ person, picked, locked, onToggle }: {
  person: RosterPerson;
  picked: boolean;
  /** The viewer's own row, or a person this viewer may not take out. */
  locked: boolean;
  onToggle: () => void;
}) {
  const label = personLabel(person.label, person.id);
  return (
    <button
      type="button"
      role="checkbox"
      aria-label={label}
      aria-checked={picked}
      disabled={locked}
      onClick={onToggle}
      data-roster-person={person.id}
      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left enabled:hover:bg-raised/50"
    >
      <span className="relative shrink-0">
        {person.avatarUrl ? (
          <img src={person.avatarUrl} alt="" width={28} height={28} className="size-7 rounded-full object-cover" />
        ) : (
          <InitialsAvatar initials={initialsFor(label)} size={28} />
        )}
        <PresenceDot principalId={person.id} className="absolute -bottom-0.5 -right-0.5" ringClassName="border-elevated" sizeClassName="size-2.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[14px] text-ink"><span className="min-w-0 truncate">{label}</span><PersonLabelTag principalId={person.id} tone="surface" className="max-w-[46%] shrink" /></span>
        {person.detail && <span className="block truncate text-[11.5px] text-ink-secondary">{person.detail}</span>}
      </span>
      {!locked && (
        <span
          className={cn(
            "flex size-[18px] shrink-0 items-center justify-center rounded-full border",
            picked ? "border-accent bg-accent text-accent-ink" : "border-hairline/60",
          )}
        >
          {picked && <Check size={12} />}
        </span>
      )}
    </button>
  );
}

export function ManageMembersPanel({
  group,
  onClose,
  focus = "bots",
  ownsRoom = true,
  canAddHuman = false,
  actorId,
  people = [],
  directory = null,
  organization = false,
}: {
  group: Group;
  onClose: () => void;
  /** The section the dialog opens on: the "+ Add" row that opened it. */
  focus?: RosterFocus;
  /** The owner ticks every bot and takes people out; anyone else only
   * their own bots. */
  ownsRoom?: boolean;
  /** `channelRosterActions`: whether this person may add people. */
  canAddHuman?: boolean;
  /** Who is picking (their own bots); the viewer's id by default. */
  actorId?: string;
  /** The room's people as the panel shows them, the viewer first. */
  people?: RosterPerson[];
  /** Organization server: people are searched in its directory. */
  directory?: OrgDirectory | null;
  organization?: boolean;
}) {
  const { state, dispatch } = useStore();
  const viewerId = viewerActorId(state.config);
  const actor = actorId ?? viewerId;
  const humanIds = useMemo(() => (group.humanIds ?? []).map(norm).filter(Boolean), [group.humanIds]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(group.memberIds));
  const [pickedPeople, setPickedPeople] = useState<Set<string>>(() => new Set(humanIds));
  // People ticked in from the search, in the order they were added, with
  // the row they read as.
  const [addedPeople, setAddedPeople] = useState<RosterPerson[]>([]);
  const [query, setQuery] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const opened = useRef({ memberIds: [...group.memberIds], humanIds: [...humanIds] });
  const dialogRef = useRef<HTMLDivElement>(null);
  const peopleRef = useRef<HTMLDivElement>(null);
  const botsRef = useRef<HTMLDivElement>(null);
  // Focus goes back to whatever opened the dialog (either "+ Add", or
  // "Manage members").
  const opener = useRef<HTMLElement | null>(typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null));

  const bots = useMemo(
    () => rosterBotChoices(state.bots, { memberIds: group.memberIds, ownsRoom, actorId: actor }),
    [state.bots, group.memberIds, ownsRoom, actor],
  );
  const showPeople = canAddHuman || people.length > 0;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = () =>
      [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
        (element) => !element.hasAttribute("hidden"),
      );
    const section = focus === "people" ? peopleRef.current : botsRef.current;
    section?.scrollIntoView?.({ block: "nearest" });
    const first = section?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])');
    (first ?? focusable()[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) return event.preventDefault();
      const head = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        head.focus();
      }
    };
    dialog.addEventListener("keydown", onKey);
    const back = opener.current;
    return () => {
      dialog.removeEventListener("keydown", onKey);
      if (back?.isConnected) back.focus();
    };
  }, [onClose, focus]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePerson = (id: string) =>
    setPickedPeople((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const addPerson = (person: RosterPerson) => {
    const id = norm(person.id);
    if (!id) return;
    setPickedPeople((prev) => new Set(prev).add(id));
    setAddedPeople((prev) => (prev.some((row) => row.id === id) || humanIds.includes(id) ? prev : [...prev, { ...person, id }]));
    setQuery("");
  };

  const memberIds = nextMemberIds(
    group.memberIds,
    picked,
    bots.map((b) => b.id),
  );
  const nextPeople = nextHumanIds(humanIds, pickedPeople, addedPeople.map((row) => row.id));
  const botsChanged = !sameList(memberIds, group.memberIds);
  const peopleChanged = !sameList(nextPeople, humanIds);

  // Rows: the room's people (the viewer first), then the ones ticked in.
  const listed = new Set<string>();
  const personRows = [...people, ...addedPeople].filter((row) => {
    const id = norm(row.id);
    if (!id || listed.has(id)) return false;
    listed.add(id);
    return true;
  });
  const taken = [viewerId, ...humanIds, ...addedPeople.map((row) => row.id)];
  const candidates = organization && canAddHuman && query.trim()
    ? groupPeopleCandidates(directory?.people ?? [], { taken, query })
    : [];
  const typedEmail = norm(query);
  const emailAddable = !organization && canAddHuman && EMAIL.test(typedEmail) && !taken.map(norm).includes(typedEmail);

  const save = () => {
    if (!memberIds.length) return;
    const live = { memberIds: group.memberIds, humanIds };
    if (!sameList(opened.current.memberIds, live.memberIds) || !sameList(opened.current.humanIds, live.humanIds)) {
      setSaveError(t("manageMembers.changed"));
      return;
    }
    if (botsChanged || peopleChanged) {
      dispatch({
        type: "patchGroup",
        groupId: group.id,
        patch: { ...(botsChanged ? { memberIds } : {}), ...(peopleChanged ? { humanIds: nextPeople } : {}) },
      });
      track("room_members_changed", {
        members: memberIds.length,
        added: memberIds.filter((id) => !group.memberIds.includes(id)).length,
        removed: group.memberIds.filter((id) => !memberIds.includes(id)).length,
        people: nextPeople.length,
        peopleAdded: nextPeople.filter((id) => !humanIds.includes(id)).length,
        peopleRemoved: humanIds.filter((id) => !nextPeople.includes(id)).length,
      });
    }
    onClose();
  };

  const pickedBots = bots.filter((bot) => picked.has(bot.id)).length;
  const saveLabel = !memberIds.length
    ? t("common.save")
    : peopleChanged
      ? t("common.save")
      : t(memberIds.length === 1 ? "manageMembers.saveOne" : "manageMembers.saveMany", { count: memberIds.length });

  return (
    <div
      className={cn(DIALOG.backdrop, "z-40")}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("manageMembers.aria", { name: group.name })}
        data-manage-members={focus}
        className={`${DIALOG.frame} max-w-[400px]`}
      >
        <div className={DIALOG.header}>
          <div className="min-w-0">
            <h2 className={DIALOG.title}>{t("room.members.manage")}</h2>
            <p className={`${DIALOG.subtitle} truncate`}>{group.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className={cn(DIALOG.close, "disabled:opacity-40")}><X size={18} className="pointer-events-none" /></button>
        </div>
        <div className={DIALOG.body}>
          {showPeople && (
            <div ref={peopleRef} data-roster-section="people">
              <SettingsGroup
                groupId="group-people"
                title={t("groupPanel.people")}
                accessory={<span className="ml-auto text-[12.5px] tabular-nums text-ink-secondary">{nextPeople.length + (nextPeople.includes(norm(viewerId)) ? 0 : 1)}</span>}
              >
                <div className="flex flex-col gap-1 px-1.5">
                  {canAddHuman && (
                    <div className="px-0.5 pb-1 pt-0.5">
                      <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape" && query) { event.stopPropagation(); setQuery(""); }
                          if (event.key === "Enter" && emailAddable) { event.preventDefault(); addPerson({ id: typedEmail, label: typedEmail }); }
                        }}
                        placeholder={organization ? t("room.people.search") : t("manageMembers.emailPlaceholder")}
                        aria-label={organization ? t("room.people.search") : t("manageMembers.emailPlaceholder")}
                        maxLength={200}
                        className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] placeholder:text-ink-secondary focus:outline-none"
                      />
                    </div>
                  )}
                  {query.trim() && organization && canAddHuman && directory && candidates.length === 0 && (
                    <p className="px-2 py-1 text-[12px] text-ink-secondary">{t("room.people.none")}</p>
                  )}
                  {candidates.map((person) => (
                    <PersonRow
                      key={`candidate:${person.principalId}`}
                      person={{ id: person.principalId, label: person.name || person.login, detail: person.name && person.login ? person.login : undefined, avatarUrl: person.avatarUrl }}
                      picked={false}
                      locked={false}
                      onToggle={() => addPerson({ id: person.principalId, label: person.name || person.login, detail: person.name && person.login ? person.login : undefined, avatarUrl: person.avatarUrl })}
                    />
                  ))}
                  {emailAddable && (
                    <PersonRow person={{ id: typedEmail, label: typedEmail }} picked={false} locked={false} onToggle={() => addPerson({ id: typedEmail, label: typedEmail })} />
                  )}
                  {!query.trim() && personRows.map((person) => {
                    const id = norm(person.id);
                    const self = id === norm(viewerId);
                    return (
                      <PersonRow
                        key={id}
                        person={person}
                        picked={self || pickedPeople.has(id)}
                        locked={self || !ownsRoom}
                        onToggle={() => togglePerson(id)}
                      />
                    );
                  })}
                </div>
              </SettingsGroup>
            </div>
          )}
          <div ref={botsRef} data-roster-section="bots">
            <SettingsGroup
              groupId="group-members"
              title={t("manageMembers.bots")}
              accessory={bots.length > 0 && <span className="ml-auto text-[12.5px] tabular-nums text-ink-secondary">{pickedBots}/{bots.length}</span>}
            >
              <div className="px-1.5">
                <BotPickerList bots={bots} viewerId={viewerId} picked={picked} onToggle={toggle} emptyHint={t(ownsRoom ? "manageMembers.empty" : "manageMembers.emptyOwn")} />
              </div>
            </SettingsGroup>
            {!ownsRoom && <p className="mt-2 px-1 text-[12px] text-ink-secondary">{t("manageMembers.ownOnly")}</p>}
          </div>
          {!memberIds.length && <p className="px-1 text-[12px] text-ink-secondary">{t("manageMembers.needOne")}</p>}
          {saveError && (
            <p role="alert" className="px-1 text-[12.5px] text-danger">
              {saveError}
            </p>
          )}
        </div>
        <div className={DIALOG.footer}>
          <button type="button" onClick={onClose} className={PILL}>
            {t("common.cancel")}
          </button>
          <button type="button" onClick={save} disabled={!memberIds.length} className={PRIMARY_PILL}>
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
