# Monetr

A local-first personal spending tracker with bill reminders, budgets, investments, charts and optional AI insights. Built as a mobile-first PWA, so it runs as an Android home-screen app and in a wide desktop layout on a MacBook.

Your data lives in IndexedDB on each device. Optional cloud sync keeps devices in step through an **end-to-end encrypted** copy on a small Vercel + Neon backend — the server only ever sees ciphertext. AI calls go straight from the browser to the provider you configure.

---

## Quick start

This project was set up without a system Node install, so a local copy of Node lives in `.tooling/node`. Either use it explicitly:

```bash
export PATH="$PWD/.tooling/node/bin:$PATH"
npm install      # first time, and after pulling changes (new deps: jsqr, vitest, @types/node)
npm run dev
```

…or install Node 20+ yourself and use `npm run dev` normally. Open <http://localhost:5173>.

```bash
npm run build      # typechecks app + API, then bundles into dist/
npm run preview    # serves dist/ at http://localhost:4173
npm test           # unit tests (bill prediction, sync merge, investments, …)
npm run typecheck
npm run icons      # regenerates public/icon-*.png without any image deps
```

---

## Phone and laptop

**Use your https deployment (Vercel URL) on the phone.** Browsers only allow the camera (QR scanning), fingerprint unlock and sync encryption on https or `localhost`. Plain `http://192.168.x.x:5173` from `npm run dev` still works for everyday use, but those three features are disabled there (the app tells you why).

1. Open the Vercel URL in Chrome on Android → menu → **Add to Home screen**. On the Mac, open it in Chrome/Safari (or install it).
2. On one device: **Settings → Cloud sync → Turn on sync here**. A QR appears.
3. On the other device: **Settings → Cloud sync → Scan QR** (or on a fresh install, **Already use Monetr? Scan the sync QR** on the welcome screen). The phone's own camera app works too — the QR is a link that opens Monetr and offers to link.

After that, devices sync automatically when you make changes, open the app, or come back online.

---

## Features

- **Fast entry** — expense, income or transfer; any currency with the rate prefilled from the last one you used; learned merchant → category rules; natural-language quick add (AI, with an offline parser when AI is down) and receipt scanning.
- **Refunds** — open an expense → Refund / return (full or partial). Refunds reduce that category's spending rather than counting as income.
- **Roommate split** — give a bill a split (percent or fixed). Each payment shows what to collect, a reminder you can share, and “Got it” records their share as a refund.
- **Interactive report** — Insights or Settings → Interactive report: a single offline .html file with filterable charts (daily spikes, categories, monthly cash flow, merchants, weekdays) and a searchable table. On a phone it opens the share sheet.
- **Bills** — next due date predicted from real payments (early/late payments never shift a cycle; missed payments are counted). Autopay bills are recorded on their due date and flagged for you to confirm the amount actually taken. Notifications while open, `.ics` export for calendar alarms.
- **Budgets & safe-to-spend** — per category, per group of categories sharing one limit (e.g. Shopping + Dining), or overall; per pay cycle or week, rollover, allowance fallback.
- **Savings pots** — for one-time buys (laptop, phone). Save up first, or pay back something you already bought over a few cycles. Pot purchases skip the cycle budget and spike alerts but stay in history and charts; each pot's per-cycle amount is held back from safe-to-spend. Big recent purchases get a suggestion — never moved automatically.
- **Share charts** — a PNG of total, category split and spending over time for family or friends (Dashboard or Insights). This month by default; amounts or percentages only; hide categories. No merchants, notes or transactions.
- **Investments** — holdings derived from buy/sell/dividend/interest/fee transactions: quantity, average cost, realised and unrealised P/L. Currency profiles per country, and transfers between them recorded with the bank's real debited/credited amounts.
- **flagIt** — AI review of your actual numbers (spikes, duplicates, subscriptions, likely FX fees), habit forecast, “before you buy” check against budget and bills, and statement import from screenshot/PDF/CSV/text with an editable review list (duplicates and low-confidence lines unticked).
- **Insights** — anomaly detection, recurring-subscription detection (weekly to yearly) with AI audit, digest, and “ask about my spending”.
- **Lock** — PIN plus Touch ID / Android fingerprint (WebAuthn platform authenticator). Locks the moment you switch tabs or apps (or after 30 s / 1 min / 5 min), optionally on window blur. Wrong-PIN backoff. The PIN syncs; fingerprint is enabled per device.
- **AI profiles** — Gemini, OpenAI, Anthropic, OpenRouter, Groq, Cerebras, DeepSeek, Mistral, xAI, Together, Ollama and any OpenAI-compatible endpoint. Overloaded/rate-limited calls are retried with backoff, then each profile's backup models (same key), then the next profile. Image/PDF requests only go to profiles that can read them. CSV statements and quick add work without AI.

