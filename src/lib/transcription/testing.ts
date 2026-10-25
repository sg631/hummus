// Node-only helpers for transcription tests: synthetic singing and room sounds.
// Not imported by the app.

export const RATE = 44100;

// A voice-ish tone: falling harmonics, following a MIDI pitch curve and a loudness curve.
export function synth(
  pitchAt: (t: number) => number | null,
  seconds: number,
  gainAt: (t: number) => number = () => 1
): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const midi = pitchAt(i / RATE);
    if (midi === null) continue;
    phase += (2 * Math.PI * 440 * 2 ** ((midi - 69) / 12)) / RATE;
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(h * phase) / h;
    out[i] = 0.2 * gainAt(i / RATE) * v;
  }
  return out;
}

// Seeded random numbers, so "random" test audio is identical on every run.
function seeded(seed: number): () => number {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

// Closer to a real voice than `synth`: slow random pitch wander (jitter, about ±10 cents),
// loudness wander (shimmer), a strong 2nd harmonic, and breath noise.
export function voice(
  pitchAt: (t: number) => number | null,
  seconds: number,
  seed = 1,
  gainAt: (t: number) => number = () => 1
): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(Math.round(seconds * RATE));
  let phase = 0;
  let jitter = 0;
  let shimmer = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const midi = pitchAt(t);
    jitter = jitter * 0.999 + (random() - 0.5) * 0.004;
    shimmer = shimmer * 0.999 + (random() - 0.5) * 0.004;
    const breath = (random() - 0.5) * 0.02;
    if (midi === null) {
      out[i] = breath * 0.3;
      continue;
    }
    phase += (2 * Math.PI * 440 * 2 ** ((midi + jitter - 69) / 12)) / RATE;
    let v = 0;
    for (let h = 1; h <= 10; h++) v += Math.sin(h * phase) * (h === 2 ? 0.9 : 1 / h);
    out[i] = 0.2 * gainAt(t) * (1 + shimmer) * v + breath;
  }
  return out;
}

// Steady background noise (a fan, room tone) mixed under the audio, plus mains hum.
export function withBackground(audio: Float32Array, level: number, seed = 9): Float32Array {
  const random = seeded(seed);
  const out = audio.slice();
  let brown = 0;
  for (let i = 0; i < out.length; i++) {
    brown = brown * 0.98 + (random() - 0.5) * 0.2; // low-heavy noise, like a fan
    const hum = 0.3 * Math.sin((2 * Math.PI * 100 * i) / RATE);
    out[i] += level * (brown + hum);
  }
  return out;
}

// An unpitched sound (a breath, a click, a chair) at `at` seconds.
export function withBurst(audio: Float32Array, at: number, seconds: number, level: number, seed = 5) {
  const random = seeded(seed);
  const out = audio.slice();
  const from = Math.round(at * RATE);
  for (let i = 0; i < seconds * RATE && from + i < out.length; i++) {
    out[from + i] += level * (random() - 0.5) * 2 * Math.sin((Math.PI * i) / (seconds * RATE));
  }
  return out;
}

// Quiet, breathy singing in a room: weak overtones, aspiration noise at `breath` times the
// voiced level (pulsing with the voice), and steady room noise `room` times a quiet room's.
export function breathyVoice(
  pitchAt: (t: number) => number | null,
  seconds: number,
  breath: number,
  room = 1,
  seed = 1
): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(Math.round(seconds * RATE));
  let phase = 0;
  let jitter = 0;
  let brown = 0;
  let aspiration = 0;
  for (let i = 0; i < out.length; i++) {
    const midi = pitchAt(i / RATE);
    jitter = jitter * 0.999 + (random() - 0.5) * 0.006;
    brown = brown * 0.98 + (random() - 0.5) * 0.2;
    const background = 0.0015 * room * brown;
    if (midi === null) {
      out[i] = background;
      continue;
    }
    phase += (2 * Math.PI * 440 * 2 ** ((midi + jitter - 69) / 12)) / RATE;
    let v = 0;
    for (let h = 1; h <= 8; h++) v += Math.sin(h * phase) / (h * h);
    aspiration = aspiration * 0.6 + (random() - 0.5) * 0.4;
    const pulse = 0.6 + 0.4 * Math.max(0, Math.sin(phase));
    out[i] = 0.01 * (v + breath * 3 * aspiration * pulse) + background;
  }
  return out;
}
