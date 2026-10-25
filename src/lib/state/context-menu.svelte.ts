// Right-click menus. One menu for the whole app (components/app/ContextMenu.svelte draws
// it); anything can open it with its own items:
//
//   <div use:contextMenu={() => [{ label: 'Rename', action: rename }, { separator: true }, …]}>
//
// The items are worked out when the menu opens, so they can depend on the current state
// ("Mute" or "Unmute"…).
export interface MenuItem {
  label?: string;
  action?: () => void;
  disabled?: boolean;
  danger?: boolean;     // drawn in red (delete…)
  checked?: boolean;    // shows a tick (on/off settings)
  shortcut?: string;    // shown on the right, e.g. 'Ctrl+D'
  separator?: boolean;  // a line instead of an item
}

export const menu = $state({
  open: false,
  x: 0,
  y: 0,
  items: [] as MenuItem[]
});

export function openMenu(e: MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  if (!items.length) return;
  menu.items = items;
  menu.x = e.clientX;
  menu.y = e.clientY;
  menu.open = true;
}

export function closeMenu() {
  menu.open = false;
}

// A Svelte action: right-clicking the element opens a menu with these items.
export function contextMenu(node: Element, getItems: () => MenuItem[]) {
  let items = getItems;
  const handler = (e: Event) => openMenu(e as MouseEvent, items());
  node.addEventListener('contextmenu', handler);
  return {
    update(next: () => MenuItem[]) {
      items = next;
    },
    destroy() {
      node.removeEventListener('contextmenu', handler);
    }
  };
}
