// One meeting the bot attends as a notetaker, from opening the link to
// leaving it: a small state machine over the bot's own browser. Pure of the
// app: the browser, the transcription and the clock come in as deps, so the
// whole path is tested with fakes (meeting-session.test.ts).
//
// The rule it exists for: nothing is recorded before the consent
// announcement is visible in the meeting chat. When the announcement cannot
// be posted and seen, the session leaves without recording (fail closed).
import type { MeetingRequestCardData, MeetingStatus } from "../../shared/meeting-request.ts";
import {
  CAPTURE_HOOK_SCRIPT,
  MEETING_CHAT_OPEN_SCRIPT,
  MEETING_CHAT_READ_SCRIPT,
  MEETING_DISCARD_SCRIPT,
  MEETING_DRAIN_SCRIPT,
  MEETING_LEAVING_TEXT,
  MEETING_LEAVE_MARK_SCRIPT,
  MEETING_START_SCRIPT,
  MEETING_STATE_SCRIPT,
  MEETING_STOP_SCRIPT,
  chatPostedScript,
  chatTypeScript,
  chatObjects,
  classifyMeetPage,
  newChatLines,
  prepareJoinScript,
} from "./meet-scripts.ts";

export interface MeetingBrowser {
  open(url: string): Promise<void>;
  /** The script's JSON answer, or null when the page answered nothing usable. */
  eval(script: string, timeoutMs?: number): Promise<Record<string, unknown> | null>;
  /** A real (trusted) click on the first element matching the selector. */
  click(selector: string): Promise<boolean>;
  close(): Promise<void>;
}

export interface TranscriptLine {
  /** When the segment was recorded (page clock, ms). */
  at: number;
  text: string;
}

export interface MeetingSessionOptions {
  url: string;
  displayName: string;
  /** The bot's own name: a chat line naming it counts as an objection. */
  botName?: string;
  announcement: string;
  browser: MeetingBrowser;
  transcribe(audio: Uint8Array, mime: string): Promise<string>;
  update(patch: Partial<MeetingRequestCardData>): void;
  onLine?(line: TranscriptLine): void;
  now?(): number;
  sleep?(ms: number, signal: AbortSignal): Promise<void>;
  /** Hard stop for the whole meeting (3 hours). */
  maxMs?: number;
  /** How long a host may take to let the bot in (10 minutes). */
  admissionMs?: number;
  pollMs?: number;
  /** Drain the page's audio queue every this many ms while recording. */
  drainMs?: number;
  /** Post the announcement again this often (10 minutes), and whenever
   * more people are in the meeting than before. */
  announceEveryMs?: number;
}

export interface MeetingOutcome {
  status: Extract<MeetingStatus, "ended" | "failed" | "declined">;
  detail?: string;
  lines: TranscriptLine[];
  recorded: boolean;
  /** Why it ended when that matters to the card: a participant objected. */
  endReason?: "participant";
}

export const MEETING_MAX_MS = 3 * 60 * 60_000;
const ADMISSION_MS = 10 * 60_000;
const TAIL_LINES = 6;
/** Polls in a row that cannot read the page (or its chat) before the
 * meeting counts as over: the bot never records blind. */
export const MEETING_UNKNOWN_POLLS = 3;
const ANNOUNCE_EVERY_MS = 10 * 60_000;

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
    signal.addEventListener("abort", done, { once: true });
  });
}

function decodeChunk(value: unknown): { at: number; mime: string; audio: Uint8Array } | null {
  if (!value || typeof value !== "object") return null;
  const chunk = value as { at?: unknown; mime?: unknown; data?: unknown };
  if (typeof chunk.data !== "string" || !chunk.data || chunk.data.length > 8_000_000) return null;
  const mime = typeof chunk.mime === "string" && /^audio\/webm\b/.test(chunk.mime) ? "audio/webm" : typeof chunk.mime === "string" && /^audio\/ogg\b/.test(chunk.mime) ? "audio/ogg" : "audio/webm";
  const audio = new Uint8Array(Buffer.from(chunk.data, "base64"));
  if (audio.byteLength < 512) return null;
  return { at: typeof chunk.at === "number" ? chunk.at : Date.now(), mime, audio };
}

