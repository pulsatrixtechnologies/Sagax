# Draws the notification tones of src/lib/notification-sound.ts (NOTIFICATION_TONES)
# into WAV files; then: afconvert -f caff -d LEI16 notify-<id>.wav ios/App/notify-<id>.caf
# Usage: python3 scripts/ios-notification-tones.py <out dir>
import math, struct, wave, sys
out = sys.argv[1]
TONES = {
  "tick": [(1900, 0, 0.04, 0.25)],
  "double-tick": [(1900, 0, 0.04, 0.25), (1900, 0.11, 0.04, 0.25)],
  "chime-a": [(880, 0, 0.45, 0.22), (1318.5, 0.14, 0.6, 0.18)],
  "chime-b": [(659.25, 0, 0.45, 0.22), (987.77, 0.14, 0.45, 0.18), (1318.5, 0.28, 0.7, 0.14)],
  "blip": [(520, 0, 0.12, 0.22), (780, 0.06, 0.14, 0.2)],
}
RATE = 44100
for name, notes in TONES.items():
    total = max(at + length + 0.03 for _, at, length, _ in notes) + 0.01
    n = int(total * RATE)
    buf = [0.0] * n
    for freq, at, length, peak in notes:
        # Web Audio: 0.0001 at start, exponential ramp to peak in 8 ms, exponential ramp to 0.0001 at start+length
        s0 = int((0.01 + at) * RATE)
        for i in range(int((length + 0.02) * RATE)):
            t = i / RATE
            if t < 0.008:
                g = 0.0001 * (peak / 0.0001) ** (t / 0.008)
            elif t < length:
                g = peak * (0.0001 / peak) ** ((t - 0.008) / (length - 0.008))
            else:
                g = 0.0001
            j = s0 + i
            if j < n: buf[j] += g * math.sin(2 * math.pi * freq * t)
    with wave.open(f"{out}/notify-{name}.wav", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v)) * 32767)) for v in buf))
