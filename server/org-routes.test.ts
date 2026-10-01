import { describe, expect, it } from "vitest";

import { createSoloOrgRoutes, interimRetiredRefusal } from "./org-routes.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteContext } from "./routes/table.ts";

const loopback: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };

async function answer(method: string, path: string) {
  const out: { status?: number; body?: unknown } = {};
  const result = await createSoloOrgRoutes()({
    req: {}, res: {}, path, method, auth: loopback,
    json: (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body; },
    readBody: async () => ({}),
  } as unknown as RouteContext);
  return { ...out, passed: result === PASS };
}

describe("solo organization routes (slice 8)", () => {
  it("has no organization, and the interim one is gone", async () => {
    expect(await answer("GET", "/api/org")).toMatchObject({ status: 404, body: { code: "no_organization" } });
    expect(await answer("POST", "/api/org")).toMatchObject({ status: 410, body: { code: "interim_org_removed" } });
    expect(await answer("PATCH", "/api/org")).toMatchObject({ status: 410, body: { code: "interim_org_removed" } });
    for (const path of ["/api/org/invites", "/api/org/invites/abc/revoke", "/api/org/invites/abc/accept", "/api/org/invites/abc/join"]) {
      expect(await answer("POST", path)).toMatchObject({ status: 410, body: { code: "interim_signin_removed" } });
    }
    expect((await answer("POST", "/api/org/export")).passed).toBe(true);
    expect((await answer("GET", "/api/org/directory")).passed).toBe(true);
  });

  it("refuses the retired email and invitation routes before any credential: 410 solo, 403 organization", () => {
    for (const [method, path] of [["POST", "/api/auth/email/start"], ["POST", "/api/auth/email/verify"], ["GET", "/api/org/invites/abc/preview"], ["POST", "/api/org/invites/abc/join"], ["POST", "/api/org/invites"]]) {
      expect(interimRetiredRefusal(method!, path!, "solo")).toMatchObject({ status: 410, body: { code: "interim_signin_removed" } });
      expect(interimRetiredRefusal(method!, path!, "perspicax")).toMatchObject({ status: 403, body: { code: "identity_perspicax" } });
    }
    expect(interimRetiredRefusal("GET", "/api/auth/email/start", "solo")).toBeNull();
    expect(interimRetiredRefusal("POST", "/api/auth/pair", "solo")).toBeNull();
    expect(interimRetiredRefusal("GET", "/api/org", "solo")).toBeNull();
  });
});
