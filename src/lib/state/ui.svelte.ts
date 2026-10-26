// Windows anything can open (the menu bar, buttons, shortcuts), and the transport's
// actions so the menu bar can press Play or Record (TransportBar fills these in).
import { goto } from '$app/navigation';
import { recorder } from './recorder.svelte';

export const ui = $state({
  settingsOpen: false,
  projectsOpen: false,
  historyOpen: false,
  exportOpen: false,
  shortcutsOpen: false,
  offlineOpen: false,
  playing: false, // the song (or a pattern) is playing: TransportBar keeps this up to date
  message: '' // a short note shown as a toast (Menubar shows it)
});

export const transportActions: Record<'play' | 'stop' | 'togglePlay' | 'toggleRecord' | 'toggleLoop' | 'toggleMetronome' | 'exportMidi', () => void | Promise<void>> = {
  play: () => {},
  stop: () => {},
  togglePlay: () => {},
  toggleRecord: () => {},
  toggleLoop: () => {},
  toggleMetronome: () => {},
  exportMidi: () => {}
};

// To the home page (/). Playback stops as the studio closes.
export function goHome() {
  if (recorder.recording) return; // finish or cancel the recording first
  void goto('/');
}
