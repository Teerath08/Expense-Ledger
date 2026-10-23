# PocketWise — Expense Ledger

A private, browser-based expense ledger built with Next.js, React, and plain CSS.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production build

```bash
npm run build
```

The static site is written to `out/`. It can be served by any static host.

## GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds the app with
`NEXT_PUBLIC_BASE_PATH=/Expense-Ledger` and deploys `out/` to GitHub Pages.
Set the repository's Pages source to **GitHub Actions** when using this workflow.

## Project structure

- `app/layout.js` — document metadata, fonts, and global layout
- `app/page.js` — entry page
- `app/globals.css` — the complete visual system and responsive styles
- `components/LedgerApp.jsx` — interactive ledger, budgets, filters, export, and tutorial
- `lib/i18n.js` — English and Hindi copy plus tutorial steps
- `lib/constants.js` — categories, storage keys, and defaults
- `lib/utils.js` — dates, money, sanitizing, and CSV helpers

Ledger data stays in the browser under `pocketwise_ledger_v1`.
