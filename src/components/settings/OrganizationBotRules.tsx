// How the organization's bots work (0.5.6, JC: Grok Bot's rows): group turns
// and MCP calls, one row each, label and a
// short grey line at the left, the control at the right. They came from
// General > Advanced (2026-10-15) and set the installation, so they show to
// those who may edit it, in Advanced mode. A desktop with no server shows
// them in General > Advanced (Organization is hidden there): same rows, same
// card ids, so a deep link finds them on either page.
import { canEditConfig } from "@/lib/viewer";
import { useStore } from "@/state/store";
import { McpCallTimeoutSettings } from "../McpCallTimeoutSettings";
import { RoomTurnTimeoutSettings } from "../RoomTurnTimeoutSettings";

/** The rows, for a group's card. Nothing for a viewer who cannot edit the
 * installation. "Routines in the conversation" is gone (2026-10-22, JC): a
 * routine always runs in the background and posts only what needs the
 * person (server/routine-report.ts). */
export function OrganizationBotRows() {
  const { state } = useStore();
  if (!canEditConfig(state.config)) return null;
  return (
    <>
      <RoomTurnTimeoutSettings />
      <McpCallTimeoutSettings />
    </>
  );
}
