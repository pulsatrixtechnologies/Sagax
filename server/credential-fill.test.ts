import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { vaultHandle } from "../shared/credential-vault.ts";
import { BrowserRuntime, type BrowserSpawnSpec, type CredentialFillAccess } from "./browser-runtime.ts";
import { aimOf, formStaysOnOrigin, parseFillArguments, probeScript, REDACTED_CREDENTIAL, SecretRedactor, variants } from "./credential-fill.ts";
import { CredentialVault, fillResolverFor, LOCAL_VAULT_PRINCIPAL } from "./credential-vault.ts";

// Every credential below is fake test data.
const FAKE_USER = "ada.fake@example.test";
const FAKE_PASSWORD = "fake-Pa55word-not-real";
const PAGE = '<form action="/session"><input id="user" type="email" autocomplete="username"><input id="pass" type="password"><input id="search" type="text" name="q"><input id="otp" autocomplete="one-time-code"></form><iframe id="frame"></iframe>';

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

describe("the probe in the page", () => {
  it("carries no secret, reports frames and wrong fields, and marks only an accepted target", () => {
    const window = page("https://example.test/login");
    const probe = probeScript({ mode: "auto" }, "password", "n0nce");
    expect(probe).not.toContain(FAKE_PASSWORD);
    expect(run(window, probe)).toEqual({ top: true, problem: null, targets: ["https://example.test/session"] });
    expect(window.document.querySelector('[data-sagax-fill="n0nce"]')?.id).toBe("pass");
    expect(run(window, probeScript({ mode: "selector", selector: "#search" }, "password", "a")).problem).toBe("not_password");
    expect(run(window, probeScript({ mode: "selector", selector: "#pass" }, "username", "b")).problem).toBe("password_box");
    expect(run(window, probeScript({ mode: "selector", selector: "#frame" }, "password", "c")).problem).toBe("frame");
    (window.document.querySelector("#frame") as unknown as { focus(): void }).focus();
    expect(run(window, probeScript({ mode: "focused" }, "password", "d")).problem).toBe("frame");
    expect(run(window, probeScript({ mode: "selector", selector: "!!" }, "password", "e")).problem).toBe("selector");
    expect(window.document.querySelectorAll("[data-sagax-fill]")).toHaveLength(1);
  });

  it("refuses a form that posts to another origin or to a script", () => {
    expect(formStaysOnOrigin(["https://example.test/session"], "https://example.test")).toBe(true);
    expect(formStaysOnOrigin(["https://evil.test/collect"], "https://example.test")).toBe(false);
    expect(formStaysOnOrigin(["javascript:steal()"], "https://example.test")).toBe(false);
    const window = page("https://example.test/login", '<form action="https://evil.test/collect"><input id="pass" type="password"></form>');
    expect(run(window, probeScript({ mode: "auto" }, "password", "x")).targets).toEqual(["https://evil.test/collect"]);
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
    const encodings = [
      FAKE_PASSWORD,
      Buffer.from(FAKE_PASSWORD).toString("base64"),
      Buffer.from(FAKE_PASSWORD).toString("hex"),
      Buffer.from(FAKE_PASSWORD).toString("hex").toUpperCase(),
      [...FAKE_PASSWORD].reverse().join(""),
      [...FAKE_PASSWORD].map((char) => `&#${char.codePointAt(0)};`).join(""),
      [...FAKE_PASSWORD].map((char) => `\\u${char.codePointAt(0)!.toString(16).padStart(4, "0")}`).join(""),
    ];
    const result = redactor.redact("s", { content: [{ type: "text", text: encodings.join(" | ") }], structuredContent: { nested: [FAKE_PASSWORD] } });
    const text = JSON.stringify(result);
    for (const encoded of encodings) expect(text).not.toContain(encoded);
    expect(variants("a b&c")).toEqual(expect.arrayContaining(["a+b%26c", "a b&amp;c"]));
    // Another session is untouched, and forgetting a session ends its redaction.
    expect(redactor.redactText("other", FAKE_PASSWORD)).toBe(FAKE_PASSWORD);
    redactor.forget("s");
    expect(redactor.redactText("s", FAKE_PASSWORD)).toBe(FAKE_PASSWORD);
  });

  it("hides a user:pass pair in base64, as HTTP Basic sends it", () => {
    const redactor = new SecretRedactor();
    redactor.remember("s", FAKE_USER);
    redactor.remember("s", FAKE_PASSWORD);
    const basic = Buffer.from(`${FAKE_USER}:${FAKE_PASSWORD}`).toString("base64");
    expect(redactor.redactText("s", `Authorization: Basic ${basic}`)).toBe(`Authorization: Basic ${REDACTED_CREDENTIAL}`);
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
// the runtime's scripts in the page, get_url answers the engine's own URL
// (PAGE_URL), fill types the text into the element the selector names, like
// the engine's CDP input does. PAGE_SCRIPT runs in the page at load (the
// site's own script). STATE_FILE receives the inputs' values after each call.
const FAKE_ENGINE = String.raw`
const lines = require('node:readline').createInterface({ input: process.stdin });
const fs = require('node:fs');
const { Window } = require('happy-dom');
let win;
let engineUrl;
function load(url) {
  if (win) win.happyDOM.close();
  engineUrl = url;
  win = new Window({ url, settings: { disableIframePageLoading: true } });
  win.document.body.innerHTML = process.env.PAGE_HTML;
  win.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0 });
  if (process.env.PAGE_SCRIPT) win.eval(process.env.PAGE_SCRIPT);
}
load(process.env.PAGE_URL);
const refs = { '@e1': '#user', '@e2': '#pass', '@e3': '#frame', '@e4': '#search' };
const values = () => Object.fromEntries(Array.from(win.document.querySelectorAll('input')).map((el) => [el.id, el.value]));
const text = (value) => ({ content: [{ type: 'text', text: value }] });
const calls = [];
lines.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'notifications/initialized') return;
  let result;
  if (m.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} } };
  else if (m.method === 'tools/list') result = { tools: [{ name: 'agent_browser_snapshot' }] };
  else {
    const { name, arguments: args } = m.params;
    calls.push(name === 'agent_browser_eval' ? 'eval:' + args.script : name);
    if (name === 'agent_browser_get_url') result = text(engineUrl);
    else if (name === 'agent_browser_open') { load(args.url); result = text('opened ' + args.url); }
    else if (name === 'agent_browser_click') { const el = win.document.querySelector(refs[args.selector] || args.selector); if (!el) result = { isError: true, content: [{ type: 'text', text: 'Element not found' }] }; else { el.focus(); result = text(JSON.stringify({ data: { clicked: args.selector } })); } }
    else if (name === 'agent_browser_fill') { const el = win.document.querySelector(refs[args.selector] || args.selector); if (!el) result = { isError: true, content: [{ type: 'text', text: 'Element not found: ' + args.selector }] }; else { el.value = args.text; result = text(JSON.stringify({ data: { filled: args.selector, text: args.text } })); } }
    else if (name === 'agent_browser_eval') { try { result = text(JSON.stringify(win.eval(args.script))); } catch (error) { result = { isError: true, content: [{ type: 'text', text: 'Evaluation failed' }] }; } }
    else if (name === 'agent_browser_screenshot') result = { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] };
    // A snapshot that shows input values, the way an accessibility tree can.
    else if (name === 'agent_browser_snapshot') result = text(Object.entries(values()).map(([id, value]) => 'textbox #' + id + ' value="' + value + '"').join('\n'));
    else result = text('unknown ' + name);
  }
  fs.writeFileSync(process.env.STATE_FILE, JSON.stringify({ values: values(), calls }));
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n');
});
`;

function engine(url: string, options: { html?: string; script?: string } = {}): { spec: BrowserSpawnSpec; inputs: () => Record<string, string>; calls: () => string[] } {
  const dir = mkdtempSync(join(tmpdir(), "sagax-fill-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const state = join(dir, "state.json");
  const read = () => existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) as { values: Record<string, string>; calls: string[] } : { values: {}, calls: [] };
  return {
    spec: { command: process.execPath, args: ["-e", FAKE_ENGINE], env: {
      PATH: process.env.PATH, PAGE_URL: url, PAGE_HTML: options.html ?? PAGE, STATE_FILE: state, NODE_PATH: join(process.cwd(), "node_modules"),
      ...(options.script ? { PAGE_SCRIPT: options.script } : {}),
    } },
    inputs: () => read().values,
    calls: () => read().calls,
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-fill-vault-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const vault = new CredentialVault(dir, () => ({ kind: "key", key: Buffer.alloc(32, 3) }));
  const item = vault.create(LOCAL_VAULT_PRINCIPAL, { kind: "login", name: "Example", username: FAKE_USER, password: FAKE_PASSWORD, domains: ["login.example.test", "example.test"] });
  const runtime = new BrowserRuntime({ requestTimeoutMs: 5_000, takeoverTimeoutMs: 100, idleMs: 5_000 });
  cleanups.push(() => runtime.closeAll());
  const access = (botId: string, threadId: string) => fillResolverFor(vault, { principalId: LOCAL_VAULT_PRINCIPAL, botId, threadId });
  return { vault, item, runtime, handle: vaultHandle(item.id), access };
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };
const call = (runtime: BrowserRuntime, session: string, spec: BrowserSpawnSpec, name: string, args: Record<string, unknown>, access?: CredentialFillAccess) =>
  runtime.agentRpc(session, spec, "tools/call", { name, arguments: args }, undefined, access) as Promise<ToolResult>;

describe("fill_credential through the browser runtime", () => {
  it("fills a granted login on its site through the engine, and the bot never sees the value", async () => {
    const { vault, item, runtime, handle, access } = setup();
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    const { spec, inputs, calls } = engine("https://login.example.test/signin");
    const results: ToolResult[] = [];
    results.push(await call(runtime, "s1", spec, "fill_credential", { credential: handle, field: "username" }, access("bot-a", "t1")));
    results.push(await call(runtime, "s1", spec, "fill_credential", { credential: handle, field: "password", target: "@e2" }, access("bot-a", "t1")));
    expect(results.map((result) => result.isError)).toEqual([undefined, undefined]);
    expect(results[1]!.content[0]!.text).toContain('Filled the password of "Example" on login.example.test');
    expect(inputs()).toMatchObject({ user: FAKE_USER, pass: FAKE_PASSWORD });
    // The value reaches the engine's own fill only, never a script source.
    expect(calls().filter((entry) => entry.startsWith("eval:")).some((entry) => entry.includes(FAKE_PASSWORD) || entry.includes(FAKE_USER))).toBe(false);
    // A later page read shows the field, never the value.
    const snapshot = await call(runtime, "s1", spec, "agent_browser_snapshot", {});
    results.push(snapshot);
    expect(snapshot.content[0]!.text).toContain(`#pass value="${REDACTED_CREDENTIAL}"`);
    // Screenshots are off on the filled site.
    const shot = await call(runtime, "s1", spec, "agent_browser_screenshot", {}, access("bot-a", "t1"));
    expect(shot).toMatchObject({ isError: true });
    for (const result of results) {
      expect(JSON.stringify(result)).not.toContain(FAKE_PASSWORD);
      expect(JSON.stringify(result)).not.toContain(FAKE_USER);
    }
    expect(vault.item(LOCAL_VAULT_PRINCIPAL, item.id)).toMatchObject({ lastUsedBy: "bot-a" });
  });

  it("BLOCKER 1: a page that spoofs its address in script gets nothing (the URL comes from the engine)", async () => {
    const { vault, item, runtime, handle, access } = setup();
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    // evil.test rewrites JSON.stringify and location-like answers to claim it is the bound site.
    const spoof = `(() => { const real = JSON.stringify; JSON.stringify = function (value) { if (value && typeof value === 'object') { value.href = 'https://login.example.test/signin'; value.origin = 'https://login.example.test'; value.top = true; value.problem = null; value.targets = []; } return real.apply(this, arguments); }; })();`;
    const evil = engine("https://evil.test/login", { script: spoof });
    const result = await call(runtime, "evil", evil.spec, "fill_credential", { credential: handle, field: "password" }, access("bot-a", "t1"));
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0]!.text).toContain("only filled on");
    expect(evil.inputs().pass).toBe("");
    expect(JSON.stringify(evil.calls())).not.toContain(FAKE_PASSWORD);
  });

  it("BLOCKER 2: no bot script runs while a login is allowed, and no fill where the bot ran one", async () => {
    const { vault, item, runtime, handle, access } = setup();
    const site = engine("https://example.test/login");
    // Before any grant, a script runs, and its origin is remembered.
    const planted = await call(runtime, "s2", site.spec, "agent_browser_eval", { script: "document.querySelector('#pass').addEventListener('input', () => {}); 'ok'" }, access("bot-a", "t1"));
    expect(planted.isError).toBeUndefined();
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "once", threadId: "t1" });
    // While allowed, every script tool is refused in the whole browser.
    const refused = await call(runtime, "s2", site.spec, "agent_browser_eval", { script: "1" }, access("bot-a", "t1"));
    expect(refused).toMatchObject({ isError: true });
    expect(refused.content[0]!.text).toContain("turned off");
    // The fill refuses on the origin where the bot already ran a script.
    const fill = await call(runtime, "s2", site.spec, "fill_credential", { credential: handle, field: "password" }, access("bot-a", "t1"));
    expect(fill.content[0]!.text).toContain("restart_browser");
    expect(site.inputs().pass).toBe("");
  });

  it("refuses a form that posts to another site", async () => {
    const { vault, item, runtime, handle, access } = setup();
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    const site = engine("https://example.test/login", { html: '<form action="https://evil.test/collect"><input id="pass" type="password"></form>' });
    const spy = vi.fn(access("bot-a", "t1").resolve);
    const result = await call(runtime, "xform", site.spec, "fill_credential", { credential: handle, field: "password" }, { resolve: spy, armed: () => true });
    expect(result.content[0]!.text).toContain("sends to another site");
    expect(spy).not.toHaveBeenCalled();
    expect(site.inputs().pass).toBe("");
  });

  it("fills nothing on another origin, in a frame, into the wrong input, or for an ungranted bot", async () => {
    const { vault, item, runtime, handle, access } = setup();
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "once", threadId: "t1" });
    for (const url of ["https://example.test.evil.test/login", "https://sub.example.test/login", "http://example.test/login"]) {
      const other = engine(url);
      const offSite = await call(runtime, `off-${url}`, other.spec, "fill_credential", { credential: handle, field: "password" }, access("bot-a", "t1"));
      expect(offSite.content[0]!.text, url).toContain("only filled on");
      expect(other.inputs().pass).toBe("");
    }

    const site = engine("https://example.test/login");
    const base = access("bot-a", "t1");
    const spy = vi.fn(base.resolve);
    const guarded = { resolve: spy, armed: base.armed };
    const framed = await call(runtime, "framed", site.spec, "fill_credential", { credential: handle, field: "password", target: "@e3" }, guarded);
    expect(framed.content[0]!.text).toContain("inside a frame");
    const wrongInput = await call(runtime, "framed", site.spec, "fill_credential", { credential: handle, field: "password", target: "#search" }, guarded);
    expect(wrongInput.content[0]!.text).toContain("only typed into a password field");
    // The vault is never asked for a value the page would not receive.
    expect(spy).not.toHaveBeenCalled();
    expect(site.inputs()).toMatchObject({ pass: "", search: "" });

    const otherThread = await call(runtime, "framed", site.spec, "fill_credential", { credential: handle, field: "password" }, access("bot-a", "t2"));
    expect(otherThread.content[0]!.text).toContain("not allowed");
    const otherBot = await call(runtime, "framed", site.spec, "fill_credential", { credential: handle, field: "password" }, access("bot-b", "t1"));
    expect(otherBot.content[0]!.text).toContain("not allowed");
    const noVault = await call(runtime, "framed", site.spec, "fill_credential", { credential: handle, field: "password" });
    expect(noVault.content[0]!.text).toContain("not available");
    expect(site.inputs().pass).toBe("");
  });

  it("advertises fill_credential beside restart_browser", async () => {
    const { runtime } = setup();
    const { spec } = engine("https://example.test/");
    const listed = await runtime.agentRpc("list", spec, "tools/list", {}) as { tools: Array<{ name: string }> };
    expect(listed.tools.map((tool) => tool.name)).toEqual(["agent_browser_snapshot", "restart_browser", "fill_credential"]);
  });
});