/** The chat lines a read answered, or null when it could not be read. */
function readLines(read: Record<string, unknown> | null): string[] | null {
  if (read?.ok !== true || !Array.isArray(read.lines)) return null;
  return read.lines.filter((line): line is string => typeof line === "string");
}

export class MeetingSession {
  private readonly opts: Required<Pick<MeetingSessionOptions, "maxMs" | "admissionMs" | "pollMs" | "drainMs" | "announceEveryMs">> & MeetingSessionOptions;
  private readonly leaving = new AbortController();
  private readonly lines: TranscriptLine[] = [];
  private recorded = false;
  /** What the bot itself wrote in the meeting chat: never an objection. */
  private readonly posted = new Set<string>();
  private transcriptionErrors = 0;

  constructor(options: MeetingSessionOptions) {
    this.opts = { maxMs: MEETING_MAX_MS, admissionMs: ADMISSION_MS, pollMs: 3_000, drainMs: 10_000, announceEveryMs: ANNOUNCE_EVERY_MS, ...options };
  }

  private now(): number { return this.opts.now?.() ?? Date.now(); }
  private sleep(ms: number): Promise<void> { return (this.opts.sleep ?? defaultSleep)(ms, this.leaving.signal); }
  private get leaveRequested(): boolean { return this.leaving.signal.aborted; }

  /** The person pressed Leave (or the server is stopping). */
  requestLeave(): void { this.leaving.abort(); }

  transcript(): TranscriptLine[] { return [...this.lines]; }

