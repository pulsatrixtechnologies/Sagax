import { describe, expect, it } from "vitest";

import { speakableSentence, spokenPart } from "./spoken";

describe("what a call reads aloud", () => {
  it("drops markdown and keeps the words", () => {
    expect(speakableSentence("## **Bold** and _soft_ and `code` and ~~gone~~")).toBe("Bold and soft and code and gone");
    expect(speakableSentence("- [x] a done item")).toBe("a done item");
    expect(speakableSentence("> quoted words")).toBe("quoted words");
    expect(speakableSentence("1. first step")).toBe("first step");
    expect(speakableSentence("| a | b |")).toBe("a, b");
    expect(speakableSentence("snake_case_name stays")).toBe("snake_case_name stays");
    expect(speakableSentence("2 * 3 = 6")).toBe("2 3 = 6");
  });

  it("never reads a URL, an emoji or HTML", () => {
    expect(speakableSentence("See [the docs](https://example.com/docs) now")).toBe("See the docs now");
    expect(speakableSentence("Open https://example.com/a?b=c or www.example.org/x.")).toBe("Open or.");
    expect(speakableSentence("Great job \u{1F44D}\u{1F3FD} ❤️ \u{1F1E8}\u{1F1E6} \u{1F468}‍\u{1F469}")).toBe("Great job");
    expect(speakableSentence("line<br>break <b>bold</b>")).toBe("line break bold");
  });

  it("says nothing for a sentence of only syntax", () => {
    expect(speakableSentence("```ts\nconst a = 1;\n```")).toBe("");
    expect(speakableSentence("---")).toBe("");
    expect(speakableSentence("\u{1F600}")).toBe("");
  });

  it("stops before the written follow-up", () => {
    expect(spokenPart("Bye for now.\n\n---\nDetails: a list")).toBe("Bye for now.\n\n");
    expect(spokenPart("Bye.\n***\nmore")).toBe("Bye.\n");
    expect(spokenPart("No rule -- here, a - b")).toBe("No rule -- here, a - b");
    expect(spokenPart("Typing --")).toBe("Typing --");
  });
});
