// The background brief queue. No connected app: the queue stays empty and
// the screen says so. A pass only reads. A server without the route yet (an
// older one) says it comes with the server update, never an error.
// 2026-10-29: the brief runs on its own each day at the time the person
// picks (on by default for a Primary Bot), and arrives in the conversation
// and through "Me joindre". The person turns it off or moves its time here.
import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { localTimeZone } from "@/lib/reach-me";
import { routeMissingOnServer } from "@/lib/server-route";
import { Switch } from "../SettingsPrimitives";
import { useBotEditor } from "./BotEditorContext";
import { PaneSection } from "./PaneSection";
import { readableError } from "@/lib/plain-error";

interface BriefView {
  apps?: number;
  notice?: "no_apps";
  settings?: { enabled?: boolean; at?: string; timeZone?: string };
  suggestions?: Array<{ id: string; text: string; status: string }>;
  error?: string;
}

/** The settings a change sends: the time zone is this device's. */
export function briefSchedulePatch(change: { enabled?: boolean; at?: string }): { enabled?: boolean; at?: string; timeZone: string } {
  return { ...change, timeZone: localTimeZone() };
}

export function briefQueueText(view: BriefView | null): string | null {
  if (!view) return null;
  if (view.notice === "no_apps" || view.apps === 0) return t("brief.noApps");
  return null;
}

export function BackgroundBriefCard({ botId }: { botId: string }) {
  const { request: api } = useBotEditor();
  const [view, setView] = useState<BriefView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsUpdate, setNeedsUpdate] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api(`/api/bots/${botId}/background-brief`) as BriefView;
      setView(next);
      setError(null);
      setNeedsUpdate(false);
    } catch (err) {
      if (routeMissingOnServer(err)) { setNeedsUpdate(true); return; }
      setError(readableError(err));
    }
  }, [api, botId]);

  useEffect(() => { void load(); }, [load]);

  const read = async () => {
    setError(null);
    try {
      await api(`/api/bots/${botId}/background-brief/pass`, { method: "POST", body: JSON.stringify({ costUsd: 0 }) });
      await load();
    } catch (err) {
      setError(readableError(err));
    }
  };

  const saveSchedule = async (change: { enabled?: boolean; at?: string }) => {
    setError(null);
    try {
      await api(`/api/bots/${botId}/background-brief`, { method: "PUT", body: JSON.stringify(briefSchedulePatch(change)) });
      await load();
    } catch (err) {
      setError(readableError(err));
    }
  };

  const note = briefQueueText(view);
  const enabled = view?.settings?.enabled === true;
  const at = view?.settings?.at ?? "08:00";
  const pending = (view?.suggestions ?? []).filter((item) => item.status === "pending");
  if (needsUpdate) {
    return (
      <PaneSection title={t("brief.title")}>
        <p data-brief-needs-update="" className="text-[12.5px] text-ink-secondary">{t("serverRoute.needsUpdate")}</p>
      </PaneSection>
    );
  }
  return (
    <PaneSection title={t("brief.title")}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink">
        <Switch checked={enabled} aria-label={t("brief.daily")} onClick={() => void saveSchedule({ enabled: !enabled })} />
        <span>{t("brief.daily")}</span>
        <input
          type="time"
          aria-label={t("brief.at")}
          value={at}
          disabled={!enabled}
          onChange={(event) => { if (event.target.value) void saveSchedule({ at: event.target.value }); }}
          className="rounded-lg border border-hairline/40 bg-inset px-2 py-1 text-[12.5px] text-ink disabled:opacity-50"
        />
      </div>
      {enabled && <p className="mb-2 text-[12px] text-ink-secondary">{t("brief.delivery")}</p>}
      {note && <p role="status" data-brief-empty="">{note}</p>}
      {!note && pending.length === 0 && <p className="text-[12.5px] text-ink-secondary">{t("brief.queueEmpty")}</p>}
      {pending.length > 0 && (
        <ul className="flex flex-col gap-1 text-[12.5px] text-ink">
          {pending.map((item) => <li key={item.id}>{item.text}</li>)}
        </ul>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      <button type="button" onClick={() => void read()} className="mt-2 text-[12.5px] text-ink-secondary underline">{t("brief.read")}</button>
    </PaneSection>
  );
}
