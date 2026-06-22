/* All DOM rendering. Reads state + domain helpers and paints the UI. */

import { $, $$, dateKey, todayKey, fmtTime, fmtDate, fmtDuration, fmtHM, escapeHTML } from "./util.js";
import { state, latestWeight } from "./store.js";
import {
  kgToDisplay, mlToDisplay, fmtWeight, fmtWater,
  windowInfo, waterToday, expectedWeightKg,
  DRINK_SIZES, drinkLabel, drinkIcon,
  ACTIVITIES, activityMinutes
} from "./domain.js";

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

// today's hydrating drinks, timestamped, newest first, each deletable
function renderDrinks() {
  const k = todayKey();
  const entries = (state.water[k] || []).slice().sort((a, b) => b.ts - a.ts);
  $("#todayDrinks").innerHTML = entries.map(e => {
    const type = e.type || "water";
    return `<li class="meal-item" data-ts="${e.ts}" data-date="${k}">
      <div class="meal-top">
        <span class="meal-desc"><span class="drink-icon">${drinkIcon(type)}</span>${drinkLabel(type)}</span>
        <span class="meal-meta">${fmtTime(e.ts)} · ${fmtWater(e.ml)}
          <button class="meal-del drink-del" title="Delete" aria-label="Delete drink">✕</button></span>
      </div>
    </li>`;
  }).join("");
}

function mealItemHTML(meal, showKj = true) {
  const flagsHTML = meal.flags.map(f =>
    `<span class="flag ${f.type === "good" ? "good" : f.type === "bad" ? "bad" : "warn"}">${f.label}</span>`).join("");
  const outside = meal.outsideWindow ? `<span class="flag bad">outside window</span>` : "";
  const kj = (showKj && meal.kj) ? ` · ≈${meal.kj} kJ` : "";
  return `<li class="meal-item" data-id="${meal.id}">
    <div class="meal-top">
      <span class="meal-desc">${escapeHTML(meal.desc)}</span>
      <span class="meal-meta">${fmtTime(meal.time)} · ${meal.portion}${kj}
        <button class="meal-del" title="Delete" aria-label="Delete meal">✕</button></span>
    </div>
    <div class="meal-flags">${flagsHTML}${outside}</div>
  </li>`;
}

