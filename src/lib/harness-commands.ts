// The engine's own slash commands for the composer's "/" menu, read from
// GET /api/bots/:id/harness-commands (server/harness-commands.ts) the first
// time a person types "/" in a conversation, then kept a few minutes.
import { useCallback, useEffect, useState } from "react";

import type { HarnessCommand, HarnessCommandList } from "../../shared/harness-commands";

export interface HarnessCommandsAnswer {
  available: boolean;
  engine?: HarnessCommandList["engine"];
  commands: HarnessCommand[];
  reason?: string;
}

type Fetcher = (path: string) => Promise<HarnessCommandsAnswer>;

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; answer: HarnessCommandsAnswer }>();
const inflight = new Map<string, Promise<HarnessCommandsAnswer>>();

export function harnessCommandsPath(botId: string, threadId: string | undefined, refresh = false): string {
  const params = new URLSearchParams();
  if (threadId) params.set("threadId", threadId);
  if (refresh) params.set("refresh", "1");
  const query = params.toString();
  return `/api/bots/${encodeURIComponent(botId)}/harness-commands${query ? `?${query}` : ""}`;
}

/** Reads (or reuses) a conversation's engine commands. A failed read is an
 * empty list: the "/" menu still shows Sagax's own commands. */
export function loadHarnessCommands(
  fetcher: Fetcher,
  botId: string,
  threadId: string | undefined,
  options: { refresh?: boolean; now?: number } = {},
): Promise<HarnessCommandsAnswer> {
  const key = `${botId}:${threadId ?? ""}`;
  const now = options.now ?? Date.now();
  const cached = cache.get(key);
  if (!options.refresh && cached && now - cached.at < TTL_MS) return Promise.resolve(cached.answer);
  const running = inflight.get(key);
  if (running && !options.refresh) return running;
  const work = fetcher(harnessCommandsPath(botId, threadId, options.refresh))
    .then((answer) => {
      const clean: HarnessCommandsAnswer = {
        available: answer?.available === true,
        ...(answer?.engine ? { engine: answer.engine } : {}),
        commands: Array.isArray(answer?.commands) ? answer.commands : [],
        ...(typeof answer?.reason === "string" ? { reason: answer.reason } : {}),
      };
      cache.set(key, { at: now, answer: clean });
      return clean;
    })
    .catch((): HarnessCommandsAnswer => cached?.answer ?? { available: false, commands: [], reason: "unavailable" })
    .finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}

/** Test seam: forget every cached list. */
export function resetHarnessCommandCache(): void {
  cache.clear();
  inflight.clear();
}

/** The engine commands of a 1:1 conversation, loaded once `wanted` turns
 * true (the person typed "/"). */
export function useHarnessCommands(
  fetcher: Fetcher,
  botId: string | undefined,
  threadId: string | undefined,
  wanted: boolean,
): { answer: HarnessCommandsAnswer | null; loading: boolean; refresh: () => void } {
  const [answer, setAnswer] = useState<HarnessCommandsAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    setAnswer(null);
  }, [botId, threadId]);
  useEffect(() => {
    if (!botId || (!wanted && !refreshing)) return;
    let live = true;
    setLoading(true);
    void loadHarnessCommands(fetcher, botId, threadId, { refresh: refreshing }).then((next) => {
      if (!live) return;
      setAnswer(next);
      setLoading(false);
      setRefreshing(false);
    });
    return () => {
      live = false;
      setLoading(false);
    };
  }, [fetcher, botId, threadId, wanted, refreshing, generation]);
  const refresh = useCallback(() => {
    setRefreshing(true);
    setGeneration((value) => value + 1);
  }, []);
  return { answer, loading, refresh };
}
