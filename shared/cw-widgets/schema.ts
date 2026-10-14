// The ```cw widget format as the bot is told about it. The system prompt
// (server/system-prompt.ts) and the rejection reasons (validate.ts) are built
// from these constants, and cw-widgets.test.ts checks them against
// sanitizeCwWidget, so what the bot reads never drifts from what draws.

import type { CwFamily, CwWidgetBase } from "./types.ts";

export const CW_FAMILIES = ["ticket", "time", "schedule", "agreement", "company"] as const satisfies readonly CwFamily[];
export const CW_VIEWS = ["card", "list"] as const satisfies readonly CwWidgetBase["view"][];

/** The fields a record of each family must carry to be kept. */
export const CW_REQUIRED_FIELDS: Record<CwFamily, readonly string[]> = {
  ticket: ["id", "summary"],
  time: ["id"],
  schedule: ["id", "name"],
  agreement: ["id", "name"],
  company: ["id", "name"],
};

/** The smallest valid widget, quoted in the prompt. */
export const CW_WIDGET_EXAMPLE = '{"family":"ticket","view":"card","records":[{"id":48213,"summary":"Printer offline","status":"New","company":"Acme"}]}';

export function isCwFamily(value: unknown): value is CwFamily {
  return typeof value === "string" && (CW_FAMILIES as readonly string[]).includes(value);
}

/** "a, b or c" (or "a, b and c") */
export function cwOrList(values: readonly string[], word: "or" | "and" = "or"): string {
  return values.length < 2 ? values.join("") : `${values.slice(0, -1).join(", ")} ${word} ${values[values.length - 1]}`;
}
