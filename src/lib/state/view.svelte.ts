// What the main area shows: the selected track's editor (piano roll, drum grid, voice
// editor) or the Playlist (the whole song's arrangement). Anything can switch it, e.g.
// double-clicking a block in the playlist opens that clip in the editor.
export const view = $state({
  main: 'editor' as 'editor' | 'playlist'
});
