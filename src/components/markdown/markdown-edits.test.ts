import { describe, expect, it } from "vitest";

import {
  autoPair,
  continueList,
  countCharacters,
  countWords,
  cycleHeading,
  deletePair,
  formatMarkdown,
  indentList,
  insertLink,
  insertTable,
  linkFromPaste,
  minimalChange,
  tableFromTsv,
  toggleCode,
  toggleLinePrefix,
  toggleTask,
  toggleWrap,
  type TextSelection,
} from "./markdown-edits";

/** "|" marks the caret, "[" and "]" a selection, in these fixtures. */
function at(marked: string): TextSelection {
  const caret = marked.indexOf("|");
  if (caret >= 0) return { doc: marked.replace("|", ""), from: caret, to: caret };
  const from = marked.indexOf("[");
  const to = marked.indexOf("]") - 1;
  return { doc: marked.replace("[", "").replace("]", ""), from, to };
}

function show(state: TextSelection | null): string | null {
  if (!state) return null;
  if (state.from === state.to) return state.doc.slice(0, state.from) + "|" + state.doc.slice(state.from);
  return state.doc.slice(0, state.from) + "[" + state.doc.slice(state.from, state.to) + "]" + state.doc.slice(state.to);
}

describe("formatMarkdown", () => {
  it("puts one blank line around headings and code blocks", () => {
    expect(formatMarkdown("Intro\n# Title\nText\n```js\nconst a = 1;\n```\nAfter")).toBe(
      "Intro\n\n# Title\n\nText\n\n```js\nconst a = 1;\n```\n\nAfter",
    );
  });

  it("makes every bullet a dash and tidies heading spacing", () => {
    expect(formatMarkdown("##   Rules  \n\n* one\n+ two\n- three")).toBe("## Rules\n\n- one\n- two\n- three");
  });

  it("adds a blank line before a list that follows a paragraph, never inside the list", () => {
    expect(formatMarkdown("Steps:\n- one\n  more of one\n- two\n  - nested")).toBe("Steps:\n\n- one\n  more of one\n- two\n  - nested");
  });

  it("leaves an ordered list that cannot interrupt a paragraph alone", () => {
    // "2." after a paragraph line is still that paragraph in CommonMark
    expect(formatMarkdown("Year\n2. not a list")).toBe("Year\n2. not a list");
    expect(formatMarkdown("Do this:\n1. first\n2. second")).toBe("Do this:\n\n1. first\n2. second");
  });

  it("removes trailing spaces but keeps a two-space line break", () => {
    expect(formatMarkdown("line one  \nline two   \nend\t")).toBe("line one  \nline two  \nend");
    expect(formatMarkdown("para \nnext  \n\nlast  ")).toBe("para\nnext\n\nlast");
  });

  it("collapses blank runs and trims blank lines at both ends, keeping the final newline", () => {
    expect(formatMarkdown("\n\nA\n\n\n\nB\n\n\n")).toBe("A\n\nB\n");
    expect(formatMarkdown("A\n\n\nB")).toBe("A\n\nB");
  });

  it("never touches code blocks or front matter", () => {
    const code = "```\n*  keep   \n\n\n# not a heading\n```";
    expect(formatMarkdown(code)).toBe(code);
    const front = "---\nname: x  \n---\n# T";
    expect(formatMarkdown(front)).toBe("---\nname: x  \n---\n\n# T");
  });

  it("keeps a thematic break made of stars", () => {
    expect(formatMarkdown("A\n\n* * *\n\nB")).toBe("A\n\n* * *\n\nB");
  });

  it("is idempotent", () => {
    const once = formatMarkdown("# A\ntext\n* x\n* y\n```\ncode\n```\nend  ");
    expect(formatMarkdown(once)).toBe(once);
  });
});

describe("continueList", () => {
  it("continues bullets, numbers, tasks and quotes", () => {
    expect(show(continueList(at("- milk|")))).toBe("- milk\n- |");
    expect(show(continueList(at("1. first|")))).toBe("1. first\n2. |");
    expect(show(continueList(at("9) nine|")))).toBe("9) nine\n10) |");
    expect(show(continueList(at("- [x] done|")))).toBe("- [x] done\n- [ ] |");
    expect(show(continueList(at("> quoted|")))).toBe("> quoted\n> |");
  });

  it("keeps the indentation of a nested item", () => {
    expect(show(continueList(at("- a\n  - b|")))).toBe("- a\n  - b\n  - |");
  });

  it("splits an item when Enter lands mid-line", () => {
    expect(show(continueList(at("- milk| and eggs")))).toBe("- milk\n- |and eggs");
  });

  it("ends the list on an empty item, or moves a nested empty item out", () => {
    expect(show(continueList(at("- a\n- |")))).toBe("- a\n|");
    expect(show(continueList(at("- a\n  - |")))).toBe("- a\n- |");
  });

  it("does nothing outside a list, inside the marker or inside a code block", () => {
    expect(continueList(at("plain|"))).toBeNull();
    expect(continueList(at("-| a"))).toBeNull();
    expect(continueList(at("```\n- in code|"))).toBeNull();
  });
});

describe("indentList", () => {
  it("nests under the item above and moves back out", () => {
    expect(show(indentList(at("- a\n- b|"), 1))).toBe("- a\n  - b|");
    expect(show(indentList(at("1. a\n- b|"), 1))).toBe("1. a\n   - b|");
    expect(show(indentList(at("- a\n  - b|"), -1))).toBe("- a\n- b|");
  });

  it("leaves Tab alone outside a list so focus can move on", () => {
    expect(indentList(at("text|"), 1)).toBeNull();
  });
});

