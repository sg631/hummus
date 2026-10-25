// Listens to the shift keys (music/shift-keys.ts) while recording: shows the current
// shift, and keeps when it changed so the take's notes can be moved afterwards.
//
//   startShiftKeys(takeStart)   // takeStart: AudioContext time of the take's time 0
//   const changes = stopShiftKeys()
import * as Tone from 'tone';
import { isShiftKey, isSlideKey, shiftFromKeys, type ShiftChange } from '$lib/music/shift-keys';

export const shiftKeys = $state({
  active: false,
  shift: 0, // semitones, from the keys held now
  slide: false // the slide key (`) is held
});

let held: string[] = [];
let changes: ShiftChange[] = [];
let takeStart = 0;

function update() {
  shiftKeys.slide = held.some(isSlideKey);
  const shift = shiftFromKeys(held);
  if (shift === shiftKeys.shift) return;
  shiftKeys.shift = shift;
  changes.push({ time: Tone.immediate() - takeStart, shift, slide: shiftKeys.slide });
}

function onDown(e: KeyboardEvent) {
  if (!isShiftKey(e.code) || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault(); // and other shortcuts don't run (V, −…)
  e.stopImmediatePropagation();
  if (!e.repeat && !held.includes(e.code)) held.push(e.code);
  update();
}

function onUp(e: KeyboardEvent) {
  if (!held.includes(e.code)) return;
  held = held.filter((c) => c !== e.code);
  update();
}

// Switching windows loses key-ups: let go of everything.
function onBlur() {
  held = [];
  update();
}

export function startShiftKeys(startTime: number) {
  takeStart = startTime;
  held = [];
  changes = [];
  shiftKeys.shift = 0;
  shiftKeys.active = true;
  // Capture phase: before the piano roll's own shortcuts see these keys.
  window.addEventListener('keydown', onDown, true);
  window.addEventListener('keyup', onUp, true);
  window.addEventListener('blur', onBlur);
}

export function stopShiftKeys(): ShiftChange[] {
  window.removeEventListener('keydown', onDown, true);
  window.removeEventListener('keyup', onUp, true);
  window.removeEventListener('blur', onBlur);
  shiftKeys.active = false;
  shiftKeys.shift = 0;
  shiftKeys.slide = false;
  held = [];
  return changes;
}
