// Sends mail through whichever provider `MailSettings` names: SMTP via
// nodemailer, or SendGrid via its HTTP API (no SDK — Node 24 has fetch).
// `createMailer` returns null when settings are not `mailReady`, so callers
// just check for a mailer rather than re-validating settings themselves.
import { appendFileSync } from "node:fs";
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
    // An unreachable or slow-to-answer host must fail a sign-in request in
    // seconds, not hang the connection indefinitely.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
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

/** A test/e2e seam (OMB_MAIL_CAPTURE_FILE): sends nothing and instead
 * appends each message as one JSON line `{to,subject,text,at}` to `filePath`.
 * For a harness that spawns this server as a child process and so cannot
 * stub fetch or nodemailer. The caller decides when this seam applies
 * (index.ts ignores it in production); this function only ever appends. */
export function createCaptureMailer(filePath: string): Mailer {
  return {
    async send(message) {
      appendFileSync(filePath, `${JSON.stringify({ ...message, at: new Date().toISOString() })}\n`);
    },
  };
}
