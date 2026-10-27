<!--
  The home page: what you see when the app opens (and from the logo, or File → Home).
  - New project, or import a .humproj file
  - your projects as cards, newest first: click to open; ⋯ for rename, duplicate,
    export, delete; search and sort
  - where projects are kept (this browser or a folder), and the folder's access if the
    browser needs your OK again
  "Back to <song>" returns to the open project without reloading it.
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import Logo from './Logo.svelte';
  import { folderSupported } from '$lib/state/project-store';
  import { project } from '$lib/state/project.svelte';
  import {
    allowFolder,
    chooseProjectsFolder,
    deleteProject,
    duplicateProject,
    exportProjectById,
    importProjectFile,
    library,
    newProject,
    renameProject,
    stopUsingFolder
  } from '$lib/state/projects.svelte';
  import { continueGuide, currentStep, guide, openIntro } from '$lib/guide/guide.svelte';
  import { STEPS } from '$lib/guide/steps';
  import { goto } from '$app/navigation';
  import { ui } from '$lib/state/ui.svelte';
  import { offline } from '$lib/state/offline.svelte';

  let query = $state('');
  let sort = $state<'recent' | 'name'>('recent');
  let importInput = $state<HTMLInputElement>();

  const shown = $derived(
    library.list
      .filter((p) => (p.id === library.currentId ? project.name : p.name).toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : b.updated - a.updated))
  );

  // "just now", "5 min ago", "yesterday", or the date.
  function ago(ms: number): string {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 172800) return 'yesterday';
    return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  // Into the studio: its address opens the project.
  const open = (id: string) => goto(`${base}/studio/${id}`);
  async function create() {
    await newProject();
    await goto(`${base}/studio/${library.currentId}`);
  }
  async function rename(id: string, name: string) {
    const next = window.prompt('Rename project', name)?.trim();
    if (next) await renameProject(id, next);
  }
  async function remove(id: string, name: string) {
    if (window.confirm(`Delete “${name}”? This can't be undone.${library.folder.state === 'granted' ? ' Its folder is deleted too.' : ''}`)) await deleteProject(id);
  }
  async function doImport(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      await importProjectFile(file);
      await goto(`${base}/studio/${library.currentId}`);
    } catch (e) {
      window.alert(`That file couldn't be opened: ${e instanceof Error ? e.message : e}`);
    }
  }

  const needsFolder = $derived(library.folder.state === 'needs-permission' || library.folder.state === 'denied');
</script>

