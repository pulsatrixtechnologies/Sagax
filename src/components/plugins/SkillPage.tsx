// Plugins > Manage > a private skill, after the reference's skill page: a
// header (icon, name, "Private skill"), Delete Skill, the description, then
// Name, Description and Instructions with Save. A new skill opens the same
// page empty. A skill a marketplace plugin or the organization brought is
// read here and changed where it came from. There is no organization
// library a desktop publishes to (its Admin publishes), so no Publish.
import { useEffect, useState } from "react";
import { BookOpen, Loader2, Trash2 } from "lucide-react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { composeSkillMd, isSkillName, parseSkillMd } from "../../../shared/skill-md";
import type { SkillsLibrarySkillWire } from "../../../shared/wire";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { PluginCard, PluginPageHeader } from "./PluginParts";

export interface SkillPageProps {
  /** absent: a new skill */
  skill?: SkillsLibrarySkillWire;
  /** why it cannot be changed here (a plugin or the organization brought
   * it, or the viewer is not the owner); absent: it can */
  readOnlyReason?: string;
  onBack: () => void;
  onClose: () => void;
  /** after Save: the skill's name (it may have changed) */
  onSaved: (name: string) => Promise<unknown> | void;
  onDeleted: () => Promise<unknown> | void;
}

const fieldClass = "w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none disabled:opacity-60";

export function SkillPage({ skill, readOnlyReason, onBack, onClose, onSaved, onDeleted }: SkillPageProps) {
  const creating = !skill;
  const [loaded, setLoaded] = useState(creating);
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [instructions, setInstructions] = useState("");
  const [enabled, setEnabled] = useState(skill?.enabled ?? false);
  const [busy, setBusy] = useState<"save" | "delete" | "toggle" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!skill) return;
    let cancelled = false;
    setLoaded(false);
    api(`/api/skills-library/${encodeURIComponent(skill.name)}`)
      .then((result) => {
        if (cancelled) return;
        const parsed = parseSkillMd(typeof result.text === "string" ? result.text : "");
        if ("error" in parsed) setInstructions(typeof result.text === "string" ? result.text : "");
        else {
          setName(parsed.name);
          setDescription(parsed.description);
          setInstructions(parsed.body.trim());
        }
        setLoaded(true);
      })
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      cancelled = true;
    };
  }, [skill]);
  useEffect(() => setEnabled(skill?.enabled ?? false), [skill?.enabled]);

  const readOnly = Boolean(readOnlyReason);
  const nameOk = isSkillName(name.trim());
  const canSave = !readOnly && loaded && nameOk && description.trim() !== "" && busy === null;

  const save = async () => {
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      if (creating) {
        await api("/api/skills-library", { method: "POST", body: JSON.stringify({ text: composeSkillMd(null, { name: name.trim(), description, body: instructions }) }) });
      } else {
        await api(`/api/skills-library/${encodeURIComponent(skill.name)}`, {
          method: "PUT",
          body: JSON.stringify({ name: name.trim(), description: description.trim(), instructions }),
        });
      }
      setSaved(true);
      await onSaved(name.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!skill || !window.confirm(t("connectApps.skill.deleteConfirm", { name: skill.name }))) return;
    setBusy("delete");
    setError(null);
    try {
      await api(`/api/skills-library/${encodeURIComponent(skill.name)}`, { method: "DELETE" });
      await onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(null);
    }
  };

  // Turning it on is the review: bots it is assigned to follow it then.
  const toggle = async () => {
    if (!skill) return;
    setBusy("toggle");
    setError(null);
    try {
      await api(`/api/skills-library/${encodeURIComponent(skill.name)}`, { method: "PATCH", body: JSON.stringify({ enabled: !enabled }) });
      setEnabled(!enabled);
      await onSaved(skill.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PluginPageHeader titleId="plugins-title" title={creating ? t("connectApps.skill.new") : skill.name} backLabel={t("connectApps.back")} onBack={onBack} onClose={onClose} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-7 pt-1 sm:px-8" data-plugins-skill={skill?.name ?? "new"}>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 sm:px-5">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary"><BookOpen size={20} aria-hidden="true" /></div>
          <div className="min-w-0 flex-[1_1_200px]">
            <div className="truncate text-[15px] font-semibold text-ink">{creating ? t("connectApps.skill.new") : skill.name}</div>
            <div className="truncate text-[12px] text-ink-secondary">{t("connectApps.skill.private")}</div>
          </div>
          {skill && (
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <button type="button" disabled={busy !== null || !loaded} onClick={() => void toggle()} className={enabled ? "ui-button text-[12px]" : "ui-button ui-button-primary text-[12px]"}>
                {busy === "toggle" ? <Loader2 size={13} className="animate-spin" /> : t(enabled ? "connectApps.skill.turnOff" : "connectApps.skill.turnOn")}
              </button>
              {!readOnly && (
                <button
                  type="button"
                  data-skill-delete
                  disabled={busy !== null}
                  onClick={() => void remove()}
                  className="flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/10 disabled:opacity-40"
                >
                  {busy === "delete" ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} {t("connectApps.skill.delete")}
                </button>
              )}
            </div>
          )}
        </div>

        {skill?.description && <p className="px-1 text-[13px] leading-relaxed text-ink-secondary">{skill.description}</p>}
        {skill && !enabled && <p className="px-1 text-[11.5px] text-ink-secondary">{t("connectApps.skill.reviewHint")}</p>}
        {readOnlyReason && <p role="note" className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">{readOnlyReason}</p>}
        {skill && skill.warnings.length > 0 && <ul className="list-disc pl-5 text-[11.5px] text-warning">{skill.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}

        <PluginCard>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSave) void save();
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-ink">{t("connectApps.skill.name")}</span>
              <input value={name} disabled={readOnly || !loaded} maxLength={64} onChange={(event) => setName(event.target.value)} className={fieldClass} data-skill-field="name" />
              {name.trim() !== "" && !nameOk && <span className="text-[11.5px] text-danger">{t("connectApps.skill.nameRule")}</span>}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-ink">{t("connectApps.skill.description")}</span>
              <textarea value={description} disabled={readOnly || !loaded} maxLength={1024} rows={2} onChange={(event) => setDescription(event.target.value)} className={`${fieldClass} resize-y`} data-skill-field="description" />
            </label>
            <div className="flex flex-col gap-1" data-skill-field="instructions">
              <span id="skill-instructions-label" className="text-[12px] font-medium text-ink">{t("connectApps.skill.instructions")}</span>
              <MarkdownEditor
                value={instructions}
                disabled={!loaded}
                readOnly={readOnly}
                minHeight={260}
                ariaLabelledBy="skill-instructions-label"
                onChange={setInstructions}
                dataField="skill-instructions"
              />
            </div>
            {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}
            {!readOnly && (
              <div className="flex items-center justify-end gap-2">
                {saved && !error && <span role="status" className="text-[12px] text-success">{t("connectApps.skill.saved")}</span>}
                <button type="submit" disabled={!canSave} className="ui-button ui-button-primary text-[12.5px] disabled:opacity-40">
                  {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : t("connectApps.skill.save")}
                </button>
              </div>
            )}
          </form>
        </PluginCard>
      </div>
    </>
  );
}