function renderMeals() {
  const today = todayKey();
  const todays = state.meals.filter(m => dateKey(m.time) === today)
    .sort((a, b) => new Date(a.time) - new Date(b.time));
  $("#todayMeals").innerHTML = todays.map(m => mealItemHTML(m)).join("");
  $("#noMeals").classList.toggle("hidden", todays.length > 0);

  // history grouped by day (meals + drinks), newest first
  const byDay = {};
  for (const m of state.meals) (byDay[dateKey(m.time)] ||= { meals: [], drinks: [] }).meals.push(m);
  for (const k of Object.keys(state.water)) {
    if ((state.water[k] || []).length) (byDay[k] ||= { meals: [], drinks: [] }).drinks = state.water[k];
  }
  const days = Object.keys(byDay).sort().reverse();
  $("#historyList").innerHTML = days.length
    ? days.map(k => {
        const day = byDay[k];
        const meals = day.meals.sort((a, b) => new Date(a.time) - new Date(b.time)).map(m => mealItemHTML(m, false)).join("");
        const water = day.drinks.reduce((s, e) => s + e.ml, 0);
        const kjTotal = day.meals.reduce((s, m) => s + (m.kj || 0), 0);
        const kjHead = kjTotal > 0 ? ` · ⚡ ${kjTotal} kJ` : "";
        const drinks = day.drinks.slice().sort((a, b) => a.ts - b.ts).map(e => {
          const type = e.type || "water";
          return `<li class="meal-item">
            <div class="meal-top">
              <span class="meal-desc"><span class="drink-icon">${drinkIcon(type)}</span>${drinkLabel(type)}</span>
              <span class="meal-meta">${fmtTime(e.ts)} · ${fmtWater(e.ml)}</span>
            </div></li>`;
        }).join("");
        return `<div class="history-day"><h3>${fmtDate(k)} · 💧 ${fmtWater(water)}${kjHead}</h3>
          ${meals ? `<ul class="meal-list">${meals}</ul>` : ""}
          ${drinks ? `<ul class="meal-list drinks-list">${drinks}</ul>` : ""}</div>`;
      }).join("")
    : `<p class="muted">Nothing logged yet.</p>`;
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

  const kjTotal = todays.reduce((s, m) => s + (m.kj || 0), 0);
  const kjCount = todays.filter(m => m.kj).length;

  const lines = [];
  lines.push(`You've logged ${todays.length} meal${todays.length > 1 ? "s" : ""} today.`);
  if (kjTotal > 0) lines.push(`Estimated intake: ≈${kjTotal} kJ${kjCount < todays.length ? ` (from ${kjCount} of ${todays.length} items)` : ""}.`);
  if (goods > bads && bads === 0) lines.push(`Food quality is strong — every flagged item was a good one. This is what progress looks like.`);
  else if (goods > bads) lines.push(`More good choices than poor ones today — solid, but the ${bads} weak spot${bads > 1 ? "s" : ""} are where the easy wins are.`);
  else if (bads > 0) lines.push(`Straight talk: today leaned toward foods that fight your goal (${bads} flagged vs ${goods} good). Tomorrow, plan your first meal before hunger decides for you.`);
  if (outside > 0) lines.push(`${outside} meal${outside > 1 ? "s were" : " was"} outside your eating window — protect the fast, it's half the method.`);
  lines.push(waterPct >= 100 ? `Water goal hit (${waterPct}%). 💧` : `Water is at ${waterPct}% of goal — ${fmtWater(Math.max(0, state.waterGoalMl - drunk))} to go.`);

  const tone = bads > goods || outside > 0 ? "warn" : (goods > 0 && bads === 0 ? "good" : "");
  box.className = "coach-box " + tone;
  box.innerHTML = `<div class="coach-title">Coach's view of today</div>` + lines.join(" ");
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

  let grid = "";
  for (let i = 0; i <= 3; i++) {
    const kg = minKg + (i / 3) * (maxKg - minKg);
    const y = Y(kg);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e2e8f0"/>` +
      `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="#64748b">${kgToDisplay(kg).toFixed(1)}</text>`;
  }

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

function activityItemHTML(a) {
  const cfg = ACTIVITIES[a.type] || { label: a.type, icon: "🏃" };
  const dist = cfg.distance && a.distance ? ` · ${a.distance} ${cfg.distance}` : "";
  const intensity = a.intensity ? ` · ${a.intensity}` : "";
  return `<li class="meal-item" data-id="${a.id}">
    <div class="meal-top">
      <span class="meal-desc"><span class="drink-icon">${cfg.icon}</span>${cfg.label}</span>
      <span class="meal-meta">${fmtTime(a.start)}–${fmtTime(a.end)}
        <button class="meal-del activity-del" title="Delete" aria-label="Delete activity">✕</button></span>
    </div>
    <div class="meal-flags muted small">${fmtDuration(activityMinutes(a))}${dist}${intensity}</div>
  </li>`;
}

function renderActivities() {
  const acts = state.activities || [];
  if (!acts.length) {
    $("#activityList").innerHTML = `<p class="muted">No activity logged yet. Record a walk, ride, gym session, swim or sport above.</p>`;
    return;
  }
  const byDay = {};
  for (const a of acts) (byDay[dateKey(a.start)] ||= []).push(a);
  const days = Object.keys(byDay).sort().reverse();
  $("#activityList").innerHTML = days.map(k => {
    const items = byDay[k].sort((x, y) => new Date(x.start) - new Date(y.start)).map(activityItemHTML).join("");
    const mins = byDay[k].reduce((s, a) => s + activityMinutes(a), 0);
    return `<div class="history-day"><h3>${fmtDate(k)} · ⏱ ${fmtDuration(mins)}</h3><ul class="meal-list">${items}</ul></div>`;
  }).join("");
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

export function renderAll() {
  renderFasting();
  renderWater();
  renderDrinks();
  renderMeals();
  renderDailyReview();
  renderGoalStatus();
  renderWeightChart();
  renderWeightList();
  renderWeighReminder();
  renderActivities();
  renderSettings();
}

export { renderFasting, renderWater, renderDrinks, renderMeals, renderDailyReview, renderProfileStats };
