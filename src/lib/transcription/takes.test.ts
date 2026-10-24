// Real recordings as regression tests. Save a take from the test bench ("Save take"),
// put the file in src/lib/transcription/takes/, and fill in "expected" with the notes
// you actually sang (e.g. ["C3", "D3", "E3"]). Takes without "expected" are skipped.
// A note passes if it's named as sung, or if the audio was ambiguous and the sung note
// is among its reported alternatives (the transcription never guesses between them).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Midi } from 'tonal';
import { describe, expect, it } from 'vitest';
import { buildNotes } from './notes';
import { decodeTakeAudio, type TakeFile } from './take-file';
import { transcribeAudio } from './transcribe';

const DIR = 'src/lib/transcription/takes';
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];
const takes = files
  .map((file) => ({ file, take: JSON.parse(readFileSync(`${DIR}/${file}`, 'utf-8')) as TakeFile }))
  .filter(({ take }) => take.expected?.length);

describe.skipIf(takes.length === 0)('real takes', () => {
  it.each(takes)('$file', ({ take }) => {
    const audio = decodeTakeAudio(take);
    const notes = buildNotes(transcribeAudio(audio, take.sampleRate), undefined, {
      samples: audio,
      sampleRate: take.sampleRate
    });
    const name = (m: number) => Midi.midiToNoteName(m, { sharps: true });
    const expected = take.expected!.map((n) => name(Midi.toMidi(n)!));
    const heard = notes.map((n, i) =>
      n.alternatives.map(name).includes(expected[i]) ? expected[i] : name(n.pitch)
    );
    expect(heard).toEqual(expected);
  });
});
