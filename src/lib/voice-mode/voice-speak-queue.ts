// Spoken output on a live call: one voice at a time. Never talk over the
// person. Never overlap two bot lines. Current reply, then topic results
// in arrival order, then a queued-notice.

export type SpeakPriority = "user-reply" | "topic-result" | "queued-notice";

export interface SpeakItem {
  id: string;
  priority: SpeakPriority;
  at: number;
}

const RANK: Record<SpeakPriority, number> = {
  "user-reply": 0,
  "topic-result": 1,
  "queued-notice": 2,
};

export function nextSpeakSlot(input: {
  userSpeaking: boolean;
  botSpeaking: boolean;
  waiting: SpeakItem[];
}): { action: "hold" } | { action: "speak"; id: string } {
  if (input.userSpeaking || input.botSpeaking) return { action: "hold" };
  const ordered = [...input.waiting].sort((a, b) => {
    const rank = RANK[a.priority] - RANK[b.priority];
    if (rank !== 0) return rank;
    if (a.at !== b.at) return a.at - b.at;
    return a.id.localeCompare(b.id);
  });
  const first = ordered[0];
  return first ? { action: "speak", id: first.id } : { action: "hold" };
}
