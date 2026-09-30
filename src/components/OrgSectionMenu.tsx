// The sidebar section menu on a server signed in with Perspicax (slice 4,
// spec section 3: sections are channels). Right-click, Shift+F10 or the
// ContextMenu key on a section header, or a right-click on the empty list
// area, opens it for every signed-in person. What the caller may not do is
// not shown (server/section-channels.ts decides in the end).
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsDownUp, ChevronsUpDown, Pencil, Plus, Trash2, Users } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { OrgSection } from "@/lib/perspicax-org";

export interface OrgSectionMenuActions {
  onNew: () => void;
  onRename?: () => void;
  onMembers?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onCollapseAll?: () => void;
  onExpandAll?: () => void;
  onDelete?: () => void;
}

/** Which items a section's menu shows: General (null) and the empty list
 * area only create; a shared section's items follow the caller's rights. */
export function orgSectionMenuItems(section: OrgSection | null, input: { named: boolean; canMoveUp: boolean; canMoveDown: boolean; anyExpanded: boolean }): Array<keyof OrgSectionMenuActions> {
  const items: Array<keyof OrgSectionMenuActions> = ["onNew"];
  if (input.named && section?.canModerate) items.push("onRename");
  if (input.named && section) items.push("onMembers");
  if (input.canMoveUp) items.push("onMoveUp");
  if (input.canMoveDown) items.push("onMoveDown");
  items.push(input.anyExpanded ? "onCollapseAll" : "onExpandAll");
  if (input.named && section?.canModerate) items.push("onDelete");
  return items;
}

const ITEM_KEYS = {
  onNew: { label: "sidebar.section.new", Icon: Plus },
  onRename: { label: "sidebar.section.rename", Icon: Pencil },
  onMembers: { label: "sidebar.section.members", Icon: Users },
  onMoveUp: { label: "sidebar.section.moveUp", Icon: ArrowUp },
  onMoveDown: { label: "sidebar.section.moveDown", Icon: ArrowDown },
  onCollapseAll: { label: "sidebar.section.collapseAll", Icon: ChevronsDownUp },
  onExpandAll: { label: "sidebar.section.expandAll", Icon: ChevronsUpDown },
  onDelete: { label: "sidebar.section.delete", Icon: Trash2 },
} as const satisfies Record<keyof OrgSectionMenuActions, { label: string; Icon: typeof Plus }>;

export function OrgSectionMenuItems({ items, actions }: { items: Array<keyof OrgSectionMenuActions>; actions: OrgSectionMenuActions }) {
  const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover";
  return (
    <>
      {items.map((key, index) => {
        const action = actions[key];
        if (!action) return null;
        const { label, Icon } = ITEM_KEYS[key];
        return (
          <button key={key} type="button" role="menuitem" autoFocus={index === 0} className={cn(item, key === "onDelete" && "text-danger")} onClick={action}>
            <Icon size={14} aria-hidden="true" />{t(label)}
          </button>
        );
      })}
    </>
  );
}

/** A section name typed in place (a new section, or a rename in the
 * header): Enter saves, Escape cancels. */
export function SectionNameInput({ initial = "", onSave, onCancel }: { initial?: string; onSave: (name: string) => Promise<string | null>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const save = async () => {
    const name = value.trim();
    if (!name || saving) return;
    if (name === initial.trim()) { onCancel(); return; }
    setSaving(true);
    const failed = await onSave(name);
    setSaving(false);
    if (failed) setError(failed);
  };
  return (
    <div className="flex flex-col gap-1 px-2 py-1" data-section-name-input>
      <input
        ref={ref}
        value={value}
        maxLength={60}
        aria-label={t("sidebar.section.namePlaceholder")}
        placeholder={t("sidebar.section.namePlaceholder")}
        disabled={saving}
        onChange={(event) => { setValue(event.target.value); setError(null); }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); void save(); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
        }}
        onBlur={() => { if (!saving && !error) onCancel(); }}
        className="w-full rounded-md border border-hairline/60 bg-inset px-2 py-1 text-[12px] font-semibold uppercase tracking-wide text-sidebar-ink focus:outline-none"
      />
      {error && <span role="alert" className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}
