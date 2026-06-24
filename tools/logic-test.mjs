// Unit tests for the DOM-free logic, importing the real ES modules directly
// (no source slicing). Browser globals the modules touch at import are stubbed.
function makeLocalStorage() {
  const s = {};
  return {
    getItem: (k) => (k in s ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: (k) => { delete s[k]; }
  };
}
global.localStorage = makeLocalStorage();
Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });

const util = await import("../js/util.js");
const store = await import("../js/store.js");
const domain = await import("../js/domain.js");
const { state } = store;
const { dateKey } = util;

let failures = 0;
const check = (name, cond, extra = "") => {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
  else console.log(`ok    ${name}`);
};

const at = (h, m = 0) => { const d = new Date(2026, 5, 12); d.setHours(h, m, 0, 0); return d; };

// --- sliding eating window (anchored to first meal) ---
state.fasting = { start: "12:00", windowHours: 8 };
state.extendedFast = null;
state.meals = [];

let fs = domain.fastingState(at(9));
check("before planned start with no meal -> prestart", fs.mode === "prestart", fs.mode);
fs = domain.fastingState(at(13));
check("past planned start with no meal -> ready", fs.mode === "ready", fs.mode);

// first meal at 14:30 -> window opens then, closes 22:30 (8h later)
domain.addMeal("lunch", "medium", at(14, 30));
fs = domain.fastingState(at(15));
check("after first meal -> eating window open", fs.mode === "eating", fs.mode);
check("window closes 8h after first meal (22:30)", new Date(fs.close).getHours() === 22 && new Date(fs.close).getMinutes() === 30, new Date(fs.close).toString());
check("meal within the window is not outside", domain.isOutsideWindow(at(20)) === false);
check("meal after the window close is outside", domain.isOutsideWindow(at(23)) === true);
check("after the close time -> closed", domain.fastingState(at(23)).mode === "closed");
state.meals = [];

// breach coaching: first meal at noon, then a meal at 21:00 (>8h later)
domain.addMeal("first", "medium", at(12));
let a = domain.analyzeMeal("banana", "medium", at(21));
check("late meal flagged outside the window", a.message.includes("outside your"), a.message);
state.meals = [];

check("nextMealAdvice empty when ready to eat", domain.nextMealAdvice(at(13)) === "");
check("nextMealAdvice names planned time before start", /planned to open at/i.test(domain.nextMealAdvice(at(9))));

// --- extended fast ---
domain.addMeal("dinner", "medium", at(20));   // anchors the fast at 20:00
domain.startExtendedFast(40, at(21));
fs = domain.fastingState(at(21));
check("extended fast mode active for 40h", fs.mode === "extended" && fs.hours === 40);
check("extended fast anchored to last meal (60 min elapsed at 21:00)", Math.round(fs.elapsedMin) === 60, `got ${fs.elapsedMin}`);
check("a meal during the fast is not an out-of-window breach", domain.isOutsideWindow(at(22)) === false);
check("extendedFast() returns the active fast", !!domain.extendedFast());
domain.endExtendedFast();
check("endExtendedFast clears it", domain.extendedFast() === null);
state.meals = [];
state.extendedFast = null;

// --- coaching basics ---
a = domain.analyzeMeal("grilled chicken salad with avocado", "medium", at(13));
check("healthy meal tone is good", a.tone === "good", `got ${a.tone}`);
check("healthy meal flags found", a.flags.some(f => f.label === "lean protein") && a.flags.some(f => f.label === "vegetables"));

a = domain.analyzeMeal("large fries and a cola", "large", at(13));
check("junk meal tone warns", a.tone === "warn", `got ${a.tone}`);
check("junk meal flags fried+sugary drink", a.flags.some(f => f.label === "fried food") && a.flags.some(f => f.label === "sugary drink"));

a = domain.analyzeMeal("mystery stew", "extra-large", at(13));
check("extra-large portion always warns", a.tone === "warn");

