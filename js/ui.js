/* UI wiring: event handlers, the live coach box, AI settings, and boot.
   This is the entry module loaded by index.html. */

import { $, $$, todayKey, toLocalInputValue, escapeHTML } from "./util.js";
import { state, save, replaceState, defaultState, latestWeight } from "./store.js";
import {
  addMeal, addHydration, logBeverage, BEVERAGES,
  displayToKg, displayToMl,
  aiCfg, saveAiCfg, aiReady, geminiGenerate, mealContextText,
  DEFAULT_MODEL, DEFAULT_PERSONA, buildBackup, parseBackup
} from "./domain.js";
import {
  renderAll, renderFasting, renderWater, renderMeals, renderDailyReview, renderProfileStats
} from "./render.js";
import { syncCfg, setupSync, cloudSync, renderDriveControls, setSyncClientId } from "./sync.js";

/* ---------------- live coach box ---------------- */

function renderCoach(box, tone, title, html) {
  box.className = "coach-box " + (tone === "good" ? "good" : tone === "warn" ? "warn" : "");
  box.innerHTML = `<div class="coach-title">${title}</div>${html}`;
  box.classList.remove("hidden");
}

// Show the rule-based coaching immediately; upgrade to Gemini if configured.
async function coach(box, meal, fallbackText, tone) {
  renderCoach(box, tone, "Coach says", escapeHTML(fallbackText));
  if (!aiReady()) return;
  renderCoach(box, tone, "Coach (AI)", "<em>Thinking…</em>");
  try {
    const text = await geminiGenerate(mealContextText(meal));
    renderCoach(box, tone, "Coach (AI)", escapeHTML(text));
  } catch (err) {
    renderCoach(box, tone, "Coach says",
      `${escapeHTML(fallbackText)} <span class="muted small">(AI unavailable: ${escapeHTML(err.message)})</span>`);
  }
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

    coach($("#coachFeedback"), { desc, portion, time: when.toISOString() }, analysis.message, analysis.tone);

    $("#mealDesc").value = "";
    $("#mealPortion").value = "medium";
    $("#mealTime").value = toLocalInputValue(new Date());
    renderAll();
  });

  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("drink-del")) {
      const li = e.target.closest("li");
      const ts = Number(li.dataset.ts), date = li.dataset.date;
      if (state.water[date]) state.water[date] = state.water[date].filter(x => x.ts !== ts);
      save(); renderAll();
    } else if (e.target.classList.contains("meal-del") && !e.target.classList.contains("weight-del")) {
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
  // the time applied to any drink logged; defaults to now, reset after each log
  $("#drinkTime").value = toLocalInputValue(new Date());
  const drinkWhen = () => {
    const v = $("#drinkTime").value;
    return v ? new Date(v) : new Date();
  };
  const resetWhen = () => { $("#drinkTime").value = toLocalInputValue(new Date()); };

  // quick water buttons
  $$(".water-add").forEach(btn => btn.addEventListener("click", () => {
    addHydration(Number(btn.dataset.ml), "water", drinkWhen());
    resetWhen(); renderAll();
  }));
  $("#waterUndo").addEventListener("click", () => {
    const arr = state.water[todayKey()];
    if (arr && arr.length) { arr.pop(); save(); renderAll(); }
  });

  // beverage type selector (sizes are filled/relabelled by renderWater)
  $("#drinkType").innerHTML = Object.entries(BEVERAGES)
    .map(([key, b]) => `<option value="${key}">${b.label}</option>`).join("");

  $("#drinkLog").addEventListener("click", () => {
    const res = logBeverage($("#drinkType").value, $("#drinkSize").value, drinkWhen());
    if (!res) return;
    resetWhen();
    const note = $("#drinkNote");
    if (res.hydrating) {
      if (res.note) { note.className = "coach-box good"; note.innerHTML = res.note; note.classList.remove("hidden"); }
      else note.classList.add("hidden");
    } else {
      coach(note, res.meal, res.analysis.message + " Added to your meal log.", res.analysis.tone);
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
    const blob = new Blob([JSON.stringify(buildBackup(state, syncCfg, aiCfg), null, 2)], { type: "application/json" });
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
      const { data, clientId, ai } = parseBackup(JSON.parse(await file.text()));
      replaceState(Object.assign(defaultState(), data));
      if (typeof clientId === "string") setSyncClientId(clientId);
      if (ai) {
        Object.assign(aiCfg, {
          enabled: !!ai.enabled, apiKey: ai.apiKey || "",
          model: ai.model || DEFAULT_MODEL, systemPrompt: ai.systemPrompt || DEFAULT_PERSONA
        });
        saveAiCfg();
      }
      save(); renderAll(); renderAiControls(); renderDriveControls();
      alert("Backup imported.");
    } catch (err) { alert("That file doesn't look like a LostWeightNow backup."); }
    $("#importFile").value = "";
  });
  $("#resetBtn").addEventListener("click", () => {
    if (confirm("Erase ALL data on this device? This cannot be undone.")) {
      replaceState(defaultState());
      save(); renderAll();
    }
  });
}

