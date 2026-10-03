import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot } from "@/state/store";
import { endCall } from "@/lib/call";
import { configureLiveMedia, resetLiveMedia, startLiveCall } from "@/lib/live-call-media";
import { LiveCallBar } from "./LiveCallBar";
import { LiveCallSettings } from "./LiveCallSettings";
import { LiveKeySetup } from "./LiveKeySetup";

const bot: Bot = {
  id: "atlas",
  threadId: "thread-atlas",
  name: "Atlas",
  title: "",
  description: "",
  notifications: true,
  color: "green",
  unread: false,
  modelSelection: { instanceId: "claude", model: "test" },
  messages: [],
};

const render = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(StoreProvider, null, element));

afterEach(() => {
  resetLiveMedia();
  endCall();
  vi.unstubAllGlobals();
});

describe("LiveCallBar", () => {
  it("renders nothing without a call", () => {
    expect(render(createElement(LiveCallBar, { bot }))).toBe("");
  });

  it("shows the hint when the window blocked the call's audio", async () => {
    vi.stubGlobal("window", { ogb: { speechStop: vi.fn(async () => {}) } });
    const track = { enabled: true, stop: () => {} };
    const peer = {
      ontrack: null as ((event: { track: unknown }) => void) | null,
      localDescription: { sdp: "v=0\r\n" },
      iceGatheringState: "complete",
      addTrack: () => {},
      createDataChannel: () => ({ readyState: "connecting", close: () => {} }),
      createOffer: async () => ({ type: "offer", sdp: "v=0\r\n" }),
      setLocalDescription: async () => {},
      close: () => {},
    };
    configureLiveMedia({
      getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream,
      createPeer: () => peer as unknown as RTCPeerConnection,
      // the session answer never comes: the call stays connecting
      request: () => new Promise(() => {}),
      playRemote: async () => { throw new Error("autoplay blocked"); },
    });
    void startLiveCall({ botId: bot.id, threadId: bot.threadId });
    await vi.waitFor(() => expect(peer.ontrack).not.toBeNull());
    peer.ontrack!({ track: {} });
    await vi.waitFor(() => expect(render(createElement(LiveCallBar, { bot }))).toContain("Click anywhere in the window to hear the call."));
  });

  it("shows the call's controls while this window connects", () => {
    vi.stubGlobal("window", { ogb: { speechStop: vi.fn(async () => {}) } });
    configureLiveMedia({ getUserMedia: () => new Promise<MediaStream>(() => {}) });
    void startLiveCall({ botId: bot.id, threadId: bot.threadId });
    const markup = render(createElement(LiveCallBar, { bot }));
    expect(markup).toContain("Live with Atlas · Connecting…");
    expect(markup).toContain('aria-label="Call settings"');
    expect(markup).toContain('aria-label="Mute"');
    expect(markup).toContain('aria-label="Hang up"');
  });

  it("takes clicks itself, inside the composer dock that lets them through", () => {
    // ChatView's composer dock is pointer-events-none so a blank band beside
    // its cards reaches the transcript; without its own auto the bar's
    // buttons would never receive a click.
    vi.stubGlobal("window", { ogb: { speechStop: vi.fn(async () => {}) } });
    configureLiveMedia({ getUserMedia: () => new Promise<MediaStream>(() => {}) });
    void startLiveCall({ botId: bot.id, threadId: bot.threadId });
    const markup = render(createElement(LiveCallBar, { bot }));
    expect(markup).toMatch(/^<div role="region"[^>]* class="pointer-events-auto /);
  });

  it("names the keyboard chords on the mute and hang-up buttons", () => {
    vi.stubGlobal("window", { ogb: { platform: "darwin", speechStop: vi.fn(async () => {}) } });
    configureLiveMedia({ getUserMedia: () => new Promise<MediaStream>(() => {}) });
    void startLiveCall({ botId: bot.id, threadId: bot.threadId });
    const markup = render(createElement(LiveCallBar, { bot }));
    expect(markup).toContain('title="Mute (⌘⇧M)"');
    expect(markup).toContain('aria-keyshortcuts="Meta+Shift+M"');
    expect(markup).toContain('title="Hang up (⌘⇧H)"');
    expect(markup).toContain('aria-keyshortcuts="Meta+Shift+H"');
  });
});

describe("LiveCallSettings", () => {
  it("offers voice, typed replies, idle minutes and the key, defaulting to 5 minutes", () => {
    const markup = render(createElement(LiveCallSettings, { onClose: vi.fn() }));
    expect(markup).toContain('aria-label="Call settings"');
    expect(markup).toContain("Marin (default)");
    expect(markup).toContain("Read replies to typed messages");
    expect(markup).toContain(`When this is off, messages you type during a call and the bot&#x27;s answers to them are not sent to OpenAI.`);
    expect(markup).toContain(`A Live call sends your voice to OpenAI, along with the chat&#x27;s recent messages, the bot&#x27;s answers and the details of any approval it asks for. The OpenAI key stays on your computer.`);
    expect(markup).toMatch(/<option value="5" selected="">5<\/option>/);
    expect(markup).toContain("Change key");
    // nothing to remove without a key
    expect(markup).not.toContain("Remove key");
    expect(markup).toMatch(/role="dialog" tabindex="-1"/);
  });

  it("takes focus when it opens, so Escape closes it", () => {
    const onClose = vi.fn();
    let tree!: ReactElement<{ ref: (node: unknown) => void; onKeyDown: (event: unknown) => void }>;
    function Capture() {
      tree = LiveCallSettings({ onClose }) as typeof tree;
      return tree;
    }
    render(createElement(Capture));
    const first = { focus: vi.fn() };
    const querySelector = vi.fn(() => first);
    tree.props.ref({ querySelector });
    expect(querySelector).toHaveBeenCalledWith("select, input, button");
    expect(first.focus).toHaveBeenCalledOnce();
    const stopPropagation = vi.fn();
    tree.props.onKeyDown({ key: "Escape", stopPropagation });
    expect(onClose).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });
});

describe("LiveKeySetup", () => {
  it("says what the key is for, in the app's language", () => {
    const markup = render(createElement(LiveKeySetup, { onSaved: vi.fn() }));
    expect(markup).toContain("Live calls use OpenAI GPT-Live");
    // what leaves the computer, where Live is set up
    expect(markup).toContain(`A Live call sends your voice to OpenAI, along with the chat&#x27;s recent messages, the bot&#x27;s answers and the details of any approval it asks for. The OpenAI key stays on your computer.`);
    expect(markup).toContain('aria-label="OpenAI API key for Live calls"');
    expect(markup).toContain("Save and start the call");
    expect(render(createElement(LiveKeySetup, { onSaved: vi.fn(), compact: true }))).toContain(">Save<");
  });
});
