// The live call's pure rules: the state machine (barge-in, cancellation,
// hold, mute), the turn detector (endpointing, adaptation, false starts),
// the echo guard and the sentence splitter that lets the first sentence be
// spoken while the rest is written.
import { describe, expect, it } from "vitest";

import { INITIAL_CALL, step, type CallEffect, type CallEvent, type CallState } from "./call-machine";
import { EchoGuard } from "./echo";
import { FADE_MS } from "./player";
import { SentenceStream } from "./sentences";
import { BARGE_IN_CONFIRM_MS, BARGE_IN_START_MS, FRAME_MS, LONG_FRENCH_INCOMPLETE_CAP, LONG_FRENCH_QUIET_MS, PAUSE_PRESETS, SMART_TURN_EARLY, TurnDetector, completeClause, incompleteClause, semanticComplete, type TurnEvent } from "./turns";

function run(events: CallEvent[], from: CallState = INITIAL_CALL) {
  let state = from;
  const effects: CallEffect[] = [];
  for (const event of events) {
    const out = step(state, event);
    state = out.state;
    effects.push(...out.effects);
  }
  return { state, effects, types: effects.map((e) => e.type) };
}

const connected = run([{ type: "connected" }]).state;

describe("call state machine", () => {
  it("connects with an earcon and listens", () => {
    const out = run([{ type: "connected" }]);
    expect(out.state.phase).toBe("listening");
    expect(out.effects).toContainEqual({ type: "earcon", sound: "connected" });
  });

  it("a normal turn: hearing, end of speech finalizes, the words are sent, the bot thinks then speaks", () => {
    const out = run([
      { type: "speech-candidate" },
      { type: "speech-start" },
      { type: "speech-end" },
      { type: "utterance", text: " what time is it " },
      { type: "bot-busy", busy: true },
      { type: "bot-audio-start" },
    ], connected);
    expect(out.types).toEqual(["finalize-stt", "send"]);
    expect(out.effects).toContainEqual({ type: "send", text: "what time is it" });
    expect(out.state.phase).toBe("speaking");
    const done = run([{ type: "bot-busy", busy: false }, { type: "bot-audio-end" }], out.state);
    expect(done.state.phase).toBe("listening");
  });

  it("barge-in: the bot is ducked at the first voiced frame, stays ducked at speech-start, and is cut once the words are confirmed", () => {
    const speaking = run([{ type: "bot-busy", busy: true }, { type: "bot-audio-start" }], connected).state;
    const candidate = run([{ type: "speech-candidate" }], speaking);
    expect(candidate.types).toEqual(["duck"]);
    expect(candidate.state.phase).toBe("speaking");
    const pending = run([{ type: "speech-start" }], candidate.state);
    // a cough or a mm-hmm past 128 ms cancels nothing
    expect(pending.types).toEqual([]);
    expect(pending.state).toMatchObject({ phase: "hearing", botAudible: true, ducked: true, bargePending: true });
    const barged = run([{ type: "barge-in-confirm" }], pending.state);
    expect(barged.types).toEqual(["cancel-speech", "earcon", "interrupt-bot"]);
    expect(barged.state).toMatchObject({ phase: "interrupted", botAudible: false, ducked: false, bargePending: false });
    // the new words become the next turn
    const next = run([{ type: "speech-end" }, { type: "utterance", text: "no, the other one" }], barged.state);
    expect(next.effects).toContainEqual({ type: "send", text: "no, the other one" });
    expect(next.state.phase).toBe("thinking");
  });

  it("barge-in after the bot finished writing only drops its remaining speech", () => {
    const speaking = run([{ type: "bot-busy", busy: false }, { type: "bot-audio-start" }], connected).state;
    const barged = run([{ type: "speech-candidate" }, { type: "speech-start" }, { type: "barge-in-confirm" }], speaking);
    expect(barged.types).toEqual(["duck", "cancel-speech", "earcon"]);
    expect(barged.types).not.toContain("interrupt-bot");
  });

  it("a mm-hmm or a long cough over the bot: ducked past speech-start, then rejected, unducked, the answer goes on", () => {
    const speaking = run([{ type: "bot-busy", busy: true }, { type: "bot-audio-start" }], connected).state;
    const out = run([{ type: "speech-candidate" }, { type: "speech-start" }, { type: "speech-end" }, { type: "utterance-rejected", reason: "empty" }], speaking);
    expect(out.types).toEqual(["duck", "finalize-stt", "unduck"]);
    expect(out.types).not.toContain("cancel-speech");
    expect(out.types).not.toContain("interrupt-bot");
    expect(out.state).toMatchObject({ phase: "speaking", botAudible: true, ducked: false, bargePending: false });
    // the detector's own cancel unducks the same way
    const cancelled = run([{ type: "speech-candidate" }, { type: "speech-start" }, { type: "speech-cancel" }], speaking);
    expect(cancelled.types).toEqual(["duck", "unduck", "cancel-stt"]);
    expect(cancelled.state).toMatchObject({ phase: "speaking", bargePending: false });
  });

  it("short words over the bot that end before the confirmation still cut it before they are sent", () => {
    const speaking = run([{ type: "bot-busy", busy: true }, { type: "bot-audio-start" }], connected).state;
    const out = run([{ type: "speech-candidate" }, { type: "speech-start" }, { type: "speech-end" }, { type: "utterance", text: "stop" }], speaking);
    expect(out.types).toEqual(["duck", "finalize-stt", "cancel-speech", "earcon", "interrupt-bot", "send"]);
    expect(out.state).toMatchObject({ phase: "thinking", botAudible: false, bargePending: false });
  });

  it("a confirmation with nothing pending, or after the bot went quiet, cuts nothing", () => {
    expect(run([{ type: "barge-in-confirm" }], connected).types).toEqual([]);
    const speaking = run([{ type: "bot-busy", busy: true }, { type: "bot-audio-start" }], connected).state;
    const quiet = run([{ type: "speech-candidate" }, { type: "speech-start" }, { type: "bot-audio-end" }, { type: "barge-in-confirm" }], speaking);
    expect(quiet.types).toEqual(["duck"]);
    expect(quiet.state.bargePending).toBe(false);
  });

  it("a cough over the bot: ducked, then restored, nothing cancelled", () => {
    const speaking = run([{ type: "bot-audio-start" }], connected).state;
    const out = run([{ type: "speech-candidate" }, { type: "speech-cancel" }], speaking);
    expect(out.types).toEqual(["duck", "unduck", "cancel-stt"]);
    expect(out.state).toMatchObject({ phase: "speaking", ducked: false, botAudible: true });
  });

  it("talking while the bot works (silent) does not stop its turn: the words join it", () => {
    const working = run([{ type: "bot-busy", busy: true }], connected).state;
    expect(working.phase).toBe("thinking");
    const out = run([{ type: "speech-candidate" }, { type: "speech-start" }], working);
    expect(out.types).toEqual([]);
    expect(out.state.phase).toBe("hearing");
    // and they are sent when the person stops
    const said = run([{ type: "speech-end" }, { type: "utterance", text: "and also the llama" }], out.state);
    expect(said.types).toEqual(["finalize-stt", "send"]);
  });

  it("duplex: talking while the bot works silently does not interrupt; the send forks or stops", () => {
    const working = run([{ type: "bot-busy", busy: true }], { ...connected, duplex: true }).state;
    expect(working.phase).toBe("thinking");
    expect(working.duplex).toBe(true);
    const out = run([{ type: "speech-candidate" }, { type: "speech-start" }], working);
    expect(out.types).toEqual([]);
    expect(out.state.phase).toBe("hearing");
    expect(out.types).not.toContain("interrupt-bot");
  });

  it("duplex: barge-in while speaking still cancels the voice and the turn", () => {
    const speaking = run([{ type: "bot-busy", busy: true }, { type: "bot-audio-start" }], { ...connected, duplex: true }).state;
    const barged = run([{ type: "speech-candidate" }, { type: "speech-start" }, { type: "barge-in-confirm" }], speaking);
    expect(barged.types).toEqual(["duck", "cancel-speech", "earcon", "interrupt-bot"]);
    expect(barged.state.phase).toBe("interrupted");
  });

  it("duplex: barge-in during speech does not kill background work", () => {
    const speaking = run([{ type: "bot-busy", busy: true }, { type: "bot-audio-start" }], { ...connected, duplex: true, backgroundWork: true }).state;
    const barged = run([{ type: "speech-candidate" }, { type: "speech-start" }, { type: "barge-in-confirm" }], speaking);
    expect(barged.types).toEqual(["duck", "cancel-speech", "earcon"]);
    expect(barged.types).not.toContain("interrupt-bot");
    expect(barged.state.phase).toBe("interrupted");
  });

  it("duplex: talking while background work runs does not interrupt-bot", () => {
    const working = run([{ type: "bot-busy", busy: true }], { ...connected, duplex: true, backgroundWork: true }).state;
    const out = run([{ type: "speech-candidate" }, { type: "speech-start" }], working);
    expect(out.types).not.toContain("interrupt-bot");
    expect(out.state.phase).toBe("hearing");
  });

  it("another voice (Only my voice) is dropped with a soft earcon and the bot resumes", () => {
    const speaking = run([{ type: "bot-audio-start" }], connected).state;
    const out = run([{ type: "speech-candidate" }, { type: "utterance-rejected", reason: "other-voice" }], speaking);
    expect(out.types).toEqual(["duck", "earcon", "unduck"]);
    expect(out.state.phase).toBe("speaking");
  });

  it("an empty transcript is no turn", () => {
    const out = run([{ type: "speech-start" }, { type: "speech-end" }, { type: "utterance", text: "   " }], connected);
    expect(out.types).not.toContain("send");
    expect(out.state.phase).toBe("listening");
  });

  it("hold silences both ways; resume reopens the microphone", () => {
    const speaking = run([{ type: "bot-audio-start" }], connected).state;
    const held = run([{ type: "hold" }], speaking);
    expect(held.types).toEqual(["cancel-speech", "cancel-stt", "mic", "earcon"]);
    expect(held.state.phase).toBe("held");
    // nothing is heard on hold
    expect(run([{ type: "speech-candidate" }, { type: "speech-start" }], held.state).types).toEqual([]);
    expect(run([{ type: "bot-audio-start" }], held.state).state.botAudible).toBe(false);
    const resumed = run([{ type: "resume" }], held.state);
    expect(resumed.effects).toEqual([{ type: "earcon", sound: "resume" }, { type: "mic", open: true }]);
    expect(resumed.state.phase).toBe("listening");
  });

  it("mute closes the microphone and drops a half-heard turn; the call goes on", () => {
    const hearing = run([{ type: "speech-start" }], connected).state;
    const muted = run([{ type: "mute", muted: true }], hearing);
    expect(muted.types).toEqual(["cancel-stt", "mic"]);
    expect(muted.state).toMatchObject({ muted: true, phase: "listening" });
    expect(run([{ type: "speech-start" }], muted.state).types).toEqual([]);
    expect(run([{ type: "mute", muted: false }], muted.state).effects).toEqual([{ type: "mic", open: true }]);
  });

  it("the interrupt button cancels speech without a new turn", () => {
    const speaking = run([{ type: "bot-busy", busy: true }, { type: "bot-audio-start" }], connected).state;
    const out = run([{ type: "interrupt" }], speaking);
    expect(out.types).toEqual(["cancel-speech"]);
    expect(out.state.phase).toBe("thinking");
  });

  it("ending the call stops everything and releases the devices", () => {
    const speaking = run([{ type: "bot-audio-start" }], connected).state;
    const out = run([{ type: "end" }, { type: "speech-start" }], speaking);
    expect(out.types).toEqual(["cancel-speech", "cancel-stt", "earcon", "release"]);
    expect(out.state.phase).toBe("ended");
  });
});

