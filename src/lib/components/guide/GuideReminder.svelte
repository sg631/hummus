<!--
  The second time the app opens (after the intro was answered): the way back to the guide
  (the studio's Guide button, or the home page's "How it works"; marked
  data-guide-reminder) gets the guide's pulsing outline, and a note under it. Dismiss, or
  opening the guide, puts it away for good.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { dismissReminder } from '$lib/guide/guide.svelte';

  let at = $state<{ top: number; left: number } | null>(null);

  // Under the marked button, kept on screen; centred at the bottom if none is showing.
  function place() {
    const target = [...document.querySelectorAll<HTMLElement>('[data-guide-reminder]')].find((el) => el.offsetParent);
    if (!target) return void (at = null);
    const r = target.getBoundingClientRect();
    const width = 260;
    at = { top: r.bottom + 10, left: Math.max(8, Math.min(window.innerWidth - width - 8, r.left + r.width / 2 - width / 2)) };
  }

  onMount(() => {
    document.documentElement.classList.add('guide-remind'); // the outline (below)
    place();
    // The page may still be laying out (projects loading): look again for a moment.
    const timer = setInterval(place, 250);
    const stop = setTimeout(() => clearInterval(timer), 3000);
    window.addEventListener('resize', place);
    return () => {
      document.documentElement.classList.remove('guide-remind');
      clearInterval(timer);
      clearTimeout(stop);
      window.removeEventListener('resize', place);
    };
  });
</script>

<div
  class="bg-foreground text-background fixed z-[80] w-[260px] rounded-md px-3 py-2.5 text-sm shadow-lg {at ? '' : 'bottom-4 left-1/2 -translate-x-1/2'}"
  style={at ? `top: ${at.top}px; left: ${at.left}px` : ''}
  role="status"
>
  <p>You can come back to the guide at any time.</p>
  <div class="mt-2 flex justify-end">
    <button class="rounded bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-600" onclick={dismissReminder}>Dismiss</button>
  </div>
</div>

<style>
  /* The guide's focus outline (GuideStage.svelte), on the way back to it. */
  :global(.guide-remind [data-guide-reminder]) {
    outline: 2px solid rgb(245 158 11);
    outline-offset: 3px;
    border-radius: 6px;
    animation: guide-reminder 1.9s ease-in-out infinite;
  }
  @keyframes -global-guide-reminder {
    50% {
      outline-color: rgb(245 158 11 / 0.25);
    }
  }
</style>
