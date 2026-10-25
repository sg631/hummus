// How recording works: count-in, metronome, play-along, and how a take becomes notes
// (note detection, expression, quantize). Changed in the Settings dialog; applies to the
// next recording. Kept in this browser (localStorage), not in the project: they're how
// *you* like to record, whatever the song.
//
// The song's own settings (tempo, time signature, key) are in `project` instead.
import { DEFAULT_TAKE_SETTINGS, type TakeSettings } from '$lib/transcription';

export interface RecordingSettings {
  countInBars: number; // bars of clicks before the take: 0, 1 or 2
  metronome: boolean;  // click while recording and playing (the top bar's metronome button)
  playAlong: boolean;  // hear the other tracks while recording
  loopBars: number;    // pattern mode: bars looped for an empty clip or a voice track
  overdub: boolean;    // tracks with polyphony: recording adds notes (true) or replaces them
  take: TakeSettings;  // how the take is turned into notes (melody tracks)
}

const STORAGE_KEY = 'hum-daw:recording-settings';

export function defaultRecordingSettings(): RecordingSettings {
  return { countInBars: 1, metronome: true, playAlong: true, loopBars: 2, overdub: true, take: structuredClone(DEFAULT_TAKE_SETTINGS) };
}

// The saved settings over the defaults, so settings added later still get a value.
function load(): RecordingSettings {
  const defaults = defaultRecordingSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<RecordingSettings> | null;
    if (!saved) return defaults;
    return {
      ...defaults,
      ...saved,
      take: {
        notes: { ...defaults.take.notes, ...saved.take?.notes },
        expression: { ...defaults.take.expression, ...saved.take?.expression },
        quantize: { ...defaults.take.quantize, ...saved.take?.quantize }
      }
    };
  } catch {
    return defaults; // nothing saved, unreadable, or no localStorage
  }
}

export const recordingSettings = $state<RecordingSettings>(load());

export function saveRecordingSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify($state.snapshot(recordingSettings)));
  } catch {
    // storage full or blocked: the settings still work until the page is closed
  }
}

export function resetRecordingSettings() {
  Object.assign(recordingSettings, defaultRecordingSettings());
}
