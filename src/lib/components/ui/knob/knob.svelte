<script lang="ts">
	import { cn } from '$lib/utils.js';
	import { contextMenu, type MenuItem } from '$lib/state/context-menu.svelte';

	let {
		value = $bindable(0),
		defaultValue,
		min = 0,
		max = 100,
		step = 1,
		label,
		size = 60,
		color = 'var(--primary)',
		disabled = false,
		format,
		class: className
	}: {
		value: number;
		defaultValue?: number;
		min?: number;
		max?: number;
		step?: number;
		label?: string;
		size?: number;
		color?: string;
		disabled?: boolean;
		/** hum-daw addition: how the value is shown under the knob (default: rounded to `step`). */
		format?: (value: number) => string;
		class?: string;
	} = $props();

	const decimals = $derived(step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step))));
	const shown = $derived(format ? format(value) : value.toFixed(decimals));

	let isDragging = $state(false);
	let startY = $state(0);
	let startValue = $state(0);

	let safeValue = $derived(Math.min(max, Math.max(min, value)));
	let progress = $derived((safeValue - min) / (max - min || 1));
	let rotation = $derived(progress * 270 - 135);

	const circumference = 2 * Math.PI * 40;
	const arcLength = (270 / 360) * circumference;

	function handleMouseMove(e: MouseEvent) {
		if (!isDragging || disabled) return;
		const diff = startY - e.clientY;
		const range = max - min;
		const sensitivity = 0.5;
		const newValue = Math.min(max, Math.max(min, startValue + (diff / size) * range * sensitivity));
		value = Math.round(newValue / step) * step;
	}

	function handleMouseUp() {
		isDragging = false;
		window.removeEventListener('mousemove', handleMouseMove);
		window.removeEventListener('mouseup', handleMouseUp);
	}

	function onMouseDown(e: MouseEvent) {
		if (disabled) return;
		isDragging = true;
		startY = e.clientY;
		startValue = value;
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	}

	// hum-daw addition: arrow keys turn it one step (Shift: ten), Home/End jump to the ends.
	function onKeyDown(e: KeyboardEvent) {
		if (disabled) return;
		const by = e.shiftKey ? step * 10 : step;
		let next = value;
		if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = value + by;
		else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = value - by;
		else if (e.key === 'Home') next = min;
		else if (e.key === 'End') next = max;
		else return;
		e.preventDefault();
		value = Math.round(Math.min(max, Math.max(min, next)) / step) * step;
	}

	// hum-daw addition: right-click menu (reset, min, max, type a value). Attached with the
	// contextMenu action (a native listener), so it wins over menus of what it sits in.
	function knobMenu(): MenuItem[] {
		if (disabled) return [];
		const set = (v: number) => (value = Math.round(Math.min(max, Math.max(min, v)) / step) * step);
		return [
			{ label: 'Reset to default', disabled: defaultValue === undefined, action: () => set(defaultValue ?? min) },
			{ label: 'Set to minimum', action: () => set(min) },
			{ label: 'Set to maximum', action: () => set(max) },
			{ separator: true },
			{
				label: 'Type a value…',
				action: () => {
					const typed = window.prompt(`${label ?? 'Value'} (${min} to ${max})`, String(value));
					if (typed !== null && typed.trim() !== '' && !Number.isNaN(Number(typed))) set(Number(typed));
				}
			}
		];
	}

	function onDoubleClick() {
		if (disabled) return;
		value = defaultValue ?? min;
	}

	function onTouchStart(e: TouchEvent) {
		if (disabled) return;
		isDragging = true;
		startY = e.touches[0].clientY;
		startValue = value;
	}

	function onTouchMove(e: TouchEvent) {
		if (!isDragging || disabled) return;
		const diff = startY - e.touches[0].clientY;
		const range = max - min;
		const sensitivity = 0.5;
		const newValue = Math.min(max, Math.max(min, startValue + (diff / size) * range * sensitivity));
		value = Math.round(newValue / step) * step;
	}
</script>

<div
	class={cn(
		'flex flex-col items-center gap-2 select-none',
		disabled && 'opacity-50 grayscale-[0.2]',
		className
	)}
>
	{#if label}
		<span class="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
			{label}
		</span>
	{/if}

	<div
		role="slider"
		tabindex={disabled ? -1 : 0}
		aria-valuemin={min}
		aria-valuemax={max}
		aria-valuenow={value}
		aria-disabled={disabled}
		class={cn(
			'relative flex items-center justify-center rounded-full',
			disabled ? 'cursor-not-allowed' : 'cursor-ns-resize'
		)}
		style="width: {size}px; height: {size}px;"
		onmousedown={onMouseDown}
		ondblclick={onDoubleClick}
		onkeydown={onKeyDown}
		use:contextMenu={knobMenu}
		ontouchstart={onTouchStart}
		ontouchmove={onTouchMove}
		ontouchend={() => (isDragging = false)}
	>
		<svg class="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
			<circle
				cx="50"
				cy="50"
				r="40"
				fill="none"
				stroke="currentColor"
				stroke-width="8"
				class="text-muted/20"
				stroke-dasharray="{arcLength} {circumference}"
				stroke-linecap="round"
				style="transform: rotate(135deg); transform-origin: 50% 50%;"
			/>
			<circle
				cx="50"
				cy="50"
				r="40"
				fill="none"
				stroke={color}
				stroke-width="8"
				stroke-dasharray="{progress * arcLength} {circumference}"
				stroke-linecap="round"
				style="transform: rotate(135deg); transform-origin: 50% 50%;"
			/>
		</svg>

		<div
			class="relative flex items-center justify-center rounded-full border bg-secondary"
			style="width: {size * 0.65}px; height: {size * 0.65}px; transform: rotate({rotation}deg);"
		>
			<div
				class="mt-1 mb-auto h-[35%] w-1 rounded-full opacity-90 transition-colors"
				style="background-color: {color};"
			></div>
		</div>
	</div>

	<span class="font-mono text-xs font-medium tracking-tighter text-foreground">
		{shown}
	</span>
</div>
