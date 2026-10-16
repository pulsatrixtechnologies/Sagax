import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { vaultHandle } from "../shared/credential-vault.ts";
import { BrowserRuntime, type BrowserSpawnSpec, type CredentialFillAccess } from "./browser-runtime.ts";
import { aimOf, formStaysOnOrigin, parseFillArguments, probeScript, REDACTED_CREDENTIAL, SecretRedactor, variants, writeScript } from "./credential-fill.ts";
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

const ORIGIN = "https://example.test";

describe("the probe and the write in the page", () => {
  it("guard first: on another origin neither marks nor writes anything", () => {
    const evil = page("https://evil.test/login");
    expect(run(evil, probeScript({ mode: "auto" }, "password", "n1", ORIGIN))).toMatchObject({ problem: "moved" });
    expect(evil.document.querySelectorAll("[data-sagax-fill]")).toHaveLength(0);
    const answer = (evil as unknown as { eval: (code: string) => string }).eval(writeScript("n1", "password", ORIGIN, FAKE_PASSWORD));
    expect(answer).toBe("moved");
    expect((evil.document.querySelector("#pass") as unknown as { value: string }).value).toBe("");
    // The write is strict mode and checks the origin before it names the value.
    const script = writeScript("n1", "password", ORIGIN, FAKE_PASSWORD);
    expect(script.indexOf("'use strict'")).toBeLessThan(script.indexOf("location.origin"));
    expect(script.indexOf("location.origin")).toBeLessThan(script.indexOf(FAKE_PASSWORD));
  });

  it("writes only into the marked element, and only when it holds the focus", () => {
    const window = page("https://example.test/login");
    run(window, probeScript({ mode: "auto" }, "password", "n2", ORIGIN));
    const evalIn = (code: string) => (window as unknown as { eval: (code: string) => string }).eval(code);
    expect(evalIn(writeScript("other", "password", ORIGIN, FAKE_PASSWORD))).toBe("moved");
    // A frame that keeps stealing the focus defeats the write, which then types nothing.
    const pass = window.document.querySelector("#pass") as unknown as { focus: () => void; value: string };
    pass.focus = () => {};
    (window.document.querySelector("#frame") as unknown as { focus(): void }).focus();
    expect(evalIn(writeScript("n2", "password", ORIGIN, FAKE_PASSWORD))).toBe("focus");
    expect(pass.value).toBe("");
  });
});

