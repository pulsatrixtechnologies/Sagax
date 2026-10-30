// Auto model (docs/plans/2026-10-08-auto-model.md): what a bot on Auto would
// run this person's next turn on, from GET /api/bots/<id>/auto-model.
import { useEffect, useState } from "react";

import { api } from "@/state/store";
import type { AutoModelRecord, AutoModelPreview } from "../../shared/auto-model";

/** The dispatch candidates and configured recovery choices, including for a
 * pinned bot. Never carry a previous bot's preview into a new scope. */
export function useAutoModelStatus(botId: string, threadId: string | undefined, enabled: boolean, revision?: string): AutoModelPreview | null {
  const scope = JSON.stringify([botId, threadId, revision]);
  const [preview, setPreview] = useState<{ scope: string; status: AutoModelPreview } | null>(null);
  useEffect(() => {
    if (!enabled) {
      setPreview(null);
      return;
    }
    let live = true;
    const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
    api<AutoModelPreview>(`/api/bots/${encodeURIComponent(botId)}/auto-model${query}`)
      .then((answer) => { if (live) setPreview({ scope, status: answer }); })
      .catch(() => { if (live) setPreview(null); });
    return () => { live = false; };
  }, [botId, threadId, enabled, revision, scope]);
  return enabled && preview?.scope === scope ? preview.status : null;
}

export function useAutoModelPreview(botId: string, threadId: string | undefined, enabled: boolean): AutoModelRecord | null {
  const status = useAutoModelStatus(botId, threadId, enabled);
  return status?.auto ? status.pick : null;
}
