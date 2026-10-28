// The task list tool (shared/bot-task-list.ts). One tool, kept short: it
// is sent with the catalog. Not the code work journal.
export const TASK_LIST_TOOL_DEFINITIONS = [
  {
    name: "task_list",
    description:
      "The person's to-do list you keep for them (shown in your panel). States: doing, waiting (needs them), done. list reads it. add: title, state, optional note. advance: doing to waiting. complete: to done. note: your note on a task. Name a task by task_id or exact title. Only the person reopens or removes. Not the code work journal.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["list", "add", "advance", "complete", "note"] },
        title: { type: "string" },
        state: { type: "string", enum: ["doing", "waiting", "done"] },
        note: { type: "string" },
        task_id: { type: "string" },
      },
      required: ["action"],
    },
  },
];

export const TASK_LIST_TOOL_NAMES: ReadonlySet<string> = new Set(TASK_LIST_TOOL_DEFINITIONS.map((tool) => tool.name));
