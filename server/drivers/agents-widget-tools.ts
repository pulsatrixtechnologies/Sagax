// The two chat-widget tools of the agents catalog
// (docs/superpowers/specs/2026-10-13-chat-widgets-design.md), spread into
// TOOL_DEFINITIONS in agents-catalog.ts. Definitions only, like that file;
// agents-call-cards.ts carries a call out and server/chat-widgets.ts stores
// the result. Every word here is sent to the model on every turn and pinned
// by agents-catalog-wire.test.ts.
export const WIDGET_TOOL_DEFINITIONS = [
  {
    name: "show_widget",
    description:
      "Show an interactive widget in this chat: a card, list, form, table or chart. Use it when a choice, a confirmation, a status or a small set of structured results reads better as UI than as prose. `widget` is one JSON tree. The root is {type:\"Card\"|\"ListView\", title?, caption?, meta?, children:[...], confirm?:{label,action}, cancel?:{label,action}}. Nodes: Row, Col, Box, Spacer, Divider, Text, Title, Caption, Markdown, Badge{label,color,variant:\"dot\"}, Icon{name}, Image{src}, Progress{value}, Table>Table.Row>Table.Cell, Chart{data,series:[{type,dataKey}],xAxis}, Button{label,onClickAction}, Select|RadioGroup{name,options:[{label,value}]}, Checkbox{name,label}, Input|Textarea|DatePicker{name}, Form{onSubmitAction,children}; a ListView holds ListViewItem{children,onClickAction}. To have the person choose one row, give the ListView a name and each row a value: rows become selectable and confirm sends the chosen one. To act on a row at once, give each row an onClickAction instead. An action is {type,payload?}; {type:\"open_url\",payload:{url}} opens a link. When the person presses confirm, cancel or a button, their choice and any field values arrive as their next message, so end your turn after showing a widget that asks something. Keep it small: one confirm, one cancel, at most 8 rows. Never ask for passwords here. Not available in rooms.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        widget: { type: "object", additionalProperties: true, description: "The widget tree." },
        fallback_text: { type: "string", description: "Optional plain-text version for clients that cannot draw widgets. Written for you when omitted." },
      },
      required: ["widget"],
    },
  },
  {
    name: "update_widget",
    description:
      "Replace a widget you showed earlier in this chat, in place: a progress bar moving, a status changing. `widget_id` is the id show_widget returned. A widget the person already answered cannot be updated; show a new one.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        widget_id: { type: "string" },
        widget: { type: "object", additionalProperties: true },
      },
      required: ["widget_id", "widget"],
    },
  },
];
