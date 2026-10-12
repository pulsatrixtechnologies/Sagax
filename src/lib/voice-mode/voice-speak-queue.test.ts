import { describe, expect, it } from "vitest";

import { nextSpeakSlot } from "./voice-speak-queue";

describe("nextSpeakSlot", () => {
  it("holds while the person is talking", () => {
    expect(nextSpeakSlot({
      userSpeaking: true,
      botSpeaking: false,
      waiting: [{ id: "a", priority: "topic-result", at: 1 }],
    })).toEqual({ action: "hold" });
  });

  it("holds while the bot is already speaking", () => {
    expect(nextSpeakSlot({
      userSpeaking: false,
      botSpeaking: true,
      waiting: [{ id: "a", priority: "user-reply", at: 1 }],
    })).toEqual({ action: "hold" });
  });

  it("speaks two results that land together one after another, user-reply first, then arrival order", () => {
    const waiting = [
      { id: "b", priority: "topic-result" as const, at: 20 },
      { id: "a", priority: "topic-result" as const, at: 10 },
      { id: "live", priority: "user-reply" as const, at: 15 },
    ];
    const first = nextSpeakSlot({ userSpeaking: false, botSpeaking: false, waiting });
    expect(first).toEqual({ action: "speak", id: "live" });
    const rest = waiting.filter((item) => item.id !== "live");
    const second = nextSpeakSlot({ userSpeaking: false, botSpeaking: false, waiting: rest });
    expect(second).toEqual({ action: "speak", id: "a" });
    const last = rest.filter((item) => item.id !== "a");
    const third = nextSpeakSlot({ userSpeaking: false, botSpeaking: false, waiting: last });
    expect(third).toEqual({ action: "speak", id: "b" });
  });

  it("a queued-notice waits behind topic results", () => {
    expect(nextSpeakSlot({
      userSpeaking: false,
      botSpeaking: false,
      waiting: [
        { id: "notice", priority: "queued-notice", at: 1 },
        { id: "result", priority: "topic-result", at: 2 },
      ],
    })).toEqual({ action: "speak", id: "result" });
  });
});
