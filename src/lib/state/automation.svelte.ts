// Automating a setting from wherever its control is.
//
// Ctrl+drag a knob (or a fader, the tempo, the time signature) onto an automation lane in
// the playlist: that lane now changes it over the song. Lanes are made first, empty
// ("+ Lane" in the playlist). Let go anywhere else and nothing happens.
// - dragged out of a window (an effect's settings…), the window fades and lets the pointer
//   through, so you can drop on the playlist behind it
// - if the playlist isn't on screen, a preview of its lanes comes up to drop on
//   (AutomationDrop.svelte)
// Right-click a knob for the same without dragging: "Automate in <lane>".
//
//   startKnobDrag(event, target, element)   // from a control's Ctrl+pointerdown
//   automationMenu(target)                  // right-click menu items for a control
//   shown(lane, value)                      // what a control shows while the song plays
import { targetInfo, targetKey, valueAt } from '$lib/music/automation';
import type { AutomationLane, AutomationTarget } from '$lib/music/types';
import { openMenu, type MenuItem } from './context-menu.svelte';
import { visible } from './layout.svelte';
import { playhead } from './playhead.svelte';
import { addAutomation, assignLane, project } from './project.svelte';
import { addPoint } from '$lib/music/automation';
import { ui } from './ui.svelte';
import { view } from './view.svelte';

export const knobDrag = $state({
  active: false,
  target: null as AutomationTarget | null,
  label: '', // "Bass: Volume"
  x: 0,
  y: 0,
  overLane: null as string | null, // the lane under the pointer
  preview: false // the playlist isn't on screen: show the drop preview
});

function say(text: string) {
  ui.message = text;
  setTimeout(() => ui.message === text && (ui.message = ''), 2500);
}

const playlistOnScreen = () => visible('playlist');

let sourceDialog: Element | null = null;

function laneUnder(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const lane = (el as HTMLElement).closest?.('[data-automation-lane]') as HTMLElement | null;
    if (lane) return lane.dataset.automationLane ?? null;
  }
  return null;
}

function onMove(e: PointerEvent) {
  knobDrag.x = e.clientX;
  knobDrag.y = e.clientY;
  // Outside the window it started in: fade the window, let the pointer through it.
  let outside = false;
  if (sourceDialog) {
    const r = sourceDialog.getBoundingClientRect();
    outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  }
  document.body.classList.toggle('knob-drag-outside', outside);
  knobDrag.overLane = laneUnder(e.clientX, e.clientY);
}

function onUp() {
  const laneId = knobDrag.overLane;
  const target = knobDrag.target;
  end();
  if (!laneId || !target) {
    say('Not on an automation lane: nothing changed');
    return;
  }
  dropOn(laneId, target);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') end();
}

function end() {
  knobDrag.active = false;
  knobDrag.target = null;
  knobDrag.overLane = null;
  knobDrag.preview = false;
  sourceDialog = null;
  document.body.classList.remove('knob-dragging', 'knob-drag-outside');
  window.removeEventListener('pointermove', onMove, true);
  window.removeEventListener('pointerup', onUp, true);
  window.removeEventListener('keydown', onKey, true);
}

// A lane takes the setting (or says which lane already has it).
function dropOn(laneId: string, target: AutomationTarget) {
  const lane = assignLane(laneId, target);
  const info = targetInfo(project, target);
  if (!lane || !info) return;
  if (lane.id !== laneId) say(`${info.owner}: ${info.label} already has a lane: “${laneName(lane)}”`);
  else say(`“${laneName(lane)}” now changes ${info.owner}: ${info.label}`);
}

// Starts dragging a control's setting (call from its Ctrl+pointerdown).
export function startKnobDrag(e: PointerEvent | MouseEvent, target: AutomationTarget, source: Element) {
  const info = targetInfo(project, target);
  if (!info) return;
  e.preventDefault();
  e.stopPropagation();
  Object.assign(knobDrag, {
    active: true,
    target,
    label: `${info.owner}: ${info.label}`,
    x: e.clientX,
    y: e.clientY,
    overLane: null,
    preview: !playlistOnScreen()
  });
  sourceDialog = source.closest('[data-slot="dialog-content"]');
  document.body.classList.add('knob-dragging');
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('keydown', onKey, true);
}

