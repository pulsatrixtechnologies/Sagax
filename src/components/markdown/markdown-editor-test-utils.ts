// Helpers for happy-dom tests of fields that use MarkdownEditor: wait for
// the CodeMirror chunk to mount, read its text, and type into it the way a
// keystroke does (a transaction on the view, reported through onChange).
import { EditorView } from "@codemirror/view";
import { flushSync } from "react-dom";

import { loadMarkdownEditorCore } from "./MarkdownEditor";

/** The editable element of the markdown editor `field` (data-markdown-field)
 * under `container`, once CodeMirror has mounted. */
export async function markdownEditorIn(container: ParentNode, field?: string): Promise<HTMLElement> {
  await loadMarkdownEditorCore();
  const selector = field ? `.cm-content[data-markdown-field="${field}"]` : ".cm-content";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const content = container.querySelector<HTMLElement>(selector);
    if (content) return content;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`no markdown editor ${field ?? ""} mounted`);
}

/** The editor's text, line breaks included. */
export function markdownText(content: HTMLElement): string {
  return EditorView.findFromDOM(content)!.state.doc.toString();
}

/** Replace the whole text, as typing would. */
export function typeMarkdown(content: HTMLElement, text: string) {
  const view = EditorView.findFromDOM(content)!;
  flushSync(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: "input.type" }));
}

/** Leave the editor (its blur handler runs). */
export function blurMarkdown(content: HTMLElement) {
  flushSync(() => content.dispatchEvent(new FocusEvent("blur")));
}
