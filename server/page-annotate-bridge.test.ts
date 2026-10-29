// The frame's side of Annotate (ANNOTATE_BRIDGE_SOURCE in
// server/published-pages-render.ts), run in a document: dormant until its
// parent turns annotation mode on; a selection becomes an anchor with the
// page's own words; anchors are found again, the right occurrence by what
// comes before and after; only messages from the parent are heard.
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";

import { ANNOTATE_BRIDGE_SOURCE } from "./published-pages-render.ts";

let posted: unknown[] = [];
let win: Window;
let document: Window["document"];
const parent = { postMessage: (message: unknown) => { posted.push(message); } };

/** A fresh page in its own window, whose parent (the wrapper) records what
 * the frame posts. */
function load(html: string) {
  win = new Window({ url: "https://frame.example/" });
  Object.defineProperty(win, "parent", { value: parent });
  document = win.document;
  document.body.innerHTML = html;
  posted = [];
  new Function("window", "document", ANNOTATE_BRIDGE_SOURCE)(win, document);
}

function fromParent(data: unknown, source: unknown = parent) {
  win.dispatchEvent(new win.MessageEvent("message", { data, source: source as never }));
}

async function select(node: unknown, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node as never, start);
  range.setEnd(node as never, end);
  win.getSelection()!.removeAllRanges();
  win.getSelection()!.addRange(range);
  document.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 5));
}

afterEach(() => { void win?.happyDOM.close(); });

describe("the frame's side of Annotate", () => {
  it("says nothing about a selection until its parent turns annotation mode on", async () => {
    load("<p>Premier paragraphe du rapport.</p>");
    await select(document.querySelector("p")!.firstChild, 0, 7);
    expect(posted).toEqual([]);
    // a page's own script posting as if it were the parent is not heard
    fromParent({ type: "sagax-annotate-mode", v: 1, on: true }, win);
    await select(document.querySelector("p")!.firstChild, 0, 7);
    expect(posted).toEqual([]);
  });

  it("a selection becomes an anchor: the words, a little before and after, a path", async () => {
    load("<h1>Titre</h1><p>Le volume a augmenté de 12 % ce mois.</p>");
    fromParent({ type: "sagax-annotate-mode", v: 1, on: true });
    await select(document.querySelector("p")!.firstChild, 3, 9);
    expect(posted).toEqual([{ type: "sagax-annotate-select", v: 1, anchor: { kind: "text", quote: "volume", prefix: "TitreLe ", suffix: " a augmenté de 12 % ce mois.", path: "body > p", tag: "p" } }]);
  });

  it("finds each anchor again, the right occurrence by its context, and tells the order in the page", () => {
    load("<p>Total : 12 postes.</p><p>Réseau : 12 postes.</p>");
    fromParent({ type: "sagax-annotate-marks", v: 1, marks: [
      { id: "second", resolved: false, active: false, anchor: { kind: "text", quote: "12 postes", prefix: "Réseau : ", suffix: ".", path: "body", tag: "p" } },
      { id: "first", resolved: false, active: false, anchor: { kind: "text", quote: "12 postes", prefix: "Total : ", suffix: ".", path: "body", tag: "p" } },
      { id: "gone", resolved: false, active: false, anchor: { kind: "text", quote: "absent", prefix: "", suffix: "", path: "body", tag: "p" } },
    ] });
    const found = posted.find((message) => (message as { type?: string }).type === "sagax-annotate-found") as { ids: string[] };
    // happy-dom lays nothing out (every top is 0): page order falls back to the order found
    expect(found.ids.sort()).toEqual(["first", "second"]);
    expect(found.ids).not.toContain("gone");
  });

  it("a part of the page is anchored by a click, never followed", () => {
    load('<table><tbody><tr><td>Réseau</td><td><a href="https://example.com/x">31</a></td></tr></tbody></table>');
    fromParent({ type: "sagax-annotate-mode", v: 1, on: true });
    const link = document.querySelector("a")!;
    const click = new win.MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(posted).toEqual([{ type: "sagax-annotate-select", v: 1, anchor: { kind: "element", quote: "31", prefix: "", suffix: "", path: "body > table > tbody > tr > td:nth-of-type(2) > a", tag: "a" } }]);
  });

  it("uses no network", () => {
    for (const word of ["fetch", "XMLHttpRequest", "sendBeacon", "WebSocket", "location", "open("]) expect(ANNOTATE_BRIDGE_SOURCE).not.toContain(word);
  });
});
