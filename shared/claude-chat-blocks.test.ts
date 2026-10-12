import { describe, expect, it } from "vitest";

import {
  antArtifactToMarkdown,
  formatArtifactFence,
  isArtifactTool,
  isSafeHttpUrl,
  liftClaudeChatBlocks,
  parseArtifactPage,
  parseArtifactPublish,
} from "./claude-chat-blocks.ts";

describe("isArtifactTool", () => {
  it("matches the Agent SDK tool name exactly", () => {
    expect(isArtifactTool("Artifact")).toBe(true);
    expect(isArtifactTool(" Artifact ")).toBe(true);
    expect(isArtifactTool("Write")).toBe(false);
    expect(isArtifactTool("artifact")).toBe(false);
  });
});

describe("isSafeHttpUrl", () => {
  it("keeps https URLs and loopback http, and drops the rest", () => {
    expect(isSafeHttpUrl("https://claude.ai/code/artifact/abc")).toBe(true);
    expect(isSafeHttpUrl("http://localhost:7788/page")).toBe(true);
    expect(isSafeHttpUrl("http://example.com/x")).toBe(false);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("https://user:pass@evil.test/")).toBe(false);
    expect(isSafeHttpUrl("not a url")).toBe(false);
    expect(isSafeHttpUrl("file:///tmp/x.html")).toBe(false);
  });
});

describe("parseArtifactPublish", () => {
  it("reads a publish result with a real URL", () => {
    expect(parseArtifactPublish(JSON.stringify({
      url: "https://claude.ai/code/artifact/abc",
      path: "/tmp/page.html",
      title: "Report",
      icon: "chart",
    }))).toEqual({
      title: "Report",
      url: "https://claude.ai/code/artifact/abc",
      icon: "chart",
      path: "/tmp/page.html",
    });
  });

  it("reads text blocks the CLI wraps around the JSON", () => {
    const page = parseArtifactPublish([{ type: "text", text: '{"url":"https://claude.ai/x","title":"A"}' }]);
    expect(page).toEqual({ title: "A", url: "https://claude.ai/x" });
  });

  it("drops list results, invented URLs and non-JSON", () => {
    expect(parseArtifactPublish(JSON.stringify({ artifacts: [{ title: "A", url: "https://claude.ai/x" }] }))).toBeNull();
    expect(parseArtifactPublish(JSON.stringify({ url: "javascript:alert(1)", title: "X" }))).toBeNull();
    expect(parseArtifactPublish("published")).toBeNull();
    expect(parseArtifactPublish(JSON.stringify({ title: "No url" }))).toBeNull();
  });
});

describe("parseArtifactPage", () => {
  it("reads a title and a real URL from an artifact fence", () => {
    expect(parseArtifactPage('{"title":"Deck","url":"https://claude.ai/code/artifact/1"}')).toEqual({
      title: "Deck",
      url: "https://claude.ai/code/artifact/1",
    });
  });

  it("accepts a title-only card and refuses HTML, charts and fake URLs", () => {
    expect(parseArtifactPage('{"title":"Local preview"}')).toEqual({ title: "Local preview" });
    expect(parseArtifactPage("<!DOCTYPE html><p>Hi</p>")).toBeNull();
    expect(parseArtifactPage('{"type":"bar","title":"Tickets","labels":["Mon"],"series":[{"name":"A","data":[1]}]}')).toBeNull();
    expect(parseArtifactPage('{"title":"X","url":"javascript:alert(1)"}')).toEqual({ title: "X" });
  });
});

describe("formatArtifactFence", () => {
  it("writes a JSON artifact fence and an optional widget sibling, never the host path", () => {
    expect(formatArtifactFence({
      title: "Report",
      url: "https://claude.ai/code/artifact/abc",
      path: "/secret/page.html",
      html: "<p>Hi</p>",
    })).toBe("```artifact\n{\"title\":\"Report\",\"url\":\"https://claude.ai/code/artifact/abc\"}\n```\n\n```widget\n<p>Hi</p>\n```");
  });
});

describe("antArtifactToMarkdown", () => {
  it("routes HTML and SVG to a widget, mermaid to mermaid, markdown through, React to a code fence", () => {
    expect(antArtifactToMarkdown('type="application/vnd.sagax.cw+json"', '{"family":"ticket"}')).toBe("```cw\n{\"family\":\"ticket\"}\n```");
    expect(antArtifactToMarkdown('type="text/html" title="Hi"', "<p>x</p>")).toBe("```widget\n<p>x</p>\n```");
    expect(antArtifactToMarkdown('type="image/svg+xml"', "<svg></svg>")).toBe("```widget\n<svg></svg>\n```");
    expect(antArtifactToMarkdown('type="application/vnd.ant.mermaid"', "graph TD; A-->B")).toBe("```mermaid\ngraph TD; A-->B\n```");
    expect(antArtifactToMarkdown('type="text/markdown"', "# Hello")).toBe("# Hello");
    expect(antArtifactToMarkdown('type="application/vnd.ant.react" language="jsx"', "export default function A(){return <p/>}")).toBe("```jsx\nexport default function A(){return <p/>}\n```");
    expect(antArtifactToMarkdown('type="application/vnd.ant.chart"', '{"type":"bar","labels":["A"],"series":[{"name":"N","data":[1]}]}')).toMatch(/^```chart\n/);
  });
});

describe("liftClaudeChatBlocks", () => {
  it("rewrites a complete tag and hides an unclosed one", () => {
    expect(liftClaudeChatBlocks('See:\n<antArtifact type="text/html" title="Box"><p>Hi</p></antArtifact>\nDone')).toContain("```widget\n<p>Hi</p>\n```");
    expect(liftClaudeChatBlocks('See:\n<antArtifact type="text/html"><p>partial')).toBe("See:\n");
  });

  it("leaves the tag inside a fenced code block", () => {
    const text = "```html\n<antArtifact type=\"text/html\"><p>x</p></antArtifact>\n```";
    expect(liftClaudeChatBlocks(text)).toBe(text);
  });
});
