// The older call's ears: the macOS dictation helper (Speech.app, the solo
// Mac app only), half duplex (CallView.tsx). Voice mode's live call has its
// own full-duplex engine (call.ts).

export interface TranscriptLine {
  text?: string;
  partial?: boolean;
  error?: string;
}

export interface SpeechEndInfo {
  code: number | null;
  reason?: string;
}

export interface SpeechEngine {
  start(options: { endpointMs?: number }): Promise<void>;
  stop(): Promise<void>;
  onTranscript(cb: (line: TranscriptLine) => void): () => void;
  onEnd(cb: (info: SpeechEndInfo) => void): () => void;
}

/** The macOS dictation helper behind window.ogb. */
export const nativeSpeechEngine: SpeechEngine = {
  start: (options) => window.ogb?.speechStart?.(options) ?? Promise.reject(new Error("dictation unavailable")),
  stop: () => window.ogb?.speechStop?.() ?? Promise.resolve(),
  onTranscript: (cb) => window.ogb?.onSpeechTranscript?.(cb) ?? (() => {}),
  onEnd: (cb) => window.ogb?.onSpeechEnd?.(cb) ?? (() => {}),
};
