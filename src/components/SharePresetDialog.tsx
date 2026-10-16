import { Check, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { t, tFromServer } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { describePart, describeSkip, preparePictures, saveShareFile, type ShareSkip } from "@/lib/team-share";
import { api } from "@/state/store";
import { FIELD, FieldRow, HelpTip, PILL, PRIMARY_PILL, SettingsGroup, SwitchRow, DIALOG } from "./SettingsPrimitives";
import { ShareContentsGroups } from "./ShareTeamDialog";
import type { NewBotDefaults } from "../../shared/new-bot-defaults";
import type { PackageDocument, PackageSummary } from "../../shared/package-format";

/** POST /api/teams/export with kind "library": a preset file. */
export interface PresetShareResponse {
  document: PackageDocument;
  filename: string;
  redacted: string[];
  skipped: ShareSkip[];
  summary: PackageSummary;
}

export interface PresetShareChoices {
  name: string;
  description?: string;
  release?: string;
  notes?: string;
  includeNotes: boolean;
  picture?: string;
  dryRun?: boolean;
}

/** The request body for a preset file. Pure, for tests. */
export function presetShareBody(choices: PresetShareChoices): Record<string, unknown> {
  const text = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);
  return {
    format: "package",
    version: 2,
    kind: "library",
    name: text(choices.name),
    presetName: text(choices.name),
    presetDescription: text(choices.description),
    release: text(choices.release),
    notes: text(choices.notes),
    includeMemory: choices.includeNotes,
    ...(choices.picture ? { presetAvatar: choices.picture } : {}),
    ...(choices.dryRun ? { dryRun: true } : {}),
  };
}

/** What the preset file holds, counted by the server's own dry run. Pure, for tests. */
export function SharePresetContents({ preview, localSkips }: { preview: PresetShareResponse; localSkips: string[] }) {
  const preset = preview.document.package.presets?.[0];
  const notes = Object.keys(preset?.seed?.memory ?? {}).length;
  const rows: Array<[string, string]> = [
    [t("teamShare.part.skills"), preset?.skills?.length ? `${preset.skills.length} · ${preset.skills.join(", ")}` : "0"],
    [t("teamShare.part.notes"), notes ? String(notes) : t("teamShare.none")],
    [t("teamShare.part.pictures"), preset?.bot.appearance?.avatar ? t("teamShare.yes") : t("teamShare.none")],
  ];
  const skipped = [...localSkips, ...preview.skipped.map((skip) => describeSkip(skip, preview.document))];
  return <ShareContentsGroups rows={rows} never={t("presetShare.never")} redacted={preview.redacted.map((part) => describePart(part, preview.document))} skipped={skipped} />;
}

/** Share as preset…: my New bot defaults as a file of one preset bot and
 * its skills (no team). Whoever imports it picks the preset in New bot. No
 * confirm step; Save file is the decision. */
