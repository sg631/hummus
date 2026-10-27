<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/humdaw.jpg';

	let { children } = $props();
</script>

<svelte:head>
	<title>hum-mus</title>
	<link rel="icon" type="image/jpeg" href={favicon} />
	<!-- The logo's font: Smooch Sans, weight 800 (Google Fonts). -->
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Smooch+Sans:wght@800&display=swap" rel="stylesheet" />
</svelte:head>
{@render children()}