describe("the probe in the page", () => {
  it("carries no secret, reports frames and wrong fields, and marks only an accepted target", () => {
    const window = page("https://example.test/login");
    const probe = probeScript({ mode: "auto" }, "password", "n0nce", ORIGIN);
    expect(probe).not.toContain(FAKE_PASSWORD);
    expect(run(window, probe)).toEqual({ top: true, problem: null, targets: ["https://example.test/session"] });
    expect(window.document.querySelector('[data-sagax-fill="n0nce"]')?.id).toBe("pass");
    expect(run(window, probeScript({ mode: "selector", selector: "#search" }, "password", "a", ORIGIN)).problem).toBe("not_password");
    expect(run(window, probeScript({ mode: "selector", selector: "#pass" }, "username", "b", ORIGIN)).problem).toBe("password_box");
    expect(run(window, probeScript({ mode: "selector", selector: "#frame" }, "password", "c", ORIGIN)).problem).toBe("frame");
    (window.document.querySelector("#frame") as unknown as { focus(): void }).focus();
    expect(run(window, probeScript({ mode: "focused" }, "password", "d", ORIGIN)).problem).toBe("frame");
    expect(run(window, probeScript({ mode: "selector", selector: "!!" }, "password", "e", ORIGIN)).problem).toBe("selector");
    expect(window.document.querySelectorAll("[data-sagax-fill]")).toHaveLength(1);
  });

  it("refuses a form that posts to another origin or to a script", () => {
    expect(formStaysOnOrigin(["https://example.test/session"], "https://example.test")).toBe(true);
    expect(formStaysOnOrigin(["https://evil.test/collect"], "https://example.test")).toBe(false);
    expect(formStaysOnOrigin(["javascript:steal()"], "https://example.test")).toBe(false);
    const window = page("https://example.test/login", '<form action="https://evil.test/collect"><input id="pass" type="password"></form>');
    expect(run(window, probeScript({ mode: "auto" }, "password", "x", ORIGIN)).targets).toEqual(["https://evil.test/collect"]);
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

  it("hides a short user name as a whole word only, and masks the length of bullet runs", () => {
    const redactor = new SecretRedactor();
    redactor.remember("s", "ada");
    expect(redactor.redactText("s", "user ada signed in; adam stays")).toBe(`user ${REDACTED_CREDENTIAL} signed in; adam stays`);
    expect(redactor.redactText("s", 'textbox "Password" value="\u2022\u2022\u2022\u2022\u2022"')).toBe('textbox "Password" value="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"');
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
// How agent-browser 0.38.2's MCP turns each call into a command line (mcp.rs
// run_cli): eval hands the script over stdin, fill and type put the text in argv.
const argvs = [];
const argvOf = (name, args) => name === 'agent_browser_eval' ? ['eval', '--stdin']
  : name === 'agent_browser_fill' || name === 'agent_browser_type' ? [name.slice(14), args.selector, args.text]
  : [name.slice(14), ...Object.values(args || {}).map(String)];
let other;
lines.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'notifications/initialized') return;
  let result;
  if (m.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} } };
  else if (m.method === 'tools/list') result = { tools: [{ name: 'agent_browser_snapshot' }] };
  else {
    const { name, arguments: args } = m.params;
    calls.push(name === 'agent_browser_eval' ? 'eval:' + args.script : name);
    argvs.push(argvOf(name, args));
    if (name === 'agent_browser_get_url') result = text(engineUrl);
    else if (name === 'agent_browser_open') { load(args.url); result = text('opened ' + args.url); }
    else if (name === 'agent_browser_tab_switch') { load(process.env.OTHER_TAB_URL); result = text('switched'); }
    else if (name === 'agent_browser_click') { const el = win.document.querySelector(refs[args.selector] || args.selector); if (!el) result = { isError: true, content: [{ type: 'text', text: 'Element not found' }] }; else { el.focus(); result = text(JSON.stringify({ data: { clicked: args.selector } })); } }
    else if (name === 'agent_browser_fill') { const el = win.document.querySelector(refs[args.selector] || args.selector); if (!el) result = { isError: true, content: [{ type: 'text', text: 'Element not found: ' + args.selector }] }; else { el.value = args.text; result = text(JSON.stringify({ data: { filled: args.selector, text: args.text } })); } }
    else if (name === 'agent_browser_eval') { try { result = text(JSON.stringify(win.eval(args.script))); } catch (error) { result = { isError: true, content: [{ type: 'text', text: 'Evaluation failed: ' + error.message }] }; } }
    else if (name === 'agent_browser_screenshot') result = { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] };
    // A snapshot that shows input values, the way an accessibility tree can.
    else if (name === 'agent_browser_snapshot') result = text(Object.entries(values()).map(([id, value]) => 'textbox #' + id + ' value="' + value + '"').join('\n'));
    else result = text('unknown ' + name);
  }
  fs.writeFileSync(process.env.STATE_FILE, JSON.stringify({ values: values(), calls, argvs, url: engineUrl }));
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n');
});
`;

function engine(url: string, options: { html?: string; script?: string; otherTab?: string } = {}): { spec: BrowserSpawnSpec; inputs: () => Record<string, string>; calls: () => string[]; argvs: () => string[][]; url: () => string } {
  const dir = mkdtempSync(join(tmpdir(), "sagax-fill-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const state = join(dir, "state.json");
  const read = () => existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) as { values: Record<string, string>; calls: string[]; argvs: string[][]; url: string } : { values: {}, calls: [], argvs: [], url: "" };
  return {
    spec: { command: process.execPath, args: ["-e", FAKE_ENGINE], env: {
      PATH: process.env.PATH, PAGE_URL: url, PAGE_HTML: options.html ?? PAGE, STATE_FILE: state, NODE_PATH: join(process.cwd(), "node_modules"),
      ...(options.script ? { PAGE_SCRIPT: options.script } : {}),
      OTHER_TAB_URL: options.otherTab ?? "https://evil.test/",
    } },
    inputs: () => read().values,
    calls: () => read().calls,
    argvs: () => read().argvs,
    url: () => read().url,
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
    const { spec, inputs, calls, argvs } = engine("https://login.example.test/signin");
    const results: ToolResult[] = [];
    results.push(await call(runtime, "s1", spec, "fill_credential", { credential: handle, field: "username" }, access("bot-a", "t1")));
    results.push(await call(runtime, "s1", spec, "fill_credential", { credential: handle, field: "password", target: "@e2" }, access("bot-a", "t1")));
    expect(results.map((result) => result.isError)).toEqual([undefined, undefined]);
    expect(results[1]!.content[0]!.text).toContain('Filled the password of "Example" on login.example.test');
    expect(inputs()).toMatchObject({ user: FAKE_USER, pass: FAKE_PASSWORD });
    // NEW BLOCKER 1: the value never reaches a command line (ps, /proc).
    expect(argvs().length).toBeGreaterThan(0);
    for (const argv of argvs()) {
      expect(argv.join(" ")).not.toContain(FAKE_PASSWORD);
      expect(argv.join(" ")).not.toContain(FAKE_USER);
    }
    expect(calls().some((entry) => entry === "agent_browser_fill" || entry === "agent_browser_type")).toBe(false);
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

  it("THIRD BLOCKER: once a login is allowed or filled, elements are addressed by @eN refs only (no CSS value oracle)", async () => {
    const { vault, item, runtime, handle, access } = setup();
    const site = engine("https://example.test/login");
    const oracle = 'input[type=password][value^="f"]';
    // Nothing allowed or filled yet: a CSS selector still works.
    expect((await call(runtime, "css", site.spec, "agent_browser_click", { selector: "#search" }, access("bot-a", "t1"))).isError).toBeUndefined();
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    // Allowed: fill_credential's own target refuses CSS, auto and refs work.
    const cssTarget = await call(runtime, "css", site.spec, "fill_credential", { credential: handle, field: "password", target: oracle }, access("bot-a", "t1"));
    expect(cssTarget.content[0]!.text).toContain("@eN refs");
    expect((await call(runtime, "css", site.spec, "fill_credential", { credential: handle, field: "password", target: "@e2" }, access("bot-a", "t1"))).isError).toBeUndefined();
    // Filled: every selector-taking tool refuses CSS for every bot, even one with no grant.
    for (const [name, args] of [
      ["agent_browser_click", { selector: oracle }],
      ["agent_browser_wait_for_selector", { selector: `input:has([value^="f"])` }],
      ["agent_browser_get_text", { selector: "input" }],
      ["agent_browser_snapshot", { selector: "form" }],
    ] as const) {
      const refused = await call(runtime, "css", site.spec, name, args, access("bot-b", "t9"));
      expect(refused, name).toMatchObject({ isError: true });
      expect(refused.content[0]!.text).toContain("@eN refs");
    }
    expect((await call(runtime, "css", site.spec, "agent_browser_click", { selector: "@e4" }, access("bot-b", "t9"))).isError).toBeUndefined();
  });

  it("pauses the engine's live stream around the write, and types nothing if it cannot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-fill-stream-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const vault = new CredentialVault(dir, () => ({ kind: "key", key: Buffer.alloc(32, 4) }));
    const item = vault.create(LOCAL_VAULT_PRINCIPAL, { kind: "login", name: "Example", password: FAKE_PASSWORD, domains: ["example.test"] });
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    const order: string[] = [];
    let allow = true;
    const runtime = new BrowserRuntime({
      requestTimeoutMs: 5_000, takeoverTimeoutMs: 100, idleMs: 5_000,
      pauseStream: async () => { order.push("pause"); return allow ? async () => { order.push("resume"); } : null; },
    });
    cleanups.push(() => runtime.closeAll());
    const access = fillResolverFor(vault, { principalId: LOCAL_VAULT_PRINCIPAL, botId: "bot-a", threadId: "t1" });
    const site = engine("https://example.test/login");
    expect((await call(runtime, "st", site.spec, "fill_credential", { credential: vaultHandle(item.id), field: "password" }, access)).isError).toBeUndefined();
    expect(order).toEqual(["pause", "resume"]);
    expect(site.inputs().pass).toBe(FAKE_PASSWORD);
    allow = false;
    const other = engine("https://example.test/login");
    const refused = await call(runtime, "st2", other.spec, "fill_credential", { credential: vaultHandle(item.id), field: "password" }, access);
    expect(refused.content[0]!.text).toContain("could not be paused");
    expect(other.inputs().pass).toBe("");
    // No frame of a browser where a login was filled.
    await expect(runtime.previewFrame("st", async () => "frame")).rejects.toThrow(/Frames of this browser are off/);
    await expect(runtime.previewFrame("fresh", async () => "frame")).resolves.toBe("frame");
  });

  it("NEW BLOCKER 2: a fill holds the browser alone; a tab switch in the middle is refused", async () => {
    const { vault, item, runtime, handle, access } = setup();
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    const site = engine("https://example.test/login");
    const base = access("bot-a", "t1");
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    let entered!: () => void;
    const inside = new Promise<void>((done) => { entered = done; });
    const slow: CredentialFillAccess = { armed: base.armed, resolve: async (request) => { entered(); await gate; return base.resolve(request); } };
    const filling = call(runtime, "excl", site.spec, "fill_credential", { credential: handle, field: "password" }, slow);
    await inside;
    await expect(call(runtime, "excl", site.spec, "agent_browser_tab_switch", { index: 1 })).rejects.toThrow(/busy typing/);
    await expect(call(runtime, "excl", site.spec, "agent_browser_eval", { script: "1" })).rejects.toThrow(/busy typing/);
    release();
    expect((await filling).isError).toBeUndefined();
    expect(site.inputs().pass).toBe(FAKE_PASSWORD);
    expect(site.url()).toBe("https://example.test/login");
  });

  it("NEW BLOCKER 3: after a fill, no script runs in that browser for any bot or conversation, until a restart; before, a script carries its origin guard", async () => {
    const { vault, item, runtime, handle, access } = setup();
    const site = engine("https://example.test/login", { otherTab: "https://other.test/" });
    // No grant yet: the script runs, guarded by the origin it was recorded on.
    expect((await call(runtime, "s3", site.spec, "agent_browser_eval", { script: "document.title" }, access("bot-b", "t9"))).isError).toBeUndefined();
    expect(site.calls().filter((entry) => entry.startsWith("eval:")).at(-1)).toContain('if (location.origin !== "https://example.test")');
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "once", threadId: "t1" });
    const fresh = engine("https://example.test/login");
    expect((await call(runtime, "s4", fresh.spec, "fill_credential", { credential: handle, field: "password" }, access("bot-a", "t1"))).isError).toBeUndefined();
    // Another bot, another conversation, no grant: still refused in that browser.
    const later = await call(runtime, "s4", fresh.spec, "agent_browser_eval", { script: "document.querySelector('#pass').value" }, access("bot-b", "t9"));
    expect(later).toMatchObject({ isError: true });
    expect(later.content[0]!.text).toContain("restart_browser");
    expect(JSON.stringify(later)).not.toContain(FAKE_PASSWORD);
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
    const wrongInput = await call(runtime, "framed", site.spec, "fill_credential", { credential: handle, field: "password", target: "@e4" }, guarded);
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
