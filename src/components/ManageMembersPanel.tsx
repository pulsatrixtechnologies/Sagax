// Edit an existing room's roster: the same picker "New Room" uses, opened
// from the member mauses in the room header and pre-ticked with who is
// already in. Membership is the only thing this touches — the transcript
// keeps every message a departing bot already sent.
import { viewerActorId } from "@/lib/viewer";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { track } from "@/lib/analytics";
import { useStore, type Group } from "@/state/store";
import { BotPickerList } from "./BotPickerList";
import { nextMemberIds } from "@/lib/room-members";
import { X } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { PILL, PRIMARY_PILL, SettingsGroup, DIALOG } from "./SettingsPrimitives";

export function ManageMembersPanel({
  group,
  onClose,
  triggerRef,
}: {
  group: Group;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { state, dispatch } = useStore();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(group.memberIds));
  const [saveError, setSaveError] = useState<string | null>(null);
  const openedMemberIds = useRef([...group.memberIds]);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Archived bots stay listed while they are still members — otherwise a
  // room could keep a member you have no way to remove.
  const bots = useMemo(
    () => state.bots.filter((b) => !b.hidden || group.memberIds.includes(b.id)),
    [state.bots, group.memberIds],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = () =>
      [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
        (element) => !element.hasAttribute("hidden"),
      );
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) return event.preventDefault();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKey);
    return () => {
      dialog.removeEventListener("keydown", onKey);
      triggerRef.current?.focus();
    };
  }, [onClose, triggerRef]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const memberIds = nextMemberIds(
    group.memberIds,
    picked,
    bots.map((b) => b.id),
  );
  const changed = memberIds.length !== group.memberIds.length || memberIds.some((id, i) => id !== group.memberIds[i]);

  const save = () => {
    if (!memberIds.length) return;
    const opened = openedMemberIds.current;
    const rosterChanged =
      opened.length !== group.memberIds.length || opened.some((id, index) => id !== group.memberIds[index]);
    if (rosterChanged) {
      setSaveError(t("manageMembers.changed"));
      return;
    }
    if (changed) {
      dispatch({ type: "patchGroup", groupId: group.id, patch: { memberIds } });
      track("room_members_changed", {
        members: memberIds.length,
        added: memberIds.filter((id) => !group.memberIds.includes(id)).length,
        removed: group.memberIds.filter((id) => !memberIds.includes(id)).length,
      });
    }
    onClose();
  };

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
          <SettingsGroup
            groupId="group-members"
            title={t("manageMembers.bots")}
            accessory={bots.length > 0 && <span className="ml-auto text-[12.5px] tabular-nums text-ink-secondary">{memberIds.length}/{bots.length}</span>}
          >
            <div className="px-1.5">
              <BotPickerList bots={bots} viewerId={viewerActorId(state.config)} picked={picked} onToggle={toggle} emptyHint={t("manageMembers.empty")} />
            </div>
          </SettingsGroup>
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
            {memberIds.length ? t(memberIds.length === 1 ? "manageMembers.saveOne" : "manageMembers.saveMany", { count: memberIds.length }) : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
