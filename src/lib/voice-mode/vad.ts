// Silero VAD v5 (MIT, models/NOTICE.txt): the probability that a 32 ms frame
// of 16 kHz audio holds a human voice. A neural detector, unlike an energy
// threshold, stays low for a fan, a keyboard, music or a dishwasher, so the
// call reacts to speech only (turns.ts decides turns from it).
import { createSession, type ModelSource, type OrtModule, type OrtSession } from "./onnx";

/** Samples per frame at 16 kHz (32 ms), the size v5 takes. */
export const VAD_FRAME = 512;
/** v5 keeps the last 64 samples of the previous frame as context. */
const CONTEXT = 64;

export interface VoiceProbability {
  /** One 512-sample frame (16 kHz, -1..1) in, a probability out. */
  probability(frame: Float32Array): Promise<number>;
  reset(): void;
}

export class SileroVad implements VoiceProbability {
  private state: Float32Array = new Float32Array(2 * 128);
  private context: Float32Array = new Float32Array(CONTEXT);
  private readonly input = new Float32Array(CONTEXT + VAD_FRAME);
  private busy: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly ort: OrtModule,
    private readonly session: OrtSession,
  ) {}

  static async load(ort: OrtModule, model: ModelSource["model"]): Promise<SileroVad> {
    return new SileroVad(ort, await createSession(ort, model));
  }

  reset(): void {
    this.state = new Float32Array(2 * 128);
    this.context = new Float32Array(CONTEXT);
  }

  /** Frames are processed one after the other (the model is recurrent). */
  probability(frame: Float32Array): Promise<number> {
    const run = this.busy.then(() => this.run(frame));
    this.busy = run.catch(() => {});
    return run;
  }

  private async run(frame: Float32Array): Promise<number> {
    if (frame.length !== VAD_FRAME) throw new Error(`a VAD frame is ${VAD_FRAME} samples`);
    this.input.set(this.context, 0);
    this.input.set(frame, CONTEXT);
    const { Tensor } = this.ort;
    const out = await this.session.run({
      input: new Tensor("float32", this.input.slice(), [1, CONTEXT + VAD_FRAME]),
      state: new Tensor("float32", this.state, [2, 1, 128]),
      sr: new Tensor("int64", BigInt64Array.from([16000n]), []),
    });
    this.state = new Float32Array(out.stateN!.data as Float32Array);
    this.context = frame.slice(VAD_FRAME - CONTEXT);
    return (out.output!.data as Float32Array)[0] ?? 0;
  }
}

/** Without the model (it failed to load): a level detector over the room's
 * noise floor, the old endpointer's rule. Worse at noise, but the call works. */
export class LevelVad implements VoiceProbability {
  private floor = 0.004;

  async probability(frame: Float32Array): Promise<number> {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
    const level = Math.sqrt(sum / Math.max(1, frame.length));
    const threshold = Math.max(0.012, this.floor * 3);
    if (level < threshold) this.floor = this.floor * 0.95 + level * 0.05;
    return Math.max(0, Math.min(1, level / (threshold * 2)));
  }

  reset(): void {
    this.floor = 0.004;
  }
}
