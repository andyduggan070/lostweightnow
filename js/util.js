/* Pure helpers: DOM selectors, date/time formatting, escaping.
   No app state, no side effects at import time. */

export const ML_PER_FLOZ = 29.5735;
export const KG_PER_LB = 0.45359237;

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export function dateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
}
export const todayKey = () => dateKey(new Date());

export function toLocalInputValue(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fmtTime(d) {
  return new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
export function fmtDate(key) {
  const d = new Date(key + "T12:00:00");
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}
export function fmtDuration(mins) {
  mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function parseHM(s) { const [h, m] = s.split(":").map(Number); return h * 60 + m; }
export function fmtHM(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  const d = new Date(); d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function escapeHTML(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
