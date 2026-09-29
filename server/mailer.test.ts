import { describe, expect, it, vi } from "vitest";
import { createMailer } from "./mailer.ts";

describe("mailer", () => {
  it("is absent until mail is configured", () => {
    expect(createMailer({})).toBeNull();
  });

  it("sends through SendGrid's HTTP API", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const mailer = createMailer({ provider: "sendgrid", from: "pulsa@gox.ca", sendgrid: { apiKey: "SG.k" } }, { fetchImpl: fetchImpl as unknown as typeof fetch })!;
    await mailer.send({ to: "zach@gox.ca", subject: "Code", text: "12345678" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer SG.k");
    expect(JSON.parse(String(init.body))).toMatchObject({ from: { email: "pulsa@gox.ca" }, personalizations: [{ to: [{ email: "zach@gox.ca" }] }], subject: "Code" });
  });

  it("reports a SendGrid refusal without leaking the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 401 }));
    const mailer = createMailer({ provider: "sendgrid", from: "p@g.ca", sendgrid: { apiKey: "SG.k" } }, { fetchImpl: fetchImpl as unknown as typeof fetch })!;
    await expect(mailer.send({ to: "z@g.ca", subject: "s", text: "t" })).rejects.toThrow(/SendGrid refused the message \(401\)/);
    await expect(mailer.send({ to: "z@g.ca", subject: "s", text: "t" })).rejects.not.toThrow(/SG\.k/);
  });

  it("sends through SMTP with the chosen security", async () => {
    const sendMail = vi.fn(async () => ({}));
    const smtpTransport = vi.fn(() => ({ sendMail }));
    const mailer = createMailer({ provider: "smtp", from: "p@g.ca", smtp: { host: "smtp.g.ca", port: 587, secure: "starttls", user: "u", password: "pw" } }, { smtpTransport })!;
    await mailer.send({ to: "z@g.ca", subject: "s", text: "t" });
    expect(smtpTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.g.ca", port: 587, secure: false, requireTLS: true, auth: { user: "u", pass: "pw" } }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "p@g.ca", to: "z@g.ca", subject: "s", text: "t" }));
  });
});