/** Feed probabilities as 32 ms frames; returns events with their times. */
function feed(detector: TurnDetector, frames: Array<{ p: number; n: number; level?: number; bot?: boolean; echo?: boolean }>) {
  const out: Array<TurnEvent & { at: number }> = [];
  let at = 0;
  for (const run of frames) {
    for (let i = 0; i < run.n; i++) {
      at += FRAME_MS;
      const event = detector.feed({ probability: run.p, level: run.level ?? 0.05, botAudible: run.bot, echo: run.echo });
      if (event) out.push({ ...event, at });
    }
  }
  return out;
}

const frames = (ms: number) => Math.round(ms / FRAME_MS);

describe("turn detection (endpointing)", () => {
  it("starts after about 200 ms of voice and ends after the endpoint of silence", () => {
    const detector = new TurnDetector();
    const events = feed(detector, [{ p: 0.02, n: 10 }, { p: 0.9, n: frames(1500) }, { p: 0.05, n: frames(1000) }]);
    expect(events.map((e) => e.type)).toEqual(["candidate", "start", "end"]);
    const speechEnd = 10 * FRAME_MS + frames(1500) * FRAME_MS;
    const end = events.find((e) => e.type === "end")!;
    expect(end.at - speechEnd).toBeGreaterThanOrEqual(600);
    expect(end.at - speechEnd).toBeLessThan(600 + FRAME_MS * 2);
  });

  it("a short pause inside a sentence does not end the turn", () => {
    const detector = new TurnDetector();
    const events = feed(detector, [{ p: 0.9, n: frames(800) }, { p: 0.1, n: frames(400) }, { p: 0.9, n: frames(800) }, { p: 0.1, n: frames(900) }]);
    expect(events.filter((e) => e.type === "end")).toHaveLength(1);
  });

  it("adapts: a person who pauses long inside sentences gets a longer endpoint, a fast talker a shorter one", () => {
    const thinker = new TurnDetector();
    for (let i = 0; i < 3; i++) feed(thinker, [{ p: 0.9, n: frames(700) }, { p: 0.1, n: frames(500) }, { p: 0.9, n: frames(700) }, { p: 0.1, n: frames(1200) }]);
    expect(thinker.endpointMs).toBeGreaterThan(600);
    expect(thinker.endpointMs).toBeLessThanOrEqual(900);
    const quick = new TurnDetector();
    for (let i = 0; i < 6; i++) feed(quick, [{ p: 0.9, n: frames(900) }, { p: 0.1, n: frames(1000) }]);
    expect(quick.endpointMs).toBeLessThan(600);
    expect(quick.endpointMs).toBeGreaterThanOrEqual(480);
  });

  it("a click or a cough is cancelled, never a turn", () => {
    const detector = new TurnDetector();
    const events = feed(detector, [{ p: 0.9, n: 3 }, { p: 0.05, n: 20 }]);
    expect(events.map((e) => e.type)).toEqual(["candidate", "cancel"]);
  });

  it("over the bot: a higher bar, and echo frames never count", () => {
    const detector = new TurnDetector();
    expect(feed(detector, [{ p: 0.6, n: 20, bot: true }])).toEqual([]);
    expect(feed(detector, [{ p: 0.95, n: 20, bot: true, echo: true }])).toEqual([]);
    const barge = feed(detector, [{ p: 0.95, n: 10, bot: true }]);
    expect(barge.map((e) => e.type)).toEqual(["candidate", "start"]);
    expect(barge[0]).toMatchObject({ bargeIn: true, at: FRAME_MS });
    // four frames: speech starts at 128 ms (the bot stays ducked); the cut
    // waits for the words, at worst 400 ms, silent 12 ms later
    expect(barge[1]).toMatchObject({ bargeIn: true, at: BARGE_IN_START_MS });
    expect(BARGE_IN_CONFIRM_MS + FADE_MS).toBe(412);
  });

  it("a three-frame cough over the bot ducks and does not cut", () => {
    const detector = new TurnDetector();
    const cough = feed(detector, [{ p: 0.95, n: 3, bot: true }, { p: 0.05, n: 4 }]);
    expect(cough.map((e) => e.type)).toEqual(["candidate", "cancel"]);
  });

  it("an unfinished clause waits longer before the turn ends", () => {
    const run = (said: string) => {
      const detector = new TurnDetector({ ...PAUSE_PRESETS.normal });
      feed(detector, [{ p: 0.9, n: frames(900) }]);
      detector.hint(said);
      const events = feed(detector, [{ p: 0.05, n: frames(2500) }]);
      return events.find((e) => e.type === "end")!.at;
    };
    const done = run("What is the weather in Montreal?");
    const cut = run("give me a good prompt to");
    expect(done).toBeLessThan(PAUSE_PRESETS.normal.endpointMs + FRAME_MS * 2);
    expect(cut - done).toBeGreaterThanOrEqual(PAUSE_PRESETS.normal.incompleteMs - FRAME_MS);
  });

  it("the pause preference sets the endpoint's range", () => {
    const detector = new TurnDetector({ ...PAUSE_PRESETS.normal });
    detector.setPause("patient");
    expect(detector.endpointMs).toBeGreaterThanOrEqual(PAUSE_PRESETS.patient.minEndpointMs);
    detector.setPause("short");
    expect(detector.endpointMs).toBeLessThanOrEqual(PAUSE_PRESETS.short.maxEndpointMs);
    expect(PAUSE_PRESETS.short.endpointMs).toBeLessThan(PAUSE_PRESETS.normal.endpointMs);
    expect(PAUSE_PRESETS.normal.endpointMs).toBeLessThan(PAUSE_PRESETS.patient.endpointMs);
  });

  it("far-field voice under the person's level is ignored once known", () => {
    const detector = new TurnDetector({ nearLevel: 0.08 });
    expect(feed(detector, [{ p: 0.95, n: 30, level: 0.01 }])).toEqual([]);
    expect(feed(detector, [{ p: 0.95, n: 10, level: 0.06 }]).map((e) => e.type)).toEqual(["candidate", "start"]);
  });
});

