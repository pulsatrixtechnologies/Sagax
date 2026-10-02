import { describe, expect, it } from "vitest";

import type { Message } from "./store.ts";
import { unansweredCallMessage, voiceCallRecoveryPrompt, VOICE_CALL_RECOVERY_NOTE } from "./voice-call-watchdog.ts";

let n = 0;
const msg = (patch: Partial<Message>): Message => ({ id: `m${n += 1}`, at: n * 1_000, role: "user", kind: "text", text: "x", ...patch } as Message);
const said = (text: string, at?: number) => msg({ text, voiceCall: { callId: "call-0123456789" }, ...(at !== undefined ? { at } : {}) });
const reply = (text: string) => msg({ role: "bot", text });

describe("unansweredCallMessage", () => {
  it("finds the person's newest words on the call with no answer after them", () => {
    const llama = said("can you draw me a llama");
    expect(unansweredCallMessage([said("hello"), reply("Hi!"), llama], { retried: new Set() })).toBe(llama);
    // only activity after it (a tool ran, an error) is still no answer
    expect(unansweredCallMessage([llama, msg({ role: "bot", kind: "activity", text: undefined })], { retried: new Set() })).toBe(llama);
  });

  it("is quiet when the words got an answer, were not said on the call, or were retried", () => {
    const question = said("what about voice mode");
    expect(unansweredCallMessage([question, reply("It works.")], { retried: new Set() })).toBeNull();
    expect(unansweredCallMessage([msg({ text: "typed" })], { retried: new Set() })).toBeNull();
    expect(unansweredCallMessage([question], { retried: new Set([question.id]) })).toBeNull();
  });

  it("is quiet while a question or approval waits for the person", () => {
    const words = said("delete the file");
    const card = msg({ role: "bot", kind: "options", card: { requestId: "r1", subtitle: "Allow?", options: [] } as unknown as Message["card"] });
    expect(unansweredCallMessage([words, card], { retried: new Set() })).toBeNull();
  });

  it("leaves words a person cut on purpose: older than their stop", () => {
    const words = said("tell me a story", 5_000);
    expect(unansweredCallMessage([words], { stoppedAt: 6_000, retried: new Set() })).toBeNull();
    // words that arrived while the stop was under way still get an answer
    expect(unansweredCallMessage([words], { stoppedAt: 4_000, retried: new Set() })).toBe(words);
  });

  it("retries with a note before the words", () => {
    expect(voiceCallRecoveryPrompt("draw a llama")).toBe(`${VOICE_CALL_RECOVERY_NOTE}\n\ndraw a llama`);
  });
});
