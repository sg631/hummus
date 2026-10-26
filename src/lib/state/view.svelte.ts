// What the main area shows: the selected track's editor (piano roll, drum grid, voice
// editor), the Playlist (the whole song's arrangement and automation) or the Mixer (every
// track's volume, pan, effects and meter side by side). Anything can switch it, e.g.
// double-clicking a block in the playlist opens that clip in the editor.
export const view = $state({
  main: 'editor' as 'editor' | 'playlist' | 'mixer',
  // Play: the whole song ('song'), or just the selected track's current clip / pattern on
  // a loop ('pattern'; recording there is looper recording).
  play: 'song' as 'song' | 'pattern',
  // Melody tracks: the editor shows sheet music (SheetView) instead of the piano roll.
  sheet: false,
  // An automation lane the playlist should scroll to (just made from a knob's menu).
  focusLane: null as string | null
});
