// @vitest-environment happy-dom
// The best-effort prelude of every HTML page (FRAME_PRELUDE in
// server/published-pages-render.ts): WebRTC constructors gone for good, and
// resource hints removed, including ones added later.
import { expect, it } from "vitest";

import { FRAME_PRELUDE } from "./published-pages-render.ts";

// The server's TypeScript has no DOM library: the happy-dom globals are read loosely.
/* eslint-disable @typescript-eslint/no-explicit-any */
const document = (globalThis as any).document;
const window = globalThis as any;

const body = FRAME_PRELUDE.replace(/^<script>/, "").replace(/<\/script>$/, "");

it("removes WebRTC for good and strips dns-prefetch, preconnect and prefetch hints", async () => {
  const win = window as Record<string, unknown>;
  win.RTCPeerConnection = class {};
  win.webkitRTCPeerConnection = class {};
  document.head.innerHTML = '<link rel="dns-prefetch" href="//evil.example"><link rel="stylesheet" href="data:text/css,">';
  new Function(body)();
  expect(win.RTCPeerConnection).toBeUndefined();
  expect(win.webkitRTCPeerConnection).toBeUndefined();
  expect(() => { "use strict"; win.RTCPeerConnection = class {}; }).toThrow();
  expect(win.RTCPeerConnection).toBeUndefined();
  expect(document.querySelectorAll('link[rel="dns-prefetch"]')).toHaveLength(0);
  expect(document.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1);
  // added later, directly or inside another element, or by changing rel
  const late = document.createElement("link");
  late.rel = "preconnect";
  late.href = "https://evil.example";
  document.head.appendChild(late);
  const wrap = document.createElement("div");
  wrap.innerHTML = '<link rel="prefetch" href="https://evil.example/x">';
  document.body.appendChild(wrap);
  const changed = document.createElement("link");
  changed.rel = "icon";
  document.head.appendChild(changed);
  await new Promise((resolve) => setTimeout(resolve, 0));
  changed.setAttribute("rel", "PRERENDER");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelectorAll("link[rel]").length).toBe(1);
});
