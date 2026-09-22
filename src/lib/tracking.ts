// The first day this device ran with each kind of tracking. Carry-overs and
// pickups from before it were never recorded, so the statistics view shows
// those days as unknown rather than as a clean zero. Per device: a best effort
// that errs on the side of "not tracked".

const CARRY_KEY = "tasks:carryTrackingSince";
const PICKUP_KEY = "tasks:pickupTrackingSince";

// Remembers today as the start the first time it's called; returns the start.
function trackingSince(key: string, today: string): string {
  try {
    const stored = localStorage.getItem(key);
    if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
    localStorage.setItem(key, today);
  } catch {
    // No storage: treat tracking as starting now, every time
  }
  return today;
}

export const carryTrackingSince = (today: string) => trackingSince(CARRY_KEY, today);

// Pickups (moves into In Progress) and the time log began together, a release
// after carry-overs
export const pickupTrackingSince = (today: string) => trackingSince(PICKUP_KEY, today);
