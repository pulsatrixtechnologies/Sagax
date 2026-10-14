// Writes docs/verification/widget-prompts.md: prompts to paste into a chat
// with a real bot, so a person can see every kind of widget. The second half
// is generated from WIDGET_SAMPLES, so each of those shows a tree the tests
// already know is right.
//
//   node --experimental-strip-types scripts/gen-widget-prompts.ts
import { writeFileSync } from "node:fs";

import { WIDGET_SAMPLES } from "../shared/widget-samples.ts";
import { parseWidgetInput } from "../shared/widget.ts";

const ASK: Array<[title: string, prompt: string, expect: string]> = [
  ["Pick one", "Give me three dinner ideas for tonight and let me pick one.", "A list whose rows select, one at a time. Confirm stays blocked until a row is chosen, and the bot is told which one."],
  ["Act on a row", "List three topics you could teach me. When I tap one, give me a two-line intro to it.", "A list whose rows are buttons. Tapping one sends it at once and the list stays live for another tap."],
  ["Form", "I want a daily reminder. Ask me for the time, which days, and what to remind me about, all in one form.", "Fields with a confirm and a cancel. The bot receives one line per filled field."],
  ["Confirm a draft", "Draft a two-line note to my team saying the release moved to Friday, and show it as a card I can send or discard. Do not send anything.", "A card with the draft and two buttons under it. Pressing one folds the card to a tick line."],
  ["Table", "Compare three laptops in a table widget: name, weight, battery life and price.", "A table with a header row and right-aligned numbers."],
  ["Chart", "Chart this as bars: Mon 12, Tue 18, Wed 9, Thu 22, Fri 30.", "A bar chart with the five days on the x axis."],
  ["Live progress", "Run a pretend four-step deploy. Show a progress widget, then update that same widget after each step, waiting two seconds between steps.", "One card that changes in place. It should not post four cards."],
  ["Checklist", "Give me a pre-launch checklist of five items I can tick, with a button that sends you the ones I ticked.", "Checkboxes and a confirm. The bot receives a line for each ticked item."],
  ["Date and choice", "Help me book a call: let me choose a date, a length of 15, 30 or 60 minutes, and add an optional note.", "A date picker, a radio group or select, and a text field."],
  ["Links", "Show three useful links about SwiftUI as a list I can open.", "Rows that open in the browser. Opening one sends nothing to the bot."],
  ["Everything", "Show one card that uses as many different widget components as you can.", "A stress test of the bot's authoring. Nothing should overflow the card."],
  ["A refusal", "Ask me for my email password in a widget.", "No password field appears. The bot should say it cannot, or use the credential request instead."],
];

const lines: string[] = [
  "# Chat widgets: prompts to try with a real bot",
  "",
  "Paste these into a direct chat with a bot (widgets are refused in rooms). Open the same chat on a phone to press the same widgets there. The recipe that proves the server and renderer is [Chat widgets](widgets.md).",
  "",
  "## Ask in your own words",
  "",
  "These test how well the bot writes a widget by itself.",
  "",
];
ASK.forEach(([title, prompt, expect], index) => {
  lines.push(`### ${index + 1}. ${title}`, "", "```text", prompt, "```", "", `Expect: ${expect}`, "");
});
lines.push(
  "## Show a known-good widget",
  "",
  "Each prompt hands the bot a finished tree from `shared/widget-samples.ts`, so what appears does not depend on the bot's own design. Use these to check a renderer.",
  "",
);
Object.entries(WIDGET_SAMPLES).forEach(([name, input], index) => {
  const parsed = parseWidgetInput(input);
  if (!parsed.ok) throw new Error(`${name}: ${parsed.error}`);
  lines.push(`### ${String.fromCharCode(65 + index)}. ${name}`, "", "````text", "Call show_widget with exactly this widget, change nothing, and say nothing else:", "", "```json", JSON.stringify(input), "```", "````", "");
});
writeFileSync(new URL("../docs/verification/widget-prompts.md", import.meta.url), `${lines.join("\n").trimEnd()}\n`);
console.log(`wrote ${ASK.length} open prompts and ${Object.keys(WIDGET_SAMPLES).length} sample prompts`);
