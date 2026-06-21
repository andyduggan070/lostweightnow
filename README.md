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
- **Drinks tracking** — set a daily hydration goal and tap to log. Water,
  coffee, tea and other no-sugar drinks count toward the goal with a running
  remaining tally; sugary drinks (soft drinks, juice, energy drinks, alcohol)
  are routed to your meal log instead, where they're coached and counted.
  Each drink is timestamped (with an editable date/time so you can back-date),
  and the day's drinks are listed with their times on Today and in History so
  you can see your drinking patterns.
- **Weekly weigh-ins** — charted against your goal trajectory, with a clear
  on-target / ahead / behind verdict and a reminder when a weigh-in is due.
- **Goals** — enter a goal weight and target date; the app tells you the
  required weekly rate and is honest when the plan is unrealistically fast.
- **Profile** — age, sex, height and starting weight give you BMI and an
  estimated daily calorie guide. Units: kg/lb and ml/fl oz.
- **Offline & private** — works without a connection after first load;
  data lives in your browser storage with export/import backup.
- **Cloud sync (Google Drive, optional)** — connect your Google account to
  back up automatically to a `LostWeightNow` folder in your own Drive and sync
  between your iPhone and iPad. Data syncs on open and after each change (while
  the app is open and online); entries are merged across devices so nothing is
  lost. Uses Google sign-in (OAuth) with the `drive.file` scope, so the app can
  only ever see the files it creates — never the rest of your Drive, and never
  your password.

- **AI coach (Google Gemini, optional)** — connect a free Gemini API key to
  replace the built-in keyword coach with real AI dietary coaching. You can
  fully customise the coach's persona/instructions (e.g. *"In your role as a
  dietary expert and coach…"*). The built-in coach is the offline fallback.

## AI coach setup (one-time)

1. Go to [Google AI Studio](https://aistudio.google.com/) → **Get API key** →
   create a key (free tier; no billing required).
2. In the app: **Settings → AI Coach (Google Gemini)**, tick **Use Gemini as my
   coach**, paste the key, optionally edit the **Model** (default
   `gemini-2.0-flash`) and the **persona/instructions**, then **Test
   connection**.

The key is stored only in your browser (and in your exported backup file — see
below); it is never put into the app's public code. For extra safety you can
restrict the key in Google Cloud to the *Generative Language API* and to your
site's address. Meal text and context are sent to Google when AI coaching is on.

## Backups & moving keys between devices

**Settings → Your Data → Export backup** saves a single JSON file containing
your data **plus** your Drive Client ID, Gemini API key and coach persona. Save
it via the iOS share sheet into **Files → iCloud Drive**, then **Import backup**
on your other device to restore everything (keys included). Keep this file
private, as it contains your keys.

## Cloud sync setup (one-time)

To enable Google Drive sync you create a free Google OAuth Client ID and paste
it into **Settings → Cloud Sync**:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create a project (any name).
2. **APIs & Services → Library →** enable the **Google Drive API**.
3. **APIs & Services → OAuth consent screen:** choose **External**, fill in an
   app name and your email, and add your own Google address under **Test
   users**. Leave it in **Testing** mode (no Google verification needed for
   personal use).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Web application.** Under **Authorized JavaScript origins** add your app URL
   (e.g. `https://looseweightnow.netlify.app`). Create it and copy the
   **Client ID** (ends in `.apps.googleusercontent.com`).
5. In the app: **Settings → Cloud Sync**, paste the Client ID, tap **Connect
   Google Drive**, and sign in. Repeat the paste+connect on your other device
   with the **same** Client ID to sync them.

Notes: sign-in tokens last about an hour — the app refreshes silently when you
reopen it if your Google session is active, otherwise tap **Connect** again.
Sync runs while the app is open; it can't sync in the background when closed.

## Deploy (Netlify)

This is a static site, so Netlify needs no build step — `netlify.toml`
publishes the repo root as-is.

**Option A — connect the repo (auto-deploys on every push):**
1. In Netlify: **Add new site → Import an existing project → GitHub**.
2. Pick the `lostweightnow` repo. Netlify reads `netlify.toml`, so leave the
   build command empty and the publish directory as `.`.
3. **Deploy.** You get a URL like `https://your-site.netlify.app/`.

**Option B — instant drag-and-drop (no Git):**
Download the repo as a folder and drag it onto the
**Sites** area of the Netlify dashboard. Live in seconds.

## Install on iPhone / iPad

1. Open your Netlify URL in **Safari** on your iPhone/iPad.
2. Tap the **Share** button → **Add to Home Screen**.
3. Launch it from the home screen — it runs full-screen like a native app.

> Note: data is stored per device. Use **Settings → Export backup** to move
> your history between iPhone and iPad.

## Development

Plain HTML/CSS/JS ES modules — no build step. Run locally with any static
server:

```sh
npx http-server -p 8080
```

The JavaScript is split into focused modules under `js/` with a one-way
dependency flow (each layer only imports from the ones above it):

- `js/util.js` — pure helpers (DOM selectors, date/number formatting).
- `js/store.js` — app state and persistence (`localStorage`).
- `js/domain.js` — all logic: units, fasting window, coaching rules,
  beverages, weight maths, sync merge, Gemini calls, backup bundles.
  DOM-free, so it's unit-tested directly.
- `js/render.js` — turns state into DOM.
- `js/sync.js` — Google Drive cloud sync.
- `js/ui.js` — event wiring, the live coach box, and app boot (entry point).

Tooling:

- `tools/logic-test.mjs` — unit tests that import `js/domain.js` directly and
  cover the fasting window, coaching, goal trajectory, beverage routing, sync
  merge and backup bundle (`node tools/logic-test.mjs`).
- `tools/make_icons.py` — regenerates the app icons (stdlib only).
- `tools/screenshot.mjs` — Playwright screenshots of each tab.

This app provides general wellness guidance only and is not medical advice.
