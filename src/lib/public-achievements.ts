// Colleagues' public achievement cards (GET /api/achievements/public).
// The server shares a card unless the person stored public false, and it
// never sends locked ids. A missing card and an explicit private one both
// stay hidden here.
import { useEffect, useSyncExternalStore } from "react";
import type { AchievementUnlock, PublicAchievementCard } from "../../shared/achievements";
import { api } from "@/state/store";

type Cache = Record<string, PublicAchievementCard | null>;

let cache: Cache = {};
const listeners = new Set<() => void>();
let queued = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

/** Test seam: start over, or plant cards without a server. */
export function resetPublicAchievementsForTests(next: Cache = {}): void {
  cache = next;
  queued = new Set();
  if (timer) clearTimeout(timer);
  timer = null;
  emit();
}

function cleanUnlock(value: unknown): AchievementUnlock | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<AchievementUnlock>;
  if (typeof item.id !== "string" || typeof item.points !== "number" || typeof item.unlockedAt !== "number") return null;
  return { id: item.id, points: item.points, unlockedAt: item.unlockedAt };
}

/** A public card, or null when the payload is not one. An older server that
 * only sent points and level still counts: the list is then empty. */
export function cleanPublicCard(value: unknown): PublicAchievementCard | null {
  if (!value || typeof value !== "object") return null;
  const card = value as Partial<PublicAchievementCard>;
  if (typeof card.points !== "number" || typeof card.level !== "number") return null;
  const unlocked = Array.isArray(card.unlocked) ? card.unlocked.flatMap((item) => {
    const row = cleanUnlock(item);
    return row ? [row] : [];
  }) : [];
  return {
    points: card.points,
    level: card.level,
    ...(typeof card.title === "string" && card.title ? { title: card.title } : {}),
    unlocked,
  };
}

function read(id: string | null): PublicAchievementCard | null {
  if (!id) return null;
  return cache[id] ?? null;
}

function schedule(id: string): void {
  if (Object.hasOwn(cache, id) || queued.has(id)) return;
  queued.add(id);
  if (timer) return;
  timer = setTimeout(() => void flush(), 30);
}

async function flush(): Promise<void> {
  timer = null;
  const ids = [...queued];
  queued = new Set();
  if (!ids.length) return;
  try {
    const body = await api<{ points?: Record<string, unknown> }>(`/api/achievements/public?ids=${ids.map(encodeURIComponent).join(",")}`);
    for (const id of ids) cache[id] = cleanPublicCard(body.points?.[id]);
  } catch {
    for (const id of ids) if (!Object.hasOwn(cache, id)) cache[id] = null;
  }
  emit();
}

/** The person's public card, or null while it is loading or they keep it private. */
export function usePublicAchievement(personId: string | null | undefined): PublicAchievementCard | null {
  const id = personId?.trim() || null;
  const card = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => read(id),
    () => read(id),
  );
  useEffect(() => {
    if (id) schedule(id);
  }, [id]);
  return card;
}
