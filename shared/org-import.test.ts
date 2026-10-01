import { describe, expect, it } from "vitest";

import { MAX_ORG_IMPORT_BYTES, parseOrgImportDocument } from "./org-import.ts";

const SELF = "pr_11111111-1111-4111-8111-111111111111";
const OTHER = "pr_22222222-2222-4222-8222-222222222222";

function task(key: string, messages: number) {
  return {
    key, title: "Conversation", createdAt: 1, activeLeafId: messages ? `${key}-m${messages - 1}` : null,
    messages: Array.from({ length: messages }, (_, i) => ({ id: `${key}-m${i}`, role: i % 2 ? "bot" : "user", text: `line ${i}`, at: 10 + i, parentId: i ? `${key}-m${i - 1}` : null })),
  };
}

function bot(key: string, options: { messages?: number; memory?: boolean } = {}) {
  return {
    key, name: key, title: "", description: "", color: "blue", chiefOfStaff: false, hidden: false, playbooks: [],
    activeTask: `${key}-t`, tasks: [task(`${key}-t`, options.messages ?? 0)],
    ...(options.memory ? { memory: { file: "remember", topics: [], logs: [] } } : {}),
  };
}

function good() {
  return {
    format: "sagax.org-import", version: 1, exportedAt: 1, self: SELF,
    choices: { a: { threads: true, memory: true }, b: { threads: false, memory: false } },
    people: {
      bots: { a: { owner: SELF, grants: [OTHER] }, b: { owner: null, grants: [] } },
      groups: { g: { humans: [SELF] } },
      routines: [{ runAs: SELF }],
    },
    backup: {
      format: "openmaus.backup", version: 1, name: "copy", exportedAt: 1, warnings: [],
      bots: [bot("a", { messages: 2, memory: true }), bot("b")],
      groups: [{ key: "g", name: "Room", activeTask: "g-t", tasks: [task("g-t", 0)], memberIds: ["a", "b"], dm: false, bulletin: "", defaultResponder: { kind: "mentions" } }],
      routines: [{ name: "Daily", prompt: "go", target: "bot", botId: "a", runOn: "maus", schedule: { type: "once", at: 5 }, durationMinutes: 10 }],
    },
  };
}

const bad = (mutate: (doc: ReturnType<typeof good>) => void) => {
  const doc = good();
  mutate(doc);
  return () => parseOrgImportDocument(doc);
};

describe("parseOrgImportDocument", () => {
  it("accepts a good copy, as an object or as text", () => {
    const doc = parseOrgImportDocument(good());
    expect(doc.self).toBe(SELF);
    expect(doc.backup.bots.map((b) => b.key)).toEqual(["a", "b"]);
    expect(parseOrgImportDocument(JSON.stringify(good())).choices.b).toEqual({ threads: false, memory: false });
  });

  it("refuses a wrong format or version", () => {
    expect(bad((d) => { (d as { format: string }).format = "openmaus.backup"; })).toThrow(/Invalid organization copy: format/);
    expect(bad((d) => { (d as { version: number }).version = 2; })).toThrow(/version/);
  });

  it("refuses a bad self or a person ref that is not opaque", () => {
    expect(bad((d) => { d.self = "dana@example.test"; })).toThrow(/self/);
    expect(bad((d) => { d.people.bots.a.grants = ["dana@example.test"]; })).toThrow(/people\.bots\.a\.grants/);
    expect(bad((d) => { d.people.groups.g.humans = ["local-owner"]; })).toThrow(/humans/);
  });

  it("refuses choices or people tables that do not match the backup keys", () => {
    expect(bad((d) => { delete (d.choices as Record<string, unknown>).b; })).toThrow(/choices\.b: missing/);
    expect(bad((d) => { (d.choices as Record<string, unknown>).z = { threads: true, memory: true }; })).toThrow(/choices\.z: not in the backup/);
    expect(bad((d) => { delete (d.people.bots as Record<string, unknown>).a; })).toThrow(/people\.bots\.a/);
    expect(bad((d) => { (d.people.groups as Record<string, unknown>).x = { humans: [] }; })).toThrow(/people\.groups\.x/);
    expect(bad((d) => { d.people.routines = []; })).toThrow(/people\.routines/);
  });

  it("refuses content the choices said would not travel", () => {
    expect(bad((d) => { d.backup.bots[1] = bot("b", { messages: 1 }); })).toThrow(/threads were not chosen/);
    expect(bad((d) => { d.backup.bots[1] = bot("b", { memory: true }); })).toThrow(/memory was not chosen/);
  });

  it("refuses an invalid backup and extra fields", () => {
    expect(bad((d) => { (d.backup as { format: string }).format = "x"; })).toThrow(/backup: Invalid backup/);
    expect(bad((d) => { (d as Record<string, unknown>).emails = ["x"]; })).toThrow(/Invalid organization copy/);
  });

  it("refuses too many refs and an oversized file", () => {
    expect(bad((d) => { d.people.bots.a.grants = Array.from({ length: 1001 }, () => OTHER); })).toThrow(/grants/);
    expect(() => parseOrgImportDocument("x".repeat(MAX_ORG_IMPORT_BYTES + 1))).toThrow(/too large/);
    expect(() => parseOrgImportDocument("{nope")).toThrow(/not JSON/);
  });
});
