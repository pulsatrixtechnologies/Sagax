import { describe, expect, it } from "vitest";
import { mailReady, publicMailStatus, resolveMailSettings } from "./mail-config.ts";

describe("mail settings", () => {
  it("lets the environment win and reports which fields it manages", () => {
    const r = resolveMailSettings({
      file: { provider: "sendgrid", from: "web@gox.ca", sendgrid: { apiKey: "SG.file" } },
      env: { OMB_MAIL_PROVIDER: "smtp", OMB_SMTP_HOST: "smtp.gox.ca", OMB_SMTP_PORT: "587", OMB_SMTP_SECURE: "starttls", OMB_SMTP_PASSWORD: "pw" },
    });
    expect(r.settings.provider).toBe("smtp");
    expect(r.settings.from).toBe("web@gox.ca");
    expect(r.settings.smtp).toMatchObject({ host: "smtp.gox.ca", port: 587, secure: "starttls", password: "pw" });
    expect(r.envManaged.sort()).toEqual(["provider", "smtp.host", "smtp.password", "smtp.port", "smtp.secure"]);
  });

  it("reads a secret from a _FILE path, and the direct value wins", () => {
    const files: Record<string, string> = { "/run/secrets/sg": "SG.fromfile\n" };
    const read = (p: string) => files[p]!;
    expect(resolveMailSettings({ file: undefined, env: { OMB_SENDGRID_API_KEY_FILE: "/run/secrets/sg" }, readFile: read }).settings.sendgrid?.apiKey).toBe("SG.fromfile");
    expect(resolveMailSettings({ file: undefined, env: { OMB_SENDGRID_API_KEY_FILE: "/run/secrets/sg", OMB_SENDGRID_API_KEY: "SG.direct" }, readFile: read }).settings.sendgrid?.apiKey).toBe("SG.direct");
  });

  it("is ready only with a provider, a sender and that provider's fields", () => {
    expect(mailReady({})).toBe(false);
    expect(mailReady({ provider: "smtp", from: "a@b.c" })).toBe(false);
    expect(mailReady({ provider: "smtp", from: "a@b.c", smtp: { host: "h" } })).toBe(true);
    expect(mailReady({ provider: "sendgrid", from: "a@b.c", sendgrid: { apiKey: "k" } })).toBe(true);
    expect(mailReady({ provider: "twilio", from: "a@b.c", twilio: { apiKeySid: "SKfake" } })).toBe(false);
    expect(mailReady({ provider: "twilio", from: "a@b.c", twilio: { apiKeySecret: "fake-secret" } })).toBe(false);
    expect(mailReady({ provider: "twilio", twilio: { apiKeySid: "SKfake", apiKeySecret: "fake-secret" } })).toBe(false);
    expect(mailReady({ provider: "twilio", from: "a@b.c", twilio: { apiKeySid: "SKfake", apiKeySecret: "fake-secret" } })).toBe(true);
  });

  it("reads Twilio settings from the environment, the secret from a _FILE path, and the direct value wins", () => {
    const files: Record<string, string> = { "/run/secrets/twilio": "fake-secret-from-file\n" };
    const read = (p: string) => files[p]!;
    const fromFile = resolveMailSettings({
      file: { provider: "smtp", twilio: { apiKeySid: "SKfile", apiKeySecret: "fake-secret-saved" } },
      env: { OMB_MAIL_PROVIDER: "twilio", OMB_TWILIO_API_KEY_SID: "SKenv", OMB_TWILIO_API_KEY_SECRET_FILE: "/run/secrets/twilio" },
      readFile: read,
    });
    expect(fromFile.settings.provider).toBe("twilio");
    expect(fromFile.settings.twilio).toEqual({ apiKeySid: "SKenv", apiKeySecret: "fake-secret-from-file" });
    expect(fromFile.envManaged.sort()).toEqual(["provider", "twilio.apiKeySecret", "twilio.apiKeySid"]);
    const direct = resolveMailSettings({
      file: undefined,
      env: { OMB_TWILIO_API_KEY_SECRET_FILE: "/run/secrets/twilio", OMB_TWILIO_API_KEY_SECRET: "fake-secret-direct" },
      readFile: read,
    });
    expect(direct.settings.twilio?.apiKeySecret).toBe("fake-secret-direct");
  });

  it("ignores a malformed SMTP port instead of truncating it", () => {
    for (const bad of ["587abc", "587.9", "0", "70000"]) {
      const r = resolveMailSettings({ file: undefined, env: { OMB_SMTP_PORT: bad } });
      expect(r.settings.smtp?.port).toBeUndefined();
      expect(r.envManaged).not.toContain("smtp.port");
    }
    const r = resolveMailSettings({ file: undefined, env: { OMB_SMTP_PORT: "2525" } });
    expect(r.settings.smtp?.port).toBe(2525);
    expect(r.envManaged).toContain("smtp.port");
  });

  it("never exposes a secret in the public status", () => {
    const status = publicMailStatus(resolveMailSettings({ file: { provider: "smtp", from: "a@b.c", smtp: { host: "h", password: "hunter2" }, sendgrid: { apiKey: "SG.secret" } }, env: {} }));
    const text = JSON.stringify(status);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("SG.secret");
    expect(status.smtp.passwordConfigured).toBe(true);
    expect(status.sendgrid.apiKeyConfigured).toBe(true);
  });

  it("shows the Twilio key SID but never its secret", () => {
    const status = publicMailStatus(resolveMailSettings({ file: undefined, env: { OMB_MAIL_PROVIDER: "twilio", OMB_MAIL_FROM: "a@b.c", OMB_TWILIO_API_KEY_SID: "SKfakesid", OMB_TWILIO_API_KEY_SECRET: "fake-twilio-secret" } }));
    expect(JSON.stringify(status)).not.toContain("fake-twilio-secret");
    expect(status.twilio).toEqual({ apiKeySid: "SKfakesid", apiKeySecretConfigured: true });
    expect(status.ready).toBe(true);
    const empty = publicMailStatus(resolveMailSettings({ file: undefined, env: {} }));
    expect(empty.twilio).toEqual({ apiKeySid: undefined, apiKeySecretConfigured: false });
  });
});
