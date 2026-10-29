import type { WireMessage } from "../../shared/wire";
import { t } from "@/lib/i18n";

export type RosterNote = NonNullable<WireMessage["roster"]>;

/** A change to a group's people (#1480): one neutral centred line, never a
 * chat bubble, the way a nudge is drawn. */
export function RosterLine({ note }: { note: RosterNote }) {
  return (
    <div data-roster-line={note.event} className="flex justify-center px-6">
      <p className="max-w-full text-center text-[12.5px] leading-5 text-ink-secondary">
        {t("room.roster.left", { name: note.name })}
      </p>
    </div>
  );
}
