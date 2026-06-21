// Smoke-tests the pure logic inside app.js (fasting window, coaching, goal trajectory)
// by evaluating the relevant slice of the file with stubbed browser globals.
import { readFileSync } from "fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const slice = (from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to);
  if (a < 0 || b < 0) throw new Error(`marker not found: ${from} / ${to}`);
  return src.slice(a, b);
};

const logic =
  slice("const STORE_KEY", "/* ---------------- rendering: fasting") +
  src.slice(src.indexOf("function expectedWeightKg"), src.indexOf("function renderGoalStatus"));

global.localStorage = { getItem: () => null, setItem: () => {} };
global.document = { querySelector: () => null, querySelectorAll: () => [] };

const api = new Function(
  logic +
  "\nreturn { state, windowInfo, analyzeMeal, nextMealAdvice, expectedWeightKg, fmtWater, kgToDisplay, displayToKg, dateKey, logBeverage, BEVERAGES };"
)();

let failures = 0;
const check = (name, cond, extra = "") => {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
  else console.log(`ok    ${name}`);
};

const { state } = api;
const at = (h, m = 0) => { const d = new Date(2026, 5, 12); d.setHours(h, m, 0, 0); return d; };

// --- fasting window 12:00-20:00 (default) ---
let w = api.windowInfo(at(14));
check("14:00 is inside 12-20 window", w.inWindow === true);
check("minsToEnd at 14:00 is 360", w.minsToEnd === 360, `got ${w.minsToEnd}`);

w = api.windowInfo(at(9));
check("09:00 is outside window", w.inWindow === false);
check("next start in 180 min", w.minsToNextStart === 180, `got ${w.minsToNextStart}`);

w = api.windowInfo(at(22));
check("22:00 is outside window", w.inWindow === false);
check("next start in 840 min (tomorrow noon)", w.minsToNextStart === 840, `got ${w.minsToNextStart}`);

// --- overnight window 20:00-04:00 ---
state.fasting = { start: "20:00", end: "04:00" };
w = api.windowInfo(at(22));
check("22:00 inside overnight window", w.inWindow === true);
check("overnight window length 480", w.windowLen === 480, `got ${w.windowLen}`);
check("overnight minsToEnd at 22:00 is 360", w.minsToEnd === 360, `got ${w.minsToEnd}`);
w = api.windowInfo(at(2));
check("02:00 inside overnight window", w.inWindow === true);
check("overnight minsToEnd at 02:00 is 120", w.minsToEnd === 120, `got ${w.minsToEnd}`);
w = api.windowInfo(at(10));
check("10:00 outside overnight window", w.inWindow === false);
check("10:00 -> next start in 600", w.minsToNextStart === 600, `got ${w.minsToNextStart}`);
state.fasting = { start: "12:00", end: "20:00" };

// --- coaching ---
let a = api.analyzeMeal("grilled chicken salad with avocado", "medium", at(13));
check("healthy meal tone is good", a.tone === "good", `got ${a.tone}`);
check("healthy meal flags found", a.flags.some(f => f.label === "lean protein") && a.flags.some(f => f.label === "vegetables"));

a = api.analyzeMeal("large fries and a cola", "large", at(13));
check("junk meal tone warns", a.tone === "warn", `got ${a.tone}`);
check("junk meal flags fried+sugary drink", a.flags.some(f => f.label === "fried food") && a.flags.some(f => f.label === "sugary drink"));

a = api.analyzeMeal("banana", "medium", at(9));
check("meal at 09:00 mentions window breach", a.message.includes("outside your"), a.message);
check("breach message recommends next meal time", /next recommended meal/i.test(a.message), a.message);

a = api.analyzeMeal("mystery stew", "extra-large", at(13));
check("extra-large portion always warns", a.tone === "warn");

check("nextMealAdvice empty when window open", api.nextMealAdvice(at(13)) === "");
check("nextMealAdvice names the time when fasting", /next recommended meal is at/i.test(api.nextMealAdvice(at(8))));

// --- goal trajectory ---
state.goal = { startWeightKg: 100, startDate: "2026-06-01", weightKg: 90, date: "2026-08-30" };
const mid = new Date("2026-07-15T12:00:00");
const exp = api.expectedWeightKg(mid);
check("expected weight at midpoint ~95kg", Math.abs(exp - 95.11) < 0.2, `got ${exp}`);
check("expected weight before start clamps to start", api.expectedWeightKg(new Date("2026-05-20T12:00:00")) === 100);
check("expected weight after end clamps to goal", api.expectedWeightKg(new Date("2026-12-01T12:00:00")) === 90);

// --- units ---
state.profile.weightUnit = "lb";
check("kg->lb", Math.abs(api.kgToDisplay(100) - 220.46) < 0.01, `got ${api.kgToDisplay(100)}`);
check("lb->kg roundtrip", Math.abs(api.displayToKg(api.kgToDisplay(82.5)) - 82.5) < 1e-9);
state.profile.waterUnit = "floz";
check("ml->floz format", api.fmtWater(500) === "16.9 fl oz", `got ${api.fmtWater(500)}`);

// --- beverages ---
state.profile.weightUnit = "kg";
state.profile.waterUnit = "ml";
state.fasting = { start: "12:00", end: "20:00" };
state.water = {}; state.meals = [];
const noon = at(13);

let r = api.logBeverage("coffee", "medium", noon);
check("coffee is hydrating", r.hydrating === true, JSON.stringify(r));
check("coffee added to water store", (state.water[api.dateKey(noon)] || []).reduce((s, e) => s + e.ml, 0) === 350, JSON.stringify(state.water));
check("coffee NOT added to meals", state.meals.length === 0, `meals=${state.meals.length}`);
check("coffee carries a coaching note", typeof r.note === "string" && r.note.length > 0);

r = api.logBeverage("tea", "small", noon);
check("tea is hydrating", r.hydrating === true);
check("hydration total now 350+250=600", (state.water[api.dateKey(noon)] || []).reduce((s, e) => s + e.ml, 0) === 600);

r = api.logBeverage("soft_drink", "large", noon);
check("soft drink is NOT hydrating", r.hydrating === false, JSON.stringify(r));
check("soft drink added to meals", state.meals.length === 1, `meals=${state.meals.length}`);
check("soft drink flagged as sugary drink", r.analysis.flags.some(f => f.label === "sugary drink" && f.type === "bad"), JSON.stringify(r.analysis.flags));
check("soft drink did NOT add to hydration", (state.water[api.dateKey(noon)] || []).reduce((s, e) => s + e.ml, 0) === 600);
check("soft drink meal desc shows volume", /Soft drink — /.test(state.meals[0].desc), state.meals[0].desc);

r = api.logBeverage("juice", "medium", noon);
check("fruit juice routed to meals as sugary drink", r.hydrating === false && r.analysis.flags.some(f => f.label === "sugary drink"));

r = api.logBeverage("alcohol", "medium", noon);
check("alcohol routed to meals and flagged", r.hydrating === false && r.analysis.flags.some(f => f.label === "alcohol"));

r = api.logBeverage("diet_soft", "medium", noon);
check("diet soft drink counts as hydration", r.hydrating === true);

// caloric drink outside the eating window should be coached as a fast breach
state.water = {}; state.meals = [];
r = api.logBeverage("soft_drink", "medium", at(9));
check("soft drink at 09:00 flagged outside window", r.analysis.message.includes("outside your"), r.analysis.message);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
