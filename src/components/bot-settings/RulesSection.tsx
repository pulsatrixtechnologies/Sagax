// Rules: the bot's RULES.md, hard constraints it checks every turn, loaded
// right after the Soul and before memory under its own budget
// (docs/bot-workspace.md). The file goes through the memory routes, so a
// save refuses to overwrite a rule the bot added meanwhile (rules_update)
// and every change lands in the memory journal.
//
// Fetched when the category becomes active; kept mounted by the persona
// editor so an unsaved draft survives a look at another category. A bot
// without RULES.md opens on the starter template (three example rules in a
// comment, which never loads); nothing is written until the person saves.
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { fetchMemoryDoc, formatBytes, saveMemoryDoc } from "@/lib/memory";
import { RULES_PATH, rulesCount } from "@/lib/workspace-files";
import type { Bot } from "@/state/store";
import { MarkdownEditor } from "../markdown/MarkdownEditor";

/** The starter template. Mirrors server/workspace-files.ts RULES_TEMPLATE
 * (a test keeps them equal). */
export const RULES_TEMPLATE = `# Rules

<!--
Hard constraints this bot checks every turn. One rule per line.
Identity goes in Soul; facts go in Memory. Text inside this comment is not loaded.

Examples (copy a line below the comment to use it):
- Never send an email to a client without showing me the draft first.
- Always answer in the language the person writes in.
- Never quote a price; send pricing questions to the sales team.
-->
`;

const buttonCls = "rounded-lg bg-control px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50";

interface Loaded {
  text: string;
  hash: string;
  exists: boolean;
}

export function RulesCounter({ text }: { text: string }) {
  const count = rulesCount(text);
  return (
    <span data-rules-counter="" className={cn(count.over && "text-danger")}>
      {t("persona.rules.counter", {
        lines: count.lines,
        maxLines: count.maxLines,
        bytes: formatBytes(count.bytes),
        maxBytes: formatBytes(count.maxBytes),
      })}
    </span>
  );
}

export function RulesSection({ bot, active, initial }: { bot: Bot; active: boolean; initial?: Loaded }) {
  const [loaded, setLoaded] = useState<Loaded | null>(initial ?? null);
  const [draft, setDraft] = useState(initial ? (initial.exists ? initial.text : RULES_TEMPLATE) : "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ current: string; currentHash: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const load = () =>
    fetchMemoryDoc(bot.id, RULES_PATH).then(
      (doc) => {
        setLoaded({ text: doc.text, hash: doc.hash, exists: doc.exists });
        if (!dirtyRef.current) setDraft(doc.exists ? doc.text : RULES_TEMPLATE);
        setError(null);
      },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    );

  // A re-activation re-reads, so a rule the bot added mid-session shows up.
  useEffect(() => {
    if (!active) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bot.id]);

  const save = async (expectedHash: string | undefined) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await saveMemoryDoc(bot.id, RULES_PATH, draft, expectedHash);
      if (!result.ok) {
        setConflict({ current: result.current, currentHash: result.currentHash });
        return;
      }
      setConflict(null);
      setLoaded({ text: result.doc.text, hash: result.doc.hash, exists: true });
      setDraft(result.doc.text);
      setDirty(false);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const starter = loaded !== null && !loaded.exists;
  const count = rulesCount(draft);

  return (
    <div className="flex flex-col gap-3" data-rules-section="">
      <p className="text-[13px] leading-relaxed text-ink-secondary">{t("persona.rules.intro")}</p>
      <p role="note" data-rules-inheritance="" className="rounded-lg bg-raised/60 px-3 py-2 text-[12.5px] leading-snug text-ink-secondary">
        {t("persona.rules.inheritance")}
      </p>
      {starter && !dirty && (
        <p data-rules-starter="" className="text-[12.5px] text-ink-secondary">{t("persona.rules.starter")}</p>
      )}
      <MarkdownEditor
        ariaLabel={t("persona.rules.editorLabel")}
        value={draft}
        onChange={(next) => {
          setDraft(next);
          setDirty(true);
          setSaved(false);
        }}
        minHeight={220}
        dataField="rules"
        placeholder={t("persona.rules.placeholder")}
        invalid={count.over}
        footer={<RulesCounter text={draft} />}
      />
      {count.over && (
        <p role="alert" className="text-[12.5px] text-danger">
          {t("persona.rules.over", { maxLines: count.maxLines, maxBytes: formatBytes(count.maxBytes) })}
        </p>
      )}
      {conflict && (
        <div role="alert" className="rounded-lg border border-warning/25 bg-warning/10 p-3 text-[12.5px] leading-relaxed text-ink">
          <div className="font-medium">{t("persona.rules.conflict")}</div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={buttonCls}
              disabled={saving}
              onClick={() => {
                setDraft(conflict.current);
                setLoaded({ text: conflict.current, hash: conflict.currentHash, exists: true });
                setDirty(false);
                setConflict(null);
              }}
            >
              {t("persona.rules.reload")}
            </button>
            <button type="button" className={buttonCls} disabled={saving} onClick={() => void save(conflict.currentHash)}>
              {t("persona.rules.overwrite")}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-rules-save=""
          className={buttonCls}
          disabled={saving || loaded === null || (!dirty && !starter)}
          onClick={() => void save(loaded?.hash)}
        >
          {saving ? t("persona.rules.saving") : t("persona.rules.save")}
        </button>
        {dirty && (
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink"
            disabled={saving}
            onClick={() => {
              setDraft(loaded?.exists ? loaded.text : RULES_TEMPLATE);
              setDirty(false);
            }}
          >
            {t("persona.rules.discard")}
          </button>
        )}
        {saved && !dirty && <span className="text-[12.5px] text-ink-secondary">{t("persona.rules.saved")}</span>}
      </div>
    </div>
  );
}
