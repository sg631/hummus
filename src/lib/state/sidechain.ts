// The quick way to sidechain: right-click a track (card or mixer strip) → "Duck under
// <track>". Adds a sidechain effect listening to that track (music/effects.ts 'sidechain').
import type { MenuItem } from './context-menu.svelte';
import { addSidechain, effectOwner, sidechainSources } from './project.svelte';
import { ui } from './ui.svelte';

export function sidechainMenu(ownerId: string): MenuItem[] {
  const sources = sidechainSources(ownerId);
  if (!sources.length) return [];
  const current = effectOwner(ownerId)?.effects.find((e) => e.type === 'sidechain')?.source;
  return [
    { label: 'Sidechain: duck this whenever…', disabled: true },
    ...sources.map((s) => ({
      label: `   …“${s.name}” plays`,
      checked: current === s.id,
      action: () => {
        addSidechain(ownerId, s.id);
        ui.message = `Ducks under “${s.name}” (its Sidechain effect sets how much)`;
        setTimeout(() => (ui.message = ''), 2500);
      }
    }))
  ];
}