describe("an unfinished clause", () => {
  it("is one that stops on a conjunction, a preposition, a comma or after a word or two", () => {
    for (const text of ["give me a good prompt to", "the weather right now in", "and", "je voudrais que", "envoie-le à", "so I was thinking,", "the weather", "um", "What is two plus", "Can you remind me what", "Peux-tu me rappeler quel", "on y va pis", "c'est faque", "je vais chez", "le chemin de Montréal à", "what do you"]) {
      expect(incompleteClause(text), text).toBe(true);
    }
    for (const text of ["What is the weather in Montreal?", "Give me a good prompt.", "send it to Max right away", "quelle heure est-il", "", "how are you", "I want this", "where did you go yesterday", "those people over there left"]) {
      expect(incompleteClause(text), text).toBe(false);
    }
  });
});

describe("Québec French end of speech", () => {
  const turn16 = "Combien de temps pour aller de Montréal à Québec en voiture?";

  it("a short punctuated question still ends on the short complete window", () => {
    const detector = new TurnDetector({ ...PAUSE_PRESETS.normal });
    feed(detector, [{ p: 0.9, n: frames(900) }]);
    detector.hint("Quelle heure est-il?");
    const end = feed(detector, [{ p: 0.05, n: frames(400) }]).find((event) => event.type === "end");
    expect(end).toMatchObject({ type: "end", early: true, endpointMs: PAUSE_PRESETS.normal.completeMs });
    expect(end!.at).toBe(PAUSE_PRESETS.normal.completeMs);
  });

  it("a punctuated long French turn waits 512 ms of confident silence", () => {
    const detector = new TurnDetector({ ...PAUSE_PRESETS.normal });
    feed(detector, [{ p: 0.9, n: frames(900) }]);
    detector.hint(turn16);
    expect(feed(detector, [{ p: 0.05, n: frames(300) }]).some((event) => event.type === "end")).toBe(false);
    const detector2 = new TurnDetector({ ...PAUSE_PRESETS.normal });
    feed(detector2, [{ p: 0.9, n: frames(900) }]);
    detector2.hint(turn16);
    const end = feed(detector2, [{ p: 0.05, n: frames(800) }]).find((event) => event.type === "end");
    expect(end).toMatchObject({ type: "end", early: true, endpointMs: LONG_FRENCH_QUIET_MS });
    expect(end!.at).toBe(LONG_FRENCH_QUIET_MS);
    expect(end!.semantic).toBeUndefined();
  });

  it("a long French prefix still ending on à finishes inside the bench tail", () => {
    const prefix = "Combien de temps pour aller de Montréal à";
    expect(incompleteClause(prefix)).toBe(true);
    const detector = new TurnDetector({ ...PAUSE_PRESETS.normal });
    feed(detector, [{ p: 0.9, n: frames(900) }]);
    detector.hint(prefix);
    const end = feed(detector, [{ p: 0.05, n: frames(1600) }]).find((event) => event.type === "end");
    const cap = PAUSE_PRESETS.normal.endpointMs + LONG_FRENCH_INCOMPLETE_CAP;
    expect(end).toMatchObject({ type: "end", endpointMs: cap });
    expect(end!.at).toBeGreaterThanOrEqual(cap);
    expect(end!.at).toBeLessThan(cap + FRAME_MS);
    expect(cap).toBeLessThan(PAUSE_PRESETS.normal.endpointMs + PAUSE_PRESETS.normal.incompleteMs);
    expect(cap).toBeLessThanOrEqual(1200);
  });

  it("an English unfinished clause still waits the full extra", () => {
    const detector = new TurnDetector({ ...PAUSE_PRESETS.normal });
    feed(detector, [{ p: 0.9, n: frames(900) }]);
    detector.hint("What is two plus");
    const end = feed(detector, [{ p: 0.05, n: frames(2000) }]).find((event) => event.type === "end");
    expect(end!.endpointMs).toBe(PAUSE_PRESETS.normal.endpointMs + PAUSE_PRESETS.normal.incompleteMs);
  });

  it("an unpunctuated short question ends on the semantic window when faster end of turn is on", () => {
    expect(semanticComplete("quelle heure est il")).toBe(true);
    expect(semanticComplete("what time is it")).toBe(true);
    expect(semanticComplete("combien de temps pour aller")).toBe(false);
    expect(semanticComplete(turn16)).toBe(false);
    const detector = new TurnDetector({ ...PAUSE_PRESETS.normal });
    detector.setProsody(true);
    feed(detector, [{ p: 0.9, n: frames(900) }]);
    detector.hint("what time is it");
    const end = feed(detector, [{ p: 0.05, n: frames(400) }]).find((event) => event.type === "end");
    expect(end).toMatchObject({ type: "end", early: true, semantic: true, endpointMs: PAUSE_PRESETS.normal.completeMs });
    expect(end!.at).toBe(PAUSE_PRESETS.normal.completeMs);

    // French words without punctuation wait the long French quiet
    const french = new TurnDetector({ ...PAUSE_PRESETS.normal });
    french.setProsody(true);
    feed(french, [{ p: 0.9, n: frames(900) }]);
    french.hint("quelle heure est il");
    const frenchEnd = feed(french, [{ p: 0.05, n: frames(800) }]).find((event) => event.type === "end");
    expect(frenchEnd).toMatchObject({ type: "end", early: true, semantic: true, endpointMs: LONG_FRENCH_QUIET_MS });
    expect(frenchEnd!.at).toBe(LONG_FRENCH_QUIET_MS);

    const patient = new TurnDetector({ ...PAUSE_PRESETS.normal });
    feed(patient, [{ p: 0.9, n: frames(900) }]);
    patient.hint("quelle heure est il");
    expect(feed(patient, [{ p: 0.05, n: frames(400) }]).some((event) => event.type === "end")).toBe(false);
  });
});

