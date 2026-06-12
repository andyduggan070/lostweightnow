// Renders the app in headless Chromium at iPhone size and screenshots each tab.
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");

const demo = {
  profile: { age: 45, sex: "male", heightCm: 178, startWeightKg: 98, weightUnit: "kg", waterUnit: "ml" },
  goal: { weightKg: 85, date: "2026-12-01", startWeightKg: 98, startDate: "2026-05-01" },
  fasting: { start: "12:00", end: "20:00" },
  waterGoalMl: 2500,
  water: {},
  meals: [],
  weights: [
    { date: "2026-05-01", kg: 98 }, { date: "2026-05-08", kg: 97.2 },
    { date: "2026-05-15", kg: 96.8 }, { date: "2026-05-22", kg: 96.9 },
    { date: "2026-05-29", kg: 95.8 }, { date: "2026-06-05", kg: 95.1 },
    { date: "2026-06-12", kg: 94.6 }
  ]
};
const today = new Date();
const k = today.toISOString().slice(0, 10);
demo.water[k] = [{ ml: 500, ts: Date.now() }, { ml: 250, ts: Date.now() }];
const mealAt = (h, m, desc, portion, flags, outside = false) => {
  const d = new Date(); d.setHours(h, m, 0, 0);
  return { id: Math.random().toString(36).slice(2), desc, time: d.toISOString(), portion, flags, tone: "neutral", message: "", outsideWindow: outside };
};
demo.meals = [
  mealAt(12, 30, "Grilled chicken salad with avocado", "medium",
    [{ label: "lean protein", type: "good" }, { label: "vegetables", type: "good" }, { label: "healthy fats", type: "good" }]),
  mealAt(15, 0, "Apple and a handful of almonds", "small",
    [{ label: "fruit", type: "good" }, { label: "healthy fats", type: "good" }]),
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:8765/index.html");
await page.evaluate((d) => localStorage.setItem("lwn-state-v1", JSON.stringify(d)), demo);
await page.reload();
await page.waitForTimeout(400);

for (const tab of ["today", "history", "weight", "settings"]) {
  await page.click(`.tab-btn[data-tab="${tab}"]`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `/tmp/lwn-${tab}.png`, fullPage: tab !== "today" });
}

// also capture the coach feedback after logging a junk meal
await page.click('.tab-btn[data-tab="today"]');
await page.fill("#mealDesc", "Double cheeseburger, large fries and a cola");
await page.selectOption("#mealPortion", "large");
await page.click('#mealForm button[type="submit"]');
await page.waitForTimeout(250);
await page.locator("#coachFeedback").scrollIntoViewIfNeeded();
await page.screenshot({ path: "/tmp/lwn-coach.png" });

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await browser.close();
console.log("screenshots written", errors.length ? "ERRORS: " + errors.join("; ") : "(no page errors)");
