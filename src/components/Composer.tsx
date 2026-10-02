import { track } from "@/lib/analytics";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { ArrowUp, Clock, Mic, Paperclip, Square, Target, Users, X } from "lucide-react";
import { api, useStore, visibleMessages, currentTaskBot, type Bot, type Group, type Message } from "@/state/store";
import { fullAccessNeedsConfirmation, orgFullAccessFor } from "@/lib/full-access";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { cn } from "@/lib/cn";
import { useMenuMotion } from "./MenuMotion";
import { activeLocale, t } from "@/lib/i18n";
import { consumeRetroCommand, retroSignal } from "@/lib/retro98";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import {
  draftRevision,
  appendDraftAttachments,
  changeDraftAttachmentPending,
  forgetFailedComposerSend,
  markDraftEdited,
  prependComposerDraft,
  recoverFailedComposerSend,
  rememberFailedComposerSend,
  replaceDraftAttachment,
  restoredSendId,
  useComposerDraft,
  useComposerChannelMode,
  useDraftAttachmentPending,
  useFailedComposerSends,
  type ComposerSendSnapshot,
  type FailedComposerSend,
} from "@/lib/drafts";
import { BotAvatar } from "./Avatar";
import { MentionTextarea } from "./MentionTextarea";
import { ComposerAttachments, pathForFile } from "./ComposerAttachments";
import { splitTranscriptCitations, type CitationAttachment } from "@/lib/citations";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import { PlaceChip } from "./PlaceChip";
import { effectivePlace } from "@/lib/place";
import { FullAccessWarning } from "./FullAccessWarning";
import { ApprovalModeSelector } from "./ApprovalModeSelector";
import { ModelPicker } from "./ModelPicker";
import { CallButton } from "./CallView";
import { GroupCallButton } from "./GroupCallView";
import { CommandAllowlistDialog } from "./CommandAllowlistDialog";
import { approvalModeFor, type ApprovalMode } from "../../shared/approval-mode";
import {
  appendPastedText,
  handoffAttachmentImagePreview,
  clipboardHasImages,
  clipboardImageFiles,
  clipboardOtherFiles,
  composeMessage,
  composerShouldRefocus,
  composerTakesFocusOnOpen,
  imageAttachmentFromFile,
  replyTargetTakesFocus,
  intakeFiles,
  isLongPaste,
  optimisticImageAttachment,
  pasteAttachment,
  releaseAttachmentImagePreview,
  type Attachment,
  type PasteAttachment,
} from "@/lib/composer-attachments";
import { normalizeState } from "@/lib/mascot";
import { goalCoordinatorForComposer, groupComposerHint, jevRoomRoutingOn, roomRespondersForComposer } from "@/lib/group-routing";
import { PendingApprovalBox, pendingApprovals, type Pending } from "./PendingApproval";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { ReplyQuote } from "./ReplyQuote";
import { useThreadRefs } from "./ThreadRefs";
import {
  QueuedComposerMessages,
  composerCanSteerQueuedMessages,
  doubleEnterSteerWindowExpiresAt,
  doubleEnterSteersQueue,
} from "./ComposerQueuedMessages";
import { BusySendChooser, moveBusyChoice } from "./BusySendChooser";
import { useParallelApprovals } from "./parallel-approvals";
import { useBusySendPreference } from "@/lib/busy-send";
import { useOnCall } from "@/lib/call";
import { suggestBusySendMode, type BusySendMode } from "../../shared/parallel-tasks";
import { skillAuthoringEnabled } from "@/lib/feature-flags";
import { useRetroSkin } from "./RetroChromeHost";
import { mentionChoicesForQuery } from "@/lib/mentions";
import { serializeThreadRefs, threadTokenFromPaste, threadTokenSpacing } from "@/lib/thread-refs";
import {
  composerCommandMenu,
  composerGroupCommandMenu,
  composerGroupSlashTrigger,
  composerSlashTrigger,
  engineCommandInsertion,
  groupCommandTargets,
  goalTextFromComposer,
  replaceComposerSlashTrigger,
  type ComposerMenuItem,
  type ComposerSlashCommand,
  type GroupEngineCommands,
} from "@/lib/composer-commands";
import { useGroupHarnessCommands, useHarnessCommands } from "@/lib/harness-commands";
import { ComposerCommandMenu } from "./ComposerCommandMenu";
import { WorkplaceNotice } from "./WorkplaceNotice";

/** The active @mention query at the caret: the text between an `@` that
 * starts a word and the caret. null = no mention being typed. */
function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null; // user@host, not a tag
  const query = upto.slice(at + 1);
  if (query.length > 24 || query.includes("@") || query.includes("\n")) return null;
  return { start: at, query };
}

type MentionChoice = { id: string; name: string; bot?: Bot };

interface ComposerDraftSnapshot extends ComposerSendSnapshot {
  reply: Message | null;
}