describe("a Québec request cut by a pause (peux-tu regarder le billet... de CONTOSO)", () => {
  it("the meaning of short French words alone does not end the turn on the short window", () => {
    expect(semanticComplete("peux-tu regarder le billet")).toBe(true);
    const detector = new TurnDetector({ ...PAUSE_PRESETS.normal });
    detector.setProsody(true);
    feed(detector, [{ p: 0.9, n: frames(1200) }]);
    detector.hint("peux-tu regarder le billet");
    // a 400 ms pause before "de CONTOSO" is not the end
    expect(feed(detector, [{ p: 0.05, n: frames(400) }]).some((event) => event.type === "end")).toBe(false);
    feed(detector, [{ p: 0.9, n: frames(500) }]);
    detector.hint("peux-tu regarder le billet de CONTOSO");
    expect(feed(detector, [{ p: 0.05, n: frames(400) }]).some((event) => event.type === "end")).toBe(false);
  });
});

describe("xAI Smart Turn", () => {
  const spoken = (pause: keyof typeof PAUSE_PRESETS = "normal") => {
    const detector = new TurnDetector({ ...PAUSE_PRESETS[pause] });
    detector.setProsody(true);
    feed(detector, [{ p: 0.9, n: frames(900) }]);
    return detector;
  };
  const endAt = (detector: TurnDetector) => feed(detector, [{ p: 0.05, n: frames(3000) }]).find((event) => event.type === "end")!;

  it("absent: today's rules", () => {
    const detector = spoken();
    detector.hint("What time is it in Tokyo?");
    expect(endAt(detector)).toMatchObject({ early: true, endpointMs: PAUSE_PRESETS.normal.completeMs });
  });

  it("a confident end allows the early end; a doubtful one waits the endpoint", () => {
    const sure = spoken();
    sure.hint("What time is it in Tokyo?", SMART_TURN_EARLY);
    expect(endAt(sure)).toMatchObject({ early: true, endpointMs: PAUSE_PRESETS.normal.completeMs });
    const unsure = spoken();
    unsure.hint("What time is it in Tokyo?", 0.45);
    const end = endAt(unsure);
    expect(end.early).toBeUndefined();
    expect(end.endpointMs).toBe(PAUSE_PRESETS.normal.endpointMs);
    // the semantic and contour ends too
    const semantic = spoken();
    semantic.hint("what time is it", 0.5);
    expect(endAt(semantic).early).toBeUndefined();
  });

  it("far from done: the endpoint waits incompleteMs longer", () => {
    const detector = spoken();
    detector.hint("I need you to check the", 0.1);
    expect(endAt(detector).endpointMs).toBe(PAUSE_PRESETS.normal.endpointMs + PAUSE_PRESETS.normal.incompleteMs);
    const words = spoken();
    words.hint("I need the report for Montreal", 0.2);
    expect(endAt(words).endpointMs).toBe(PAUSE_PRESETS.normal.endpointMs + PAUSE_PRESETS.normal.incompleteMs);
    // the same words again without one (a final chunk): the confidence holds
    const same = spoken();
    same.hint("I need the report for Montreal", 0.2);
    same.hint("I need the report for Montreal.");
    expect(endAt(same).endpointMs).toBe(PAUSE_PRESETS.normal.endpointMs + PAUSE_PRESETS.normal.incompleteMs);
    // new words without a confidence: back to the rules alone
    const later = spoken();
    later.hint("I need the report", 0.2);
    later.hint("I need the report for Montreal");
    expect(endAt(later).endpointMs).toBe(PAUSE_PRESETS.normal.endpointMs);
  });
});

