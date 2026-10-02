// "Only my voice": the call accepts a turn only when it sounds like the
// person who enrolled on this computer. A speaker embedding model (3D-Speaker
// CAM++, Apache-2.0, int8, about 9 MB; models/NOTICE.txt) turns a few seconds
// of speech into a 512-number voiceprint; two recordings of the same person
// are close (cosine similarity), two people are not.
//
// The voiceprint is computed and kept on this computer only (localStorage,
// never in the preferences that travel to a server, never sent anywhere), and
// "Forget my voice" deletes it. Without an enrollment the check is off.
import { fbank, meanNormalize } from "./fbank";
import { createSession, type ModelSource, type OrtModule, type OrtSession } from "./onnx";

/** Similarity at or over which a turn is the enrolled person. Measured on
 * the fixtures (speaker-id.test.ts): same person 0.55 and up, others 0.43
 * and under on three-second clips. */
export const SAME_SPEAKER = 0.5;
/** Shorter turns carry less of a voice: a lower bar ("yes", "stop"). */
export const SAME_SPEAKER_SHORT = 0.38;
/** Below this much speech the turn is too short to judge: accepted. */
export const MIN_VERIFY_SECONDS = 0.6;
const SHORT_SECONDS = 1.5;
const EMBED_DIM = 512;

export const VOICEPRINT_STORAGE_KEY = "omb.voiceCall.voiceprint.v1";

export interface Voiceprint {
  version: 1;
  /** unit-length mean embedding */
  vector: number[];
  /** clips it was made from */
  clips: number;
  /** the person's speaking level (RMS) during enrollment: far-field gate */
  level: number;
  createdAt: string;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function unit(vector: ArrayLike<number>): number[] {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += vector[i]! * vector[i]!;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vector, (value) => value / norm);
}

/** The voiceprint of several clips: the mean of their unit embeddings. */
export function voiceprintOf(embeddings: ArrayLike<number>[], level: number, now = new Date()): Voiceprint {
  if (!embeddings.length) throw new Error("no clip");
  const sum: number[] = Array.from({ length: embeddings[0]!.length }, () => 0);
  for (const embedding of embeddings) unit(embedding).forEach((value, i) => (sum[i] += value));
  return { version: 1, vector: unit(sum), clips: embeddings.length, level, createdAt: now.toISOString() };
}

export type Verdict = { accepted: boolean; similarity: number | null; reason: "match" | "other-voice" | "too-short" };

/** Judge one turn's embedding against the voiceprint. */
export function judge(voiceprint: Voiceprint, embedding: ArrayLike<number> | null, seconds: number): Verdict {
  if (!embedding || seconds < MIN_VERIFY_SECONDS) return { accepted: true, similarity: null, reason: "too-short" };
  const similarity = cosine(voiceprint.vector, embedding);
  const bar = seconds < SHORT_SECONDS ? SAME_SPEAKER_SHORT : SAME_SPEAKER;
  return { accepted: similarity >= bar, similarity, reason: similarity >= bar ? "match" : "other-voice" };
}

export class SpeakerEmbedder {
  private busy: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly ort: OrtModule,
    private readonly session: OrtSession,
  ) {}

  static async load(ort: OrtModule, model: ModelSource["model"]): Promise<SpeakerEmbedder> {
    return new SpeakerEmbedder(ort, await createSession(ort, model));
  }

  /** The embedding of 16 kHz speech (-1..1); null when too short. */
  embed(samples: Float32Array): Promise<Float32Array | null> {
    const run = this.busy.then(() => this.run(samples));
    this.busy = run.catch(() => {});
    return run;
  }

  private async run(samples: Float32Array): Promise<Float32Array | null> {
    const rows = meanNormalize(fbank(samples));
    if (rows.length < 20) return null;
    const input = new Float32Array(rows.length * 80);
    rows.forEach((row, i) => input.set(row, i * 80));
    const out = await this.session.run({ x: new this.ort.Tensor("float32", input, [1, rows.length, 80]) });
    const data = out.embedding!.data as Float32Array;
    return data.length === EMBED_DIM ? new Float32Array(data) : null;
  }
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readVoiceprint(store: Storage | null = storage()): Voiceprint | null {
  try {
    const raw = store?.getItem(VOICEPRINT_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Voiceprint;
    if (value?.version !== 1 || !Array.isArray(value.vector) || value.vector.length !== EMBED_DIM) return null;
    if (!value.vector.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return { ...value, level: typeof value.level === "number" && value.level > 0 ? value.level : 0 };
  } catch {
    return null;
  }
}

export function saveVoiceprint(voiceprint: Voiceprint, store: Storage | null = storage()): void {
  try {
    store?.setItem(VOICEPRINT_STORAGE_KEY, JSON.stringify(voiceprint));
  } catch {
    /* storage refused: enrollment lasts for this window only */
  }
}

export function forgetVoiceprint(store: Storage | null = storage()): void {
  try {
    store?.removeItem(VOICEPRINT_STORAGE_KEY);
  } catch {
    /* nothing to forget */
  }
}
