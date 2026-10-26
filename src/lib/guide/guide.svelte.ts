// The guide: a first song, built one feature at a time over a backing track
// (guide/backing.ts), in its own project ("First song"). Steps are in guide/steps.ts;
// Intro.svelte is the black screen it starts from, GuideStage.svelte the studio as the
// guide shows it (only what's been introduced so far).
//
//   beginGuide()      // from the intro: make the project, go to the studio
//   resumeGuide()     // the studio opened in guide mode (after a click): music, then the step
//   nextStep()        // the step's Next button (steps move on by themselves otherwise)
//   leaveGuide()      // finished, or left: the full studio
//
// Where it is (step, project) is kept in this browser, so a reload carries on.
import { goto } from '$app/navigation';
import * as Tone from 'tone';
import { sync } from '$lib/audio/sync';
import { barTicks } from '$lib/music/time';
import { liveInput } from '$lib/state/live-input.svelte';
import { addMidiTrack, currentClip, project, selectedTrack, selection } from '$lib/state/project.svelte';
import { library, newProject } from '$lib/state/projects.svelte';
import { recorder } from '$lib/state/recorder.svelte';
import { recordingSettings, type RecordingSettings } from '$lib/state/settings.svelte';
import { transportActions, ui } from '$lib/state/ui.svelte';
import { view } from '$lib/state/view.svelte';
import type { Track } from '$lib/music/types';
import { alignStart, atNextBar, barSeconds, BACKING_BPM, fadeOutBacking, setCutoff, setLayers, startBacking, stopBacking, type Coverage } from './backing';
import { musicAt, newStepMemory, PARTS, STEPS, type Part } from './steps';

const KEY = 'hum-daw:guide';
const LOOP_BARS = 4;

interface Saved {
  done: boolean; // finished or skipped once: the intro doesn't open by itself again
  active: boolean;
  step: number;
  projectId: string | null;
  settings: RecordingSettings | null; // the recording settings from before the guide changed them
}

function load(): Saved {
  const empty: Saved = { done: false, active: false, step: 0, projectId: null, settings: null };
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(KEY) ?? 'null') };
  } catch {
    return empty;
  }
}

const saved = load();

export const guide = $state({
  active: saved.active,
  step: saved.step,
  projectId: saved.projectId,
  running: false, // the music is on and the step has started (else: "click to continue")
  hint: '', // replaces the step's hint for a moment (e.g. "nothing heard")
  moving: false, // going to the next step on the next bar
  intro: false // the intro screen is showing (Intro.svelte)
});
let settingsBefore = saved.settings;
let done = saved.done;

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ done, active: guide.active, step: guide.step, projectId: guide.projectId, settings: settingsBefore } satisfies Saved));
  } catch {
    // storage blocked: the guide still works, it just won't survive a reload
  }
}

export const guideSeen = () => done;

// What's on screen at a step: every reveal so far, minus what was hidden since.
export function partsAt(step: number): Set<Part> {
  const shown = new Set<Part>();
  for (const s of STEPS.slice(0, step + 1)) {
    for (const p of s.reveal ?? []) shown.add(p);
    for (const p of s.hide ?? []) shown.delete(p);
  }
  if (step >= STEPS.length - 1) for (const p of PARTS) shown.add(p);
  return shown;
}

export const currentStep = () => STEPS[Math.min(guide.step, STEPS.length - 1)];

// ---------- The music, and the song in time with it ----------

const playable = (t: Track) => !t.mute && (!project.tracks.some((x) => x.solo) || t.solo);
const hasNotes = (t: Track) =>
  t.kind === 'drums' ? t.patterns.some((p) => Object.values(p.steps).some((s) => s.some(Boolean))) : t.kind === 'midi' ? t.clips.some((c) => c.notes.length) : t.clips.length > 0;

