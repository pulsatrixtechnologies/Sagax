// A passing banner over the chat for a notice that is never a row
// (shared/transient-notices.ts): a routine run that failed, a routine's
// access card. It leaves on its own after a few seconds, when the person
// closes it, or (access) once the routine has run again; it never comes back.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { t } from "@/lib/i18n";
import { pickTransientNotice, readShownNotices, rememberShownNotice, transientNoticeSettled } from "@/lib/transient-notice";
import { TRANSIENT_NOTICE_RULES } from "../../shared/transient-notices";
import type { Message } from "@/state/store";

export function TransientNotice({ messages, render }: {
  messages: readonly Message[];
  /** The notice's own content: the routine run line, the access card. */
  render: (message: Message, close: () => void) => ReactNode;
}) {
  const shown = useRef<Set<string> | null>(null);
  const [active, setActive] = useState<Message | null>(null);

  useEffect(() => {
    shown.current ??= readShownNotices();
    if (active) {
      if (transientNoticeSettled(active, messages)) setActive(null);
      return;
    }
    const next = pickTransientNotice(messages, Date.now(), shown.current);
    if (!next) return;
    rememberShownNotice(shown.current, next.id);
    setActive(next);
  }, [messages, active]);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(null), TRANSIENT_NOTICE_RULES.visibleMs);
    return () => clearTimeout(timer);
  }, [active]);

  if (!active) return null;
  const close = () => setActive(null);
  return (
    <div className="w-full px-5" data-transient-notice={active.id}>
      <div role="status" className="mb-2 flex items-start gap-2 rounded-lg border border-hairline/40 bg-panel px-3 py-2 text-[13px] text-ink-secondary">
        <div className="min-w-0 flex-1">{render(active, close)}</div>
        <button type="button" onClick={close} aria-label={t("common.close")} className="shrink-0 rounded p-0.5 hover:text-ink">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
