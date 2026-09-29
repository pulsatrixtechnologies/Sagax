// An email the bot drafted, shown the way a mail client would: header rows,
// a formatted body, and the three things a person does with a draft here:
// copy it, copy it with formatting for a rich editor, or open it in their
// mail app. There is no "send" and no server-side draft: the app has no
// mail API, so nothing leaves the machine unless the person sends it.
import { memo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ClipboardCopy, Copy, Mail, SquareArrowOutUpRight } from "lucide-react";

import { t } from "@/lib/i18n";
import { emailMailtoUrl, emailPlainBody, emailPlainText, type EmailDraft } from "@/lib/rich-blocks";
import { useCopyFeedback } from "./rich-ui";

/** Open a mailto: URL. In the desktop app window.open reaches the main
 * process' window-open handler, which validates the scheme and hands it to
 * the OS; in a browser the anchor's own navigation does the job. */
function openMailto(url: string, event: { preventDefault(): void }) {
  if (typeof window !== "undefined" && window.ogb) {
    event.preventDefault();
    window.open(url, "_blank", "noopener");
  }
}

function HeaderRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-3 py-1">
      <dt className="w-16 shrink-0 text-[12px] text-ink-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-[13px] text-ink">{value}</dd>
    </div>
  );
}

function EmailCardComponent({ draft, pending = false }: { draft: EmailDraft; pending?: boolean }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const { copied, copy } = useCopyFeedback();
  const [notice, setNotice] = useState("");
  const mailto = emailMailtoUrl(draft);

  const copyRich = () => {
    // The body was rendered by react-markdown without raw HTML, so its markup
    // is our own elements and escaped text: safe to hand to a rich editor.
    const html = bodyRef.current?.innerHTML ?? "";
    const subject = draft.subject ? `<p><strong>${escapeHtml(draft.subject)}</strong></p>` : "";
    void copy("rich", emailPlainBody(draft.body), `<meta charset="utf-8">${subject}${html}`);
  };

  return (
    <article dir="auto" aria-label={t("rich.email.aria", { subject: draft.subject || t("rich.email.noSubject") })} className="my-2 min-w-0 overflow-hidden rounded-xl border border-hairline/40 bg-panel shadow-sm">
      <header className="flex items-center gap-2 border-b border-hairline/30 bg-raised/30 px-3 py-2 text-[12px] text-ink-secondary">
        <Mail size={14} aria-hidden="true" />
        <span className="font-medium text-ink">{t("rich.email.title")}</span>
        {pending && <span className="ms-auto text-[11px]">{t("rich.pending")}</span>}
      </header>
      <dl className="divide-y divide-hairline/20 border-b border-hairline/30 px-3 py-1">
        {draft.from && <HeaderRow label={t("rich.email.from")} value={draft.from} />}
        {draft.to.length > 0 && <HeaderRow label={t("rich.email.to")} value={draft.to.join(", ")} />}
        {draft.cc.length > 0 && <HeaderRow label={t("rich.email.cc")} value={draft.cc.join(", ")} />}
        {draft.bcc.length > 0 && <HeaderRow label={t("rich.email.bcc")} value={draft.bcc.join(", ")} />}
        <div className="flex min-w-0 gap-3 py-1">
          <dt className="w-16 shrink-0 text-[12px] text-ink-secondary">{t("rich.email.subject")}</dt>
          <dd className="min-w-0 break-words text-[13.5px] font-semibold text-ink">{draft.subject || <span className="font-normal text-ink-secondary">{t("rich.email.noSubject")}</span>}</dd>
        </div>
      </dl>
      <div ref={bodyRef} className="space-y-2 px-4 py-3 text-[14px] leading-relaxed text-ink [&_p]:whitespace-pre-line [&_a]:text-accent [&_a]:underline [&_li]:ms-5 [&_ol]:list-decimal [&_ul]:list-disc">
        <Markdown remarkPlugins={[remarkGfm]} components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
          img: ({ alt }) => <span>{alt}</span>,
        }}>
          {draft.body}
        </Markdown>
      </div>
      <footer className="flex flex-wrap items-center gap-1.5 border-t border-hairline/30 bg-raised/20 px-3 py-2">
        <button
          type="button"
          onClick={() => void copy("plain", emailPlainText(draft))}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-hairline/40 bg-panel px-2.5 text-[12px] text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {copied === "plain" ? <Check size={13} className="text-success" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {copied === "plain" ? t("rich.copied") : t("rich.email.copy")}
        </button>
        <button
          type="button"
          onClick={copyRich}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-hairline/40 bg-panel px-2.5 text-[12px] text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {copied === "rich" ? <Check size={13} className="text-success" aria-hidden="true" /> : <ClipboardCopy size={13} aria-hidden="true" />}
          {copied === "rich" ? t("rich.copied") : t("rich.email.copyRich")}
        </button>
        <a
          href={mailto.url}
          onClick={(event) => {
            if (!mailto.bodyIncluded && draft.body) {
              void copy("rich-body", emailPlainBody(draft.body));
              setNotice(t("rich.email.bodyCopied"));
            }
            openMailto(mailto.url, event);
          }}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[12px] font-medium text-accent-ink hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <SquareArrowOutUpRight size={13} aria-hidden="true" />
          {t("rich.email.open")}
        </a>
        {notice && <span role="status" className="text-[11.5px] text-ink-secondary">{notice}</span>}
      </footer>
    </article>
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export const EmailCard = memo(EmailCardComponent, (previous, next) =>
  previous.pending === next.pending && JSON.stringify(previous.draft) === JSON.stringify(next.draft));
