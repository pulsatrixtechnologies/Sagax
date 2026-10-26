// Rename a saved server: the name the person sees for it in Switch account
// and Switch organization. Kept on this computer only; empty goes back to
// the name the server announced (or its host).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { DIALOG, FIELD, FieldRow, GROUP_CARD, PILL, PRIMARY_PILL } from "./SettingsPrimitives";

const MAX_NAME = 80;

export function RenameServerDialog({ current, defaultName, onSave, onClose }: {
  /** the name now shown */
  current: string;
  /** the name used when the field is left empty */
  defaultName: string;
  /** the new name; "" clears the person's own name */
  onSave: (label: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(current === defaultName ? "" : current);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useModalDialog(dialog, onClose);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  return createPortal(<div data-thread-overlay className={cn(DIALOG.backdrop, "z-50")}
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="rename-server-title" className={`${DIALOG.frame} max-w-[440px]`}>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
        event.preventDefault();
        onSave(value.trim().replace(/\s+/g, " "));
        onClose();
      }}>
        <div className={DIALOG.header}>
          <h2 id="rename-server-title" className={DIALOG.title}>{t("sidebar.account.renameTitle")}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className={DIALOG.close}><X size={18} className="pointer-events-none" /></button>
        </div>
        <div className={DIALOG.body}>
          <div className={GROUP_CARD}>
            <FieldRow label={t("sidebar.account.renameField")} hint={t("sidebar.account.renameHint", { name: defaultName })} hintId="rename-server-hint">
              <input ref={input} value={value} maxLength={MAX_NAME} autoComplete="off" spellCheck={false} aria-describedby="rename-server-hint"
                placeholder={defaultName} onChange={(event) => setValue(event.target.value)} className={FIELD} />
            </FieldRow>
          </div>
        </div>
        <div className={DIALOG.footer}>
          <button type="button" onClick={onClose} className={PILL}>{t("common.cancel")}</button>
          <button type="submit" className={PRIMARY_PILL}>{t("common.save")}</button>
        </div>
      </form>
    </div>
  </div>, document.body);
}
