// Settings > Appearance: how many entries this person hid from their
// sidebar, and whether a new message brings a hidden entry back. The list
// itself, with Show for each, is the "Hidden" row at the foot of the
// sidebar (JC, 2026-10-14: one place for it, where the entries went).
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { useOrgPeople } from "@/lib/perspicax-org";
import { setUnhideOnMessage, useSidebarHidden } from "@/lib/sidebar-hidden";
import { viewerActorId } from "@/lib/viewer";
import { hiddenSidebarRows } from "@/lib/sidebar-hidden-entries";
import { SettingRow, Switch } from "./SettingsPrimitives";

export function SidebarHiddenSettings() {
  const { state } = useStore();
  const hidden = useSidebarHidden();
  const people = useOrgPeople();
  const rows = hiddenSidebarRows(hidden.items, { bots: state.bots, groups: state.groups, viewerId: viewerActorId(state.config), people });
  return (
    <>
      <SettingRow title={t("settings.sidebarHidden.title")} subtitle={rows.length ? `${t("sidebar.hidden.title", { count: rows.length })}. ${t("settings.sidebarHidden.whereHint")}` : t("settings.sidebarHidden.none")}>
        <span />
      </SettingRow>
      <SettingRow title={t("settings.sidebarHidden.unhidePeople")} subtitle={t("settings.sidebarHidden.unhidePeopleHint")}>
        <Switch checked={hidden.unhideOnMessage.people} aria-label={t("settings.sidebarHidden.unhidePeople")} onClick={() => setUnhideOnMessage("people", !hidden.unhideOnMessage.people)} />
      </SettingRow>
      <SettingRow title={t("settings.sidebarHidden.unhideBots")} subtitle={t("settings.sidebarHidden.unhideBotsHint")}>
        <Switch checked={hidden.unhideOnMessage.bots} aria-label={t("settings.sidebarHidden.unhideBots")} onClick={() => setUnhideOnMessage("bots", !hidden.unhideOnMessage.bots)} />
      </SettingRow>
    </>
  );
}
