// Notes from the computer keyboard and MIDI keyboards: played on the selected track, and
// recorded into it while recording with Input set to Keys. The key layout and the
// one-note-at-a-time logic are in music/keyboard.ts.
//
//   setComputerKeys(true)        // the computer keyboard plays notes (its shortcuts pause)
//   await connectMidi()          // MIDI keyboards (the browser asks once)
//   startKeyCapture(takeStart, bpm); const notes = stopKeyCapture()   // recording
//
// Selected drum track: the note keys play its rows (A the first row, W the second…).
import * as Tone from 'tone';
import { liveAttack, liveDrum, liveGlide, liveRelease, liveReleaseAll } from '$lib/audio/live';
import { BASE_NOTE, MonoVoice, noteKeys, POLY_OCTAVE_KEYS, type KeyLayout, POLY_VELOCITY_KEYS, TakeBuilder, type VoiceEvent } from '$lib/music/keyboard';
import { isShiftKey, isSlideKey, shiftFromKeys } from '$lib/music/shift-keys';
import { secondsToTicks } from '$lib/music/time';
import type { MidiTrack, Note } from '$lib/music/types';
import { project, selectedTrack } from './project.svelte';

const SETTINGS_KEY = 'hum-daw:live-keys';

function loadSettings(): { computer: boolean; midi: boolean; layout: KeyLayout } {
  const defaults = { computer: false, midi: false, layout: 'compact' as KeyLayout };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

export const liveKeys = $state({
  computer: false, // the computer keyboard plays notes
  layout: (typeof localStorage === 'undefined' ? 'compact' : loadSettings().layout) as KeyLayout, // compact or piano (music/keyboard.ts)
  midi: false, // MIDI keyboards are connected (asked for)
  midiInputs: [] as string[], // their names
  midiError: '',
  octave: 0, // polyphonic tracks: Z / X move this (octaves from C4)
  velocity: 0.8, // polyphonic tracks: C / V change this
  shift: 0, // one-note tracks: the shift held now (semitones)
  slide: false,
  sounding: [] as number[] // pitches playing now (the piano roll's keys light up)
});

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ computer: liveKeys.computer, midi: liveKeys.midi, layout: liveKeys.layout }));
  } catch {
    // not remembered: fine
  }
}

// ---------- Recording ----------
let capture: { builder: TakeBuilder; takeStart: number; bpm: number } | null = null;
const tickNow = () => (capture ? secondsToTicks(Tone.immediate() - capture.takeStart, capture.bpm) : 0);

export function startKeyCapture(takeStart: number, bpm: number) {
  capture = { builder: new TakeBuilder(), takeStart, bpm };
}

// The notes played, and how long the take was (ticks).
export function stopKeyCapture(): { notes: Note[]; length: number } {
  if (!capture) return { notes: [], length: 0 };
  const length = Math.max(0, tickNow());
  const notes = capture.builder.finish(length);
  capture = null;
  lastMonoPitch = null;
  return { notes, length };
}

// ---------- Playing ----------
const mono = new MonoVoice();
const polyDown = new Map<string, number>(); // key (code or 'midi:60') → pitch, polyphonic tracks
let modifiers: string[] = []; // one-note tracks: shift keys held

function melodyTrack(): MidiTrack | undefined {
  const t = selectedTrack();
  return t?.kind === 'midi' ? t : undefined;
}

function setSounding() {
  liveKeys.sounding = mono.pitch !== null ? [mono.pitch, ...polyDown.values()] : [...polyDown.values()];
}

// What a one-note voice change does: play it, and record it.
function voice(track: MidiTrack, events: VoiceEvent[], velocity: number) {
  for (const e of events) {
    if (e.type === 'attack') {
      void liveAttack(project, track, e.pitch, velocity);
      if (capture) {
        closeMonoNote();
        capture.builder.on(e.pitch, velocity, tickNow());
        lastMonoPitch = e.pitch;
      }
    } else if (e.type === 'glide') {
      liveGlide(project, track, e.pitch, velocity);
      if (capture) {
        capture.builder.glide(e.pitch, tickNow());
        lastMonoPitch = e.pitch;
      }
    } else {
      liveRelease(project, track);
      closeMonoNote();
    }
  }
  setSounding();
}
let lastMonoPitch: number | null = null;
function closeMonoNote() {
  if (capture && lastMonoPitch !== null) capture.builder.off(lastMonoPitch, tickNow());
  lastMonoPitch = null;
}

function noteOn(key: string, pitch: number, velocity: number) {
  const track = melodyTrack();
  if (!track) return;
  if (track.poly) {
    void liveAttack(project, track, pitch, velocity);
    polyDown.set(key, pitch);
    capture?.builder.on(pitch, velocity, tickNow());
    setSounding();
  } else voice(track, mono.press(key, pitch), velocity);
}

function noteOff(key: string) {
  const track = melodyTrack();
  if (!track) return;
  const pitch = polyDown.get(key);
  if (pitch !== undefined) {
    polyDown.delete(key);
    liveRelease(project, track, pitch);
    capture?.builder.off(pitch, tickNow());
    setSounding();
  } else voice(track, mono.release(key), liveKeys.velocity);
}

export function allNotesOff() {
  const track = melodyTrack();
  if (track) voice(track, mono.releaseAll(), liveKeys.velocity);
  for (const [key] of polyDown) noteOff(key);
  liveReleaseAll();
  modifiers = [];
  liveKeys.shift = 0;
  liveKeys.slide = false;
  setSounding();
}

