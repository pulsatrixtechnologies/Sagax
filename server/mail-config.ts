// Mail settings: the saved file (~/.openmausbot/config.json's `mail` block)
// merged with the Docker environment, which always wins. A web-managed
// server is configured by whoever runs the container, not by editing a
// file inside it, so OMB_MAIL_* (and its *_FILE secret variants) override
// anything saved. `publicMailStatus` is what a settings UI or a status
// route may show; it never contains a secret value, only whether one is
// configured.
import { readFileSync } from "node:fs";

export type MailProvider = "smtp" | "sendgrid" | "twilio";

export interface MailSettings {
  provider?: MailProvider;
  from?: string;
  smtp?: {
    host?: string;
    port?: number;
    secure?: "tls" | "starttls" | "none";
    user?: string;
    password?: string;
  };
  sendgrid?: {
    apiKey?: string;
  };
  twilio?: {
    apiKeySid?: string;
    apiKeySecret?: string;
  };
}

export interface ResolvedMailSettings {
  settings: MailSettings;
  /** Dotted field names ("provider", "smtp.password", …) the environment set. */
  envManaged: string[];
}

export interface PublicMailStatus {
  provider?: MailProvider;
  from?: string;
  smtp: {
    host?: string;
    port?: number;
    secure?: string;
    user?: string;
    passwordConfigured: boolean;
  };
  sendgrid: {
    apiKeyConfigured: boolean;
  };
  twilio: {
    apiKeySid?: string;
    apiKeySecretConfigured: boolean;
  };
  envManaged: string[];
  ready: boolean;
}

const MAIL_PROVIDERS = new Set<MailProvider>(["smtp", "sendgrid", "twilio"]);
const SMTP_SECURE_MODES = new Set(["tls", "starttls", "none"]);
// Full match only: "587abc" and "587.9" are not "close enough" to a port,
// they are malformed input to be ignored, not coerced by parseInt.
const SMTP_PORT_PATTERN = /^\d+$/;

const defaultReadFile = (path: string): string => readFileSync(path, "utf8");

/** Reads `${name}` or, failing that, `${name}_FILE` (a Docker secret path).
 * The direct value always wins over the file. An unreadable file is
 * ignored — logged by variable name only, never by path or content. */
function readSecret(env: NodeJS.ProcessEnv, name: string, readFile: (path: string) => string): string | undefined {
  const direct = env[name];
  if (direct !== undefined && direct !== "") return direct;
  const filePath = env[`${name}_FILE`];
  if (filePath === undefined || filePath === "") return undefined;
  try {
    return readFile(filePath).trim();
  } catch {
    console.warn(`mail-config: could not read ${name}_FILE`);
    return undefined;
  }
}

export function resolveMailSettings(input: {
  file: MailSettings | undefined;
  env: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
}): ResolvedMailSettings {
  const readFile = input.readFile ?? defaultReadFile;
  const env = input.env;
  const settings: MailSettings = structuredClone(input.file ?? {});
  const envManaged: string[] = [];

  const setProvider = env.OMB_MAIL_PROVIDER;
  if (setProvider !== undefined && setProvider !== "" && MAIL_PROVIDERS.has(setProvider as MailProvider)) {
    settings.provider = setProvider as MailProvider;
    envManaged.push("provider");
  }

  const from = env.OMB_MAIL_FROM;
  if (from !== undefined && from !== "") {
    settings.from = from;
    envManaged.push("from");
  }

  const smtpHost = env.OMB_SMTP_HOST;
  if (smtpHost !== undefined && smtpHost !== "") {
    settings.smtp = { ...settings.smtp, host: smtpHost };
    envManaged.push("smtp.host");
  }

  const smtpPortRaw = env.OMB_SMTP_PORT;
  if (smtpPortRaw !== undefined && smtpPortRaw !== "") {
    const port = SMTP_PORT_PATTERN.test(smtpPortRaw) ? Number.parseInt(smtpPortRaw, 10) : NaN;
    if (port >= 1 && port <= 65535) {
      settings.smtp = { ...settings.smtp, port };
      envManaged.push("smtp.port");
    } else {
      console.warn("mail-config: ignoring malformed OMB_SMTP_PORT");
    }
  }

  const smtpSecure = env.OMB_SMTP_SECURE;
  if (smtpSecure !== undefined && smtpSecure !== "" && SMTP_SECURE_MODES.has(smtpSecure)) {
    settings.smtp = { ...settings.smtp, secure: smtpSecure as "tls" | "starttls" | "none" };
    envManaged.push("smtp.secure");
  }

  const smtpUser = env.OMB_SMTP_USER;
  if (smtpUser !== undefined && smtpUser !== "") {
    settings.smtp = { ...settings.smtp, user: smtpUser };
    envManaged.push("smtp.user");
  }

  const smtpPassword = readSecret(env, "OMB_SMTP_PASSWORD", readFile);
  if (smtpPassword !== undefined) {
    settings.smtp = { ...settings.smtp, password: smtpPassword };
    envManaged.push("smtp.password");
  }

  const sendgridApiKey = readSecret(env, "OMB_SENDGRID_API_KEY", readFile);
  if (sendgridApiKey !== undefined) {
    settings.sendgrid = { ...settings.sendgrid, apiKey: sendgridApiKey };
    envManaged.push("sendgrid.apiKey");
  }

  const twilioApiKeySid = env.OMB_TWILIO_API_KEY_SID;
  if (twilioApiKeySid !== undefined && twilioApiKeySid !== "") {
    settings.twilio = { ...settings.twilio, apiKeySid: twilioApiKeySid };
    envManaged.push("twilio.apiKeySid");
  }

  const twilioApiKeySecret = readSecret(env, "OMB_TWILIO_API_KEY_SECRET", readFile);
  if (twilioApiKeySecret !== undefined) {
    settings.twilio = { ...settings.twilio, apiKeySecret: twilioApiKeySecret };
    envManaged.push("twilio.apiKeySecret");
  }

  return { settings, envManaged };
}

export function mailReady(settings: MailSettings): boolean {
  if (!settings.provider || !settings.from) return false;
  if (settings.provider === "smtp") return !!settings.smtp?.host;
  if (settings.provider === "sendgrid") return !!settings.sendgrid?.apiKey;
  if (settings.provider === "twilio") return !!settings.twilio?.apiKeySid && !!settings.twilio?.apiKeySecret;
  return false;
}

export function publicMailStatus(resolved: ResolvedMailSettings): PublicMailStatus {
  const { settings, envManaged } = resolved;
  return {
    provider: settings.provider,
    from: settings.from,
    smtp: {
      host: settings.smtp?.host,
      port: settings.smtp?.port,
      secure: settings.smtp?.secure,
      user: settings.smtp?.user,
      passwordConfigured: !!settings.smtp?.password,
    },
    sendgrid: {
      apiKeyConfigured: !!settings.sendgrid?.apiKey,
    },
    twilio: {
      apiKeySid: settings.twilio?.apiKeySid,
      apiKeySecretConfigured: !!settings.twilio?.apiKeySecret,
    },
    envManaged,
    ready: mailReady(settings),
  };
}