// --- goal trajectory ---
state.goal = { startWeightKg: 100, startDate: "2026-06-01", weightKg: 90, date: "2026-08-30" };
const exp = domain.expectedWeightKg(new Date("2026-07-15T12:00:00"));
check("expected weight at midpoint ~95kg", Math.abs(exp - 95.11) < 0.2, `got ${exp}`);
check("expected weight before start clamps to start", domain.expectedWeightKg(new Date("2026-05-20T12:00:00")) === 100);
check("expected weight after end clamps to goal", domain.expectedWeightKg(new Date("2026-12-01T12:00:00")) === 90);

// --- units ---
state.profile.weightUnit = "lb";
check("kg->lb", Math.abs(domain.kgToDisplay(100) - 220.46) < 0.01, `got ${domain.kgToDisplay(100)}`);
check("lb->kg roundtrip", Math.abs(domain.displayToKg(domain.kgToDisplay(82.5)) - 82.5) < 1e-9);
state.profile.waterUnit = "floz";
check("ml->floz format", domain.fmtWater(500) === "16.9 fl oz", `got ${domain.fmtWater(500)}`);

// --- beverages ---
state.profile.weightUnit = "kg";
state.profile.waterUnit = "ml";
state.fasting = { start: "12:00", end: "20:00" };
state.water = {}; state.meals = [];
const noon = at(13);

let r = domain.logBeverage("coffee", "medium", noon);
check("coffee is hydrating", r.hydrating === true, JSON.stringify(r));
check("coffee added to water store", (state.water[dateKey(noon)] || []).reduce((s, e) => s + e.ml, 0) === 350, JSON.stringify(state.water));
check("coffee NOT added to meals", state.meals.length === 0, `meals=${state.meals.length}`);
check("coffee carries a coaching note", typeof r.note === "string" && r.note.length > 0);

r = domain.logBeverage("tea", "small", noon);
check("hydration total now 350+250=600", (state.water[dateKey(noon)] || []).reduce((s, e) => s + e.ml, 0) === 600);

r = domain.logBeverage("soft_drink", "large", noon);
check("soft drink is NOT hydrating", r.hydrating === false, JSON.stringify(r));
check("soft drink added to meals", state.meals.length === 1, `meals=${state.meals.length}`);
check("soft drink flagged as sugary drink", r.analysis.flags.some(f => f.label === "sugary drink" && f.type === "bad"), JSON.stringify(r.analysis.flags));
check("soft drink did NOT add to hydration", (state.water[dateKey(noon)] || []).reduce((s, e) => s + e.ml, 0) === 600);
check("soft drink meal desc shows volume", /Soft drink — /.test(state.meals[0].desc), state.meals[0].desc);

r = domain.logBeverage("juice", "medium", noon);
check("fruit juice routed to meals as sugary drink", r.hydrating === false && r.analysis.flags.some(f => f.label === "sugary drink"));

r = domain.logBeverage("alcohol", "medium", noon);
check("alcohol routed to meals and flagged", r.hydrating === false && r.analysis.flags.some(f => f.label === "alcohol"));

r = domain.logBeverage("diet_soft", "medium", noon);
check("diet soft drink counts as hydration", r.hydrating === true);

state.water = {}; state.meals = [];
domain.addMeal("first meal", "medium", at(12));            // opens the window at noon
r = domain.logBeverage("soft_drink", "medium", at(21));    // 9h later -> past the 8h window
check("sugary drink past the window is flagged outside", r.analysis.message.includes("outside your"), r.analysis.message);
state.meals = [];

// back-dated drinks bucket by their own day and keep their timestamp
state.water = {};
const past = new Date(2026, 0, 2, 7, 45);
domain.logBeverage("coffee", "small", past);
const pk = dateKey(past);
check("back-dated drink lands in its own day bucket", (state.water[pk] || []).length === 1, JSON.stringify(state.water));
check("drink stores the chosen timestamp", state.water[pk][0].ts === past.getTime());
check("back-dated drink is not in today's bucket", !state.water[dateKey(new Date())], "leaked into today");

