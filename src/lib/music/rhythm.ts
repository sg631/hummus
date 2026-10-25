// Which grid each part of a performance was played on: straight eighths here, triplets
// there, swung throughout. Rhythm quantization as Cemgil, Desain & Kappen ("Rhythm
// quantization for transcription", Computer Music Journal 2000): each beat's candidate
// grids are scored by how far the onsets are from them (Gaussian timing error) plus a
// prior that favours simple rhythms, both of the grid and of where notes land on it, and
// dynamic programming over the whole take picks the best sequence, with a cost for
// switching between duple and triple feel so a phrase keeps one feel unless the timing
// clearly changes.
//
// Beats follow the time signature: a quarter in 4/4, an eighth in 7/8, a dotted quarter
// in 6/8, 9/8 and 12/8 (compound time, where splitting the beat in three is the plain
// rhythm and in two is the tuplet). Swing is the off-beat eighth's place in the beat
// (0.5 straight, 2/3 triplet swing): measured from the take (estimateSwing) or given.
// Positions are in ticks from bar 1, beat 1.
import { PPQ, beatTicks, type TimeSignature } from './time';

export interface GridCell {
  start: number;     // ticks
  length: number;    // ticks: one beat, or two for quarter-note triplets
  divisions: number; // steps across it (2 for eighths, swung or not)
  points: number[];  // its grid, ticks from `start` (both ends included)
  alternative?: { length: number; divisions: number; points: number[] }; // nearly as likely, places notes elsewhere
}

export interface RhythmOptions {
  timeSignature?: TimeSignature; // default 4/4
  swing?: number;                // off-beat place, 0.5 (straight) to 0.75; default straight
  bpm?: number;                  // quarter notes a minute: timing spread is in seconds; default 100
}

type Feel = 'duple' | 'triple' | 'any';

// A candidate cell: how many beats it spans, its grid as fractions of that span, the
// prior cost of each point a note lands on (the ends are beats: free), the cost of using
// the grid at all, and its feel.
interface Candidate {
  beats: number;
  points: number[];
  placeCosts: number[];
  prior: number;
  feel: Feel;
}

const TIMING_SD_SEC = 0.03; // human timing spread (after the singer's own offset is removed)
const SWITCH_COST = 1.5; // changing between duple and triple feel
const CROWD_COST = 10;   // two onsets on one grid point (one would vanish)
const AMBIGUOUS = 1;     // a runner-up within this cost is reported as an alternative
// Extra prior on straight sixteenths when the take swings: their last point is where a
// swung eighth lands.
const SWUNG_SIXTEENTHS = 1.5;
const STRAIGHT = 0.5;
const MAX_SWING = 0.75;

const even = (n: number) => Array.from({ length: n + 1 }, (_, k) => k / n);

// Simple time (the beat splits in two). The place costs make two notes on a sixteenth
// grid's off-beats (rare) lose to two triplets (common).
function simpleCandidates(swing: number): Candidate[] {
  const sixteenths = swing >= 0.55 ? 1 + SWUNG_SIXTEENTHS : 1;
  return [
    { beats: 1, points: [0, 1], placeCosts: [0, 0], prior: 0, feel: 'any' },
    { beats: 1, points: [0, swing, 1], placeCosts: [0, 0.5, 0], prior: 0.5, feel: 'duple' }, // eighths
    { beats: 1, points: even(4), placeCosts: [0, 1.5, 0.5, 1.5, 0], prior: sixteenths, feel: 'duple' }, // sixteenths
    { beats: 1, points: even(3), placeCosts: [0, 1, 1, 0], prior: 1.5, feel: 'triple' }, // eighth triplets
    { beats: 2, points: even(3), placeCosts: [0, 1, 1, 0], prior: 2, feel: 'triple' }, // quarter-note triplets
    { beats: 1, points: even(6), placeCosts: [0, 2, 1, 0.5, 1, 2, 0], prior: 2.5, feel: 'triple' } // sextuplets
  ];
}

