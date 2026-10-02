// Pieces shared by the in-chat approval card and the composer's pending
// approval panel, so both read the same way: avatar, a human title, a risk
// chip, and the raw tool id + JSON only behind "See technical details".
import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, Eye, PencilLine, Play, Trash2 } from "lucide-react";
import type { Bot } from "@/state/store";
import { BotAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { RISK_LABEL, type ApprovalRisk } from "@/lib/approval-describe";

const RISK_STYLE: Record<ApprovalRisk, string> = {
  read: "border-success/35 bg-success/10 text-success",
  write: "border-warning/35 bg-warning/10 text-warning",
  execute: "border-warning/35 bg-warning/10 text-warning",
  destructive: "border-danger/40 bg-danger/10 text-danger",
};

const RISK_ICON = { read: Eye, write: PencilLine, execute: Play, destructive: Trash2 } as const;

export function RiskChip({ risk }: { risk: ApprovalRisk }) {
  const Icon = RISK_ICON[risk];
  return (
    <span
      data-risk={risk}
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", RISK_STYLE[risk])}
    >
      <Icon size={11} aria-hidden="true" />
      {t(RISK_LABEL[risk])}
    </span>
  );
}

/** Avatar, title and chips on one row; the summary under the title. */
export function ApprovalHeading({
  bot,
  title,
  summary,
  risk,
  aside,
}: {
  bot?: Bot;
  title: ReactNode;
  summary?: string;
  risk?: ApprovalRisk;
  /** right side of the title row (the stepper) */
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      {bot?.color && <BotAvatar bot={bot} size={30} animated={false} />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[15px] font-semibold leading-snug text-ink">{title}</span>
          {risk && <RiskChip risk={risk} />}
        </div>
        {summary && <div className="mt-0.5 text-[13px] leading-snug text-ink-secondary">{summary}</div>}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
  );
}

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Pretty JSON with keys, strings, numbers and literals colored. Plain
 * text (a command) passes through uncolored. */
export function JsonText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(JSON_TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const [whole, str, colon, literal, number] = match;
    if (str !== undefined) {
      out.push(<span key={index++} className={colon ? "text-accent" : "text-success"}>{str}</span>);
      if (colon) out.push(colon);
    } else if (literal !== undefined) {
      out.push(<span key={index++} className="text-danger">{literal}</span>);
    } else if (number !== undefined) {
      out.push(<span key={index++} className="text-warning">{number}</span>);
    } else {
      out.push(whole);
    }
    last = at + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {});
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-secondary hover:bg-control hover:text-ink"
    >
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      {copied ? t("approval.details.copied") : t("approval.details.copy")}
    </button>
  );
}

/** "See technical details": collapsed by default, it holds the tool id,
 * its server and the arguments as colored, scrollable JSON. */
export function TechnicalDetails({
  tool,
  server,
  args,
  defaultOpen = false,
  argsLabel,
}: {
  tool?: string;
  server?: string;
  args?: string;
  defaultOpen?: boolean;
  /** aria-label of the arguments block */
  argsLabel?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!tool && !args) return null;
  return (
    <div className="mt-2" data-technical-details={open ? "open" : "closed"}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 rounded-md py-0.5 text-[12.5px] text-ink-secondary hover:text-ink"
      >
        <ChevronDown size={13} aria-hidden="true" className={cn("transition-transform", open ? "rotate-0" : "-rotate-90")} />
        {open ? t("approval.details.hide") : t("approval.details.show")}
      </button>
      {open && (
        <div className="mt-1.5 rounded-xl border border-hairline/40 bg-inset px-3 py-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
            {tool && (
              <>
                <dt className="text-ink-secondary">{t("approval.details.tool")}</dt>
                <dd className="min-w-0 break-all font-mono text-ink">{tool}</dd>
              </>
            )}
            {server && (
              <>
                <dt className="text-ink-secondary">{t("approval.details.server")}</dt>
                <dd className="min-w-0 break-all font-mono text-ink">{server}</dd>
              </>
            )}
          </dl>
          {args && (
            <>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[12px] text-ink-secondary">{t("approval.details.arguments")}</span>
                <CopyButton text={args} />
              </div>
              <pre
                tabIndex={0}
                aria-label={argsLabel ?? t("approval.aria.details")}
                className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink"
              >
                <JsonText text={args} />
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
