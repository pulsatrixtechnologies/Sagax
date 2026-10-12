// Live-call microphone capture: an AudioWorklet loaded from an inline Blob
// URL (no extra file to serve from the bundle's origin). The processor
// gathers the render quantum into VAD-sized frames and posts them to the
// page. ScriptProcessor is the fallback when the worklet cannot load.
import { VAD_FRAME } from "./vad";

export const CAPTURE_WORKLET_NAME = "sagax-voice-capture";

export const CAPTURE_WORKLET_SOURCE = `class SagaxVoiceCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    var size = ${VAD_FRAME};
    if (options && options.processorOptions && options.processorOptions.frameSize) size = options.processorOptions.frameSize | 0;
    if (size < 1) size = ${VAD_FRAME};
    this.need = size;
    this.pending = new Float32Array(size);
    this.filled = 0;
  }
  process(inputs) {
    var input = inputs[0];
    var channel = input && input[0];
    if (!channel || !channel.length) return true;
    var offset = 0;
    while (offset < channel.length) {
      var take = Math.min(this.need - this.filled, channel.length - offset);
      this.pending.set(channel.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.need) {
        this.port.postMessage(this.pending.slice());
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(CAPTURE_WORKLET_NAME)}, SagaxVoiceCapture);
`;

export function captureWorkletUrl(): string {
  if (typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: "text/javascript" }));
  }
  return "data:text/javascript;charset=utf-8," + encodeURIComponent(CAPTURE_WORKLET_SOURCE);
}

export type VoiceCapture = {
  kind: "worklet" | "script";
  disconnect: () => void;
};

type CaptureNode = {
  port?: { onmessage: ((event: MessageEvent) => void) | null };
  onaudioprocess?: ((event: { inputBuffer: { getChannelData: (n: number) => Float32Array } }) => void) | null;
  connect(dest?: unknown): unknown;
  disconnect(): void;
};

export type CaptureContext = {
  sampleRate: number;
  destination: unknown;
  audioWorklet?: { addModule(url: string): Promise<void> };
  createScriptProcessor?(bufferSize: number, inputChannels: number, outputChannels: number): CaptureNode;
  createGain?(): { gain: { value: number }; connect(dest?: unknown): unknown; disconnect(): void };
};

export type CaptureSource = { connect(node: unknown): unknown };

export type AttachVoiceCaptureOptions = {
  bufferSize?: number;
  frameSize?: number;
  WorkletNode?: new (context: unknown, name: string, options?: unknown) => CaptureNode;
};

export async function attachVoiceCapture(
  context: CaptureContext,
  source: CaptureSource,
  onAudio: (frame: Float32Array) => void,
  options: AttachVoiceCaptureOptions = {},
): Promise<VoiceCapture> {
  const frameSize = options.frameSize ?? VAD_FRAME;
  const bufferSize = options.bufferSize ?? frameSize;
  const worklet = await tryWorklet(context, source, onAudio, frameSize, options.WorkletNode);
  if (worklet) return worklet;
  return attachScriptProcessor(context, source, onAudio, bufferSize);
}

async function tryWorklet(
  context: CaptureContext,
  source: CaptureSource,
  onAudio: (frame: Float32Array) => void,
  frameSize: number,
  WorkletNode: AttachVoiceCaptureOptions["WorkletNode"],
): Promise<VoiceCapture | null> {
  if (!context.audioWorklet?.addModule) return null;
  const url = captureWorkletUrl();
  try {
    await context.audioWorklet.addModule(url);
  } catch {
    return null;
  } finally {
    if (url.startsWith("blob:") && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
  }
  const Ctor = WorkletNode ?? (typeof AudioWorkletNode === "function"
    ? AudioWorkletNode as unknown as NonNullable<AttachVoiceCaptureOptions["WorkletNode"]>
    : undefined);
  if (!Ctor) return null;
  try {
    const node = new Ctor(context, CAPTURE_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      processorOptions: { frameSize },
    });
    if (node.port) {
      node.port.onmessage = (event) => {
        if (event.data instanceof Float32Array) onAudio(event.data);
      };
    }
    source.connect(node);
    const silent = context.createGain?.();
    if (silent) {
      silent.gain.value = 0;
      node.connect(silent);
      silent.connect(context.destination);
    } else {
      node.connect(context.destination);
    }
    return {
      kind: "worklet",
      disconnect: () => {
        node.disconnect();
        silent?.disconnect();
      },
    };
  } catch {
    return null;
  }
}

function attachScriptProcessor(
  context: CaptureContext,
  source: CaptureSource,
  onAudio: (frame: Float32Array) => void,
  bufferSize: number,
): VoiceCapture {
  if (!context.createScriptProcessor) throw new Error("no capture processor");
  const processor = context.createScriptProcessor(bufferSize, 1, 1);
  processor.onaudioprocess = (event) => onAudio(event.inputBuffer.getChannelData(0));
  source.connect(processor);
  processor.connect(context.destination);
  return { kind: "script", disconnect: () => processor.disconnect() };
}
