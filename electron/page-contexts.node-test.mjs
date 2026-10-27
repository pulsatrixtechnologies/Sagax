// One page per account in the main window (page-contexts.mjs): a switch
// shows the page already open, never loads it again, keeps each account on
// its own page, and closes only the page of the account that goes.
import assert from "node:assert/strict";
import test from "node:test";

import { createPageContexts } from "./page-contexts.mjs";

const PERSONAL = "http://127.0.0.1:8799";
const ORG = "https://org.example.test";
const OTHER = "https://other.example.test";

function contents(name, loads) {
  let destroyed = false;
  let url = "";
  return {
    name,
    focused: 0,
    isDestroyed: () => destroyed,
    loadURL: async (target) => { url = target; loads.push([name, target]); },
    getURL: () => url,
    focus() { this.focused++; },
    close: () => { destroyed = true; },
  };
}

function fixture({ maxPages } = {}) {
  const loads = [];
  const children = [];
  let made = 0;
  const own = contents("window", loads);
  const win = {
    webContents: own,
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    getContentSize: () => [1200, 800],
    contentView: {
      addChildView: (view) => { const at = children.indexOf(view); if (at >= 0) children.splice(at, 1); children.push(view); },
      removeChildView: (view) => { const at = children.indexOf(view); if (at >= 0) children.splice(at, 1); },
    },
  };
  const created = [];
  const dropped = [];
  const pages = createPageContexts({
    window: () => win,
    createView: () => {
      const view = { webContents: contents(`view${++made}`, loads), visible: true, bounds: null,
        setVisible(on) { this.visible = on; }, setBounds(box) { this.bounds = box; } };
      return view;
    },
    onCreated: (page, origin) => created.push([page.name, origin]),
    onDropped: (page, origin) => dropped.push([page.name, origin]),
    ...(maxPages ? { maxPages } : {}),
  });
  const visible = () => children.filter((view) => view.visible).map((view) => view.webContents.name);
  return { pages, win, own, loads, children, created, dropped, visible };
}

test("the first account opens in the window's own page, the next in a view laid over it", () => {
  const f = fixture();
  const first = f.pages.show(PERSONAL);
  assert.equal(first.contents, f.own);
  assert.equal(first.reused, false);
  const second = f.pages.show(ORG, `${ORG}/pair`);
  assert.equal(second.reused, false);
  assert.notEqual(second.contents, f.own);
  assert.deepEqual(f.loads, [["window", PERSONAL], ["view1", `${ORG}/pair`]]);
  assert.deepEqual(f.created, [["view1", ORG]], "each new page gets the window's rules");
  assert.deepEqual(f.children[0].bounds, { x: 0, y: 0, width: 1200, height: 800 }, "the view covers the window's content");
  assert.deepEqual(f.visible(), ["view1"]);
  assert.equal(f.pages.activeContents(), second.contents);
  assert.equal(f.pages.originOf(second.contents), ORG);
  assert.equal(f.pages.originOf(f.own), PERSONAL);
});

test("a switch shows the page as it was: nothing loads again, nothing is signed out", () => {
  const f = fixture();
  f.pages.show(PERSONAL);
  const org = f.pages.show(ORG).contents;
  const loadsBefore = f.loads.length;
  for (let round = 0; round < 5; round++) {
    assert.deepEqual(f.pages.show(PERSONAL), { contents: f.own, reused: true });
    assert.deepEqual(f.visible(), [], "Personal's page shows: the organization's view is hidden, still open");
    assert.equal(f.pages.activeContents(), f.own);
    assert.deepEqual(f.pages.show(ORG), { contents: org, reused: true });
    assert.deepEqual(f.visible(), ["view1"]);
  }
  assert.equal(f.loads.length, loadsBefore, "no page was loaded again");
  assert.ok(f.own.focused > 0 && org.focused > 0, "the page shown takes the keyboard");
  assert.deepEqual(f.pages.openOrigins(), [PERSONAL, ORG]);
});

test("each account keeps its own page: two servers never share one", () => {
  const f = fixture();
  f.pages.show(PERSONAL);
  const org = f.pages.show(ORG).contents;
  const other = f.pages.show(OTHER).contents;
  assert.notEqual(org, other);
  assert.equal(f.pages.contentsFor(ORG), org);
  assert.equal(f.pages.contentsFor(OTHER), other);
  assert.equal(f.pages.contentsFor("https://unknown.example.test"), null);
  assert.equal(f.pages.isPage(org), true);
  assert.equal(f.pages.isPage({}), false);
  // the shown view is raised above every other child view (the two-desktop panes too)
  f.pages.show(ORG);
  assert.equal(f.children.at(-1).webContents, org);
});

