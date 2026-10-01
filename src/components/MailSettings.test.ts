import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { MAIL_FIELDS, type MailField, type MailFieldView, type MailSettingsView } from "../../shared/mail-settings";
import { MailOrganizationNote, MailSettingsForm, mailSettingsPatch, type MailSettingsFormProps } from "./MailSettings";

function view(fields: Partial<Record<MailField, MailFieldView>>, extra: Partial<MailSettingsView> = {}): MailSettingsView {
  const all = {} as Record<MailField, MailFieldView>;
  for (const field of MAIL_FIELDS) all[field] = fields[field] ?? { source: "unset", serverDefault: false };
  return { fields: all, ready: false, missing: [], defaultFromName: "Sagax", ...extra };
}

const twilio = view({
  provider: { source: "saved", serverDefault: true, value: "twilio", serverValue: "smtp" },
  from: { source: "server", serverDefault: true, value: "bot@gox.ca", serverValue: "bot@gox.ca" },
  "twilio.apiKeySid": { source: "saved", serverDefault: false, value: "SKfakesid" },
  "twilio.apiKeySecret": { source: "saved", serverDefault: false, configured: true },
}, { ready: true, testAddress: "boss@gox.ca" });

function render(props: Partial<MailSettingsFormProps> = {}): string {
  return renderToStaticMarkup(createElement(MailSettingsForm, {
    status: twilio,
    draft: {},
    replacing: [],
    busy: null,
    onChange: () => {},
    onRevert: () => {},
    onReplace: () => {},
    onSave: () => {},
    onTest: () => {},
    ...props,
  }));
}

afterEach(() => setLocale("en"));

describe("Settings > Email", () => {
  it("shows a configured secret as configured with Replace, never a value or a filled input", () => {
    const html = render();
    expect(html).toContain("Configured");
    expect(html).toContain("Replace");
    expect(html).not.toContain('type="password"');
  });

  it("offers a password input once Replace is chosen, empty and not autofilled", () => {
    const html = render({ replacing: ["twilio.apiKeySecret"] });
    expect(html).toMatch(/<input[^>]*type="password"[^>]*>/);
    const input = /<input[^>]*type="password"[^>]*>/.exec(html)![0];
    expect(input).toContain('autoComplete="new-password"');
    expect(input).toContain('value=""');
  });

  it("marks a value the server provides, and offers a revert for a saved one the server also has", () => {
    const html = render();
    expect(html).toContain("Default value provided by the server");
    expect(html).toContain("Revert to the server&#x27;s value");
  });

  it("says Ready, names the test recipient, and shows the default sender name", () => {
    const html = render();
    expect(html).toContain("Ready");
    expect(html).toContain("Send a test");
    expect(html).toContain("boss@gox.ca");
    expect(html).toContain('placeholder="Sagax"');
  });

  it("says Incomplete and names what is missing", () => {
    const html = render({ status: view({ provider: { source: "saved", serverDefault: false, value: "sendgrid" } }, { missing: ["from", "sendgrid.apiKey"] }) });
    expect(html).toContain("Incomplete");
    expect(html).toContain("SendGrid API key");
  });

  it("shows only the chosen provider's fields", () => {
    const html = render({ draft: { provider: "smtp" } });
    expect(html).toContain("SMTP host");
    expect(html).not.toContain("API key SID");
  });

  it("reads in French", () => {
    setLocale("fr");
    const html = render();
    expect(html).toContain("Prêt");
    expect(html).toContain("Envoyer un test");
    expect(html).toContain("Remplacer");
    expect(html).toContain("Valeur par défaut fournie par le serveur");
    expect(html).toContain("Revenir à la valeur du serveur");
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it("tells an organization server's admin that Perspicax sends the mail", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(MailOrganizationNote));
    expect(html).toContain("Perspicax");
  });
});

describe("the change Settings > Email sends", () => {
  it("sends only edited fields, clears a plain field with null, and skips an empty secret", () => {
    expect(mailSettingsPatch({ from: "bot@gox.ca", fromName: "", "smtp.port": "2525", "smtp.password": "", "twilio.apiKeySecret": "fake-new" })).toEqual({
      from: "bot@gox.ca",
      fromName: null,
      "smtp.port": 2525,
      "twilio.apiKeySecret": "fake-new",
    });
    expect(mailSettingsPatch({})).toEqual({});
  });
});
