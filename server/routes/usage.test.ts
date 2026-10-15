// Settings > Usage for every member (2026-10-15): GET /api/me/usage answers
// the caller's own turns and nothing else; the whole ledger (/api/usage)
// stays an admin read.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { appendUsage, type UsageTrigger } from "../usage-ledger.ts";
import { createUsageRoutes, ownUsageViewer } from "./usage.ts";
import { dispatchRoutes } from "./table.ts";

const ADA = "pr_00000001-0000-4000-8000-000000000000";
const BOB = "pr_00000002-0000-4000-8000-000000000000";
const RANGE = "from=2026-10-01&to=2026-10-15";

describe("GET /api/me/usage", () => {
  let dataDir: string;
  const servers: Server[] = [];
  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "sagax-me-usage-"));
    const turn = (botId: string, costUsd: number, trigger: UsageTrigger) => appendUsage(dataDir, {
      at: "2026-10-14T12:00:00.000Z",
      botId,
      botName: botId,
      threadId: `t-${botId}`,
      instanceId: "claude",
      driverKind: "claudeAgent",
      model: "claude-test",
      input: 10,
      output: 5,
      costUsd,
      trigger,
    });
    await turn("ada-bot", 1, { kind: "user", principalId: ADA, email: "ada@example.test" });
    await turn("ada-bot", 2, { kind: "user", principalId: ADA, email: "ada@example.test" });
    await turn("ada-routine", 0.5, { kind: "routine", routineId: "r1", runAsPrincipalId: ADA });
    await turn("bob-bot", 40, { kind: "user", principalId: BOB, email: "bob@example.test" });
    await turn("bob-routine", 7, { kind: "routine", routineId: "r2", runAsPrincipalId: BOB });
    await turn("server-bot", 100, { kind: "owner" });
  });
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function serve(organization = true) {
    const routes = [createUsageRoutes({
      dataDir,
      prices: () => null,
      budget: () => ({ capUsd: 500, spentUsd: 150.5 }) as never,
      currency: () => "USD",
      organization: () => organization,
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const who = req.headers["x-who"] as string | undefined;
      const auth = (who === "loopback"
        ? { kind: "loopback", scopes: ["admin", "client"] }
        : { kind: "session", via: "cookie", scopes: req.headers["x-admin"] ? ["admin", "client"] : ["client"], session: who ? { principalId: who } : {} }) as unknown as RequestAuth;
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return async (path: string, who?: string, admin = false) => {
      const response = await fetch(`${base}${path}`, { headers: { ...(who ? { "x-who": who } : {}), ...(admin ? { "x-admin": "1" } : {}) } });
      return { status: response.status, body: await response.json() as any };
    };
  }

  it("is open to a member's client session; the whole ledger stays admin", () => {
    expect(requiredScope("GET", "/api/me/usage")).toBe("client");
    expect(requiredScope("GET", "/api/me/usage", { orgDirectory: true })).toBe("client");
    expect(requiredScope("GET", "/api/usage")).toBe("admin");
    expect(requiredScope("GET", "/api/usage.csv", { orgDirectory: true })).toBe("admin");
    expect(requiredScope("POST", "/api/me/usage")).toBe("admin");
  });

  it("gives a member their own turns and the routines run as them", async () => {
    const api = await serve();
    const mine = await api(`/api/me/usage?${RANGE}&groupBy=bot`, ADA);
    expect(mine.status).toBe(200);
    expect(mine.body.total.turns).toBe(3);
    expect(mine.body.total.costUsd).toBeCloseTo(3.5);
    expect(mine.body.groups.map((group: { label: string }) => group.label).sort()).toEqual(["ada-bot", "ada-routine"]);
  });

  it("never gives a member another person's turns, whatever they ask", async () => {
    const api = await serve();
    for (const query of [`${RANGE}&groupBy=bot`, `${RANGE}&groupBy=model`, `${RANGE}&groupBy=day`, `${RANGE}&groupBy=engine`, `${RANGE}&mine=0`, `${RANGE}&principalId=${BOB}`, `${RANGE}&email=bob@example.test`]) {
      const answer = await api(`/api/me/usage?${query}`, ADA);
      expect(answer.status, query).toBe(200);
      const text = JSON.stringify(answer.body);
      expect(text, query).not.toContain("bob");
      expect(text, query).not.toContain(BOB);
      expect(text, query).not.toContain("server-bot");
      expect(answer.body.total.turns, query).toBe(3);
    }
    // a breakdown by person has nothing to break down, and would name people
    expect((await api(`/api/me/usage?${RANGE}&groupBy=user`, ADA)).status).toBe(400);
    // nor does it carry the installation's cap and spend
    expect((await api(`/api/me/usage?${RANGE}`, ADA)).body.budget).toBeUndefined();
    // Bob reads his own, not Ada's
    const bob = await api(`/api/me/usage?${RANGE}&groupBy=bot`, BOB);
    expect(bob.body.total.turns).toBe(2);
    expect(JSON.stringify(bob.body)).not.toContain("ada");
  });

  it("refuses a session that names nobody on an organization server", async () => {
    const api = await serve(true);
    const refused = await api(`/api/me/usage?${RANGE}`, undefined);
    expect(refused.status).toBe(403);
    expect(refused.body.total).toBeUndefined();
    expect(ownUsageViewer({ kind: "session", via: "bearer", scopes: ["client"], session: {} as never }, true)).toBeNull();
  });

  it("gives the solo owner's paired device the owner's turns", async () => {
    const api = await serve(false);
    const owner = await api(`/api/me/usage?${RANGE}&groupBy=bot`, undefined);
    expect(owner.status).toBe(200);
    expect(owner.body.groups.map((group: { label: string }) => group.label)).toEqual(["server-bot"]);
    expect(ownUsageViewer({ kind: "loopback", scopes: ["admin", "client"] }, true)).toEqual({ kind: "operator" });
  });

  it("still gives an admin the whole organization on /api/usage", async () => {
    const api = await serve();
    const all = await api(`/api/usage?${RANGE}&groupBy=user`, ADA, true);
    expect(all.status).toBe(200);
    expect(all.body.total.turns).toBe(6);
    expect(all.body.budget).toEqual({ capUsd: 500, spentUsd: 150.5 });
    const viaLoopback = await api(`/api/usage?${RANGE}&groupBy=bot`, "loopback");
    expect(viaLoopback.body.total.turns).toBe(6);
  });

  it("checks its dates and grouping", async () => {
    const api = await serve();
    expect((await api("/api/me/usage?from=2026-10-15&to=2026-10-01", ADA)).status).toBe(400);
    expect((await api(`/api/me/usage?${RANGE}&groupBy=nope`, ADA)).status).toBe(400);
  });
});
