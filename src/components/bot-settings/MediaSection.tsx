// The Media tab: every image and file the bot produced in the open
// conversation, grouped by kind, newest first. Each gallery keeps its own
// message context, so opening a file still goes through the server's
// message-scoped authorization, the same as clicking it in the transcript.
import { useMemo } from "react";
import { ImageOff } from "lucide-react";
import { visibleMessages, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { AttachmentGallery, collectMessageFiles, splitMessageAttachments, type GalleryFile } from "../AttachmentGallery";

interface MediaEntry {
  messageId: string;
  images: string[];
  files: GalleryFile[];
}

export function mediaEntries(bot: Bot): MediaEntry[] {
  const entries: MediaEntry[] = [];
  for (const message of visibleMessages(bot)) {
    if (message.role === "user") continue;
    const attached = splitMessageAttachments(message.attachments);
    const files = [
      ...attached.files,
      ...collectMessageFiles(message.text ?? "", [...attached.images, ...attached.files.map((file) => file.path)]),
    ];
    if (attached.images.length || files.length) entries.push({ messageId: message.id, images: attached.images, files });
  }
  return entries.reverse();
}

export function MediaSection({ bot }: { bot: Bot }) {
  const entries = useMemo(() => mediaEntries(bot), [bot]);
  const withImages = entries.filter((entry) => entry.images.length);
  const withFiles = entries.filter((entry) => entry.files.length);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-ink-secondary">
        <ImageOff size={20} aria-hidden="true" />
        <span className="text-[13px]">{t("botPanel.media.empty")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {withImages.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="px-1 text-[13px] text-ink-secondary">{t("botPanel.media.images")}</h3>
          {withImages.map((entry) => (
            <AttachmentGallery
              key={entry.messageId}
              images={entry.images}
              message={{ threadId: bot.threadId, messageId: entry.messageId }}
              className="mb-0"
            />
          ))}
        </section>
      )}
      {withFiles.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="px-1 text-[13px] text-ink-secondary">{t("botPanel.media.files")}</h3>
          {withFiles.map((entry) => (
            <AttachmentGallery
              key={entry.messageId}
              files={entry.files}
              message={{ threadId: bot.threadId, messageId: entry.messageId }}
              className="mb-0"
            />
          ))}
        </section>
      )}
    </div>
  );
}