  async run(): Promise<MeetingOutcome> {
    const started = this.now();
    try {
      return await this.attend(started);
    } catch (error) {
      return this.finish({ status: "failed", detail: `The meeting browser stopped: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300) });
    } finally {
      await this.opts.browser.close().catch(() => undefined);
    }
  }

  private async attend(started: number): Promise<MeetingOutcome> {
    const { browser } = this.opts;
    this.opts.update({ status: "joining", startedAt: started });
    await browser.open(this.opts.url);
    const hook = await browser.eval(CAPTURE_HOOK_SCRIPT);
    if (hook?.installed !== true) return this.finish({ status: "failed", detail: "The meeting page did not load in the bot's browser." });

    let ready = false;
    for (let attempt = 0; attempt < 8 && !this.leaveRequested; attempt++) {
      const prepared = await browser.eval(prepareJoinScript(this.opts.displayName));
      if (prepared?.joinReady === true && prepared.nameFilled === true) { ready = true; break; }
      const page = classifyMeetPage((await browser.eval(MEETING_STATE_SCRIPT)) ?? {});
      if (page === "refused") return this.finish({ status: "failed", detail: "Google Meet refused this browser as a guest." });
      await this.sleep(2_000);
    }
    if (this.leaveRequested) return this.finish({ status: "ended", detail: "Left before joining." });
    if (!ready) return this.finish({ status: "failed", detail: "The guest join screen did not appear (the meeting may require a signed-in account)." });
    if (!await browser.click("[data-sagax-join]")) return this.finish({ status: "failed", detail: "The join button could not be pressed." });

    // Admission: wait in the lobby until a host lets the bot in.
    const admissionDeadline = this.now() + this.opts.admissionMs;
    let waitingShown = false;
    let unknown = 0;
    for (;;) {
      if (this.leaveRequested) return this.leave({ status: "ended", detail: "Left before being let in." });
      const signals = await browser.eval(MEETING_STATE_SCRIPT);
      if (!signals) {
        if (++unknown >= MEETING_UNKNOWN_POLLS) return this.leave({ status: "failed", detail: "The meeting page stopped answering." });
        await this.sleep(this.opts.pollMs);
        continue;
      }
      unknown = 0;
      const page = classifyMeetPage(signals);
      if (page === "in-meeting") break;
      if (page === "refused") return this.finish({ status: "declined", detail: "The meeting host did not let the bot in." });
      if (page === "ended") return this.finish({ status: "ended", detail: "The meeting ended before the bot was let in." });
      if (page === "waiting" && !waitingShown) { waitingShown = true; this.opts.update({ status: "waiting" }); }
      if (this.now() >= admissionDeadline) return this.leave({ status: "failed", detail: "Nobody let the bot in within 10 minutes." });
      await this.sleep(this.opts.pollMs);
    }

    // Consent first: the announcement must be visible in the meeting chat.
    this.opts.update({ status: "announcing" });
    // The chat before the announcement: anything said from here on, even
    // while the bot announces itself, can object.
    const before = readLines(await browser.eval(MEETING_CHAT_READ_SCRIPT));
    if (!before) return this.leave({ status: "failed", detail: "The meeting chat could not be read, so nothing was recorded." });
    if (!await this.announce()) {
      return this.leave({ status: "failed", detail: "The consent announcement could not be posted in the meeting chat, so nothing was recorded." });
    }
    const baseline = readLines(await browser.eval(MEETING_CHAT_READ_SCRIPT));
    if (!baseline) {
      return this.leave({ status: "failed", detail: "The meeting chat could not be read, so nothing was recorded." });
    }
    if (this.objects(newChatLines(before, baseline))) return this.leaveOnObjection();
    let chatSeen = baseline;
    const start = await browser.eval(MEETING_START_SCRIPT);
    if (start?.started !== true) return this.leave({ status: "failed", detail: "The audio of the meeting could not be captured." });
    this.recorded = true;
    this.opts.update({ status: "recording", recordingAt: this.now() });

    let lastDrain = this.now();
    let lastAnnounce = this.now();
    let people = 0;
    unknown = 0;
    let reason: string | undefined;
    for (;;) {
      if (this.leaveRequested) { reason = "Left at the person's request."; break; }
      if (this.now() - started >= this.opts.maxMs) { reason = "Left after the 3 hour limit."; break; }
      const signals = await browser.eval(MEETING_STATE_SCRIPT);
      const chat = await browser.eval(MEETING_CHAT_READ_SCRIPT);
      const chatLines = readLines(chat);
      if (!signals || !chatLines) {
        // Unknown: neither the page nor its chat can be trusted this poll.
        if (++unknown >= MEETING_UNKNOWN_POLLS) { reason = "The meeting page stopped answering."; break; }
        await this.sleep(this.opts.pollMs);
        continue;
      }
      unknown = 0;
      const fresh = newChatLines(chatSeen, chatLines);
      chatSeen = chatLines;
      if (this.objects(fresh)) return this.leaveOnObjection();
      const page = classifyMeetPage(signals);
      if (page === "ended" || page === "refused") { reason = page === "refused" ? "The bot was removed from the meeting." : "The meeting ended."; break; }
      const count = typeof signals.people === "number" ? signals.people : 0;
      const joined = count > people && people > 0;
      people = Math.max(people, count);
      if (joined || this.now() - lastAnnounce >= this.opts.announceEveryMs) {
        lastAnnounce = this.now();
        if (!await this.announce()) {
          // Consent can no longer be shown: stop, keep what was said under it.
          reason = "The announcement could not be posted again, so the bot stopped taking notes.";
          break;
        }
        // What was said while the bot announced itself again still counts.
        const after = readLines(await browser.eval(MEETING_CHAT_READ_SCRIPT));
        if (after) {
          const during = newChatLines(chatSeen, after);
          chatSeen = after;
          if (this.objects(during)) return this.leaveOnObjection();
        }
      }
      if (this.now() - lastDrain >= this.opts.drainMs) { lastDrain = this.now(); await this.drain(); }
      await this.sleep(this.opts.pollMs);
    }
    await browser.eval(MEETING_STOP_SCRIPT).catch(() => null);
    // The last segment is written when the recorder stops: give it a moment.
    await (this.opts.sleep ?? defaultSleep)(1_500, new AbortController().signal);
    for (let pass = 0; pass < 3; pass++) if (!await this.drain()) break;
    return this.leave({ status: "ended", detail: reason });
  }

  /** Whether any of these new chat lines objects to the notetaker. */
  private objects(lines: readonly string[]): boolean {
    const own = [...this.posted];
    return lines.some((line) => chatObjects(line, this.opts.botName ?? "", own, this.opts.displayName));
  }

  /** A participant objected in the chat: stop at once, drop every segment
   * not yet transcribed, say so in the chat, and leave. */
  private async leaveOnObjection(): Promise<MeetingOutcome> {
    const { browser } = this.opts;
    await browser.eval(MEETING_DISCARD_SCRIPT).catch(() => null);
    this.posted.add(MEETING_LEAVING_TEXT);
    const typed = await browser.eval(chatTypeScript(MEETING_LEAVING_TEXT)).catch(() => null);
    if (typed?.typed === true && typed.send === true) await browser.click("[data-sagax-send]").catch(() => false);
    return this.leave({ status: "ended", detail: "Left at a participant's request.", endReason: "participant" });
  }

  /** Open the chat, type the announcement, send it, and see it posted. */
  private async announce(): Promise<boolean> {
    const { browser } = this.opts;
    let opened = await browser.eval(MEETING_CHAT_OPEN_SCRIPT);
    if (opened?.box !== true) {
      await this.sleep(1_500);
      opened = await browser.eval(MEETING_CHAT_OPEN_SCRIPT);
    }
    if (opened?.box !== true || this.leaveRequested) return false;
    const before = await browser.eval(chatPostedScript(this.opts.announcement));
    const already = typeof before?.count === "number" ? before.count : 0;
    this.posted.add(this.opts.announcement);
    const typed = await browser.eval(chatTypeScript(this.opts.announcement));
    if (typed?.typed !== true || typed.send !== true) return false;
    if (!await browser.click("[data-sagax-send]")) return false;
    for (let check = 0; check < 3; check++) {
      await this.sleep(1_000);
      const posted = await browser.eval(chatPostedScript(this.opts.announcement));
      if (posted?.posted === true && typeof posted.count === "number" && posted.count > already) return true;
    }
    return false;
  }

  /** Transcribe what the page queued. True when it held segments. */
  private async drain(): Promise<boolean> {
    const drained = await this.opts.browser.eval(MEETING_DRAIN_SCRIPT, 30_000);
    const chunks = Array.isArray(drained?.chunks) ? drained.chunks : [];
    let added = false;
    for (const raw of chunks) {
      const chunk = decodeChunk(raw);
      if (!chunk) continue;
      try {
        const text = (await this.opts.transcribe(chunk.audio, chunk.mime)).trim();
        if (!text) continue;
        const line = { at: chunk.at, text: text.slice(0, 4_000) };
        this.lines.push(line);
        this.opts.onLine?.(line);
        added = true;
      } catch {
        this.transcriptionErrors++;
      }
    }
    if (added) {
      this.opts.update({
        segments: this.lines.length,
        transcriptTail: this.lines.slice(-TAIL_LINES).map((line) => line.text.length > 240 ? `${line.text.slice(0, 239)}...` : line.text),
      });
    }
    return chunks.length > 0;
  }

  /** Press Leave in the meeting, then finish. */
  private async leave(outcome: { status: MeetingOutcome["status"]; detail?: string; endReason?: "participant" }): Promise<MeetingOutcome> {
    const marked = await this.opts.browser.eval(MEETING_LEAVE_MARK_SCRIPT).catch(() => null);
    if (marked?.leave === true) await this.opts.browser.click("[data-sagax-leave]").catch(() => false);
    return this.finish(outcome);
  }

  private finish(outcome: { status: MeetingOutcome["status"]; detail?: string; endReason?: "participant" }): MeetingOutcome {
    const detail = this.transcriptionErrors && outcome.status === "ended"
      ? `${outcome.detail ?? ""} ${this.transcriptionErrors} audio segment(s) could not be transcribed.`.trim()
      : outcome.detail;
    return { status: outcome.status, ...(detail ? { detail } : {}), lines: [...this.lines], recorded: this.recorded, ...(outcome.endReason ? { endReason: outcome.endReason } : {}) };
  }
}
