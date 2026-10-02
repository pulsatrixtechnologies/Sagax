// The block list every Sagax process applies (electron/upstream-hosts.mjs).
import assert from "node:assert/strict";
import test from "node:test";

import { blockedRequestPatterns, guardFetch, installSessionBlock, isBlockedHost, isBlockedUrl } from "./upstream-hosts.mjs";

test("the original project's services, analytics and upstream repositories are blocked", () => {
  for (const url of [
    "https://cloud.openmausbot.com/api/cloud/desktop/state",
    "https://accounts.openmausbot.com/v1/installations",
    "https://admin.openmausbot.com/",
    "https://c-1234.openmausbot.com/api/pair",
    "https://www.openmausbot.com/pro",
    "https://OPENMAUSBOT.COM./",
    "https://us.i.posthog.com/e/",
    "https://raw.githubusercontent.com/milind-soni/openmausbot-teams/main/catalog.json",
    "https://github.com/milind-soni/OpenMausBot/releases/latest",
    "https://api.github.com/repos/milind-soni/OpenMausBot/releases",
  ]) assert.equal(isBlockedUrl(url), true, url);
});

test("our own releases, providers and look-alike hosts pass", () => {
  for (const url of [
    "https://github.com/pulsatrixtechnologies/sagax/releases/latest",
    "https://raw.githubusercontent.com/pulsatrixtechnologies/teams/main/catalog.json",
    "https://api.openai.com/v1/responses",
    "https://openmausbot.com.example.test/",
    "https://notopenmausbot.com/",
    "not a url",
  ]) assert.equal(isBlockedUrl(url), false, url);
  assert.equal(isBlockedHost("eu.posthog.com"), true);
  assert.equal(isBlockedHost("posthog.example.com"), false);
});

test("a guarded fetch refuses before calling the network", async () => {
  const calls = [];
  const fetcher = guardFetch(async (input) => { calls.push(String(input)); return new Response("ok"); });
  await assert.rejects(fetcher("https://accounts.openmausbot.com/healthz"), { code: "ERR_SAGAX_BLOCKED_HOST" });
  await assert.rejects(fetcher(new URL("https://us.i.posthog.com/decide")), { code: "ERR_SAGAX_BLOCKED_HOST" });
  await assert.rejects(fetcher({ url: "https://cloud.openmausbot.com/" }), { code: "ERR_SAGAX_BLOCKED_HOST" });
  assert.equal(await (await fetcher("https://example.com/")).text(), "ok");
  assert.deepEqual(calls, ["https://example.com/"]);
  assert.equal(guardFetch(fetcher), fetcher, "idempotent");
});

test("an Electron session cancels blocked requests", () => {
  let filter, listener;
  const session = { webRequest: { onBeforeRequest: (f, l) => { filter = f; listener = l; } } };
  installSessionBlock(session);
  assert.deepEqual(filter.urls, blockedRequestPatterns());
  assert.ok(filter.urls.includes("*://*.openmausbot.com/*"));
  const answer = (url) => { let result; listener({ url }, (value) => { result = value; }); return result; };
  assert.deepEqual(answer("https://cloud.openmausbot.com/x"), { cancel: true });
  assert.deepEqual(answer("https://github.com/milind-soni/x"), { cancel: true });
  assert.deepEqual(answer("https://github.com/pulsatrixtechnologies/sagax"), { cancel: false });
});
