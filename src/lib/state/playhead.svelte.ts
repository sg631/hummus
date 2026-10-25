// Where playback is, in project ticks, for drawing the playhead. Tone's transport isn't
// $state, so while it runs this reads its position every screen frame
// (requestAnimationFrame, ~60 times a second) and copies it into `playhead.ticks`.
//
// `cursor` is where Play starts (and where Paste goes): set by clicking or dragging the
// piano roll's ruler (`seek`). Dragging it while playing jumps playback there.
//
//   startPlayhead()             // on Play
//   startPlayhead(countInTicks) // while recording: project tick 0 is after the count-in
//   stopPlayhead()
//   seek(ticks)
import * as Tone from 'tone';

export const playhead = $state({
  running: false,
  ticks: 0, // project ticks; negative during a count-in
  cursor: 0, // where Play starts (project ticks)
  // Pattern mode: `ticks` count in this clip / pattern (of this track), not the song; for a
  // voice track's loop, from `origin` in the song. Null when playing the song.
  pattern: null as { trackId: string; clipId?: string; origin: number } | null
});

let frame = 0;
let offset = 0;

function update() {
  // Tone schedules a little ahead of what you hear; immediate() is "now" for your ears.
  playhead.ticks = Tone.getTransport().getTicksAtTime(Tone.immediate()) - offset;
  frame = requestAnimationFrame(update);
}

export function startPlayhead(offsetTicks = 0, pattern: typeof playhead.pattern = null) {
  playhead.pattern = pattern;
  cancelAnimationFrame(frame);
  offset = offsetTicks;
  playhead.running = true;
  update();
}

export function stopPlayhead() {
  cancelAnimationFrame(frame);
  playhead.running = false;
  playhead.pattern = null;
  playhead.ticks = playhead.cursor;
}

// Moves the start position; while playing (not recording: offset 0), playback jumps there.
export function seek(ticks: number) {
  playhead.cursor = Math.max(0, Math.round(ticks));
  if (playhead.running && offset === 0 && !playhead.pattern) Tone.getTransport().ticks = playhead.cursor;
  if (!playhead.running) playhead.ticks = playhead.cursor;
}
