import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPrincipalId, PrincipalRegistry } from "./principals.ts";

function registry() {
  const dir = mkdtempSync(join(tmpdir(), "principals-"));
  let n = 0;
  const path = join(dir, "principals.json");
  return { path, reg: new PrincipalRegistry({ path, now: () => 1000, newId: () => `pr_00000000-0000-4000-8000-00000000000${n++}` }) };
}

describe("principal registry", () => {
  it("creates one principal per account and finds it again", () => {
    const { reg } = registry();
    const a = reg.forAccount({ email: "Zach@Gox.ca", controlPlaneUserId: "cp_1" });
    expect(a).toMatchObject({ kind: "human", email: "zach@gox.ca", controlPlaneUserId: "cp_1" });
    expect(reg.forAccount({ email: "zach@gox.ca", controlPlaneUserId: "cp_1" }).id).toBe(a.id);
    expect(reg.list()).toHaveLength(1);
  });

  it("keeps the principal when the account email changes", () => {
    const { reg } = registry();
    const a = reg.forAccount({ email: "old@gox.ca", controlPlaneUserId: "cp_1" });
    const b = reg.forAccount({ email: "new@gox.ca", controlPlaneUserId: "cp_1" });
    expect(b.id).toBe(a.id);
    expect(b.email).toBe("new@gox.ca");
    expect(reg.byEmail("old@gox.ca")).toBeNull();
  });

  it("links an email-only principal to its account on first sign-in", () => {
    const { reg } = registry();
    const a = reg.forAccount({ email: "zach@gox.ca" });
    const b = reg.forAccount({ email: "zach@gox.ca", controlPlaneUserId: "cp_9" });
    expect(b.id).toBe(a.id);
    expect(b.controlPlaneUserId).toBe("cp_9");
  });

  it("has exactly one local operator and gives it the profile email", () => {
    const { reg } = registry();
    const a = reg.localOperator();
    const b = reg.localOperator("jc@gox.ca");
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ local: true, email: "jc@gox.ca" });
    expect(reg.list().filter((p) => p.local)).toHaveLength(1);
  });

  it("persists across instances", () => {
    const { path, reg } = registry();
    const a = reg.forAccount({ email: "zach@gox.ca", controlPlaneUserId: "cp_1" });
    const again = new PrincipalRegistry({ path });
    expect(again.byId(a.id)).toMatchObject({ email: "zach@gox.ca" });
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(1);
  });

  it("recognizes principal ids", () => {
    expect(isPrincipalId("pr_00000000-0000-4000-8000-000000000000")).toBe(true);
    expect(isPrincipalId("zach@gox.ca")).toBe(false);
    expect(isPrincipalId("local-owner")).toBe(false);
  });

  it("starts empty on corrupt principals.json without throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "principals-"));
    const path = join(dir, "principals.json");
    // Write invalid JSON
    writeFileSync(path, "{invalid json");
    // Should not throw
    const reg = new PrincipalRegistry({ path });
    expect(reg.list()).toHaveLength(0);
  });

  it("creates parent directories for a nested path", () => {
    const dir = mkdtempSync(join(tmpdir(), "principals-"));
    const nestedPath = join(dir, "subdir", "deep", "principals.json");
    const reg = new PrincipalRegistry({ path: nestedPath, now: () => 1000, newId: () => "pr_00000000-0000-4000-8000-000000000000" });
    reg.forAccount({ email: "test@gox.ca" });
    expect(existsSync(nestedPath)).toBe(true);
  });
});