// --- meal record + kJ estimate storage ---
state.meals = [];
const stored = domain.addMeal("porridge with berries", "small", at(8));
check("addMeal returns the stored meal with an id", stored && typeof stored.id === "string");
check("new meal has no kJ until estimated", stored.kj === undefined);
domain.setMealKj(stored.id, 1234.6);
check("setMealKj stores a rounded kJ on the meal", state.meals.find(x => x.id === stored.id).kj === 1235);
domain.setMealKj(stored.id, 0);
check("setMealKj ignores non-positive estimates", state.meals.find(x => x.id === stored.id).kj === 1235);

// --- activities ---
state.activities = [];
const act = domain.addActivity({ type: "walking", start: "2026-06-21T08:00:00.000Z", end: "2026-06-21T08:45:00.000Z", distance: 4.2, intensity: "moderate" });
check("addActivity returns a record with an id", act && typeof act.id === "string");
check("addActivity stores it in state", state.activities.length === 1 && state.activities[0].type === "walking");
check("activityMinutes computes duration", domain.activityMinutes(act) === 45, `got ${domain.activityMinutes(act)}`);
check("activity types include all five", ["walking","riding","gym","swimming","sport"].every(k => domain.ACTIVITIES[k]));
check("swimming records metres, gym records no distance", domain.ACTIVITIES.swimming.distance === "m" && !domain.ACTIVITIES.gym.distance);

// kJ burnt: MET(walking moderate 3.5) × 80kg × 0.75h × 4.184 ≈ 879
state.weights = [{ date: "2026-01-01", kg: 80, ts: 1 }];
const burnt = domain.estimateActivityKj({ type: "walking", intensity: "moderate", start: "2026-06-21T08:00:00Z", end: "2026-06-21T08:45:00Z" });
check("activity kJ-burnt matches the MET formula", Math.abs(burnt - 879) <= 2, `got ${burnt}`);
const a3 = domain.addActivity({ type: "riding", intensity: "vigorous", start: "2026-06-21T06:00:00Z", end: "2026-06-21T07:00:00Z" });
check("addActivity stores a kJ-burnt estimate", a3.kj > 0, `got ${a3.kj}`);

// --- cloud-sync merge ---
const base = () => ({ profile: { weightUnit: "kg" }, goal: {}, fasting: { start: "12:00", end: "20:00" }, waterGoalMl: 2000, water: {}, meals: [], weights: [], updatedAt: 0 });

let A = base(), B = base();
A.meals = [{ id: "m1", desc: "eggs" }];
B.meals = [{ id: "m2", desc: "salad" }];
let m = domain.mergeStates(A, B);
check("merge unions meals from both devices", m.meals.length === 2 && m.meals.some(x => x.id === "m1") && m.meals.some(x => x.id === "m2"));

A = base(); B = base();
A.meals = [{ id: "m1", desc: "eggs" }]; B.meals = [{ id: "m1", desc: "eggs" }];
check("merge dedupes meals by id", domain.mergeStates(A, B).meals.length === 1);

A = base(); B = base();
A.water = { "2026-06-21": [{ ts: 1, ml: 250, type: "water" }] };
B.water = { "2026-06-21": [{ ts: 2, ml: 350, type: "coffee" }] };
check("merge unions same-day water entries by ts", domain.mergeStates(A, B).water["2026-06-21"].length === 2);

A = base(); B = base();
A.water = { "2026-06-20": [{ ts: 5, ml: 250, type: "water" }] };
B.water = { "2026-06-21": [{ ts: 9, ml: 500, type: "water" }] };
m = domain.mergeStates(A, B);
check("merge keeps water across different days", !!m.water["2026-06-20"] && !!m.water["2026-06-21"]);

A = base(); B = base();
A.weights = [{ date: "2026-06-01", kg: 98 }]; B.weights = [{ date: "2026-06-08", kg: 97 }];
check("merge unions weigh-ins by date", domain.mergeStates(A, B).weights.length === 2);

A = base(); A.updatedAt = 100; A.waterGoalMl = 2000; A.profile = { weightUnit: "kg" };
B = base(); B.updatedAt = 200; B.waterGoalMl = 3000; B.profile = { weightUnit: "lb" };
m = domain.mergeStates(A, B);
check("merge takes scalar settings from the newer side", m.waterGoalMl === 3000 && m.profile.weightUnit === "lb", `goal=${m.waterGoalMl}`);