test("signing out of one account closes its page only", () => {
  const f = fixture();
  f.pages.show(PERSONAL);
  const org = f.pages.show(ORG).contents;
  f.pages.show(OTHER);
  f.pages.drop(ORG);
  assert.equal(org.isDestroyed(), true);
  assert.deepEqual(f.dropped, [["view1", ORG]]);
  assert.equal(f.pages.contentsFor(ORG), null);
  assert.deepEqual(f.pages.openOrigins(), [PERSONAL, OTHER]);
  assert.equal(f.own.isDestroyed(), false, "Personal's page stays");
  // the next switch to that account opens a new page (its sign-in, now)
  const again = f.pages.show(ORG);
  assert.equal(again.reused, false);
  assert.notEqual(again.contents, org);
});

test("the window's own page, when its account goes, is emptied and belongs to the next account shown in it", async () => {
  const f = fixture();
  f.pages.show(ORG);
  f.pages.show(PERSONAL);
  f.pages.drop(ORG);
  assert.equal(f.pages.homeOrigin(), null);
  assert.equal(f.own.getURL(), "about:blank", "nothing of that account stays behind the other pages");
  assert.equal(f.pages.contentsFor(ORG), null);
  assert.equal(f.pages.activeContents(), f.pages.contentsFor(PERSONAL));
  assert.deepEqual(f.dropped, [["window", ORG]], "main forgets what it kept for that page");
});

test("an account that has its view keeps it when the window's own page is free: never two pages for one account", () => {
  const f = fixture();
  f.pages.show(ORG); // server mode: the server opens in the window's own page
  const personal = f.pages.show(PERSONAL).contents; // Personal, in a view
  f.pages.drop(ORG); // signed out of the server
  const again = f.pages.show(PERSONAL);
  assert.equal(again.contents, personal, "Personal's view, as it was");
  assert.equal(again.reused, true);
  assert.equal(f.pages.homeOrigin(), null, "the window's own page stays free");
  assert.equal(f.loads.filter(([name]) => name === "window").length, 2, "the window's page was only emptied, Personal never loaded into it");
  // the next account without a page takes the window's own page
  const other = f.pages.show(OTHER);
  assert.equal(other.contents, f.own);
  assert.equal(f.pages.homeOrigin(), OTHER);
});

test("past the limit the least recently shown page closes, never the one on screen nor the window's own", () => {
  const f = fixture({ maxPages: 3 });
  f.pages.show(PERSONAL);
  const org = f.pages.show(ORG).contents;
  const other = f.pages.show(OTHER).contents;
  f.pages.show(ORG);
  f.pages.show("https://third.example.test");
  assert.equal(other.isDestroyed(), true, "the least recently shown view closed");
  assert.equal(org.isDestroyed(), false);
  assert.equal(f.own.isDestroyed(), false);
  assert.deepEqual(f.pages.openOrigins(), [PERSONAL, ORG, "https://third.example.test"]);
});

test("a page prepared hidden is shown at once on the first switch", () => {
  const f = fixture();
  f.pages.show(PERSONAL);
  const prepared = f.pages.prepare(ORG);
  assert.ok(prepared);
  assert.deepEqual(f.visible(), [], "prepared hidden");
  assert.equal(f.pages.activeContents(), f.own, "Personal stays on screen");
  assert.equal(f.pages.prepare(ORG), null, "once");
  const shown = f.pages.show(ORG);
  assert.equal(shown.contents, prepared);
  assert.equal(shown.reused, true);
  assert.deepEqual(f.loads, [["window", PERSONAL], ["view1", ORG]], "loaded once, when prepared");
});

test("views follow the window's size, and go with the window", () => {
  const f = fixture();
  f.pages.show(PERSONAL);
  const org = f.pages.show(ORG).contents;
  f.win.getContentSize = () => [900, 600];
  f.pages.layout();
  assert.deepEqual(f.children[0].bounds, { x: 0, y: 0, width: 900, height: 600 });
  f.pages.reset();
  assert.equal(org.isDestroyed(), true);
  assert.deepEqual(f.pages.openOrigins(), []);
});
