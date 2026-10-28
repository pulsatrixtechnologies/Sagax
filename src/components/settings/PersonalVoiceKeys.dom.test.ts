// @vitest-environment happy-dom
// #1098 (2026-10-28): Settings > Models and voice > My voice keys. The
// person's own keys: a saved key is never shown, only its last four
// characters; a solo server (404) shows nothing.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api }));

import { PersonalVoiceKeys } from "./PersonalVoiceKeys";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  fixture.api.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const NONE = { configured: false, last4: null };

describe("my voice keys in Settings", () => {
  it("shows nothing on a solo server (404)", async () => {
    fixture.api.mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));
    act(() => root.render(createElement(PersonalVoiceKeys)));
    await flush();
    expect(container.textContent).toBe("");
  });

  it("names the saved key by its last four characters, never the key", async () => {
    fixture.api.mockResolvedValue({ elevenlabs: { configured: true, last4: "abcd" }, fish: NONE, xai: NONE });
    act(() => root.render(createElement(PersonalVoiceKeys)));
    await flush();
    expect(container.textContent).toContain("Your own key: ElevenLabs");
    expect(container.textContent).toContain("Key ending in abcd is saved.");
    expect((container.querySelector('input[type="password"]') as HTMLInputElement).value).toBe("");
    expect(container.textContent).toContain("Remove");
  });

  it("saves a key for the chosen provider on the person's own route", async () => {
    fixture.api.mockResolvedValueOnce({ elevenlabs: NONE, fish: NONE, xai: NONE });
    act(() => root.render(createElement(PersonalVoiceKeys)));
    await flush();
    expect(container.textContent).toContain("None yet");
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "sk_my_voice_key_9999");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    fixture.api.mockResolvedValueOnce({ elevenlabs: { configured: true, last4: "9999" }, fish: NONE, xai: NONE });
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save")!;
    act(() => save.click());
    await flush();
    expect(fixture.api).toHaveBeenLastCalledWith("/api/me/voice-keys/elevenlabs", { method: "PUT", body: JSON.stringify({ key: "sk_my_voice_key_9999" }) });
    expect(container.textContent).toContain("Key ending in 9999 is saved.");
  });
});