// Compound time (the beat splits in three): eighths are the plain rhythm, duplets the tuplet.
function compoundCandidates(): Candidate[] {
  return [
    { beats: 1, points: [0, 1], placeCosts: [0, 0], prior: 0, feel: 'any' },
    { beats: 1, points: even(3), placeCosts: [0, 0.5, 0.5, 0], prior: 0.5, feel: 'triple' }, // eighths
    { beats: 1, points: even(6), placeCosts: [0, 1.5, 0.5, 1.5, 0.5, 1.5, 0], prior: 1, feel: 'triple' }, // sixteenths
    { beats: 1, points: even(2), placeCosts: [0, 1, 0], prior: 1, feel: 'duple' }, // duplets (clearer than dotted-eighth pairs)
    { beats: 1, points: even(4), placeCosts: [0, 2, 1, 2, 0], prior: 2.5, feel: 'duple' } // quadruplets
  ];
}

export const isCompound = ([beats, unit]: TimeSignature) => unit >= 8 && beats % 3 === 0 && beats > 3;

// The beat's length in ticks: the signature's beat unit, three of them in compound time.
export function rhythmBeat(ts: TimeSignature): number {
  return isCompound(ts) ? 3 * beatTicks(ts) : beatTicks(ts);
}

const switches = (a: Feel, b: Feel) => a !== 'any' && b !== 'any' && a !== b;

// The grid for onsets (ticks, any order), one cell per beat or two, from tick 0 through
// the last onset's beat. Onsets as given: remove the singer's offset first (fitRhythm).
export function chooseGrid(onsets: number[], options: RhythmOptions = {}): GridCell[] {
  return decode(onsets, options).cells;
}

