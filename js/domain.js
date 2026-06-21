/* Domain logic — units, fasting window, coaching, beverages, weight maths,
   sync merge, AI coaching and backup bundles. No DOM access, so it can be
   unit-tested by importing it directly. */

import { ML_PER_FLOZ, KG_PER_LB, dateKey, todayKey, fmtHM, fmtDuration, parseHM } from "./util.js";
import { state, save, defaultState, latestWeight } from "./store.js";

/* ---------------- units ---------------- */

export function kgToDisplay(kg) {
  return state.profile.weightUnit === "lb" ? kg / KG_PER_LB : kg;
}
export function displayToKg(v) {
  return state.profile.weightUnit === "lb" ? v * KG_PER_LB : v;
}
export function fmtWeight(kg, digits = 1) {
  return kgToDisplay(kg).toFixed(digits) + " " + state.profile.weightUnit;
}
export function mlToDisplay(ml) {
  return state.profile.waterUnit === "floz" ? ml / ML_PER_FLOZ : ml;
}
export function displayToMl(v) {
  return state.profile.waterUnit === "floz" ? v * ML_PER_FLOZ : v;
}
export function fmtWater(ml) {
  const v = mlToDisplay(ml);
  return (state.profile.waterUnit === "floz" ? Math.round(v * 10) / 10 : Math.round(v)) +
    " " + (state.profile.waterUnit === "floz" ? "fl oz" : "ml");
}

/* ---------------- beverages ---------------- */

