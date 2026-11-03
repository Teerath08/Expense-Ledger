export const CATEGORIES = [
  { id: "food", label: "Food", icon: "🍔" },
  { id: "transport", label: "Transport", icon: "🚗" },
  { id: "shopping", label: "Shopping", icon: "🛍️" },
  { id: "bills", label: "Bills", icon: "🧾" },
  { id: "entertainment", label: "Entertainment", icon: "🎬" },
  { id: "health", label: "Health", icon: "💊" },
  { id: "other", label: "Other", icon: "📌" }
];

export const CAT = new Map(CATEGORIES.map(category => [category.id, category]));
export const DEFAULT_SAVINGS_GOAL = 1000;
export const STORAGE_KEY = "pocketwise_ledger_v1";
export const LANG_KEY = "pocketwise_lang_v1";
export const TOUR_SEEN_KEY = "pocketwise_tour_seen_v1";
/* Remembers the last month a "new month started" notice was shown, so the
   announcement fires exactly once per month. */
export const MONTH_NOTICE_KEY = "pocketwise_month_notice_v1";
export const QUICK_AMOUNTS = [10, 20, 50, 100, 200, 500];

export function emptyLedger() {
  return { entries: [], budgets: {}, savingsGoal: DEFAULT_SAVINGS_GOAL };
}

/* Each month keeps its own budget: budgets["2026-11"] = 5000. */
export function getMonthBudget(ledger, key) {
  const value = Number(ledger?.budgets?.[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function setMonthBudget(ledger, key, amount) {
  const budgets = { ...(ledger?.budgets || {}) };
  if (amount > 0) budgets[key] = amount;
  else delete budgets[key];
  return budgets;
}
