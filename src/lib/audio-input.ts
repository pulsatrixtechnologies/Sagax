// The microphone this computer uses (Settings > Models and voice >
// Microphone). One choice for dictation, voice notes and calls. A device id
// only means something on the computer that listed it, so the choice stays
// in this window's local storage and never travels with the person's
// preferences. A saved microphone that is unplugged falls back to the
// system default rather than failing the recording.
import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";

export const AUDIO_INPUT_KEY = "sagax.audioInput.v1";

export interface AudioInput {
  id: string;
  label: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The saved microphone, or undefined for the system default. */
export function preferredAudioInputId(): string | undefined {
  try {
    const value = storage()?.getItem(AUDIO_INPUT_KEY);
    return value && value !== "default" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Save the microphone (null or "default": the system default). */
export function setPreferredAudioInputId(id: string | null): void {
  try {
    const store = storage();
    if (!store) return;
    if (!id || id === "default") store.removeItem(AUDIO_INPUT_KEY);
    else store.setItem(AUDIO_INPUT_KEY, id);
  } catch {
    // no storage: the default stays in use
  }
  for (const listener of listeners) listener();
}

export function onPreferredAudioInputChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The audio constraints with the saved microphone added (exact). */
export function withPreferredInput(audio: MediaTrackConstraints, id = preferredAudioInputId()): MediaTrackConstraints {
  if (!id || audio.deviceId) return audio;
  return { ...audio, deviceId: { exact: id } };
}

function deviceMissing(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "OverconstrainedError" || name === "NotFoundError" || name === "NotReadableError";
}

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

function defaultGetUserMedia(): GetUserMedia {
  return (constraints) => navigator.mediaDevices.getUserMedia(constraints);
}

/** How long the system's permission prompt may stay unanswered before the
 * microphone is called unavailable (it can also sit behind another window). */
export const MICROPHONE_PROMPT_MS = 30_000;

/** The permission request got no answer: neither allowed nor refused. */
export class MicrophonePromptUnanswered extends Error {
  constructor() {
    super(t("microphone.promptUnanswered"));
    this.name = "MicrophonePromptUnanswered";
  }
}

/** The microphone, or MicrophonePromptUnanswered when the request stays
 * pending. A stream that arrives after the wait is released, not kept open. */
function withPromptTimeout(open: Promise<MediaStream>, ms: number): Promise<MediaStream> {
  return new Promise<MediaStream>((resolve, reject) => {
    let late = false;
    const timer = setTimeout(() => { late = true; reject(new MicrophonePromptUnanswered()); }, ms);
    open.then(
      (stream) => {
        clearTimeout(timer);
        if (late) { for (const track of stream.getTracks?.() ?? []) track.stop(); return; }
        resolve(stream);
      },
      (error) => { clearTimeout(timer); if (!late) reject(error); },
    );
  });
}

/** getUserMedia that retries once without the device when the saved one is
 * gone (unplugged, renamed by the system). Permission errors are not retried. */
export async function getUserMediaWithFallback(
  constraints: MediaStreamConstraints,
  getUserMedia: GetUserMedia = defaultGetUserMedia(),
  promptMs = MICROPHONE_PROMPT_MS,
): Promise<MediaStream> {
  try {
    return await withPromptTimeout(getUserMedia(constraints), promptMs);
  } catch (error) {
    const audio = constraints.audio;
    if (!deviceMissing(error) || !audio || typeof audio !== "object" || !audio.deviceId) throw error;
    const { deviceId: _dropped, ...rest } = audio;
    return withPromptTimeout(getUserMedia({ ...constraints, audio: rest }), promptMs);
  }
}

/** Opens the saved microphone (or the default) with these audio settings. */
export function openPreferredMicrophone(audio: MediaTrackConstraints, getUserMedia?: GetUserMedia): Promise<MediaStream> {
  return getUserMediaWithFallback({ audio: withPreferredInput(audio), video: false }, getUserMedia);
}

/** The audio inputs, without the browser's "default" and "communications"
 * aliases (the default is its own row). Labels are empty until the window
 * was granted the microphone once. */
export function audioInputsFrom(devices: readonly Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">[]): AudioInput[] {
  const seen = new Set<string>();
  const inputs: AudioInput[] = [];
  for (const device of devices) {
    if (device.kind !== "audioinput") continue;
    if (!device.deviceId || device.deviceId === "default" || device.deviceId === "communications") continue;
    if (seen.has(device.deviceId)) continue;
    seen.add(device.deviceId);
    inputs.push({ id: device.deviceId, label: device.label.trim() });
  }
  return inputs;
}

export async function listAudioInputs(): Promise<AudioInput[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    return audioInputsFrom(await navigator.mediaDevices.enumerateDevices());
  } catch {
    return [];
  }
}

/** The list for the setting: refreshed on devicechange and after access is granted. */
export function useAudioInputs() {
  const [inputs, setInputs] = useState<AudioInput[]>([]);
  const [selected, setSelected] = useState<string | undefined>(() => preferredAudioInputId());
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setInputs(await listAudioInputs());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
    const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    const onChange = () => void refresh();
    devices?.addEventListener?.("devicechange", onChange);
    const off = onPreferredAudioInputChange(() => setSelected(preferredAudioInputId()));
    return () => {
      devices?.removeEventListener?.("devicechange", onChange);
      off();
    };
  }, [refresh]);

  /** Ask for the microphone once so the system gives the devices their names. */
  const revealNames = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      for (const track of stream.getTracks()) track.stop();
    } catch {
      // refused: the list keeps its generic names
    }
    await refresh();
  }, [refresh]);

  return {
    inputs,
    selected,
    loaded,
    namesHidden: inputs.length > 0 && inputs.every((input) => !input.label),
    select: (id: string | null) => setPreferredAudioInputId(id),
    refresh,
    revealNames,
  };
}
