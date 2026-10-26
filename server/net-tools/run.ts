// The only entry point for an IT check. Validate, reuse a fresh answer, then
// spend a rate slot and run. Nothing in here is mounted on the server, so the
// feature stays off until a later batch wires the flag and the routes.
import { isNetCheckName, netOverallVerdict, netSortFindings, NET_RESULT_LIMITS, type NetCheckName, type NetCheckResult, type NetDetailTable, type NetResultLink } from "../../shared/net-tools/types.ts";
import { NetLimiter, NetResultCache, sharedNetCache, sharedNetLimiter, type LimitDecision } from "./limits.ts";
import { deadlineSeconds, refusal, targetText, type NetCheckContext, type NetCheckOutcome, type NetResolver } from "./model.ts";
import { isAbortError } from "./checks/query.ts";
import { listRegisteredChecks, registrationFor } from "./registry.ts";
import { createDefaultResolver } from "./resolver.ts";

export { listRegisteredChecks };

const TARGET_FIELDS = ["name", "domain", "host", "target", "url", "headers"] as const;
const DEFAULT_DEADLINE_MS = 20_000;

export interface RunNetCheckOptions {
  by: "bot" | "person";
  personId?: string;
  botId?: string;
  /** The person's own message. Port checks (a later batch) read it for the typed-target rule. */
  personText?: string;
  ownNames?: readonly string[];
  resolver?: NetResolver;
  limiter?: NetLimiter;
  cache?: NetResultCache;
  /** Rate windows and the stored `at`. Duration always uses the real clock. */
  now?: () => number;
  deadlineMs?: number;
  /** Connect checks only. DNS and MX do not call it. */
  lookup?: (host: string) => Promise<string[]>;
}

function shownTarget(input: unknown): string {
  return targetText(input, TARGET_FIELDS);
}

function cacheable(outcome: NetCheckOutcome): boolean {
  const ttl = outcome.cacheTtlMs ?? 0;
  if (ttl <= 0) return false;
  return outcome.findings.every((item) => {
    if (item.code.startsWith("target.") || item.code.startsWith("limit.")) return false;
    return item.code !== "check.timeout" && item.code !== "check.no_egress" && item.code !== "check.error";
  });
}

function limitOutcome(target: string, decision: Extract<LimitDecision, { ok: false }>): NetCheckOutcome {
  if (decision.code === "limit.busy") return refusal(target, "limit.busy");
  return refusal(target, "limit.rate", { minutes: decision.minutes });
}

/** Cap raw text, tables and links. Sort findings worst first and stamp the verdict. */
export function buildResult(check: NetCheckName, outcome: NetCheckOutcome, at: number, durationMs: number): NetCheckResult {
  const details: NetDetailTable[] = outcome.details.map((table) => ({
    label: table.label,
    ...(table.columns ? { columns: table.columns } : {}),
    rows: table.rows.slice(0, NET_RESULT_LIMITS.tableRows).map((row) => row.map((cell) => cell.slice(0, NET_RESULT_LIMITS.cell))),
  }));
  const links: NetResultLink[] = (outcome.links ?? []).filter((link) => link.url.startsWith("https://")).slice(0, NET_RESULT_LIMITS.links);
  return {
    check,
    target: outcome.target,
    at,
    durationMs,
    verdict: netOverallVerdict(outcome.findings),
    findings: netSortFindings(outcome.findings),
    details,
    raw: outcome.raw.slice(0, NET_RESULT_LIMITS.raw),
    vantage: "server",
    ...(links.length > 0 ? { links } : {}),
  };
}

/** Run `work` until it finishes or the deadline aborts it. A late success after the abort is a timeout. */
export async function runWithinDeadline(target: string, deadlineMs: number, work: (signal: AbortSignal) => Promise<NetCheckOutcome>): Promise<NetCheckOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  timer.unref();
  const timeout = (): NetCheckOutcome => ({
    target,
    findings: [{ code: "check.timeout", severity: "unknown", params: { seconds: deadlineSeconds(deadlineMs) } }],
    details: [],
    raw: "",
  });
  let settled = false;
  return new Promise((resolve) => {
    const finish = (outcome: NetCheckOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    controller.signal.addEventListener("abort", () => finish(timeout()), { once: true });
    work(controller.signal).then((outcome) => {
      finish(controller.signal.aborted ? timeout() : outcome);
    }, (error: unknown) => {
      if (isAbortError(error) || controller.signal.aborted) finish(timeout());
      else finish({ target, findings: [{ code: "check.error", severity: "unknown" }], details: [], raw: "" });
    });
  });
}

/**
 * Run one check. A name this batch does not register, a refused target, and a
 * cache hit do not spend the rate window. The deadline is a real timer.
 */
export async function runNetCheck(name: string, input: unknown, options: RunNetCheckOptions): Promise<NetCheckResult> {
  const started = Date.now();
  const clock = options.now ?? Date.now;
  const at = clock();
  const stamp = (outcome: NetCheckOutcome, check: NetCheckName): NetCheckResult =>
    buildResult(check, outcome, at, Math.max(0, Date.now() - started));

  if (!isNetCheckName(name)) return stamp(refusal(shownTarget(input), "target.invalid"), "dns_lookup");
  const registration = registrationFor(name);
  if (!registration) {
    return stamp({
      target: shownTarget(input),
      findings: [{ code: "check.error", severity: "unknown" }],
      details: [],
      raw: `${name} is not available`,
    }, name);
  }
  const prepared = registration.prepare(input, options.ownNames);
  if (!prepared.ok) return stamp(prepared.outcome, name);

  const limiter = options.limiter ?? sharedNetLimiter();
  const cache = options.cache ?? sharedNetCache();
  const cached = cache.get(prepared.prepared.cacheKey, clock());
  if (cached) return cached;

  const decision = limiter.tryAcquire({ limitClass: registration.limitClass, personId: options.personId, botId: options.botId });
  if (!decision.ok) return stamp(limitOutcome(prepared.prepared.target, decision), name);

  try {
    const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
    const resolver = options.resolver ?? createDefaultResolver();
    const outcome = await runWithinDeadline(prepared.prepared.target, deadlineMs, (signal) => {
      const ctx: NetCheckContext = {
        by: options.by,
        personId: options.personId,
        botId: options.botId,
        personText: options.personText,
        ownNames: options.ownNames,
        resolver,
        signal,
        lookup: options.lookup,
        deadlineMs,
        now: options.now,
      };
      return prepared.prepared.run(ctx);
    });
    const result = stamp(outcome, name);
    if (cacheable(outcome)) cache.set(prepared.prepared.cacheKey, result, outcome.cacheTtlMs ?? 0, at);
    return result;
  } finally {
    decision.release();
  }
}
