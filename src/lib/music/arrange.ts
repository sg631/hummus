// The playlist (arrangement): where clips play in the song.
//
// A clip's content (a melody clip's notes, a drum pattern's steps) is stored once, on its
// track. The playlist only holds placements: "this clip, from here, for this long". Copying
// a block in the playlist adds a placement, not another copy of the notes, so a song made
// of a few repeated patterns stays small, and editing a clip changes every place it plays.
// ("Make unique" copies a clip when one place should differ.)
//
// A placement longer than its clip loops it; shorter cuts it off.
import { barTicks } from './time';
import type { DrumTrack, MidiTrack, Note, NoteClip, Placement, Project, Track, VoiceTrack } from './types';

// How long a clip's content lasts: whole bars, at least one.
export function contentLength(durationTicks: number, bar: number): number {
  return Math.max(bar, Math.ceil(durationTicks / bar) * bar);
}

// How long a placement plays: its own length if set, otherwise its content once.
export function placementLength(p: Placement, content: number): number {
  return p.length ?? content;
}

// A melody track's placements as plain clips on the timeline, one per repeat, notes cut
// off at the end of the placement: what the mixer plays and MIDI export writes.
export function expandPlacements(clips: NoteClip[], placements: Placement[], bar: number): NoteClip[] {
  const out: NoteClip[] = [];
  for (const p of placements) {
    const clip = clips.find((c) => c.id === p.clipId);
    if (!clip) continue;
    const content = contentLength(clip.duration, bar);
    const length = placementLength(p, content);
    for (let loop = 0, k = 0; loop < length; loop += content, k++) {
      const notes: Note[] = [];
      for (const n of clip.notes) {
        const start = loop + n.start;
        if (start < 0 || start >= length) continue;
        notes.push({ ...n, duration: Math.min(n.duration, length - start) });
      }
      out.push({ id: `${p.id}#${k}`, start: p.start + loop, duration: Math.min(content, length - loop), notes });
    }
  }
  return out;
}

// The placement playing at `tick`, if any (the latest-starting one, if they overlap).
export function placementAt(placements: Placement[], tick: number, lengthOf: (p: Placement) => number): Placement | undefined {
  let found: Placement | undefined;
  for (const p of placements) {
    if (tick >= p.start && tick < p.start + lengthOf(p) && (!found || p.start >= found.start)) found = p;
  }
  return found;
}

// The end of the arrangement (the last placement's end), in ticks.
export function arrangementEnd(placements: Placement[], lengthOf: (p: Placement) => number): number {
  return Math.max(0, ...placements.map((p) => p.start + lengthOf(p)));
}

// ---------- Playing part of the song ----------
// Both build a stand-in Project (tracks reuse the real clips and patterns: nothing copied
// but the small track objects) for the mixer to play from tick 0.

// Pattern mode: just one track's current clip (melody) or pattern (drums), from 0, once —
// played on a loop of `length` ticks. A voice track: its recordings within `loopBars` bars
// from the bar the playhead is in. Empty clips loop `loopBars` bars (room to record into).
export function patternProject(
  project: Project,
  trackId: string,
  cursor: number,
  loopBars: number
): { project: Project; length: number; origin: number } | null {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  const bar = barTicks(project.timeSignature);
  if (track.kind === 'midi') {
    const clip = track.clips.find((c) => c.id === track.current) ?? track.clips[0];
    if (!clip) return null;
    const length = clip.notes.length ? contentLength(clip.duration, bar) : loopBars * bar;
    const t: MidiTrack = { ...track, placements: [{ id: 'pattern', clipId: clip.id, start: 0, length }] };
    return { project: { ...project, tracks: [t] }, length, origin: 0 };
  }
  if (track.kind === 'drums') {
    const pattern = track.patterns.find((p) => p.id === track.current) ?? track.patterns[0];
    if (!pattern) return null;
    const length = pattern.bars * bar;
    const t: DrumTrack = { ...track, placements: [{ id: 'pattern', clipId: pattern.id, start: 0, length }] };
    return { project: { ...project, tracks: [t] }, length, origin: 0 };
  }
  const origin = Math.floor(cursor / bar) * bar;
  const length = loopBars * bar;
  const t: VoiceTrack = { ...track, clips: track.clips.filter((c) => c.start >= origin && c.start < origin + length).map((c) => ({ ...c, start: c.start - origin })) };
  return { project: { ...project, tracks: [t] }, length, origin };
}

// The song from `from` ticks on, as if it began there: for recording from the playhead
// while everything else plays along. (Notes before it are left out; drum placements and
// voice recordings that started earlier pick up part-way.)
export function shiftProject(project: Project, from: number): Project {
  if (from <= 0) return project;
  const bar = barTicks(project.timeSignature);
  const tracks: Track[] = project.tracks.map((track) => {
    if (track.kind === 'midi') {
      const notes: Note[] = [];
      for (const c of expandPlacements(track.clips, track.placements, bar)) {
        for (const n of c.notes) {
          const at = c.start + n.start;
          if (at >= from) notes.push({ ...n, start: at - from });
        }
      }
      const duration = Math.max(0, ...notes.map((n) => n.start + n.duration));
      const clip: NoteClip = { id: 'from-here', start: 0, duration, notes };
      return { ...track, clips: [clip], placements: [{ id: 'from-here', clipId: clip.id, start: 0, length: contentLength(duration, bar) }] };
    }
    if (track.kind === 'drums') {
      return { ...track, placements: track.placements.map((p) => ({ ...p, start: p.start - from })) };
    }
    return { ...track, clips: track.clips.map((c) => ({ ...c, start: c.start - from })) };
  });
  return { ...project, tracks };
}