// ---------- The computer keyboard ----------

function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable], [role="dialog"], [role="menu"]');
}

function onDown(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
  if (!location.pathname.startsWith('/studio')) return; // the home page: typing isn't playing
  const t = selectedTrack();
  if (!t || t.kind === 'voice') return;
  const code = e.code;
  const NOTE_KEYS = noteKeys(liveKeys.layout);
  let handled = false;

  if (t.kind === 'drums') {
    const index = NOTE_KEYS[code];
    if (index !== undefined) {
      handled = true;
      if (!e.repeat && t.rows[index]) liveDrum(t.rows[index]);
    }
  } else if (t.poly) {
    if (code in NOTE_KEYS) {
      handled = true;
      if (!e.repeat) noteOn(code, BASE_NOTE + 12 * liveKeys.octave + NOTE_KEYS[code], liveKeys.velocity);
    } else if (code in POLY_OCTAVE_KEYS) {
      handled = true;
      if (!e.repeat) liveKeys.octave = Math.max(-4, Math.min(4, liveKeys.octave + POLY_OCTAVE_KEYS[code]));
    } else if (code in POLY_VELOCITY_KEYS) {
      handled = true;
      if (!e.repeat) liveKeys.velocity = Math.max(0.1, Math.min(1, Math.round((liveKeys.velocity + 0.1 * POLY_VELOCITY_KEYS[code]) * 10) / 10));
    }
  } else {
    if (code in NOTE_KEYS) {
      handled = true;
      if (!e.repeat) noteOn(code, BASE_NOTE + NOTE_KEYS[code], liveKeys.velocity);
    } else if (isShiftKey(code)) {
      handled = true;
      if (!e.repeat && !modifiers.includes(code)) {
        modifiers.push(code);
        updateShift(t);
      }
    }
  }
  if (handled) {
    e.preventDefault();
    e.stopImmediatePropagation(); // the piano roll's own letter shortcuts don't run
  }
}

function updateShift(track: MidiTrack) {
  liveKeys.shift = shiftFromKeys(modifiers);
  liveKeys.slide = modifiers.some(isSlideKey);
  voice(track, mono.setShift(liveKeys.shift, liveKeys.slide), liveKeys.velocity);
}

function onUp(e: KeyboardEvent) {
  const code = e.code;
  if (modifiers.includes(code)) {
    modifiers = modifiers.filter((c) => c !== code);
    const t = melodyTrack();
    if (t) updateShift(t);
    return;
  }
  if (code in noteKeys(liveKeys.layout)) noteOff(code);
}

// Compact (one octave, A–H then Q–Y) or piano (like a keyboard's keys).
export function setKeyLayout(layout: KeyLayout) {
  allNotesOff();
  liveKeys.layout = layout;
  saveSettings();
}

export function setComputerKeys(on: boolean) {
  liveKeys.computer = on;
  saveSettings();
  window.removeEventListener('keydown', onDown, true);
  window.removeEventListener('keyup', onUp, true);
  window.removeEventListener('blur', allNotesOff);
  if (on) {
    // Capture phase: before the piano roll's shortcuts see the note keys.
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', allNotesOff);
  } else allNotesOff();
}

// ---------- MIDI keyboards (Web MIDI) ----------

let access: MIDIAccess | null = null;

function onMidi(e: MIDIMessageEvent) {
  const [status, note, velocity] = e.data ?? [];
  const kind = status & 0xf0;
  const t = selectedTrack();
  if (t?.kind === 'drums') {
    // Drum pads / keys: from C (36 on most pads) the rows in order.
    if (kind === 0x90 && velocity > 0) {
      const row = t.rows[((note - 36) % 128 + 128) % 128];
      if (row) liveDrum(row);
    }
    return;
  }
  if (kind === 0x90 && velocity > 0) noteOn(`midi:${note}`, note, velocity / 127);
  else if (kind === 0x80 || (kind === 0x90 && velocity === 0)) noteOff(`midi:${note}`);
  else if (kind === 0xb0 && note === 123) allNotesOff(); // "all notes off"
}

function listen() {
  if (!access) return;
  const names: string[] = [];
  for (const input of access.inputs.values()) {
    input.onmidimessage = onMidi;
    names.push(input.name ?? 'MIDI keyboard');
  }
  liveKeys.midiInputs = names;
}

// Asks the browser for MIDI keyboards (once; it remembers). Plugging one in later works too.
export async function connectMidi(): Promise<boolean> {
  liveKeys.midiError = '';
  if (!('requestMIDIAccess' in navigator)) {
    liveKeys.midiError = "This browser doesn't support MIDI keyboards (Chrome and Edge do).";
    return false;
  }
  try {
    access = await navigator.requestMIDIAccess();
    access.onstatechange = listen;
    listen();
    liveKeys.midi = true;
    saveSettings();
    return true;
  } catch {
    liveKeys.midiError = 'MIDI access was blocked: allow it from the icon in the address bar.';
    return false;
  }
}

export function disconnectMidi() {
  if (access) for (const input of access.inputs.values()) input.onmidimessage = null;
  access = null;
  liveKeys.midi = false;
  liveKeys.midiInputs = [];
  saveSettings();
  allNotesOff();
}

// When the app opens: what was on last time.
export function initLiveKeys() {
  const saved = loadSettings();
  if (saved.computer) setComputerKeys(true);
  if (saved.midi) void connectMidi();
}
