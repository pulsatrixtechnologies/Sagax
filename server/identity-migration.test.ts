import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrateIdentityRefs, principalIdFor } from "./identity-migration.ts";
import { PrincipalRegistry } from "./principals.ts";

const fresh = () => new PrincipalRegistry({ path: join(mkdtempSync(join(tmpdir(), "mig-")), "principals.json") });

describe("identity migration", () => {
  it("maps emails and local-owner to principals and leaves principal ids alone", () => {
    const registry = fresh();
    const local = registry.localOperator("jc@gox.ca");
    expect(principalIdFor("local-owner", registry)).toBe(local.id);
    expect(principalIdFor("JC@gox.ca", registry)).toBe(local.id);
    const zach = principalIdFor("zach@gox.ca", registry);
    expect(zach).toMatch(/^pr_/);
    expect(principalIdFor(zach, registry)).toBe(zach);
  });

  it("rewrites org owner, humanIds, bot owners, grants and pairing sessions once", () => {
    const registry = fresh();
    const local = registry.localOperator("jc@gox.ca");
    const input = {
      org: { ownerUserId: "jc@gox.ca" },
      groups: [{ id: "g1", humanIds: ["jc@gox.ca", "zach@gox.ca"] }, { id: "g2" }],
      bots: [{ id: "b1", ownerUserId: "local-owner", directGrants: ["zach@gox.ca"] }, { id: "b2" }],
      sessions: [
        { id: "s-phone", scopes: ["admin", "client"] },
        { id: "s-kiosk", scopes: ["client"] },
        { id: "s-zach", email: "zach@gox.ca", userId: "cp_7", scopes: ["client"] },
      ],
      registry,
    };
    const out = migrateIdentityRefs(input);
    const zach = registry.byEmail("zach@gox.ca")!.id;
    expect(out.orgOwner).toBe(local.id);
    expect(out.groups).toEqual([{ id: "g1", humanIds: [local.id, zach] }]);
    expect(out.bots).toEqual([{ id: "b1", ownerUserId: local.id, directGrants: [zach] }]);
    expect(out.sessions).toEqual([{ id: "s-phone", principalId: local.id }, { id: "s-zach", principalId: zach }]);
    expect(registry.byId(zach)?.controlPlaneUserId).toBe("cp_7");
    // A chat-only device from before accounts is nobody: it gets no principal.
    expect(out.sessions.some((s) => s.id === "s-kiosk")).toBe(false);

    // Applying the result and running again changes nothing.
    const again = migrateIdentityRefs({
      org: { ownerUserId: out.orgOwner! },
      groups: [{ id: "g1", humanIds: out.groups[0]!.humanIds }, { id: "g2" }],
      bots: [{ id: "b1", ownerUserId: local.id, directGrants: [zach] }, { id: "b2" }],
      sessions: [{ id: "s-phone", principalId: local.id }, { id: "s-zach", email: "zach@gox.ca", principalId: zach }],
      registry,
    });
    expect(again).toEqual({ groups: [], bots: [], sessions: [] });
    expect(registry.list()).toHaveLength(2);
  });

  it("skips sessions with userId but no email (incomplete migration state)", () => {
    const registry = fresh();
    registry.localOperator("jc@gox.ca");
    const input = {
      org: null,
      groups: [],
      bots: [],
      sessions: [{ id: "s-odd", userId: "cp_x" }],
      registry,
    };
    const out = migrateIdentityRefs(input);
    // The session with userId but no email is not included in the result.
    expect(out.sessions).toEqual([]);
    // No additional principal was created.
    expect(registry.list()).toHaveLength(1);
  });
});
