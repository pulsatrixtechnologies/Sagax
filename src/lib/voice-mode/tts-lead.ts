// Incremental TTS for the first clause of a streaming voice answer
// (issue #292). xAI's websocket starts audio on `text.delta` and waits
// for `text.done` at the end of the utterance. The first grok token is
// often one word: send it as a lead (delta only) so TTS TTFB overlaps
// the rest of that clause. Pure.

export type TtsLeadAction =
  | { action: "speak"; text: string }
  | { action: "begin"; text: string }
  | { action: "append"; text: string }
  | { action: "finish"; append?: string };

export function ttsLeadStep(input: {
  streaming: boolean;
  leadSent: string | null;
  emitted: string[];
  unconsumed: string;
}): { actions: TtsLeadAction[]; leadSent: string | null } {
  const emitted = input.emitted.filter((text) => text.trim());
  const unconsumed = input.unconsumed.trim();

  if (!input.streaming) {
    return {
      actions: emitted.map((text) => ({ action: "speak" as const, text })),
      leadSent: null,
    };
  }

  if (emitted.length) {
    const [first, ...rest] = emitted;
    const actions: TtsLeadAction[] = [];
    let leadSent = input.leadSent;
    if (leadSent !== null) {
      const append = finishAppend(leadSent, first!);
      actions.push(append ? { action: "finish", append } : { action: "finish" });
      leadSent = null;
    } else {
      actions.push({ action: "speak", text: first! });
    }
    for (const text of rest) actions.push({ action: "speak", text });
    return { actions, leadSent };
  }

  if (!unconsumed) return { actions: [], leadSent: input.leadSent };

  if (input.leadSent === null) {
    return { actions: [{ action: "begin", text: unconsumed }], leadSent: unconsumed };
  }

  const extra = growth(input.leadSent, unconsumed);
  if (!extra) return { actions: [], leadSent: input.leadSent };
  return { actions: [{ action: "append", text: extra }], leadSent: unconsumed };
}

function finishAppend(leadSent: string, clause: string): string | undefined {
  if (clause === leadSent) return undefined;
  if (clause.startsWith(leadSent)) return clause.slice(leadSent.length);
  // the clause was rewritten: send it as the last delta (the page already
  // opened the utterance on the old prefix)
  return clause.startsWith(leadSent.trim()) ? clause.slice(leadSent.length) : undefined;
}

function growth(sent: string, next: string): string | undefined {
  if (next === sent) return undefined;
  if (next.startsWith(sent)) return next.slice(sent.length);
  return undefined;
}
