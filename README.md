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

Plain HTML/CSS/JS — no build step. Run locally with any static server:

```sh
npx http-server -p 8080
```

- `tools/logic-test.mjs` — smoke tests for the fasting-window, coaching and
  goal-trajectory logic (`node tools/logic-test.mjs`).
- `tools/make_icons.py` — regenerates the app icons (stdlib only).
- `tools/screenshot.mjs` — Playwright screenshots of each tab.

This app provides general wellness guidance only and is not medical advice.
