import { beforeEach, describe, expect, it } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import { composerPlaceholder, type ComposerPlaceholderInput } from "./composer-placeholder";

const base: ComposerPlaceholderInput = { approval: false, attachmentPending: false, recording: false, busy: false, botName: "Cryptic" };

describe("composerPlaceholder", () => {
  beforeEach(() => setLocale("en"));

  it("says only 'Write a message…' while the bot works, whatever Enter will do", () => {
    expect(composerPlaceholder({ ...base, busy: true })).toBe("Write a message…");
    expect(composerPlaceholder({ ...base, busy: true, groupName: "Launch", groupHint: () => "ignored" })).toBe("Write a message…");
    expect(composerPlaceholder({ ...base, busy: true })).not.toContain("working");
    expect(composerPlaceholder({ ...base, busy: true })).not.toContain("Cryptic");
  });

  it("is translated", () => {
    setLocale("fr");
    expect(composerPlaceholder({ ...base, busy: true })).toBe("Écrivez un message…");
    setLocale("pt-br");
    expect(composerPlaceholder({ ...base, busy: true })).toBe("Escreva uma mensagem…");
  });

  it("keeps the other states", () => {
    expect(composerPlaceholder(base)).toBe("Write a message…");
    expect(composerPlaceholder({ ...base, groupName: "Launch", groupHint: () => "@ a member" })).toBe(t("composer.placeholder.group", { name: "Launch", hint: "@ a member" }));
    expect(composerPlaceholder({ ...base, groupName: "Launch", goalMode: true })).toBe(t("composer.placeholder.goal", { name: "Launch" }));
    expect(composerPlaceholder({ ...base, approval: true, busy: true })).toBe(t("composer.placeholder.approval"));
    expect(composerPlaceholder({ ...base, attachmentPending: true, busy: true })).toBe(t("composer.placeholder.attaching"));
    expect(composerPlaceholder({ ...base, recording: true, busy: true })).toBe(t("composer.placeholder.listening"));
  });
});
