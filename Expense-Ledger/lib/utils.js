import { CAT, DEFAULT_SAVINGS_GOAL } from "./constants";

export const pad2 = value => String(value).padStart(2, "0");
export const monthKeyOf = date => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
export const dayKeyOf = date => `${monthKeyOf(date)}-${pad2(date.getDate())}`;
export const startOfMonth = date => new Date(date.getFullYear(), date.getMonth(), 1);
export const daysInMonth = date => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
export const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function money(value) {
  const rounded = round2(Number(value) || 0);
  return `${rounded < 0 ? "−" : ""}₹${Math.abs(rounded).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function uid() {
  if (typeof window !== "undefined" && window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function slashDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    numberingSystem: "latn"
  });
}

export function timeLabel(ts) {
  return new Date(ts)
    .toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      numberingSystem: "latn"
    })
    .toUpperCase();
}

export function sanitizeState(raw) {
  const clean = {
    entries: [],
    budgets: {},
    savingsGoal: DEFAULT_SAVINGS_GOAL
  };
  if (!raw || typeof raw !== "object") return clean;

  /* Per-month budgets: budgets["2026-11"] = 5000. */
  if (raw.budgets && typeof raw.budgets === "object") {
    Object.keys(raw.budgets).forEach(key => {
      if (!/^\d{4}-\d{2}$/.test(key)) return;
      const value = Number(raw.budgets[key]);
      if (Number.isFinite(value) && value >= 0 && value <= 100000000) {
        clean.budgets[key] = round2(value);
      }
    });
  } else {
    /* Migration: the old single-budget model carries over to the current
       month so nobody loses their setup after the update. */
    const legacy = Number(raw.budget);
    if (Number.isFinite(legacy) && legacy > 0) {
      clean.budgets[monthKeyOf(new Date())] = round2(legacy);
    }
  }

  const savingsGoal = Number(raw.savingsGoal);
  if (Number.isFinite(savingsGoal) && savingsGoal >= 0) clean.savingsGoal = round2(savingsGoal);

  if (Array.isArray(raw.entries)) {
    const seen = new Set();
    raw.entries.forEach(item => {
      if (!item || typeof item !== "object") return;
      const amount = round2(Number(item.amount));
      const ts = Number(item.ts);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000 || !Number.isFinite(ts)) return;
      if (Number.isNaN(new Date(ts).getTime())) return;
      let id = typeof item.id === "string" && item.id ? item.id : uid();
      if (seen.has(id)) id = uid();
      seen.add(id);
      clean.entries.push({
        id,
        category: CAT.has(item.category) ? item.category : "other",
        reason: typeof item.reason === "string" ? item.reason.trim().slice(0, 80) : "",
        amount,
        ts
      });
    });
  }
  return clean;
}

export function csvCell(value) {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