A = base(); A.updatedAt = 500; A.goal = { weightKg: 85 };
B = base(); B.updatedAt = 200; B.goal = { weightKg: 90 };
check("older side does not clobber newer settings", domain.mergeStates(A, B).goal.weightKg === 85);

A = base(); B = base();
A.activities = [{ id: "x1", type: "gym" }];
B.activities = [{ id: "x2", type: "riding" }];
check("merge unions activities from both devices", domain.mergeStates(A, B).activities.length === 2);
A = base(); B = base();
A.activities = []; A.tombstones = { "activity:x1": 1000 };
B.activities = [{ id: "x1", type: "gym" }];
check("tombstoned activity stays deleted", !domain.mergeStates(A, B).activities.some(x => x.id === "x1"));

// --- deletion tombstones survive the merge ---
A = base(); B = base();
A.meals = []; A.tombstones = { "meal:m1": 1000 };   // A deleted m1
B.meals = [{ id: "m1", desc: "ghost" }];             // B still has it
m = domain.mergeStates(A, B);
check("tombstoned meal stays deleted after merge", !m.meals.some(x => x.id === "m1"), JSON.stringify(m.meals));
check("merge keeps the tombstone for other devices", m.tombstones["meal:m1"] === 1000);

A = base(); B = base();
A.water = {}; A.tombstones = { "water:2026-06-21:5": 1000 };
B.water = { "2026-06-21": [{ ts: 5, ml: 250, type: "water" }] };
m = domain.mergeStates(A, B);
check("tombstoned water entry stays deleted", !(m.water["2026-06-21"] || []).some(e => e.ts === 5));

A = base(); B = base();
A.weights = []; A.tombstones = { "weight:2026-06-01": 1000 };
B.weights = [{ date: "2026-06-01", kg: 98, ts: 500 }]; // recorded before deletion
m = domain.mergeStates(A, B);
check("weigh-in deleted after it was recorded stays deleted", m.weights.length === 0);

A = base(); A.tombstones = { "weight:2026-06-01": 1000 };
A.weights = [{ date: "2026-06-01", kg: 95, ts: 2000 }]; // re-logged after the deletion
m = domain.mergeStates(A, base());
check("re-logged weigh-in survives an older tombstone", m.weights.some(w => w.date === "2026-06-01" && w.kg === 95));

// --- backup envelope (carries keys + persona) ---
const bk = domain.buildBackup(
  { meals: [{ id: "x" }], profile: { age: 40 } },
  { clientId: "abc.apps.googleusercontent.com" },
  { enabled: true, apiKey: "AIzaTEST", model: "gemini-2.0-flash", systemPrompt: "Be a coach." }
);
check("backup tags the app + version", bk.app === "lostweightnow" && bk.version === 2);
check("backup carries the Drive client id", bk.sync.clientId === "abc.apps.googleusercontent.com");
check("backup carries the Gemini api key", bk.ai.apiKey === "AIzaTEST");
check("backup carries the custom persona", bk.ai.systemPrompt === "Be a coach.");
check("backup nests the data", bk.data.meals[0].id === "x");

const round = domain.parseBackup(bk);
check("parseBackup returns data + clientId + ai", round.data.profile.age === 40 && round.clientId === "abc.apps.googleusercontent.com" && round.ai.apiKey === "AIzaTEST");

const legacy = domain.parseBackup({ meals: [{ id: "y" }], profile: { age: 50 } });
check("parseBackup accepts legacy raw-state files", legacy.data.profile.age === 50 && legacy.clientId === undefined);

let threw = false;
try { domain.parseBackup({ random: "junk" }); } catch { threw = true; }
check("parseBackup rejects unknown files", threw);

check("default persona is non-empty", typeof domain.DEFAULT_PERSONA === "string" && domain.DEFAULT_PERSONA.length > 20);

// --- custom ("Other") drinks ---
state.profile.weightUnit = "kg"; state.profile.waterUnit = "ml";
state.water = {}; state.meals = []; state.customBeverages = [];
state.fasting = { start: "12:00", windowHours: 8 };

