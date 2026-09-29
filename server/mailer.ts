// Sends mail through whichever provider `MailSettings` names: SMTP via
// nodemailer, or SendGrid via its HTTP API (no SDK — Node 24 has fetch).
// `createMailer` returns null when settings are not `mailReady`, so callers
// just check for a mailer rather than re-validating settings themselves.
import nodemailer from "nodemailer";

import { mailReady, type MailSettings } from "./mail-config.ts";

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

interface SmtpTransport {
  sendMail(message: object): Promise<unknown>;
}

export interface MailerDeps {
  fetchImpl?: typeof fetch;
  smtpTransport?: (options: object) => SmtpTransport;
}

const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";

function createSendGridMailer(settings: MailSettings, fetchImpl: typeof fetch): Mailer {
  const apiKey = settings.sendgrid!.apiKey!;
  const from = settings.from!;
  return {
    async send(message) {
      const response = await fetchImpl(SENDGRID_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: message.to }] }],
          from: { email: from },
          subject: message.subject,
          content: [{ type: "text/plain", value: message.text }],
        }),
      });
      if (!response.ok) {
        throw new Error(`SendGrid refused the message (${response.status})`);
      }
    },
  };
}

function createSmtpMailer(settings: MailSettings, smtpTransport: (options: object) => SmtpTransport): Mailer {
  const smtp = settings.smtp!;
  const from = settings.from!;
  const port = smtp.port ?? (smtp.secure === "tls" ? 465 : 587);
  const transport = smtpTransport({
    host: smtp.host,
    port,
    secure: smtp.secure === "tls",
    requireTLS: smtp.secure === "starttls",
    ignoreTLS: smtp.secure === "none",
    auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? "" } : undefined,
  });
  return {
    async send(message) {
      try {
        await transport.sendMail({ from, to: message.to, subject: message.subject, text: message.text });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`the mail server refused the message: ${detail}`);
      }
    },
  };
}

export function createMailer(settings: MailSettings, deps: MailerDeps = {}): Mailer | null {
  if (!mailReady(settings)) return null;
  if (settings.provider === "sendgrid") {
    return createSendGridMailer(settings, deps.fetchImpl ?? fetch);
  }
  const smtpTransport = deps.smtpTransport ?? ((options: object) => nodemailer.createTransport(options));
  return createSmtpMailer(settings, smtpTransport);
}
