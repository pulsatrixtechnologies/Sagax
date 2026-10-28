// A path the person showed once: they re-read it, then save it as a skill
// the bot can replay, or they refuse. Saving never replaces a skill the bot
// already has unless they agree, and it never touches the other skills.
// Uploaded skills stay on their own route (server/routes/bot-skill-upload.ts).
import { buildTeachSkill, TEACH_MAX_STEPS, type TeachStep } from "./teach-recording.ts";

export const SHOWN_PATH_MODES = ["preview", "save", "refuse"] as const;
export type ShownPathMode = typeof SHOWN_PATH_MODES[number];

export interface ShownPathInput {
  title: string;
  description?: string;
  steps: readonly TeachStep[];
  recordedAt?: string;
  /** True only after the person agreed to replace the skill of this name. */
  replace?: boolean;
}

export type ShownPathPlan =
  | { action: "refused" }
  | { action: "invalid"; error: string }
  | { action: "preview"; name: string; markdown: string; exists: boolean }
  | { action: "needs-agreement"; name: string }
  | { action: "save"; name: string; markdown: string; replace: boolean };

/** What to do with a shown path. Pure: it writes nothing. */
export function planShownPath(input: ShownPathInput, mode: ShownPathMode, existing: ReadonlySet<string>): ShownPathPlan {
  if (mode === "refuse") return { action: "refused" };
  const title = input.title.trim();
  if (!title) return { action: "invalid", error: "A shown path needs a title." };
  const steps = input.steps.slice(0, TEACH_MAX_STEPS);
  if (!steps.length) return { action: "invalid", error: "A shown path needs at least one step." };
  const built = buildTeachSkill({
    title,
    description: input.description?.trim() ?? "",
    steps,
    recordedAt: input.recordedAt,
  });
  const exists = existing.has(built.name);
  if (mode === "preview") return { action: "preview", name: built.name, markdown: built.markdown, exists };
  if (exists && input.replace !== true) return { action: "needs-agreement", name: built.name };
  return { action: "save", name: built.name, markdown: built.markdown, replace: exists };
}
