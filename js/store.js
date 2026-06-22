/* App state + persistence. `state` is a live binding: read it directly from
   any module; replace the whole object only via replaceState(). save() persists
   and notifies a registered hook (used by cloud sync) so this module needs no
   dependency on the sync layer. */

export const STORE_KEY = "lwn-state-v1";

export const defaultState = () => ({
  profile: { age: null, sex: "", heightCm: null, startWeightKg: null, weightUnit: "kg", waterUnit: "ml" },
  goal: { weightKg: null, date: null, startWeightKg: null, startDate: null },
  fasting: { start: "12:00", end: "20:00" },
  waterGoalMl: 2000,
  water: {},   // dateKey -> [{ml, ts, type}]
  meals: [],   // {id, desc, time(ISO), portion, flags, tone, message}
  weights: [], // {date, kg, ts} sorted by date
  activities: [], // {id, type, start(ISO), end(ISO), distance?, intensity}
  tombstones: {}, // deletion markers "type:key" -> ts, so deletes survive sync merges
  updatedAt: 0 // last local change, used to resolve sync conflicts
});

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* corrupted -> start fresh */ }
  return defaultState();
}

export let state = load();

export function replaceState(next) { state = next; }
export function persist() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

let onSave = null;
export function setOnSave(fn) { onSave = fn; }

export function save() {
  state.updatedAt = Date.now();
  persist();
  if (onSave) onSave();
}

export function latestWeight() {
  return state.weights.length ? state.weights[state.weights.length - 1] : null;
}
