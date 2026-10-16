// The app's second lock on a published page's frame (page-frame-guard.mjs).
import assert from "node:assert/strict";
import test from "node:test";

import { blockPageFrameNavigation, pageFrameNavigationAllowed } from "./page-frame-guard.mjs";

const APP = "http://127.0.0.1:4321";
const FRAME = `${APP}/pages/preview-frame/abcdefgh12345678/1?t=1.x`;
const WRAPPER = `${APP}/pages/preview/abcdefgh12345678/1`;

test("a page frame may reload its own address only", () => {
  assert.equal(pageFrameNavigationAllowed({ currentUrl: FRAME, parentUrl: WRAPPER, targetUrl: `${APP}/pages/preview-frame/abcdefgh12345678/1?t=2.y` }), true);
  assert.equal(pageFrameNavigationAllowed({ currentUrl: FRAME, parentUrl: WRAPPER, targetUrl: "https://evil.example/?pw=hunter2" }), false);
  assert.equal(pageFrameNavigationAllowed({ currentUrl: FRAME, parentUrl: WRAPPER, targetUrl: `${APP}/api/config` }), false);
  assert.equal(pageFrameNavigationAllowed({ currentUrl: FRAME, parentUrl: WRAPPER, targetUrl: `${APP}/pages/preview-frame/otherpage1234567/1` }), false);
  assert.equal(pageFrameNavigationAllowed({ currentUrl: `${APP}/pages/frame/x.y?t=1`, parentUrl: "", targetUrl: "data:text/html,hi" }), false);
});

test("a frame in a wrapper may load a page frame path only", () => {
  assert.equal(pageFrameNavigationAllowed({ currentUrl: "about:blank", parentUrl: WRAPPER, targetUrl: FRAME }), true);
  assert.equal(pageFrameNavigationAllowed({ currentUrl: "", parentUrl: WRAPPER, targetUrl: "https://evil.example/" }), false);
  assert.equal(pageFrameNavigationAllowed({ currentUrl: "", parentUrl: `${APP}/pages/view/a.b`, targetUrl: "javascript:alert(1)" }), false);
});

test("other frames are not its business", () => {
  assert.equal(pageFrameNavigationAllowed({ currentUrl: `${APP}/`, parentUrl: `${APP}/`, targetUrl: "https://www.youtube.com/embed/x" }), null);
});

test("will-frame-navigate details: blocks only a page frame leaving", () => {
  assert.equal(blockPageFrameNavigation({ isMainFrame: true, url: "https://evil.example/" }), false);
  assert.equal(blockPageFrameNavigation({ isMainFrame: false, url: "https://evil.example/", frame: { url: FRAME, parent: { url: WRAPPER } } }), true);
  assert.equal(blockPageFrameNavigation({ isMainFrame: false, url: FRAME, frame: { url: "about:blank", parent: { url: WRAPPER } } }), false);
  assert.equal(blockPageFrameNavigation({ isMainFrame: false, url: "https://www.youtube.com/embed/x", frame: { url: "", parent: { url: `${APP}/` } } }), false);
  // fail closed: a subframe navigation with no frame to check is refused
  assert.equal(blockPageFrameNavigation({ isMainFrame: false, url: "https://evil.example/", frame: null }), true);
  assert.equal(blockPageFrameNavigation({ isMainFrame: false, url: "https://evil.example/" }), true);
});
