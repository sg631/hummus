// How the window is arranged: a docking layout, like a code editor's.
//
// The panels: Tracks, Editor, Playlist, Mixer. Each is in exactly one place:
// - docked: in a stack (tabs) somewhere in a tree of splits (rows and columns). Drag the
//   borders between them to resize.
// - floating: a window of its own over the app (drag its title to move it, its edges to
//   resize it)
// - hidden (View → Panels brings it back)
// Drag a panel's tab: drop it on one of the five targets that appear in the middle of a
// stack (left, right, top, bottom: beside it; centre: a tab in it), or anywhere else to
// float it. DockLayout.svelte draws all this; these functions change it. The layout is kept
// in this browser (localStorage), not in the project.
//
//   showPanel('mixer')            // bring it to the front, wherever it is (or back if hidden)
//   dock('mixer', stackId, 'bottom'); floatPanel('mixer', { x, y }); hidePanel('mixer')
//   applyLayoutPreset('mixer-below'); resetLayout()
import { view } from './view.svelte';

export type Panel = 'tracks' | 'editor' | 'playlist' | 'mixer';
export const PANELS: Panel[] = ['tracks', 'editor', 'playlist', 'mixer'];
export const PANEL_NAMES: Record<Panel, string> = { tracks: 'Tracks', editor: 'Editor', playlist: 'Playlist', mixer: 'Mixer' };

export type DockNode =
  | { type: 'split'; id: string; dir: 'row' | 'col'; children: DockNode[]; sizes: number[] } // sizes: fractions, adding to 1
  | { type: 'stack'; id: string; panels: Panel[]; active: Panel };
type Stack = Extract<DockNode, { type: 'stack' }>;
type Split = Extract<DockNode, { type: 'split' }>;

export interface FloatingPanel {
  panel: Panel;
  x: number; // px from the window's left / top
  y: number;
  w: number;
  h: number;
  z: number; // the last one touched is on top
}

export type Zone = 'left' | 'right' | 'top' | 'bottom' | 'center';

interface Layout {
  root: DockNode | null;
  floating: FloatingPanel[];
}

const KEY = 'hum-daw:dock-layout';
let n = 0;
const id = () => `n${Date.now().toString(36)}${(n++).toString(36)}`;
const stack = (panels: Panel[], active = panels[0]): Stack => ({ type: 'stack', id: id(), panels, active });
const split = (dir: 'row' | 'col', children: DockNode[], sizes: number[]): Split => ({ type: 'split', id: id(), dir, children, sizes });

export const PRESETS = {
  default: { name: 'Tracks + one big panel (tabs)', make: () => split('row', [stack(['tracks']), stack(['editor', 'playlist', 'mixer'])], [0.2, 0.8]) },
  'editor-playlist': {
    name: 'Editor over playlist',
    make: () => split('row', [stack(['tracks']), split('col', [stack(['editor']), stack(['playlist', 'mixer'])], [0.55, 0.45])], [0.2, 0.8])
  },
  'mixer-below': {
    name: 'Mixer below',
    make: () => split('row', [stack(['tracks']), split('col', [stack(['editor', 'playlist']), stack(['mixer'])], [0.62, 0.38])], [0.2, 0.8])
  },
  wide: {
    name: 'Everything at once',
    make: () => split('col', [split('row', [stack(['tracks']), stack(['editor']), stack(['playlist'])], [0.2, 0.45, 0.35]), stack(['mixer'])], [0.68, 0.32])
  }
} satisfies Record<string, { name: string; make: () => DockNode }>;
export type PresetName = keyof typeof PRESETS;

function load(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Layout | null;
    if (saved && (saved.root || saved.floating?.length)) return { root: saved.root, floating: saved.floating ?? [] };
  } catch {
    // unreadable: the default
  }
  return { root: PRESETS.default.make(), floating: [] };
}

export const layout = $state<Layout>(typeof localStorage === 'undefined' ? { root: PRESETS.default.make(), floating: [] } : load());

export function saveLayout() {
  try {
    localStorage.setItem(KEY, JSON.stringify($state.snapshot(layout)));
  } catch {
    // private window or storage full: not remembered
  }
}

// ---------- Finding things ----------

export function stacks(node: DockNode | null = layout.root): Stack[] {
  if (!node) return [];
  return node.type === 'stack' ? [node] : node.children.flatMap((c) => stacks(c));
}

export function stackOf(panel: Panel): Stack | undefined {
  return stacks().find((s) => s.panels.includes(panel));
}

// Whether a panel is on screen: the open tab of its stack, or floating.
export function visible(panel: Panel): boolean {
  return stackOf(panel)?.active === panel || layout.floating.some((f) => f.panel === panel);
}

