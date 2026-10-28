// The task list tool (shared/bot-task-list.ts). One tool, kept short: it
// is sent with the catalog. Not the code work journal.
export const TASK_LIST_TOOL_DEFINITIONS = [
  {
    name: "task_list",
    description:
      "The person's task list for you. States: doing, waiting (needs their decision), done. action list reads them. add creates one (title, optional state doing or waiting). advance moves doing to waiting. complete marks doing or waiting done. You cannot reopen a done task; the person does. Not the code work journal, and not a rule that holds a turn open.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["list", "add", "advance", "complete"] },
        title: { type: "string" },
        state: { type: "string", enum: ["doing", "waiting"] },
        task_id: { type: "string" },
      },
      required: ["action"],
    },
  },
];

export const TASK_LIST_TOOL_NAMES: ReadonlySet<string> = new Set(TASK_LIST_TOOL_DEFINITIONS.map((tool) => tool.name));
