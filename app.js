/* LostWeightNow — meal, water, fasting & weight tracker with honest coaching.
   All data stays in localStorage on the device. */
(() => {
"use strict";

const STORE_KEY = "lwn-state-v1";
const ML_PER_FLOZ = 29.5735;
const KG_PER_LB = 0.45359237;

/* Beverages. Hydrating drinks count toward the water goal; the rest are
   logged as meals so they're coached and counted toward the day's intake.
   `desc` for caloric drinks always contains a word the coach recognises. */
const BEVERAGES = {
  water:     { label: "Water",            hydrating: true },
  sparkling: { label: "Sparkling water",  hydrating: true },
  coffee:    { label: "Coffee",           hydrating: true,  note: "☕ Counts toward your goal. Keep it black/unsweetened, and caffeine earlier in the day." },
  tea:       { label: "Tea",              hydrating: true,  note: "🍵 Counts toward your goal — skip the sugar to keep it that way." },
  herbal:    { label: "Herbal tea",       hydrating: true,  note: "🌿 Caffeine-free and counts toward your goal. Nice choice." },
  diet_soft: { label: "Diet/zero soft drink", hydrating: true, note: "No sugar, so it counts toward hydration — but try to make water your default." },
  soft_drink:{ label: "Soft drink",       hydrating: false, desc: "Soft drink" },
  juice:     { label: "Fruit juice",      hydrating: false, desc: "Fruit juice" },
  energy:    { label: "Energy drink",     hydrating: false, desc: "Energy drink" },
  smoothie:  { label: "Smoothie",         hydrating: false, desc: "Smoothie" },
  alcohol:   { label: "Alcoholic drink",  hydrating: false, desc: "Alcoholic drink" }
};

const DRINK_SIZES = [
  { key: "small",  label: "Small",  ml: 250 },
  { key: "medium", label: "Medium", ml: 350 },
  { key: "large",  label: "Large",  ml: 500 }
];

/* ---------------- state ---------------- */

const defaultState = () => ({
  profile: { age: null, sex: "", heightCm: null, startWeightKg: null, weightUnit: "kg", waterUnit: "ml" },
  goal: { weightKg: null, date: null, startWeightKg: null, startDate: null },
  fasting: { start: "12:00", end: "20:00" },
  waterGoalMl: 2000,
  water: {},   // dateKey -> [{ml, ts}]
  meals: [],   // {id, desc, time(ISO), portion, flags, tone, message}
  weights: []  // {date, kg} sorted by date
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* corrupted -> start fresh */ }
  return defaultState();
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

/* ---------------- helpers ---------------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function dateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
}
const todayKey = () => dateKey(new Date());

function toLocalInputValue(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtTime(d) {
  return new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function fmtDate(key) {
  const d = new Date(key + "T12:00:00");
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}
function fmtDuration(mins) {
  mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/* units */
function kgToDisplay(kg) {
  return state.profile.weightUnit === "lb" ? kg / KG_PER_LB : kg;
}
function displayToKg(v) {
  return state.profile.weightUnit === "lb" ? v * KG_PER_LB : v;
}
function fmtWeight(kg, digits = 1) {
  return kgToDisplay(kg).toFixed(digits) + " " + state.profile.weightUnit;
}
function mlToDisplay(ml) {
  return state.profile.waterUnit === "floz" ? ml / ML_PER_FLOZ : ml;
}
function displayToMl(v) {
  return state.profile.waterUnit === "floz" ? v * ML_PER_FLOZ : v;
}
function fmtWater(ml) {
  const v = mlToDisplay(ml);
  return (state.profile.waterUnit === "floz" ? Math.round(v * 10) / 10 : Math.round(v)) +
    " " + (state.profile.waterUnit === "floz" ? "fl oz" : "ml");
}

/* ---------------- fasting window ---------------- */

function parseHM(s) { const [h, m] = s.split(":").map(Number); return h * 60 + m; }
function fmtHM(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  const d = new Date(); d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function windowInfo(at = new Date()) {
  const start = parseHM(state.fasting.start);
  const end = parseHM(state.fasting.end);
  const m = at.getHours() * 60 + at.getMinutes();
  const overnight = start > end;
  const inWindow = overnight ? (m >= start || m <= end) : (m >= start && m <= end);
  const windowLen = overnight ? (1440 - start + end) : (end - start);

  let minsToNextStart, minsToEnd;
  if (inWindow) {
    minsToEnd = overnight && m >= start ? (1440 - m + end) : (end - m);
    minsToNextStart = null;
  } else {
    minsToNextStart = m < start ? start - m : 1440 - m + start;
    minsToEnd = null;
  }
  return { inWindow, start, end, windowLen, minsToNextStart, minsToEnd, overnight, nowMins: m };
}

/* ---------------- coaching engine ---------------- */

const FOOD_RULES = [
  { type: "good", label: "lean protein", words: ["chicken", "turkey", "fish", "salmon", "tuna", "cod", "egg", "tofu", "tempeh", "beans", "lentil", "chickpea", "greek yogurt", "greek yoghurt", "cottage cheese", "prawn", "shrimp", "steak", "lean"] },
  { type: "good", label: "vegetables", words: ["salad", "broccoli", "spinach", "kale", "vegetable", "veggie", "veg ", "carrot", "pepper", "cauliflower", "courgette", "zucchini", "tomato", "cucumber", "greens", "asparagus", "cabbage", "mushroom", "onion", "stir fry", "stir-fry"] },
  { type: "good", label: "whole grains", words: ["oats", "oatmeal", "porridge", "brown rice", "quinoa", "wholemeal", "whole wheat", "wholegrain", "whole grain", "barley", "bulgur"] },
  { type: "good", label: "fruit", words: ["apple", "banana", "berries", "berry", "orange", "fruit", "grape", "melon", "pear", "strawberr", "blueberr", "raspberr", "kiwi", "peach", "mango"] },
  { type: "good", label: "healthy fats", words: ["avocado", "almond", "walnut", "nuts", "olive oil", "seeds"] },
  { type: "bad", label: "fried food", words: ["fried", "fries", "deep-fried", "battered", "tempura", "crispy chicken", "chips"] },
  { type: "bad", label: "sugary treat", words: ["cake", "candy", "sweets", "chocolate", "cookie", "biscuit", "donut", "doughnut", "ice cream", "pastry", "muffin", "syrup", "brownie", "dessert", "pudding"] },
  { type: "bad", label: "sugary drink", words: ["soda", "cola", "coke", "fizzy", "energy drink", "milkshake", "frappuccino", "sweet tea", "lemonade", "soft drink", "juice", "smoothie"] },
  { type: "warn", label: "refined carbs", words: ["white bread", "white rice", "bagel", "croissant", "pizza", "pasta", "noodles", "naan", "white roll"] },
  { type: "warn", label: "fast food", words: ["burger", "hot dog", "hotdog", "kebab", "takeaway", "take-away", "takeout", "mcdonald", "kfc", "domino", "taco bell", "nuggets"] },
  { type: "warn", label: "processed meat", words: ["bacon", "sausage", "salami", "pepperoni", "ham ", "spam", "deli meat"] },
  { type: "warn", label: "salty snack", words: ["crisps", "pretzel", "popcorn", "nachos", "cheetos", "doritos"] },
  { type: "bad", label: "alcohol", words: ["beer", "wine", "vodka", "whisky", "whiskey", "gin ", "rum ", "cocktail", "alcohol", "cider", "prosecco", "champagne"] },
];

function analyzeMeal(desc, portion, when) {
  const text = " " + desc.toLowerCase() + " ";
  const flags = [];
  for (const rule of FOOD_RULES) {
    if (rule.words.some(w => text.includes(w))) flags.push({ label: rule.label, type: rule.type });
  }

  const good = flags.filter(f => f.type === "good").map(f => f.label);
  const warn = flags.filter(f => f.type === "warn").map(f => f.label);
  const bad = flags.filter(f => f.type === "bad").map(f => f.label);

  const win = windowInfo(when);
  const parts = [];
  let tone = "neutral";

  if (!win.inWindow) {
    const next = nextMealAdvice(when);
    parts.push(`⏰ This meal was outside your ${fmtHM(win.start)}–${fmtHM(win.end)} eating window. Eating during your fast undoes much of its benefit. ${next}`);
    tone = "warn";
  }

  if (good.length && !bad.length && !warn.length) {
    parts.push(`Solid choice — ${good.join(", ")} ${good.length > 1 ? "are" : "is"} exactly what your goal needs. Keep this up.`);
    tone = tone === "warn" ? "warn" : "good";
  } else if (good.length && (bad.length || warn.length)) {
    parts.push(`Mixed meal: the ${good.join(" and ")} is great, but the ${[...bad, ...warn].join(" and ")} works against you. Next time, make the healthy part the bigger share of the plate.`);
    if (tone !== "warn") tone = "neutral";
  } else if (bad.length) {
    parts.push(`Honest feedback: ${bad.join(" and ")} is one of the fastest ways to stall weight loss — calorie-dense and easy to overeat. One slip doesn't ruin a week, but don't let it become a pattern. Swap idea: ${swapIdea(bad[0])}`);
    tone = "warn";
  } else if (warn.length) {
    parts.push(`Be careful with ${warn.join(" and ")} — fine occasionally, but portion control matters a lot here.`);
    if (tone !== "warn") tone = "neutral";
  } else if (!good.length) {
    parts.push(`I don't recognise enough in that description to coach you well. Add detail (e.g. "grilled" vs "fried", what sides) and I'll give you a straighter answer.`);
  }

  if (portion === "extra-large") {
    parts.push(`An extra-large portion will hold you back even when the food itself is healthy. Weight loss is won on portions — aim for medium and wait 20 minutes before going back for more.`);
    tone = "warn";
  } else if (portion === "large" && (bad.length || warn.length)) {
    parts.push(`A large portion of this makes it doubly costly. Halve it next time.`);
    tone = "warn";
  } else if (portion === "small" && good.length && !bad.length) {
    parts.push(`Small and clean — nicely disciplined.`);
  }

  const hour = when.getHours();
  if (win.inWindow && (hour >= 21 || hour < 5)) {
    parts.push(`Late-night eating tends to be less mindful — try to front-load your calories earlier in your window.`);
  }

  const mealsToday = state.meals.filter(mm => dateKey(mm.time) === dateKey(when)).length;
  if (mealsToday >= 3) {
    parts.push(`That's meal #${mealsToday + 1} today. Frequent eating makes a calorie deficit much harder — within your window, 2–3 satisfying meals beats constant grazing.`);
  }

  return { flags, tone, message: parts.join(" ") };
}

function swapIdea(label) {
  const swaps = {
    "fried food": "oven-baked or air-fried versions cut the calories by half or more.",
    "sugary treat": "a piece of fruit or a square of dark chocolate kills the craving for a fraction of the sugar.",
    "sugary drink": "sparkling water with lemon, or a zero-sugar version.",
    "alcohol": "alcohol is ~7 kcal/g and lowers your guard around food — keep it to planned occasions.",
  };
  return swaps[label] || "look for a grilled, baked or fresh alternative.";
}

function nextMealAdvice(at = new Date()) {
  const win = windowInfo(at);
  if (win.inWindow) return "";
  return `Your next recommended meal is at ${fmtHM(win.start)} (${fmtDuration(win.minsToNextStart)} from now).`;
}

/* Create a meal entry, run coaching on it, persist, and return the analysis. */
function addMeal(desc, portion, when) {
  const analysis = analyzeMeal(desc, portion, when);
  state.meals.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    desc, time: when.toISOString(), portion,
    flags: analysis.flags, tone: analysis.tone, message: analysis.message,
    outsideWindow: !windowInfo(when).inWindow
  });
  save();
  return analysis;
}

/* ---------------- beverages ---------------- */

const SIZE_TO_PORTION = { small: "small", medium: "medium", large: "large" };

// Log a drink. Hydrating drinks go toward the water goal; the rest become
// coached meals. Returns { hydrating, note?, analysis? } for the UI.
function logBeverage(typeKey, sizeKey, when = new Date()) {
  const bev = BEVERAGES[typeKey];
  const size = DRINK_SIZES.find(s => s.key === sizeKey) || DRINK_SIZES[0];
  if (!bev) return null;

  if (bev.hydrating) {
    const k = dateKey(when);
    (state.water[k] = state.water[k] || []).push({ ml: size.ml, ts: when.getTime(), type: typeKey });
    save();
    return { hydrating: true, note: bev.note || "" };
  }

  const desc = `${bev.desc} — ${fmtWater(size.ml)}`;
  const analysis = addMeal(desc, SIZE_TO_PORTION[size.key] || "medium", when);
  return { hydrating: false, analysis };
}

/* ---------------- rendering: fasting ---------------- */

function renderFasting() {
  const win = windowInfo();
  const pill = $("#fastingPill");
  const status = $("#fastingStatus");
  const detail = $("#fastingDetail");
  const bar = $("#fastingProgress");

  if (win.inWindow) {
    pill.textContent = "Eating window open";
    pill.className = "fasting-pill open";
    status.textContent = `🍽️ Eating window open — closes at ${fmtHM(win.end)}`;
    status.className = "fasting-status open";
    detail.textContent = `${fmtDuration(win.minsToEnd)} left to finish your last meal.`;
    const elapsed = win.windowLen - win.minsToEnd;
    bar.style.width = Math.min(100, (elapsed / win.windowLen) * 100) + "%";
    bar.style.background = "#22c55e";
  } else {
    const fastLen = 1440 - win.windowLen;
    const fasted = fastLen - win.minsToNextStart;
    pill.textContent = "Fasting";
    pill.className = "fasting-pill closed";
    status.textContent = `⏳ Fasting — next recommended meal at ${fmtHM(win.start)}`;
    status.className = "fasting-status closed";
    detail.textContent = `${fmtDuration(win.minsToNextStart)} until your eating window opens. You're ${fmtDuration(Math.max(0, fasted))} into this fast — stay strong, water and black coffee are fine.`;
    bar.style.width = Math.min(100, Math.max(0, (fasted / fastLen) * 100)) + "%";
    bar.style.background = "#f59e0b";
  }
  $("#windowSummary").textContent =
    `Eating window: ${fmtHM(win.start)}–${fmtHM(win.end)} (${fmtDuration(win.windowLen)} eating, ${fmtDuration(1440 - win.windowLen)} fasting).`;
}

/* ---------------- rendering: water ---------------- */

function waterToday() {
  return (state.water[todayKey()] || []).reduce((s, e) => s + e.ml, 0);
}

function renderWater() {
  const drunk = waterToday();
  const goal = state.waterGoalMl;
  const remaining = Math.max(0, goal - drunk);
  $("#waterRemaining").textContent = state.profile.waterUnit === "floz"
    ? (Math.round(mlToDisplay(remaining) * 10) / 10) : Math.round(remaining);
  $("#waterUnitLabel").textContent = state.profile.waterUnit === "floz" ? "fl oz" : "ml";
  $("#waterSummary").textContent = `${fmtWater(drunk)} of ${fmtWater(goal)}`;
  $("#waterProgress").style.width = Math.min(100, (drunk / goal) * 100) + "%";
  $("#waterDone").classList.toggle("hidden", drunk < goal);
  $$("[data-water-label]").forEach(el => {
    el.textContent = fmtWater(Number(el.getAttribute("data-water-label")));
  });
  // keep drink-size labels in the selected water unit
  const sizeSel = $("#drinkSize");
  if (sizeSel) {
    const cur = sizeSel.value;
    sizeSel.innerHTML = DRINK_SIZES
      .map(s => `<option value="${s.key}">${s.label} (${fmtWater(s.ml)})</option>`).join("");
    if (cur) sizeSel.value = cur;
  }
  $("#waterGoalUnitLabel").textContent = state.profile.waterUnit === "floz" ? "fl oz" : "ml";
  const goalInput = $("#waterGoalInput");
  if (document.activeElement !== goalInput) {
    goalInput.value = state.profile.waterUnit === "floz"
      ? Math.round(mlToDisplay(goal) * 10) / 10 : Math.round(goal);
  }
}

/* ---------------- rendering: meals ---------------- */

function mealItemHTML(meal) {
  const flagsHTML = meal.flags.map(f =>
    `<span class="flag ${f.type === "good" ? "good" : f.type === "bad" ? "bad" : "warn"}">${f.label}</span>`).join("");
  const outside = meal.outsideWindow ? `<span class="flag bad">outside window</span>` : "";
  return `<li class="meal-item" data-id="${meal.id}">
    <div class="meal-top">
      <span class="meal-desc">${escapeHTML(meal.desc)}</span>
      <span class="meal-meta">${fmtTime(meal.time)} · ${meal.portion}
        <button class="meal-del" title="Delete" aria-label="Delete meal">✕</button></span>
    </div>
    <div class="meal-flags">${flagsHTML}${outside}</div>
  </li>`;
}

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderMeals() {
  const today = todayKey();
  const todays = state.meals.filter(m => dateKey(m.time) === today)
    .sort((a, b) => new Date(a.time) - new Date(b.time));
  $("#todayMeals").innerHTML = todays.map(mealItemHTML).join("");
  $("#noMeals").classList.toggle("hidden", todays.length > 0);

  // history grouped by day, newest first
  const byDay = {};
  for (const m of state.meals) {
    const k = dateKey(m.time);
    (byDay[k] = byDay[k] || []).push(m);
  }
  const days = Object.keys(byDay).sort().reverse();
  $("#historyList").innerHTML = days.length
    ? days.map(k => {
        const items = byDay[k].sort((a, b) => new Date(a.time) - new Date(b.time)).map(mealItemHTML).join("");
        const water = (state.water[k] || []).reduce((s, e) => s + e.ml, 0);
        return `<div class="history-day"><h3>${fmtDate(k)} · 💧 ${fmtWater(water)}</h3><ul class="meal-list">${items}</ul></div>`;
      }).join("")
    : `<p class="muted">No meals logged yet.</p>`;
}

function renderDailyReview() {
  const today = todayKey();
  const todays = state.meals.filter(m => dateKey(m.time) === today);
  const box = $("#dailyReview");
  if (!todays.length) {
    box.className = "coach-box";
    box.innerHTML = `<div class="coach-title">Coach's view of today</div>Nothing logged yet today. Logging every meal — even the bad ones — is the single habit that most predicts success. Be honest with the log and I'll be honest with you.`;
    return;
  }
  const allFlags = todays.flatMap(m => m.flags);
  const goods = allFlags.filter(f => f.type === "good").length;
  const bads = allFlags.filter(f => f.type !== "good").length;
  const outside = todays.filter(m => m.outsideWindow).length;
  const drunk = waterToday();
  const waterPct = Math.round((drunk / state.waterGoalMl) * 100);

  const lines = [];
  lines.push(`You've logged ${todays.length} meal${todays.length > 1 ? "s" : ""} today.`);
  if (goods > bads && bads === 0) lines.push(`Food quality is strong — every flagged item was a good one. This is what progress looks like.`);
  else if (goods > bads) lines.push(`More good choices than poor ones today — solid, but the ${bads} weak spot${bads > 1 ? "s" : ""} are where the easy wins are.`);
  else if (bads > 0) lines.push(`Straight talk: today leaned toward foods that fight your goal (${bads} flagged vs ${goods} good). Tomorrow, plan your first meal before hunger decides for you.`);
  if (outside > 0) lines.push(`${outside} meal${outside > 1 ? "s were" : " was"} outside your eating window — protect the fast, it's half the method.`);
  lines.push(waterPct >= 100 ? `Water goal hit (${waterPct}%). 💧` : `Water is at ${waterPct}% of goal — ${fmtWater(Math.max(0, state.waterGoalMl - drunk))} to go.`);

  const tone = bads > goods || outside > 0 ? "warn" : (goods > 0 && bads === 0 ? "good" : "");
  box.className = "coach-box " + tone;
  box.innerHTML = `<div class="coach-title">Coach's view of today</div>` + lines.join(" ");
}

/* ---------------- rendering: weight ---------------- */

function latestWeight() {
  return state.weights.length ? state.weights[state.weights.length - 1] : null;
}

function expectedWeightKg(onDate) {
  const g = state.goal;
  if (!g.weightKg || !g.date || !g.startWeightKg || !g.startDate) return null;
  const t0 = new Date(g.startDate + "T00:00:00").getTime();
  const t1 = new Date(g.date + "T00:00:00").getTime();
  const t = new Date(dateKey(onDate) + "T00:00:00").getTime();
  if (t1 <= t0) return g.weightKg;
  const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return g.startWeightKg + (g.weightKg - g.startWeightKg) * f;
}

function renderGoalStatus() {
  const el = $("#goalStatus");
  const g = state.goal;
  const last = latestWeight();

  if (!g.weightKg || !g.date) {
    el.className = "goal-status neutral";
    el.textContent = "Set a goal weight and target date in Settings and I'll track whether you're on target.";
    return;
  }
  if (!last) {
    el.className = "goal-status neutral";
    el.textContent = "Log your first weigh-in to see how you're tracking against your goal.";
    return;
  }

  const expected = expectedWeightKg(new Date());
  const diff = last.kg - expected; // positive = above the line (behind, when losing)
  const losing = g.weightKg < g.startWeightKg;
  const behind = losing ? diff > 0 : diff < 0;
  const absDiff = Math.abs(kgToDisplay(diff));
  const unit = state.profile.weightUnit;

  const daysLeft = Math.ceil((new Date(g.date + "T00:00:00") - new Date(todayKey() + "T00:00:00")) / 86400000);
  const toGo = kgToDisplay(Math.abs(last.kg - g.weightKg));

  let msg, cls;
  if (daysLeft < 0) {
    const hit = losing ? last.kg <= g.weightKg : last.kg >= g.weightKg;
    msg = hit
      ? `🎉 Target date passed and you made it — ${fmtWeight(last.kg)} vs goal ${fmtWeight(g.weightKg)}. Set a new goal to keep momentum.`
      : `Target date has passed with ${toGo.toFixed(1)} ${unit} still to go. No drama — set a fresh, realistic date in Settings and keep moving.`;
    cls = hit ? "good" : "warn";
  } else if (Math.abs(diff) <= 0.5) {
    msg = `✅ On target. You're at ${fmtWeight(last.kg)}, right on the line to hit ${fmtWeight(g.weightKg)} by ${fmtDate(g.date)} (${toGo.toFixed(1)} ${unit} to go, ${daysLeft} days left).`;
    cls = "good";
  } else if (!behind) {
    msg = `🚀 Ahead of plan by ${absDiff.toFixed(1)} ${unit}. You're at ${fmtWeight(last.kg)}; the plan says ${fmtWeight(expected)} today. ${toGo.toFixed(1)} ${unit} to go in ${daysLeft} days.`;
    cls = "good";
  } else {
    const weeksLeft = Math.max(daysLeft / 7, 0.1);
    const ratePerWeek = kgToDisplay(Math.abs(last.kg - g.weightKg)) / weeksLeft;
    const safeRate = state.profile.weightUnit === "lb" ? 2.2 : 1.0;
    msg = `⚠️ Behind plan by ${absDiff.toFixed(1)} ${unit} — you're at ${fmtWeight(last.kg)}, plan says ${fmtWeight(expected)}. To still hit ${fmtWeight(g.weightKg)} by ${fmtDate(g.date)} you'd need to lose ${ratePerWeek.toFixed(1)} ${unit}/week.`;
    if (ratePerWeek > safeRate) msg += ` Honestly, that's faster than the safe sustainable rate (~${safeRate} ${unit}/week) — consider moving the date rather than crash-dieting.`;
    cls = "warn";
  }
  el.className = "goal-status " + cls;
  el.textContent = msg;
}

function renderWeightChart() {
  const wrap = $("#weightChart");
  const pts = state.weights;
  const g = state.goal;
  if (!pts.length) {
    wrap.innerHTML = `<p class="muted small">Your chart will appear after your first weigh-in. Weigh in once a week, same day, same time of day.</p>`;
    return;
  }

  const W = 600, H = 280, padL = 44, padR = 14, padT = 14, padB = 30;
  const t = (d) => new Date(d + "T00:00:00").getTime();

  let minT = t(pts[0].date), maxT = t(pts[pts.length - 1].date);
  const hasGoal = g.weightKg && g.date && g.startWeightKg && g.startDate;
  if (hasGoal) { minT = Math.min(minT, t(g.startDate)); maxT = Math.max(maxT, t(g.date)); }
  if (maxT === minT) maxT = minT + 86400000;

  let kgs = pts.map(p => p.kg);
  if (hasGoal) kgs = kgs.concat([g.weightKg, g.startWeightKg]);
  let minKg = Math.min(...kgs), maxKg = Math.max(...kgs);
  const pad = Math.max((maxKg - minKg) * 0.1, 1);
  minKg -= pad; maxKg += pad;

  const X = (tt) => padL + ((tt - minT) / (maxT - minT)) * (W - padL - padR);
  const Y = (kg) => padT + (1 - (kg - minKg) / (maxKg - minKg)) * (H - padT - padB);

  // y-axis gridlines: 4 ticks in display units
  let grid = "";
  for (let i = 0; i <= 3; i++) {
    const kg = minKg + (i / 3) * (maxKg - minKg);
    const y = Y(kg);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e2e8f0"/>` +
      `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="#64748b">${kgToDisplay(kg).toFixed(1)}</text>`;
  }

  // x labels: first and last date
  const xl = (tt, anchor) => {
    const d = new Date(tt);
    return `<text x="${X(tt)}" y="${H - 8}" text-anchor="${anchor}" font-size="11" fill="#64748b">${d.toLocaleDateString([], { day: "numeric", month: "short" })}</text>`;
  };
  grid += xl(minT, "start") + xl(maxT, "end");

  let goalLine = "";
  if (hasGoal) {
    goalLine = `<line x1="${X(t(g.startDate))}" y1="${Y(g.startWeightKg)}" x2="${X(t(g.date))}" y2="${Y(g.weightKg)}" stroke="#f59e0b" stroke-width="2" stroke-dasharray="6 5"/>` +
      `<circle cx="${X(t(g.date))}" cy="${Y(g.weightKg)}" r="5" fill="#fff" stroke="#f59e0b" stroke-width="2"/>`;
  }

  const path = pts.map((p, i) => `${i ? "L" : "M"}${X(t(p.date)).toFixed(1)},${Y(p.kg).toFixed(1)}`).join(" ");
  const dots = pts.map(p => `<circle cx="${X(t(p.date))}" cy="${Y(p.kg)}" r="4" fill="#0d9488"/>`).join("");

  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight chart">
    ${grid}${goalLine}
    <path d="${path}" fill="none" stroke="#0d9488" stroke-width="2.5" stroke-linejoin="round"/>
    ${dots}
  </svg>`;
}

function renderWeightList() {
  const list = [...state.weights].reverse().slice(0, 12);
  $("#weightList").innerHTML = list.map((p, i) => {
    const prev = state.weights[state.weights.length - 2 - i];
    let delta = "";
    if (prev) {
      const d = kgToDisplay(p.kg - prev.kg);
      const sign = d > 0 ? "+" : "";
      delta = `<span class="${d <= 0 ? "muted" : ""}" style="color:${d < 0 ? "#166534" : d > 0 ? "#b91c1c" : ""}">${sign}${d.toFixed(1)}</span>`;
    }
    return `<li data-date="${p.date}"><span>${fmtDate(p.date)}</span><span>${fmtWeight(p.kg)} ${delta}
      <button class="meal-del weight-del" title="Delete" aria-label="Delete weigh-in">✕</button></span></li>`;
  }).join("");
}

