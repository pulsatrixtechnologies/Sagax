// Settings > Appearance: what this person hid from their sidebar, with Show
// for each, and whether a new message brings a hidden entry back.
import { Eye } from "lucide-react";

import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { useOrgPeople } from "@/lib/perspicax-org";
import { setUnhideOnMessage, showInSidebar, useSidebarHidden } from "@/lib/sidebar-hidden";
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
      <SettingRow scope="me" title={t("settings.sidebarHidden.title")} subtitle={rows.length ? t("sidebar.hidden.title", { count: rows.length }) : t("settings.sidebarHidden.none")}>
        <span />
      </SettingRow>
      {rows.length > 0 && (
        <ul data-settings-hidden className="mx-3.5 mb-2 overflow-hidden rounded-lg border border-hairline-weak">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2 border-b border-hairline-weak px-3 py-1.5 text-[13px] last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-ink">{row.name}</span>
              <span className="shrink-0 text-[12px] text-ink-secondary">{t(`settings.sidebarHidden.kind.${row.kind}`)}</span>
              <button type="button" onClick={() => showInSidebar(row.key)} aria-label={t("sidebar.hidden.showNamed", { name: row.name })} className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-accent hover:bg-hover">
                <Eye size={12} aria-hidden />
                {t("sidebar.hidden.show")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <SettingRow scope="me" title={t("settings.sidebarHidden.unhidePeople")} subtitle={t("settings.sidebarHidden.unhidePeopleHint")}>
        <Switch checked={hidden.unhideOnMessage.people} aria-label={t("settings.sidebarHidden.unhidePeople")} onClick={() => setUnhideOnMessage("people", !hidden.unhideOnMessage.people)} />
      </SettingRow>
      <SettingRow scope="me" title={t("settings.sidebarHidden.unhideBots")} subtitle={t("settings.sidebarHidden.unhideBotsHint")}>
        <Switch checked={hidden.unhideOnMessage.bots} aria-label={t("settings.sidebarHidden.unhideBots")} onClick={() => setUnhideOnMessage("bots", !hidden.unhideOnMessage.bots)} />
      </SettingRow>
    </>
  );
}
