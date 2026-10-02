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
/** Whose lists the cache holds. On an organization server a list is the
 * signed-in person's own (their skills, plugins and connector prompts), so
 * another person in the same tab never gets it. */
let cachedViewer: string | null = null;

function forViewer(viewerId: string | null | undefined): void {
  const viewer = viewerId ?? null;
  if (viewer === cachedViewer) return;
  cache.clear();
  inflight.clear();
  cachedViewer = viewer;
}

export function harnessCommandsPath(botId: string, threadId: string | undefined, refresh = false, groupId?: string): string {
  const params = new URLSearchParams();
  if (threadId) params.set("threadId", threadId);
  if (groupId) params.set("groupId", groupId);
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
  options: { refresh?: boolean; now?: number; groupId?: string; viewerId?: string | null } = {},
): Promise<HarnessCommandsAnswer> {
  forViewer(options.viewerId);
  const key = `${options.viewerId ?? ""}:${botId}:${threadId ?? ""}:${options.groupId ?? ""}`;
  const now = options.now ?? Date.now();
  const cached = cache.get(key);
  if (!options.refresh && cached && now - cached.at < TTL_MS) return Promise.resolve(cached.answer);
  const running = inflight.get(key);
  if (running && !options.refresh) return running;
  const work = fetcher(harnessCommandsPath(botId, threadId, options.refresh, options.groupId))
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

/** Forget every cached list (a sign-in, a sign-out, tests). */
export function resetHarnessCommandCache(): void {
  cache.clear();
  inflight.clear();
  cachedViewer = null;
}

/** The engine commands of a 1:1 conversation, loaded once `wanted` turns
 * true (the person typed "/"). */
export function useHarnessCommands(
  fetcher: Fetcher,
  botId: string | undefined,
  threadId: string | undefined,
  wanted: boolean,
  viewerId?: string | null,
): { answer: HarnessCommandsAnswer | null; loading: boolean; refresh: () => void } {
  const [answer, setAnswer] = useState<HarnessCommandsAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    setAnswer(null);
  }, [botId, threadId, viewerId]);
  useEffect(() => {
    if (!botId || (!wanted && !refreshing)) return;
    let live = true;
    setLoading(true);
    void loadHarnessCommands(fetcher, botId, threadId, { refresh: refreshing, viewerId }).then((next) => {
      if (!live) return;
      setAnswer(next);
      setLoading(false);
      setRefreshing(false);
    });
    return () => {
      live = false;
      setLoading(false);
    };
  }, [fetcher, botId, threadId, wanted, refreshing, generation, viewerId]);
  const refresh = useCallback(() => {
    setRefreshing(true);
    setGeneration((value) => value + 1);
  }, []);
  return { answer, loading, refresh };
}

export interface GroupHarnessCommands {
  botId: string;
  answer: HarnessCommandsAnswer;
}

/** A group's engine commands, per member in `botIds` (the targets of the
 * "/" being typed), loaded once `wanted` turns true. Each list is the
 * server's for this person (their own subscription, on an organization
 * server), cached per bot and viewer. */
export function useGroupHarnessCommands(
  fetcher: Fetcher,
  botIds: readonly string[],
  groupId: string | undefined,
  threadId: string | undefined,
  wanted: boolean,
  viewerId?: string | null,
): { lists: GroupHarnessCommands[]; loading: boolean; refresh: () => void } {
  const [lists, setLists] = useState<GroupHarnessCommands[]>([]);
  const [loading, setLoading] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const ids = botIds.join(",");
  useEffect(() => {
    setLists([]);
  }, [groupId, threadId, viewerId]);
  useEffect(() => {
    const wantedIds = ids ? ids.split(",") : [];
    if (!groupId || !wantedIds.length || (!wanted && !refreshing)) return;
    let live = true;
    setLoading(true);
    void Promise.all(wantedIds.map((botId) =>
      loadHarnessCommands(fetcher, botId, threadId, { refresh: refreshing, groupId, viewerId }).then((answer) => ({ botId, answer })),
    )).then((next) => {
      if (!live) return;
      setLists(next);
      setLoading(false);
      setRefreshing(false);
    });
    return () => {
      live = false;
      setLoading(false);
    };
  }, [fetcher, ids, groupId, threadId, wanted, refreshing, generation, viewerId]);
  const refresh = useCallback(() => {
    setRefreshing(true);
    setGeneration((value) => value + 1);
  }, []);
  return { lists, loading, refresh };
}