export function hiddenPanels(): Panel[] {
  return PANELS.filter((p) => !stackOf(p) && !layout.floating.some((f) => f.panel === p));
}

// ---------- Changing it ----------

// Takes a panel out of wherever it is (a stack, or floating). Empty stacks go, and a split
// left with one child becomes that child.
function detach(panel: Panel) {
  layout.floating = layout.floating.filter((f) => f.panel !== panel);
  const s = stackOf(panel);
  if (!s) return;
  s.panels = s.panels.filter((p) => p !== panel);
  if (s.active === panel) s.active = s.panels[0];
  if (!s.panels.length) layout.root = prune($state.snapshot(layout.root) as DockNode | null, s.id);
}

function prune(node: DockNode | null, removeId: string): DockNode | null {
  if (!node || node.id === removeId) return null;
  if (node.type === 'stack') return node;
  const kept: DockNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((c, i) => {
    const p = prune(c, removeId);
    if (p) {
      kept.push(p);
      sizes.push(node.sizes[i]);
    }
  });
  if (!kept.length) return null;
  if (kept.length === 1) return kept[0];
  const total = sizes.reduce((a, b) => a + b, 0);
  return { ...node, children: kept, sizes: sizes.map((s) => s / total) };
}

// Docks a panel next to (or into) a stack.
export function dock(panel: Panel, stackId: string, zone: Zone) {
  const own = stackOf(panel);
  if (own?.id === stackId && zone === 'center') return finish(panel);
  if (own?.id === stackId && own.panels.length === 1) return finish(panel); // beside itself: nothing to do
  detach(panel);
  const target = stacks().find((s) => s.id === stackId);
  if (!target) {
    layout.root = layout.root ? split('row', [$state.snapshot(layout.root) as DockNode, stack([panel])], [0.7, 0.3]) : stack([panel]);
    return finish(panel);
  }
  if (zone === 'center') {
    target.panels = [...target.panels, panel];
    target.active = panel;
    return finish(panel);
  }
  const dir = zone === 'left' || zone === 'right' ? 'row' : 'col';
  const before = zone === 'left' || zone === 'top';
  layout.root = insertBeside($state.snapshot(layout.root) as DockNode, stackId, stack([panel]), dir, before);
  finish(panel);
}

function insertBeside(node: DockNode, targetId: string, fresh: DockNode, dir: 'row' | 'col', before: boolean): DockNode {
  if (node.id === targetId) return split(dir, before ? [fresh, node] : [node, fresh], before ? [0.35, 0.65] : [0.65, 0.35]);
  if (node.type === 'stack') return node;
  const i = node.children.findIndex((c) => c.id === targetId);
  if (i >= 0 && node.dir === dir) {
    // The same direction as its parent: a sibling, taking half of the target's room.
    const children = [...node.children];
    const sizes = [...node.sizes];
    const half = sizes[i] / 2;
    sizes[i] = half;
    children.splice(before ? i : i + 1, 0, fresh);
    sizes.splice(before ? i : i + 1, 0, half);
    return { ...node, children, sizes };
  }
  return { ...node, children: node.children.map((c) => insertBeside(c, targetId, fresh, dir, before)) };
}

let topZ = 1;
// A panel as a floating window at (x, y) (its title bar), keeping its last size.
export function floatPanel(panel: Panel, at: { x: number; y: number; w?: number; h?: number }) {
  const was = layout.floating.find((f) => f.panel === panel);
  detach(panel);
  const w = at.w ?? was?.w ?? Math.round(Math.min(720, window.innerWidth * 0.5));
  const h = at.h ?? was?.h ?? Math.round(Math.min(480, window.innerHeight * 0.5));
  layout.floating = [...layout.floating, { panel, x: clampX(at.x, w), y: clampY(at.y), w, h, z: ++topZ }];
  finish(panel);
}

const clampX = (x: number, w: number) => Math.round(Math.max(-w + 80, Math.min(window.innerWidth - 80, x)));
const clampY = (y: number) => Math.round(Math.max(0, Math.min(window.innerHeight - 40, y)));

export function moveFloating(panel: Panel, x: number, y: number) {
  const f = layout.floating.find((p) => p.panel === panel);
  if (f) Object.assign(f, { x: clampX(x, f.w), y: clampY(y) });
}

export function resizeFloating(panel: Panel, w: number, h: number) {
  const f = layout.floating.find((p) => p.panel === panel);
  if (f) Object.assign(f, { w: Math.round(Math.max(260, w)), h: Math.round(Math.max(160, h)) });
}

export function raise(panel: Panel) {
  const f = layout.floating.find((p) => p.panel === panel);
  if (f && f.z !== topZ) f.z = ++topZ;
}

