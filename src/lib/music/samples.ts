// Sampled instruments: recordings of real instruments, one file per few notes. Tone.Sampler
// fills in the notes between by re-pitching the nearest recording. Two sources:
// - tonejs-instruments (https://github.com/nbrosowsky/tonejs-instruments): most of them
// - the FluidR3 GM soundfont, rendered to mp3 by midi-js-soundfonts
//   (https://github.com/gleitz/midi-js-soundfonts): the saxophones, which sound better
//
// License: both are CC-BY 3.0, so they can be used in anything (commercial too) as long as
// the credit (SAMPLES_CREDIT) is shown. The app shows it in the instrument window.
//
// They're downloaded from the project's site when first used (a few MB per instrument),
// so sampled instruments need an internet connection. To host them yourself, copy the
// files into static/samples/<id>/ and set SAMPLES_BASE_URL to '/samples/'.

export const SAMPLES_BASE_URL = 'https://nbrosowsky.github.io/tonejs-instruments/samples/';
export const SOUNDFONT_BASE_URL = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/';

export const SAMPLES_CREDIT =
  'Sampled instruments: tonejs-instruments by Nicholaus P. Brosowsky, and the FluidR3 GM soundfont by Frank Wen via midi-js-soundfonts (both CC-BY 3.0).';

export interface SampleSet {
  id: string;    // folder name on the server
  name: string;
  // The recorded notes, file names without '.mp3'. tonejs-instruments writes sharps as
  // 's' ('Cs4' is C#4); the soundfont writes flats ('Db4').
  notes: string;
  soundfont?: true; // from the FluidR3 GM soundfont (folder `${id}-mp3`)
}

// Not every recorded note: one every 3–4 semitones is enough, and loads faster.
export const SAMPLE_SETS: readonly SampleSet[] = [
  { id: 'bass-electric', name: 'Electric bass', notes: 'Cs1 E1 G1 As1 Cs2 E2 G2 As2 Cs3 E3 G3 As3 Cs4 E4 G4 As4 Cs5' },
  { id: 'bassoon', name: 'Bassoon', notes: 'G2 C3 G3 C4 E4 G4 C5' },
  { id: 'cello', name: 'Cello', notes: 'C2 Ds2 G2 As2 Cs3 E3 G3 As3 Cs4 E4 G4 B4' },
  { id: 'clarinet', name: 'Clarinet', notes: 'D3 F3 As3 D4 F4 As4 D5 F5 As5 D6 Fs6' },
  { id: 'contrabass', name: 'Double bass', notes: 'Fs1 As1 D2 Fs2 A2 Cs3 E3 Gs3 B3' },
  { id: 'flute', name: 'Flute', notes: 'C4 E4 A4 C5 E5 A5 C6 E6 A6 C7' },
  { id: 'french-horn', name: 'French horn', notes: 'A1 C2 Ds2 G2 D3 F3 A3 C4 D5 F5' },
  { id: 'guitar-acoustic', name: 'Acoustic guitar', notes: 'D2 F2 Gs2 B2 D3 F3 Gs3 B3 D4 F4 Gs4 B4 D5' },
  { id: 'guitar-electric', name: 'Electric guitar', notes: 'Cs2 E2 A2 C3 Ds3 Fs3 A3 C4 Ds4 Fs4 A4 C5 Ds5 Fs5 A5 C6' },
  { id: 'guitar-nylon', name: 'Nylon guitar', notes: 'B1 D2 Fs2 A2 Cs3 E3 G3 B3 Ds4 Fs4 A4 Cs5 E5 G5 As5' },
  { id: 'harmonium', name: 'Harmonium', notes: 'C2 Ds2 Fs2 A2 C3 Ds3 Fs3 A3 C4 Ds4 G4 As4 Cs5' },
  { id: 'harp', name: 'Harp', notes: 'E1 G1 B1 D2 F2 A2 C3 E3 G3 B3 D4 F4 A4 C5 E5 G5 B5 D6 F6 A6 D7 F7' },
  { id: 'organ', name: 'Organ', notes: 'C1 Ds1 Fs1 A1 C2 Ds2 Fs2 A2 C3 Ds3 Fs3 A3 C4 Ds4 Fs4 A4 C5 Ds5 Fs5 A5 C6' },
  { id: 'piano', name: 'Grand piano', notes: 'C1 Ds1 Fs1 A1 C2 Ds2 Fs2 A2 C3 Ds3 Fs3 A3 C4 Ds4 Fs4 A4 C5 Ds5 Fs5 A5 C6 Ds6 Fs6 A6 C7 Ds7 Fs7 A7 C8' },
  { id: 'saxophone', name: 'Saxophone (older samples)', notes: 'Cs3 E3 G3 As3 Cs4 E4 G4 As4 Cs5 E5 G5' },
  { id: 'trombone', name: 'Trombone', notes: 'As1 Cs2 F2 Gs2 C3 Ds3 Gs3 C4 Ds4' },
  { id: 'trumpet', name: 'Trumpet', notes: 'F3 A3 C4 Ds4 G4 As4 D5 F5 A5 C6' },
  { id: 'tuba', name: 'Tuba', notes: 'F1 As1 Ds2 As2 D3 F3 As3 D4' },
  { id: 'violin', name: 'Violin', notes: 'G3 C4 E4 G4 C5 E5 G5 C6 E6 G6 C7' },
  { id: 'xylophone', name: 'Xylophone', notes: 'G4 C5 G5 C6 G6 C7 G7 C8' },
  // FluidR3 GM saxophones (each across its range, every 3 semitones).
  { id: 'soprano_sax', name: 'Soprano sax', soundfont: true, notes: 'Ab3 B3 D4 F4 Ab4 B4 D5 F5 Ab5 B5 D6 E6' },
  { id: 'alto_sax', name: 'Alto sax', soundfont: true, notes: 'Db3 E3 G3 Bb3 Db4 E4 G4 Bb4 Db5 E5 G5 Bb5' },
  { id: 'tenor_sax', name: 'Tenor sax', soundfont: true, notes: 'Ab2 B2 D3 F3 Ab3 B3 D4 F4 Ab4 B4 D5 F5' },
  { id: 'baritone_sax', name: 'Baritone sax', soundfont: true, notes: 'Db2 E2 G2 Bb2 Db3 E3 G3 Bb3 Db4 E4 G4 Bb4' },
];

export function sampleSet(id: string): SampleSet {
  return SAMPLE_SETS.find((s) => s.id === id) ?? SAMPLE_SETS.find((s) => s.id === 'piano')!;
}

// Note name → file URL, as Tone.Sampler wants it: { 'C#4': 'https://…/piano/Cs4.mp3', … }.
export function sampleUrls(id: string): Record<string, string> {
  const set = sampleSet(id);
  const folder = set.soundfont ? `${SOUNDFONT_BASE_URL}${set.id}-mp3/` : `${SAMPLES_BASE_URL}${set.id}/`;
  return Object.fromEntries(
    set.notes.split(' ').map((file) => [set.soundfont ? file : file.replace('s', '#'), `${folder}${file}.mp3`])
  );
}
