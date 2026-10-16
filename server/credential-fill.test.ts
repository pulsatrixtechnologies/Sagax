import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { vaultHandle } from "../shared/credential-vault.ts";
import { BrowserRuntime, type BrowserSpawnSpec, type CredentialFillResolver } from "./browser-runtime.ts";
import { aimOf, fillScript, parseFillArguments, probeScript, REDACTED_CREDENTIAL, SecretRedactor } from "./credential-fill.ts";
import { CredentialVault, fillResolverFor, LOCAL_VAULT_PRINCIPAL } from "./credential-vault.ts";

// Every credential below is fake test data.
const FAKE_USER = "ada.fake@example.test";
const FAKE_PASSWORD = "fake-Pa55word-not-real";
const PAGE = '<form><input id="user" type="email" autocomplete="username"><input id="pass" type="password"><input id="search" type="text" name="q"><input id="otp" autocomplete="one-time-code"></form><iframe id="frame"></iframe>';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function page(url: string, html = PAGE): Window {
  const window = new Window({ url, settings: { disableIframePageLoading: true } });
  window.document.body.innerHTML = html;
  // happy-dom lays nothing out; give every element a size so it reads as visible.
  (window as unknown as { HTMLElement: { prototype: { getBoundingClientRect: () => unknown } } }).HTMLElement.prototype.getBoundingClientRect =
    () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0 });
  cleanups.push(() => window.happyDOM.close());
  return window;
}

function run(window: Window, script: string): Record<string, unknown> {
  return JSON.parse((window as unknown as { eval: (code: string) => string }).eval(script));
}

describe("fill scripts in the page", () => {
  it("probes without the secret and reports frames, wrong fields and the top-level URL", () => {
    const window = page("https://example.test/login");
    expect(run(window, probeScript({ mode: "auto" }, "password"))).toEqual({ href: "https://example.test/login", origin: "https://example.test", top: true, problem: null });
    expect(run(window, probeScript({ mode: "selector", selector: "#search" }, "password")).problem).toBe("not_password");
    expect(run(window, probeScript({ mode: "selector", selector: "#pass" }, "username")).problem).toBe("password_box");
    expect(run(window, probeScript({ mode: "selector", selector: "#frame" }, "password")).problem).toBe("frame");
    (window.document.querySelector("#frame") as unknown as { focus(): void }).focus();
    expect(run(window, probeScript({ mode: "focused" }, "password")).problem).toBe("frame");
    expect(run(window, probeScript({ mode: "selector", selector: "!!" }, "password")).problem).toBe("selector");
  });

  it("types into the matching input, and refuses when the origin moved since the probe", () => {
    const window = page("https://example.test/login");
    expect(run(window, fillScript({ mode: "auto" }, "username", "https://example.test", FAKE_USER))).toEqual({ ok: true });
    expect(run(window, fillScript({ mode: "auto" }, "password", "https://example.test", FAKE_PASSWORD))).toEqual({ ok: true });
    const value = (selector: string) => (window.document.querySelector(selector) as unknown as { value: string }).value;
    expect(value("#user")).toBe(FAKE_USER);
    expect(value("#pass")).toBe(FAKE_PASSWORD);
    expect(value("#search")).toBe("");
    const moved = page("https://evil.test/login");
    expect(run(moved, fillScript({ mode: "auto" }, "password", "https://example.test", FAKE_PASSWORD))).toEqual({ ok: false, problem: "moved" });
    expect((moved.document.querySelector("#pass") as unknown as { value: string }).value).toBe("");
  });

  it("parses arguments: refs are focused, selectors searched, apiKey needs a target", () => {
    expect(parseFillArguments({ arguments: { credential: "cred_x", field: "password", target: "@e12" } })).toEqual({ credential: "cred_x", field: "password", ref: "@e12" });
    expect(aimOf({ credential: "c", field: "password", ref: "@e1" })).toEqual({ mode: "focused" });
    expect(parseFillArguments({ arguments: { credential: "cred_x", field: "apiKey" } })).toMatch(/target/);
    expect(parseFillArguments({ arguments: { credential: "cred_x", field: "secret" } })).toMatch(/field must be/);
  });
});

