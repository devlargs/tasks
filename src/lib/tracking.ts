// The first day this device ran with carry-over tracking. Carry-overs from
// before it were never recorded, so the statistics view shows those days as
// unknown rather than as a clean zero. Per device: a best effort that errs on
// the side of "not tracked".

const TRACKING_KEY = "tasks:carryTrackingSince";

// Remembers today as the start the first time it's called; returns the start.
export function carryTrackingSince(today: string): string {
  try {
    const stored = localStorage.getItem(TRACKING_KEY);
    if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
    localStorage.setItem(TRACKING_KEY, today);
  } catch {
    // No storage: treat tracking as starting now, every time
  }
  return today;
}
