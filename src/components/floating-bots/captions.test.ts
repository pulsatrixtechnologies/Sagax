import { describe, expect, it } from "vitest";
import { CAPTION_LINES, captionFeed, captionLines, captionText, nextWordIn, revealedWords, WORDS_PER_SECOND } from "./captions";

describe("captionFeed", () => {
  it("nothing while connecting or once ended", () => {
    expect(captionFeed(null, { phase: "connecting", line: "", now: 0 })).toBeNull();
    expect(captionFeed({ who: "bot", text: "Hi", since: 0 }, { phase: "ended", line: "", now: 5 })).toBeNull();
  });

  it("the person's words as heard, the same caption while they grow", () => {
    const first = captionFeed(null, { phase: "hearing", line: "Hello", now: 100 });
    expect(first).toEqual({ who: "you", text: "Hello", since: 100 });
    const more = captionFeed(first, { phase: "hearing", line: "Hello  Cryptic\nfrom", now: 400 });
    expect(more).toEqual({ who: "you", text: "Hello Cryptic from", since: 100 });
  });

  it("each sentence of the bot's answer starts revealing when it is heard", () => {
    const you = { who: "you" as const, text: "Hello", since: 0 };
    const bot = captionFeed(you, { phase: "speaking", line: "Hi there, how can I help?", now: 2000 });
    expect(bot).toEqual({ who: "bot", text: "Hi there, how can I help?", since: 2000 });
    expect(captionFeed(bot, { phase: "speaking", line: "Hi there, how can I help?", now: 2500 })).toBe(bot);
    expect(captionFeed(bot, { phase: "speaking", line: "Next one.", now: 4000 })).toEqual({ who: "bot", text: "Next one.", since: 4000 });
  });

  it("listening, thinking and hold keep the last sentence", () => {
    const bot = { who: "bot" as const, text: "Done.", since: 10 };
    for (const phase of ["listening", "thinking", "held"] as const) expect(captionFeed(bot, { phase, line: "", now: 99 })).toBe(bot);
  });

  it("with nothing live yet, the call's last line shows whole", () => {
    expect(captionFeed(null, { phase: "listening", line: "", last: { who: "bot", text: "Earlier answer." }, now: 5 })).toEqual({ who: "bot", text: "Earlier answer.", since: -Infinity });
    expect(captionFeed(null, { phase: "listening", line: "", last: null, now: 5 })).toBeNull();
  });
});

describe("word by word", () => {
  const sentence = { who: "bot" as const, text: "one two three four five six", since: 1000 };

  it("one word at once, then at speaking pace, never past the sentence", () => {
    expect(revealedWords(sentence, 1000)).toBe(1);
    expect(captionText(sentence, 1000)).toBe("one");
    const perWord = 1000 / WORDS_PER_SECOND;
    expect(revealedWords(sentence, 1000 + perWord + 1)).toBe(2);
    expect(captionText(sentence, 1000 + 2 * perWord + 1)).toBe("one two three");
    expect(captionText(sentence, 60_000)).toBe(sentence.text);
  });

  it("a faster voice reveals faster", () => {
    expect(revealedWords(sentence, 2000, WORDS_PER_SECOND * 2)).toBeGreaterThan(revealedWords(sentence, 2000));
  });

  it("the person's words and a finished line show whole", () => {
    expect(captionText({ who: "you", text: "all at once here", since: 0 }, 0)).toBe("all at once here");
    expect(captionText({ who: "bot", text: "whole line", since: -Infinity }, 0)).toBe("whole line");
  });

  it("the next word is due at the pace; none once all show", () => {
    expect(nextWordIn(sentence, 1000)).toBe(Math.ceil(1000 / WORDS_PER_SECOND));
    expect(nextWordIn(sentence, 60_000)).toBeNull();
    expect(nextWordIn({ who: "you", text: "a b", since: 0 }, 0)).toBeNull();
    expect(nextWordIn(null, 0)).toBeNull();
  });
});

describe("captionLines", () => {
  it("wraps at the line width", () => {
    expect(captionLines("the quick brown fox jumps over", 10)).toEqual(["the quick", "brown fox", "jumps over"]);
  });

  it("keeps the last three lines: older ones scroll away", () => {
    const lines = captionLines("aa bb cc dd ee ff gg hh", 5);
    expect(lines).toHaveLength(CAPTION_LINES);
    expect(lines).toEqual(["cc dd", "ee ff", "gg hh"]);
  });

  it("a word longer than a line is cut on a line of its own", () => {
    expect(captionLines("a supercalifragilistic b", 8)).toEqual(["a", "superca…", "b"]);
  });

  it("empty text, no lines", () => {
    expect(captionLines("   ")).toEqual([]);
  });
});
