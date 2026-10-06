// Voice mode's live call with a bot (src/lib/voice-mode/call.ts): a phone
// call. The microphone stays open, the person can talk over the bot, and the
// bot's answer is spoken sentence by sentence while it is written.
//
// The BOT answers, never xAI: every accepted turn is dispatched as an
// ordinary message through the normal send route (the bot's engine,
// instructions, memory, tools, approvals, payer rules, the speaker's
// attribution and private-thread rules, the transcript in the thread). xAI
// only hears (speech to text) and reads the bot's own words aloud.
//
// The engine (LiveCallEngine) runs once, window-wide (CallEngineHost), and
// publishes the call (live-call-store.ts); the app's pill (LiveCall) and the
// desktop mascot's only show it and drive it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useStore, useStreaming, visibleMessages, type Bot } from "@/state/store";
import { clearVoiceCallId, currentCall, endCall, setVoiceCallId } from "@/lib/call";
import { NO, YES } from "@/lib/voice-mode/answers";
import { voiceCallSession } from "@/lib/voice-mode/api";
import { VoiceCall, type BargeInMetrics, type TurnMetrics } from "@/lib/voice-mode/call";
import { readCallSettings } from "@/lib/voice-mode/call-settings";
import { stageDurations } from "@/lib/voice-mode/latency";
import type { CallState } from "@/lib/voice-mode/call-machine";
import { readVoiceModeSettings } from "@/lib/voice-mode/settings";
import { publishLiveCall, retractLiveCall, useLiveCall, type LiveCallData, type LiveCallMetrics } from "@/lib/voice-mode/live-call-store";
import { noteVoiceCallEnded, noteVoiceCallRunning } from "@/lib/voice-call-clock";
import { t } from "@/lib/i18n";
import { isRoutineApproval, isSkillApproval, pendingApprovals, spokenApprovalPrompt } from "../PendingApproval";
import { VoiceModeBar, type VoiceAccessCard } from "./VoiceModeBar";

/**
 * firstAudioMs: the person stopped talking -> the first sample of the answer;
 * sentMs: -> the turn's words were sent; duckMs / bargeInMs: first voiced
 * frame over the bot -> the bot ducked / cancelled (all ms).
 */
export type CallMetrics = LiveCallMetrics;

