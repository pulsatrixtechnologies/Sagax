import { describe, expect, it, vi } from "vitest";

import { fieldValue, OnePassword, type ExecFileFn, type FetchFn } from "./onepassword.ts";

// Fake 1Password answers; no real account or secret is involved.
const ITEM = {
  id: "abc123",
  fields: [
    { id: "username", purpose: "USERNAME", value: "ada.fake@example.test" },
    { id: "password", purpose: "PASSWORD", value: "fake-1p-password" },
    { id: "otp1", type: "OTP", value: "otpauth://totp/x?secret=GEZDGNBV", totp: "123456" },
  ],
};

describe("1Password", () => {
  it("is off when op is absent, signed out, or on an organization server", async () => {
    const absent: ExecFileFn = vi.fn(async () => { throw new Error("ENOENT"); });
    await expect(new OnePassword({ env: {}, exec: absent, organization: () => false }).status()).resolves.toEqual({ available: false, reason: "absent" });
    const signedOut: ExecFileFn = vi.fn(async (_command, args) => args[0] === "--version" ? "2.30.0\n" : "[]");
    await expect(new OnePassword({ env: {}, exec: signedOut, organization: () => false }).status()).resolves.toMatchObject({ available: false, reason: "signed_out" });
    const exec = vi.fn<ExecFileFn>(async () => "[]");
    await expect(new OnePassword({ env: {}, exec, organization: () => true }).status()).resolves.toEqual({ available: false, reason: "organization" });
    expect(exec).not.toHaveBeenCalled();
  });

  it("lists items through the CLI with an argument array and a clean OP_ environment", async () => {
    const exec = vi.fn<ExecFileFn>(async (_command, args) => {
      if (args[0] === "--version") return "2.30.0";
      if (args[0] === "account") return JSON.stringify([{ account_uuid: "x" }]);
      if (args[0] === "item" && args[1] === "list") return JSON.stringify([
        { id: "abc123", title: "Example", category: "LOGIN", vault: { id: "v1", name: "Private" }, urls: [{ href: "https://login.example.test/x" }] },
        { id: "bad id!", title: "Skipped", vault: { id: "v1" } },
      ]);
      return JSON.stringify(ITEM);
    });
    const op = new OnePassword({ env: { PATH: "/usr/bin", OP_SESSION_x: "must-not-pass", OP_ACCOUNT: "fake.1password.test" }, exec, organization: () => false });
    await expect(op.listItems()).resolves.toEqual([{ id: "abc123", vaultId: "v1", vaultName: "Private", title: "Example", category: "LOGIN", domains: ["login.example.test"] }]);
    await expect(op.readField({ via: "cli", vaultId: "v1", itemId: "abc123" }, "password")).resolves.toBe("fake-1p-password");
    const get = exec.mock.calls.find(([, args]) => args[1] === "get")!;
    expect(get[0]).toBe("op");
    expect(get[1]).toEqual(["item", "get", "abc123", "--vault", "v1", "--reveal", "--format=json"]);
    expect(get[2].env.OP_SESSION_x).toBeUndefined();
    expect(get[2].env.OP_ACCOUNT).toBe("fake.1password.test");
    expect(get[2].env.OP_CACHE).toBe("false");
    // An id that is not one is never passed to the command.
    await expect(op.readField({ via: "cli", vaultId: "v1", itemId: "--help" }, "password")).resolves.toBeNull();
  });

  it("uses Connect when it is configured", async () => {
    const fetch = vi.fn<FetchFn>(async (url) => ({
      ok: true,
      status: 200,
      json: async () => url.endsWith("/v1/vaults") ? [{ id: "v1", name: "Ops" }]
        : url.endsWith("/items") ? [{ id: "abc123", title: "Example", category: "LOGIN", urls: [{ href: "https://example.test" }] }]
          : ITEM,
    }));
    const op = new OnePassword({ env: { OP_CONNECT_HOST: "https://connect.example.test", OP_CONNECT_TOKEN: "fake-connect-token" }, fetch, organization: () => false });
    await expect(op.status()).resolves.toEqual({ available: true, via: "connect" });
    await expect(op.listItems()).resolves.toMatchObject([{ id: "abc123", vaultName: "Ops", domains: ["example.test"] }]);
    await expect(op.readField({ via: "connect", vaultId: "v1", itemId: "abc123" }, "totp")).resolves.toBe("123456");
    expect(fetch.mock.calls[0]![1].headers.Authorization).toBe("Bearer fake-connect-token");
  });

  it("reads each field by its purpose", () => {
    expect(fieldValue(ITEM, "username")).toBe("ada.fake@example.test");
    expect(fieldValue(ITEM, "password")).toBe("fake-1p-password");
    expect(fieldValue(ITEM, "totp")).toBe("123456");
    expect(fieldValue({ fields: [{ id: "credential", value: "fake-api-credential" }] }, "apiKey")).toBe("fake-api-credential");
    expect(fieldValue({}, "password")).toBeNull();
  });
});
