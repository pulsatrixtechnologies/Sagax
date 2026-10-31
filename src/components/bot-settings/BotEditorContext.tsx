import { createContext, useContext } from "react";
import { api } from "@/state/store";

/** Existing settings use the real API. A creation editor supplies a scoped
 * draft transport; it never replaces fetch or changes another editor's API. */
export const BotEditorContext = createContext<{
  request: typeof api;
  draft?: boolean;
  /** Several existing bots at once (BulkEditBotsDialog): a draft whose
   * wording speaks of the selected bots, not of a new one. */
  bulk?: boolean;
  /** Section fields the selected bots do not share (#1701): controls show
   * a mixed / empty state instead of the first bot's value. */
  mixedFields?: ReadonlySet<string>;
  uploadAvatar?: (file: File) => Promise<string>;
}>({ request: api });

export function useBotEditor() { return useContext(BotEditorContext); }