export const BEVERAGES = {
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

export const DRINK_SIZES = [
  { key: "small",  label: "Small",  ml: 250 },
  { key: "medium", label: "Medium", ml: 350 },
  { key: "large",  label: "Large",  ml: 500 }
];

const HYDRATION_ICONS = { water: "💧", sparkling: "🫧", coffee: "☕", tea: "🍵", herbal: "🌿", diet_soft: "🥤" };
export const drinkLabel = (type) => (BEVERAGES[type] && BEVERAGES[type].label) || "Water";
export const drinkIcon = (type) => HYDRATION_ICONS[type] || "💧";

/* ---------------- fasting window ---------------- */

export function windowInfo(at = new Date()) {
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

export function nextMealAdvice(at = new Date()) {
  const win = windowInfo(at);
  if (win.inWindow) return "";
  return `Your next recommended meal is at ${fmtHM(win.start)} (${fmtDuration(win.minsToNextStart)} from now).`;
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

export function analyzeMeal(desc, portion, when) {
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

/* Create a meal entry, run coaching on it, persist, and return the stored
   meal record (so callers can later attach an AI kilojoule estimate). */
export function addMeal(desc, portion, when) {
  const analysis = analyzeMeal(desc, portion, when);
  const meal = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    desc, time: when.toISOString(), portion,
    flags: analysis.flags, tone: analysis.tone, message: analysis.message,
    outsideWindow: !windowInfo(when).inWindow
  };
  state.meals.push(meal);
  save();
  return meal;
}

// Attach an AI kilojoule estimate to a stored meal and persist.
export function setMealKj(id, kj) {
  const m = state.meals.find(x => x.id === id);
  if (m && kj > 0) { m.kj = Math.round(kj); save(); }
}

const SIZE_TO_PORTION = { small: "small", medium: "medium", large: "large" };

// Record a hydrating drink toward the water goal at a given time.
export function addHydration(ml, type, when) {
  const k = dateKey(when);
  (state.water[k] = state.water[k] || []).push({ ml, ts: when.getTime(), type });
  save();
}

// Log a drink at `when`. Hydrating drinks go toward the water goal; the rest
// become coached meals. Returns { hydrating, note?, analysis?, meal? } for the UI.
export function logBeverage(typeKey, sizeKey, when = new Date()) {
  const bev = BEVERAGES[typeKey];
  const size = DRINK_SIZES.find(s => s.key === sizeKey) || DRINK_SIZES[0];
  if (!bev) return null;

  if (bev.hydrating) {
    addHydration(size.ml, typeKey, when);
    return { hydrating: true, note: bev.note || "" };
  }

  const desc = `${bev.desc} — ${fmtWater(size.ml)}`;
  const portion = SIZE_TO_PORTION[size.key] || "medium";
  const meal = addMeal(desc, portion, when);
  return { hydrating: false, analysis: { flags: meal.flags, tone: meal.tone, message: meal.message }, meal };
}

export function waterToday() {
  return (state.water[todayKey()] || []).reduce((s, e) => s + e.ml, 0);
}

/* ---------------- weight maths ---------------- */

export function expectedWeightKg(onDate) {
  const g = state.goal;
  if (!g.weightKg || !g.date || !g.startWeightKg || !g.startDate) return null;
  const t0 = new Date(g.startDate + "T00:00:00").getTime();
  const t1 = new Date(g.date + "T00:00:00").getTime();
  const t = new Date(dateKey(onDate) + "T00:00:00").getTime();
  if (t1 <= t0) return g.weightKg;
  const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return g.startWeightKg + (g.weightKg - g.startWeightKg) * f;
}

/* ---------------- sync merge ---------------- */

// Merge two states without losing entries: union logs by their keys, honour
// deletion tombstones so removals survive, and take scalar settings from
// whichever side was edited more recently.
export function mergeStates(a, b) {
  const newer = (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  const out = defaultState();

  // union tombstones, keeping the latest deletion time per key
  const tombs = {};
  for (const src of [a.tombstones || {}, b.tombstones || {}]) {
    for (const k of Object.keys(src)) tombs[k] = Math.max(tombs[k] || 0, src[k]);
  }
  out.tombstones = tombs;

  // meals: union by id (ids are never reused, so a tombstone always wins)
  const meals = {};
  for (const m of [...(a.meals || []), ...(b.meals || [])]) meals[m.id] = m;
  out.meals = Object.values(meals).filter(m => !tombs["meal:" + m.id]);

  // weights: union by date; a tombstone only suppresses an entry recorded
  // before the deletion, so re-logging a weigh-in for that date survives
  const weights = {};
  for (const w of [...(a.weights || []), ...(b.weights || [])]) {
    if (!weights[w.date] || newer === b) weights[w.date] = w;
  }
  out.weights = Object.values(weights)
    .filter(w => !(tombs["weight:" + w.date] && tombs["weight:" + w.date] >= (w.ts || 0)))
    .sort((x, y) => x.date.localeCompare(y.date));

  // water: union per day by ts, drop tombstoned entries
  out.water = {};
  for (const src of [a.water || {}, b.water || {}]) {
    for (const k of Object.keys(src)) {
      const byTs = {};
      for (const e of [...(out.water[k] || []), ...src[k]]) byTs[e.ts] = e;
      out.water[k] = Object.values(byTs)
        .filter(e => !tombs["water:" + k + ":" + e.ts])
        .sort((x, y) => x.ts - y.ts);
    }
  }
  for (const k of Object.keys(out.water)) if (!out.water[k].length) delete out.water[k];

  out.profile = newer.profile;
  out.goal = newer.goal;
  out.fasting = newer.fasting;
  out.waterGoalMl = newer.waterGoalMl;
  out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
  return out;
}

// Record that something was deleted, so the deletion propagates through sync
// merges instead of being resurrected from the remote copy.
export function tombstone(key) {
  (state.tombstones ||= {})[key] = Date.now();
}

/* ---------------- AI coach (Google Gemini) ---------------- */

const AI_STORE = "lwn-ai-v1";
export const DEFAULT_MODEL = "gemini-3.1-flash-lite";
// Models Google has retired — auto-migrate stored configs off these.
const DEAD_MODELS = new Set([
  "gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.0-flash-001",
  "gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-1.5-pro", "gemini-pro"
]);
export const DEFAULT_PERSONA =
  "In your role as an honest, supportive dietary expert and coach, help the user lose weight " +
  "through intermittent fasting and better food choices. Give concise feedback (2–4 sentences): " +
  "note what's good, be direct about poor choices and oversized portions, take meal timing relative " +
  "to their fasting window into account, and finish with one practical, specific tip. Be encouraging " +
  "but truthful — never preachy.";

export let aiCfg = loadAiCfg();
function loadAiCfg() {
  let cfg;
  try { cfg = Object.assign({ enabled: false, apiKey: "", model: DEFAULT_MODEL, systemPrompt: DEFAULT_PERSONA },
    JSON.parse(localStorage.getItem(AI_STORE) || "{}")); }
  catch { cfg = { enabled: false, apiKey: "", model: DEFAULT_MODEL, systemPrompt: DEFAULT_PERSONA }; }
  if (!cfg.model || DEAD_MODELS.has(cfg.model)) cfg.model = DEFAULT_MODEL;
  return cfg;
}
export function saveAiCfg() { localStorage.setItem(AI_STORE, JSON.stringify(aiCfg)); }
export const aiReady = () => aiCfg.enabled && aiCfg.apiKey && navigator.onLine;

// Build the user-message context for one meal/drink.
export function mealContextText(m) {
  const when = new Date(m.time);
  const win = windowInfo(when);
  const lines = [
    `Item: ${m.desc}`,
    `Portion: ${m.portion}`,
    `Time eaten: ${when.toLocaleString()}`,
    win.inWindow
      ? `This is inside the user's eating window (${fmtHM(win.start)}–${fmtHM(win.end)}).`
      : `This is OUTSIDE the user's intermittent-fasting window (${fmtHM(win.start)}–${fmtHM(win.end)}) — they should be fasting now.`
  ];
  const g = state.goal, last = latestWeight();
  if (g.weightKg && g.date) {
    lines.push(`Goal: reach ${fmtWeight(g.weightKg)} by ${g.date}${last ? `, currently ${fmtWeight(last.kg)}` : ""}.`);
  }
  if (state.profile.age) lines.push(`User: age ${state.profile.age}${state.profile.sex ? ", " + state.profile.sex : ""}.`);
  const mealsToday = state.meals.filter(mm => dateKey(mm.time) === dateKey(when)).length;
  lines.push(`This is item #${mealsToday} logged today.`);
  return lines.join("\n");
}

export async function geminiGenerate(userText) {
  if (!aiCfg.apiKey) throw new Error("no API key");
  const model = aiCfg.model || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(aiCfg.apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: aiCfg.systemPrompt || DEFAULT_PERSONA }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 400 }
  };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let detail = "HTTP " + res.status;
    try { const e = await res.json(); detail = (e.error && e.error.message) || detail; } catch {}
    throw new Error(detail);
  }
  const data = await res.json();
  const text = (((data.candidates || [])[0] || {}).content || {}).parts;
  const out = (text || []).map(p => p.text || "").join("").trim();
  if (!out) throw new Error("empty response");
  return out;
}

// Structured coaching: returns { coaching, kilojoules } in one call, so each
// logged meal gets both feedback and a stored kJ estimate. The schema forces
// a kilojoules field regardless of the user's custom persona.
export async function geminiCoach(userText) {
  if (!aiCfg.apiKey) throw new Error("no API key");
  const model = aiCfg.model || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(aiCfg.apiKey)}`;
  const system = (aiCfg.systemPrompt || DEFAULT_PERSONA) +
    "\n\nAlso give your single best rough estimate of the item's total food energy in kilojoules " +
    "(kJ) as a positive integer in the 'kilojoules' field. An approximation is expected and useful; " +
    "estimate sensibly from the description and portion size rather than returning 0.";
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 500,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { coaching: { type: "STRING" }, kilojoules: { type: "INTEGER" } },
        required: ["coaching", "kilojoules"]
      }
    }
  };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let detail = "HTTP " + res.status;
    try { const e = await res.json(); detail = (e.error && e.error.message) || detail; } catch {}
    throw new Error(detail);
  }
  const data = await res.json();
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts;
  const raw = (parts || []).map(p => p.text || "").join("").trim();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("could not parse AI response"); }
  return { coaching: (parsed.coaching || "").trim(), kilojoules: Number(parsed.kilojoules) };
}

/* ---------------- backup bundle ---------------- */

// Pure: assemble/parse the export bundle that carries the data plus the Drive
// Client ID, Gemini key and coach persona.
export function buildBackup(st, sc, ac) {
  return {
    app: "lostweightnow",
    version: 2,
    exportedAt: new Date().toISOString(),
    data: st,
    sync: { clientId: (sc && sc.clientId) || "" },
    ai: {
      enabled: !!(ac && ac.enabled),
      apiKey: (ac && ac.apiKey) || "",
      model: (ac && ac.model) || DEFAULT_MODEL,
      systemPrompt: (ac && ac.systemPrompt) || DEFAULT_PERSONA
    }
  };
}
export function parseBackup(parsed) {
  if (parsed && parsed.app === "lostweightnow" && parsed.data) {
    return { data: parsed.data, clientId: parsed.sync && parsed.sync.clientId, ai: parsed.ai };
  }
  if (parsed && parsed.meals && parsed.profile) return { data: parsed }; // legacy raw-state backup
  throw new Error("not a LostWeightNow backup");
}
