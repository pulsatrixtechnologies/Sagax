import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";

import { isSecretField } from "./teach-recording.ts";
import {
  isSensitiveField,
  MASK_SENSITIVE_SCRIPT,
  MASKED_ATTRIBUTE,
  parseSensitiveValues,
  SENSITIVE_VALUES_SCRIPT,
  UNMASK_SENSITIVE_SCRIPT,
  withSensitiveValues,
} from "./sensitive-fields.ts";

// Every value below is fake test data.
const PASSWORD = "fake-Typed-Pa55-not-real";
const CARD = "4111 1111 1111 1111";
const PAGE = [
  '<input id="user" type="email" autocomplete="username">',
  '<input id="pass" type="password">',
  '<input id="newpass" type="text" autocomplete="section-a new-password">',
  '<input id="otp" autocomplete="one-time-code">',
  '<input id="card" autocomplete="billing cc-number">',
  '<input id="csc" autocomplete="cc-csc">',
  '<select id="month" autocomplete="cc-exp-month"><option value=""></option><option value="09">09</option></select>',
  '<input id="search" type="text" name="q">',
  '<span id="key" data-sensitive>fake-api-key-0000-not-real</span>',
  '<input id="plain" type="password" data-sensitive="false">',
  '<div id="host"></div>',
].join("");

const windows: Window[] = [];
afterEach(async () => { for (const window of windows.splice(0)) await window.happyDOM.close(); });

function page(): Window {
  const window = new Window({ url: "https://shop.example.test/checkout", settings: { disableIframePageLoading: true } });
  window.document.body.innerHTML = PAGE;
  windows.push(window);
  return window;
}
const evalIn = (window: Window, script: string): unknown => (window as unknown as { eval: (code: string) => unknown }).eval(script);
const input = (window: Window, id: string) => window.document.getElementById(id) as unknown as { value: string; getAttribute(name: string): string | null; hasAttribute(name: string): boolean; setAttribute(name: string, value: string): void };
const asResult = (answer: unknown) => ({ content: [{ type: "text", text: JSON.stringify(answer) }] });

describe("which fields are sensitive", () => {
  it("passwords, password and one-time-code autocomplete, every cc-* token, data-sensitive", () => {
    expect(isSensitiveField({ tag: "input", type: "password" })).toBe(true);
    expect(isSensitiveField({ tag: "input", type: "text", autocomplete: "current-password" })).toBe(true);
    expect(isSensitiveField({ tag: "input", autocomplete: "section-x NEW-PASSWORD" })).toBe(true);
    expect(isSensitiveField({ tag: "input", autocomplete: "one-time-code" })).toBe(true);
    for (const token of ["cc-number", "cc-csc", "cc-exp", "cc-exp-month", "cc-exp-year", "cc-name"]) expect(isSensitiveField({ tag: "input", autocomplete: `billing ${token}` })).toBe(true);
    expect(isSensitiveField({ tag: "select", autocomplete: "cc-exp-year" })).toBe(true);
    expect(isSensitiveField({ tag: "span", sensitive: "" })).toBe(true);
    expect(isSensitiveField({ tag: "input", type: "email", autocomplete: "username" })).toBe(false);
    expect(isSensitiveField({ tag: "input", type: "text" })).toBe(false);
    // data-sensitive only adds: "false" never makes a password ordinary.
    expect(isSensitiveField({ tag: "input", type: "password", sensitive: "false" })).toBe(true);
    expect(isSensitiveField({ tag: "input", type: "text", sensitive: "false" })).toBe(false);
  });

  it("Teach by demonstration uses the same rule", () => {
    expect(isSecretField({ type: "text", autocomplete: "cc-exp-year" })).toBe(true);
    expect(isSecretField({ type: "text", sensitive: "" })).toBe(true);
    expect(isSecretField({ type: "text", name: "Search", sensitive: "false" })).toBe(false);
  });
});

describe("the page scripts", () => {
  it("read every sensitive value, in shadow roots too, and leave the page's values as they are", () => {
    const window = page();
    const shadow = (window.document.getElementById("host") as unknown as { attachShadow(init: { mode: "open" }): { innerHTML: string } }).attachShadow({ mode: "open" });
    shadow.innerHTML = '<input id="inner" autocomplete="one-time-code" value="246810">';
    input(window, "user").value = "ada.fake@example.test";
    input(window, "pass").value = PASSWORD;
    input(window, "newpass").value = "fake-New-Pa55-not-real";
    input(window, "otp").value = "135791";
    input(window, "card").value = CARD;
    input(window, "csc").value = "987";
    input(window, "month").value = "09";
    input(window, "search").value = "running shoes";
    input(window, "plain").value = "fake-plain-pa55";
    const values = parseSensitiveValues(asResult(evalIn(window, SENSITIVE_VALUES_SCRIPT)));
    expect(values).toEqual(expect.arrayContaining([PASSWORD, "fake-New-Pa55-not-real", "135791", CARD, "987", "09", "fake-api-key-0000-not-real", "fake-plain-pa55", "246810"]));
    expect(values).not.toContain("ada.fake@example.test");
    expect(values).not.toContain("running shoes");
    expect(input(window, "pass").value).toBe(PASSWORD);
    expect(input(window, "card").value).toBe(CARD);
  });

  it("keeps a password field sensitive after the site turns it into a text field", () => {
    const window = page();
    input(window, "pass").value = PASSWORD;
    evalIn(window, SENSITIVE_VALUES_SCRIPT);
    input(window, "pass").setAttribute("type", "text"); // "show password"
    expect(parseSensitiveValues(asResult(evalIn(window, SENSITIVE_VALUES_SCRIPT)))).toContain(PASSWORD);
  });

  it("adds the values to a page observation without changing what it reports", () => {
    const window = page();
    input(window, "pass").value = PASSWORD;
    const observe = "JSON.stringify({ url: location.href, title: document.title, text: 'Checkout' })";
    const answer = asResult(evalIn(window, withSensitiveValues(observe)));
    expect(parseSensitiveValues(answer)).toContain(PASSWORD);
    expect(JSON.parse(JSON.parse(answer.content[0]!.text) as string)).toMatchObject({ url: "https://shop.example.test/checkout", text: "Checkout" });
  });

  it("masks sensitive fields for a screenshot with a style only, then puts the page back", () => {
    const window = page();
    input(window, "card").value = CARD;
    input(window, "card").setAttribute("style", "width: 10px;");
    expect(JSON.parse(evalIn(window, MASK_SENSITIVE_SCRIPT) as string)).toBeGreaterThanOrEqual(7);
    expect(input(window, "card").hasAttribute(MASKED_ATTRIBUTE)).toBe(true);
    expect(input(window, "search").hasAttribute(MASKED_ATTRIBUTE)).toBe(false);
    expect(input(window, "card").value).toBe(CARD);
    expect(input(window, "month").getAttribute("style")).toContain("transparent");
    evalIn(window, UNMASK_SENSITIVE_SCRIPT);
    expect(input(window, "card").hasAttribute(MASKED_ATTRIBUTE)).toBe(false);
    expect(input(window, "card").getAttribute("style")).toBe("width: 10px;");
    expect(input(window, "month").getAttribute("style")).toBeNull();
    expect(input(window, "card").value).toBe(CARD);
  });

  it("parses nothing from an error or a malformed answer", () => {
    expect(parseSensitiveValues({ isError: true, content: [{ type: "text", text: '["x"]' }] })).toEqual([]);
    expect(parseSensitiveValues({ content: [{ type: "text", text: "not json" }] })).toEqual([]);
    expect(parseSensitiveValues(null)).toEqual([]);
  });
});