export function hidePanel(panel: Panel) {
  detach(panel);
  saveLayout();
}

// Brings a panel to the front: its tab, its window, or back from hidden (as a tab beside
// the editor, or wherever there's room).
export function showPanel(panel: Panel) {
  if (!stackOf(panel) && !layout.floating.some((f) => f.panel === panel)) {
    const home = stackOf('editor') ?? stackOf('playlist') ?? stacks()[0];
    if (home) home.panels = [...home.panels, panel];
    else layout.root = stack([panel]);
    saveLayout();
  }
  const s = stackOf(panel);
  if (s) s.active = panel;
  raise(panel);
}

function finish(panel: Panel) {
  const s = stackOf(panel);
  if (s) s.active = panel;
  raise(panel);
  saveLayout();
}

// A tab clicked.
export function setActive(stackId: string, panel: Panel) {
  const s = stacks().find((x) => x.id === stackId);
  if (!s) return;
  s.active = panel;
  if (panel !== 'tracks') view.main = panel;
  saveLayout();
}

export function setSizes(splitId: string, sizes: number[]) {
  const find = (node: DockNode | null): Split | undefined => {
    if (!node || node.type === 'stack') return;
    if (node.id === splitId) return node;
    for (const c of node.children) {
      const f = find(c);
      if (f) return f;
    }
  };
  const s = find(layout.root);
  if (s) s.sizes = sizes;
}

export function applyLayoutPreset(name: PresetName) {
  layout.root = PRESETS[name].make();
  layout.floating = [];
  saveLayout();
}

export function resetLayout() {
  applyLayoutPreset('default');
}

// ---------- Keyboard focus ----------
// The panel last clicked in. With two editing panels on screen, keyboard shortcuts (Delete,
// Ctrl+A, arrows…) go to that one only.
export const activePanel = $state({ panel: null as Panel | null });

// Whether a panel's shortcuts should act: it's the only editing panel on screen, or the one
// last clicked (nothing clicked yet: the editor).
// The guide lays panels out itself (GuideStage.svelte): it says which are on screen.
export const guideScreen = $state({ panels: null as Panel[] | null });

export function keysFor(panel: Panel): boolean {
  const onScreen = (['editor', 'playlist'] as Panel[]).filter((p) => (guideScreen.panels ? guideScreen.panels.includes(p) : visible(p)));
  return onScreen.length <= 1 || (activePanel.panel ?? 'editor') === panel;
}

// ---------- Dragging a panel ----------
// A tab dragged out of its stack, or a floating window by its title. While dragging, each
// stack shows five drop targets (DockNode.svelte); `over` is the one under the pointer.
export const panelDrag = $state({
  active: false,
  panel: null as Panel | null,
  floating: false, // a floating window being moved (it follows the pointer)
  x: 0,
  y: 0,
  over: null as { stackId: string; zone: Zone } | null
});

// Starts watching a press on a tab (or a floating window's title). It becomes a drag once
// the pointer moves a few pixels; a plain click calls `onClick`.
export function pressPanel(e: PointerEvent, panel: Panel, onClick?: () => void) {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  const f = layout.floating.find((p) => p.panel === panel);
  const grab = f ? { dx: x0 - f.x, dy: y0 - f.y } : { dx: 60, dy: 14 };
  const move = (ev: PointerEvent) => {
    if (!panelDrag.active) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      Object.assign(panelDrag, { active: true, panel, floating: !!f, over: null });
      document.body.classList.add('panel-dragging');
    }
    panelDrag.x = ev.clientX;
    panelDrag.y = ev.clientY;
    if (f) moveFloating(panel, ev.clientX - grab.dx, ev.clientY - grab.dy);
    panelDrag.over = null;
    for (const el of document.elementsFromPoint(ev.clientX, ev.clientY)) {
      const t = (el as HTMLElement).dataset?.dockZone;
      if (t) {
        const [stackId, zone] = t.split(':');
        panelDrag.over = { stackId, zone: zone as Zone };
        break;
      }
    }
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('keydown', key);
    document.body.classList.remove('panel-dragging');
    if (!panelDrag.active) return onClick?.();
    const over = panelDrag.over;
    Object.assign(panelDrag, { active: false, panel: null, over: null });
    if (over) dock(panel, over.stackId, over.zone);
    else if (!f) floatPanel(panel, { x: ev.clientX - grab.dx, y: ev.clientY - grab.dy });
    else saveLayout();
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.classList.remove('panel-dragging');
    Object.assign(panelDrag, { active: false, panel: null, over: null });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
  window.addEventListener('keydown', key);
}
