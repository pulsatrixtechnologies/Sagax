// #2383: a chat link opened from outside the app must reach the page; every
// other sagax:// link stays with its own handler.
import assert from "node:assert/strict";
import test from "node:test";

import { chatLinkFrom, chatLinkFromCommandLine } from "./chat-link.mjs";

const THREAD_LINK = "sagax://thread/2633ea27-cc9d-4690-97bf-aca853eca4c6?bot=1f72ec75-821b-44a5-a7a3-93ff64276c7d";
const BOT_LINK = "sagax://bot/1f72ec75-821b-44a5-a7a3-93ff64276c7d";
/** The app's former link prefix, which no longer reaches it. */
const RETIRED = "otherapp";

test("recognizes the links Copy link and a dashboard make", () => {
  assert.equal(chatLinkFrom(THREAD_LINK), THREAD_LINK);
  assert.equal(chatLinkFrom(BOT_LINK), BOT_LINK);
  assert.equal(chatLinkFrom(` ${BOT_LINK}\n`), BOT_LINK);
  assert.equal(chatLinkFrom("sagax://Bot/abc"), "sagax://Bot/abc");
});

test("leaves every other link to its own handler", () => {
  for (const other of [
    "sagax://cloud",
    "sagax://organization",
    "sagax://install?url=https://github.com/a/b/team.md",
    "sagax://threads/abc",
    "sagax://bots/abc",
    "https://example.com/sagax://bot/abc",
    `${RETIRED}://bot/abc`,
    `${RETIRED}://thread/abc?bot=def`,
    `sagax://bot/${"x".repeat(1024)}`,
    undefined,
    42,
  ]) assert.equal(chatLinkFrom(other), null);
});

test("finds the link among a second launch's arguments", () => {
  assert.equal(chatLinkFromCommandLine(["/usr/bin/openmausbot", "--no-sandbox", THREAD_LINK]), THREAD_LINK);
  assert.equal(chatLinkFromCommandLine(["/usr/bin/openmausbot", "--no-sandbox", BOT_LINK]), BOT_LINK);
  assert.equal(chatLinkFromCommandLine(["/usr/bin/sagax", "sagax://cloud"]), null);
});
