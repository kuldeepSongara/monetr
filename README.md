# Spendwise

A local-first personal spending tracker with bill reminders, budgets, charts and optional AI insights. Built as a mobile-first PWA, so it runs as an Android home-screen app and in a wide desktop layout on a MacBook.

There is no backend, no account and no database server. Everything lives in IndexedDB inside your browser. AI calls go straight from the browser to the provider you configure.

---

## Quick start

This project was set up without a system Node install, so a local copy of Node lives in `.tooling/node`. Either use it explicitly:

```bash
export PATH="$PWD/.tooling/node/bin:$PATH"
npm install      # first time only
npm run dev
```

…or install Node 20+ yourself and use `npm run dev` normally.

Open <http://localhost:5173>.

Production build:

```bash
npm run build      # typechecks, then bundles into dist/
npm run preview    # serves dist/ at http://localhost:4173
```

Other scripts:

```bash
npm run typecheck  # tsc --noEmit for the app
npm run icons      # regenerates public/icon-*.png without any image deps
```

---

## Using it on your phone (Android)

1. Keep your Mac and phone on the same Wi-Fi.
2. Run `npm run dev` (Vite is configured with `server.host: true`).
3. Find your Mac’s LAN IP (`ipconfig getifaddr en0` on macOS).
4. Open `http://<your-ip>:5173` in Chrome on the phone.
5. Chrome menu → **Add to Home screen**. It launches full-screen like a native app and works offline after the first load.

The phone has its own separate database — this is local-first by design, not cloud sync. Move data between devices with **Settings → Your data → Backup JSON** and **Merge backup**.

### On the MacBook

Use the same URL in Safari/Chrome for the desktop layout: fixed sidebar, wider cards and larger charts. Installing the PWA also works.

---

## Features

- **Fast entry** — amount, category, merchant, date, note, multi-currency with an FX rate. A single quick-add bar accepts natural language when AI is configured.
- **Bills & reminders** — bills predict their next due date from history (calendar day for fixed bills, median gap otherwise), with lead times, snooze, mark-paid, autopay flags and confidence. Reminders use local notifications while the app is open, and a reliable `.ics` export for Google/Apple Calendar.
- **Budgets & safe-to-spend** — per-category and overall budgets per pay cycle or week, optional rollover, allowance fallback, and a daily safe-to-spend number that accounts for upcoming bills.
- **Insights** — deterministic anomaly detection (category spikes, duplicates, large charges), recurring-subscription detection with AI audit, a period digest, and free-form “ask about my spending”.
- **AI profiles** — Gemini, OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Ollama and any OpenAI-compatible endpoint. Multiple profiles with priority order, per-profile connection tests and health, automatic failover and an optional “keep the working profile preferred” mode.
- **Personalisation** — light/dark/system theme, accent colours, reorderable dashboard widgets, custom categories, pay-cycle day, week start, base currency.
- **Privacy** — all data stays in the browser. A soft PIN lock hides the app on shared devices (it is a privacy curtain, **not encryption**). JSON backup and CSV export keep you in control.

---

## AI keys

1. Get a key from your provider. For Gemini, use [Google AI Studio](https://aistudio.google.com/apikey); the default model is `gemini-2.5-flash`.
2. In Spendwise: **Settings → AI profiles → Add**.
3. Pick the provider, paste the key, adjust the model if you like, then **Test connection** and **Save profile**.
4. Mark one profile as **Prefer**. Profiles are tried in priority order when failover is on.

Notes:

- Keys are stored in IndexedDB in this browser only and are sent directly to the provider. There is no proxy server.
- Browser CORS rules apply. Gemini, OpenAI and Anthropic (with the direct-browser header) work from the browser; some providers may require a custom base URL or proxy.
- Ollama and “Custom” default to `localhost`. On a phone, `localhost` is the phone itself — use your computer’s LAN IP instead (e.g. `http://192.168.1.20:11434/v1`).
- The **preferred** profile is the one used first. If it errors, Spendwise records the error, cools that profile down for 45 seconds, and tries the next ready profile. With “Keep the working profile preferred” on, the profile that answered becomes the new preferred one, and Settings shows the last failover.
- Receipt scanning needs a vision-capable model (Gemini, GPT-4o/4.1, Claude, or a compatible endpoint).

---

## Data, backups and migrations

- **Backup JSON** contains settings, profiles, categories, transactions, bills, payments, budgets and rules.
- **Merge backup** adds records whose IDs are not already present. **Replace from backup** wipes current data and restores the file.
- **Export CSV** is for spreadsheets; it is not re-importable.
- **Erase all data** clears the local database and returns to onboarding.

Money is stored as integer minor units. Transactions keep their original `amount`/`currency` plus `fxRate` and a `baseAmount` in the base currency at entry time. Changing the base currency relabels stored base amounts (it does not re-fetch historical FX rates).

The Dexie schema is versioned in `src/db/db.ts` (`SCHEMA_VERSION = 1`). To evolve it, **never edit version 1** — add a new `this.version(n).stores({...}).upgrade(...)` block. That keeps existing databases intact.

---

## Project structure

```
src/
  ai/           providers, browser client with failover, prompt tasks, context builder
  components/   shell, UI primitives, charts, editors, onboarding, lock screen
  db/           Dexie schema, defaults, CRUD, backup/import, exports, sample data
  lib/          money, dates, analytics, bill prediction, image helpers, utils
  pages/        Dashboard, Transactions, Bills, Budgets, Insights, Settings
  App.tsx       gate: loading → lock → onboarding → routed shell
  store.tsx     app state, derived budgets/safe-to-spend/anomalies/subscriptions
  index.css     design tokens and component classes
public/         manifest, service worker, generated icons
scripts/        dependency-free PNG icon generator
```

### Hosting

There is nothing to host beyond static files, and you do not need to host it at all. If you want it on the web later, `dist/` is a plain static bundle — put it on any static host (or a local `npm run preview`). Using `HashRouter` means no server rewrite rules are required.
