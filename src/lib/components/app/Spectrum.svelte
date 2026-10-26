<!--
  A live spectrum: how much of each frequency is in a channel right now (low on the left,
  high on the right, on a ratio scale like the ear hears it), read every frame from
  audio/mixer.ts `spectrum`. Flat when nothing plays.
    <Spectrum id="master" />   <Spectrum id={track.id} width={300} height={70} />
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as Tone from 'tone';
  import { spectrum } from '$lib/audio/mixer';
  import { playhead } from '$lib/state/playhead.svelte';

  let { id, width = 240, height = 60 }: { id: string; width?: number; height?: number } = $props();
  let canvas = $state<HTMLCanvasElement>();

  const MIN_HZ = 30;
  const MAX_HZ = 18000;
  const FLOOR_DB = -100;

  onMount(() => {
    let frame = 0;
    let idle = false;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const ctx = canvas?.getContext('2d');
      if (!ctx) return;
      // Stopped: draw the empty grid once, then nothing until it plays.
      if (!playhead.running && idle) return;
      idle = !playhead.running;
      ctx.clearRect(0, 0, width, height);
      // Guide lines: 100 Hz, 1 kHz, 10 kHz.
      ctx.strokeStyle = 'rgba(127,127,127,0.25)';
      for (const hz of [100, 1000, 10000]) {
        const gx = (Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)) * width;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, height);
        ctx.stroke();
      }
      const data = playhead.running ? spectrum(id) : null;
      if (!data) return;
      const nyquist = Tone.getContext().sampleRate / 2;
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let px = 0; px <= width; px += 2) {
        const hz = MIN_HZ * (MAX_HZ / MIN_HZ) ** (px / width);
        const bin = Math.min(data.length - 1, Math.round((hz / nyquist) * data.length));
        const db = Math.max(FLOOR_DB, data[bin]);
        ctx.lineTo(px, height - ((db - FLOOR_DB) / -FLOOR_DB) * height);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = 'rgba(14,165,233,0.35)';
      ctx.strokeStyle = 'rgb(14,165,233)';
      ctx.fill();
      ctx.stroke();
    };
    draw();
    return () => cancelAnimationFrame(frame);
  });
</script>

<canvas bind:this={canvas} {width} {height} class="bg-muted/40 rounded" aria-label="Spectrum"></canvas>