// The best grid and its cost (lower: the onsets are more likely under it).
function decode(onsets: number[], options: RhythmOptions): { cells: GridCell[]; cost: number } {
  if (onsets.length === 0) return { cells: [], cost: 0 };
  const ts = options.timeSignature ?? [4, 4];
  const beat = rhythmBeat(ts);
  const swing = clampSwing(options.swing ?? STRAIGHT);
  const candidates = isCompound(ts) ? compoundCandidates() : simpleCandidates(swing);
  const sd = (TIMING_SD_SEC * (options.bpm ?? 100)) / 60 / (beat / PPQ); // in beats
  const beats = onsets.map((t) => Math.max(0, t / beat)).sort((a, b) => a - b);
  const total = Math.floor(beats[beats.length - 1]) + 1;
  // onsets in [from, to) beats, by binary search (this runs hundreds of times per fit)
  const firstAt = (x: number) => {
    let lo = 0;
    let hi = beats.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const inside = (from: number, to: number) => beats.slice(firstAt(from), firstAt(to));

  // best[b][feel]: cheapest grid for beats 0…b ending in that feel
  type Step = { cost: number; from: number; fromFeel: Feel; cell: Candidate; runnerUp?: Candidate; margin: number };
  const best: Map<Feel, Step>[] = Array.from({ length: total + 2 }, () => new Map());
  best[0].set('any', { cost: 0, from: -1, fromFeel: 'any', cell: candidates[0], margin: Infinity });

  for (let b = 0; b < total; b++) {
    for (const [prevFeel, prev] of best[b]) {
      // every candidate for the cell starting here, cheapest first
      const options = candidates
        .filter((c) => b + c.beats <= total + 1)
        .map((c) => ({
          c,
          cost: prev.cost + c.prior + fitCost(inside(b, b + c.beats), b, c, sd, beats[firstAt(b + c.beats)]) + (switches(prevFeel, c.feel) ? SWITCH_COST : 0)
        }))
        .sort((x, y) => x.cost - y.cost);
      for (const o of options) {
        const key = o.c.feel === 'any' ? prevFeel : o.c.feel; // a plain beat keeps the feel going
        const here = best[b + o.c.beats].get(key);
        if (!here || o.cost < here.cost) {
          const rival = options.find((r) => r !== o && r.c.beats === o.c.beats);
          best[b + o.c.beats].set(key, {
            cost: o.cost,
            from: b,
            fromFeel: prevFeel,
            cell: o.c,
            runnerUp: rival?.c,
            margin: rival ? rival.cost - o.cost : Infinity
          });
        }
      }
    }
  }

  // the cheapest way to cover every beat, traced back
  const cheapest = (b: number) => Math.min(...[...best[b].values()].map((x) => x.cost));
  const end = best[total + 1].size && cheapest(total + 1) < cheapest(total) ? total + 1 : total;
  const feels: Feel[] = ['duple', 'triple', 'any'];
  let key = feels.reduce((k, f) => ((best[end].get(f)?.cost ?? Infinity) < (best[end].get(k)?.cost ?? Infinity) ? f : k));
  const toCell = (start: number, c: Candidate): GridCell => ({
    start,
    length: c.beats * beat,
    divisions: c.points.length - 1,
    points: c.points.map((p) => Math.round(p * c.beats * beat))
  });
  const cells: GridCell[] = [];
  for (let b = end; b > 0; ) {
    const step = best[b].get(key)!;
    const cell = toCell(step.from * beat, step.cell);
    // a runner-up nearly as likely that would place some note elsewhere
    if (step.runnerUp && step.margin < AMBIGUOUS) {
      const other = toCell(cell.start, step.runnerUp);
      const moves = inside(step.from, step.from + step.cell.beats).some(
        (x) => snapToCell(x * beat, cell) !== snapToCell(x * beat, other)
      );
      if (moves) cell.alternative = { length: other.length, divisions: other.divisions, points: other.points };
    }
    cells.unshift(cell);
    key = step.fromFeel;
    b = step.from;
  }
  return { cells, cost: cheapest(end) };
}

export interface RhythmFit {
  offset: number;              // ticks the singer sits behind (+) or ahead of the beat
  swing: number;               // the off-beat eighth's place used (0.5 straight … 0.75)
  measuredSwing: number | null; // the take's own; null if too few off-beat eighths to tell
  cells: GridCell[];           // the grid, for onsets with the offset removed
}

// The singer's timing offset and swing, fitted together: the pair under which the whole
// take's rhythm is most likely (the decoder's lowest cost, plus mild priors toward no
// offset and straight eighths), searched coarse then fine. Both matter at once: a voice's
// notes start after their consonants and the pitch tracker adds a little more, so takes
// sit a few tens of ms late, and with that left in, on-beat notes read as off the beat
// and swung eighths as sixteenths. Measuring either alone is thrown by the other (a late
// swung off-beat lands near the next beat). `swing` fixes it instead of measuring it.
export function fitRhythm(
  onsets: number[],
  options: { timeSignature?: TimeSignature; bpm?: number; swing?: number; minimumOffbeats?: number } = {}
): RhythmFit {
  const ts = options.timeSignature ?? [4, 4];
  const beat = rhythmBeat(ts);
  if (onsets.length === 0) return { offset: 0, swing: STRAIGHT, measuredSwing: null, cells: [] };
  const canSwing = !isCompound(ts);
  const beatSec = (60 / (options.bpm ?? 100)) * (beat / PPQ);
  const maxOffset = Math.min(0.3, MAX_OFFSET_SEC / beatSec); // beats
  const offsetSd = OFFSET_PRIOR_SD_SEC / beatSec;
  const cost = (offset: number, swing: number) =>
    decode(
      onsets.map((t) => t - offset * beat),
      { timeSignature: ts, bpm: options.bpm, swing }
    ).cost +
    (offset / offsetSd) ** 2 / 2 +
    (swing > STRAIGHT ? SWING_PRIOR : 0);

  const search = (offsets: number[], swings: number[]) => {
    let best = { offset: 0, swing: STRAIGHT, cost: Infinity };
    for (const o of offsets) for (const w of swings) {
      const c = cost(o, w);
      if (c < best.cost) best = { offset: o, swing: w, cost: c };
    }
    return best;
  };
  const steps = (from: number, to: number, step: number) =>
    Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
  const swings = (around?: number) =>
    !canSwing ? [STRAIGHT]
    : options.swing !== undefined ? [clampSwing(options.swing)]
    : around === undefined ? [STRAIGHT, ...steps(0.54, MAX_SWING, 0.03)]
    : [...new Set([STRAIGHT, ...steps(around - 0.03, around + 0.03, 0.01).map(clampSwing)])];

  const coarse = search(steps(-maxOffset, maxOffset, 0.02), swings());
  const fine = search(steps(coarse.offset - 0.02, coarse.offset + 0.02, 0.005), swings(coarse.swing));
  const offset = Math.round(fine.offset * beat);
  const cells = decode(onsets.map((t) => t - offset), { timeSignature: ts, bpm: options.bpm, swing: fine.swing }).cells;

  // the measured swing counts only with enough off-beat eighths to show it
  let measuredSwing: number | null = null;
  if (canSwing) {
    const fitted = options.swing === undefined ? fine.swing : fitRhythm(onsets, { ...options, swing: undefined }).measuredSwing;
    const offbeats = onsets.filter((t) => {
      const cell = cellAt(cells, t - offset);
      return cell.divisions === 2 && snapToCell(t - offset, cell) === cell.start + cell.points[1];
    }).length;
    measuredSwing = options.swing === undefined ? (offbeats >= (options.minimumOffbeats ?? 4) ? fitted : null) : fitted;
  }
  const swing = options.swing === undefined && measuredSwing === null ? STRAIGHT : fine.swing;
  if (swing !== fine.swing) {
    const straight = decode(onsets.map((t) => t - offset), { timeSignature: ts, bpm: options.bpm, swing });
    return { offset, swing, measuredSwing, cells: straight.cells };
  }
  return { offset, swing, measuredSwing, cells };
}
const MAX_OFFSET_SEC = 0.1;      // the furthest behind or ahead a singer is taken to sit (at most 0.3 beat)
const OFFSET_PRIOR_SD_SEC = 0.05; // how far they usually do
const SWING_PRIOR = 1;       // swinging at all costs this much: straight unless the timing says so

const clampSwing = (swing: number) => Math.min(MAX_SWING, Math.max(STRAIGHT, swing));

// The nearest point of the cell's grid to `tick`.
export function snapToCell(tick: number, cell: GridCell): number {
  let best = cell.points[0];
  for (const p of cell.points) if (Math.abs(cell.start + p - tick) < Math.abs(cell.start + best - tick)) best = p;
  return cell.start + best;
}

// The cell covering `tick` (ticks before the first cell use the first; after the last, the last).
export function cellAt(cells: GridCell[], tick: number): GridCell {
  let found = cells[0];
  for (const c of cells) if (c.start <= tick) found = c;
  return found;
}

// The shortest step of a cell's grid (ticks).
export function cellStep(cell: GridCell): number {
  let step = cell.length;
  for (let i = 1; i < cell.points.length; i++) step = Math.min(step, cell.points[i] - cell.points[i - 1]);
  return step;
}

// Gaussian timing error of onsets (beats) against a candidate's grid, the cost of the
// places they land on, and a cost for two onsets landing on one point, including the
// cell's end, which is the next cell's start (`next`: the first onset after the cell).
function fitCost(onsets: number[], start: number, c: Candidate, sd: number, next?: number): number {
  let cost = 0;
  const used = new Set<number>();
  for (const x of onsets) {
    const at = (x - start) / c.beats; // 0…1 across the cell
    let k = 0;
    for (let i = 1; i < c.points.length; i++) if (Math.abs(c.points[i] - at) < Math.abs(c.points[k] - at)) k = i;
    const error = ((at - c.points[k]) * c.beats) / sd;
    cost += (error * error) / 2 + c.placeCosts[k];
    if (used.has(k)) cost += CROWD_COST;
    used.add(k);
  }
  const end = c.points.length - 1;
  if (used.has(end) && next !== undefined && next - (start + c.beats) < (c.beats * (c.points[end] - c.points[end - 1])) / 2) {
    cost += CROWD_COST; // the next onset will take the same beat
  }
  return cost;
}
