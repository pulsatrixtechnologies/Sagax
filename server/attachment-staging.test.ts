// Attachments where the bot's tools run (server/attachment-staging.ts): the
// tag the bot sees names the copy in its target, small text files come
// inline, and only the speaker's own uploads are ever copied.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { attachedFilesInText, attachmentChunks, attachmentIsTheirs, displayName, stageTurnAttachments, targetPath } from "./attachment-staging.ts";

const dir = mkdtempSync(join(tmpdir(), "omb-staging-"));
const store = join(dir, "attachments");
mkdirSync(store);
const README = "0b5a3c1e-1111-4111-8111-111111111111.md";
const PDF = "9d1e2f3a-2222-4222-8222-222222222222.pdf";
writeFileSync(join(store, README), "# Hello\nworld\n");
writeFileSync(join(store, PDF), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const tag = (file: string, name: string) => `<attached-file path="${join(store, file)}" name="${name}" />`;

describe("attachments in a turn", () => {
  it("finds only app-owned standalone tags", () => {
    const text = ["read these", tag(README, "README.md"), tag(PDF, "spec.pdf"), "`" + tag(README, "quoted") + "`", `<attached-file path="/etc/passwd" name="x" />`].join("\n\n");
    const files = attachedFilesInText(text, store);
    expect(files.map((file) => file.name)).toEqual(["README.md", "spec.pdf"]);
  });

  it("points the bot at the server environment copy and inlines small text", () => {
    const text = `look\n\n${tag(README, "README.md")}`;
    const out = stageTurnAttachments(text, attachedFilesInText(text, store), { kind: "user-sandbox" });
    expect(out.text).toContain(`<attached-file path="/workspace/attachments/0b5a3c1e-README.md" name="README.md" />`);
    expect(out.text).toContain("<attached-file-content name=\"README.md\">\n# Hello\nworld\n");
    expect(out.text).not.toContain(store);
    expect(out.staged.map((file) => file.file)).toEqual([README]);
  });

  it("points the bot at the desktop's own folder, per platform", () => {
    const text = tag(PDF, "spec.pdf");
    const [file] = attachedFilesInText(text, store);
    expect(targetPath(file!, { kind: "user-desktop", attachmentsDir: "C:\\Users\\ada\\AppData\\Local\\Temp\\Sagax\\attachments", platform: "win32" }))
      .toBe("C:\\Users\\ada\\AppData\\Local\\Temp\\Sagax\\attachments\\9d1e2f3a-spec.pdf");
    const out = stageTurnAttachments(text, [file!], { kind: "user-desktop", attachmentsDir: "/Users/ada/Library/Caches/Sagax/attachments", platform: "darwin" });
    expect(out.text).toBe(`<attached-file path="/Users/ada/Library/Caches/Sagax/attachments/9d1e2f3a-spec.pdf" name="spec.pdf" />`);
  });

  it("without a target, still inlines text and names no path", () => {
    const text = tag(README, "README.md");
    const out = stageTurnAttachments(text, attachedFilesInText(text, store), null);
    expect(out.text).toContain(`<attached-file name="README.md" />`);
    expect(out.text).toContain("# Hello");
    expect(out.staged).toEqual([]);
  });

  it("is the speaker's only when the first message naming it is theirs", () => {
    expect(attachmentIsTheirs("pr_ada", [])).toBe(true);
    expect(attachmentIsTheirs("PR_ADA", [{ person: "pr_ada", at: 1 }, { person: "pr_bob", at: 2 }])).toBe(true);
    expect(attachmentIsTheirs("pr_bob", [{ person: "pr_ada", at: 1 }, { person: "pr_bob", at: 2 }])).toBe(false);
    // a bot quoting it is not an owner; nobody-known references fail closed
    expect(attachmentIsTheirs("pr_bob", [{ at: 0 }, { person: "pr_ada", at: 1 }])).toBe(false);
    expect(attachmentIsTheirs("pr_bob", [{ at: 0 }])).toBe(false);
  });

  it("keeps names safe as one path component", () => {
    expect(displayName("../../etc/passwd", README)).toBe("passwd.md");
    expect(displayName("notes.txt", README)).toBe("notes.txt.md");
    expect(displayName("a<b>:c?.md", README)).toBe("a_b__c_.md");
  });

  it("chunks a file for copying", () => {
    const [file] = attachedFilesInText(tag(PDF, "spec.pdf"), store);
    const chunks = [...attachmentChunks(file!, 4)];
    expect(chunks.map((chunk) => [chunk.offset, chunk.data.length, chunk.final])).toEqual([[0, 4, false], [4, 2, true]]);
  });
});