function renderWeighReminder() {
  const el = $("#weighReminder");
  const last = latestWeight();
  $("#lastWeighIn").textContent = last ? `last: ${fmtDate(last.date)}` : "";
  if (!last) { el.classList.add("hidden"); return; }
  const days = Math.floor((new Date(todayKey() + "T00:00:00") - new Date(last.date + "T00:00:00")) / 86400000);
  if (days >= 7) {
    el.textContent = `⚖️ It's been ${days} days since your last weigh-in — time for your weekly check.`;
    el.classList.remove("hidden");
  } else el.classList.add("hidden");
}

/* ---------------- rendering: settings ---------------- */

function renderSettings() {
  const p = state.profile;
  $("#profAge").value = p.age ?? "";
  $("#profSex").value = p.sex || "";
  $("#profHeight").value = p.heightCm ?? "";
  $("#profStartWeight").value = p.startWeightKg != null ? +kgToDisplay(p.startWeightKg).toFixed(1) : "";
  $("#profWeightUnit").value = p.weightUnit;
  $("#profWaterUnit").value = p.waterUnit;
  $$(".weight-unit-label").forEach(el => el.textContent = p.weightUnit);

  $("#goalWeight").value = state.goal.weightKg != null ? +kgToDisplay(state.goal.weightKg).toFixed(1) : "";
  $("#goalDate").value = state.goal.date || "";
  $("#windowStart").value = state.fasting.start;
  $("#windowEnd").value = state.fasting.end;

  renderProfileStats();
  renderGoalAdvice();
}

