// js/state.js — in-memory cache + a tiny pub/sub so realtime / writes can
// trigger targeted re-renders without a framework.

export const state = {
  scheduleEntries: [],     // schedule_entries rows
  subreddits: [],          // subreddits rows
  keywords: [],            // keywords rows
  matches: [],             // backfill_matches rows
  activity: [],            // activity_log rows
  backfillMode: 'tuning',  // 'tuning' | 'engagement'
  scheduleStartDate: '2026-05-18',
  actingAs: null,          // engagement-banner "Acting as" selection
};

const listeners = new Map(); // event -> Set<fn>

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => {
    try {
      fn(payload);
    } catch (e) {
      console.error(`[state] listener for "${event}" threw:`, e);
    }
  });
}

// Convenience: replace a slice and notify its channel.
export function setSlice(key, value, event) {
  state[key] = value;
  emit(event || key, value);
}
