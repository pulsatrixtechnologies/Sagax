import assert from "node:assert/strict";
import { test } from "node:test";
import { pasteMenuItem } from "./paste-menu-item.mjs";

const params = { isEditable: true, editFlags: { canPaste: false } };
const clipboard = (types = []) => ({ has: async (type) => types.includes(type) });

test("image and file clipboards get an explicit enabled paste action", async () => {
  for (const contents of [clipboard(["image/png"]), clipboard(["text/uri-list"])]) {
    let pastes = 0;
    const item = await pasteMenuItem(params, contents, { paste: () => pastes++ });
    assert.equal(item.enabled, true);
    assert.equal(item.role, undefined);
    item.click();
    assert.equal(pastes, 1);
  }
});

test("text paste keeps its native role without inspecting the clipboard", async () => {
  const item = await pasteMenuItem({ ...params, editFlags: { canPaste: true } }, null, null);
  assert.deepEqual(item, { label: "Paste", enabled: true, role: "paste" });
});

test("read-only targets, empty clipboards, and clipboard failures stay disabled", async () => {
  assert.equal((await pasteMenuItem({ ...params, isEditable: false }, null, null)).enabled, false);
  assert.equal((await pasteMenuItem(params, clipboard(["text/plain"]), null)).enabled, false);
  assert.equal((await pasteMenuItem(params, { has: async () => { throw Error("unavailable"); } }, null)).enabled, false);
});
