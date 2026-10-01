import { describe, expect, it } from "vitest";

import { parseOrgImportDocument } from "../../shared/org-import.ts";
import { setLocale } from "@/lib/i18n";
import { copyPreview, readCopyFile } from "./OrgImportDialog";

const SELF = "pr_11111111-1111-4111-8111-111111111111";
const DANA = "pr_22222222-2222-4222-8222-222222222222";
const task = (key: string, messages: number) => ({
  key, title: "Conversation", createdAt: 1, activeLeafId: messages ? `${key}-0` : null,
  messages: Array.from({ length: messages }, (_, i) => ({ id: `${key}-${i}`, role: "user", text: "x", at: 1, parentId: i ? `${key}-${i - 1}` : null })),
});
const raw = {
  format: "sagax.org-import", version: 1, exportedAt: 1, self: SELF,
  choices: { a: { threads: true, memory: true } },
  people: { bots: { a: { owner: SELF, grants: [DANA, SELF] } }, groups: {}, routines: [{ runAs: null }] },
  backup: {
    format: "openmaus.backup", version: 1, name: "c", exportedAt: 1, warnings: [],
    bots: [{ key: "a", name: "Atlas", title: "", description: "", color: "blue", chiefOfStaff: false, hidden: false, playbooks: [], activeTask: "t", tasks: [task("t", 1)], memory: { file: "m", topics: [{ name: "x.md", text: "y" }], logs: [] } }],
    groups: [],
    routines: [{ name: "R", prompt: "p", target: "bot", botId: "a", runOn: "maus", schedule: { type: "once", at: 1 }, durationMinutes: 5 }],
  },
};

describe("org import dialog helpers", () => {
  it("previews bots, rooms, paused routines and the people left behind", () => {
    expect(copyPreview(parseOrgImportDocument(raw))).toEqual({
      bots: [{ key: "a", name: "Atlas", threads: 1, messages: 1, memory: 2 }], rooms: 0, routines: 1, people: 1,
    });
  });

  it("reads a good file and refuses a large or a wrong one", async () => {
    setLocale("en");
    expect(typeof await readCopyFile({ size: 10, text: async () => JSON.stringify(raw) })).toBe("object");
    expect(await readCopyFile({ size: 10, text: async () => "{}" })).toBe("This file is not a Sagax organization copy.");
    expect(await readCopyFile({ size: 60 * 1024 * 1024, text: async () => "" })).toBe("This file is too large.");
  });
});
