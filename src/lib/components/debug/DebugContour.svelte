<script lang="ts">
  import type { PitchFrame } from '$lib/music/types';

  export interface DebugNote {
    start: number;      // seconds
    end: number;        // seconds
    pitch: number;      // MIDI
    t?: number[];       // curve times, seconds from note start
    cleaned?: number[]; // interpreted curve, cents from pitch
  }

  let {
    frames,
    notes,
    minClarity = 0.85
  }: {
    frames: PitchFrame[];
    notes: DebugNote[];
    minClarity?: number;
  } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  const PX_PER_SEC = 200; // horizontal zoom
  const ROW = 8;          // pixels per semitone

  const toMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

  // Redraw whenever frames or notes change (the effect tracks what draw() reads).
  $effect(() => draw());

  function draw() {
    if (!canvas || frames.length === 0) return;

    const midis = frames.filter((f) => f.hz > 0).map((f) => toMidi(f.hz));
    const pitches = [...midis, ...notes.map((n) => n.pitch)];
    if (pitches.length === 0) return;
    const lo = Math.floor(Math.min(...pitches)) - 2;
    const hi = Math.ceil(Math.max(...pitches)) + 2;

    const width = Math.max(300, frames[frames.length - 1].time * PX_PER_SEC + 40);
    const height = (hi - lo) * ROW;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const x = (t: number) => 30 + t * PX_PER_SEC;
    const y = (midi: number) => (hi - midi) * ROW;

    // Semitone rows, with C rows stronger and labelled.
    ctx.font = '9px monospace';
    for (let m = lo; m <= hi; m++) {
      ctx.fillStyle = m % 12 === 0 ? 'rgba(128,128,128,0.35)' : 'rgba(128,128,128,0.1)';
      ctx.fillRect(0, y(m), width, 1);
      if (m % 12 === 0) {
        ctx.fillStyle = 'rgba(128,128,128,0.9)';
        ctx.fillText(`C${m / 12 - 1}`, 2, y(m) - 2);
      }
    }

    // Notes: boxes on their pitch row.
    for (const n of notes) {
      ctx.fillStyle = 'rgba(14,165,233,0.3)';
      ctx.fillRect(x(n.start), y(n.pitch + 0.5), (n.end - n.start) * PX_PER_SEC, ROW);
    }

    // The pitch track: grey = voiced, red = less sure than minClarity.
    for (const f of frames) {
      if (f.hz <= 0) continue;
      ctx.fillStyle = f.clarity >= minClarity ? 'rgba(90,90,90,0.9)' : 'rgba(239,68,68,0.5)';
      ctx.fillRect(x(f.time) - 1, y(toMidi(f.hz)) - 1, 2, 2);
    }

    // What will be played: the interpreted curve of each note.
    ctx.strokeStyle = 'rgba(249,115,22,0.95)';
    ctx.lineWidth = 1.5;
    for (const n of notes) {
      if (!n.t || !n.cleaned || n.t.length === 0) continue;
      ctx.beginPath();
      n.t.forEach((t, i) => {
        const px = x(n.start + t);
        const py = y(n.pitch + n.cleaned![i] / 100);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  }
</script>

<div class="w-full overflow-x-auto rounded-md border">
  <canvas bind:this={canvas}></canvas>
</div>