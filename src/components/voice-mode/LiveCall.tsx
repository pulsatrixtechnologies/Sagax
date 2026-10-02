// Voice mode's live call with a bot (src/lib/voice-mode/call.ts): a phone
// call. The microphone stays open, the person can talk over the bot, and the
// bot's answer is spoken sentence by sentence while it is written.
//
// The BOT answers, never xAI: every accepted turn is dispatched as an
// ordinary message through the normal send route (the bot's engine,
// instructions, memory, tools, approvals, payer rules, the speaker's
// attribution and private-thread rules, the transcript in the thread). xAI
// only hears (speech to text) and reads the bot's own words aloud.
import { useCallback, useEffect, useRef, useState } from "react";

import { useStore, useStreaming, visibleMessages, type Bot } from "@/state/store";
import { clearVoiceCallId, currentCall, endCall, setVoiceCallId } from "@/lib/call";
import { NO, YES } from "@/lib/voice-mode/answers";
import { voiceCallSession } from "@/lib/voice-mode/api";
import { VoiceCall, type BargeInMetrics, type TurnMetrics } from "@/lib/voice-mode/call";
import { readCallSettings } from "@/lib/voice-mode/call-settings";
import type { CallState } from "@/lib/voice-mode/call-machine";
import { readVoiceModeSettings } from "@/lib/voice-mode/settings";
import { t } from "@/lib/i18n";
import { isRoutineApproval, isSkillApproval, pendingApprovals, spokenApprovalPrompt } from "../PendingApproval";
import { VoiceModeBar, type VoiceAccessCard } from "./VoiceModeBar";

export interface CallMetrics {
  /** the person stopped talking -> the first sample of the answer (ms) */
  firstAudioMs?: number;
  /** the person stopped talking -> the turn's words were sent (ms) */
  sentMs?: number;
  /** first voiced frame over the bot -> the bot ducked / cancelled (ms) */
  duckMs?: number;
  bargeInMs?: number;
}

export function LiveCall({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const { streaming } = useStreaming();
  const [call, setCall] = useState<VoiceCall | null>(null);
  const [state, setState] = useState<CallState | null>(null);
  const [heard, setHeard] = useState("");
  const [caption, setCaption] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [refusal] = useState<VoiceAccessCard | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<CallMetrics>({});
  const [interrupted, setInterrupted] = useState<Set<string>>(() => new Set());
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
          ...(barge?.duckedAt !== undefined ? { duckMs: Math.round(barge.duckedAt - barge.candidateAt) } : {}),
          ...(barge?.cancelledAt !== undefined ? { bargeInMs: Math.round(barge.cancelledAt - barge.candidateAt) } : {}),
        });
      }),
      live.on("speech-cancelled", () => {
        setCaption("");
        // what was being said is cut: the rest of that answer is not spoken
        dropOldReply.current = true;
        dropStream.current = streamingRef.current ?? "";
      }),
      live.on("interrupt-bot", () => {
        const current = botRef.current;
        // an approval being answered by voice keeps its turn
        if (askedApproval.current || !current.busy) return;
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
    (said: string, interrupted = false) => {
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
      // one id per utterance: the server delivers it once, whatever retries
      const utteranceId = crypto.randomUUID();
      dispatch({
        type: "send",
        botId: current.id,
        text: said,
        threadId: current.threadId,
        sendId: utteranceId,
        voiceCall: { callId, utteranceId, ...(interrupted ? { interrupted: true } : {}), ...(language && language !== "auto" ? { language } : {}) },
      });
    },
    [call, callId, dispatch],
  );

  useEffect(() => {
    if (!call) return;
    return call.on("utterance", (text, _metrics, turn) => onUtterance(text, turn.interrupted));
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
        continue;
      }
      void call.replyDone(reply.text!);
    }
    if (!replies.length && call.current.phase === "thinking") {
      const chip = [...fresh].reverse().find((m) => m.kind === "activity" && m.tool?.spoken);
      if (chip?.tool?.spoken && !call.player.busy) void call.say(chip.tool.spoken);
    }
  }, [call, messages, approval, question, bot.name]);

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

  if (!call || !state) return null;
  const transcript = messages
    .filter((m) => m.kind === "text" && m.text?.trim())
    .slice(-8)
    .map((m) => ({ id: m.id, who: m.role === "user" ? ("you" as const) : ("bot" as const), text: m.text!.trim(), interrupted: interrupted.has(m.id) }));
  return (
    <VoiceModeBar
      bot={bot}
      call={call}
      state={state}
      heard={heard}
      caption={caption}
      note={note}
      notice={notice}
      refusal={refusal}
      transcript={transcript}
      metrics={metrics}
      onRetry={() => {
        setNote(null);
        void call.retry();
      }}
      onEnd={() => endCall(bot.id)}
    />
  );
}
