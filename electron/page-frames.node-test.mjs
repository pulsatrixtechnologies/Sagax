// A published page's frame is guarded and noted for every window of the app
// from one hook (electron/page-frames.mjs): a window module never has to
// remember it, and a window that did not exist when this was written is
// covered the same way.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { installPageFrameWatch, watchPageFrames } from "./page-frames.mjs";

const ORG = "https://org.example.test";

function contents() {
  const emitter = new EventEmitter();
  return emitter;
}

function navigation(url, { isMainFrame = false } = {}) {
  let prevented = false;
  return { url, isMainFrame, preventDefault: () => { prevented = true; }, get prevented() { return prevented; } };
}

test("a subframe's page frame load is noted; a refused one is prevented and not noted; the main frame is nobody's business", () => {
  const noted = [];
  const page = contents();
  watchPageFrames(page, { block: (details) => details.url.includes("/elsewhere"), expect: (url) => noted.push(url) });

  const frame = navigation(`${ORG}/pages/preview-frame/abcdefgh12/1?t=ticket`);
  page.emit("will-frame-navigate", frame);
  assert.equal(frame.prevented, false);
  assert.deepEqual(noted, [`${ORG}/pages/preview-frame/abcdefgh12/1?t=ticket`]);

  const escape = navigation(`${ORG}/elsewhere`);
  page.emit("will-frame-navigate", escape);
  assert.equal(escape.prevented, true);
  assert.equal(noted.length, 1, "a refused navigation is never noted");

  const top = navigation(`${ORG}/pages/frame/tok.sig`, { isMainFrame: true });
  page.emit("will-frame-navigate", top);
  assert.equal(top.prevented, false);
  assert.equal(noted.length, 1, "a top-level load is not a frame");
});

test("a guard that throws fails closed, and a note that throws does not break the navigation", () => {
  const lines = [];
  const page = contents();
  watchPageFrames(page, {
    block: () => { throw new Error("frame gone"); },
    expect: () => { throw new Error("no store"); },
    log: (line) => lines.push(line),
  });
  const frame = navigation(`${ORG}/pages/frame/tok.sig`);
  page.emit("will-frame-navigate", frame);
  assert.equal(frame.prevented, true);
  assert.match(lines[0], /frame gone/);

  const safe = contents();
  watchPageFrames(safe, { block: () => false, expect: () => { throw new Error("no store"); }, log: (line) => lines.push(line) });
  const other = navigation(`${ORG}/pages/frame/tok.sig`);
  safe.emit("will-frame-navigate", other);
  assert.equal(other.prevented, false);
  assert.match(lines.at(-1), /no store/);
});

test("installed on the app once, every WebContents created afterwards is watched: present windows and future ones alike", () => {
  const app = new EventEmitter();
  const noted = [];
  const stop = installPageFrameWatch(app, { block: () => false, expect: (url) => noted.push(url) });

  // the main window, an artifact window, a window nobody has written yet
  const windows = [contents(), contents(), contents()];
  for (const page of windows) app.emit("web-contents-created", {}, page);
  windows.forEach((page, index) => page.emit("will-frame-navigate", navigation(`${ORG}/pages/frame/${index}`)));
  assert.deepEqual(noted, [`${ORG}/pages/frame/0`, `${ORG}/pages/frame/1`, `${ORG}/pages/frame/2`]);

  // something that is not a WebContents is ignored
  app.emit("web-contents-created", {}, null);
  app.emit("web-contents-created", {}, {});

  // after stop, a new WebContents is not watched; the earlier ones still are
  stop();
  const late = contents();
  app.emit("web-contents-created", {}, late);
  late.emit("will-frame-navigate", navigation(`${ORG}/pages/frame/late`));
  windows[0].emit("will-frame-navigate", navigation(`${ORG}/pages/frame/again`));
  assert.deepEqual(noted.slice(3), [`${ORG}/pages/frame/again`]);
});
