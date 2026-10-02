// The live call's pure rules: the state machine (barge-in, cancellation,
// hold, mute), the turn detector (endpointing, adaptation, false starts),
// the echo guard and the sentence splitter that lets the first sentence be
// spoken while the rest is written.
import { describe, expect, it } from "vitest";

import { INITIAL_CALL, step, type CallEffect, type CallEvent, type CallState } from "./call-machine";
import { EchoGuard } from "./echo";
import { SentenceStream } from "./sentences";
import { FRAME_MS, TurnDetector, type TurnEvent } from "./turns";

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

  it("barge-in: the bot is ducked at the first voiced frame, then cancelled and its running turn interrupted", () => {
    const speaking = run([{ type: "bot-busy", busy: true }, { type: "bot-audio-start" }], connected).state;
    const candidate = run([{ type: "speech-candidate" }], speaking);
    expect(candidate.types).toEqual(["duck"]);
    expect(candidate.state.phase).toBe("speaking");
    const barged = run([{ type: "speech-start" }], candidate.state);
    expect(barged.types).toEqual(["cancel-speech", "earcon", "interrupt-bot"]);
    expect(barged.state).toMatchObject({ phase: "interrupted", botAudible: false, ducked: false });
    // the new words become the next turn
    const next = run([{ type: "speech-end" }, { type: "utterance", text: "no, the other one" }], barged.state);
    expect(next.effects).toContainEqual({ type: "send", text: "no, the other one" });
    expect(next.state.phase).toBe("thinking");
  });

  it("barge-in after the bot finished writing only drops its remaining speech", () => {
    const speaking = run([{ type: "bot-busy", busy: false }, { type: "bot-audio-start" }], connected).state;
    const barged = run([{ type: "speech-candidate" }, { type: "speech-start" }], speaking);
    expect(barged.types).toEqual(["duck", "cancel-speech", "earcon"]);
    expect(barged.types).not.toContain("interrupt-bot");
  });

  it("a cough over the bot: ducked, then restored, nothing cancelled", () => {
    const speaking = run([{ type: "bot-audio-start" }], connected).state;
    const out = run([{ type: "speech-candidate" }, { type: "speech-cancel" }], speaking);
    expect(out.types).toEqual(["duck", "unduck", "cancel-stt"]);
    expect(out.state).toMatchObject({ phase: "speaking", ducked: false, botAudible: true });
  });

  it("talking while the bot works interrupts its turn", () => {
    const working = run([{ type: "bot-busy", busy: true }], connected).state;
    expect(working.phase).toBe("thinking");
    const out = run([{ type: "speech-candidate" }, { type: "speech-start" }], working);
    expect(out.types).toEqual(["interrupt-bot"]);
    expect(out.state.phase).toBe("interrupted");
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
    // confirmed within 160 ms of the first voiced frame
    expect(barge[1]!.at).toBeLessThanOrEqual(FRAME_MS * 5);
  });

  it("far-field voice under the person's level is ignored once known", () => {
    const detector = new TurnDetector({ nearLevel: 0.08 });
    expect(feed(detector, [{ p: 0.95, n: 30, level: 0.01 }])).toEqual([]);
    expect(feed(detector, [{ p: 0.95, n: 10, level: 0.06 }]).map((e) => e.type)).toEqual(["candidate", "start"]);
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
