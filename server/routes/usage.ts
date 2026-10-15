// The usage ledger: what this workspace spent over a period.
// Read-only over the month files usage-ledger.ts appends at turn.completed.
// Admin scope by default, like every route not opened to clients
// (server/request-auth.ts).
//
// GET /api/usage and GET /api/usage.csv: the whole ledger, admin (or the
// usage.view permission on an organization server).
//
// GET /api/me/usage (2026-10-15): the caller's own turns and nothing else,
// open to every signed-in person (request-auth.ts CLIENT_ALLOW). Settings >
// Usage reads it, so a member sees their own plan and cost; the
// organization's totals stay in its admin console.
import type { PriceList } from "../prices.ts";
import type { SpendState } from "../spend.ts";
import {
  parseUsageRange,
  readUsage,
  summarizeUsage,
  usageCsv,
  usageRowsFor,
  type UsageViewer,
  USAGE_GROUPINGS,
  type UsageGroupBy,
} from "../usage-ledger.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface UsageRouteDeps {
  dataDir: string;
  /** The operator's price list, when the server may read it (`billing`). */
  prices(): PriceList | null;
  /** The cap and where the month stands; null when there is no enforceable cap. */
  budget(): SpendState | null;
  /** Billing currency, read only when a price list is applied. */
  currency(): string;
  /** An organization server (Perspicax): every reader of /api/me/usage must
   * be a person there; a session that names nobody is refused. */
  organization(): boolean;
}

export function usageViewerOf(auth: RequestAuth): UsageViewer {
  if (auth.kind === "loopback") return { kind: "operator" };
  const { principalId, email } = auth.session;
  return principalId || email ? { kind: "person", principalId, email } : { kind: "operator" };
}

/** Who /api/me/usage answers for, or null when the caller names nobody on
 * an organization server. On a solo server a session that names nobody is
 * the owner's paired device, which reads the owner's turns (the operator). */
export function ownUsageViewer(auth: RequestAuth, organization: boolean): UsageViewer | null {
  const viewer = usageViewerOf(auth);
  if (viewer.kind === "operator" && organization && auth.kind === "session") return null;
  return viewer;
}

export function createUsageRoutes(deps: UsageRouteDeps): RouteHandler {
  return async ({ res, url, path, method, json, auth }) => {
    if (method === "GET" && path === "/api/me/usage") {
      const viewer = ownUsageViewer(auth, deps.organization());
      if (!viewer) return json(res, 403, { error: "sign in as a person first" });
      const range = parseUsageRange(url.searchParams.get("from"), url.searchParams.get("to"));
      if (!range) return json(res, 400, { error: "from and to must be YYYY-MM-DD, from no later than to, at most a year apart" });
      const requested = url.searchParams.get("groupBy") ?? "bot";
      // Never by person: the answer holds one person's turns only.
      if (requested === "user" || !USAGE_GROUPINGS.includes(requested as UsageGroupBy)) {
        return json(res, 400, { error: `groupBy must be one of ${USAGE_GROUPINGS.filter((group) => group !== "user").join(", ")}` });
      }
      const groupBy = requested as UsageGroupBy;
      const prices = deps.prices();
      res.setHeader("cache-control", "no-store");
      // No budget: the cap and the month's spend are the installation's, not the person's.
      return json(res, 200, {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        groupBy,
        ...summarizeUsage(usageRowsFor(readUsage(deps.dataDir, range), viewer), groupBy, prices),
        billing: prices ? { currency: deps.currency() } : null,
      });
    }
    if (!(method === "GET" && (path === "/api/usage" || path === "/api/usage.csv"))) return PASS;
    const range = parseUsageRange(url.searchParams.get("from"), url.searchParams.get("to"));
    if (!range) return json(res, 400, { error: "from and to must be YYYY-MM-DD, from no later than to, at most a year apart" });
    // ?mine=1 (2026-10-14): only the requester's own turns, for the app's
    // Settings > Usage; the organization's totals belong to its admin console.
    const all = readUsage(deps.dataDir, range);
    const rows = url.searchParams.get("mine") === "1" ? usageRowsFor(all, usageViewerOf(auth)) : all;
    // The operator's price list is applied only with the billing entitlement.
    const prices = deps.prices();
    if (path === "/api/usage.csv") {
      const stamp = (date: Date) => date.toISOString().slice(0, 10);
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="usage-${stamp(range.from)}-${stamp(range.to)}.csv"`,
        "cache-control": "no-store",
      });
      res.end(usageCsv(rows, prices));
      return;
    }
    const requested = url.searchParams.get("groupBy") ?? "bot";
    if (!USAGE_GROUPINGS.includes(requested as UsageGroupBy)) {
      return json(res, 400, { error: `groupBy must be one of ${USAGE_GROUPINGS.join(", ")}` });
    }
    const groupBy = requested as UsageGroupBy;
    res.setHeader("cache-control", "no-store");
    return json(res, 200, {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      groupBy,
      ...summarizeUsage(rows, groupBy, prices),
      budget: deps.budget(),
      billing: prices ? { currency: deps.currency() } : null,
    });
  };
}
