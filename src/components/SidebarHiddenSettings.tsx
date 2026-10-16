// Settings > Appearance > Sidebar: how many entries this person hid from
// their sidebar, and whether a new message brings a hidden entry back. The
// list itself, with Show for each, is the "Hidden" row at the foot of the
// sidebar (JC, 2026-10-14: one place for it, where the entries went).
// 0.5.6: compact rows, as Grok Bot's pages; the count is the row's value.
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { useOrgPeople } from "@/lib/perspicax-org";
import { setUnhideOnMessage, useSidebarHidden } from "@/lib/sidebar-hidden";
import { viewerActorId } from "@/lib/viewer";
import { hiddenSidebarRows } from "@/lib/sidebar-hidden-entries";
import { CompactRow, DescribedRow, Switch } from "./SettingsPrimitives";

export function SidebarHiddenSettings() {
  const { state } = useStore();
  const hidden = useSidebarHidden();
  const people = useOrgPeople();
  const rows = hiddenSidebarRows(hidden.items, { bots: state.bots, groups: state.groups, viewerId: viewerActorId(state.config), people });
  return (
    <>
      {/* The grey line says where the list is: the foot of the sidebar. */}
      <DescribedRow
        label={t("settings.sidebarHidden.title")}
        description={rows.length ? t("settings.sidebarHidden.whereHint") : t("settings.sidebarHidden.none")}
        rowId="sidebarHidden"
      >
        {rows.length > 0 && <span className="text-[13px] tabular-nums text-ink-secondary">{t("sidebar.hidden.title", { count: rows.length })}</span>}
      </DescribedRow>
      <CompactRow label={t("settings.sidebarHidden.unhidePeople")} rowId="unhidePeople">
        <Switch checked={hidden.unhideOnMessage.people} aria-label={t("settings.sidebarHidden.unhidePeople")} onClick={() => setUnhideOnMessage("people", !hidden.unhideOnMessage.people)} />
      </CompactRow>
      <CompactRow label={t("settings.sidebarHidden.unhideBots")} rowId="unhideBots">
        <Switch checked={hidden.unhideOnMessage.bots} aria-label={t("settings.sidebarHidden.unhideBots")} onClick={() => setUnhideOnMessage("bots", !hidden.unhideOnMessage.bots)} />
      </CompactRow>
    </>
  );
}
