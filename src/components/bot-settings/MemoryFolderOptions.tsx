// The memory's own settings inside the Bot folder (JC 2026-10-15: one
// interface for the bot's files and its memory). What used to be the Memory
// section's "More options" lives in the folder's "..." menu: automatic
// tidying (and Tidy now), and the memory's change log with one-click undo.
// The memory files themselves (MEMORY.md, the topics in memory/, the daily
// logs) are rows of the folder, with their budget on the row.
//
// On an OMB Cloud home, the notice that memory changed where the owner did
// not write shows above the folder whenever there is one.
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import {
  fetchMemoryJournal,
  fetchMemoryOverview,
  fetchUpkeepStatus,
  markMemoryReviewed,
  revertMemoryChange,
  tidyMemoryNow,
  tidySummary,
  type LendingReview,
  type MemoryJournalRow,
  type UpkeepStatus,
} from "@/lib/memory";
import { ApiError, useStore, type Bot } from "@/state/store";
import { LendingReviewNotice, MemoryJournalList, MemoryUpkeepCard } from "./MemorySection";
import { PaneSection } from "./PaneSection";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function MemoryFolderOptions({ bot, active, showOptions, onChanged }: {
  bot: Bot;
  /** The folder is on screen: the lending notice is read then. */
  active: boolean;
  /** The "..." menu is open: tidying and the change log are read then. */
  showOptions: boolean;
  /** A file changed (undo, tidy): the folder re-reads its list. */
  onChanged: () => void;
}) {
  const { dispatch } = useStore();
  const [journal, setJournal] = useState<MemoryJournalRow[] | null>(null);
  const [upkeep, setUpkeep] = useState<UpkeepStatus | null>(null);
  const [lendingReview, setLendingReview] = useState<LendingReview | null>(null);
  const [lendingStale, setLendingStale] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const [tidying, setTidying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readLending = () => fetchMemoryOverview(bot.id).then((overview) => setLendingReview(overview.lendingReview ?? null));
  const readOptions = () => Promise.all([
    fetchMemoryJournal(bot.id).then(setJournal),
    fetchUpkeepStatus(bot.id).then(setUpkeep, () => setUpkeep(null)),
  ]);

  useEffect(() => {
    if (!active) return;
    readLending().catch(() => { /* the folder says what failed */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bot.id]);

  useEffect(() => {
    if (!active || !showOptions) return;
    setError(null);
    readOptions().catch((e: unknown) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, showOptions, bot.id]);

  const revert = async (row: MemoryJournalRow) => {
    setReverting(row.id);
    setError(null);
    try {
      await revertMemoryChange(bot.id, row.id);
      setJournal(await fetchMemoryJournal(bot.id));
      setNotice(t("botPanel.memory.restored", { path: row.path }));
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setReverting(null);
    }
  };

  const tidyNow = async () => {
    setTidying(true);
    setError(null);
    setNotice(null);
    try {
      const { report } = await tidyMemoryNow(bot.id);
      await readOptions();
      setNotice(`${tidySummary(report)}.${report.note ? ` ${report.note}` : ""}`);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setTidying(false);
    }
  };

  const toggleUpkeep = () => {
    const enabled = bot.memoryUpkeep === false;
    dispatch({ type: "updateBot", botId: bot.id, patch: { memoryUpkeep: enabled } });
    setUpkeep((current) => (current ? { ...current, enabled } : current));
  };

  return (
    <>
      {lendingReview && (
        <LendingReviewNotice
          changed={lendingReview.changed}
          stale={lendingStale}
          busy={reviewing}
          onReviewed={() => {
            setReviewing(true);
            markMemoryReviewed(bot.id, lendingReview.token)
              .then(() => { setLendingReview(null); setLendingStale(false); })
              .catch((e: unknown) => {
                if (e instanceof ApiError && e.status === 409) {
                  setLendingStale(true);
                  return readLending();
                }
                setError(errorText(e));
              })
              .finally(() => setReviewing(false));
          }}
        />
      )}
      {showOptions && (
        <div className="flex flex-col gap-4 rounded-xl border border-hairline/40 p-3" data-folder-options="">
          {bot.memoryEnabled !== false && (
            <MemoryUpkeepCard
              enabled={bot.memoryUpkeep !== false}
              status={upkeep}
              tidying={tidying}
              onToggle={toggleUpkeep}
              onTidy={() => void tidyNow()}
            />
          )}
          <PaneSection title={t("botPanel.memory.changes")} help={t("botPanel.memory.changesHelp")}>
            <MemoryJournalList rows={journal} botName={bot.name} reverting={reverting} onRevert={(row) => void revert(row)} />
          </PaneSection>
        </div>
      )}
      {notice && <div role="status" className="text-[12.5px] text-ink-secondary">{notice}</div>}
      {error && <div role="alert" className="text-[12.5px] text-danger">{error}</div>}
    </>
  );
}