// saving a custom drink joins the loggable list under a unique, derived key
const bev1 = domain.addCustomBeverage({ label: "Mango Kombucha", hydrating: false, desc: "fizzy mango tea" });
check("addCustomBeverage derives a slug key", bev1.key === "custom_mango_kombucha", bev1.key);
check("addCustomBeverage flags it as custom", bev1.custom === true);
check("allBeverages includes built-ins and customs", !!domain.allBeverages().water && !!domain.allBeverages()[bev1.key]);
const bev2 = domain.addCustomBeverage({ label: "Mango Kombucha", hydrating: false });
check("addCustomBeverage avoids key collisions", bev2.key !== bev1.key, bev2.key);
check("drinkLabel resolves a custom drink", domain.drinkLabel(bev1.key) === "Mango Kombucha");
check("drinkIcon gives custom drinks a default icon", typeof domain.drinkIcon(bev1.key) === "string" && domain.drinkIcon(bev1.key).length > 0);

// logging an AI-classified hydrating "Other" drink counts toward the water goal
state.water = {}; state.meals = []; state.customBeverages = [];
let cd = domain.logCustomDrink("Iced herbal infusion", "unsweetened hibiscus, big glass",
  { hydrating: true, volumeMl: 500, kilojoules: 0, coaching: "Refreshing and zero sugar — great." }, at(13));
check("custom hydrating drink reports hydrating", cd.hydrating === true);
check("custom hydrating drink adds its AI volume to water", (state.water[dateKey(at(13))] || []).reduce((s, e) => s + e.ml, 0) === 500, JSON.stringify(state.water));
check("custom hydrating drink does not touch meals", state.meals.length === 0);
check("custom hydrating drink saved to the list", state.customBeverages.some(c => c.key === cd.bev.key && c.hydrating));
check("custom hydrating water entry carries the custom key", (state.water[dateKey(at(13))] || [])[0].type === cd.bev.key);

// logging an AI-classified caloric "Other" drink becomes a coached meal with kJ
state.water = {}; state.meals = []; state.customBeverages = [];
cd = domain.logCustomDrink("Salted caramel milkshake", "large milkshake with syrup",
  { hydrating: false, volumeMl: 500, kilojoules: 2500, coaching: "Liquid dessert — save it for a treat." }, at(13));
check("custom caloric drink reports non-hydrating", cd.hydrating === false);
check("custom caloric drink added to meals", state.meals.length === 1, `meals=${state.meals.length}`);
check("custom caloric drink stores the AI kJ estimate", state.meals[0].kj === 2500, `kj=${state.meals[0].kj}`);
check("custom caloric drink does not touch water", !state.water[dateKey(at(13))]);
check("custom caloric drink uses the AI coaching message", cd.analysis.message.includes("Liquid dessert"));
check("custom caloric drink desc shows the title and volume", /Salted caramel milkshake — /.test(state.meals[0].desc), state.meals[0].desc);

// with no AI classification, an "Other" drink is logged conservatively as a
// coached meal (we can't know offline whether it hydrates)
state.water = {}; state.meals = []; state.customBeverages = [];
cd = domain.logCustomDrink("Bubble tea", "tapioca milk tea", undefined, at(13));
check("custom drink without AI logs as a meal", cd.hydrating === false && state.meals.length === 1, `meals=${state.meals.length}`);
check("custom drink without AI skips the water goal", !state.water[dateKey(at(13))]);
check("custom drink without AI still falls back to rule-based coaching", typeof cd.analysis.message === "string" && cd.analysis.message.length > 0);

// custom drinks survive a sync merge, unioned by key
A = base(); B = base();
A.customBeverages = [{ key: "custom_a", label: "A", hydrating: true }];
B.customBeverages = [{ key: "custom_b", label: "B", hydrating: false }];
m = domain.mergeStates(A, B);
check("merge unions custom beverages from both devices", (m.customBeverages || []).length === 2);
A = base(); B = base();
A.customBeverages = [{ key: "custom_a", label: "A" }];
B.customBeverages = [{ key: "custom_a", label: "A" }];
check("merge dedupes custom beverages by key", domain.mergeStates(A, B).customBeverages.length === 1);
state.customBeverages = [];

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
