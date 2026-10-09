import { describe, expect, it } from "vitest";

import { scanText } from "./check-no-phone-home.mjs";

// The server's own table, as esbuild writes it into dist-server/index.js.
const SERVER_TABLE = `var APNS_HOSTS = Object.freeze({
  production: "api.push.apple.com",
  sandbox: "api.sandbox.push.apple.com"
});`;

// The same table as tsc writes it into dist-server/server/push/config.js.
const SERVER_TABLE_TSC = `export const APNS_HOSTS = Object.freeze({
    production: "api.push.apple.com",
    sandbox: "api.sandbox.push.apple.com",
});`;

describe("check-no-phone-home: APNs", () => {
  it("allows the APNs host table in the server bundle", () => {
    expect(scanText(SERVER_TABLE, "dist-server/index.js")).toEqual([]);
    expect(scanText(SERVER_TABLE_TSC, "dist-server/server/push/config.js")).toEqual([]);
  });

  it("refuses the same table in the desktop renderer or the Electron shell", () => {
    expect(scanText(SERVER_TABLE, "dist/assets/index.js").map((f) => f.match)).toEqual(["api.push.apple.com", "api.sandbox.push.apple.com"]);
    expect(scanText(SERVER_TABLE, "electron/main.mjs")).toHaveLength(2);
  });

  it("refuses an APNs host anywhere else in the server bundle", () => {
    const stray = `fetch("https://api.push.apple.com/3/device/" + token)`;
    expect(scanText(stray, "dist-server/index.js").map((f) => f.name)).toEqual(["Apple Push Notification service"]);
  });
});
