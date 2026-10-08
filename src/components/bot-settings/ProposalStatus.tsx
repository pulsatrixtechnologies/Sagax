// Quiet boundary marker for the bot settings dialog: which field groups never
// leave the owner's hands. Copy only, nothing here adds agent reach, and the
// marker disappears when no other Chief covers the bot's section (nobody could
// propose) or in the new-bot draft editor (the bot does not exist yet).
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./BotEditorContext";

const sectionKey = (section?: string | null) => (section ?? "").trim();

/** A Chief covers this bot when it holds the role in the bot's section or
 * has the bot's section among its owner-approved managed sections — the
 * same reach server/peer-roster.ts grants a Chief for proposals. */
function chiefCovers(bot: Bot, bots: ReadonlyArray<Bot>): boolean {
  const target = sectionKey(bot.section);
  return bots.some((candidate) =>
    candidate.id !== bot.id &&
    Boolean(candidate.chiefOfStaff) &&
    (sectionKey(candidate.section) === target ||
      (Array.isArray(candidate.managedSections) &&
        candidate.managedSections.some((team) => typeof team === "string" && sectionKey(team) === target))));
}

export function ProposalStatus({ bot }: { bot: Bot }) {
  const { draft } = useBotEditor();
  const { state } = useStore();
  if (draft || !chiefCovers(bot, state.bots)) return null;
  return (
    <div className="mt-1 text-[11.5px] leading-snug text-ink-secondary">
      {t("botSettings.proposal.owner")}
    </div>
  );
}
