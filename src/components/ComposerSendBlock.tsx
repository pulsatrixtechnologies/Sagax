import { CircleAlert } from "lucide-react";

import { sendBlockActionLabel, sendBlockText, type SendBlock } from "@/lib/send-state";

/** The one line above the composer while the bot cannot answer this person
 * (src/lib/send-state.ts): the reason and the one thing to do. */
export function ComposerSendBlock({ block, onConnect, onRetry }: { block: SendBlock; onConnect: () => void; onRetry: () => void }) {
  return (
    <div data-composer-send-block={block.reason} role="status" className="mb-2 flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] text-ink-secondary">
      <CircleAlert size={14} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 break-words">{sendBlockText(block)}</span>
      <button
        type="button"
        data-composer-send-block-action={block.action.kind}
        className="shrink-0 rounded-md px-2 py-0.5 font-medium text-ink hover:bg-hover"
        onClick={block.action.kind === "connect" ? onConnect : onRetry}
      >
        {sendBlockActionLabel(block)}
      </button>
    </div>
  );
}