export function laneName(lane: AutomationLane): string {
  const info = targetInfo(project, lane.target);
  return info ? `${info.owner}: ${info.label}` : (lane.name ?? 'Automation');
}

// The lane a setting has (on or off), if any.
export function laneOf(target: AutomationTarget): AutomationLane | undefined {
  const key = targetKey(target);
  return project.automation.find((l) => l.target && targetKey(l.target) === key);
}

function showLane(lane: AutomationLane) {
  if (!playlistOnScreen()) view.main = 'playlist';
  view.focusLane = lane.id; // the playlist scrolls to it
}

// Makes (or finds) a setting's lane and shows it.
export function automate(target: AutomationTarget) {
  const lane = addAutomation(target);
  if (lane) showLane(lane);
}

// A control's right-click items: its lane, or the empty lanes to automate it in.
export function automationMenu(target: AutomationTarget): MenuItem[] {
  if (!targetInfo(project, target)) return [];
  const own = laneOf(target);
  if (own) return [{ label: `Show its automation (“${laneName(own)}”)`, action: () => showLane(own) }];
  const empty = project.automation.filter((l) => !l.target);
  return [
    ...empty.map((l) => ({ label: `Automate in “${l.name ?? 'Automation'}”`, action: () => dropOn(l.id, target) })),
    ...(empty.length ? [] : [{ label: 'Automate: make a lane first (playlist → + Lane), or…', disabled: true }]),
    { label: 'Automate in a new lane', action: () => automate(target) }
  ];
}

// The value a control shows: while the song plays, where its lane is now; otherwise its
// own value. (Automation plays in Song mode only.)
export function shown(lane: AutomationLane | undefined, value: number): number {
  if (!lane?.enabled || !lane.points.length || !playhead.running || playhead.pattern) return value;
  const info = targetInfo(project, lane.target);
  return valueAt(lane.points, Math.max(0, playhead.ticks), info?.stepped) ?? value;
}

// A Svelte action for anything else that controls a song setting (mute and solo buttons, an
// effect's on/off switch, the tempo field…): Ctrl+drag it onto a lane, or right-click it.
//   <button use:automatable={{ kind: 'mix', ownerId: track.id, param: 'mute' }}>M</button>
export function automatable(node: HTMLElement, target: AutomationTarget | false) {
  let current = target;
  const down = (e: PointerEvent) => {
    if (current && e.button === 0 && (e.ctrlKey || e.metaKey)) startKnobDrag(e, current, node);
  };
  const menu = (e: MouseEvent) => {
    if (current) openMenu(e, automationMenu(current));
  };
  node.addEventListener('pointerdown', down, true);
  node.addEventListener('contextmenu', menu);
  return {
    update(next: AutomationTarget | false) {
      current = next;
    },
    destroy() {
      node.removeEventListener('pointerdown', down, true);
      node.removeEventListener('contextmenu', menu);
    }
  };
}

// ---------- Recording automation ----------
// With `automationWrite.on` (Transport → Record automation), turning a knob or fader while the
// song plays writes its moves into its lane (made if needed), replacing the points it passes
// over. Controls call `touchAutomation(target)` after the user changes them.
export const automationWrite = $state({ on: false });
const lastWrite = new Map<string, number>(); // lane id → the tick written last, this pass
const MIN_GAP = 15; // ticks between written points (about a 32nd of a beat)

export function touchAutomation(target: AutomationTarget) {
  if (!automationWrite.on || !playhead.running || playhead.pattern) return;
  const info = targetInfo(project, target);
  if (!info) return;
  const tick = Math.max(0, Math.round(playhead.ticks));
  const lane = addAutomation(target);
  if (!lane) return;
  lane.enabled = true;
  const from = lastWrite.get(lane.id);
  if (from !== undefined && tick - from < MIN_GAP && tick >= from) return;
  // Points between the last write and now are written over.
  const kept = from === undefined || tick < from ? lane.points : lane.points.filter((p) => p.tick <= from || p.tick > tick);
  lane.points = addPoint(kept, { tick, value: info.value });
  lastWrite.set(lane.id, tick);
}

// A new pass (Play pressed again): writing starts fresh.
export function resetAutomationWrite() {
  lastWrite.clear();
}
