// The guided tour (components/app/AppTour.svelte): whether it's showing, and whether this
// browser has seen it (finished or skipped), so it only starts by itself the first time.
// The Tour button in the top bar starts it again any time.
const STORAGE_KEY = 'hum-daw:tour-done';

export const tour = $state({
  open: false,
  run: 0 // counts starts, so each start begins again at step 1
});

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function startTour() {
  tour.run++;
  tour.open = true;
}

// Finished or skipped: don't start by itself again.
export function endTour() {
  tour.open = false;
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // storage blocked: it will offer itself again next time, that's all
  }
}
