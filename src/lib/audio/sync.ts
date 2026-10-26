// Starting playback on someone else's beat. Normally Play and Record start the transport
// straight away; while the guide's backing track plays (guide/backing.ts) they wait for its
// next bar line instead, so the song and the backing stay in time.
//
//   sync.startAt = (leadBars, songTick) => audioContextTime   // the guide sets this
//   sync.startAt = null                                       // back to "now"
//
// `leadBars`: bars before `songTick` is reached (a recording's count-in); `songTick`: where
// in the song the transport starts. Called just before transport.start().
export const sync: { startAt: ((leadBars: number, songTick: number) => number) | null } = { startAt: null };