---

## Cloud sync (Vercel + Neon)

1. Create a free Neon Postgres database and copy its connection string.
2. In the Vercel project: **Settings → Environment Variables → `DATABASE_URL`** = that string. Redeploy.
3. The table is created on first use.

What syncs: everything — transactions, bills and payments, budgets, rules, investments, flagIt reviews, currency profiles, appearance (theme, accent, dashboard layout), money settings, AI profiles and failover settings, and the PIN/auto-lock settings. Only the fingerprint key (tied to each device's sensor), wrong-PIN counters and notification permission stay per device. Set up on the laptop, scan one QR on the phone, done; later edits on either device appear on the other.

How it works: a pairing code `mtr1.<syncId>.<key>` (inside the QR) holds a random 256-bit key that never leaves your devices. Each sync pulls the encrypted snapshot, decrypts and merges it record by record (newest `updatedAt` wins; deletions travel as tombstones), writes the result locally, then encrypts and pushes it with optimistic versioning. A write token derived from the key stops anyone else overwriting your snapshot. You can turn off “Sync AI profiles” if you'd rather keep API keys on one device.

Running the app locally but syncing through the deployment? Set **Sync server** in Settings → Cloud sync to your Vercel URL.

---

## AI keys

1. Get a key from your provider. For Gemini, use [Google AI Studio](https://aistudio.google.com/apikey).
2. **Settings → AI profiles → Add**, pick the provider, paste the key, **Test connection**, **Save profile**.
3. Mark one as **Prefer**. Others are tried in priority order when failover is on.
4. **Add a free backup.** Gemini's free Flash model is often overloaded. Settings suggests free providers to add: Groq (fast, generous), OpenRouter (models ending in `:free`), Cerebras. Each profile also has **Backup models** tried with the same key (Gemini defaults to `gemini-flash-latest`, `gemini-2.5-flash-lite`, `gemini-2.0-flash`).

Keys are stored in IndexedDB on this device and sent directly to the provider. Receipt scanning needs a vision model; PDF statement import needs Gemini, Claude or OpenAI.

---

## Data, backups and migrations

- **Backup JSON** contains everything: settings, AI profiles, categories, transactions, bills, payments, budgets, rules, currency profiles, investments, investment transactions and transfers, flags.
- **Merge backup** adds records whose IDs are not present. **Replace from backup** wipes current data and restores the file (your lock settings stay).
- **Erase all data** unlinks sync first, so other devices keep their data.

Money is stored as integer minor units with the original `amount`/`currency`, the `fxRate` and a `baseAmount`. Changing the base currency relabels stored base amounts.

The Dexie schema is versioned in `src/db/db.ts` (`SCHEMA_VERSION = 2`). Never edit a released version block — add `this.version(n).stores({...}).upgrade(...)`.

---

## Project structure

```
api/sync/       Vercel functions: encrypted snapshot pull/push (Neon Postgres)
src/
  ai/           providers, browser client with capability-aware failover, prompt tasks, context builder
  components/   shell, UI primitives, charts, editors, onboarding, lock screen, settings cards, sync + QR scanner
  db/           Dexie schema, CRUD, tombstones, autopay reconciliation, backup/import, exports, sample data
  lib/          money, dates, analytics, bills, investments, sync, biometric, PIN hashing, rules/FX suggestions
  pages/        Dashboard, Transactions, Bills, Budgets, Investments, flagIt, Insights, Guide, Settings
  __tests__/    vitest unit tests
public/         manifest, service worker, generated icons
```
