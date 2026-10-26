// A real conversation inside the wizard, in the chat view's compact form,
// the way a task window shows one (bot-settings/ActivityConversation.tsx):
// the thread's newest page, then the live stream (useSideTranscript), with
// its own composer. Used for the guided conversation with the Primary Bot
// and for "Try it" with the bot being made. No new route.
import { useMemo } from "react";
import { Loader2 } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { useSideTranscript } from "@/lib/use-side-transcript";
import { BotAvatar } from "../Avatar";
import { ChatView } from "../ChatView";

export function WizardConversation({ botId, threadId, title, className }: {
  botId: string;
  threadId: string;
  title: string;
  className?: string;
}) {
  const { state } = useStore();
  const bot = state.bots.find((candidate) => candidate.id === botId);
  const transcript = useSideTranscript(threadId);
  // The chat view reads a bot whose open thread is this one; its other
  // fields stay the store's, so they stay live.
  const threadBot = useMemo<Bot | null>(() => bot ? {
    ...bot,
    threadId,
    messages: transcript.messages,
    activeLeafId: transcript.activeLeafId,
    hasMore: false,
  } : null, [bot, threadId, transcript.messages, transcript.activeLeafId]);

  const header = (
    <div data-wizard-conversation-header className="content-topbar absolute inset-x-0 top-0 z-[3] flex min-h-[52px] items-center gap-2 px-3 py-2.5">
      {bot && <BotAvatar bot={bot} state="idle" size={24} animated={false} />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="truncate text-[13.5px] font-medium leading-5 text-ink">{bot?.name ?? title}</span>
        <span className="truncate text-[11.5px] leading-4 text-ink-secondary">{title}</span>
      </span>
    </div>
  );

  return (
    <div data-wizard-conversation={threadId} className={className ?? "relative flex min-h-0 flex-1 flex-col"}>
      {!threadBot || transcript.failed ? (
        <>
          {header}
          <div role="alert" className="flex flex-1 items-center justify-center px-6 pt-14 text-center text-[13px] text-ink-secondary">{t("sideThread.loadFailed")}</div>
        </>
      ) : !transcript.loaded ? (
        <>
          {header}
          <div role="status" className="flex flex-1 items-center justify-center pt-14 text-ink-secondary">
            <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <span className="sr-only">{t("sideThread.loading")}</span>
          </div>
        </>
      ) : (
        <ChatView bot={threadBot} side={{ header, label: title }} />
      )}
    </div>
  );
}
