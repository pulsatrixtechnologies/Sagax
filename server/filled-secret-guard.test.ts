import { afterEach, describe, expect, it } from "vitest";

import { REDACTED_CREDENTIAL } from "./credential-fill.ts";
import { noteFilledSecret, redactFilledSecrets, resetFilledSecrets } from "./filled-secret-guard.ts";
import { redactSecretsInText } from "./redact.ts";

const SECRET = "p@ss-w0rd-sample";

afterEach(() => {
  resetFilledSecrets();
});

describe("filled secrets stay out of a prompt and a journal", () => {
  it("replaces the value and a URL encoding, and ignores another string", () => {
    noteFilledSecret(SECRET);
    expect(redactFilledSecrets(`filled ${SECRET} then stopped`)).toBe(`filled ${REDACTED_CREDENTIAL} then stopped`);
    expect(redactFilledSecrets(`q=${encodeURIComponent(SECRET)}`)).toBe(`q=${REDACTED_CREDENTIAL}`);
    expect(redactFilledSecrets("an ordinary sentence")).toBe("an ordinary sentence");
  });

  it("is removed by the server scrub the journal and the tool text use", () => {
    noteFilledSecret(SECRET);
    const journal = `The page showed ${SECRET} in the field.`;
    expect(redactSecretsInText(journal)).toBe(`The page showed ${REDACTED_CREDENTIAL} in the field.`);
    expect(redactSecretsInText(journal)).not.toContain(SECRET);
  });

  it("does not keep a value that was never used to fill", () => {
    expect(redactSecretsInText(`The page showed ${SECRET} in the field.`)).toContain(SECRET);
  });
});
