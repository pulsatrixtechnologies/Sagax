// Types shared by MarkdownEditor.tsx (main bundle) and its lazily loaded
// CodeMirror chunk (MarkdownEditorCore.tsx). Type-only, so importing it
// never pulls the chunk into the main bundle.
import type { MutableRefObject } from "react";

import type { TextSelection } from "./markdown-edits";

export type MarkdownEditFn = (state: TextSelection) => TextSelection | null;

export interface MarkdownShortcut {
  /** a CodeMirror key name, e.g. "Mod-b", "Mod-Shift-7" */
  key: string;
  edit: MarkdownEditFn;
}

export interface MarkdownCoreHandle {
  run: (edit: MarkdownEditFn) => void;
  focus: () => void;
  selection: () => TextSelection;
}

export interface MarkdownCoreProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onEscape?: () => void;
  onSelection?: () => void;
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  dataField?: string;
  shortcuts: MarkdownShortcut[];
  handleRef: MutableRefObject<MarkdownCoreHandle | null>;
}