describe("paste", () => {
  it("turns a URL pasted over a selection into a link", () => {
    expect(linkFromPaste("the docs", "https://example.com/a")).toBe("[the docs](https://example.com/a)");
    expect(linkFromPaste("the docs", " https://example.com/a \n")).toBe("[the docs](https://example.com/a)");
  });

  it("pastes plainly when there is no selection, the paste is not a URL or the selection is one", () => {
    expect(linkFromPaste("", "https://example.com")).toBeNull();
    expect(linkFromPaste("docs", "not a url")).toBeNull();
    expect(linkFromPaste("https://a.example", "https://b.example")).toBeNull();
    expect(linkFromPaste("two\nlines", "https://example.com")).toBeNull();
  });

  it("turns tab-separated rows into a table with the first row as header", () => {
    expect(tableFromTsv("Name\tRole\nAda\tLead\nBob\t\n")).toBe(
      "| Name | Role |\n| --- | --- |\n| Ada | Lead |\n| Bob |  |",
    );
  });

  it("pads short rows and escapes pipes", () => {
    expect(tableFromTsv("a\tb\tc\nx|y\t1")).toBe("| a | b | c |\n| --- | --- | --- |\n| x\\|y | 1 |  |");
  });

  it("ignores text that is not a table", () => {
    expect(tableFromTsv("one line\twith tab")).toBeNull();
    expect(tableFromTsv("a\tb\nno tab here")).toBeNull();
    expect(tableFromTsv("plain\ntext")).toBeNull();
  });
});

describe("toolbar edits", () => {
  it("wraps and unwraps bold, keeping spaces outside", () => {
    expect(show(toggleWrap(at("say [hello ]now"), "**", "bold"))).toBe("say **[hello]** now");
    expect(show(toggleWrap(at("say **[hello]** now"), "**", "bold"))).toBe("say [hello] now");
    expect(show(toggleWrap(at("x|"), "**", "bold"))).toBe("x**[bold]**");
  });

  it("makes a multi-line selection a code block", () => {
    expect(show(toggleCode(at("[a\nb]"), "code"))).toBe("```\n[a\nb]\n```");
  });

  it("toggles list markers on every selected line and numbers them", () => {
    expect(toggleLinePrefix(at("[one\ntwo]"), "numbered").doc).toBe("1. one\n2. two");
    expect(toggleLinePrefix(at("[- one\n- two]"), "bullet").doc).toBe("one\ntwo");
    expect(toggleLinePrefix(at("[- one\n- two]"), "task").doc).toBe("- [ ] one\n- [ ] two");
    expect(show(toggleLinePrefix(at("item|"), "bullet"))).toBe("- item|");
  });

  it("cycles headings", () => {
    expect(cycleHeading(at("Title|")).doc).toBe("# Title");
    expect(cycleHeading(at("## Title|")).doc).toBe("### Title");
    expect(cycleHeading(at("### Title|")).doc).toBe("Title");
  });

  it("inserts a link around the selection and selects the address", () => {
    expect(show(insertLink(at("see [docs]"), "link text"))).toBe("see [docs]([https://])");
    expect(show(insertLink(at("[https://x.example]"), "link text"))).toBe("[[link text]](https://x.example)");
  });

  it("inserts a table on its own lines", () => {
    expect(insertTable(at("Intro|"), { column: (n) => `Column ${n}` }).doc).toBe(
      "Intro\n\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n",
    );
  });

  it("toggles a task box", () => {
    expect(toggleTask("- [ ] milk", 3)).toBe("- [x] milk");
    expect(toggleTask("- [x] milk", 3)).toBe("- [ ] milk");
    expect(toggleTask("milk", 1)).toBeNull();
  });
});

describe("auto-pairs", () => {
  it("pairs brackets and backticks, wraps a selection, steps over the closer", () => {
    expect(show(autoPair(at("a |"), "("))).toBe("a (|)");
    expect(show(autoPair(at("a [b]"), "["))).toBe("a [[b]]");
    expect(show(autoPair(at("(a|)"), ")"))).toBe("(a)|");
    expect(show(autoPair(at("say |"), "`"))).toBe("say `|`");
  });

  it("does not pair a bullet star or an underscore inside a word", () => {
    expect(autoPair(at("|"), "*")).toBeNull();
    expect(autoPair(at("snake|"), "_")).toBeNull();
    expect(show(autoPair(at("very |"), "*"))).toBe("very *|*");
  });

  it("deletes an empty pair at once", () => {
    expect(show(deletePair(at("(|)")))).toBe("|");
    expect(deletePair(at("(a|)"))).toBeNull();
  });
});

describe("counts and changes", () => {
  it("counts words with letters or digits, not bare markup", () => {
    expect(countWords("# Title\n\n- one two\n- **three**")).toBe(4);
    expect(countWords("")).toBe(0);
    expect(countCharacters("ab😀")).toBe(3);
  });

  it("finds the smallest replacement", () => {
    expect(minimalChange("hello world", "hello brave world")).toEqual({ from: 6, to: 6, insert: "brave " });
    expect(minimalChange("abc", "abc")).toEqual({ from: 3, to: 3, insert: "" });
  });
});
