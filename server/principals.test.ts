import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAccountEmail, isPrincipalId, mergePrincipalFiles, PrincipalRegistry } from "./principals.ts";

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

  it("moves an unparseable principals.json aside and starts empty without overwriting it", () => {
    const dir = mkdtempSync(join(tmpdir(), "principals-"));
    const path = join(dir, "principals.json");
    writeFileSync(path, "{invalid json");
    const reg = new PrincipalRegistry({ path, now: () => 42 });
    expect(reg.list()).toHaveLength(0);
    expect(readFileSync(join(dir, "principals.json.corrupt-42"), "utf8")).toBe("{invalid json");
    reg.localOperator();
    expect(readdirSync(dir).sort()).toEqual(["principals.json", "principals.json.corrupt-42"]);
  });

  it("skips an oversized or malformed entry and keeps the local operator across a restart", () => {
    const { path, reg } = registry();
    const local = reg.localOperator("jc@gox.ca");
    const zach = reg.forAccount({ email: "zach@gox.ca" });
    const file = JSON.parse(readFileSync(path, "utf8"));
    file.principals.push(
      { id: "pr_00000000-0000-4000-8000-0000000000ff", kind: "human", email: `${"a".repeat(400)}@gox.ca`, createdAt: 1 },
      { id: "not-a-principal", kind: "human", createdAt: 1 },
      { id: "pr_00000000-0000-4000-8000-0000000000fe", kind: "human", local: true, createdAt: 1 },
    );
    writeFileSync(path, JSON.stringify(file));
    const again = new PrincipalRegistry({ path, now: () => 7 });
    expect(again.local()?.id).toBe(local.id);
    expect(again.localOperator("jc@gox.ca").id).toBe(local.id);
    expect(again.byId(zach.id)).toMatchObject({ email: "zach@gox.ca" });
    expect(again.list()).toHaveLength(2);
    // The original is kept beside the rewritten file.
    expect(existsSync(`${path}.corrupt-7`)).toBe(true);
    expect(new PrincipalRegistry({ path }).local()?.id).toBe(local.id);
  });

  it("refuses an account email over 320 characters or without local@domain", () => {
    const { reg } = registry();
    expect(() => reg.forAccount({ email: `${"a".repeat(400)}@gox.ca` })).toThrow(/account email/);
    expect(() => reg.forAccount({ email: "not-an-email" })).toThrow(/account email/);
    expect(() => reg.forAccount({ email: "@gox.ca" })).toThrow(/account email/);
    expect(reg.list()).toHaveLength(0);
    expect(isAccountEmail("zach@gox.ca")).toBe(true);
    expect(isAccountEmail(`${"a".repeat(320)}@gox.ca`)).toBe(false);
  });

  it("reads the local operator without writing", () => {
    const { path, reg } = registry();
    expect(reg.local()).toBeNull();
    expect(existsSync(path)).toBe(false);
    const local = reg.localOperator();
    expect(reg.local()?.id).toBe(local.id);
  });

  it("merges a restored file by id without replacing the local operator", () => {
    const mine = { id: "pr_00000000-0000-4000-8000-000000000001", kind: "human", local: true, createdAt: 1 };
    const shared = { id: "pr_00000000-0000-4000-8000-000000000002", kind: "human", email: "zach@gox.ca", createdAt: 1 };
    const theirs = { id: "pr_00000000-0000-4000-8000-000000000003", kind: "human", local: true, email: "old@gox.ca", createdAt: 1 };
    const merged = mergePrincipalFiles(
      { version: 1, principals: [mine, shared] },
      { version: 1, principals: [{ ...shared, email: "changed@gox.ca" }, theirs] },
    );
    expect(merged.principals).toEqual([mine, shared, { id: theirs.id, kind: "human", email: "old@gox.ca", createdAt: 1 }]);
    expect(mergePrincipalFiles(undefined, { version: 1, principals: [theirs] }).principals).toEqual([theirs]);
  });

  it("creates parent directories for a nested path", () => {
    const dir = mkdtempSync(join(tmpdir(), "principals-"));
    const nestedPath = join(dir, "subdir", "deep", "principals.json");
    const reg = new PrincipalRegistry({ path: nestedPath, now: () => 1000, newId: () => "pr_00000000-0000-4000-8000-000000000000" });
    reg.forAccount({ email: "test@gox.ca" });
    expect(existsSync(nestedPath)).toBe(true);
  });
});