function renderProfileStats() {
  const p = state.profile;
  const last = latestWeight();
  const kg = last ? last.kg : p.startWeightKg;
  const bits = [];
  if (p.heightCm && kg) {
    const bmi = kg / Math.pow(p.heightCm / 100, 2);
    const band = bmi < 18.5 ? "underweight" : bmi < 25 ? "healthy range" : bmi < 30 ? "overweight" : "obese range";
    bits.push(`BMI ${bmi.toFixed(1)} (${band}).`);
  }
  if (p.age && p.sex && p.heightCm && kg) {
    // Mifflin-St Jeor resting energy estimate
    const bmr = 10 * kg + 6.25 * p.heightCm - 5 * p.age + (p.sex === "male" ? 5 : -161);
    const maintain = Math.round(bmr * 1.4);
    const target = Math.max(p.sex === "male" ? 1500 : 1200, maintain - 500);
    bits.push(`Estimated maintenance ≈ ${maintain} kcal/day; eating around ${target} kcal/day supports steady loss of ~0.5 kg (1 lb) per week. (Estimate only — not medical advice.)`);
  }
  $("#profileStats").textContent = bits.join(" ");
}

function renderGoalAdvice() {
  const g = state.goal;
  const el = $("#goalAdvice");
  if (!g.weightKg || !g.date || !g.startWeightKg) { el.textContent = ""; return; }
  const weeks = Math.max((new Date(g.date) - new Date(g.startDate || todayKey())) / (7 * 86400000), 0.1);
  const rate = kgToDisplay(Math.abs(g.startWeightKg - g.weightKg)) / weeks;
  const unit = state.profile.weightUnit;
  const safe = unit === "lb" ? 2.2 : 1.0;
  el.textContent = rate > safe
    ? `That plan needs ${rate.toFixed(1)} ${unit}/week — faster than the sustainable ${safe} ${unit}/week. I'd honestly recommend a later date; slow loss is the kind that stays off.`
    : `That's ${rate.toFixed(2)} ${unit}/week — a realistic, sustainable pace. 👍`;
}

