import { describe, expect, it } from "vitest";
import { splitLiveMarkdown } from "./live-markdown-blocks";

describe("splitLiveMarkdown", () => {
  it("cuts paragraphs at blank lines, the growing one last", () => {
    expect(splitLiveMarkdown("First.\n\nSecond, still go")).toEqual(["First.", "Second, still go"]);
    expect(splitLiveMarkdown("")).toEqual([]);
    expect(splitLiveMarkdown("One line")).toEqual(["One line"]);
  });

  it("keeps a fenced block whole, open or closed, blank lines included", () => {
    const open = "Here:\n\n```ts\nconst a = 1;\n\nconst b";
    expect(splitLiveMarkdown(open)).toEqual(["Here:", "```ts\nconst a = 1;\n\nconst b"]);
    const closed = "```\nx\n\ny\n```\n\nAfter";
    expect(splitLiveMarkdown(closed)).toEqual(["```\nx\n\ny\n```", "After"]);
  });

  it("keeps a loose list, indented continuations and a table together", () => {
    expect(splitLiveMarkdown("1. one\n\n2. two\n\n   more")).toEqual(["1. one\n\n2. two\n\n   more"]);
    expect(splitLiveMarkdown("| a | b |\n|---|---|\n| 1 | 2")).toEqual(["| a | b |\n|---|---|\n| 1 | 2"]);
  });

  it("keeps a $$ block whole and does not open one for inline $$x$$", () => {
    expect(splitLiveMarkdown("$$\na\n\nb\n$$\n\nNext")).toEqual(["$$\na\n\nb\n$$", "Next"]);
    expect(splitLiveMarkdown("$$x$$\n\nNext")).toEqual(["$$x$$", "Next"]);
  });

  it("draws a reply with reference definitions or footnotes whole", () => {
    const text = "See [docs][1].\n\n[1]: https://example.com";
    expect(splitLiveMarkdown(text)).toEqual([text]);
  });

  it("never changes a finished block as the text grows", () => {
    const full = "# Title\n\nIntro text.\n\n- a\n- b\n\n```js\nlet x;\n```\n\n| h |\n|---|\n| v |\n\nEnd.";
    let previous: string[] = [];
    for (let end = 1; end <= full.length; end++) {
      const blocks = splitLiveMarkdown(full.slice(0, end));
      // every block but the last of the previous cut is still there, as it was
      expect(blocks.slice(0, previous.length - 1)).toEqual(previous.slice(0, -1));
      previous = blocks;
    }
    expect(previous.join("\n\n")).toBe(full);
  });
});