/** Runs the call with this bot and publishes it; draws nothing. */
export function LiveCallEngine({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const { streaming } = useStreaming();
  const [call, setCall] = useState<VoiceCall | null>(null);
  const [state, setState] = useState<CallState | null>(null);
  const [heard, setHeard] = useState("");
  const [caption, setCaption] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<CallMetrics>({});
  const [interrupted, setInterrupted] = useState<Set<string>>(() => new Set());
  /** the cut answers' words the person never heard, by reply id (transcript) */
  const [unheard, setUnheard] = useState<Map<string, string>>(() => new Map());
  /** the last cut: its unheard words go on the reply it cut, once settled */
  const lastCut = useRef<{ unheard: string } | null>(null);
  const threadRef = useRef(bot.threadId);
  threadRef.current = bot.threadId;
  const botRef = useRef(bot);
  botRef.current = bot;
  // this call, for the server: every turn said on it is a phone turn
  // (Message.voiceCall), which gets the hidden phone-call instruction
  const callId = useRef(crypto.randomUUID()).current;
  useEffect(() => {
    setVoiceCallId(bot.id, callId);
    return () => clearVoiceCallId(bot.id, callId);
  }, [bot.id, callId]);
  // the server knows the thread is on a call: any send to it while the call
  // lasts is a call turn (typed words, a queued line, a retry), and the
  // call's tools stay the same from turn to turn
  const callThread = bot.threadId;
  useEffect(() => {
    const language = readVoiceModeSettings().language;
    const call = { callId, threadId: callThread, ...(language && language !== "auto" ? { language } : {}) };
    void voiceCallSession(bot.id, "start", call);
    const alive = setInterval(() => void voiceCallSession(bot.id, "alive", call), 5 * 60_000);
    return () => {
      clearInterval(alive);
      void voiceCallSession(bot.id, "end", call);
    };
  }, [bot.id, callThread, callId]);

  const messages = visibleMessages(bot);
  const approval = pendingApprovals(messages)[0];
  const question = messages.find(
    (message) => message.kind === "options" && message.card?.requestId && !message.card.tool && !message.card.answered && !message.card.dismissed,
  );

  // Everything on screen when the call starts has been read or ignored.
  const spokenIds = useRef<Set<string>>(new Set());
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    for (const m of messages) spokenIds.current.add(m.id);
  }
  const askedApproval = useRef<{ requestId: string; skill: boolean; routine: boolean; submitted: boolean } | null>(null);
  const askedQuestion = useRef<{ requestId: string; messageId: string } | null>(null);
  /** after a barge-in: the old turn's words are not spoken (until a new answer) */
  const dropOldReply = useRef(false);
  /** the streamed block that was cut: ignored until the stream starts over */
  const dropStream = useRef<string | null>(null);

  // ── the call itself (one per mount; StrictMode's probe gets its own) ──
  useEffect(() => {
    const live = new VoiceCall({
      botId: bot.id,
      threadId: () => threadRef.current,
      voice: readVoiceModeSettings,
      settings: readCallSettings,
    });
    setCall(live);
    // the real-Electron check (scripts/verify-voice-mode.ts) drives the call
    // through this handle; it exists only when that check turns it on
    try {
      if (localStorage.getItem("omb.voiceCall.debug") === "1") (window as unknown as { __sagaxVoiceCall?: VoiceCall }).__sagaxVoiceCall = live;
    } catch {
      /* no storage: no handle */
    }
    const offs = [
      live.on("state", (next) => setState(next)),
      live.on("partial", (text) => setHeard(text)),
      live.on("caption", (text) => setCaption(text)),
      live.on("rejected", (reason) => {
        if (reason === "other-voice") setNotice(t("voiceMode.otherVoice"));
      }),
      live.on("error", (reason) => {
        setNote(reason === "mic-denied" ? t("voiceMode.micDenied") : reason === "mic-unavailable" ? t("voiceMode.micUnavailable") : t("voiceMode.transcribeFailed"));
      }),
      live.on("metrics", (turn: TurnMetrics | null, barge: BargeInMetrics | null) => {
        setMetrics({
          ...(turn?.firstAudioAt !== undefined ? { firstAudioMs: Math.round(turn.firstAudioAt - turn.stoppedAt) } : {}),
          ...(turn?.sentAt !== undefined ? { sentMs: Math.round(turn.sentAt - turn.stoppedAt) } : {}),
          // the last turn's stages (ids and milliseconds only)
          ...(turn?.firstAudioAt !== undefined ? { stages: stageDurations(turn), ...(turn.utteranceId ? { utteranceId: turn.utteranceId } : {}) } : {}),
          ...(barge?.duckedAt !== undefined ? { duckMs: Math.round(barge.duckedAt - barge.candidateAt) } : {}),
          ...(barge?.cancelledAt !== undefined ? { bargeInMs: Math.round(barge.cancelledAt - barge.candidateAt) } : {}),
        });
      }),
      live.on("speech-cancelled", (cut) => {
        setCaption("");
        if (cut.unheard) lastCut.current = { unheard: cut.unheard };
        // what was being said is cut: the rest of that answer is not spoken
        dropOldReply.current = true;
        dropStream.current = streamingRef.current ?? "";
      }),
      live.on("interrupt-bot", () => {
        const current = botRef.current;
        // an approval being answered by voice keeps its turn
        if (askedApproval.current || !current.busy) return;
        // what the stopped turn still streams is never spoken
        dropStream.current = streamingRef.current ?? "";
        dispatch({ type: "interrupt", botId: current.id, threadId: current.threadId });
      }),
    ];
    void live.start();
    return () => {
      for (const off of offs) off();
      live.end();
    };
  }, [bot.id, dispatch]);

  // ── what the person said ───────────────────────────────────────────────
  const onUtterance = useCallback(
    (said: string, interrupted = false, cut?: { heard: string; unheard: string }, continues = false, spokenId?: string) => {
      const current = botRef.current;
      if (!call || currentCall() !== current.id) return;
      setHeard("");
      setNotice(null);
      const open = askedApproval.current;
      if (open && !open.submitted) {
        if (YES.test(said) || NO.test(said)) {
          const allow = YES.test(said);
          if (allow && open.skill) {
            void call.say(t("voiceMode.skillReview"));
            return;
          }
          open.submitted = true;
          dispatch({
            type: "decideRequest",
            threadId: current.threadId,
            requestId: open.requestId,
            behavior: allow ? "allow" : "deny",
            message: allow ? undefined : "Denied by the user, on a call.",
            onError: () => {
              if (askedApproval.current?.requestId === open.requestId) askedApproval.current.submitted = false;
              void call.say(t("voiceMode.approvalFailed"));
            },
          });
          return;
        }
        void call.say(t("voiceMode.yesOrNo"));
        return;
      }
      const openQuestion = askedQuestion.current;
      if (openQuestion) {
        askedQuestion.current = null;
        dispatch({ type: "answerCard", botId: current.id, threadId: current.threadId, messageId: openQuestion.messageId, answer: said });
        return;
      }
      // a new turn: what the interrupted answer had left is never spoken
      dropOldReply.current = false;
      const language = readVoiceModeSettings().language;
      // one id per utterance: the server delivers it once, whatever retries,
      // and logs its stages under it (the call's timeline uses the same)
      const utteranceId = spokenId ?? crypto.randomUUID();
      // a send that failed (a network blip, a turn that ended under it) is
      // tried again once with the same utterance; then the person is told,
      // never left waiting on silence
      let attempts = 0;
      const onError = () => {
        attempts += 1;
        if (attempts > 1 || currentCall() !== current.id) {
          void call.say(t("voiceMode.sendFailed"));
          return;
        }
        setTimeout(send, 800);
      };
      const send = () => dispatch({
        type: "send",
        botId: current.id,
        text: said,
        threadId: current.threadId,
        sendId: utteranceId,
        onError,
        onSent: () => call.accepted(utteranceId),
        voiceCall: {
          callId,
          utteranceId,
          // it completes the fragment sent just before (cut by a pause)
          ...(continues ? { continues: true } : {}),
          // a barge-in says how much of the cut answer the person heard
          ...(interrupted ? { interrupted: true, ...(cut ? { heard: cut.heard, unheard: cut.unheard } : {}) } : {}),
          ...(language && language !== "auto" ? { language } : {}),
        },
      });
      send();
    },
    [call, callId, dispatch],
  );

  useEffect(() => {
    if (!call) return;
    return call.on("utterance", (text, _metrics, turn) => onUtterance(text, turn.interrupted, turn.cut, turn.continues === true, turn.utteranceId));
  }, [call, onUtterance]);

  useEffect(() => {
    call?.setBotBusy(Boolean(bot.busy));
  }, [call, bot.busy]);

  // ── the answer, sentence by sentence while it is written ──────────────
  const live = streaming[bot.threadId];
  const streamingRef = useRef<string | undefined>(live);
  streamingRef.current = live;
  useEffect(() => {
    if (!call) return;
    if (live === undefined || live === "") {
      dropStream.current = null;
      return;
    }
    // the cut block keeps streaming until the server stops it: not spoken
    if (dropStream.current !== null) {
      if (live.length >= dropStream.current.length && live.startsWith(dropStream.current.slice(0, 16))) return;
      dropStream.current = null;
    }
    if (dropOldReply.current) return;
    call.replyProgress(live);
  }, [call, live]);

  // ── settled messages: the rest of an answer, prompts, narration ───────
  useEffect(() => {
    if (!call) return;
    if (askedApproval.current && approval?.requestId !== askedApproval.current.requestId) askedApproval.current = null;
    if (askedQuestion.current && question?.card?.requestId !== askedQuestion.current.requestId) askedQuestion.current = null;
    if (approval && askedApproval.current?.requestId !== approval.requestId) {
      askedApproval.current = { requestId: approval.requestId, routine: isRoutineApproval(approval), skill: isSkillApproval(approval), submitted: false };
      spokenIds.current.add(approval.message.id);
      void call.say(isSkillApproval(approval) ? t("voiceMode.skillPrompt", { name: bot.name }) : spokenApprovalPrompt(approval, bot.name));
      return;
    }
    if (question?.card?.requestId && askedQuestion.current?.requestId !== question.card.requestId) {
      askedQuestion.current = { requestId: question.card.requestId, messageId: question.id };
      spokenIds.current.add(question.id);
      const detail = question.card.subtitle.trim();
      const choices = question.card.options.length ? ` ${question.card.options.join(", ")}.` : "";
      void call.say(`${detail}${/[.!?]$/.test(detail) ? "" : "."}${choices}`);
      return;
    }
    const fresh = messages.filter((m) => !spokenIds.current.has(m.id));
    if (!fresh.length) return;
    for (const m of fresh) spokenIds.current.add(m.id);
    const lastUser = messages.map((m) => m.role).lastIndexOf("user");
    const replies = fresh.filter((m) => m.role === "bot" && m.kind === "text" && m.text?.trim());
    for (const reply of replies) {
      // an answer from before the person's latest words (the turn they cut)
      if (dropOldReply.current || messages.indexOf(reply) < lastUser) {
        setInterrupted((previous) => new Set(previous).add(reply.id));
        // the words of it the person never heard stay in the transcript, marked
        const cut = lastCut.current;
        lastCut.current = null;
        if (cut?.unheard) setUnheard((previous) => new Map(previous).set(reply.id, cut.unheard));
        continue;
      }
      void call.replyDone(reply.text!);
    }
    if (!replies.length && call.current.phase === "thinking") {
      const chip = [...fresh].reverse().find((m) => m.kind === "activity" && m.tool?.spoken);
      if (chip?.tool?.spoken && !call.player.busy) void call.say(chip.tool.spoken);
    }
  }, [call, messages, approval, question, bot.name]);

  // ── what every surface shows ─────────────────────────────────────────
  const [startedAt] = useState(() => Date.now());
  const lines = messages.filter((m) => m.kind === "text" && m.text?.trim()).slice(-8);
  const transcriptKey = lines.map((m) => `${m.id}:${m.text!.length}:${interrupted.has(m.id) ? 1 : 0}:${unheard.get(m.id)?.length ?? 0}`).join("|");
  const transcript = useMemo(
    () => lines.map((m) => ({
      id: m.id,
      who: m.role === "user" ? ("you" as const) : ("bot" as const),
      text: m.text!.trim(),
      interrupted: interrupted.has(m.id),
      // the cut answer's words the person never heard, marked
      ...(unheard.has(m.id) ? { unheard: unheard.get(m.id) } : {}),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transcriptKey],
  );
  const data = useMemo<LiveCallData | null>(
    () =>
      call && state
        ? {
            botId: bot.id,
            call,
            state,
            startedAt,
            heard,
            caption,
            note,
            notice,
            transcript,
            metrics,
            retry: () => {
              setNote(null);
              void call.retry();
            },
          }
        : null,
    [bot.id, call, state, startedAt, heard, caption, note, notice, transcript, metrics],
  );
  useEffect(() => {
    noteVoiceCallRunning({ botId: bot.id, callId, startedAt });
    return () => noteVoiceCallEnded(callId);
  }, [bot.id, callId, startedAt]);
  useEffect(() => {
    if (data) publishLiveCall(data);
  }, [data]);
  useEffect(() => {
    if (!call) return;
    return () => retractLiveCall(call);
  }, [call]);
  return null;
}

/** The call stage for this bot, over the call the engine runs. */
export function LiveCall({ bot, collapsed, onCollapse, onExpand }: { bot: Bot; collapsed?: boolean; onCollapse?: () => void; onExpand?: () => void }) {
  const live = useLiveCall();
  const data = live?.botId === bot.id ? live : null;
  const call = data?.call ?? null;

  // ── keys: Escape hangs up; Space interrupts, or talks in push-to-talk ─
  useEffect(() => {
    if (!call) return;
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const down = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        endCall(bot.id);
        return;
      }
      if (event.code !== "Space" || typing(event.target)) return;
      if (readCallSettings().input === "push") {
        event.preventDefault();
        if (!event.repeat) call.pushToTalk(true);
      } else if (call.current.botAudible) {
        event.preventDefault();
        call.interrupt();
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space" || typing(event.target) || readCallSettings().input !== "push") return;
      event.preventDefault();
      call.pushToTalk(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [bot.id, call]);

  if (!data) return null;
  const refusal: VoiceAccessCard | null = null;
  return (
    <VoiceModeBar
      bot={bot}
      call={data.call}
      state={data.state}
      heard={data.heard}
      caption={data.caption}
      note={data.note}
      notice={data.notice}
      refusal={refusal}
      transcript={data.transcript}
      metrics={data.metrics}
      startedAt={data.startedAt}
      onRetry={data.retry}
      onEnd={() => endCall(bot.id)}
      collapsed={collapsed}
      onCollapse={onCollapse}
      onExpand={onExpand}
    />
  );
}
