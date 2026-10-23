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
export const DEFAULT_BUDGET = 0;
export const DEFAULT_LIMITS = {
  food: 0,
  transport: 0,
  shopping: 0,
  bills: 0,
  entertainment: 0,
  health: 0,
  other: 0
};
export const STORAGE_KEY = "pocketwise_ledger_v1";
export const LANG_KEY = "pocketwise_lang_v1";
export const TOUR_SEEN_KEY = "pocketwise_tour_seen_v1";
export const QUICK_AMOUNTS = [10, 20, 50, 100, 200, 500];

export function emptyLedger() {
  return { entries: [], budget: DEFAULT_BUDGET, limits: { ...DEFAULT_LIMITS } };
}
