// B2.1 (docs/tool-policy.md §4): the guard runs BEFORE the approval card.
// An agents__<tool> permission request is checked against the grants first
// (the bot's own, then the person its turn speaks for); only then does the
// card reach a person. Every request leaves an audit row at both ends: when
// it is opened (with the guard decision) and when it is declined, timed out
// or refused, so shadow data counts the writes nobody approved too.
//
// Mode shadow (default): the decision is recorded and the card shows as
// before. Mode enforce: a refused call is denied without a card.
import { AGENT_TOOL_POLICY, agentToolGuardPolicy, isAgentToolName, type AgentToolName } from "./agent-api.ts";
import { guardDecision, type GuardDecision, type ToolGuardMode } from "./tool-guard.ts";
import type { ToolGrantStore } from "./tool-grants.ts";

export interface CardGuardRow {
  tool: AgentToolName;
  botId: string;
  botName?: string;
  outcome: "card" | "refused" | "declined" | "expired";
  detail: Record<string, unknown>;
}

export interface CardGuardDeps {
  grants: Pick<ToolGrantStore, "holds">;
  mode: () => ToolGuardMode;
  audit(row: CardGuardRow): void;
}

export interface CardGuardOpen {
  requestId: string;
  mcpTool: string;
  bot: { id: string; name?: string };
  /** The person the bot's turn speaks for; absent for routines or unknown. */
  speakerPrincipalId?: string;
}

const PREFIX = "agents__";

export function createAgentCardGuard(deps: CardGuardDeps) {
  const pending = new Map<string, { tool: AgentToolName; bot: CardGuardOpen["bot"]; base: Record<string, unknown> }>();
  return {
    /** null: not an agent tool (or guard off). deny: refuse without a card. */
    opened(input: CardGuardOpen): { deny: boolean; decision: GuardDecision } | null {
      const mode = deps.mode();
      // Claude names it mcp__agents__<tool>; ACP and Codex agents__<tool>
      const name = input.mcpTool.replace(/^mcp__/, "");
      if (mode === "off" || !name.startsWith(PREFIX)) return null;
      const tool = name.slice(PREFIX.length);
      if (!isAgentToolName(tool)) return null;
      const policy = agentToolGuardPolicy(AGENT_TOOL_POLICY[tool]);
      const decision = guardDecision(policy, { kind: "bot", id: input.bot.id },
        input.speakerPrincipalId ? { kind: "user", id: input.speakerPrincipalId } : null, deps.grants as ToolGrantStore);
      const deny = !decision.allow && mode === "enforce";
      const base = {
        phase: "pre_card", requestId: input.requestId, access: policy.tier, readOnly: policy.readOnly, scope: policy.scope,
        guard: decision.reason, guardAllow: decision.allow, guardMode: mode,
        speakerPrincipalId: input.speakerPrincipalId ?? null,
      };
      deps.audit({ tool, botId: input.bot.id, ...(input.bot.name ? { botName: input.bot.name } : {}), outcome: deny ? "refused" : "card", detail: base });
      if (!deny) pending.set(input.requestId, { tool, bot: input.bot, base });
      return { deny, decision };
    },
    /** The card's answer: an allow is audited by the call itself; anything else here. */
    resolved(requestId: string, behavior: string, source?: string): void {
      const open = pending.get(requestId);
      if (!open) return;
      pending.delete(requestId);
      if (behavior === "allow") return;
      deps.audit({
        tool: open.tool, botId: open.bot.id, ...(open.bot.name ? { botName: open.bot.name } : {}),
        outcome: source === "timeout" ? "expired" : "declined",
        detail: { ...open.base, phase: "card_answer", source: source ?? "user" },
      });
    },
    pendingCount: () => pending.size,
  };
}
