import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VoiceNoteChip } from "./ComposerControls";

describe("VoiceNoteChip", () => {
  it("records with cancel, a timer, a waveform and Send", () => {
    const html = renderToStaticMarkup(createElement(VoiceNoteChip, {
      seconds: 65,
      bars: Array.from({ length: 24 }, (_, i) => i / 24),
      sending: false,
      onCancel: () => {},
      onSend: () => {},
    }));
    expect(html).toContain('data-voice-note-chip="recording"');
    expect(html).toContain('aria-label="Cancel voice note"');
    expect(html).toContain('aria-label="Recording a voice note, 1:05"');
    expect(html).toContain('aria-label="Send voice note"');
    expect(html.match(/rounded-full bg-danger\/80/g)).toHaveLength(24);
  });

  it("shows a spinner while the clip uploads", () => {
    const html = renderToStaticMarkup(createElement(VoiceNoteChip, { seconds: 3, bars: [], sending: true, onCancel: () => {}, onSend: () => {} }));
    expect(html).toContain('data-voice-note-chip="sending"');
    expect(html).toContain('aria-label="Sending voice note…"');
  });
});
