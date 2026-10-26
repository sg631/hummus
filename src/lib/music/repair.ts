// Repairing a project whose numbers went bad (NaN, Infinity, missing): a block at position
// NaN neither draws nor plays, and one bad value can spoil the whole playlist's width. Runs
// when a project opens and before each Play; fixes what it can in place and says what.
//
//   const fixed = repairProject(project)   // ['Bass: block 2 had no position', …]
import { DEFAULT_PRESET_ID } from './instruments';
import type { Project } from './types';

const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function repairProject(p: Project): string[] {
  const fixed: string[] = [];
  const fix = (what: string) => fixed.push(what);

  if (!ok(p.bpm) || p.bpm <= 0) {
    p.bpm = 100;
    fix('Tempo');
  }
  if (!ok(p.detune)) {
    p.detune = 0;
    fix('Tuning');
  }
  if (!ok(p.transpose)) {
    p.transpose = 0;
    fix('Key shift');
  }
  if (!ok(p.masterVolume)) {
    p.masterVolume = 0;
    fix('Master volume');
  }
  if (!Array.isArray(p.timeSignature) || !ok(p.timeSignature[0]) || !ok(p.timeSignature[1])) {
    p.timeSignature = [4, 4];
    fix('Time signature');
  }

  for (const t of p.tracks ?? []) {
    if (!ok(t.volume)) {
      t.volume = 0;
      fix(`${t.name}: volume`);
    }
    if (!ok(t.pan)) {
      t.pan = 0;
      fix(`${t.name}: pan`);
    }
    if (!ok(t.swing)) {
      t.swing = 0.5;
      fix(`${t.name}: swing`);
    }
    if (t.sends) {
      const before = t.sends.length;
      t.sends = t.sends.filter((x) => ok(x.level) && (p.buses ?? []).some((b) => b.id === x.busId));
      if (t.sends.length < before) fix(`${t.name}: a send`);
    }
    if (t.kind === 'voice') {
      t.clips.forEach((c, i) => {
        if (!ok(c.start)) {
          c.start = 0;
          fix(`${t.name}: recording ${i + 1}'s position`);
        }
      });
      continue;
    }
    // Blocks in the playlist.
    t.placements = t.placements.filter((pl, i) => {
      if (!ok(pl.start) || pl.start < 0) {
        pl.start = 0;
        fix(`${t.name}: block ${i + 1}'s position`);
      }
      if (pl.length !== undefined && (!ok(pl.length) || pl.length <= 0)) {
        delete pl.length;
        fix(`${t.name}: block ${i + 1}'s length`);
      }
      if (pl.offset !== undefined && !ok(pl.offset)) {
        delete pl.offset;
        fix(`${t.name}: block ${i + 1}'s start in its clip`);
      }
      return true;
    });
    if (t.kind === 'midi') {
      if (!t.instrument) {
        t.instrument = DEFAULT_PRESET_ID;
        fix(`${t.name}: instrument`);
      }
      for (const c of t.clips) {
        const before = c.notes.length;
        c.notes = c.notes.filter((n) => ok(n.start) && ok(n.duration) && n.duration > 0 && ok(n.pitch));
        if (c.notes.length < before) fix(`${t.name}: ${before - c.notes.length} broken note(s) removed`);
        for (const n of c.notes) if (!ok(n.velocity)) {
          n.velocity = 0.8;
          fix(`${t.name}: a note's velocity`);
        }
        for (const key of ['bend', 'mod'] as const) {
          const lane = c.controllers?.[key];
          if (lane?.some((pt) => !ok(pt.tick) || !ok(pt.value))) {
            c.controllers![key] = lane.filter((pt) => ok(pt.tick) && ok(pt.value));
            fix(`${t.name}: ${key === 'bend' ? 'pitch bend' : 'mod wheel'} points`);
          }
        }
        if (c.start !== 0) {
          c.start = 0;
          fix(`${t.name}: clip start`);
        }
        const end = Math.max(0, ...c.notes.map((n) => n.start + n.duration));
        if (!ok(c.duration) || c.duration < end) {
          c.duration = end;
          fix(`${t.name}: clip length`);
        }
      }
    } else {
      for (const pat of t.patterns) if (!ok(pat.bars) || pat.bars < 1) {
        pat.bars = 1;
        fix(`${t.name}: pattern length`);
      }
      for (const r of t.rows) {
        if (!ok(r.volume)) r.volume = 0;
        if (!ok(r.pan)) r.pan = 0;
      }
    }
  }

  for (const b of p.buses ?? []) {
    if (!ok(b.volume)) {
      b.volume = 0;
      fix(`${b.name}: volume`);
    }
    if (!ok(b.pan)) {
      b.pan = 0;
      fix(`${b.name}: pan`);
    }
  }
  if (p.markers) {
    const before = p.markers.length;
    p.markers = p.markers.filter((m) => ok(m.tick));
    if (p.markers.length < before) fix('A marker');
  }
  for (const lane of p.automation ?? []) {
    const before = lane.points.length;
    lane.points = lane.points.filter((pt) => ok(pt.tick) && ok(pt.value)).sort((a, b) => a.tick - b.tick);
    if (lane.points.length < before) fix(`Automation “${lane.name ?? 'lane'}”: ${before - lane.points.length} broken point(s) removed`);
  }
  if (p.loop && (!ok(p.loop.start) || !ok(p.loop.end))) {
    p.loop = { start: 0, end: 4 * 1920, enabled: false };
    fix('Loop region');
  }
  return fixed;
}
