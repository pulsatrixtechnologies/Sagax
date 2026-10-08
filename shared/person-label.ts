// A person's custom label ("CTO", "Dispatch"): the people counterpart of a
// bot's label (Bot Settings > Title), drawn with the same tag. Free text,
// one line, trimmed, at most PERSON_LABEL_MAX characters. Stored on the
// person's principal by the Sagax server (server/person-labels.ts).
import { fitsOnOneLine } from "./bot-profile.ts";

export const PERSON_LABEL_MAX = 40;

/** The label to store: the trimmed text, null to clear it (empty text or
 * null), or an error code when it does not fit. Characters are counted as
 * code points, so an accented or emoji label is not cut short. */
export function normalizePersonLabel(raw: unknown): { ok: true; label: string | null } | { ok: false; code: "label_type" | "label_too_long" | "label_one_line" } {
  if (raw === null || raw === undefined) return { ok: true, label: null };
  if (typeof raw !== "string") return { ok: false, code: "label_type" };
  const label = raw.trim();
  if (!label) return { ok: true, label: null };
  if (!fitsOnOneLine(label)) return { ok: false, code: "label_one_line" };
  if ([...label].length > PERSON_LABEL_MAX) return { ok: false, code: "label_too_long" };
  return { ok: true, label };
}
