// Server side of the misuse guardrail (docs/security/misuse-guardrails.md).
//
// The classifier is pure (shared/misuse-guardrails.ts). This module reads
// the mode, counts repeated attempts, writes the admin activity log and
// tells the harness when a person should be notified. Shadow mode records
// the same rows and refuses nothing.
import { appendAdminAction } from "./admin-activity.ts";
import { DATA_DIR } from "./config.ts";
import {
  classifyMisuse,
  classifySandboxPath,
  misuseRefusalText,
  type MisuseCategory,
  type MisuseVerdict,
} from "../shared/misuse-guardrails.ts";

export type MisuseMode = "off" | "shadow" | "enforce";

export interface MisuseContext {
  /** `security.triage` on the person this turn acts for. */
  triage: boolean;
  principalId?: string;
  surface: "message" | "shell" | "file" | "terminal" | "mcp" | "flow";
  botId?: string;
  threadId?: string;
  tool?: string;
}

export interface MisuseRefusal {
  status: number;
  code: "misuse_blocked" | "misuse_approval_required" | "misuse_locked";
  message: string;
  verdict: MisuseVerdict;
}

const WINDOW_MS = 10 * 60_000;
const LOCK_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

interface Bucket { stamps: number[]; lockedUntil: number }
const buckets = new Map<string, Bucket>();

let alertListener: ((alert: { principalId?: string; botId?: string; threadId?: string; category?: MisuseCategory; message: string }) => void) | null = null;
let dataDirForTests: string | null = null;

export function misuseGuardrailMode(env: NodeJS.ProcessEnv = process.env): MisuseMode {
  const raw = (env.SAGAX_MISUSE_GUARDRAILS ?? "shadow").trim().toLowerCase();
  if (raw === "off" || raw === "shadow" || raw === "enforce") return raw;
  return "shadow";
}

/** The harness registers this once. A blocked attempt in enforce mode
 * reaches tenant admins; shadow mode only writes the activity log. */
export function setMisuseAlert(listener: typeof alertListener): void {
  alertListener = listener;
}

/** Tests write the activity log under a throwaway directory. */
export function setMisuseDataDirForTests(dir: string | null): void {
  dataDirForTests = dir;
}

export function resetMisuseGuardrailsForTests(): void {
  buckets.clear();
  alertListener = null;
  dataDirForTests = null;
}

function bucketKey(context: MisuseContext): string {
  return context.principalId || context.threadId || "anonymous";
}

function noteAttempt(key: string, now: number): { locked: boolean; crossed: boolean } {
  const bucket = buckets.get(key) ?? { stamps: [], lockedUntil: 0 };
  if (bucket.lockedUntil > now) {
    buckets.set(key, bucket);
    return { locked: true, crossed: false };
  }
  bucket.stamps = bucket.stamps.filter((stamp) => now - stamp < WINDOW_MS);
  bucket.stamps.push(now);
  const crossed = bucket.stamps.length >= MAX_ATTEMPTS;
  if (crossed) {
    bucket.lockedUntil = now + LOCK_MS;
    bucket.stamps = [];
  }
  buckets.set(key, bucket);
  return { locked: bucket.lockedUntil > now, crossed };
}

function excerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

function audit(action: string, context: MisuseContext, verdict: MisuseVerdict | undefined, text: string): void {
  const principalId = context.principalId;
  try {
    appendAdminAction(dataDirForTests ?? DATA_DIR, {
      category: "security",
      action,
      target: context.botId ? { kind: "bot", id: context.botId } : { kind: "person", id: principalId },
      after: {
        surface: context.surface,
        ...(context.tool ? { tool: context.tool } : {}),
        ...(context.threadId ? { threadId: context.threadId } : {}),
        ...(verdict?.category ? { category: verdict.category } : {}),
        ...(verdict?.obfuscated ? { obfuscated: true } : {}),
        excerpt: excerpt(text),
      },
      actor: principalId ? { kind: "person", principalId, via: "sagax" } : { kind: "loopback" },
    });
  } catch (error) {
    console.warn(`[misuse] activity log: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function refusalFor(verdict: MisuseVerdict, locked: boolean): MisuseRefusal {
  if (locked) {
    return { status: 429, code: "misuse_locked", message: misuseRefusalText(verdict.category, "locked"), verdict };
  }
  if (verdict.action === "require_approval") {
    return { status: 403, code: "misuse_approval_required", message: misuseRefusalText(verdict.category, "require_approval"), verdict };
  }
  return { status: 403, code: "misuse_blocked", message: misuseRefusalText(verdict.category, "block"), verdict };
}

/** Classify `text`. Off: nothing. Shadow: a log row, no refusal. Enforce:
 * a refusal, and a lock after repeated attempts. `verdict` lets a path
 * check pass a block the text alone would not name. */
export function misuseRefusal(text: string, context: MisuseContext, now = Date.now(), verdict = classifyMisuse(text, context.triage)): MisuseRefusal | null {
  const mode = misuseGuardrailMode();
  if (mode === "off") return null;
  const key = bucketKey(context);
  const existing = buckets.get(key);
  if (mode === "enforce" && existing && existing.lockedUntil > now) {
    if (verdict.action === "allow") return null;
    audit("misuse.lockout", context, verdict, text);
    return refusalFor(verdict, true);
  }
  if (verdict.action === "allow") return null;
  const attempt = noteAttempt(key, now);
  const action = attempt.locked ? "misuse.lockout" : mode === "shadow" ? "misuse.shadow" : verdict.action === "require_approval" ? "misuse.approval" : "misuse.block";
  audit(action, context, verdict, text);
  if (mode === "shadow") return null;
  const refusal = refusalFor(verdict, attempt.locked);
  try {
    alertListener?.({
      principalId: context.principalId,
      botId: context.botId,
      threadId: context.threadId,
      category: verdict.category,
      message: refusal.message,
    });
  } catch (error) {
    console.warn(`[misuse] alert: ${error instanceof Error ? error.message : String(error)}`);
  }
  return refusal;
}

/** A file tool in the server environment. The path allowlist follows the
 * same mode as the classifier. */
export function misusePathRefusal(path: string, context: Omit<MisuseContext, "surface">, now = Date.now()): MisuseRefusal | null {
  return misuseRefusal(path, { ...context, surface: "file" }, now, classifySandboxPath(path, context.triage));
}

/** Text of a JSON-RPC tools/call, or null when the frame is not a call. */
export function misuseToolFrameText(frame: unknown): string | null {
  const record = frame && typeof frame === "object" ? frame as Record<string, unknown> : null;
  const message = record?.message && typeof record.message === "object" ? record.message as Record<string, unknown> : record;
  if (!message || message.method !== "tools/call") return null;
  const params = message.params && typeof message.params === "object" ? message.params as Record<string, unknown> : {};
  const name = typeof params.name === "string" ? params.name : "";
  const args = params.arguments === undefined ? "" : JSON.stringify(params.arguments);
  return `${name}\n${args}`;
}
