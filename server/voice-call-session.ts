// Which threads are on a live voice call, server side
// (docs/voice-mode-xai.md, "The bot knows it is on the phone").
//
// A call used to be known only from the mark on each message the page sent
// (Message.voiceCall). Any path that lost the mark (a queued line steered
// later, words typed into the composer while the call ran, a retry) reached
// the bot as plain chat, and it answered with tables. The page now says
// when its call starts and ends (POST /api/bots/<id>/voice/call), and every
// send to that thread while the call lasts is a call turn, mark or not.
//
// The state is memory only: a restart ends every call, and a call the page
// never closed (a crash, a lost network) expires after VOICE_CALL_IDLE_MS
// without a turn. A call's tools stay stable through it: Perspicax keeps
// the call's tokens between turns (server/perspicax-mcp.ts keepWarm), and
// every change of a call turn's MCP set is logged (noteMcp). The call's
// start and each heartbeat also count as use of the person's server
// environment (UserSandboxManager.markUsed), so its idle stop never takes
// it away mid-call.
import type { VoiceCallMeta } from "./voice-call-prompt.ts";

/** A call with no turn and no keep-alive for this long has ended. */
export const VOICE_CALL_IDLE_MS = 20 * 60_000;
/** No call lasts longer than this without being started again. */
export const VOICE_CALL_MAX_MS = 6 * 60 * 60_000;

interface CallRecord {
  callId: string;
  language?: string;
  startedAt: number;
  lastAt: number;
  /** utterance ids already accepted on this call (exactly once) */
  utterances: Map<string, string>;
  /** the MCP servers the call's last turn mounted (names) */
  mcp?: string[];
}

export class VoiceCallSessions {
  private readonly calls = new Map<string, CallRecord>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** The page started (or keeps alive) a call on this thread. */
  start(threadId: string, callId: string, language?: string): void {
    const at = this.now();
    const existing = this.calls.get(threadId);
    if (existing && existing.callId === callId) {
      existing.lastAt = at;
      if (language !== undefined) existing.language = language === "auto" ? undefined : language;
      return;
    }
    this.calls.set(threadId, {
      callId,
      ...(language && language !== "auto" ? { language } : {}),
      startedAt: at,
      lastAt: at,
      utterances: new Map(),
    });
  }

  /** The page hung up. Ownership-safe: an old call's end never ends a newer one. */
  end(threadId: string, callId: string): boolean {
    const existing = this.calls.get(threadId);
    if (!existing || existing.callId !== callId) return false;
    this.calls.delete(threadId);
    return true;
  }

  private live(threadId: string): CallRecord | undefined {
    const record = this.calls.get(threadId);
    if (!record) return undefined;
    const at = this.now();
    if (at - record.lastAt > VOICE_CALL_IDLE_MS || at - record.startedAt > VOICE_CALL_MAX_MS) {
      this.calls.delete(threadId);
      return undefined;
    }
    return record;
  }

  /** The thread's live call, if any. */
  active(threadId: string): { callId: string; language?: string } | undefined {
    const record = this.live(threadId);
    return record ? { callId: record.callId, ...(record.language ? { language: record.language } : {}) } : undefined;
  }

  /** The mark a send to this thread carries: the page's own mark (refreshing
   * the call it names), else the live call's, else none. */
  markFor(threadId: string, sent: VoiceCallMeta | undefined): VoiceCallMeta | undefined {
    const record = this.live(threadId);
    if (sent) {
      if (record && record.callId === sent.callId) record.lastAt = this.now();
      return sent;
    }
    if (!record) return undefined;
    record.lastAt = this.now();
    return { callId: record.callId, ...(record.language ? { language: record.language } : {}) };
  }

  /** Exactly once per spoken utterance: the first send of an utterance id
   * claims it (with the send's id); a later one learns the first's. */
  claimUtterance(threadId: string, callId: string, utteranceId: string, sendId: string): { first: true } | { first: false; sendId: string } {
    const record = this.live(threadId);
    if (!record || record.callId !== callId) return { first: true };
    const known = record.utterances.get(utteranceId);
    if (known !== undefined) return { first: false, sendId: known };
    record.utterances.set(utteranceId, sendId);
    // bounded: a call says a few hundred things at most
    if (record.utterances.size > 2_000) record.utterances.delete(record.utterances.keys().next().value!);
    return { first: true };
  }

  /** The MCP servers a call turn mounts, against the call's previous
   * turn: what was added and what went missing, for the log. A server is
   * never put back here: one that left was removed or refused on purpose
   * (a person, a policy); the call's flapping tools came from per-turn
   * token exchanges, which keep their tokens through the call instead
   * (server/perspicax-mcp.ts keepWarm). */
  noteMcp(threadId: string, names: readonly string[]): { added: string[]; removed: string[] } {
    const record = this.live(threadId);
    if (!record) return { added: [], removed: [] };
    const before = record.mcp;
    record.mcp = [...names];
    if (!before) return { added: [], removed: [] };
    return { added: names.filter((name) => !before.includes(name)), removed: before.filter((name) => !names.includes(name)) };
  }

  /** Threads with a live call (tests, health). */
  size(): number {
    for (const threadId of this.calls.keys()) this.live(threadId);
    return this.calls.size;
  }
}