describe("redaction", () => {
  it("hides a filled value and its encodings in any later result", () => {
    const redactor = new SecretRedactor();
    redactor.remember("s", FAKE_PASSWORD);
    const base64 = Buffer.from(FAKE_PASSWORD).toString("base64");
    const result = redactor.redact("s", { content: [{ type: "text", text: `value=${FAKE_PASSWORD} b64=${base64} hex=${Buffer.from(FAKE_PASSWORD).toString("hex")} rev=${[...FAKE_PASSWORD].reverse().join("")}` }], structuredContent: { nested: [FAKE_PASSWORD] } });
    const text = JSON.stringify(result);
    expect(text).not.toContain(FAKE_PASSWORD);
    expect(text).not.toContain(base64);
    expect(text.split(REDACTED_CREDENTIAL).length - 1).toBe(5);
    // Another session is untouched, and forgetting a session ends its redaction.
    expect(redactor.redactText("other", FAKE_PASSWORD)).toBe(FAKE_PASSWORD);
    redactor.forget("s");
    expect(redactor.redactText("s", FAKE_PASSWORD)).toBe(FAKE_PASSWORD);
  });

  it("forgets a one-time code after a while", () => {
    let now = 0;
    const redactor = new SecretRedactor(() => now);
    redactor.remember("s", "287082", { shortLived: true });
    expect(redactor.redactText("s", "code 287082")).toBe(`code ${REDACTED_CREDENTIAL}`);
    now += 6 * 60_000;
    expect(redactor.redactText("s", "code 287082")).toBe("code 287082");
  });
});

// A fake agent-browser engine whose page is a happy-dom document: eval runs
// the runtime's scripts for real. STATE_FILE receives the inputs' values
// after each call, so the test reads what the page holds without going
// through the bot's (redacted) results.
const FAKE_ENGINE = String.raw`
const lines = require('node:readline').createInterface({ input: process.stdin });
const fs = require('node:fs');
const { Window } = require('happy-dom');
let win;
function load(url) {
  if (win) win.happyDOM.close();
  win = new Window({ url, settings: { disableIframePageLoading: true } });
  win.document.body.innerHTML = process.env.PAGE_HTML;
  win.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0 });
}
load(process.env.PAGE_URL);
const refs = { '@e1': '#user', '@e2': '#pass', '@e3': '#frame', '@e4': '#search' };
const values = () => Object.fromEntries(Array.from(win.document.querySelectorAll('input')).map((el) => [el.id, el.value]));
const text = (value) => ({ content: [{ type: 'text', text: value }] });
lines.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'notifications/initialized') return;
  let result;
  if (m.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} } };
  else if (m.method === 'tools/list') result = { tools: [{ name: 'agent_browser_snapshot' }] };
  else {
    const { name, arguments: args } = m.params;
    if (name === 'agent_browser_get_url') result = text(win.location.href);
    else if (name === 'agent_browser_open') { load(args.url); result = text('opened ' + args.url); }
    else if (name === 'agent_browser_click') { const el = win.document.querySelector(refs[args.selector] || args.selector); if (!el) result = { isError: true, content: [{ type: 'text', text: 'Element not found' }] }; else { el.focus(); result = text(JSON.stringify({ data: { clicked: args.selector } })); } }
    else if (name === 'agent_browser_eval') { try { result = text(JSON.stringify(win.eval(args.script))); } catch (error) { result = { isError: true, content: [{ type: 'text', text: 'Evaluation failed: ' + args.script }] }; } }
    // A snapshot that shows input values, the way an accessibility tree can.
    else if (name === 'agent_browser_snapshot') result = text(Object.entries(values()).map(([id, value]) => 'textbox #' + id + ' value="' + value + '"').join('\n'));
    else result = text('unknown ' + name);
  }
  fs.writeFileSync(process.env.STATE_FILE, JSON.stringify(values()));
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n');
});
`;

function engine(url: string): { spec: BrowserSpawnSpec; inputs: () => Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), "sagax-fill-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const state = join(dir, "state.json");
  return {
    spec: { command: process.execPath, args: ["-e", FAKE_ENGINE], env: { PATH: process.env.PATH, PAGE_URL: url, PAGE_HTML: PAGE, STATE_FILE: state, NODE_PATH: join(process.cwd(), "node_modules") } },
    inputs: () => existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) : {},
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-fill-vault-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const vault = new CredentialVault(dir, () => ({ kind: "key", key: Buffer.alloc(32, 3) }));
  const item = vault.create(LOCAL_VAULT_PRINCIPAL, { kind: "login", name: "Example", username: FAKE_USER, password: FAKE_PASSWORD, domains: ["example.test"] });
  const runtime = new BrowserRuntime({ requestTimeoutMs: 5_000, takeoverTimeoutMs: 100, idleMs: 5_000 });
  cleanups.push(() => runtime.closeAll());
  const resolver = (botId: string, threadId: string) => fillResolverFor(vault, { principalId: LOCAL_VAULT_PRINCIPAL, botId, threadId });
  return { vault, item, runtime, handle: vaultHandle(item.id), resolver };
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };
const call = (runtime: BrowserRuntime, session: string, spec: BrowserSpawnSpec, name: string, args: Record<string, unknown>, resolver?: CredentialFillResolver) =>
  runtime.agentRpc(session, spec, "tools/call", { name, arguments: args }, undefined, resolver) as Promise<ToolResult>;

