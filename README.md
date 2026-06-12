# LostWeightNow

A personal weight-loss companion that runs on your iPhone and iPad as an
installable web app (PWA). All data stays privately on your device.

## Features

- **Meal logging** — record what you ate, when, and the portion size.
- **Honest coaching** — every meal gets straight-talking feedback on the food
  choices (good choices, warning foods, portion sizes, late-night eating),
  plus a daily coach review.
- **Intermittent fasting** — set your eating window; the app tracks whether
  you're inside it, warns when a meal breaks the fast, and tells you exactly
  when your next recommended meal is.
- **Water tracking** — set a daily goal and tap to log; a running tally shows
  how much is remaining.
- **Weekly weigh-ins** — charted against your goal trajectory, with a clear
  on-target / ahead / behind verdict and a reminder when a weigh-in is due.
- **Goals** — enter a goal weight and target date; the app tells you the
  required weekly rate and is honest when the plan is unrealistically fast.
- **Profile** — age, sex, height and starting weight give you BMI and an
  estimated daily calorie guide. Units: kg/lb and ml/fl oz.
- **Offline & private** — works without a connection after first load;
  data lives in your browser storage with export/import backup.

## Install on iPhone / iPad

1. Host the app over HTTPS (easiest: enable **GitHub Pages** on this repo —
   the included workflow in `.github/workflows/pages.yml` deploys it
   automatically from `main`; in repo Settings → Pages choose
   **Source: GitHub Actions**).
2. Open the URL in **Safari** on your iPhone/iPad.
3. Tap the **Share** button → **Add to Home Screen**.
4. Launch it from the home screen — it runs full-screen like a native app.

> Note: data is stored per device. Use **Settings → Export backup** to move
> your history between iPhone and iPad.

## Development

Plain HTML/CSS/JS — no build step. Run locally with any static server:

```sh
npx http-server -p 8080
```

- `tools/logic-test.mjs` — smoke tests for the fasting-window, coaching and
  goal-trajectory logic (`node tools/logic-test.mjs`).
- `tools/make_icons.py` — regenerates the app icons (stdlib only).
- `tools/screenshot.mjs` — Playwright screenshots of each tab.

This app provides general wellness guidance only and is not medical advice.
