// Slicing a recording into hits, like FL Studio's Slicex: find where each hit starts (a
// sudden jump in loudness), so each piece can become a drum sound.

const FRAME_SEC = 0.01; // loudness is measured every 10 ms
const MIN_GAP_SEC = 0.06; // two hits closer than this are one
const SILENCE_DB = -50; // quieter than this never starts a hit

// Where hits start, as sample indices (the first is 0 if the sound starts right away).
// `sensitivity` 0–1: higher finds more (softer) hits.
export function findOnsets(audio: Float32Array, sampleRate: number, sensitivity = 0.5): number[] {
  const hop = Math.max(1, Math.round(FRAME_SEC * sampleRate));
  const db: number[] = [];
  for (let i = 0; i < audio.length; i += hop) {
    let sum = 0;
    const end = Math.min(audio.length, i + hop);
    for (let j = i; j < end; j++) sum += audio[j] * audio[j];
    db.push(10 * Math.log10(sum / Math.max(1, end - i) + 1e-12));
  }
  // How much louder each frame is than the one before (only rises count).
  const rise = db.map((d, i) => (i === 0 ? 0 : Math.max(0, d - db[i - 1])));
  // A rise this many dB starts a hit: 12 dB at sensitivity 0 down to 3 dB at 1.
  const threshold = 12 - 9 * Math.max(0, Math.min(1, sensitivity));
  const minGap = Math.round(MIN_GAP_SEC / FRAME_SEC);
  const onsets: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < db.length; i++) {
    const startsLoud = i === 0 && db[0] > SILENCE_DB;
    if ((startsLoud || (rise[i] >= threshold && db[i] > SILENCE_DB)) && i - last >= minGap) {
      onsets.push(Math.max(0, (i - 1) * hop)); // a frame early: keep the attack
      last = i;
    }
  }
  return onsets;
}

// The pieces between onsets (start, end in samples).
export function slices(onsets: number[], length: number): { start: number; end: number }[] {
  const sorted = [...new Set(onsets)].filter((o) => o >= 0 && o < length).sort((a, b) => a - b);
  return sorted.map((start, i) => ({ start, end: sorted[i + 1] ?? length }));
}