<div class="bg-background h-full overflow-y-auto">
  <div class="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
    <!-- Header: the logo, and back to the open song. -->
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Logo class="text-7xl" />
        <p class="text-muted-foreground mt-2">Sing it, hum it or play it, then shape it into a song.</p>
      </div>
      {#if library.currentId && !needsFolder}
        <Button variant="outline" onclick={() => open(library.currentId)}>Back to “{project.name}” →</Button>
      {/if}
    </header>

    <!-- Start something. -->
    <section class="grid gap-3 sm:grid-cols-3">
      <button
        class="bg-primary text-primary-foreground flex flex-col items-start gap-1 rounded-lg p-5 text-left shadow-sm transition hover:opacity-90 disabled:opacity-50"
        onclick={create}
        disabled={!library.ready || needsFolder}
      >
        <span class="text-2xl leading-none">+</span>
        <span class="text-lg font-semibold">New project</span>
        <span class="text-sm opacity-80">An empty song: add a track and sing</span>
      </button>
      <button class="hover:bg-muted flex flex-col items-start gap-1 rounded-lg border p-5 text-left transition disabled:opacity-50" onclick={() => importInput?.click()} disabled={!library.ready || needsFolder}>
        <span class="text-2xl leading-none">⤓</span>
        <span class="text-lg font-semibold">Import a project</span>
        <span class="text-muted-foreground text-sm">A .humproj file, recordings included</span>
      </button>
      <button
        class="hover:bg-muted flex flex-col items-start gap-1 rounded-lg border p-5 text-left transition disabled:opacity-50"
        disabled={!library.ready || needsFolder}
        data-guide-reminder
        onclick={() => (guide.active ? continueGuide() : openIntro())}
      >
        <span class="text-2xl leading-none">{guide.active ? '›' : '?'}</span>
        {#if guide.active}
          <!-- Left the guide part-way: carry on where it was. -->
          <span class="text-lg font-semibold">Continue the guide</span>
          <span class="text-muted-foreground text-sm">Step {guide.step + 1} of {STEPS.length}: {currentStep().title}</span>
        {:else}
          <span class="text-lg font-semibold">How it works</span>
          <span class="text-muted-foreground text-sm">The guide: build a first song, one feature at a time</span>
        {/if}
      </button>
      <input bind:this={importInput} type="file" accept=".humproj,application/json" class="hidden" onchange={(e) => doImport(e.currentTarget.files)} />
    </section>

    <!-- The projects folder needs the browser's OK again. -->
    {#if needsFolder}
      <section class="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/60 bg-amber-500/10 p-4">
        <span class="text-2xl" aria-hidden="true">📁</span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">Your projects are in the folder “{library.folder.name}”</p>
          <p class="text-muted-foreground text-sm">The browser asks once per visit before this page can open it. Click Allow, then Allow (or Edit files) in the browser's box.</p>
        </div>
        <Button onclick={allowFolder}>Allow access</Button>
        <Button variant="outline" onclick={chooseProjectsFolder}>Choose again…</Button>
      </section>
    {/if}

    <!-- Your projects. -->
    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-lg font-semibold">Your projects</h2>
        <span class="text-muted-foreground text-sm">{library.list.length}</span>
        <div class="ml-auto flex items-center gap-2">
          <input type="search" placeholder="Search" bind:value={query} class="bg-background w-48 rounded-md border px-3 py-1.5 text-sm" />
          <div class="flex rounded-md border text-xs" role="group" aria-label="Sort">
            <button class="rounded-l-md px-2.5 py-1.5 {sort === 'recent' ? 'bg-muted font-semibold' : 'text-muted-foreground'}" onclick={() => (sort = 'recent')}>Recent</button>
            <button class="rounded-r-md px-2.5 py-1.5 {sort === 'name' ? 'bg-muted font-semibold' : 'text-muted-foreground'}" onclick={() => (sort = 'name')}>A–Z</button>
          </div>
        </div>
      </div>

      {#if !library.ready}
        <p class="text-muted-foreground py-10 text-center text-sm">Loading your projects…</p>
      {:else}
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each shown as p (p.id)}
            {@const name = p.id === library.currentId ? project.name : p.name}
            <div class="group hover:border-foreground/30 relative flex flex-col rounded-lg border transition hover:shadow-sm {p.id === library.currentId ? 'ring-primary/40 ring-2' : ''}">
              <button class="flex flex-1 flex-col gap-2 p-4 text-left" onclick={() => open(p.id)} aria-label="Open {name}">
                <!-- A little waveform of bars, made from the name: just to tell cards apart. -->
                <div class="flex h-10 items-end gap-0.5" aria-hidden="true">
                  {#each Array.from({ length: 24 }, (_, i) => ((name || '?').charCodeAt(i % (name || '?').length) * (i + 7)) % 100) as h, i (i)}
                    <span class="bg-primary/25 group-hover:bg-primary/40 w-full rounded-sm transition" style="height: {20 + h * 0.8}%"></span>
                  {/each}
                </div>
                <span class="truncate pr-6 font-semibold">{name}</span>
                <span class="text-muted-foreground text-xs">{p.summary ?? ''}{p.summary ? ' · ' : ''}{ago(p.updated)}{p.id === library.currentId ? ' · open' : ''}</span>
              </button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger class="text-muted-foreground hover:text-foreground hover:bg-muted absolute top-2 right-2 rounded px-1.5 py-0.5" aria-label="More for {name}">⋯</DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  <DropdownMenu.Item onclick={() => open(p.id)}>Open</DropdownMenu.Item>
                  <DropdownMenu.Item onclick={() => rename(p.id, name)}>Rename…</DropdownMenu.Item>
                  <DropdownMenu.Item onclick={() => duplicateProject(p.id)}>Duplicate</DropdownMenu.Item>
                  <DropdownMenu.Item onclick={() => exportProjectById(p.id)}>Export file (.humproj)</DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item class="text-destructive" onclick={() => remove(p.id, name)}>Delete</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </div>
          {:else}
            <p class="text-muted-foreground col-span-full py-10 text-center text-sm">
              {library.list.length ? `No project matches “${query}”.` : 'No projects yet: start a new one.'}
            </p>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Where they're kept. -->
    <footer class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-sm">
      {#if library.folder.state === 'granted'}
        <span>Kept in your folder <b class="text-foreground">“{library.folder.name}”</b>, a folder per song.</span>
        <button class="hover:text-foreground underline" onclick={chooseProjectsFolder}>Change folder</button>
        <button class="hover:text-foreground underline" onclick={stopUsingFolder}>Keep them in this browser</button>
      {:else if !needsFolder}
        <span>Kept in <b class="text-foreground">this browser</b>, saved as you work.</span>
        {#if folderSupported}
          <button class="hover:text-foreground underline" onclick={chooseProjectsFolder}>Keep them in a folder on your computer…</button>
        {/if}
      {/if}
      <button class="hover:text-foreground ml-auto underline" onclick={() => (ui.offlineOpen = true)}>
        {!offline.online ? 'Offline' : 'Work offline'}{offline.total ? ` · ${offline.saved}/${offline.total} sounds saved` : ''}
      </button>
      <a href="{base}/bench" class="hover:text-foreground underline">Transcription test bench</a>
    </footer>
  </div>
</div>
