// A local model reads as its name alone ("Ornith-1.5-122B-oQ4e-mtp"), never
// ":8000: name" nor "Server: name" (2026-10-26). A model served by another
// person's computer adds who shares it; the full technical id stays on the
// row (its id) and in the tooltip. `server` is a separate quiet sub-line the
// server sets only when two servers of one computer share a model name.
import { t } from "@/lib/i18n";

type Labeled = { label: string; sharedBy?: string };

/** The row's label with "(Shared by <Name>)" when another person's computer serves it. */
export function localModelLabel(option: Labeled): string {
  const name = option.sharedBy?.trim();
  return name ? t("model.sharedBy", { model: option.label, name }) : option.label;
}

/** Same options with `label` set to what a person reads, so every surface that
 * shows a model (picker, bot panel, settings, wizard, cards) agrees. */
export function withLocalModelLabels<T extends { models: { options: Labeled[] } }>(instances: T[]): T[] {
  return instances.map((instance) => {
    if (!instance.models.options.some((option) => option.sharedBy?.trim())) return instance;
    return { ...instance, models: { ...instance.models, options: instance.models.options.map((option) => option.sharedBy?.trim() ? { ...option, label: localModelLabel(option) } : option) } };
  });
}