/* ---------------- render all ---------------- */

function renderAll() {
  renderFasting();
  renderWater();
  renderMeals();
  renderDailyReview();
  renderGoalStatus();
  renderWeightChart();
  renderWeightList();
  renderWeighReminder();
  renderSettings();
}

/* ---------------- events ---------------- */

function setupTabs() {
  $$(".tab-btn").forEach(btn => btn.addEventListener("click", () => {
    $$(".tab-btn").forEach(b => b.classList.toggle("active", b === btn));
    $$(".tab").forEach(t => t.classList.toggle("active", t.id === "tab-" + btn.dataset.tab));
    window.scrollTo(0, 0);
  }));
}

function setupMeals() {
  $("#mealTime").value = toLocalInputValue(new Date());

  $("#mealForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const desc = $("#mealDesc").value.trim();
    if (!desc) return;
    const when = new Date($("#mealTime").value);
    const portion = $("#mealPortion").value;
    const analysis = addMeal(desc, portion, when);

    const box = $("#coachFeedback");
    box.className = "coach-box " + (analysis.tone === "good" ? "good" : analysis.tone === "warn" ? "warn" : "");
    box.innerHTML = `<div class="coach-title">Coach says</div>${escapeHTML(analysis.message)}`;
    box.classList.remove("hidden");

    $("#mealDesc").value = "";
    $("#mealPortion").value = "medium";
    $("#mealTime").value = toLocalInputValue(new Date());
    renderAll();
  });

  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("meal-del") && !e.target.classList.contains("weight-del")) {
      const li = e.target.closest(".meal-item");
      state.meals = state.meals.filter(m => m.id !== li.dataset.id);
      save(); renderAll();
    }
    if (e.target.classList.contains("weight-del")) {
      const li = e.target.closest("li");
      state.weights = state.weights.filter(w => w.date !== li.dataset.date);
      save(); renderAll();
    }
  });
}

