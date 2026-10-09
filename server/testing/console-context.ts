// A console route context for unit tests of the org admin areas
// (server/org-admin-*.ts): the viewer, the reach, the body, the records.
import type { ConsoleAuditEntry, ConsoleContext, ConsoleRoute } from "../org-admin-console.ts";
import { compileRoutes, ConsoleRefusal, matchRoutes } from "../org-admin-console.ts";
import type { ConsoleRole } from "../org-admin-routes.ts";

export interface FakeConsole {
  call(method: "GET" | "POST", path: string, input?: { role?: ConsoleRole; principalId?: string; reach?: string[] | null; body?: unknown; locale?: "en" | "fr"; request?: unknown }): Promise<{ status: number; body: any; raw?: Buffer }>;
  records: ConsoleAuditEntry[];
}

export function fakeConsole(routes: ConsoleRoute[], now = () => Date.now()): FakeConsole {
  const compiled = compileRoutes(routes);
  const records: ConsoleAuditEntry[] = [];
  return {
    records,
    async call(method, path, input = {}) {
      const url = new URL(`http://x/api/org/admin/${path}`);
      const sub = url.pathname.slice("/api/org/admin/".length);
      const hit = matchRoutes(compiled, url.searchParams.get("scope") === "org" && sub === "approvals" ? "approvals?scope=org" : sub).find((candidate) => candidate.route.method === method);
      if (!hit) return { status: 404, body: { code: "not_found" } };
      const reach = input.reach === undefined ? null : input.reach ? new Set(input.reach) : null;
      const principalId = input.principalId ?? "pr_admin";
      const ctx: ConsoleContext = {
        viewer: { principalId, sub: "sub", name: "Viewer", role: input.role ?? "admin", orgAdmin: (input.role ?? "admin") === "admin", teams: [] },
        locale: input.locale ?? "en",
        url,
        params: hit.params,
        body: input.body ?? null,
        ...(input.request ? { request: input.request as ConsoleContext["request"] } : {}),
        reach,
        managedTeams: new Set(),
        inReach: (id) => !reach || (id ? reach.has(id) : false),
        botVisible: (facts) => !reach || reach.has(facts.ownerPrincipalId) || facts.grantTargets.some((target) => target.startsWith("user:") && reach.has(target.slice(5))),
        record: (entry) => records.push(entry),
        now,
      };
      try {
        const answer = await hit.route.handle(ctx);
        if (answer.stream) {
          const chunks: Buffer[] = [];
          await answer.stream(async (chunk) => { chunks.push(chunk); });
          return { status: answer.status, body: answer.body as any, raw: Buffer.concat(chunks) };
        }
        return { status: answer.status, body: answer.body as any };
      } catch (error) {
        // as server/org-admin-routes.ts answers a thrown refusal
        if (error instanceof ConsoleRefusal) return { status: error.status, body: { code: error.code, message: error.message, reason: error.message } };
        throw error;
      }
    },
  };
}
