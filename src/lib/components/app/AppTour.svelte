<!--
  The guided tour: a spotlight moves over each part of the app with a short explanation.
  Starts by itself the first time the app opens; "Skip tour" (or Esc) or finishing remembers
  that (state/tour.svelte.ts); the Tour button in the top bar starts it again.

  Each step points at an element by its id (id="tour-…" in the components). A step
  without a target, or whose target isn't on screen, shows in the middle instead.
  To add a step: add it to STEPS, and an id to the element it explains.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { Walkthrough } from '$lib/components/ui/walkthrough/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { Step } from '$lib/components/ui/walkthrough/ctx';
	import { endTour, startTour, tour, tourSeen } from '$lib/state/tour.svelte';

	// A step can list keys (shown as a small table under its text).
	type TourStep = Step & { keys?: [string, string][] };

	const STEPS: TourStep[] = [
		{
			title: 'Welcome to hum-daw',
			description:
				'Sing or hum a melody and it becomes notes you can play on any instrument, with drums, your voice and effects. This tour takes a minute; skip it any time.'
		},
		{
			target: 'tour-add-tracks',
			position: 'right' as const,
			title: 'Add tracks',
			description:
				'Melody: sing, and it becomes notes. Voice: keeps your recording as audio. Drums: a beat you click in.'
		},
		{
			target: 'tour-tracks',
			position: 'right' as const,
			title: 'Your tracks',
			description:
				'Click a track to select it; double-click its name to rename it. M mutes, S solos, ⧉ duplicates. Melody tracks pick an instrument (✎ to design your own) and can play chords. Knobs: volume, pan, swing (drag up or down; double-click or right-click to reset). Effects: + Effect, drag to reorder. Right-click almost anything for more options.'
		},
		{
			target: 'tour-record',
			position: 'bottom' as const,
			title: 'Record',
			description:
				'Select a Melody or Voice track and press Record. After a bar of clicks, sing. Press Stop recording and your notes appear.'
		},
		{
			target: 'tour-record',
			position: 'bottom' as const,
			title: 'Sing outside your range: shift keys',
			description:
				'While recording a melody, hold keys to move what you sing. A note takes the shift you hold as it starts; change keys while holding a note and it splits there into a new note. The badge next to Record shows the shift.',
			keys: [
				['1 … 9, 0', 'up that many semitones (0 = 10)'],
				['− with a number', 'down instead (− 3: down 3)'],
				['Z  X  C  V', 'octaves: −2, −1, +1, +2 (add to a number: V + 2 = up 26)'],
				['` (hold)', 'slide into the new note instead of starting it again']
			]
		},
		{
			target: 'tour-editor',
			position: 'left' as const,
			title: 'Edit',
			description:
				'The selected track shows here. Piano roll: click to add a note, drag to move it, Shift-drag to select more, right-click to delete (Alt+right-click: more options); the ruler on top moves the playhead (where Play starts); the Quantize bar tidies the rhythm and swing. Drums: click steps, add sounds, set swing.'
		},
		{
			target: 'tour-playlist',
			position: 'bottom' as const,
			title: 'Playlist: build the song',
			description:
				'The whole song, a lane per track. Click a lane to place its clip or drum pattern, drag to move, drag the edge to repeat it, Ctrl-drag to copy, double-click to edit. Copies share their notes: change the clip once and every copy changes ("Make unique" splits one off).'
		},
		{
			target: 'tour-play',
			position: 'bottom' as const,
			title: 'Play',
			description: 'Plays every track together. The red line shows where you are.'
		},
		{
			target: 'tour-song',
			position: 'bottom' as const,
			title: 'Tempo, time signature, metronome, tuning',
			description:
				'Scroll or drag the wheel to change the speed (notes stay in time). Next to it: the time signature, the metronome on or off, and a tuning knob that shifts the whole song in cents (double-click: back to A440).'
		},
		{
			target: 'tour-settings',
			position: 'bottom' as const,
			title: 'Settings',
			description:
				'Time signature, key, count-in, metronome, microphone and speakers, latency calibration (do this once for tight timing), and how singing becomes notes.'
		},
		{
			target: 'tour-save',
			position: 'bottom' as const,
			title: 'Save',
			description:
				"Keeps your song in this browser; it opens again next time. Voice recordings aren't saved."
		},
		{
			title: "You're set",
			description:
				'Add a Melody track and sing something. The Tour button at the top brings this back.'
		}
	];

	onMount(() => {
		// The first visit only; a moment's wait lets the layout settle so the spotlight lands.
		if (!tourSeen()) setTimeout(startTour, 600);
	});
</script>

<!-- Esc skips the tour too. -->
<svelte:window onkeydown={(e) => tour.open && e.key === 'Escape' && endTour()} />

{#key tour.run}
	<Walkthrough steps={STEPS} bind:open={tour.open} onComplete={endTour} padding={6}>
		{#snippet children(ctx)}
			<div class="w-[340px] rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl">
				<h4 class="leading-none font-semibold">{ctx.currentStep()?.title}</h4>
				<p class="mt-2 text-sm text-muted-foreground">{ctx.currentStep()?.description}</p>
				{#if STEPS[ctx.currentStepIndex()]?.keys}
					<table class="mt-2 w-full text-xs">
						<tbody>
							{#each STEPS[ctx.currentStepIndex()].keys ?? [] as [key, what] (key)}
								<tr>
									<td class="py-0.5 pr-3 align-top whitespace-nowrap"><kbd class="rounded border bg-muted px-1 font-mono">{key}</kbd></td>
									<td class="text-muted-foreground">{what}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
				<!-- Progress dots: one per step, the current one filled. -->
				<div class="mt-4 flex gap-1">
					{#each STEPS as _, i (i)}
						<span
							class="h-1.5 flex-1 rounded-full {i <= ctx.currentStepIndex()
								? 'bg-primary'
								: 'bg-muted'}"
						></span>
					{/each}
				</div>
				<div class="mt-3 flex items-center justify-between gap-2">
					<span class="text-xs text-muted-foreground"
						>Step {ctx.currentStepIndex() + 1} of {STEPS.length}</span
					>
					<div class="flex gap-2">
						{#if !ctx.isLastStep()}
							<Button variant="ghost" size="sm" onclick={endTour}>Skip tour</Button>
						{/if}
						{#if ctx.currentStepIndex() > 0}
							<Button variant="outline" size="sm" onclick={ctx.prev}>Back</Button>
						{/if}
						<Button size="sm" onclick={ctx.next}>{ctx.isLastStep() ? 'Finish' : 'Next'}</Button>
					</div>
				</div>
			</div>
		{/snippet}
	</Walkthrough>
{/key}
