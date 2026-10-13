// Where a routine runs, said where it is scheduled: on this computer only
// while the app is open (24/7 means running Sagax on a VPS or an
// organization server); on any other server, a browser or companion mode,
// while that server runs.
import { t } from "@/lib/i18n";
import { localDesktopPage } from "./onboarding/WelcomeGate";

export type SchedulePlace = { kind: "server" } | { kind: "local" };

/** Which note fits: This computer's, or any other server's. */
export function schedulePlace({ local }: { local: boolean }): SchedulePlace {
  return local ? { kind: "local" } : { kind: "server" };
}

export function RoutineScheduleNote() {
  const local = localDesktopPage() && window.ogb?.remoteClient?.active !== true;
  const place = schedulePlace({ local });
  return <p data-routine-schedule-note={place.kind} className="text-[11px] leading-relaxed text-ink-secondary">
    {place.kind === "server"
      ? t("routines.scheduleNote.server")
      : "Runs while Sagax is open on this computer — it cannot wake a sleeping Mac. A run missed by less than 12 hours still happens when the app is back; for 24/7, run Sagax on a VPS."}
  </p>;
}