/* ---------------- AI settings ---------------- */

function renderAiControls() {
  if (!$("#aiKey")) return;
  $("#aiEnabled").checked = !!aiCfg.enabled;
  const set = (sel, val) => { const el = $(sel); if (el && document.activeElement !== el) el.value = val; };
  set("#aiKey", aiCfg.apiKey || "");
  set("#aiModel", aiCfg.model || DEFAULT_MODEL);
  set("#aiPrompt", aiCfg.systemPrompt || DEFAULT_PERSONA);
}

function setupAI() {
  renderAiControls();
  $("#aiEnabled").addEventListener("change", () => { aiCfg.enabled = $("#aiEnabled").checked; saveAiCfg(); });
  $("#aiKey").addEventListener("change", () => { aiCfg.apiKey = $("#aiKey").value.trim(); saveAiCfg(); });
  $("#aiModel").addEventListener("change", () => { aiCfg.model = $("#aiModel").value.trim() || DEFAULT_MODEL; saveAiCfg(); });
  $("#aiPrompt").addEventListener("change", () => { aiCfg.systemPrompt = $("#aiPrompt").value.trim() || DEFAULT_PERSONA; saveAiCfg(); });
  $("#aiResetPrompt").addEventListener("click", () => { aiCfg.systemPrompt = DEFAULT_PERSONA; saveAiCfg(); $("#aiPrompt").value = DEFAULT_PERSONA; });
  $("#aiTestBtn").addEventListener("click", async () => {
    aiCfg.apiKey = $("#aiKey").value.trim();
    aiCfg.model = $("#aiModel").value.trim() || DEFAULT_MODEL;
    saveAiCfg();
    const el = $("#aiStatus");
    if (!aiCfg.apiKey) { el.textContent = "Enter your Gemini API key first."; return; }
    el.textContent = "Testing…";
    try {
      const txt = await geminiGenerate("Reply in one short sentence confirming you're ready to act as the user's dietary coach.");
      el.textContent = "✓ Connected: " + txt;
    } catch (err) { el.textContent = "Failed: " + err.message; }
  });
}

/* ---------------- boot ---------------- */

setupTabs();
setupMeals();
setupWater();
setupWeight();
setupSettings();
setupSync();
setupAI();
renderAll();
setInterval(renderFasting, 30 * 1000); // keep the fasting clock live

// On open: if cloud sync is connected, pull the latest (silently) so a fresh
// install or new deploy comes preloaded with your data, then re-sync on return.
if (syncCfg.connected && syncCfg.clientId) {
  cloudSync().catch(() => {});
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") cloudSync().catch(() => {});
  });
}

if ("serviceWorker" in navigator) {
  // If a service worker was already controlling this page, a controllerchange
  // means a new version has taken over — reload once to run the fresh code.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !hadController) return;
    reloading = true;
    window.location.reload();
  });
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.update().catch(() => {});
    // check for a new version whenever the app is brought back to the foreground
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  }).catch(() => {});
}