describe("fill_credential through the browser runtime", () => {
  it("fills a granted login on its site, and the bot never sees the value", async () => {
    const { vault, item, runtime, handle, resolver } = setup();
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    const { spec, inputs } = engine("https://login.example.test/signin");
    const results: ToolResult[] = [];
    results.push(await call(runtime, "s1", spec, "fill_credential", { credential: handle, field: "username" }, resolver("bot-a", "t1")));
    results.push(await call(runtime, "s1", spec, "fill_credential", { credential: handle, field: "password", target: "@e2" }, resolver("bot-a", "t1")));
    expect(results.map((result) => result.isError)).toEqual([undefined, undefined]);
    expect(results[1]!.content[0]!.text).toContain('Filled the password of "Example" on login.example.test');
    expect(inputs()).toMatchObject({ user: FAKE_USER, pass: FAKE_PASSWORD });
    // A later page read shows the field, never the value.
    const snapshot = await call(runtime, "s1", spec, "agent_browser_snapshot", {});
    results.push(snapshot);
    expect(snapshot.content[0]!.text).toContain(`#pass value="${REDACTED_CREDENTIAL}"`);
    // A script cannot read the field back on that site.
    const evaluated = await call(runtime, "s1", spec, "agent_browser_eval", { script: "document.querySelector('#pass').value" });
    results.push(evaluated);
    expect(evaluated).toMatchObject({ isError: true });
    expect(evaluated.content[0]!.text).toContain("turned off");
    for (const result of results) {
      expect(JSON.stringify(result)).not.toContain(FAKE_PASSWORD);
      expect(JSON.stringify(result)).not.toContain(FAKE_USER);
    }
    expect(vault.item(LOCAL_VAULT_PRINCIPAL, item.id)).toMatchObject({ lastUsedBy: "bot-a" });
  });

  it("fills nothing on another origin, in a frame, into the wrong input, or for an ungranted bot", async () => {
    const { vault, item, runtime, handle, resolver } = setup();
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "once", threadId: "t1" });
    const evil = engine("https://example.test.evil.test/login");
    const offSite = await call(runtime, "evil", evil.spec, "fill_credential", { credential: handle, field: "password" }, resolver("bot-a", "t1"));
    expect(offSite).toMatchObject({ isError: true });
    expect(offSite.content[0]!.text).toContain("only filled on example.test");
    expect(evil.inputs().pass).toBe("");

    const site = engine("https://example.test/login");
    const spy = vi.fn(resolver("bot-a", "t1"));
    const framed = await call(runtime, "framed", site.spec, "fill_credential", { credential: handle, field: "password", target: "@e3" }, spy);
    expect(framed.content[0]!.text).toContain("inside a frame");
    const wrongInput = await call(runtime, "framed", site.spec, "fill_credential", { credential: handle, field: "password", target: "#search" }, spy);
    expect(wrongInput.content[0]!.text).toContain("only typed into a password field");
    // The vault is never asked for a value the page would not receive.
    expect(spy).not.toHaveBeenCalled();
    expect(site.inputs()).toMatchObject({ pass: "", search: "" });

    const otherThread = await call(runtime, "framed", site.spec, "fill_credential", { credential: handle, field: "password" }, resolver("bot-a", "t2"));
    expect(otherThread.content[0]!.text).toContain("not allowed");
    const otherBot = await call(runtime, "framed", site.spec, "fill_credential", { credential: handle, field: "password" }, resolver("bot-b", "t1"));
    expect(otherBot.content[0]!.text).toContain("not allowed");
    const noVault = await call(runtime, "framed", site.spec, "fill_credential", { credential: handle, field: "password" });
    expect(noVault.content[0]!.text).toContain("not available");
    expect(site.inputs().pass).toBe("");
    for (const result of [offSite, framed, wrongInput, otherThread, otherBot, noVault]) expect(JSON.stringify(result)).not.toContain(FAKE_PASSWORD);
  });

  it("advertises fill_credential beside restart_browser", async () => {
    const { runtime } = setup();
    const { spec } = engine("https://example.test/");
    const listed = await runtime.agentRpc("list", spec, "tools/list", {}) as { tools: Array<{ name: string }> };
    expect(listed.tools.map((tool) => tool.name)).toEqual(["agent_browser_snapshot", "restart_browser", "fill_credential"]);
  });
});
