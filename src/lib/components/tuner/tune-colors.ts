import type { TuneStatus } from '$lib/music/tuning';

export const tuneColors: Record<TuneStatus, string> = {
  in: 'bg-green-500',
  close: 'bg-amber-500',
  off: 'bg-red-500'
};