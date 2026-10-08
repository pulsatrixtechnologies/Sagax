import { ClipboardList, KeyRound } from "lucide-react";

import { t } from "@/lib/i18n";
import { turnAccessLabel } from "@/lib/perspicax-org";
import type { Message } from "@/state/store";

/** The work digest as one quiet chip under a reply: how many tool calls the
 * turn made and how many files it changed, with the full digest text as the
 * tooltip. Shown under the same setting as tool chips (Settings → Tool
 * calls), because it is the summary of exactly those. */
export function DigestChip({ message, viewerPrincipalId = null }: { message: Message; viewerPrincipalId?: string | null }) {
  const digest = message.digest;
  if (!digest) return null;
  const files = digest.files ? digest.files.changed.length + digest.files.added.length + digest.files.deleted.length + (digest.files.truncated ?? 0) : null;
  // Like the phone transcript, omit receipts for ordinary replies with no
  // observed work (an organization turn still shows which credentials ran it).
  // Missing file capture does not itself imply any changes.
  if (!digest.access && !digest.tools.length && !digest.toolCalls && !digest.toolsDropped &&
      !files && !digest.memory.length && !digest.memoryDropped) return null;
  const tools = digest.toolCalls ?? `${digest.tools.reduce((n, tool) => n + tool.count, 0)}${digest.toolsDropped ? "+" : ""}`;
  const work = files === null
    ? t("chat.digestChipNoFiles", { tools })
    : t("chat.digestChip", { tools, files });
  const label = digest.access ? `${work} · ${t("turnAccess.label", { label: turnAccessLabel(digest.access, viewerPrincipalId) })}` : work;
  return (
    <div className="flex justify-start" data-testid="digest-chip">
      <span
        title={message.text ?? t("chat.digestTitle")}
        className="inline-flex max-w-[480px] items-center gap-1.5 rounded-full border border-hairline/40 bg-panel px-3 py-1 text-[12px] text-ink-secondary"
      >
        <ClipboardList size={12} />
        <span className="truncate">{label}</span>
      </span>
    </div>
  );
}

/** Organization server: which credentials a turn ran with ("Your
 * subscription", "Owner's credentials", ...), shown under the reply even when
 * tool chips are hidden. Never a secret. */
export function TurnAccessChip({ message, viewerPrincipalId = null }: { message: Message; viewerPrincipalId?: string | null }) {
  const access = message.digest?.access;
  if (!access) return null;
  return (
    <div className="flex justify-start" data-testid="turn-access-chip" data-turn-access={access.via}>
      <span className="inline-flex max-w-[480px] items-center gap-1.5 rounded-full border border-hairline/40 bg-panel px-3 py-1 text-[12px] text-ink-secondary">
        <KeyRound size={12} aria-hidden="true" />
        <span className="truncate">{t("turnAccess.label", { label: turnAccessLabel(access, viewerPrincipalId) })}</span>
      </span>
    </div>
  );
}

/** A fold the person asked for is visible even when ordinary tool chips are
 * hidden. Sagax's own folds never show (server/context-budget.ts). */
export function CompactionChip({ message }: { message: Message }) {
  if (!message.compaction || message.compaction.by === "harness") return null;
  return (
    <details className="max-w-[600px] rounded-xl border border-hairline/40 bg-panel px-3 py-2 text-[12px] text-ink-secondary" data-testid="compaction-chip">
      <summary className="cursor-pointer font-medium">{t("chat.compactionTitle")}</summary>
      <p className="mt-2">{t("chat.compactionHint")}</p>
      <p className="mt-2 whitespace-pre-wrap break-words">{message.compaction.summary}</p>
    </details>
  );
}