// What the song is playing right now that the backing can leave out.
function coverage(): Coverage {
  if (!ui.playing && !recorder.recording) return { drums: false, harmony: false };
  const sel = selectedTrack();
  const heard = (view.play === 'song' ? project.tracks : sel ? [sel] : []).filter((t) => playable(t) && hasNotes(t));
  return {
    drums: heard.some((t) => t.kind === 'drums'),
    harmony: heard.some((t) => t.kind === 'midi' && !!t.poly)
  };
}

function startMusic() {
  void startBacking({ cutoff: cutoffBefore(guide.step), covered: coverage, bpm: () => project.bpm || BACKING_BPM, layers: musicAt(guide.step) });
  sync.startAt = (lead, tick) => alignStart(lead, tick, barTicks(project.timeSignature));
}

function cutoffBefore(step: number) {
  for (let i = step; i >= 0; i--) if (STEPS[i].cutoff) return STEPS[i].cutoff!;
  return 300;
}

// Waits until an audio-clock time.
const until = (time: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, (time - Tone.getContext().currentTime) * 1000)));

// ---------- What steps do ----------

// Loop-records the melody track for `passes` times round the loop, then stops (on the
// loop's end). True if any notes were heard. One pass keeps the take re-quantizable.
export async function loopRecord(passes: number): Promise<boolean> {
  const track = project.tracks.find((t) => t.kind === 'midi');
  if (!track) return false;
  const mine = epoch;
  selection.trackId = track.id;
  view.play = 'pattern';
  if (recorder.recording) await transportActions.toggleRecord();
  transportActions.stop();
  await transportActions.toggleRecord();
  if (!recorder.recording) return false;
  const loopSec = LOOP_BARS * barSeconds();
  // One pass: stop just before the loop comes round (a single take); more: just after.
  await until(recorder.takeStart + passes * loopSec + (passes > 1 ? 0.06 : -0.04));
  if (!recorder.recording || !guide.active || mine !== epoch) return false;
  await transportActions.toggleRecord();
  if (track.kind !== 'midi') return false;
  const clip = currentClip(track);
  clip.duration = Math.max(clip.duration, LOOP_BARS * barTicks(project.timeSignature)); // keeps the loop four bars
  const heard = clip.notes.length > 0;
  if (heard) await playLoop();
  return heard;
}

// The selected track's clip on a loop (Pattern), or the song (Song), starting on the beat.
export async function playLoop() {
  await playAs('pattern');
}
export async function playSong() {
  await playAs('song');
}
async function playAs(mode: 'song' | 'pattern', again = false) {
  if (recorder.recording) return;
  if (ui.playing && view.play === mode && !again) return;
  transportActions.stop();
  view.play = mode;
  await transportActions.play();
}
// Starts playing again (lined up with the backing), e.g. after the tempo changed.
export async function restartPlaying(mode: 'song' | 'pattern') {
  await playAs(mode, true);
}

// ---------- Going through it ----------

let watching: (() => void) | null = null;
let epoch = 0; // counts step starts: a step's unfinished work checks it's still its turn
export const currentEpoch = () => epoch;

// Starts the current step: its music, what it does, and watching for it to be done.
async function enterStep(crash = true) {
  epoch++;
  newStepMemory();
  guide.hint = '';
  const step = currentStep();
  setCutoff(cutoffBefore(guide.step), 2);
  setLayers(musicAt(guide.step), crash);
  // The first take leans quietly towards C major's notes (the backing's, as A minor), so
  // a first melody fits. Not shown anywhere; gone from the next step.
  if (step.id === 'sing') recordingSettings.take.notes.scaleBias = { pitchClasses: [0, 2, 4, 5, 7, 9, 11], cents: 25 };
  else delete recordingSettings.take.notes.scaleBias;
  save();
  await step.enter?.();
}

function watch() {
  watching?.();
  watching = $effect.root(() => {
    $effect(() => {
      if (!guide.active || !guide.running || guide.moving) return;
      const step = currentStep();
      if (step.next || step.choices || !step.done?.()) return;
      nextStep();
    });
  });
}