function setupWater() {
  // quick water buttons
  $$(".water-add").forEach(btn => btn.addEventListener("click", () => {
    const k = todayKey();
    (state.water[k] = state.water[k] || []).push({ ml: Number(btn.dataset.ml), ts: Date.now(), type: "water" });
    save(); renderWater(); renderDailyReview();
  }));
  $("#waterUndo").addEventListener("click", () => {
    const arr = state.water[todayKey()];
    if (arr && arr.length) { arr.pop(); save(); renderWater(); renderDailyReview(); }
  });

  // beverage type selector (sizes are filled/relabelled by renderWater)
  $("#drinkType").innerHTML = Object.entries(BEVERAGES)
    .map(([key, b]) => `<option value="${key}">${b.label}</option>`).join("");

  $("#drinkLog").addEventListener("click", () => {
    const res = logBeverage($("#drinkType").value, $("#drinkSize").value);
    if (!res) return;
    const note = $("#drinkNote");
    if (res.hydrating) {
      if (res.note) { note.className = "coach-box good"; note.innerHTML = res.note; note.classList.remove("hidden"); }
      else note.classList.add("hidden");
    } else {
      const a = res.analysis;
      note.className = "coach-box " + (a.tone === "good" ? "good" : a.tone === "warn" ? "warn" : "");
      note.innerHTML = `<div class="coach-title">Coach says</div>${escapeHTML(a.message)} <em>Added to your meal log.</em>`;
      note.classList.remove("hidden");
    }
    renderAll();
  });

  $("#waterGoalForm").addEventListener("submit", e => e.preventDefault());
  $("#waterGoalInput").addEventListener("change", () => {
    const v = parseFloat($("#waterGoalInput").value);
    if (v > 0) { state.waterGoalMl = Math.round(displayToMl(v)); save(); renderWater(); renderDailyReview(); }
  });
}

