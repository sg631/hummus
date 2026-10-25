// Voice → notes. The app only needs what's exported here.
//
//   live:   const t = new LiveTranscriber(liveInput, onUpdate); t.start(at)  → the take so far, while singing
//           t.stop()                                                           → Transcription
//   file:   transcribeAudio(samples, sampleRate)                               → Transcription
//   notes:  buildNotes(take, settings, { samples, sampleRate })               → TranscribedNote[] (re-run on settings change)
//   clip:   toClip(notes, bpm, expressionSettings)                             → NoteClip (ticks)
//   all:    takeToClip(take, bpm, timeSignature)                               → quantized NoteClip, in one call
//
// The analysis is pYIN's HMM on neural pitch (@audio/pitch-pyin + @audio/neural-pitch) and an
// adapted Tony note model (note-model.ts); see analyze.ts. Notes carry articulation (notes.ts).

export type { Analysis, DetectedNote, PitchTrack, TranscribedNote, Transcription } from './types';
export { DEFAULT_NOTE_SETTINGS, buildNotes, type NoteSettings } from './notes';
export { DEFAULT_EXPRESSION_SETTINGS, interpretNote, type ExpressionSettings } from './expression';
export { toClip, toNotes } from './clip';
export { DEFAULT_TAKE_SETTINGS, takeToClip, type TakeSettings } from './take-to-clip';
export { LiveTranscriber } from './live';
export { transcribeAudio } from './transcribe';
export { encodeTake, decodeTakeAudio, type TakeFile } from './take-file';
