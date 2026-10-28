// The background brief queue. No connected app: the queue stays empty and
// the screen says so. A pass only reads. A server without the route yet (an
// older one) says it comes with the server update, never an error.
import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { routeMissingOnServer } from "@/lib/server-route";
import { useBotEditor } from "./BotEditorContext";
import { PaneSection } from "./PaneSection";

interface BriefView {
  apps?: number;
  notice?: "no_apps";
  suggestions?: Array<{ id: string; text: string; status: string }>;
  error?: string;
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
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api, botId]);

  useEffect(() => { void load(); }, [load]);

  const read = async () => {
    setError(null);
    try {
      await api(`/api/bots/${botId}/background-brief/pass`, { method: "POST", body: JSON.stringify({ costUsd: 0 }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const note = briefQueueText(view);
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
