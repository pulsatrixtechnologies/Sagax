// A bot as one zip (server/routes/bot-zip.ts, docs/bot-package.md): the
// renderer's side. Export is a native download (large bots never sit in
// the renderer); import uploads the file once, shows the server's preview,
// then imports the staged file.
import { api, type Bot, type ConfigStatus } from "@/state/store";
import { viewerOwnsBot } from "@/lib/bot-capabilities";
import { viewerBotsReadOnly, viewerCanCreateBots } from "@/lib/viewer";
import { t, tFromServer } from "@/lib/i18n";
import type { BotZipImportResult, BotZipPreview, BotZipPreviewLine } from "../../shared/bot-zip";
import { BOT_ZIP_MAX_BYTES } from "../../shared/bot-zip";

export interface BotZipExportChoice {
  conversations: boolean;
  sharing: boolean;
}

export function botZipExportUrl(botId: string, choice: BotZipExportChoice): string {
  const params = new URLSearchParams();
  if (choice.conversations) params.set("conversations", "1");
  if (choice.sharing) params.set("sharing", "1");
  const query = params.toString();
  return `/api/bots/${encodeURIComponent(botId)}/export.zip${query ? `?${query}` : ""}`;
}

/** Start the download (the server names the file `<bot>.sagaxbot.zip`). */
export function downloadBotZip(botId: string, choice: BotZipExportChoice, doc: Document = document): void {
  const link = doc.createElement("a");
  link.href = botZipExportUrl(botId, choice);
  link.download = "";
  doc.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
}

export interface StagedBotZip {
  id: string;
  preview: BotZipPreview;
}

export async function uploadBotZip(file: Blob, request: typeof api = api): Promise<StagedBotZip> {
  if (file.size > BOT_ZIP_MAX_BYTES) throw new Error(t("botZip.error.tooLarge"));
  return request<StagedBotZip>("/api/bots/import/upload", {
    method: "POST", headers: { "content-type": "application/zip" }, body: file, timeoutMs: 15 * 60_000,
  });
}

export async function previewStagedBotZip(id: string, name: string | undefined, request: typeof api = api): Promise<BotZipPreview> {
  const answer = await request<{ preview: BotZipPreview }>(`/api/bots/import/${encodeURIComponent(id)}/preview`, {
    method: "POST", body: JSON.stringify(name ? { name } : {}),
  });
  return answer.preview;
}

export async function importStagedBotZip(
  id: string,
  choice: { name?: string; conversations: boolean; sharing: boolean },
  request: typeof api = api,
): Promise<BotZipImportResult & { bot?: Bot }> {
  return request(`/api/bots/import/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify({ ...(choice.name ? { name: choice.name } : {}), conversations: choice.conversations, sharing: choice.sharing }),
    timeoutMs: 15 * 60_000,
  });
}

export function discardStagedBotZip(id: string, request: typeof api = api): void {
  void request(`/api/bots/import/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
}

/** A preview line in the person's language when this build knows it. */
export function botZipLineText(line: BotZipPreviewLine): string {
  if (!line.key) return line.detail;
  const template = tFromServer(line.key, undefined);
  if (template === undefined) return line.detail;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (line.params && name in line.params ? String(line.params[name]) : match));
}

/** Export is the owner's, an admin's, or anyone's on a solo server; the
 * server also lets a person who manages the bot (the client has no level). */
export function showBotZipExport(config: ConfigStatus | null | undefined, bot: { ownerUserId?: string | null }): boolean {
  return viewerOwnsBot(config, bot);
}

/** Import makes a bot: the right to create bots. */
export function showBotZipImport(config: ConfigStatus | null | undefined): boolean {
  return viewerCanCreateBots(config) && !viewerBotsReadOnly(config);
}