describe("echo guard", () => {
  it("learns the echo path and flags the bot's residue as echo", () => {
    const guard = new EchoGuard();
    let echoes = 0;
    for (let i = 0; i < 200; i++) {
      const playback = 0.1 + 0.05 * Math.sin(i / 3);
      if (guard.update(playback * 0.05, playback)) echoes += 1;
    }
    expect(echoes).toBeGreaterThan(190);
    expect(guard.estimate).toBeGreaterThan(0.03);
    expect(guard.estimate).toBeLessThan(0.08);
  });

  it("the person over the bot is clearly louder than the echo", () => {
    const guard = new EchoGuard();
    for (let i = 0; i < 100; i++) guard.update(0.005, 0.1);
    expect(guard.update(0.06, 0.1)).toBe(false);
  });

  it("nothing playing: nothing to guard", () => {
    expect(new EchoGuard().update(0.01, 0)).toBe(false);
  });

  it("a room louder than expected is learned within seconds", () => {
    const guard = new EchoGuard({ coupling: 0.05 });
    for (let i = 0; i < 150; i++) guard.update(0.06, 0.1);
    expect(guard.update(0.06, 0.1)).toBe(true);
  });

  it("speakerphone delay is echo; the person still starts a barge-in at 128 ms", () => {
    const guard = new EchoGuard();
    const played = 0.2;
    const residue = played * 0.05;
    // the burst, then the microphone eight frames (256 ms) later
    for (let i = 0; i < 8; i++) guard.update(0, played);
    for (let i = 0; i < 8; i++) guard.update(residue, 0);
    expect(guard.lagFrames).toBe(8);
    const detector = new TurnDetector();
    const echoed: TurnEvent[] = [];
    // the tail is still the burst, a few frames after playback has stopped
    for (let i = 0; i < 3; i++) {
      const echo = guard.update(residue, 0);
      expect(echo, `residue frame ${i + 1}`).toBe(true);
      const event = detector.feed({ probability: 0.95, level: residue, botAudible: true, echo });
      if (event) echoed.push(event);
    }
    expect(echoed).toEqual([]);
    const person = feed(detector, [{ p: 0.95, n: 4, level: 0.2, bot: true }]);
    expect(person.map((e) => e.type)).toEqual(["candidate", "start"]);
    expect(person[1]).toMatchObject({ bargeIn: true, at: BARGE_IN_START_MS });
  });
});

