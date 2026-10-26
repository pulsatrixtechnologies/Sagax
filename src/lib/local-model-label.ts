// A local model reads as its name alone ("Ornith-1.5-122B-oQ4e-mtp"), never
// ":8000: name" nor "Server: name" (2026-10-26). Who shares it (another
// person's computer) and its server (only when two servers of one computer
// share a name) go on a quiet second line under the name, which wraps rather
// than truncates. The technical id stays on the row and in the tooltip.
import { t } from "@/lib/i18n";

type Labeled = { sharedBy?: string; server?: string };

/** "Shared by <Name>" and/or the server, for the second line; undefined when neither applies. */
export function localModelSubtext(option: Labeled): string | undefined {
  const name = option.sharedBy?.trim();
  const parts = [name ? t("model.sharedBy", { name }) : "", option.server?.trim() ?? ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}
