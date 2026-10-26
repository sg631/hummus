<!--
  Your projects (File → Open, or click the save status in the middle of the menu bar):
  open, rename, delete, start a new one, import a .humproj file; and where they're kept:
  this browser, or a projects folder on your computer (Chrome and Edge).
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { project } from '$lib/state/project.svelte';
  import { folderSupported } from '$lib/state/project-store';
  import { allowFolder, chooseProjectsFolder, deleteProject, importProjectFile, library, newProject, openProject, stopUsingFolder } from '$lib/state/projects.svelte';
  import { ui } from '$lib/state/ui.svelte';

  let query = $state('');
  let importInput = $state<HTMLInputElement>();
  const shown = $derived(library.list.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())));
  const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  async function open(id: string) {
    await openProject(id);
    ui.projectsOpen = false;
  }
  async function remove(id: string, name: string) {
    if (window.confirm(`Delete “${name}”? This can't be undone.${library.folder.state === 'granted' ? ' Its folder is deleted too.' : ''}`)) await deleteProject(id);
  }
  async function doImport(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      await importProjectFile(file);
      ui.projectsOpen = false;
    } catch (e) {
      window.alert(`That file couldn't be opened: ${e instanceof Error ? e.message : e}`);
    }
  }
</script>

<Dialog.Root bind:open={ui.projectsOpen}>
  <Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>Projects</Dialog.Title>
      <Dialog.Description>Saved automatically as you work, recordings included.</Dialog.Description>
    </Dialog.Header>

    <!-- Where they're kept. -->
    <div class="bg-muted/40 rounded-md border p-3 text-sm">
      {#if library.folder.state === 'granted'}
        <p>Kept in your projects folder <b>“{library.folder.name}”</b>: a folder per song, with <code>project.json</code> and its recordings as WAV files.</p>
        <div class="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onclick={chooseProjectsFolder}>Change folder…</Button>
          <Button size="sm" variant="ghost" onclick={stopUsingFolder}>Keep them in this browser instead</Button>
        </div>
      {:else if library.folder.state === 'needs-permission' || library.folder.state === 'denied'}
        <p>Your projects are in the folder <b>“{library.folder.name}”</b>, and the browser needs your OK to open it again.</p>
        <div class="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onclick={allowFolder}>Allow access to “{library.folder.name}”</Button>
          <Button size="sm" variant="outline" onclick={chooseProjectsFolder}>Choose the folder again…</Button>
        </div>
      {:else}
        <p>Kept in <b>this browser</b> (its database): they stay on this computer, in this browser only.</p>
        {#if folderSupported}
          <p class="text-muted-foreground mt-1 text-xs">Or keep them in a folder on your computer, where you can see, back up and copy them. Your projects here are copied in.</p>
          <Button size="sm" variant="outline" class="mt-2" onclick={chooseProjectsFolder}>Keep projects in a folder…</Button>
        {:else}
          <p class="text-muted-foreground mt-1 text-xs">Keeping projects in a folder needs Chrome or Edge. Export project files to back them up.</p>
        {/if}
      {/if}
    </div>

    <div class="flex items-center gap-2">
      <input type="search" placeholder="Search projects" bind:value={query} class="bg-background flex-1 rounded-md border px-3 py-1.5 text-sm" />
      <Button size="sm" onclick={() => newProject().then(() => (ui.projectsOpen = false))}>+ New</Button>
      <Button size="sm" variant="outline" onclick={() => importInput?.click()}>Import…</Button>
      <input bind:this={importInput} type="file" accept=".humproj,application/json" class="hidden" onchange={(e) => doImport(e.currentTarget.files)} />
    </div>

    <div class="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
      {#each shown as p (p.id)}
        <div class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 {p.id === library.currentId ? 'bg-muted' : ''}">
          <button class="min-w-0 flex-1 text-left" onclick={() => open(p.id)}>
            <span class="block truncate text-sm font-medium">{p.id === library.currentId ? project.name : p.name}{p.id === library.currentId ? ' (open)' : ''}</span>
            <span class="text-muted-foreground text-xs">{when(p.updated)}</span>
          </button>
          <button class="text-muted-foreground hover:text-destructive px-1 text-xs" onclick={() => remove(p.id, p.name)} aria-label="Delete {p.name}">✕</button>
        </div>
      {:else}
        <p class="text-muted-foreground py-6 text-center text-sm">{library.list.length ? 'No project matches.' : 'No saved projects yet.'}</p>
      {/each}
    </div>
  </Dialog.Content>
</Dialog.Root>