describe("sentences while the bot writes", () => {
  it("emits each sentence as soon as it is complete", () => {
    const stream = new SentenceStream();
    expect(stream.feed("Sure. I can")).toEqual(["Sure."]);
    expect(stream.feed("Sure. I can check the weather for")).toEqual([]);
    expect(stream.feed("Sure. I can check the weather for Montreal today! It is")).toEqual(["I can check the weather for Montreal today!"]);
    expect(stream.finish("Sure. I can check the weather for Montreal today! It is sunny.")).toEqual(["It is sunny."]);
  });

  it("does not cut decimals, abbreviations or initials", () => {
    const stream = new SentenceStream({ minChars: 1 });
    expect(stream.feed("It costs 3.50 dollars, e.g. a coffee with J. Smith. Then")).toEqual(["It costs 3.50 dollars, e.g. a coffee with J. Smith."]);
  });

  it("cuts a long first sentence at a comma to start speaking sooner", () => {
    const stream = new SentenceStream();
    const long = "Well, looking at everything you sent me this morning about the quarterly numbers and the budget review, I think";
    const out = stream.feed(long);
    expect(out).toHaveLength(1);
    expect(out[0]!.endsWith("budget review,")).toBe(true);
  });

  it("joins short later sentences so a list is not many requests", () => {
    const stream = new SentenceStream();
    expect(stream.feed("Here is the plan. Yes. Ok. ")).toEqual(["Here is the plan."]);
    expect(stream.finish("Here is the plan. Yes. Ok. ")).toEqual(["Yes. Ok."]);
  });

  it("skips code blocks and splits list items and paragraphs", () => {
    const stream = new SentenceStream({ minChars: 1 });
    const text = "Run this:\n```sh\nnpm test\n```\nThen check\n- the first result\n- the second result\n\nDone";
    const out = [...stream.feed(text), ...stream.finish(text)];
    expect(out.join(" | ")).not.toContain("npm test");
    // the list marker is for the eye: only the item is spoken
    expect(out).toContain("the first result");
    expect(out.join(" | ")).not.toContain("- ");
    expect(out.at(-1)).toBe("Done");
  });

  it("starts over when a new block of text begins", () => {
    const stream = new SentenceStream();
    stream.feed("First block is long enough. ");
    expect(stream.feed("New. ")).toEqual(["New."]);
  });
});

