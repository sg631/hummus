<!--
  The "hum-mus" logo: just text, in Smooch Sans at weight 800 (loaded from Google Fonts in
  routes/+layout.svelte). `class` sets its size, e.g. <Logo class="text-6xl" />.
-->
<script lang="ts">
  let { class: className = 'text-xl' }: { class?: string } = $props();
</script>

<span class="font-logo leading-none font-extrabold tracking-tight select-none {className}">hum-mus</span>