/** Renders the editable message composer and its pending attachments. */
export function Composer({
  bot: profile,
  group,
  members,
  onEditLast,
  replyTo,
  onClearReply,
  onConsumeReply,
  onRestoreReply,
}: {
  bot?: Bot;
  group?: Group;
  members?: Bot[];
  onEditLast?: () => void;
  replyTo?: Message | null;
  onClearReply?: () => void;
  onConsumeReply?: () => void;
  onRestoreReply?: (message: Message, threadId: string) => void;
}) {
  const bot = profile ? currentTaskBot(profile) : undefined;
  const locked = Boolean(bot?.awaitingThreadSnapshot);
  const { state, dispatch } = useStore();
  const ownerOrAdmin = useOwnerOrAdmin();
  const { threads, currentBotId } = useThreadRefs();
  const { capabilities } = useDesktopCapabilities();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  // Unified target: a 1:1 bot thread or a room. In a room the @ picker
  // offers members plus @everyone; explicit mentions override the room's
  // configured default responder.
  const busy = group ? Boolean(group.working || group.busyBotId) : Boolean(bot?.busy);
  // an engine with a live session takes a message INTO the running turn;
  // for those the composer never locks — the server steers instead of 409.
  // A room steers through its busy speaker's engine, mirroring how the
  // server's queue-steer route resolves the running turn.
  const steerInstanceId = group
    ? members?.find((member) => member.id === group.busyBotId)?.modelSelection.instanceId
    : bot?.modelSelection.instanceId;
  const canSteer =
    state.instances.find((i) => i.instanceId === steerInstanceId)?.capabilities?.queueing === true;
  // a pending approval blocks the prompt until it is answered
  const threadId = group?.threadId ?? bot?.threadId ?? "";
  // The conversation's own place, when pinned; the chip reads it next to the bot default.
  const composerTask = profile?.tasks?.find((task) => task.threadId === threadId);
  // the VISIBLE branch only — an approval left on a branch you edited away
  // from must not keep blocking the composer
  // this conversation's own, then those its parallel tasks wait on
  const parallelApprovals = useParallelApprovals(group ? undefined : bot);
  const approvals = [...pendingApprovals(group ? group.messages : bot ? visibleMessages(bot) : []), ...parallelApprovals];
  const approval = approvals[0];
  const approvalBotFor = (pending: Pending) => group
    ? members?.find((member) => member.id === pending.message.from?.botId) ??
      members?.find((member) => member.id === group.busyBotId)
    : bot;
  const busyName = group
    ? (members?.find((b) => b.id === group.busyBotId)?.name ??
      (group.working ? t("composer.busy.team") : t("composer.busy.aBot")))
    : (bot?.name ?? t("composer.busy.theBot"));
  // A send while this 1:1 conversation works: join, parallel task or after
  // (shared/parallel-tasks.ts). "ask" offers the choice; null = closed.
  const busySendPreference = useBusySendPreference();
  // on a voice call the words join the running turn: no chooser
  const onCall = useOnCall();
  const offersBusyChoice = Boolean(bot && !group && busy && onCall !== bot.id);
  const [busyChoice, setBusyChoice] = useState<BusySendMode | null>(null);
  useEffect(() => {
    if (!offersBusyChoice) setBusyChoice(null);
  }, [offersBusyChoice]);
  // Per-thread draft: switching bots unmounts this component, so both the
  // text and its attachment chips have to outlive it (see lib/drafts).
  const draftId = group
    ? `group:${group.id}:${group.threadId}`
    : `bot:${bot?.id ?? ""}:${bot?.threadId ?? ""}`;
  const [text, setText, attachments, setAttachments] = useComposerDraft(
    draftId,
    !group && bot ? `bot:${bot.id}` : undefined,
  );
  const attachmentPending = useDraftAttachmentPending(draftId);
  const failedSends = useFailedComposerSends(draftId);
  // Goal mode is opt-in and one-shot so the next ordinary channel message
  // cannot accidentally start another multi-turn team run.
  const [channelMode, setChannelMode] = useComposerChannelMode(draftId);
  const editText = useCallback(
    (next: string) => {
      markDraftEdited(draftId);
      setText(next);
    },
    [draftId, setText],
  );
  const editAttachments = useCallback(
    (next: SetStateAction<Attachment[]>) => {
      markDraftEdited(draftId);
      setAttachments(next);
    },
    [draftId, setAttachments],
  );
  const restoreDraft = useCallback(
    (sent: ComposerDraftSnapshot) => {
      // Shared recovery reaches a newly mounted view after navigation and
      // falls back to a separate retry item when a newer draft already exists.
      if (recoverFailedComposerSend(sent) === "restored") {
        if (sent.reply) onRestoreReply?.(sent.reply, sent.threadId);
      }
    },
    [onRestoreReply],
  );
  const addAttachments = useCallback(
    (next: Attachment[]) => appendDraftAttachments(draftId, next),
    [draftId],
  );
  const removeAttachment = useCallback(
    (id: string) => {
      const removed = attachments.find((attachment) => attachment.id === id);
      if (removed?.kind === "image") releaseAttachmentImagePreview(removed);
      editAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
    },
    [attachments, editAttachments],
  );
  const displayPasteInChatBox = useCallback(
    /** Moves one pasted attachment into the editable draft and restores focus. */
    function displayPasteInChatBox(attachment: PasteAttachment) {
      const nextText = appendPastedText(text, attachment.text);
      editText(nextText);
      editAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
      setCaret(nextText.length);
      setDismissedAt(null);
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(nextText.length, nextText.length);
      });
    },
    [text, editText, editAttachments],
  );
  const [recording, setRecording] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null); // Esc'd this @
  const [dismissedSlashAt, setDismissedSlashAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftIdRef = useRef(draftId);
  draftIdRef.current = draftId;
  // the latest caret, readable from callbacks without re-creating them
  const caretRef = useRef(0);
  caretRef.current = caret;
  /** Returns keyboard focus to the draft, keeping the caret where it was. */
  const refocusInput = useCallback(() => {
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerShouldRefocus(document.activeElement, input)) return;
      const at = Math.min(caretRef.current, input.value.length);
      input.focus();
      input.setSelectionRange(at, at);
    });
  }, []);
  // The composer is keyed by thread, so mounting means a thread was just
  // opened: put the caret at the end of its draft so the person can type
  // without clicking the box first. Touch screens are skipped — focusing
  // there pops the on-screen keyboard over the conversation.
  useEffect(() => {
    if (window.matchMedia?.("(hover: none) and (pointer: coarse)").matches) return;
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerTakesFocusOnOpen(document.activeElement, input)) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  // Choosing a message to reply to means typing the reply comes next, so the
  // caret follows the new target the same way it does when a thread opens.
  // A reply restored with the thread is the open effect's; the ref starts on
  // it so the two never both run.
  const replyToId = replyTo?.id ?? null;
  const focusedReplyRef = useRef(replyToId);
  useEffect(() => {
    const previous = focusedReplyRef.current;
    focusedReplyRef.current = replyToId;
    if (!replyTargetTakesFocus(previous, replyToId)) return;
    if (window.matchMedia?.("(hover: none) and (pointer: coarse)").matches) return;
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerTakesFocusOnOpen(document.activeElement, input)) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [replyToId]);
  const mentionListRef = useRef<HTMLDivElement>(null);
  // what was typed before the mic went on — partials append after it
  const baseText = useRef("");

  // image paste is offered only when every bot that will actually answer
  // can open one. sendGroup routes to mentions, else the room default —
  // `members.some` would let a mixed room send <attached-image> to Grok.
  const botSupportsImages = (candidate?: Bot) =>
    Boolean(
      candidate &&
        state.instances.find((i) => i.instanceId === candidate.modelSelection.instanceId)?.capabilities?.images,
    );
  const imageTargetsSupport = (message: string, mode: "chat" | "goal") => {
    if (!group) return botSupportsImages(bot);
    if (mode === "goal") {
      return botSupportsImages(goalCoordinatorForComposer(message, members ?? [], group) ?? undefined);
    }
    const responders = roomRespondersForComposer(message, members ?? [], group);
    return responders.length > 0 && responders.every(botSupportsImages);
  };
  const typedGoalText = group && !group.dm ? goalTextFromComposer(text) : null;
  const effectiveText = typedGoalText ?? text;
  const effectiveChannelMode = typedGoalText !== null ? "goal" : channelMode;
  const engineSupportsImages = imageTargetsSupport(effectiveText, effectiveChannelMode);

  // ── Slash commands and @mentions ─────────────────────────────────────
  // In a group "/" also opens right after a leading @mention: that bot's
  // engine commands only (shared/harness-commands.ts groupCommandTarget).
  const groupSlash = group && !group.dm ? composerGroupSlashTrigger(text, caret, members ?? []) : null;
  const slash = group && !group.dm ? groupSlash?.trigger ?? null : composerSlashTrigger(text, caret);
  const locale = activeLocale();
  // The engine's own commands (Claude Code, Codex) for a 1:1 conversation,
  // read the first time "/" is typed there (src/lib/harness-commands.ts).
  // On an organization server the list is the signed-in person's own, so the
  // cache is theirs too.
  const commandViewerId = state.config?.viewer?.principalId ?? null;
  const engineCommands = useHarnessCommands(api, !group ? bot?.id : undefined, threadId || undefined, Boolean(slash) && !group, commandViewerId);
  // In a group: the commands of the bot(s) the command would reach, per bot.
  const groupSlashOpen = Boolean(groupSlash);
  const groupSlashBotId = groupSlash?.botId;
  const groupTargets = useMemo(
    () => groupSlashOpen && group ? groupCommandTargets({ botId: groupSlashBotId }, members ?? [], group.defaultResponder) : [],
    [groupSlashOpen, groupSlashBotId, group, members],
  );
  const groupEngineCommands = useGroupHarnessCommands(api, groupTargets.map((target) => target.bot.id), group && !group.dm ? group.id : undefined, threadId || undefined, groupSlashOpen, commandViewerId);
  const commandListRef = useRef<HTMLDivElement>(null);
  const commandCandidates = useMemo((): ComposerMenuItem[] => {
    if (!slash || slash.start === dismissedSlashAt) return [];
    const supportsAgents = (candidate?: Bot) =>
      Boolean(
        candidate &&
          state.instances.find(
            (instance) => instance.instanceId === candidate.modelSelection.instanceId,
          )?.capabilities?.agentsMcp,
      );
    const available: ComposerSlashCommand[] = [];
    if (group && !group.dm) available.push({
      id: "goal",
      label: "/goal",
      description: t("composer.command.goalDesc"),
    });
    if (
      skillAuthoringEnabled(state.config) &&
      (group ? (members ?? []).some(supportsAgents) : supportsAgents(bot))
    ) {
      available.push({
        id: "learn",
        label: "/learn",
        description: t("composer.command.learnDesc"),
      });
    }
    // Setup mode needs the agents tools (propose_profile and friends) and a
    // single bot: a room cannot set itself up.
    if (!group && supportsAgents(bot)) available.push({
      id: "setup",
      label: "/setup",
      description: t("composer.command.setupDesc"),
    });
    if (group) {
      // after a leading mention only that bot's engine commands make sense
      const sets: GroupEngineCommands[] = groupTargets.map((target) => ({
        bot: { id: target.bot.id, name: target.bot.name },
        commands: groupEngineCommands.lists.find((list) => list.botId === target.bot.id)?.answer.commands ?? [],
        mention: target.mention,
      }));
      return composerGroupCommandMenu(groupSlashBotId ? [] : available, sets, slash.query);
    }
    return composerCommandMenu(available, engineCommands.answer?.commands ?? [], slash.query);
  }, [slash, dismissedSlashAt, group, members, bot, state.config, state.instances, locale, engineCommands.answer, groupTargets, groupEngineCommands.lists, groupSlashBotId]);
  const commandPickerOpen = commandCandidates.length > 0;

  // Tag another bot; the agent reaches it via ask_bot.
  const mention = mentionQueryAt(text, caret);
  const candidates = useMemo(() => {
    if (!mention || mention.start === dismissedAt) return [];
    const pool: MentionChoice[] = group
      ? [
          ...(!group.dm ? [{ id: "__everyone__", name: "everyone" }] : []),
          ...(members ?? []).map((member) => ({ id: member.id, name: member.name, bot: member })),
        ]
      : state.bots
          .filter((member) => member.id !== bot?.id && !member.hidden)
          .map((member) => ({ id: member.id, name: member.name, bot: member }));
    return mentionChoicesForQuery(pool, mention.query);
  }, [mention, dismissedAt, state.bots, bot?.id, group, members]);
  const mentionPickerOpen = candidates.length > 0;
  const commandMotion = useMenuMotion(commandPickerOpen);
  const mentionMotion = useMenuMotion(mentionPickerOpen);

  useEffect(
    () => setHighlight(0),
    [mention?.start, mention?.query, slash?.start, slash?.query],
  );

  useEffect(() => {
    if (!commandPickerOpen) return;
    commandListRef.current
      ?.querySelector<HTMLElement>(`[data-command-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, commandPickerOpen]);

  useEffect(() => {
    if (!mentionPickerOpen) return;
    mentionListRef.current
      ?.querySelector<HTMLElement>(`[data-mention-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, mentionPickerOpen]);

  const pickMention = (peer: MentionChoice) => {
    if (!mention) return;
    const after = text.slice(caret);
    const next = `${text.slice(0, mention.start)}@${peer.name} ${after}`;
    editText(next);
    const newCaret = mention.start + peer.name.length + 2;
    setCaret(newCaret);
    // picking completes this tag — close the popup so the next Enter sends
    setDismissedAt(mention.start);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  const pickCommand = (item: ComposerMenuItem | undefined) => {
    if (!slash || !item) return;
    // What the chat cannot run stays listed, with its reason, but inserts nothing.
    if (item.kind === "engine" && item.unavailable) return;
    const command = item.kind === "sagax" ? item.command : null;
    const replacement = item.kind === "engine"
      ? engineCommandInsertion(item)
      : command?.id === "learn" ? "/learn " : command?.id === "setup" ? "/setup " : "";
    const next = replaceComposerSlashTrigger(text, slash, replacement);
    editText(next.text);
    setCaret(next.caret);
    setDismissedSlashAt(slash.start);
    setChannelMode(command?.id === "goal" ? "goal" : "chat");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  // Busy sends are owned by the harness immediately for both channels and
  // 1:1 chats. Keeping a channel follow-up in this component used to lose its
  // auto-send intent whenever navigation unmounted the composer.
  const pendingCount = (state.pendingQueued[threadId] ?? []).length;
  const queuedMessages = state.pendingQueued[threadId] ?? [];
  const canSteerQueued = composerCanSteerQueuedMessages(
    busy,
    locked,
    pendingCount,
    Boolean(approval),
  );
  const [steering, setSteering] = useState(false);
  const interruptTurn = () => {
    if (group) dispatch({ type: "interruptGroup", groupId: group.id, threadId });
    else if (bot) dispatch({ type: "interrupt", botId: bot.id, threadId });
  };
  const queueHeadId = queuedMessages[0]?.queueId;
  const steerQueued = () => {
    if (!queueHeadId) return;
    setSteering(true);
    const settle = () => setSteering(false);
    if (group && canSteer) {
      // A steer-capable room folds the queued head into the running turn
      // through the server; it never interrupts the turn to do it.
      dispatch({ type: "steerGroupQueued", groupId: group.id, threadId, queueId: queueHeadId, onError: settle, onSettled: settle });
    } else if (group) {
      // A room whose running engine cannot steer keeps the old behavior:
      // Steer ends the running turn so the next queued message starts.
      dispatch({ type: "interruptGroup", groupId: group.id, threadId, onError: settle });
    } else if (bot && canSteer) {
      // A steer-capable engine folds the queued words into the running turn
      // through the server; it never interrupts the turn to do it.
      dispatch({ type: "steerQueued", botId: bot.id, threadId, queueId: queueHeadId, onError: settle, onSettled: settle });
    } else if (bot) {
    // Unlike the general Stop control, Steer belongs to this exact queue.
    // Scoping prevents a 1:1 queue from interrupting the same bot in a room
    // (or a routine) whose work is unrelated to the words shown here.
      dispatch({ type: "interrupt", botId: bot.id, threadId, onError: settle });
    }
  };
  useEffect(() => setSteering(false), [threadId, queueHeadId]);
  // Edit pulls a queued message back into the composer. The server removes it
  // from the queue first; only a confirmed removal hands the words back, so a
  // message that already drained into a turn can never also be resent.
  const editQueued = (queueId: string) => {
    const queued = queuedMessages.find((item) => item.queueId === queueId);
    if (!queued) return;
    const targetDraftId = draftId;
    const onCancelled = () => {
      const cited = splitTranscriptCitations(queued.text);
      if (cited.display) prependComposerDraft(targetDraftId, cited.display);
      appendDraftAttachments(targetDraftId, cited.citations);
      if (targetDraftId !== draftIdRef.current) return;
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(cited.display.length, cited.display.length);
      });
    };
    if (group) dispatch({ type: "cancelGroupQueued", groupId: group.id, threadId, queueId, onCancelled });
    else if (bot) dispatch({ type: "cancelQueued", botId: bot.id, threadId, queueId, onCancelled });
  };
  // Double-Enter gesture: when a send lands as a queued chip on a busy
  // steer-capable thread (live steer lost its race, an attachment, an
  // older CLI), a second Enter within a short window pulls that queue into
  // the running turn. Plain sends never consult the window, so they keep
  // their normal latency.
  const steerAgainUntilRef = useRef(0);
  const prevPendingCountRef = useRef(pendingCount);
  useEffect(() => {
    const expiresAt = doubleEnterSteerWindowExpiresAt(
      prevPendingCountRef.current,
      pendingCount,
      busy,
      canSteer,
    );
    if (expiresAt !== null) steerAgainUntilRef.current = expiresAt;
    prevPendingCountRef.current = pendingCount;
  }, [pendingCount, busy, canSteer]);
  // Most engines acknowledge interruption quickly, but a lost response must
  // not leave a control claiming to steer forever. Queue drain or turn end
  // clears it immediately; twenty seconds is the final recovery floor.
  useEffect(() => {
    if (!busy || pendingCount === 0) {
      setSteering(false);
      return;
    }
    if (!steering) return;
    const timeout = window.setTimeout(() => setSteering(false), 20_000);
    return () => window.clearTimeout(timeout);
  }, [busy, pendingCount, steering]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [approvalWarning, setApprovalWarning] = useState<{
    mode: "auto" | "full";
    botId: string;
    threadId: string;
  } | null>(null);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const [commandAllowlistTarget, setCommandAllowlistTarget] = useState<{ botId: string; botName: string; threadId: string } | null>(null);
  // Approval mode belongs to one bot; a room has several, each with its own.
  const modeBot = group ? undefined : bot;
  const approvalEngine = modeBot
    ? state.instances.find((instance) => instance.instanceId === modeBot.modelSelection.instanceId)
    : undefined;
  const trustedThreadAccess = Boolean(!remoteClient && window.ogb?.approvals && capabilities.host.packaged);
  // Organization server: the bot's owner grants Full over HTTP while the
  // organization allows it (src/lib/full-access.ts, server/org-full-access.ts).
  const perspicaxOrg = usePerspicaxOrg();
  const viewerId = state.config?.viewer?.principalId ?? null;
  const orgFullAccess = orgFullAccessFor(perspicaxOrg, modeBot, viewerId);
  const fullAccessAvailable = trustedThreadAccess || orgFullAccess === "allowed";
  const uploadImage = useCallback(async (file: File): Promise<Attachment | null> => {
    const optimistic = optimisticImageAttachment(file);
    if (!optimistic) return null;
    appendDraftAttachments(draftId, [optimistic]);
    try {
      const completed = await imageAttachmentFromFile(file, optimistic);
      if (!completed) {
        replaceDraftAttachment(draftId, optimistic.id, null);
        releaseAttachmentImagePreview(optimistic);
        return null;
      }
      handoffAttachmentImagePreview(completed.path, completed.previewUrl);
      if (!replaceDraftAttachment(draftId, optimistic.id, completed)) {
        // The user removed the chip while its upload was completing.
        releaseAttachmentImagePreview(completed);
      }
      // The keyed draft already owns the completed attachment; returning it
      // would make intakeFiles append a duplicate chip.
      return null;
    } catch (error) {
      replaceDraftAttachment(draftId, optimistic.id, null);
      releaseAttachmentImagePreview(optimistic);
      throw error;
    }
  }, [draftId]);
  const pickFiles = async (picked: FileList | readonly File[] | null) => {
    if (!picked?.length) return;
    changeDraftAttachmentPending(draftId, true);
    try {
      const { attachments: added, notice } = await intakeFiles(Array.from(picked), {
        allowImages: engineSupportsImages,
        getPath: pathForFile,
        uploadImage,
      });
      if (added.length) addAttachments(added);
      if (notice) setAttachmentNotice(notice);
    } finally {
      changeDraftAttachmentPending(draftId, false);
    }
    // the file dialog leaves focus on the paperclip button; typing should
    // continue in the draft without another click
    refocusInput();
  };
  const setApprovalMode = (mode: ApprovalMode) => {
    if (!modeBot || modeBot.busy || mode === approvalModeFor(modeBot)) return;
    if (mode === "custom" && !trustedThreadAccess) return;
    if (mode === "full" && !fullAccessAvailable) return;
    if (mode === "full") {
      // The warning is confirmed once per bot; later choices go straight in.
      if (fullAccessNeedsConfirmation(modeBot, viewerId, Boolean(perspicaxOrg))) {
        setApprovalWarning({ mode, botId: modeBot.id, threadId: modeBot.threadId });
        return;
      }
      dispatch({ type: "updateTask", botId: modeBot.id, threadId: modeBot.threadId,
        patch: { approvalMode: "full", confirmFullAccess: !perspicaxOrg, ...(perspicaxOrg ? { organizationFullAccess: true } : {}) } });
      return;
    }
    // Safe Auto still needs its dedicated warning when it can drive the host.
    if (mode === "auto" && modeBot.computer === "local") {
      setApprovalWarning({ mode: "auto", botId: modeBot.id, threadId: modeBot.threadId });
      return;
    }
    dispatch({ type: "updateTask", botId: modeBot.id, threadId: modeBot.threadId, patch: { approvalMode: mode } });
  };

  const hasContent = Boolean(effectiveText.trim()) || attachments.length > 0;
  const retroSkin = useRetroSkin();
  const retryFailedSend = (failed: FailedComposerSend) => {
    const failedMode = failed.channelMode ?? "chat";
    if (failed.requestText.includes("<attached-image ") && !imageTargetsSupport(failed.requestText, failedMode)) {
      dispatch({ type: "error", message: t("composer.error.noImages") });
      return;
    }
    forgetFailedComposerSend(draftId, failed.id);
    const retry = {
      sendId: failed.sendId,
      text: failed.requestText,
      replyToId: failed.replyToId,
      threadId: failed.threadId,
      onError: () => {
        rememberFailedComposerSend(draftId, {
          sendId: failed.sendId,
          text: failed.text,
          requestText: failed.requestText,
          replyToId: failed.replyToId,
          threadId: failed.threadId,
          channelMode: failed.channelMode,
        });
      },
    };
    if (group) {
      dispatch({ type: "sendGroup", groupId: group.id, mode: failedMode, ...retry });
    } else if (bot) {
      dispatch({ type: "send", botId: bot.id, ...retry });
    }
  };
  const send = (chosen?: BusySendMode) => {
    // The Hibou 98 easter egg: the secret command toggles the retro owl and
    // is never sent to anyone.
    if (consumeRetroCommand(text, attachments.length)) {
      setText("");
      return;
    }
    if (locked || attachmentPending) return;
    if (
      attachments.some((attachment) => attachment.kind === "image") &&
      !imageTargetsSupport(effectiveText, effectiveChannelMode)
    ) {
      dispatch({ type: "error", message: t("composer.error.noImages") });
      return;
    }
    // named `body`, not `t` — that name belongs to the catalog lookup now
    // resolvable "#Title" runs leave as canonical links, so the thread id
    // stays machine-readable in the stored send and the model's context
    const body = composeMessage(serializeThreadRefs(effectiveText, threads, currentBotId), attachments);
    if (!body) return;
    // While this conversation works, the person says what the message does,
    // or their default does.
    let busyMode: BusySendMode | undefined;
    if (offersBusyChoice) {
      busyMode = chosen ?? (busySendPreference === "ask" ? undefined : busySendPreference);
      if (!busyMode) {
        setBusyChoice(suggestBusySendMode(body));
        return;
      }
    }
    setBusyChoice(null);
    const sentDraft: ComposerDraftSnapshot = {
      draftId,
      revision: draftRevision(draftId),
      sendId: restoredSendId(draftId) ?? crypto.randomUUID(),
      text,
      requestText: body,
      attachments: [...attachments],
      reply: replyTo ?? null,
      replyToId: replyTo?.id,
      threadId,
      channelMode: group ? effectiveChannelMode : undefined,
    };
    if (group) {
      dispatch({
        type: "sendGroup",
        groupId: group.id,
        text: body,
        sendId: sentDraft.sendId,
        replyToId: replyTo?.id,
        threadId,
        mode: effectiveChannelMode,
        onError: () => restoreDraft(sentDraft),
      });
      track("message_sent", { room: true, mode: effectiveChannelMode, queued: busy });
    } else if (bot) {
      dispatch({
        type: "send",
        botId: bot.id,
        text: body,
        sendId: sentDraft.sendId,
        replyToId: replyTo?.id,
        threadId,
        ...(busyMode ? { busyMode } : {}),
        onError: () => restoreDraft(sentDraft),
      });
      track("message_sent", { driver: bot.modelSelection?.instanceId, queued: busy && !canSteer });
    }
    retroSignal("send");
    setText("");
    setAttachments([]);
    onConsumeReply?.();
    if (group) setChannelMode("chat");
  };

  /**
   * Handles clipboard paste events in the composer textarea: converts pasted clipboard
   * images into uploaded attachments (if supported by the responder) and converts oversized
   * text into draft attachment chips.
   *
   * @param e - Clipboard event from the composer textarea.
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // an image from the clipboard becomes an uploaded attachment —
    // but only for engines that can open one; a grok bot politely
    // refuses instead of receiving a path it cannot read
    const imageFiles = clipboardImageFiles(e.clipboardData);
    if (imageFiles.length > 0 || clipboardHasImages(e.clipboardData)) {
      e.preventDefault();
      if (!engineSupportsImages) {
        dispatch({
          type: "error",
          message: t("composer.error.noImages"),
        });
        return;
      }
      if (!imageFiles.length) {
        dispatch({ type: "error", message: t("composer.error.clipboardImage") });
        return;
      }
      if (imageFiles.length > 0) {
        changeDraftAttachmentPending(draftId, true);
        void (async () => {
          try {
            const results = await Promise.allSettled(imageFiles.map(uploadImage));
            for (const result of results) {
              if (result.status === "rejected") {
                dispatch({
                  type: "error",
                  message: result.reason instanceof Error ? result.reason.message : "image upload failed",
                });
              }
            }
          } finally {
            changeDraftAttachmentPending(draftId, false);
          }
        })();
        return;
      }
    }
    // a zip or a document copied in the Finder or Explorer attaches like a
    // picked file (same intake, same limits and notices)
    const otherFiles = clipboardOtherFiles(e.clipboardData);
    if (otherFiles.length > 0) {
      e.preventDefault();
      void pickFiles(otherFiles);
      return;
    }
    const pasted = e.clipboardData.getData("text/plain");
    // a pasted thread reference — canonical link, its markdown shape, or a
    // raw UUID — becomes the token the composer holds when it names a
    // thread the person can see; anything else stays ordinary text
    const reference = threadTokenFromPaste(pasted, threads, currentBotId);
    if (reference) {
      e.preventDefault();
      const start = e.currentTarget.selectionStart ?? text.length;
      const end = e.currentTarget.selectionEnd ?? start;
      // "#Title" only links at a word boundary, so keep the token clear of
      // the words it may land between
      const { lead, trail } = threadTokenSpacing(text, start, end);
      const token = lead + reference.token + trail;
      editText(text.slice(0, start) + token + text.slice(end));
      const at = start + token.length;
      setCaret(at);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(at, at);
      });
      return;
    }
    // a wall of text becomes a chip instead of burying the input
    if (!isLongPaste(pasted)) return;
    e.preventDefault();
    // Preserve native paste replacement semantics: if text was
    // selected, the attachment replaces that selection.
    const start = e.currentTarget.selectionStart;
    const end = e.currentTarget.selectionEnd;
    if (start !== end) {
      editText(`${text.slice(0, start)}${text.slice(end)}`);
      setCaret(start);
    }
    editAttachments((prev) => [...prev, pasteAttachment(pasted)]);
  };

  // native dictation: partials stream into the input while the Swift
  // helper runs; the final transcript stays in the box, ready to edit/send
  useEffect(() => {
    if (!recording) return;
    const bridge = window.ogb;
    if (!bridge) {
      setRecording(false);
      return;
    }
    setSpeechError(null);
    const offTranscript = bridge.onSpeechTranscript((line) => {
      if (typeof line.text === "string") {
        const base = baseText.current;
        editText(base ? `${base} ${line.text}` : line.text);
      }
    });
    const offEnd = bridge.onSpeechEnd(({ code, reason }) => {
      setRecording(false);
      if (code === 2) {
        setSpeechError(t("composer.dictation.macOnly"));
      } else if (code === 1) {
        setSpeechError(t(
          reason === "dictation-disabled"
            ? "composer.dictation.disabled"
            : reason === "speech-not-authorized"
              ? "composer.dictation.permission"
              : "composer.dictation.failed",
        ));
      }
    });
    void bridge.speechStart();
    return () => {
      offTranscript();
      offEnd();
      void bridge.speechStop();
    };
  }, [recording, editText]);

  const toggleMic = () => {
    if (!capabilities.dictation.available || !window.ogb) {
      setSpeechError(t("composer.dictation.unavailable"));
      return;
    }
    baseText.current = text.trim();
    setRecording((r) => !r);
  };

  return (
    <div className="pointer-events-none relative overflow-x-clip px-[max(16px,calc((100%-960px)/2))] pb-4">
      {/* No fill or hairline on this wrapper — those were the black frame
          in the pill's top corners. The dock overlays the transcript. */}
      {speechError && (
        <div className="pointer-events-auto mb-2 w-full rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          {speechError}
        </div>
      )}
      <div className="pointer-events-auto relative w-full">
        <WorkplaceNotice place={modeBot ? effectivePlace(modeBot, composerTask) : null} />
        {failedSends.map((failed) => (
          <div
            key={failed.id}
            className="mb-2 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger"
          >
            <span className="min-w-0 flex-1 truncate">
              {t("composer.failed.notSent", {
                text: failed.text.trim() || t("composer.failed.attachment"),
              })}
            </span>
            <button
              type="button"
              onClick={() => retryFailedSend(failed)}
              className="shrink-0 rounded px-2 py-1 font-medium hover:bg-danger/10"
            >
              {t("chat.retry")}
            </button>
            <button
              type="button"
              onClick={() => forgetFailedComposerSend(draftId, failed.id)}
              aria-label={t("composer.failed.dismissAria")}
              title={t("composer.failed.dismiss")}
              className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-danger/10"
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          </div>
        ))}
        {commandMotion.shown && (
          <ComposerCommandMenu
            listRef={commandListRef}
            className={commandMotion.className}
            exitProps={commandMotion.exitProps}
            items={commandCandidates}
            highlight={highlight}
            loading={group ? groupEngineCommands.loading : engineCommands.loading}
            onRefresh={group
              ? groupEngineCommands.lists.some((list) => list.answer.available) ? groupEngineCommands.refresh : undefined
              : engineCommands.answer?.available ? engineCommands.refresh : undefined}
            onPick={pickCommand}
            onHighlight={setHighlight}
          />
        )}
        {mentionMotion.shown && (
          <div
            ref={mentionListRef}
            role="listbox"
            aria-label={t("composer.mention.aria")}
            className={cn("absolute bottom-full left-2 z-20 mb-2 max-h-72 w-72 overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-hairline/40 bg-raised shadow-lg", mentionMotion.className)} {...mentionMotion.exitProps}
          >
            {candidates.map((peer, i) => (
              <button
                key={peer.id}
                data-mention-index={i}
                role="option"
                aria-selected={i === highlight}
                onClick={() => pickMention(peer)}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                  i === highlight ? "bg-raised-hover" : "",
                )}
              >
                {peer.bot ? (
                  <BotAvatar
                    bot={peer.bot}
                    state={normalizeState(peer.bot.mascotExpression) ?? "happy"}
                    size={24}
                  />
                ) : (
                  <span className="flex size-6 items-center justify-center rounded-full bg-raised text-ink-secondary">
                    <Users size={14} aria-hidden="true" />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{peer.name}</span>
                <span className="shrink-0 text-xs text-ink-secondary">
                  {peer.bot ? t("composer.mention.agent") : t("composer.mention.channel")}
                </span>
              </button>
            ))}
          </div>
        )}
        {/* An approval takes over the composer: you answer it before you
            can type again, so a waiting bot is impossible to miss. */}
        {approval && (
          <PendingApprovalBox
            approvals={approvals}
            threadId={threadId}
            botFor={approvalBotFor}
            onCancelTurn={interruptTurn}
            locale={activeLocale()}
          />
        )}
        {replyTo && (
          <div className="mb-2 px-1">
            <ReplyQuote
              message={replyTo}
              fallbackName={bot?.name}
              onClear={onClearReply}
            />
          </div>
        )}
        <ComposerAttachments
          items={attachments}
          onAdd={addAttachments}
          onRemove={removeAttachment}
          onChangeCitation={(citation: CitationAttachment) => editAttachments((current) => current.map((attachment) => attachment.id === citation.id ? citation : attachment))}
          onDisplayInChatBox={displayPasteInChatBox}
          allowImages={engineSupportsImages}
          notice={attachmentNotice}
          onNotice={setAttachmentNotice}
          onPendingChange={(pending) => changeDraftAttachmentPending(draftId, pending)}
          uploadImage={uploadImage}
        />
        {busyChoice && offersBusyChoice && (
          <BusySendChooser
            highlighted={busyChoice}
            onHighlight={setBusyChoice}
            onPick={(mode) => send(mode)}
            onClose={() => setBusyChoice(null)}
            name={busyName}
          />
        )}
        <QueuedComposerMessages
          items={queuedMessages}
          onSteer={canSteerQueued ? steerQueued : undefined}
          steerInterrupts={!canSteer}
          steerMode={group ? "next" : "all"}
          steering={steering}
          onCancel={(queueId) => {
            if (group) dispatch({ type: "cancelGroupQueued", groupId: group.id, threadId, queueId });
            else if (bot) dispatch({ type: "cancelQueued", botId: bot.id, threadId, queueId });
          }}
          onEdit={locked ? undefined : editQueued}
        />
        <div className="relative">
          {/* App-ground from the pill midline down, full-bleed. Bubbles may
              tuck into the top half of the radius; they must not show below
              center. End at the dock's pb-4 padding: a viewport-height
              backdrop extends the document and lets focus scroll the header
              away. Only the decoration is bounded; upward menus stay free. */}
          <div
            aria-hidden
            data-composer-backdrop
            className="pointer-events-none absolute -left-[50vw] -right-[50vw] -bottom-4 top-1/2 bg-app"
          />
        <div data-tour="composer" className="relative z-[1] min-h-11 rounded-[22px] border-[0.5px] border-border bg-composer px-2 py-1.5 shadow-[0_2px_8px_-1px_#0000000d,0_1px_2px_#00000008,0_0_0_1px_#e4e4e40a] transition-colors hover:border-border-strong focus-within:border-border-strong">
        <div className="flex items-end gap-1">
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void pickFiles(e.target.files);
              // same file twice in a row still fires onChange
              e.target.value = "";
            }}
          />
          {!locked && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                aria-label={t("composer.attach")}
                title={t("composer.attach")}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-control hover:text-ink"
              >
                <Paperclip size={17} />
              </button>
              {group && !group.dm && (
                <button
                  type="button"
                  aria-pressed={effectiveChannelMode === "goal"}
                  aria-label={t("composer.goal.aria")}
                  title={t("composer.goal.title")}
                  onClick={() => {
                    markDraftEdited(draftId);
                    if (typedGoalText !== null) {
                      const nextCaret = Math.max(0, caret - (text.length - typedGoalText.length));
                      editText(typedGoalText);
                      setCaret(nextCaret);
                      setChannelMode("chat");
                      requestAnimationFrame(() => {
                        inputRef.current?.focus();
                        inputRef.current?.setSelectionRange(nextCaret, nextCaret);
                      });
                      return;
                    }
                    setChannelMode((current) => current === "goal" ? "chat" : "goal");
                  }}
                  className={cn(
                    "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors",
                    effectiveChannelMode === "goal"
                      ? "border-accent/35 bg-accent/10 text-accent"
                      : "border-hairline/20 bg-transparent text-ink-secondary hover:bg-raised hover:text-ink",
                  )}
                >
                  <Target size={14} aria-hidden="true" />
                  {effectiveChannelMode === "goal" ? "/goal" : t("composer.goal.chip")}
                </button>
              )}
              {modeBot && approvalEngine && !remoteClient && (
                <ApprovalModeSelector
                  approvalMode={modeBot.approvalMode}
                  autoApprove={modeBot.autoApprove}
                  providerName={approvalEngine.displayName}
                  driverKind={approvalEngine.driverKind}
                  onSelect={setApprovalMode}
                  disabled={Boolean(modeBot.busy)}
                  trustedModesAvailable={trustedThreadAccess}
                  orgFullAccess={orgFullAccess}
                  onManageCommandAllowlist={ownerOrAdmin === true ? () => setCommandAllowlistTarget({ botId: modeBot.id, botName: modeBot.name, threadId: modeBot.threadId }) : undefined}
                />
              )}
              {modeBot && !remoteClient && (
                <PlaceChip
                  bot={modeBot}
                  task={composerTask}
                  live={Boolean(modeBot.busy)}
                  disabled={Boolean(modeBot.busy)}
                  onPin={(surface) => dispatch({ type: "updateTask", botId: modeBot.id, threadId: modeBot.threadId, patch: { surface } })}
                />
              )}
            </div>
          )}
          <MentionTextarea
          inputRef={inputRef}
          peers={group ? members ?? [] : state.bots.filter((member) => member.id !== bot?.id)}
          everyone={Boolean(group && !group.dm)}
          // the message is composed in the writer's language, not the UI's
          dir="auto"
          rows={1}
          value={text}
          onChange={(e) => {
            editText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setDismissedAt(null);
            setDismissedSlashAt(null);
          }}
          onPaste={handlePaste}
          onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (commandPickerOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setHighlight((current) =>
                  (current + delta + commandCandidates.length) % commandCandidates.length,
                );
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickCommand(commandCandidates[highlight]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissedSlashAt(slash?.start ?? null);
                return;
              }
            }
            if (mentionPickerOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setHighlight((h) => (h + delta + candidates.length) % candidates.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMention(candidates[highlight]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissedAt(mention?.start ?? null);
                return;
              }
            }
            if (busyChoice) {
              if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                setBusyChoice(moveBusyChoice(busyChoice, e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1));
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setBusyChoice(null);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(busyChoice);
                return;
              }
            }
            // an empty composer + ArrowUp = edit your last message (like a chat app)
            if (e.key === "ArrowUp" && !hasContent && onEditLast) {
              e.preventDefault();
              onEditLast();
              return;
            }
            // Shift+Enter inserts a newline; plain Enter sends
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              // The second Enter of the gesture: the chip above is waiting,
              // the composer is empty, and the window is open — steer the
              // queue into the running turn instead of waiting it out.
              if (
                canSteer &&
                doubleEnterSteersQueue(steerAgainUntilRef.current, Date.now(), pendingCount, hasContent)
              ) {
                steerAgainUntilRef.current = 0;
                steerQueued();
                return;
              }
              send();
            }
            if (e.key === "Escape" && recording) setRecording(false);
          }}
          // an upload in flight must not disable the box: a disabled element
          // drops keyboard focus and never gets it back, so the writer had to
          // click the input again after every pasted image (#1014). send()
          // already refuses while an attachment is pending.
          disabled={Boolean(approval) || locked}
          aria-busy={bot?.awaitingThreadSnapshot || undefined}
          placeholder={
            approval
              ? t("composer.placeholder.approval")
              : attachmentPending
              ? t("composer.placeholder.attaching")
              : recording
              ? t("composer.placeholder.listening")
              : offersBusyChoice && busySendPreference === "ask"
                ? t("composer.placeholder.busyChoice", { name: busyName })
              : busy && canSteer
                ? pendingCount > 0
                  ? t("composer.placeholder.steerQueued", { name: busyName })
                  : t("composer.placeholder.steer", { name: busyName })
              : busy
                ? group
                  ? t("composer.placeholder.queueGroup", { name: busyName })
                  : t("composer.placeholder.queue", { name: busyName })
                : group
                  ? channelMode === "goal"
                    ? t("composer.placeholder.goal", { name: group.name })
                    : t("composer.placeholder.group", {
                        name: group.name,
                        hint: groupComposerHint(group, members ?? [], { jevOn: jevRoomRoutingOn(state.config) }),
                      })
                  : t("composer.placeholder.bot", { name: bot?.name ?? "" })
          }
          aria-label={t("composer.placeholder.bot", { name: group ? group.name : (bot?.name ?? "") })}
            className="block max-h-[7.5rem] min-h-6 w-full resize-none overflow-y-auto bg-transparent chat-input-text px-1 py-1.5 placeholder:text-ink-secondary focus:outline-none"
          />
          <div className="flex items-center gap-1">
          {bot && !group && !remoteClient && (
            <ModelPicker inComposer key={bot.threadId} bot={bot} threadId={threadId} />
          )}
          {/* Stop stays a stop. Stop-then-steer is named beside the queued
              message above, where its effect is visible before activation. */}
          {busy && !locked && (
          <button
            onClick={interruptTurn}
            aria-label={t("chat.stopTurn")}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
            title={t("chat.stop")}
          >
            <Square size={14} className="fill-current" />
          </button>
        )}
        {!locked && !busy && !hasContent && capabilities.dictation.available && (
          <button
            onClick={toggleMic}
            aria-label={recording ? t("composer.dictation.stop") : t("composer.dictation.start")}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full",
              recording
                ? "animate-pulse bg-danger/20 text-danger"
                : "text-ink-secondary ring-1 ring-hairline/60 hover:bg-raised hover:text-ink",
            )}
            title={recording ? t("composer.dictation.stopHint") : t("composer.dictation.hint")}
          >
            <Mic size={18} />
          </button>
        )}
        {bot && !group && <CallButton bot={bot} />}
        {group && <GroupCallButton group={group} members={members ?? []} />}
        {(hasContent || retroSkin) && !locked && (
          <button
            onClick={() => send()}
            disabled={attachmentPending || !hasContent}
            data-r98-send={retroSkin ? "" : undefined}
            aria-label={
              busy && canSteer
                  ? t("composer.send.steer")
                  : busy
                    ? t("composer.send.queue")
                    : t("composer.send.message")
            }
            title={
              busy && canSteer
                  ? t("composer.send.steer")
                  : busy
                    ? t("composer.send.queueHint")
                    : t("chat.send")
            }
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full text-white",
              busy && !canSteer
                  ? "bg-raised text-ink-secondary hover:bg-raised-hover"
                  : "bg-accent hover:brightness-110",
            )}
          >
            {busy && !canSteer ? <Clock size={15} /> : <ArrowUp size={17} />}
            {/* Hibou 98 draws Send as a labelled push button */}
            {retroSkin && <span className="r98-send-label">{t("chat.send")}</span>}
          </button>
          )}
          </div>
        </div>
        </div>
        </div>
      </div>
      <div className="pointer-events-auto">
      {commandAllowlistTarget && <CommandAllowlistDialog
        key={`${commandAllowlistTarget.botId}:${commandAllowlistTarget.threadId}`}
        {...commandAllowlistTarget}
        onClose={() => setCommandAllowlistTarget(null)}
      />}
      <FullAccessWarning
        open={approvalWarning?.mode === "full"}
        scope={perspicaxOrg ? "organization" : "thread"}
        onCancel={() => setApprovalWarning(null)}
        onConfirm={() => {
          const target = approvalWarning;
          setApprovalWarning(null);
          if (target?.mode !== "full" || !fullAccessAvailable) return;
          dispatch({ type: "updateTask", botId: target.botId, threadId: target.threadId,
            patch: { approvalMode: "full", confirmFullAccess: true, ...(perspicaxOrg ? { organizationFullAccess: true } : {}) } });
        }}
      />
      <LocalComputerAutoWarning
        open={approvalWarning?.mode === "auto"}
        onCancel={() => setApprovalWarning(null)}
        onConfirm={() => {
          if (approvalWarning?.mode === "auto") {
            dispatch({
              type: "updateTask",
              botId: approvalWarning.botId,
              threadId: approvalWarning.threadId,
              patch: { approvalMode: "auto", acknowledgeLocalAuto: true },
            });
          }
          setApprovalWarning(null);
        }}
      />
      </div>
    </div>
  );
}