// To a step, on the next bar line. A recording in progress stops first.
async function goToStep(index: number) {
  if (guide.moving) return;
  guide.moving = true;
  epoch++; // what the step was doing stops
  if (recorder.recording) await transportActions.toggleRecord();
  atNextBar(() => {
    guide.step = Math.max(0, Math.min(STEPS.length - 1, index));
    guide.moving = false;
    void enterStep();
  });
}

// On to the next step (Next, or the step's done), or back one (Previous). Whatever a
// skipped step would have set up stays as it is.
export function nextStep() {
  if (guide.moving) return;
  if (guide.step >= STEPS.length - 1) return void leaveGuide();
  void goToStep(guide.step + 1);
}
export function prevStep() {
  if (guide.step > 0) void goToStep(guide.step - 1);
}

// A step's choice: the step it names, or the next one.
export function choose(to?: string) {
  const index = to ? STEPS.findIndex((s) => s.id === to) : -1;
  void goToStep(index >= 0 ? index : guide.step + 1);
}

// The intro's Begin: a new project for the guide, then the studio.
export async function beginGuide(): Promise<boolean> {
  await liveInput.start(); // the microphone prompt now, not in the middle of the music
  if (!liveInput.listening) return false;
  settingsBefore = $state.snapshot(recordingSettings) as RecordingSettings;
  Object.assign(recordingSettings, { countInBars: 1, metronome: false, playAlong: true, loopBars: LOOP_BARS, overdub: true, input: 'voice', punch: false });
  await newProject('First song');
  Object.assign(project, { bpm: BACKING_BPM, timeSignature: [4, 4], key: 'A', scale: 'minor' });
  addMidiTrack('Melody');
  view.play = 'pattern';
  guide.projectId = library.currentId;
  guide.step = 0;
  guide.active = true;
  guide.running = false;
  save();
  startMusic();
  await goto(`/studio/${library.currentId}`);
  return true;
}

// The studio opened while the guide is on: music back on, and the step from the start.
export async function resumeGuide() {
  if (!guide.active || guide.running) return;
  if (!settingsBefore) settingsBefore = $state.snapshot(recordingSettings) as RecordingSettings;
  Object.assign(recordingSettings, { countInBars: 1, metronome: false, loopBars: LOOP_BARS, punch: false });
  startMusic();
  guide.running = true;
  watch();
  // Starts on a bar line, like everything else.
  atNextBar(() => void enterStep(false));
}

// The guide's page closed (home, another project): the music stops; it carries on next time.
export function pauseGuide() {
  if (!guide.running) return;
  guide.running = false;
  watching?.();
  watching = null;
  sync.startAt = null;
  stopBacking();
}

// Finished (or left): the music fades, the recording settings go back, the whole studio.
export async function leaveGuide() {
  if (recorder.recording) await transportActions.toggleRecord();
  guide.active = false;
  guide.running = false;
  guide.moving = false;
  done = true;
  watching?.();
  watching = null;
  delete recordingSettings.take.notes.scaleBias;
  if (settingsBefore) Object.assign(recordingSettings, settingsBefore);
  settingsBefore = null;
  save();
  sync.startAt = null;
  await fadeOutBacking(1); // the guide's music stops with it
}

// Skipped from the intro: remembered, so it doesn't open by itself again.
export function skipGuide() {
  done = true;
  save();
}

// The intro (and the guide) again, from the menu. It plays music, so from the home page
// it opens in the studio. With a guide under way: back to it instead.
export async function openIntro() {
  if (guide.active && guide.projectId) return continueGuide();
  if (!location.pathname.startsWith('/studio')) await goto('/studio');
  guide.intro = true;
}

// Back to the guide where it was left (its song, its step).
export async function continueGuide() {
  if (!guide.projectId) return;
  if (!library.list.some((p) => p.id === guide.projectId)) {
    // Its song was deleted: the guide can't carry on.
    guide.active = false;
    guide.projectId = null;
    save();
    return;
  }
  await goto(`/studio/${guide.projectId}`);
}

export const backingBarSeconds = barSeconds;