export function SharePresetDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [release, setRelease] = useState("");
  const [notes, setNotes] = useState("");
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includePicture, setIncludePicture] = useState(true);
  // null while the defaults' picture is being prepared.
  const [picture, setPicture] = useState<{ dataUrl?: string; skipped: string[] } | null>(null);
  const [preview, setPreview] = useState<PresetShareResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<PresetShareResponse | null>(null);
  const [error, setError] = useState("");
  const request = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void api<{ defaults: NewBotDefaults }>("/api/bot-defaults")
      .then(async ({ defaults }) => {
        if (!cancelled && defaults.profile.name?.trim()) setName((current) => current || defaults.profile.name!.trim());
        const prepared = await preparePictures([{ id: "defaults", avatarUrl: defaults.profile.avatarUrl, avatarCrop: defaults.profile.avatarCrop }]);
        if (cancelled) return;
        setPicture({
          dataUrl: prepared.avatars.defaults,
          skipped: prepared.skipped.map((skip) => `${t("teamShare.field.picture")} — ${tFromServer(`teamShare.skip.${skip.reason}`, skip.reason)}`),
        });
      })
      .catch(() => { if (!cancelled) setPicture({ skipped: [] }); });
    return () => { cancelled = true; };
  }, []);

  const choices = (dryRun: boolean): PresetShareChoices => ({
    name, description, release, notes, includeNotes, dryRun,
    ...(includePicture && picture?.dataUrl ? { picture: picture.dataUrl } : {}),
  });

  // Live counts from the server's dry run whenever what goes in changes.
  useEffect(() => {
    if (!picture) return;
    const id = ++request.current;
    const timer = window.setTimeout(() => {
      api<PresetShareResponse>("/api/teams/export", { method: "POST", body: JSON.stringify(presetShareBody({ ...choices(true), release: undefined })) })
        .then((result) => {
          if (id !== request.current) return;
          setPreview(result);
          setError("");
          setRelease((current) => current || result.document.package.release);
        })
        .catch((cause) => {
          if (id !== request.current) return;
          setPreview(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    }, 250);
    return () => window.clearTimeout(timer);
    // Only what goes in changes the counts; names and notes do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picture, includeNotes, includePicture]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<PresetShareResponse>("/api/teams/export", { method: "POST", body: JSON.stringify(presetShareBody(choices(false))) });
      saveShareFile(result.filename, result.document);
      setSaved(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  const localSkips = includePicture ? picture?.skipped ?? [] : [];
  return createPortal(
    <div className={cn(DIALOG.backdrop, "z-[80]")} onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="share-preset-title" tabIndex={-1}
        className={`${DIALOG.frame} max-w-[560px]`}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); }
          if (event.key === "Tab") {
            const controls = dialogRef.current?.querySelectorAll<HTMLElement>("input:enabled, textarea:enabled, button:enabled");
            if (!controls?.length) return;
            const first = controls[0]!, last = controls[controls.length - 1]!;
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}>
        <header className={DIALOG.header}>
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 id="share-preset-title" className={`${DIALOG.title} min-w-0`}>{t("presetShare.title")}</h2>
            <HelpTip label={t("settings.moreAbout", { title: t("presetShare.title") })}>{t("presetShare.intro")}</HelpTip>
          </div>
          <button aria-label={t("presetShare.close")} disabled={saving} onClick={onClose} className={cn(DIALOG.close, "disabled:opacity-40")}><X size={18} className="pointer-events-none" /></button>
        </header>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
          event.preventDefault();
          if (saved) onClose();
          else if (!saving && preview) void save();
        }}>
        <div className={DIALOG.body}>
          {saved ? (
            <>
              <div className="px-1">
                <p className="flex items-center gap-2 text-[13px] font-medium text-ink"><Check size={15} aria-hidden="true" className="text-success" />{t("teamShare.saved", { filename: saved.filename })}</p>
                <p className="mt-1 text-[12px] leading-4 text-ink-secondary">{t("presetShare.savedHint")}</p>
              </div>
              <SharePresetContents preview={saved} localSkips={localSkips} />
            </>
          ) : (
            <>
              <fieldset disabled={saving} className="min-w-0">
                <SettingsGroup groupId="share-preset-choices" title={t("teamShare.choices")}>
                  <SwitchRow className="px-3.5 py-2.5" label={t("presetShare.includePicture")} checked={includePicture} onChange={setIncludePicture} />
                  <SwitchRow className="px-3.5 py-2.5" label={t("presetShare.includeNotes")} checked={includeNotes} onChange={setIncludeNotes} />
                </SettingsGroup>
              </fieldset>
              {preview
                ? <SharePresetContents preview={preview} localSkips={localSkips} />
                : !error && <div role="status" className="flex items-center gap-2 px-1 text-[13px] text-ink-secondary"><Loader2 size={15} className="animate-spin" aria-hidden="true" />{t("presetShare.preparing")}</div>}
              <SettingsGroup groupId="share-preset-file" title={t("teamShare.file")}>
                <div className="grid sm:grid-cols-2">
                  <FieldRow label={t("presetShare.name")}>
                    <input value={name} maxLength={100} disabled={saving} onChange={(event) => setName(event.target.value)} className={FIELD} />
                  </FieldRow>
                  <FieldRow label={t("teamShare.release")}>
                    <input value={release} maxLength={20} disabled={saving} placeholder="1.0.0" onChange={(event) => setRelease(event.target.value)} className={FIELD} />
                  </FieldRow>
                </div>
                <FieldRow label={t("presetShare.description")}>
                  <input value={description} maxLength={300} disabled={saving} onChange={(event) => setDescription(event.target.value)} className={FIELD} />
                </FieldRow>
                <FieldRow label={t("teamShare.notes")}>
                  <textarea value={notes} maxLength={4000} rows={2} disabled={saving} onChange={(event) => setNotes(event.target.value)} className={FIELD} />
                </FieldRow>
              </SettingsGroup>
            </>
          )}
        </div>

        {error && <p role="alert" className="mx-5 mb-2 rounded-xl bg-danger/10 px-3.5 py-2 text-[12.5px] text-danger">{error}</p>}
        <footer className={DIALOG.footer}>
          {saved ? (
            <button type="submit" className={PRIMARY_PILL}>{t("teamShare.done")}</button>
          ) : (
            <>
              <button type="button" disabled={saving} onClick={onClose} className={PILL}>{t("common.cancel")}</button>
              <button type="submit" disabled={saving || !preview} className={PRIMARY_PILL}>
                {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {saving ? t("teamShare.saving") : t("teamShare.save")}
              </button>
            </>
          )}
        </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}
