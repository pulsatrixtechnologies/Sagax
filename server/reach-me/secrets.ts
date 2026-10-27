// "Me joindre" secrets: the token of the person's own Telegram bot (from
// BotFather). Sealed like the other local secrets with the vault key
// (AES-256-GCM, AAD `sagax reach-me secrets v1`), file mode 0600, kept out
// of reach-me.json, workspace backups and bot exports. Write only from the
// API: the screen only learns whether one is set and the bot's @username.
// Never in a log, a prompt, an audit row or an answer.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import type { VaultKeySource } from "../mcp-oauth.ts";

export const REACH_ME_SECRETS_FILE = "reach-me-secrets.enc";
const AAD = Buffer.from("sagax reach-me secrets v1");

/** A bot token as BotFather gives it: `<digits>:<35 or so url-safe chars>`. */
export const TELEGRAM_TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;

type Document = { version: 1; telegram: Record<string, string> };

const slot = (person: string, botId: string) => createHash("sha256").update(`${person.trim().toLowerCase()}\u0000${botId}`).digest("hex").slice(0, 32);

export class ReachMeSecrets {
  private readonly file: string;
  private readonly keySource: () => VaultKeySource;
  private cached: Document | null = null;

  constructor(dataDir: string, keySource: () => VaultKeySource) {
    this.file = join(dataDir, REACH_ME_SECRETS_FILE);
    this.keySource = keySource;
  }

  private key(): Buffer {
    const source = this.keySource();
    if (source.kind === "unavailable") throw new Error("The credential store is unavailable on this server.");
    return source.key;
  }

  private read(): Document {
    if (this.cached) return this.cached;
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("The reach-me secrets could not be read.");
      this.cached = { version: 1, telegram: {} };
      return this.cached;
    }
    try {
      const [iv, tag, body] = raw.split(".");
      if (!iv || !tag || !body) throw new Error("format");
      const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      decipher.setAAD(AAD);
      const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8")) as Document;
      if (parsed.version !== 1 || !parsed.telegram || typeof parsed.telegram !== "object") throw new Error("schema");
      this.cached = parsed;
      return parsed;
    } catch {
      // never the cause: it could quote the content
      throw new Error("The reach-me secrets could not be read.");
    }
  }

  private write(document: Document): void {
    if (!Object.keys(document.telegram).length) {
      rmSync(this.file, { force: true });
      this.cached = document;
      return;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(AAD);
    const body = Buffer.concat([cipher.update(JSON.stringify(document), "utf8"), cipher.final()]);
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${body.toString("base64")}`, { mode: 0o600 });
    this.cached = document;
  }

  telegramToken(person: string, botId: string): string | undefined {
    try {
      return this.read().telegram[slot(person, botId)];
    } catch {
      return undefined;
    }
  }

  /** Saves the token; undefined removes it. */
  setTelegramToken(person: string, botId: string, token: string | undefined): void {
    if (token !== undefined && !TELEGRAM_TOKEN.test(token)) throw Object.assign(new Error("This is not a Telegram bot token."), { status: 400 });
    const document = structuredClone(this.read());
    if (token) document.telegram[slot(person, botId)] = token;
    else delete document.telegram[slot(person, botId)];
    this.write(document);
  }
}
