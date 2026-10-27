// The Journal on the client (shared/action-journal.ts for the shape,
// server/routes/approvals-inbox.ts for the routes): the list while the tab is
// open, "Tester cette règle", and the plain words a row reads as. Never an
// id on screen.
import { useCallback, useEffect, useRef, useState } from "react";

import { JOURNAL_SELF, type JournalDecider, type JournalEntry, type JournalOutcome, type JournalPayload, type RuleTestDraft, type RuleTestEffect, type RuleTestResult } from "../../shared/action-journal";
import { approvalAction } from "@/lib/approval-describe";
import { whoLabel } from "@/lib/activity";
import { withoutIds } from "@/lib/approvals-inbox";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { api } from "@/state/store";

export async function loadJournal(days: number): Promise<JournalPayload> {
  return api<JournalPayload>(`/api/approvals/journal?days=${days}`);
}

export async function testRule(rule: RuleTestDraft): Promise<RuleTestResult> {
  return api<RuleTestResult>("/api/approvals/journal/test", { method: "POST", body: JSON.stringify({ rule }) });
}

/** The Journal reads days of logs: polled once a minute while visible. */
const JOURNAL_POLL_MS = 60_000;

export function useJournal(active: boolean, days: number): { data: JournalPayload | null; error: string | null; refresh: () => Promise<void> } {
  const [data, setData] = useState<JournalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const daysRef = useRef(days);
  daysRef.current = days;
  const refresh = useCallback(async () => {
    try {
      const next = await loadJournal(daysRef.current);
      if (next.days === daysRef.current) setData(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, JOURNAL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, days, refresh]);
  return { data, error, refresh };
}

export const OUTCOME_LABEL: Record<JournalOutcome, LocaleKey> = {
  allowed: "approvals.journal.outcome.allowed",
  asked: "approvals.journal.outcome.asked",
  denied: "approvals.journal.outcome.denied",
  failed: "approvals.journal.outcome.failed",
  expired: "approvals.journal.outcome.expired",
};

export const OUTCOME_TONE: Record<JournalOutcome, "success" | "warning" | "danger" | "neutral"> = {
  allowed: "success",
  asked: "warning",
  denied: "danger",
  failed: "danger",
  expired: "neutral",
};

const DECIDER_LABEL: Record<JournalDecider, LocaleKey> = {
  "custom-rule": "approvals.journal.decider.customRule",
  "org-rule": "approvals.journal.decider.orgRule",
  "always-allow": "approvals.journal.decider.alwaysAllow",
  "admin-rule": "approvals.journal.decider.adminRule",
  level: "approvals.journal.decider.level",
  "full-access": "approvals.journal.decider.fullAccess",
  grant: "approvals.journal.decider.grant",
  default: "approvals.journal.decider.default",
  reviewer: "approvals.journal.decider.reviewer",
  safety: "approvals.journal.decider.safety",
  sagax: "approvals.journal.decider.sagax",
  person: "approvals.journal.decider.person",
  expired: "approvals.journal.decider.expired",
  error: "approvals.journal.decider.error",
  "no-card": "approvals.journal.decider.noCard",
};

/** The level that answered, when the source says which one. */
function levelLabel(source: string | undefined): string | null {
  if (source === "owner-auto") return t("approvals.journal.level.approveForMe");
  if (source === "no-grant") return t("approvals.journal.level.ask");
  return null;
}

/** "Decided by" in plain words: the rule's own words when a rule decided,
 * the level, the person who answered, or what Sagax itself allowed. */
export function deciderLine(entry: Pick<JournalEntry, "decider" | "source" | "ruleText" | "answeredBy" | "guard">): string {
  const base = t(DECIDER_LABEL[entry.decider] ?? "approvals.journal.decider.sagax");
  if (entry.ruleText && (entry.decider === "custom-rule" || entry.decider === "org-rule" || entry.decider === "always-allow" || entry.decider === "reviewer")) {
    return t("approvals.journal.withRule", { label: base, rule: withoutIds(entry.ruleText) });
  }
  if (entry.decider === "level") {
    const level = levelLabel(entry.source);
    return level ? t("approvals.journal.withLevel", { label: base, level }) : base;
  }
  if (entry.decider === "person") {
    const who = entry.answeredBy === JOURNAL_SELF || !entry.answeredBy ? t("approvals.journal.you") : withoutIds(whoLabel(entry.answeredBy));
    return t("approvals.journal.answeredBy", { name: who });
  }
  if ((entry.decider === "grant" || entry.decider === "default") && entry.guard?.scope) {
    return t("approvals.journal.withScope", { label: base, scope: entry.guard.scope });
  }
  return base;
}

/** The tool guard's verdict in words, when it matters: what enforcing would
 * have refused while the guard only records (shadow, the default). */
export function guardLine(entry: Pick<JournalEntry, "guard">): string | null {
  const guard = entry.guard;
  if (!guard) return null;
  if (guard.allow) return guard.reason === "grant" ? t("approvals.journal.guard.granted") : null;
  if (guard.mode === "shadow") return t("approvals.journal.guard.shadow");
  if (guard.mode === "enforce") return t("approvals.journal.guard.refused");
  return null;
}

/** The row's title: what the bot did, in the reader's language. */
export function journalTitle(entry: Pick<JournalEntry, "tool" | "summary">): string {
  const text = withoutIds(approvalAction(entry.tool, undefined));
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : withoutIds(entry.summary ?? "");
}

export const EFFECT_LABEL: Record<RuleTestEffect, LocaleKey> = {
  allowed: "approvals.journal.test.would.allowed",
  asked: "approvals.journal.test.would.asked",
  denied: "approvals.journal.test.would.denied",
  "card-stays": "approvals.journal.test.would.cardStays",
};
