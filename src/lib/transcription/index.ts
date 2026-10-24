// Voice → notes. The app only needs what's exported here.
//
//   live:   const t = new LiveTranscriber(liveInput, onUpdate); t.start(at)  → the take so far, while singing
//           t.stop()                                                           → Transcription
//   file:   transcribeAudio(samples, sampleRate)                               → Transcription
//   notes:  buildNotes(take, settings, { samples, sampleRate })               → TranscribedNote[] (re-run on settings change)
//   clip:   toClip(notes, bpm, expressionSettings)                             → NoteClip (ticks)
//
// The analysis is pYIN + Tony's note model (@audio/pitch-pyin); see analyze.ts.

export type { Analysis, DetectedNote, PitchTrack, TranscribedNote, Transcription } from './types';
export { DEFAULT_NOTE_SETTINGS, buildNotes, type NoteSettings } from './notes';
export { DEFAULT_EXPRESSION_SETTINGS, interpretNote, type ExpressionSettings } from './expression';
export { toClip, toNotes } from './clip';
export { LiveTranscriber } from './live';
export { transcribeAudio } from './transcribe';
export { encodeTake, decodeTakeAudio, type TakeFile } from './take-file';
