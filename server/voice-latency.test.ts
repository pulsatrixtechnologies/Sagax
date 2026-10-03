// The server's stages of a call turn, logged under its utterance id
// (server/voice-latency.ts): ids and milliseconds, never the words.
import { describe, expect, it } from "vitest";

import { VoiceLatencyLog } from "./voice-latency.ts";

describe("VoiceLatencyLog", () => {
  it("logs one line per call turn at its first token: dispatch, engine (warm or cold) and the model", () => {
    let clock = 1_000;
    const lines: string[] = [];
    const log = new VoiceLatencyLog(() => clock, (line) => lines.push(line));
    log.received("t-1", "utt-00000001");
    clock += 12;
    log.mark("t-1", "dispatch");
    clock += 3;
    log.mark("t-1", "engine", { warm: true });
    clock += 640;
    log.mark("t-1", "firstToken");
    // a later delta of the same answer adds nothing
    log.mark("t-1", "firstToken");
    expect(lines).toEqual(["[voice-latency] utt=utt-00000001 received->dispatch 12ms dispatch->engine 3ms (warm) engine->first-token 640ms total 655ms"]);
    expect(log.current("t-1")).toBeUndefined();
  });

  it("names a cold start, times only call turns, and forgets a turn that never streamed", () => {
    let clock = 0;
    const lines: string[] = [];
    const log = new VoiceLatencyLog(() => clock, (line) => lines.push(line));
    // a turn that is not a call utterance: nothing is timed
    log.mark("t-2", "dispatch");
    log.mark("t-2", "firstToken");
    expect(lines).toEqual([]);
    log.received("t-1", "utt-00000002");
    log.mark("t-1", "dispatch");
    log.mark("t-1", "engine", { warm: false });
    clock += 2_600;
    log.mark("t-1", "firstToken");
    expect(lines[0]).toContain("(cold start)");
    log.received("t-1", "utt-00000003");
    log.settled("t-1");
    log.mark("t-1", "firstToken");
    expect(lines).toHaveLength(1);
  });
});
