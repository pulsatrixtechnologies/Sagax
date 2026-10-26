import { describe, expect, it } from "vitest";
import { cwActionLanguage } from "./cw-widget-actions.ts";
import { personLanguage } from "./person-language.ts";
import { emailSendSummary } from "../shared/email-draft-send.ts";

describe("the person's language, not the server's", () => {
  it("prefers the person's choice over the server default", () => {
    expect(personLanguage("en", "fr")).toBe("en");
    expect(personLanguage("fr-CA", "en")).toBe("fr-CA");
  });

  it("falls back to the server default when the person has not chosen", () => {
    expect(personLanguage(undefined, "fr")).toBe("fr");
    expect(personLanguage("", "fr")).toBe("fr");
    expect(personLanguage(3, undefined)).toBe("");
  });

  it("words an email send and a ConnectWise action for an English person on a French server", () => {
    const language = personLanguage("en", "fr");
    expect(cwActionLanguage(language)).toBe("en");
    const draft = { to: ["a@b.c"], cc: [], bcc: [], subject: "Hi", body: "x" } as never;
    expect(emailSendSummary(draft, { kind: "smtp", label: "the server's mail" } as never, language)).toMatch(/^Send the email/);
  });
});
