// Auto model (docs/plans/2026-10-08-auto-model.md): what a bot on Auto would
// run this person's next turn on, from GET /api/bots/<id>/auto-model.
import { useEffect, useState } from "react";

import { api } from "@/state/store";
import type { AutoModelRecord } from "../../shared/auto-model";

/** What Auto would run this person's next turn with the bot on. Null while
 * loading, when the bot is pinned, or when the server cannot say. */
export function useAutoModelPreview(botId: string, threadId: string | undefined, enabled: boolean): AutoModelRecord | null {
  const [preview, setPreview] = useState<AutoModelRecord | null>(null);
  useEffect(() => {
    if (!enabled) {
      setPreview(null);
      return;
    }
    let live = true;
    const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
    api<{ auto: boolean; pick?: AutoModelRecord | null }>(`/api/bots/${encodeURIComponent(botId)}/auto-model${query}`)
      .then((answer) => { if (live) setPreview(answer.auto && answer.pick ? answer.pick : null); })
      .catch(() => { if (live) setPreview(null); });
    return () => { live = false; };
  }, [botId, threadId, enabled]);
  return preview;
}