describe("a finished sentence ends sooner (docs/voice-mode-xai.md, Latency)", () => {
  const frames = (ms: number) => Math.round(ms / FRAME_MS);

  it("knows a sentence the recognizer closed", () => {
    expect(completeClause("What time is it in Tokyo?")).toBe(true);
    expect(completeClause("Can you remind me what my next meeting is?")).toBe(true);
    expect(completeClause("Quelle heure est-il à Montréal ?")).toBe(true);
    expect(completeClause("What time is it")).toBe(false);
    expect(completeClause("Thanks.")).toBe(false);
    expect(completeClause("Mr.")).toBe(false);
  });

  it("ends on the preset's short confident silence, never on an uncertain one, and does not adapt from it", () => {
    const detector = new TurnDetector();
    detector.setPause("normal");
    const before = detector.endpointMs;
    const start = feed(detector, [{ p: 0.9, n: frames(900) }]);
    expect(start.some((event) => event.type === "start")).toBe(true);
    detector.hint("What time is it in Tokyo?");
    const events = feed(detector, [{ p: 0.05, n: frames(400) }]);
    const end = events.find((event) => event.type === "end");
    expect(end).toMatchObject({ type: "end", early: true, endpointMs: PAUSE_PRESETS.normal.completeMs });
    expect(detector.endpointMs).toBe(before);

    // a complete punctuated sentence ends on silence even if the VAD is a breath
    const unsure = new TurnDetector();
    unsure.setPause("normal");
    feed(unsure, [{ p: 0.9, n: frames(900) }]);
    unsure.hint("What time is it in Tokyo?");
    const breath = feed(unsure, [{ p: 0.25, n: frames(300) }]).find((event) => event.type === "end");
    expect(breath).toMatchObject({ type: "end", early: true, endpointMs: PAUSE_PRESETS.normal.completeMs });

    // not a finished sentence: the full endpoint
    const open = new TurnDetector();
    open.setPause("normal");
    feed(open, [{ p: 0.9, n: frames(900) }]);
    open.hint("give me a good prompt");
    expect(feed(open, [{ p: 0.05, n: frames(400) }]).some((event) => event.type === "end")).toBe(false);

    // four stable words a speculative send guessed on are not a finished
    // sentence: the guess never shortens the endpoint
    const speculated = new TurnDetector();
    speculated.setPause("normal");
    feed(speculated, [{ p: 0.9, n: frames(900) }]);
    speculated.hint("How is the weather");
    expect(feed(speculated, [{ p: 0.05, n: frames(400) }]).some((event) => event.type === "end")).toBe(false);
  });

  it("a complete punctuated sentence ends after 200-300 ms of silence", () => {
    expect(PAUSE_PRESETS.normal.completeMs).toBeGreaterThanOrEqual(200);
    expect(PAUSE_PRESETS.normal.completeMs).toBeLessThanOrEqual(300);
    const detector = new TurnDetector({ ...PAUSE_PRESETS.normal });
    feed(detector, [{ p: 0.9, n: frames(900) }]);
    detector.hint("Quelle heure est-il?");
    const events = feed(detector, [{ p: 0.25, n: frames(300) }]);
    const end = events.find((event) => event.type === "end");
    expect(end).toMatchObject({ type: "end", early: true, endpointMs: PAUSE_PRESETS.normal.completeMs });
    expect(end!.at).toBeGreaterThanOrEqual(PAUSE_PRESETS.normal.completeMs);
    expect(end!.at).toBeLessThanOrEqual(PAUSE_PRESETS.normal.completeMs + FRAME_MS);
  });

  it("an incomplete clause is not cut by a 300 ms pause mid-sentence", () => {
    const detector = new TurnDetector({ ...PAUSE_PRESETS.normal });
    feed(detector, [{ p: 0.9, n: frames(900) }]);
    detector.hint("What is two plus");
    expect(feed(detector, [{ p: 0.05, n: frames(300) }]).some((event) => event.type === "end")).toBe(false);
    const resume = feed(detector, [{ p: 0.9, n: frames(400) }, { p: 0.05, n: frames(2000) }]);
    expect(resume.filter((event) => event.type === "end")).toHaveLength(1);
    const end = resume.find((event) => event.type === "end")!;
    expect((end as { early?: boolean }).early).toBeUndefined();
  });

  it("inSilence is true only while speaking through the endpoint pause", () => {
    const detector = new TurnDetector();
    detector.setPause("normal");
    expect(detector.inSilence).toBe(false);
    feed(detector, [{ p: 0.9, n: frames(900) }]);
    expect(detector.inSilence).toBe(false);
    feed(detector, [{ p: 0.05, n: 1 }]);
    expect(detector.inSilence).toBe(true);
  });

  it("speaks the first clause of an answer once it has about six words", () => {
    const stream = new SentenceStream();
    expect(stream.feed("The weather in Montreal is sunny today, with a high")).toEqual(["The weather in Montreal is sunny today,"]);
    // a short opening clause waits for more
    expect(new SentenceStream().feed("Well, it is sunny")).toEqual([]);
  });
});
