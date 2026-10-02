// The steps of an activity entry as a person reads them: a plain name for
// each tool call ("Read a file", "Run a command", "Sub-agent: check the
// logs") with the raw tool id kept for the technical details, and the calls
// a sub-agent made nested under that sub-agent's own step.
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { parseToolId } from "@/lib/approval-describe";
import { toolLabel } from "@/components/ApprovalCard";
import type { BotActivityStep } from "@/lib/bot-activity";

const SUBAGENT = new Set(["Agent", "Task"]);

/** Built-in and harness tools the approval naming does not cover. */
const STEP_NAMES: Record<string, LocaleKey> = {
  ToolSearch: "activity.step.toolSearch",
  Glob: "activity.step.searchFiles",
  Grep: "activity.step.searchFiles",
  LS: "activity.step.listFiles",
  TodoWrite: "activity.step.todo",
  NotebookEdit: "approval.tool.editFile",
  MultiEdit: "approval.tool.editFile",
};

/** Tools served by Sagax's own MCP servers, by their bare name. */
const BARE_NAMES: Record<string, LocaleKey> = {
  read_file: "approval.tool.readFile",
  write_file: "approval.tool.writeFile",
  edit_file: "approval.tool.editFile",
  list_files: "activity.step.listFiles",
  list_dir: "activity.step.listFiles",
  list_directory: "activity.step.listFiles",
  vm_exec: "approval.tool.runCommand",
  run_command: "approval.tool.runCommand",
  exec: "approval.tool.runCommand",
  search_files: "activity.step.searchFiles",
};

function capitalize(text: string): string {
  return text ? text[0]!.toLocaleUpperCase() + text.slice(1) : text;
}

export function isSubagentStep(step: Pick<BotActivityStep, "name" | "subagent">): boolean {
  return SUBAGENT.has(step.name) || Boolean(step.subagent);
}

/** The step's name in words. */
export function humanStepName(step: Pick<BotActivityStep, "name" | "input" | "subagent">): string {
  if (isSubagentStep(step)) {
    const about = step.subagent?.description ?? step.subagent?.type;
    return about ? t("activity.step.subagent", { description: about }) : t("activity.step.subagentBare");
  }
  const known = STEP_NAMES[step.name];
  if (known) return capitalize(t(known));
  const { server, name } = parseToolId(step.name);
  if (server) {
    const bare = BARE_NAMES[name];
    if (bare) return capitalize(t(bare));
  }
  return capitalize(toolLabel(step.name, step.input));
}

/** The top-level steps, and each sub-agent's own steps by its step id. */
export function stepTree(steps: readonly BotActivityStep[]): { top: BotActivityStep[]; children: Map<string, BotActivityStep[]> } {
  const ids = new Set(steps.map((step) => step.id));
  const children = new Map<string, BotActivityStep[]>();
  const top: BotActivityStep[] = [];
  for (const step of steps) {
    if (step.parentId && ids.has(step.parentId)) {
      const list = children.get(step.parentId) ?? [];
      list.push(step);
      children.set(step.parentId, list);
    } else {
      top.push(step);
    }
  }
  return { top, children };
}
