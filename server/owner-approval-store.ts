// The owners' approval rules and their bots' permission modes, on disk
// (owner-approvals.json, mode 0600). Spec:
// docs/superpowers/specs/2026-10-14-bot-owner-permissions.md.
//
// Rules are a person's own: every read and write names the person, and a
// rule of one person is never returned to or changed by another. A bot's
// mode remembers who chose it: when the bot's owner is someone else now,
// the mode reads as approval (the default) until the new owner picks one.

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import {
  BOT_PERMISSION_MODES,
  RULE_BEHAVIORS,
  type BotPermissionMode,
  type DestructiveKind,
  type OwnerRule,
  type RuleBehavior,
  type RuleScope,
} from "./owner-approval.ts";

export const MAX_RULES_PER_OWNER = 2_000;
const MAX_DESCRIPTION = 500;

const ruleSchema = z.object({
  id: z.string().min(1).max(64),
  ownerId: z.string().min(1).max(200),
  botId: z.string().min(1).max(200).nullable(),
  tool: z.string().min(1).max(300),
  scope: z.record(z.string().max(40), z.string().max(200)),
  destructive: z.enum(["delete", "bulk", "external-message"]).optional(),
  behavior: z.enum(RULE_BEHAVIORS),
  description: z.string().max(MAX_DESCRIPTION),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const modeSchema = z.object({
  mode: z.enum(BOT_PERMISSION_MODES),
  ownerId: z.string().min(1).max(200),
  at: z.number(),
});

const fileSchema = z.object({
  version: z.literal(1),
  rules: z.array(ruleSchema),
  modes: z.record(z.string(), modeSchema),
});

type FileShape = z.infer<typeof fileSchema>;

export interface NewRule {
  ownerId: string;
  botId: string | null;
  tool: string;
  scope: RuleScope;
  destructive?: DestructiveKind;
  behavior: RuleBehavior;
  description: string;
}

export interface RulePatch {
  behavior?: RuleBehavior;
  description?: string;
  botId?: string | null;
  /** true clears the scope: any target. */
  anyTarget?: boolean;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class OwnerApprovalStore {
  private data: FileShape = { version: 1, rules: [], modes: {} };
  private unreadable = false;

  private readonly file: string;
  private readonly now: () => number;

  constructor(file: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    this.load();
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch {
      return;
    }
    try {
      this.data = fileSchema.parse(JSON.parse(raw));
    } catch {
      // never overwrite a file this process could not read
      this.unreadable = true;
      console.error("[owner-approvals] owner-approvals.json could not be read; rules and modes are ignored until it is repaired.");
    }
  }

  private save(): void {
    if (this.unreadable) throw Object.assign(new Error("Saved approval rules could not be read. Repair owner-approvals.json first."), { status: 503 });
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  /** One person's rules, optionally only those that can apply to one bot. */
  rulesOf(ownerId: string, botId?: string): OwnerRule[] {
    return this.data.rules.filter((rule) => same(rule.ownerId, ownerId) && (botId === undefined || rule.botId === null || rule.botId === botId));
  }

  /** Save a rule for this person. The same tool, scope, kind and bot
   * replaces its behavior instead of adding a second row. */
  add(input: NewRule): OwnerRule {
    const at = this.now();
    const scope = Object.fromEntries(Object.entries(input.scope).slice(0, 8));
    const existing = this.data.rules.find((rule) =>
      same(rule.ownerId, input.ownerId) && rule.botId === input.botId && rule.tool === input.tool
      && rule.destructive === input.destructive && JSON.stringify(rule.scope) === JSON.stringify(scope));
    if (existing) {
      existing.behavior = input.behavior;
      existing.description = input.description.slice(0, MAX_DESCRIPTION);
      existing.updatedAt = at;
      this.save();
      return { ...existing };
    }
    if (this.rulesOf(input.ownerId).length >= MAX_RULES_PER_OWNER) {
      throw Object.assign(new Error(`At most ${MAX_RULES_PER_OWNER} rules per person.`), { status: 409 });
    }
    const rule: OwnerRule = {
      id: `rule_${randomUUID()}`,
      ownerId: input.ownerId,
      botId: input.botId,
      tool: input.tool,
      scope,
      ...(input.destructive ? { destructive: input.destructive } : {}),
      behavior: input.behavior,
      description: input.description.slice(0, MAX_DESCRIPTION),
      createdAt: at,
      updatedAt: at,
    };
    this.data.rules.push(rule);
    this.save();
    return { ...rule };
  }

  /** Change one of this person's rules; null when it is not theirs. */
  update(ownerId: string, id: string, patch: RulePatch): OwnerRule | null {
    const rule = this.data.rules.find((row) => row.id === id && same(row.ownerId, ownerId));
    if (!rule) return null;
    if (patch.behavior) rule.behavior = patch.behavior;
    if (patch.description !== undefined) rule.description = patch.description.trim().slice(0, MAX_DESCRIPTION) || rule.description;
    if (patch.botId !== undefined) rule.botId = patch.botId;
    if (patch.anyTarget) rule.scope = {};
    rule.updatedAt = this.now();
    this.save();
    return { ...rule };
  }

  /** Remove one of this person's rules; false when it is not theirs. */
  remove(ownerId: string, id: string): boolean {
    const before = this.data.rules.length;
    this.data.rules = this.data.rules.filter((row) => !(row.id === id && same(row.ownerId, ownerId)));
    if (this.data.rules.length === before) return false;
    this.save();
    return true;
  }

  /** The bot's mode for its current owner: approval when none was chosen,
   * or when it was chosen by a previous owner. */
  modeOf(botId: string, currentOwnerId: string): BotPermissionMode {
    const row = this.data.modes[botId];
    if (!row || !same(row.ownerId, currentOwnerId)) return "approval";
    return row.mode;
  }

  setMode(botId: string, ownerId: string, mode: BotPermissionMode): void {
    if (mode === "approval") delete this.data.modes[botId];
    else this.data.modes[botId] = { mode, ownerId, at: this.now() };
    this.save();
  }

  /** A deleted bot leaves no mode and no rule of its own behind. */
  forgetBot(botId: string): void {
    const before = this.data.rules.length;
    this.data.rules = this.data.rules.filter((rule) => rule.botId !== botId);
    const hadMode = Object.hasOwn(this.data.modes, botId);
    delete this.data.modes[botId];
    if (hadMode || before !== this.data.rules.length) {
      try {
        this.save();
      } catch {
        // an unreadable file keeps what it has
      }
    }
  }
}