function setupWeight() {
  $("#weightDate").value = todayKey();
  $("#weightForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = parseFloat($("#weightInput").value);
    const date = $("#weightDate").value;
    if (!(v > 0) || !date) return;
    const kg = displayToKg(v);
    state.weights = state.weights.filter(w => w.date !== date);
    state.weights.push({ date, kg });
    state.weights.sort((a, b) => a.date.localeCompare(b.date));
    if (state.profile.startWeightKg == null) state.profile.startWeightKg = kg;
    // anchor the goal trajectory at the first weigh-in if not set
    if (state.goal.weightKg && !state.goal.startDate) {
      state.goal.startDate = state.weights[0].date;
      state.goal.startWeightKg = state.weights[0].kg;
    }
    save();
    $("#weightInput").value = "";
    renderAll();
  });
}

function setupSettings() {
  const p = state.profile;

  $("#profAge").addEventListener("change", () => { p.age = parseInt($("#profAge").value) || null; save(); renderProfileStats(); });
  $("#profSex").addEventListener("change", () => { p.sex = $("#profSex").value; save(); renderProfileStats(); });
  $("#profHeight").addEventListener("change", () => { p.heightCm = parseFloat($("#profHeight").value) || null; save(); renderProfileStats(); });
  $("#profStartWeight").addEventListener("change", () => {
    const v = parseFloat($("#profStartWeight").value);
    p.startWeightKg = v > 0 ? displayToKg(v) : null;
    if (state.goal.weightKg && !state.goal.startDate && p.startWeightKg) {
      state.goal.startDate = todayKey();
      state.goal.startWeightKg = p.startWeightKg;
    }
    save(); renderAll();
  });
  $("#profWeightUnit").addEventListener("change", () => { p.weightUnit = $("#profWeightUnit").value; save(); renderAll(); });
  $("#profWaterUnit").addEventListener("change", () => { p.waterUnit = $("#profWaterUnit").value; save(); renderAll(); });

  const applyGoal = () => {
    const v = parseFloat($("#goalWeight").value);
    state.goal.weightKg = v > 0 ? displayToKg(v) : null;
    state.goal.date = $("#goalDate").value || null;
    if (state.goal.weightKg && state.goal.date) {
      const last = latestWeight();
      const startKg = last ? last.kg : state.profile.startWeightKg;
      if (startKg != null) {
        state.goal.startDate = last ? last.date : todayKey();
        state.goal.startWeightKg = startKg;
      }
    }
    save(); renderAll();
  };
  $("#goalWeight").addEventListener("change", applyGoal);
  $("#goalDate").addEventListener("change", applyGoal);

  const applyWindow = () => {
    state.fasting.start = $("#windowStart").value || "12:00";
    state.fasting.end = $("#windowEnd").value || "20:00";
    save(); renderFasting(); renderMeals(); renderDailyReview();
  };
  $("#windowStart").addEventListener("change", applyWindow);
  $("#windowEnd").addEventListener("change", applyWindow);

  ["#profileForm", "#goalForm", "#fastingForm"].forEach(s => $(s).addEventListener("submit", e => e.preventDefault()));

  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lostweightnow-backup-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async () => {
    const file = $("#importFile").files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.meals || !data.profile) throw new Error("bad file");
      state = Object.assign(defaultState(), data);
      save(); renderAll();
      alert("Backup imported.");
    } catch { alert("That file doesn't look like a LostWeightNow backup."); }
    $("#importFile").value = "";
  });
  $("#resetBtn").addEventListener("click", () => {
    if (confirm("Erase ALL data on this device? This cannot be undone.")) {
      state = defaultState();
      save(); renderAll();
    }
  });
}

/* ---------------- boot ---------------- */

setupTabs();
setupMeals();
setupWater();
setupWeight();
setupSettings();
renderAll();
setInterval(renderFasting, 30 * 1000); // keep the fasting clock live

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

})();
