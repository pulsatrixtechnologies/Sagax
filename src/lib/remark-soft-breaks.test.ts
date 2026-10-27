import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatMarkdown } from "@/components/ChatMarkdown";
import { remarkSoftBreaks } from "./remark-soft-breaks";

const render = (text: string) => renderToStaticMarkup(createElement(ChatMarkdown, { text }));

describe("remarkSoftBreaks", () => {
  it("turns a single newline into a line break", () => {
    const html = render("**A.** one\n**B.** two\n**C.** three");
    expect(html.match(/<br\s*\/?>/g)?.length).toBe(2);
    expect(html).toContain("<strong>A.</strong> one");
  });

  it("keeps paragraphs, lists and blockquotes", () => {
    expect(render("one\n\ntwo").match(/<p/g)?.length).toBe(2);
    const list = render("- a\n- b");
    expect(list.match(/<li/g)?.length).toBe(2);
    expect(list).not.toContain("<br");
    expect(render("> a\n> b")).toContain("<br");
  });

  it("leaves code blocks and inline code untouched", () => {
    const html = render("```\nline1\nline2\n```");
    expect(html).toContain("line1");
    expect(html).not.toContain("<br");
    const tree = { type: "root", children: [{ type: "inlineCode", value: "a\nb" }, { type: "code", value: "x\ny" }] };
    remarkSoftBreaks()(tree);
    expect(tree.children.map((c) => c.type)).toEqual(["inlineCode", "code"]);
  });

  it("leaves tables alone", () => {
    const html = render("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table");
    expect(html).not.toContain("<br");
  });

  it("drops spaces around the break", () => {
    const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "a  \n  b" }] }] };
    remarkSoftBreaks()(tree);
    expect(JSON.stringify(tree)).toBe(JSON.stringify({ type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "a" }, { type: "break" }, { type: "text", value: "b" }] }] }));
  });
});
