// B2: the one decision every agent tool call goes through (docs/tool-policy.md):
// the policy row, the caller's grants and, for a bot, the person its turn
// speaks for. A bot never reaches past its speaker. Writes and admin calls
// still raise the Sagax approval card in the engine; this decides whether the
// call may happen at all.
//
// Mode "shadow" (the default) records the decision in the audit and lets the
// call through, so it can be compared with live traffic before "enforce".
import type { GrantSubject, ToolGrantStore } from "./tool-grants.ts";
import type { ToolTier } from "./tool-policy.ts";

export type ToolGuardMode = "off" | "shadow" | "enforce";
export interface GuardPolicy { tier: ToolTier; scope: string; readOnly: boolean; defaultEnabled: boolean }
export type GuardReason = "default" | "grant" | "not_granted" | "speaker_not_granted";
export interface GuardDecision { allow: boolean; reason: GuardReason; needsApproval: boolean }

export function guardDecision(policy: GuardPolicy, subject: GrantSubject, speaker: GrantSubject | null, grants: ToolGrantStore): GuardDecision {
  const needsApproval = !policy.readOnly;
  if (policy.defaultEnabled && policy.tier !== "admin") return { allow: true, reason: "default", needsApproval };
  if (!grants.holds(subject, policy.scope)) return { allow: false, reason: "not_granted", needsApproval };
  if (subject.kind === "bot" && speaker && !grants.holds(speaker, policy.scope)) return { allow: false, reason: "speaker_not_granted", needsApproval };
  return { allow: true, reason: "grant", needsApproval };
}

export function toolGuardMode(value: string | undefined): ToolGuardMode {
  return value === "enforce" || value === "off" ? value : "shadow";
}
