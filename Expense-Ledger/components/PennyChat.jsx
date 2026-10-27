"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { CATEGORIES, STORAGE_KEY, LANG_KEY, TOUR_SEEN_KEY } from "../lib/constants";
import { sanitizeState, uid } from "../lib/utils";
import { createVoiceSession, ensureMicPermission, micErrorMessage, normalizeVoiceText } from "../lib/voice";
import { LEDGER_AI_SYSTEM, parseAiJson } from "../lib/ai";
import { mergeUndoEntries, popUndoSnapshot, pushUndoSnapshot } from "../lib/undo";

const PENNY_URL = "https://friendly-orbit-chat-companion.lovable.app/";

function readFullWebsiteData() {
  if (typeof window === "undefined") {
    return {
      ledger: sanitizeState(null),
      lang: "en",
      tourSeen: false
    };
  }

  let ledger = sanitizeState(null);
  let lang = "en";
  let tourSeen = false;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    ledger = sanitizeState(raw ? JSON.parse(raw) : null);
  } catch (err) {}

  try {
    lang = localStorage.getItem(LANG_KEY) || "en";
  } catch (err) {}

  try {
    tourSeen = localStorage.getItem(TOUR_SEEN_KEY) === "1";
  } catch (err) {}

  return { ledger, lang, tourSeen };
}

const CATEGORY_KEYWORDS = [
  ["food", ["food", "coffee", "pizza", "lunch", "dinner", "breakfast", "restaurant", "snack", "snacks", "tea", "chai", "groceries", "burger", "meal", "eat"]],
  ["transport", ["transport", "auto", "uber", "ola", "taxi", "cab", "bus", "metro", "train", "fuel", "petrol", "bike", "flight"]],
  ["shopping", ["shopping", "clothes", "shoes", "amazon", "flipkart", "myntra", "gift"]],
  ["bills", ["bill", "bills", "electricity", "water", "rent", "wifi", "internet", "phone", "recharge", "emi"]],
  ["entertainment", ["movie", "netflix", "game", "games", "concert", "entertainment", "spotify"]],
  ["health", ["medicine", "doctor", "hospital", "pharmacy", "gym", "medical", "health"]]
];

/* Understand plain commands like "add 250 for pizza" or "spent 60 on auto". */
function parseExpenseCommand(text) {
  const lower = text.toLowerCase();

  if (!/\b(add|log|record|spent|spend|paid|pay|bought|purchase|expense)\b/.test(lower)) return null;

  const numberMatch = lower.match(/(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)/);
  if (!numberMatch) return null;

  const amount = Number(numberMatch[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return null;

  let category = "other";
  for (const [id, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some(keyword => lower.includes(keyword))) {
      category = id;
      break;
    }
  }

  let reason = text
    .replace(/(?:₹|rs\.?|inr)?\s*\d[\d,.]*(?:\.\d+)?/gi, " ")
    .replace(/\b(res?|inr|rupees?|bucks?)\b/gi, " ")
    .replace(/\b(add|log|record|spent|spend|paid|pay|bought|purchase|expense|on|for|today|yesterday|to|the|a|an)\b/gi, " ")
    .replace(/[^\p{L}\p{N}'&-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (reason.length > 80) reason = reason.slice(0, 80);
  return { amount, category, reason: reason || "Added via Penny" };
}

/* Write a parsed expense straight into PocketWise storage and notify the app. */
function writeExpenseToLedger({ amount, category, reason }) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ledger = sanitizeState(raw ? JSON.parse(raw) : null);
    const entry = { id: uid(), category, reason, amount, ts: Date.now() };
    const next = { ...ledger, entries: [...ledger.entries, entry] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("pocketwise_ledger_change", { detail: next }));
    return next;
  } catch (error) {
    return null;
  }
}

/* Understand commands like "set my monthly goal to 5000" or "change target 2000".
   Question-shaped messages ("what is my goal?") are left to the normal replies. */
function parseGoalCommand(text) {
  const lower = text.toLowerCase();

  if (!/\b(goal|target|milestone)\b/.test(lower)) return null;
  if (!/\b(set|change|update|make|fix|edit|adjust|increase|decrease|reduce|raise|keep|now)\b/.test(lower)) return null;

  const numberMatch = lower.match(/(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)/);
  if (!numberMatch) return null;

  const amount = Number(numberMatch[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) return null;
  return { amount };
}

/* Persist a new overall monthly budget and notify the app. */
function writeMonthlyBudget(amount) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ledger = sanitizeState(raw ? JSON.parse(raw) : null);
    const next = { ...ledger, budget: amount };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("pocketwise_ledger_change", { detail: next }));
    return next;
  } catch (error) {
    return null;
  }
}

/* Understand commands like "set my monthly budget to 5000" or "change budget 3000".
   A budget naming a category ("food budget") belongs to parseLimitCommand instead. */
function parseBudgetCommand(text) {
  const lower = text.toLowerCase();

  if (!/\bbudget\b/.test(lower)) return null;
  if (!/\b(set|change|update|make|fix|edit|adjust|increase|decrease|reduce|raise|keep|now)\b/.test(lower)) return null;

  /* A named category means it's a category limit, not the overall budget. */
  const mentionsCategory = CATEGORY_KEYWORDS.some(([, keywords]) =>
    keywords.some(keyword => new RegExp(`\\b${keyword}\\b`).test(lower))
  );
  if (mentionsCategory || /\b(all|every|entire)\b/.test(lower)) return null;

  const numberMatch = lower.match(/(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)/);
  if (!numberMatch) return null;

  const amount = Number(numberMatch[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) return null;
  return { amount };
}

/* Persist a new monthly savings goal and notify the app. */
function writeSavingsGoal(amount) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ledger = sanitizeState(raw ? JSON.parse(raw) : null);
    const next = { ...ledger, savingsGoal: amount };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("pocketwise_ledger_change", { detail: next }));
    return next;
  } catch (error) {
    return null;
  }
}

/* "undo" / "restore" / "bring back the entries I removed" — restore whatever
   the last removal took away (works across chat, voice and dashboard). */
function parseUndoCommand(text) {
  const lower = text.toLowerCase();
  if (!/\b(undo|revert|restore|bring back|put back)\b/.test(lower)) return null;
  return { wantsUndo: true };
}

/* Understand limit commands like "set food limit 3000",
   "change limit of all categories to 1000" or "increase shopping limit to 2000". */
function parseLimitCommand(text) {
  const lower = text.toLowerCase();

  if (!/\blimits?\b/.test(lower)) return null;
  if (!/\b(set|change|update|make|fix|edit|adjust|increase|decrease|reduce|raise|keep|allocate|now)\b/.test(lower)) return null;

  const numbers = [...lower.matchAll(/(?:₹|rs\.?|inr)?"?(\d[\d,]*(?:\.\d+)?)"?/g)]
    .map(match => Number(match[1].replace(/,/g, "")))
    .filter(Number.isFinite);
  if (!numbers.length) return null;
  const amount = numbers[numbers.length - 1];
  if (amount < 0 || amount > 100000000) return null;

  let category = "other";
  if (/\b(all|every|whole|everything|entire)\b/.test(lower)) {
    category = "all";
  } else {
    let found = null;
    for (const [id, keywords] of CATEGORY_KEYWORDS) {
      if (keywords.some(keyword => lower.includes(keyword))) {
        found = id;
        break;
      }
    }
    category = found && found !== "other" ? found : (/(\bother\b|misc)/.test(lower) ? "other" : found);
  }
  if (!category) return null;
  return { category, amount };
}

function writeCategoryLimit(category, amount) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ledger = sanitizeState(raw ? JSON.parse(raw) : null);
    const nextLimits =
      category === "all"
        ? Object.fromEntries(CATEGORIES.map(item => [item.id, amount]))
        : { ...ledger.limits, [category]: amount };
    const next = { ...ledger, limits: nextLimits };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("pocketwise_ledger_change", { detail: next }));
    return next;
  } catch (error) {
    return null;
  }
}

/* Understand remove commands like "remove pizza", "delete 250",
   "cancel lunch yesterday" — or "remove all expenses" (wipe everything). */
function parseRemoveCommand(text) {
  const lower = text.toLowerCase();
  if (!/\b(remove|delete|cancel|erase|clear|wipe|undo|take off)\b/.test(lower)) return null;

  const numberMatch = lower.match(/(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)/);
  const exactAmount = numberMatch
    ? Number(numberMatch[1].replace(/,/g, ""))
    : null;

  const query = text
    .replace(/\b(please|the|my|an|a|entry|entries|expense|expenses|transaction|transactions|from|ledger|list|remove|delete|cancel|erase|clear|wipe|undo)\b/gi, " ")
    .replace(/(?:₹|rs\.?|inr)?\s*\d[\d,.]*(?:\.\d+)?/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  /* "remove all expenses" / "clear everything" — only when no specific
     category is named, so "remove all coffee entries" stays partial. */
  const wantsAll = /\b(all|everything|entire|whole)\b/.test(lower);
  const mentionsCategory = CATEGORY_KEYWORDS.some(([, keywords]) =>
    keywords.some(keyword => lower.includes(keyword))
  );
  if (wantsAll && !mentionsCategory && exactAmount == null) {
    return { clearAll: true, query: "", exactAmount: null };
  }

  if (!query && exactAmount == null) return null;
  return { clearAll: false, query, exactAmount };
}

/* Generic words must never fuzzy-match entry reasons ("all" would hit "small ball"). */
const REMOVE_STOPWORDS = new Set([
  "all", "everything", "entire", "whole", "expenses", "expense", "entries", "entry",
  "transactions", "transaction", "ledger", "spending", "history", "records", "record",
  "thing", "things", "it", "them", "that", "this", "they"
]);

/* Delete matching entries and return what was removed. */
function writeRemoveFromLedger({ query, exactAmount }) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ledger = sanitizeState(raw ? JSON.parse(raw) : null);
    const tokens = query
      ? query.split(" ").filter(Boolean).filter(token => !REMOVE_STOPWORDS.has(token))
      : [];
    if (!tokens.length && exactAmount == null) return null;
    const removed = [];
    const kept = ledger.entries.filter(entry => {
      const reason = (entry.reason || "").toLowerCase();
      const cat = (CATEGORIES.find(item => item.id === entry.category)?.label || entry.category).toLowerCase();
      const matched =
        (tokens.length > 0 &&
          (tokens.some(token => token.length > 2 && (reason.includes(token) || cat.includes(token))) ||
            (query && (reason.includes(query) || cat.includes(query))))) ||
        (exactAmount != null && Number(entry.amount) === exactAmount);
      if (matched) removed.push(entry);
      return !matched;
    });

    if (removed.length === 0 || kept.length === ledger.entries.length) return null;
    pushUndoSnapshot(removed);
    const next = { ...ledger, entries: kept };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("pocketwise_ledger_change", { detail: next }));
    return { next, removed };
  } catch (error) {
    return null;
  }
}

/* Wipe every entry (budget/limits/goal untouched) and notify the app. */
function writeClearAllLedger() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ledger = sanitizeState(raw ? JSON.parse(raw) : null);
    if (ledger.entries.length === 0) return null;
    pushUndoSnapshot(ledger.entries);
    const next = { ...ledger, entries: [] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("pocketwise_ledger_change", { detail: next }));
    return next;
  } catch (error) {
    return null;
  }
}

/* Undo the most recent removal: re-inserts its popped snapshot entries. */
function restoreUndoSnapshot() {
  try {
    const popped = popUndoSnapshot();
    if (!popped || !popped.length) return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    const ledger = sanitizeState(raw ? JSON.parse(raw) : null);
    const merged = mergeUndoEntries(popped, ledger.entries);
    const next = { ...ledger, entries: merged };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("pocketwise_ledger_change", { detail: next }));
    return { next, restoredCount: popped.length };
  } catch (error) {
    return null;
  }
}

/* Voice-to-AI fallback: when the local parsers can't fully understand a
   spoken command, the AI extractor handles add/delete/goal/limit reliably. */
async function runVoiceAiCommand(prompt) {
  const fmt = value => Number(value).toLocaleString("en-IN");
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, system: LEDGER_AI_SYSTEM })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = parseAiJson(data.text);
    if (!result) return null;

    const action = result.action || (result.amount != null ? (result.category ? "add" : "setGoal") : "unknown");

    if (action === "add") {
      const amount = Number(result.amount);
      if (!(amount > 0)) return null;
      const category = CATEGORIES.some(item => item.id === result.category) ? result.category : "other";
      const reason = String(result.reason || "").trim().slice(0, 80) || category;
      const nextLedger = writeExpenseToLedger({ amount, category, reason });
      if (!nextLedger) return null;
      const cat = CATEGORIES.find(item => item.id === category);
      return {
        ledger: nextLedger,
        message: `✅ Added ₹${fmt(amount)} to ${cat?.icon || "📌"} ${cat?.label || "Other"} — "${reason}". Already on your dashboard! 📊`
      };
    }

    if (action === "delete") {
      const removed = writeRemoveFromLedger({ query: String(result.query || "").toLowerCase(), exactAmount: null });
      if (!removed) return null;
      const summary = removed.removed
        .slice(0, 5)
        .map(entry => `• ₹${fmt(entry.amount)} — "${entry.reason || "Expense"}"`)
        .join("\n");
      return {
        ledger: removed.next,
        message: `🗑️ Removed ${removed.removed.length} entr${removed.removed.length === 1 ? "y" : "ies"}:\n${summary}`
      };
    }

    if (action === "clearAll") {
      if (!window.confirm("Remove ALL expenses? This cannot be undone.")) return null;
      const nextLedger = writeClearAllLedger();
      if (!nextLedger) return null;
      return { ledger: nextLedger, message: "🧹 Cleared all expenses. Fresh start! 🎉" };
    }

    if (action === "undo") {
      const restored = restoreUndoSnapshot();
      if (!restored) return null;
      return {
        ledger: restored.next,
        message: `↩️ Restored ${restored.restoredCount} expense(s) from your last removal. ✅`
      };
    }

    if (action === "setBudget") {
      const amount = Number(result.amount);
      if (!(amount >= 0)) return null;
      const nextLedger = writeMonthlyBudget(amount);
      if (!nextLedger) return null;
      return { ledger: nextLedger, message: `💰 Monthly budget set to ₹${fmt(amount)}.` };
    }

    if (action === "setGoal") {
      const amount = Number(result.amount);
      if (!(amount >= 0)) return null;
      const nextLedger = writeSavingsGoal(amount);
      if (!nextLedger) return null;
      return { ledger: nextLedger, message: `🎯 Monthly savings goal set to ₹${fmt(amount)}.` };
    }

    if (action === "setLimit") {
      const amount = Number(result.amount);
      if (!(amount >= 0)) return null;
      const category = result.category === "all"
        ? "all"
        : (CATEGORIES.some(item => item.id === result.category) ? result.category : null);
      if (!category) return null;
      const nextLedger = writeCategoryLimit(category, amount);
      if (!nextLedger) return null;
      const cat = CATEGORIES.find(item => item.id === category);
      return {
        ledger: nextLedger,
        message:
          category === "all"
            ? `🎚️ All category limits set to ₹${fmt(amount)} each.`
            : `🎚️ ${cat?.icon || ""} ${cat?.label || category} limit set to ₹${fmt(amount)}.`
      };
    }

    return null;
  } catch (error) {
    return null;
  }
}

function analyzeFullWebsite(data) {
  const { ledger, lang, tourSeen } = data || {};
  const entries = ledger?.entries || [];
  const budget = Number(ledger?.budget) || 0;
  const limits = ledger?.limits || {};

  const totalSpent = entries.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const remainingBudget = budget > 0 ? budget - totalSpent : null;
  const budgetUsagePercent = budget > 0 ? Math.round((totalSpent / budget) * 100) : null;

  const categoryMap = {};
  CATEGORIES.forEach(cat => {
    categoryMap[cat.id] = {
      ...cat,
      spent: 0,
      count: 0,
      limit: Number(limits[cat.id]) || 0,
      entries: []
    };
  });

  entries.forEach(entry => {
    const catId = categoryMap[entry.category] ? entry.category : "other";
    categoryMap[catId].spent += Number(entry.amount) || 0;
    categoryMap[catId].count += 1;
    categoryMap[catId].entries.push(entry);
  });

  const activeCategories = Object.values(categoryMap)
    .filter(c => c.spent > 0)
    .sort((a, b) => b.spent - a.spent);

  const topCategory = activeCategories[0] || null;

  const sortedEntriesByAmount = [...entries].sort((a, b) => b.amount - a.amount);
  const largestExpense = sortedEntriesByAmount[0] || null;
  const smallestExpense = sortedEntriesByAmount[sortedEntriesByAmount.length - 1] || null;
  const averageExpense = entries.length > 0 ? Math.round(totalSpent / entries.length) : 0;

  const recentEntries = [...entries].sort((a, b) => b.ts - a.ts);

  const overBudgetCategories = Object.values(categoryMap).filter(
    c => c.limit > 0 && c.spent > c.limit
  );

  const nearBudgetCategories = Object.values(categoryMap).filter(
    c => c.limit > 0 && c.spent <= c.limit && (c.spent / c.limit) >= 0.8
  );

  return {
    entries,
    entryCount: entries.length,
    totalSpent,
    budget,
    remainingBudget,
    budgetUsagePercent,
    categoryMap,
    activeCategories,
    topCategory,
    largestExpense,
    smallestExpense,
    averageExpense,
    recentEntries,
    overBudgetCategories,
    nearBudgetCategories,
    lang,
    tourSeen
  };
}

function formatCurrency(val) {
  return "₹" + Number(val || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short"
    });
  } catch (e) {
    return "";
  }
}

function cleanAsterisks(text) {
  if (!text || typeof text !== "string") return "";
  return text.replace(/\*\*/g, "").replace(/\*/g, "");
}

function buildFullWebsiteContextText(analysis) {
  const lines = [
    "📋 [PocketWise Complete Website & Ledger Context]",
    `• App: PocketWise — Private Student Expense Ledger`,
    `• Storage: 100% Client-Side LocalStorage (Private & Offline)`,
    `• Language Setting: ${analysis.lang === "hi" ? "Hindi (हिंदी)" : "English"}`,
    `• Onboarding Tour: ${analysis.tourSeen ? "Completed" : "New user"}`,
    `• Total Recorded Spent: ${formatCurrency(analysis.totalSpent)} across ${analysis.entryCount} expenses`
  ];

  if (analysis.budget > 0) {
    lines.push(`• Overall Budget: ${formatCurrency(analysis.budget)} (Remaining: ${formatCurrency(analysis.remainingBudget)} · ${analysis.budgetUsagePercent}% used)`);
  } else {
    lines.push("• Overall Budget: Not set");
  }

  lines.push("\n📊 Category Limits & Spending:");
  CATEGORIES.forEach(c => {
    const data = analysis.categoryMap[c.id];
    const spent = data?.spent || 0;
    const limit = data?.limit || 0;
    const count = data?.count || 0;
    const limitStr = limit > 0 ? ` / ${formatCurrency(limit)} limit` : " (No limit set)";
    lines.push(`  ${c.icon} ${c.label}: ${formatCurrency(spent)} (${count} items)${limitStr}`);
  });

  if (analysis.entries.length > 0) {
    lines.push("\n📝 All Recorded Transactions:");
    analysis.recentEntries.forEach((e, idx) => {
      const cat = CATEGORIES.find(c => c.id === e.category);
      lines.push(`  ${idx + 1}. ${formatDate(e.ts)}: ${e.reason || "Expense"} — ${formatCurrency(e.amount)} (${cat?.icon || "📌"} ${cat?.label || e.category})`);
    });
  } else {
    lines.push("\n📝 Transactions: No records yet.");
  }

  return lines.join("\n");
}

function generatePennyReply(rawPrompt, analysis) {
  const query = rawPrompt.toLowerCase().trim();

  // 1. App Features & How-To Questions
  if (query.includes("export") || query.includes("csv") || query.includes("download")) {
    return `To export your data from PocketWise:\n\n` +
      `1. Scroll down to the bottom of the ledger table on the website.\n` +
      `2. Click the 'Export CSV' button.\n` +
      `3. A spreadsheet file (.csv) containing all ${analysis.entryCount} transactions with dates, categories, and amounts will instantly download to your device.\n\n` +
      `You can also click 'Backup JSON' to save a full backup file that you can restore anytime!`;
  }

  if (query.includes("privacy") || query.includes("private") || query.includes("safe") || query.includes("stored") || query.includes("database")) {
    return `Your data is 100% private and stored locally on your device! 🔒\n\n` +
      `• PocketWise uses your browser's local storage (localStorage).\n` +
      `• No cloud accounts, databases, or tracking are used.\n` +
      `• Your ${analysis.entryCount} expenses (totaling ${formatCurrency(analysis.totalSpent)}) never leave this device unless you export them.\n` +
      `• The app also works completely offline!`;
  }

  if (query.includes("how to add") || query.includes("new expense") || query.includes("log expense")) {
    return `You can add expenses in two easy ways on PocketWise:\n\n` +
      `1. Quick Add: Click any quick button (₹10, ₹20, ₹50, ₹100, ₹200, ₹500) above the form for fast 1-tap logging.\n` +
      `2. Custom Entry: Enter the exact Amount, select a Category (Food, Transport, etc.), type a description (e.g. 'Coffee'), and click '+ Add Expense'.\n\n` +
      `Once added, I instantly detect and update your live balances!`;
  }

  if (query.includes("language") || query.includes("hindi") || query.includes("english")) {
    return `PocketWise supports both English and Hindi! 🌐\n\n` +
      `• Current website language: ${analysis.lang === "hi" ? "Hindi (हिंदी)" : "English"}.\n` +
      `• You can toggle the language anytime using the language switcher in the website header.`;
  }

  // If no transactions at all
  if (analysis.entryCount === 0) {
    if (query.includes("budget") || query.includes("limit")) {
      return `You haven't recorded any expenses yet! Your budget is currently ${analysis.budget > 0 ? formatCurrency(analysis.budget) : "not set"}. Start by logging an expense using the Quick Add buttons or the '+ Add Expense' form!`;
    }
    return `Hi there! 👋 I'm Penny, your PocketWise Web AI. I have full access to all your website data and settings.\n\nYou don't have any expenses recorded in your ledger yet. As soon as you add spending, ask me anytime to summarize your budget, calculate category totals, search transactions, or give savings tips!`;
  }

  // 2. Specific Item / Keyword Search in Transactions
  // E.g. "coffee", "swiggy", "metro", "shoes", "uber", "recharge", "rent"
  const ignoredWords = new Set(["how", "much", "did", "i", "spend", "on", "what", "is", "my", "the", "a", "an", "for", "in", "to", "of", "and", "show", "me", "all", "list", "any", "expenses", "expense", "items", "item"]);
  const searchKeywords = query.split(/\s+/).filter(w => w.length > 2 && !ignoredWords.has(w));

  if (searchKeywords.length > 0) {
    const matchingEntries = analysis.entries.filter(e => {
      const reasonLower = (e.reason || "").toLowerCase();
      return searchKeywords.some(k => reasonLower.includes(k));
    });

    if (matchingEntries.length > 0) {
      const matchedSum = matchingEntries.reduce((s, curr) => s + (Number(curr.amount) || 0), 0);
      const list = matchingEntries
        .slice(0, 6)
        .map(e => {
          const cat = CATEGORIES.find(c => c.id === e.category);
          return `• ${formatDate(e.ts)}: ${e.reason} — ${formatCurrency(e.amount)} (${cat?.icon || "📌"} ${cat?.label || e.category})`;
        })
        .join("\n");

      return `I searched your live website data and found ${matchingEntries.length} matching transaction${matchingEntries.length > 1 ? "s" : ""}: 🔎\n\n` +
        `${list}\n\n` +
        `• Total Spent on this: ${formatCurrency(matchedSum)} (${Math.round((matchedSum / analysis.totalSpent) * 100)}% of your total expenses)`;
    }
  }

  // 3. Budget / Balance / Remaining money
  if (
    query.includes("budget") ||
    query.includes("balance") ||
    query.includes("remaining") ||
    query.includes("left") ||
    query.includes("how much can i spend") ||
    query.includes("motivat") ||
    query.includes("danger") ||
    query.includes("saving")
  ) {
    if (analysis.budget <= 0) {
      return `You haven't set an overall monthly budget yet! 💰\n\n• Total spent so far: ${formatCurrency(analysis.totalSpent)} across ${analysis.entryCount} entries.\n• Top category: ${analysis.topCategory ? `${analysis.topCategory.icon} ${analysis.topCategory.label} (${formatCurrency(analysis.topCategory.spent)})` : "N/A"}.\n\n💡 Tip: Set your monthly budget on the main dashboard to track how much you have left and get automated savings motivation!`;
    }

    const isOver = analysis.remainingBudget < 0;
    const isCriticalDanger = analysis.budgetUsagePercent >= 90 && !isOver;
    const isCaution = analysis.budgetUsagePercent >= 75 && !isOver && !isCriticalDanger;
    const isGreatSaving = analysis.budgetUsagePercent <= 50 && !isOver;

    let coachingMessage = "";
    if (isOver) {
      coachingMessage =
        `🚨 CRITICAL DANGER: OVER BUDGET BY ${formatCurrency(Math.abs(analysis.remainingBudget))}!\n\n` +
        `🛑 Action to Prevent Spending: Immediate emergency spending freeze on all dining out, online shopping, and entertainment. Lock your wallet to survival essentials only!\n\n` +
        `💪 Encouragement & Recovery: Going over budget happens — don't lose heart! The key is stopping the leak immediately. Log every single rupee, review where money went, and you can recover starting today. You've got this!`;
    } else if (isCriticalDanger) {
      coachingMessage =
        `🚨 DANGER ZONE: ONLY ${formatCurrency(analysis.remainingBudget)} LEFT TO SPEND (${analysis.budgetUsagePercent}% USED)!\n\n` +
        `🛑 Urgent Spending Warning: You are operating in the danger zone! Put an immediate stop to takeout, cab rides, and all impulsive purchases. Every rupee you protect right now prevents you from sliding into debt.\n\n` +
        `🛡️ Motivation to Hold the Line: You still have ${formatCurrency(analysis.remainingBudget)} intact! With strict discipline and zero optional spending for the rest of the period, you CAN finish without crossing the red line. Stand strong — finish this cycle victorious!`;
    } else if (isCaution) {
      coachingMessage =
        `⚠️ CAUTION: LOW FUNDS WARNING (${analysis.budgetUsagePercent}% USED)\n\n` +
        `• You have ${formatCurrency(analysis.remainingBudget)} left to spend.\n` +
        `• Action: Pump the brakes on discretionary expenses now. Cooking at home and postponing online purchases will safely keep you out of the danger zone!\n` +
        `• Encouragement: You're still within limits! Stay alert, keep tracking, and guard your remaining balance.`;
    } else if (isGreatSaving) {
      coachingMessage =
        `🌟 INCREDIBLE JOB! YOU ARE SAVING A HUGE AMOUNT OF MONEY! 💰🎉\n\n` +
        `• You have preserved ${formatCurrency(analysis.remainingBudget)} (${100 - analysis.budgetUsagePercent}% of your budget saved)!\n\n` +
        `🚀 Motivating Challenge: Your financial discipline right now is extraordinary! Most people struggle to save, but you're mastering it. Don't let up now — challenge yourself to push this savings even further: keep impulse spending at zero, transfer extra savings toward an emergency fund or personal goal, and see how big you can make your surplus by month-end! Real wealth is built one smart decision at a time — you're doing amazing! 🔥💪`;
    } else {
      coachingMessage =
        `✨ GREAT SAVINGS PACE! You have ${formatCurrency(analysis.remainingBudget)} safely preserved (${analysis.budgetUsagePercent}% of budget used).\n\n` +
        `Keep this inspiring discipline going! Stay mindful on everyday purchases and watch your savings cushion grow steadily. Every rupee you preserve is freedom in your pocket! 🚀`;
    }

    return `Here is your Live Budget & Balance Status: 💳\n\n` +
      `• Total Monthly Budget: ${formatCurrency(analysis.budget)}\n` +
      `• Total Spent: ${formatCurrency(analysis.totalSpent)} (${analysis.budgetUsagePercent}% of budget)\n` +
      `• Remaining Balance: ${formatCurrency(analysis.remainingBudget)}\n\n` +
      coachingMessage;
  }

  // 4. Specific category query (Food, Transport, Shopping, Bills, Entertainment, Health, Other)
  const categoryMatch = CATEGORIES.find(
    cat =>
      query.includes(cat.id) ||
      query.includes(cat.label.toLowerCase()) ||
      (cat.id === "food" && (query.includes("eat") || query.includes("grocery") || query.includes("groceries") || query.includes("lunch") || query.includes("dinner") || query.includes("snack") || query.includes("swiggy") || query.includes("zomato"))) ||
      (cat.id === "transport" && (query.includes("travel") || query.includes("cab") || query.includes("auto") || query.includes("metro") || query.includes("bus") || query.includes("uber") || query.includes("ola") || query.includes("petrol") || query.includes("fuel"))) ||
      (cat.id === "bills" && (query.includes("rent") || query.includes("recharge") || query.includes("electricity") || query.includes("wifi"))) ||
      (cat.id === "shopping" && (query.includes("cloth") || query.includes("amazon") || query.includes("flipkart") || query.includes("buy"))) ||
      (cat.id === "entertainment" && (query.includes("movie") || query.includes("cinema") || query.includes("netflix") || query.includes("game"))) ||
      (cat.id === "health" && (query.includes("medicine") || query.includes("doctor") || query.includes("pharmacy")))
  );

  if (categoryMatch) {
    const data = analysis.categoryMap[categoryMatch.id];
    if (!data || data.count === 0) {
      return `You haven't recorded any expenses under ${categoryMatch.icon} ${categoryMatch.label} yet! All your entries are in other categories.`;
    }

    const pct = analysis.totalSpent > 0 ? Math.round((data.spent / analysis.totalSpent) * 100) : 0;
    const limitInfo = data.limit > 0
      ? `\n• Category Limit: ${formatCurrency(data.limit)} (${data.spent > data.limit ? `⚠️ Exceeded by ${formatCurrency(data.spent - data.limit)}` : `✅ ${formatCurrency(data.limit - data.spent)} remaining`})`
      : "";

    const topItems = [...data.entries].sort((a, b) => b.amount - a.amount).slice(0, 3);
    const topItemsText = topItems
      .map(item => `  - ${formatDate(item.ts)}: ${item.reason || "Expense"} — ${formatCurrency(item.amount)}`)
      .join("\n");

    return `Here is your spending for ${categoryMatch.icon} ${categoryMatch.label}:\n\n` +
      `• Total Spent: ${formatCurrency(data.spent)} (${pct}% of your total expenses)\n` +
      `• Transactions: ${data.count} items recorded` +
      limitInfo +
      `\n\n📌 Top entries:\n${topItemsText}`;
  }

  // 5. Highest / Lowest / Average Expense
  if (
    query.includes("highest") ||
    query.includes("biggest") ||
    query.includes("largest") ||
    query.includes("most expensive") ||
    query.includes("max") ||
    query.includes("average") ||
    query.includes("lowest") ||
    query.includes("smallest")
  ) {
    const largest = analysis.largestExpense;
    const smallest = analysis.smallestExpense;
    const topCat = analysis.topCategory;

    let reply = `Here are your spending extremes: 🔍\n\n`;
    if (largest) {
      const cat = CATEGORIES.find(c => c.id === largest.category);
      reply += `• Single Largest Expense: ${formatCurrency(largest.amount)} for "${largest.reason || "Expense"}" on ${formatDate(largest.ts)} (${cat?.icon || "📌"} ${cat?.label || largest.category})\n`;
    }
    if (smallest) {
      const cat = CATEGORIES.find(c => c.id === smallest.category);
      reply += `• Smallest Expense: ${formatCurrency(smallest.amount)} for "${smallest.reason || "Expense"}" (${cat?.icon || "📌"} ${cat?.label || smallest.category})\n`;
    }
    reply += `• Average Expense: ${formatCurrency(analysis.averageExpense)} across ${analysis.entryCount} items\n`;
    if (topCat) {
      reply += `• Heaviest Category: ${topCat.icon} ${topCat.label} with ${formatCurrency(topCat.spent)} across ${topCat.count} purchases (${Math.round((topCat.spent / analysis.totalSpent) * 100)}% of all spending).\n`;
    }
    return reply;
  }

  // 6. Recent transactions or List All
  if (
    query.includes("recent") ||
    query.includes("latest") ||
    query.includes("last") ||
    query.includes("history") ||
    query.includes("transactions") ||
    query.includes("all") ||
    query.includes("list")
  ) {
    const countToShow = query.includes("all") ? 10 : 5;
    const items = analysis.recentEntries.slice(0, countToShow);
    if (items.length === 0) return "You don't have any recorded transactions yet.";

    const list = items
      .map(item => {
        const cat = CATEGORIES.find(c => c.id === item.category);
        return `• ${formatDate(item.ts)}: ${item.reason || "Expense"} — ${formatCurrency(item.amount)} (${cat?.icon || "📌"} ${cat?.label || item.category})`;
      })
      .join("\n");

    return `Here are your ${items.length} most recent expenses: 🕒\n\n${list}\n\n• Total recorded in website: ${analysis.entryCount} transactions (${formatCurrency(analysis.totalSpent)})`;
  }

  // 7. Total spending / Overview / Summary
  if (
    query.includes("summary") ||
    query.includes("overview") ||
    query.includes("total") ||
    query.includes("spent") ||
    query.includes("report")
  ) {
    const catList = analysis.activeCategories
      .slice(0, 5)
      .map(c => `• ${c.icon} ${c.label}: ${formatCurrency(c.spent)} (${Math.round((c.spent / analysis.totalSpent) * 100)}%)`)
      .join("\n");

    return `Here is your PocketWise Financial Summary: 📊\n\n` +
      `• Total Spending: ${formatCurrency(analysis.totalSpent)} (${analysis.entryCount} transactions)\n` +
      (analysis.budget > 0
        ? `• Budget: ${formatCurrency(analysis.budget)} (${formatCurrency(analysis.remainingBudget)} remaining · ${analysis.budgetUsagePercent}% used)\n`
        : "") +
      `\nTop Spending Categories:\n${catList}\n\n` +
      (analysis.overBudgetCategories.length > 0
        ? `⚠️ Over-budget categories: ${analysis.overBudgetCategories.map(c => `${c.icon} ${c.label}`).join(", ")}`
        : `✅ All category limits are currently respected!`);
  }

  // 8. Savings tips / Advice
  if (
    query.includes("tip") ||
    query.includes("save") ||
    query.includes("advice") ||
    query.includes("cut") ||
    query.includes("reduce") ||
    query.includes("help")
  ) {
    const topCat = analysis.topCategory;
    let customTip = "";

    if (topCat?.id === "food") {
      customTip = "Your highest spending is on Food 🍔. Planning meals ahead, batch-cooking, or limiting food deliveries to 1-2 times a week can easily save 20-30% of this budget!";
    } else if (topCat?.id === "shopping") {
      customTip = "Your top spending is in Shopping 🛍️. Implement the '24-Hour Rule' before non-essential purchases to curb impulsive orders!";
    } else if (topCat?.id === "transport") {
      customTip = "Your top spending is in Transport 🚗. Consider monthly passes, metro/bus passes, or carpooling for regular commutes.";
    } else if (topCat?.id === "bills") {
      customTip = "Your top spending is in Bills & Utilities 🧾. Audit recurring app subscriptions and optimize mobile recharge plans.";
    } else {
      customTip = "Set category limits for your recurring costs so PocketWise alerts you before you overspend!";
    }

    let coachingNote = "";
    if (analysis.budget > 0) {
      if (analysis.remainingBudget < 0) {
        coachingNote = `\n\n🚨 DANGER ALERT: You've exceeded your budget by ${formatCurrency(Math.abs(analysis.remainingBudget))}! Immediate emergency rule: stop all non-essential and discretionary buys right now. Lock your wallet, track every rupee, and you will regain control! 🛑💪`;
      } else if (analysis.budgetUsagePercent >= 90) {
        coachingNote = `\n\n🚨 DANGER ZONE ALERT: Only ${formatCurrency(analysis.remainingBudget)} left (${analysis.budgetUsagePercent}% spent)! Put an emergency freeze on takeout and shopping immediately to avoid debt. You have the discipline to finish this month strong — protect your funds! 🛑✨`;
      } else if (analysis.budgetUsagePercent <= 50) {
        coachingNote = `\n\n🌟 SAVINGS MOMENTUM: You have safely kept ${formatCurrency(analysis.remainingBudget)} in your pocket (${100 - analysis.budgetUsagePercent}% budget saved)! Winning with money is all about momentum — take pride in your discipline today, and challenge yourself to put that extra surplus toward your long-term goals! 🚀💰`;
      } else {
        coachingNote = `\n\n✨ SAVINGS ENCOURAGEMENT: You have ${formatCurrency(analysis.remainingBudget)} preserved. Keep up the consistent limits and watch your savings cushion compound! 💪`;
      }
    }

    return `Here are some personalized Money-Saving Tips: 💡\n\n` +
      `1. Focus on your #1 expense: ${customTip}\n\n` +
      `2. Track daily: Logging small ₹20 - ₹100 cash expenses prevents unaccounted leaks.\n\n` +
      `3. 50/30/20 Rule: Aim to allocate 50% for Needs, 30% for Wants, and direct at least 20% into savings!` +
      coachingNote;
  }

  // Default response with complete live website context
  return `I have access to all your PocketWise website data! 🪙\n\n` +
    `• Total Recorded Spent: ${formatCurrency(analysis.totalSpent)} (${analysis.entryCount} transactions)\n` +
    (analysis.budget > 0
      ? `• Overall Budget: ${formatCurrency(analysis.budget)} with ${formatCurrency(analysis.remainingBudget)} remaining.\n`
      : "") +
    (analysis.topCategory
      ? `• Top Category: ${analysis.topCategory.icon} ${analysis.topCategory.label} (${formatCurrency(analysis.topCategory.spent)}).\n`
      : "") +
    `• Privacy: 100% LocalStorage private & offline.\n\n` +
    `Ask me anything about your finances or the website, for example:\n` +
    `• How much did I spend on food or coffee?\n` +
    `• What is my remaining balance?\n` +
    `• Show my recent transactions\n` +
    `• How do I export to CSV?`;
}

export default function PennyChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("native"); // "native" | "embed"
  const [mounted, setMounted] = useState(false);
  const [siteData, setSiteData] = useState(() => readFullWebsiteData());
  const [messages, setMessages] = useState(() => [
    {
      id: "welcome",
      role: "assistant",
      text: "Hi, I'm Penny! 🪙\nI'm connected to all information in PocketWise — including your expenses, category limits, budget, and website features. How can I help you today?"
    }
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isVoiceListening, setVoiceListening] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);

  const messagesEndRef = useRef(null);
  const iframeRef = useRef(null);
  const voiceRef = useRef(null);
  const micButtonRef = useRef(null);

  /* Pulse the mic button with live voice intensity (direct DOM write — no re-renders) */
  const setMicGlow = level => {
    const el = micButtonRef.current;
    if (el) {
      el.style.boxShadow = `0 0 ${Math.round(10 + level * 26)}px rgba(239,68,68,${(0.3 + level * 0.5).toFixed(2)})`;
    }
  };
  const clearMicGlow = () => {
    const el = micButtonRef.current;
    if (el) el.style.boxShadow = "";
  };
  const [darkMode, setDarkMode] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const sync = () => setDarkMode(document.documentElement.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Sync with localStorage & custom events
  useEffect(() => {
    setMounted(true);
    setSiteData(readFullWebsiteData());

    const handleSync = () => {
      setSiteData(readFullWebsiteData());
    };

    window.addEventListener("storage", handleSync);
    window.addEventListener("pocketwise_ledger_change", handleSync);

    return () => {
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("pocketwise_ledger_change", handleSync);
    };
  }, []);

  // Update on modal open
  useEffect(() => {
    if (isOpen) {
      setSiteData(readFullWebsiteData());
    }
  }, [isOpen]);

  // Auto-scroll chat
  useEffect(() => {
    if (activeTab === "native") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isThinking, activeTab]);


  // Close chat when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = event => {
      const panel = document.getElementById("penny-chat-panel");
      const button = document.getElementById("penny-chat-button");
      if (panel && panel.contains(event.target)) return;
      if (button && button.contains(event.target)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const analysis = useMemo(
    () => analyzeFullWebsite(mounted ? siteData : readFullWebsiteData()),
    [mounted, siteData]
  );

  // Push full ledger context to the embedded Web AI whenever data/tab changes
  useEffect(() => {
    if (activeTab !== "embed") return;
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) return;
    const context = buildFullWebsiteContextText(analysis);
    try {
      iframe.contentWindow.postMessage(
        { type: "pocketwise_context", context, analysis },
        "*"
      );
    } catch (error) {}
  }, [activeTab, analysis]);

  const handleSendMessage = (textToSend, viaVoice = false) => {
    const text = (textToSend || inputValue).trim();
    if (!text || isThinking) return;

    const userMsg = {
      id: "u_" + Date.now(),
      role: "user",
      text
    };

    setMessages(prev => [...prev, userMsg]);
    setInputValue("");
    setIsThinking(true);

    const thinkingTimer = setTimeout(async () => {
      const currentData = readFullWebsiteData();
      const currentAnalysis = analyzeFullWebsite(currentData);

      let replyText;
      const undo = parseUndoCommand(text);
      const budget = undo ? null : parseBudgetCommand(text);
      const goal = !undo && !budget ? parseGoalCommand(text) : null;
      const limit = !undo && !budget && !goal ? parseLimitCommand(text) : null;
      const removal = !undo && !goal && !limit ? parseRemoveCommand(text) : null;
      const expense = !undo && !goal && !limit && !removal ? parseExpenseCommand(text) : null;

      if (undo) {
        const restored = restoreUndoSnapshot();
        if (restored) {
          setSiteData({ ...currentData, ledger: restored.next });
          replyText = `↩️ Restored ${restored.restoredCount} expense(s) from your last removal. Back on the dashboard! ✅`;
        } else {
          replyText = "🤷 There's nothing left to undo — I don't have any recent removals stored.";
        }
      } else if (budget) {
        const nextLedger = writeMonthlyBudget(budget.amount);
        if (nextLedger) {
          setSiteData({ ...currentData, ledger: nextLedger });
          replyText =
            `💰 Done! Your monthly budget is now **₹${budget.amount.toLocaleString("en-IN")}**.\n\n` +
            `The dashboard now shows what's left against this budget. 💪`;
        } else {
          replyText = "⚠️ I understood the budget, but couldn't save it (storage may be blocked). Try setting it in the dashboard settings.";
        }
      } else if (goal) {
        const nextLedger = writeSavingsGoal(goal.amount);
        if (nextLedger) {
          setSiteData({ ...currentData, ledger: nextLedger });
          const goalAmount = nextLedger.savingsGoal;
          const spentSoFar = nextLedger.entries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
          replyText =
            `🎯 Done! Your monthly savings goal is now **₹${goalAmount.toLocaleString("en-IN")}**.\n\n` +
            (goalAmount > 0
              ? `You've spent ₹${spentSoFar.toLocaleString("en-IN")} this month, and the dashboard will now track your progress toward the ₹${goalAmount.toLocaleString("en-IN")} goal. 💪`
              : `The goal has been cleared to ₹0 — set it again anytime.`);
        } else {
          replyText = "⚠️ I understood the goal, but couldn't save it (storage may be blocked). Try changing it in the dashboard settings.";
        }
      } else if (limit) {
        const nextLedger = writeCategoryLimit(limit.category, limit.amount);
        if (nextLedger) {
          setSiteData({ ...currentData, ledger: nextLedger });
          const cat = CATEGORIES.find(item => item.id === limit.category);
          replyText =
            limit.category === "all"
              ? `🎚️ Done! The limit for **all categories** is now **₹${limit.amount.toLocaleString("en-IN")}** each. The dashboard reflects it right away.`
              : `🎚️ Done! The ${cat?.icon || ""} ${cat?.label || limit.category} limit is now **₹${limit.amount.toLocaleString("en-IN")}**. The dashboard reflects it right away.`;
        } else {
          replyText = "⚠️ I understood the limit, but couldn't save it (storage may be blocked). Try changing it in the dashboard settings.";
        }
      } else if (removal) {
        if (removal.clearAll) {
          const count = currentData.ledger.entries.length;
          if (count === 0) {
            replyText = "🗑️ Your ledger is already empty — nothing to remove!";
          } else if (window.confirm(`Remove ALL ${count} expense(s)? This cannot be undone.`)) {
            const nextLedger = writeClearAllLedger();
            if (nextLedger) {
              setSiteData({ ...currentData, ledger: nextLedger });
              replyText = `🧹 Cleared all ${count} expense(s). Fresh start! 🎉`;
            } else {
              replyText = "⚠️ Couldn't clear the ledger (storage may be blocked).";
            }
          } else {
            replyText = "👍 No worries — nothing was deleted.";
          }
        } else {
          const result = writeRemoveFromLedger(removal);
          if (result) {
            setSiteData({ ...currentData, ledger: result.next });
            const summary = result.removed
              .slice(0, 5)
              .map(entry => `• ₹${Number(entry.amount).toLocaleString("en-IN")} — "${entry.reason || "Expense"}"`)
              .join("\n");
            replyText =
              `🗑️ Removed ${result.removed.length} entr${result.removed.length === 1 ? "y" : "ies"}:\n${summary}` +
              (result.removed.length > 5 ? `\n…and ${result.removed.length - 5} more.` : "");
          } else {
            replyText = `🔍 I couldn't find a matching expense${removal.query ? ` for "${removal.query}"` : ""}. Tell me the amount or what it was listed as.`;
          }
        }
      } else if (expense) {
        const nextLedger = writeExpenseToLedger(expense);
        if (nextLedger) {
          setSiteData({ ...currentData, ledger: nextLedger });
          const cat = CATEGORIES.find(item => item.id === expense.category);
          const spentNow = nextLedger.entries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
          replyText =
            `✅ Added **₹${expense.amount.toLocaleString("en-IN")}** to ${cat?.icon || "📌"} ${cat?.label || "Other"}` +
            (expense.reason && expense.reason !== "Added via Penny" ? ` — "${expense.reason}"` : "") +
            `.\n\nTotal spent so far: ₹${spentNow.toLocaleString("en-IN")} across ${nextLedger.entries.length} transactions. It's already visible on your dashboard! 📊`;
        } else {
          replyText = "⚠️ I understood the expense, but couldn't save it (storage may be blocked). Try adding it on the dashboard instead.";
        }
      }

      if (!replyText && viaVoice) {
        /* Voice command the local parsers couldn't handle — let the AI
           extractor interpret it and act on the ledger. */
        const executed = await runVoiceAiCommand(text);
        if (executed) {
          setSiteData({ ...(readFullWebsiteData()), ledger: executed.ledger });
          replyText = executed.message;
        } else {
          replyText =
            "🤔 I couldn't understand that command. Try: 'add 250 for pizza', 'remove snacks', 'set monthly goal to 5000' or 'set food limit to 3000'.";
        }
      }

      if (!replyText) {
        replyText = generatePennyReply(text, currentAnalysis);
      }

      const assistantMsg = {
        id: "a_" + Date.now(),
        role: "assistant",
        text: replyText
      };

      setMessages(prev => [...prev, assistantMsg]);
      setIsThinking(false);
    }, 380);
  };

  const handleCopyFullContext = () => {
    const fullText = buildFullWebsiteContextText(analysis);
    navigator.clipboard?.writeText(fullText).then(() => {
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2800);
    }).catch(() => {});
  };

  /* Voice input via the Web Speech API. Mic permission is probed first so a
     blocked/missing mic explains itself; recognition is continuous, the
     transcript shows live in the chat box, and it sends when you finish. */
  const startVoiceInput = () => {
    const SpeechRecognizer = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SpeechRecognizer) {
      setMessages(prev => [
        ...prev,
        { id: "a_" + Date.now(), role: "assistant", text: micErrorMessage("browser") }
      ]);
      return;
    }
    if (isVoiceListening) {
      /* UI must end instantly on ⏹; transcription continues in background.
         Never park the placeholder in the input — it could be sent as text. */
      clearMicGlow();
      setVoiceListening(false);
      setInputValue("");
      setMessages(prev => [
        ...prev,
        { id: "a_" + Date.now(), role: "assistant", text: "🎙️ Transcribing your recording…" }
      ]);
      voiceRef.current?.stop();
      return;
    }

    setIsOpen(true);
    setVoiceListening(true);
    setInputValue("");

    (async () => {
      const permission = await ensureMicPermission();
      if (!permission.ok) {
        setVoiceListening(false);
        setMessages(prev => [
          ...prev,
          { id: "a_" + Date.now(), role: "assistant", text: micErrorMessage(permission.name) || "🎙️ Mic error." }
        ]);
        return;
      }

      const controller = createVoiceSession({
        lang: siteData.lang === "hi" ? "hi-IN" : "en-IN",
        onResult: (finalText, interim) => setInputValue(finalText || interim),
        onLevel: setMicGlow,
        onAutoStop: () => {
          clearMicGlow();
          setVoiceListening(false);
        },
        onError: name => {
          clearMicGlow();
          const message = micErrorMessage(name);
          if (message) {
            setMessages(prev => [
              ...prev,
              { id: "a_" + Date.now(), role: "assistant", text: message }
            ]);
          }
        },
        onFallback: () => {
          setMessages(prev => [
            ...prev,
            {
              id: "a_" + Date.now(),
              role: "assistant",
              text: "🎙️ Record mode: speak your command naturally — press ⏹ or pause 2s after speaking to submit. (This mode is more accurate!)"
            }
          ]);
        },
        onDone: text => {
          setVoiceListening(false);
          clearMicGlow();
          const command = normalizeVoiceText(text).trim();
          if (command) handleSendMessage(command, true);
          else setInputValue("");
        }
      });
      if (!controller) {
        setVoiceListening(false);
        return;
      }
      voiceRef.current = controller;
      try {
        controller.start();
      } catch (error) {
        setVoiceListening(false);
      }
    })();
  };

  const quickPrompts = [
    { label: "💰 Balance Status", query: "What is my remaining budget and balance status?" },
    { label: "🌟 Motivation", query: "Motivate me on my savings progress and give encouraging words to save more" },
    { label: "🚨 Danger Check", query: "Am I in danger of overspending or running low on money?" },
    { label: "📊 Summary", query: "Give me an overview summary of my expenses" },
    { label: "🍔 Food Spent", query: "How much did I spend on food?" },
    { label: "💡 Savings Tips", query: "Give me tips to save money based on my habits" },
    { label: "🎯 Set Monthly Goal", query: "Set my monthly savings goal to 2000" },
    { label: "🔍 Biggest Expense", query: "What was my highest expense?" }
  ];

  if (!mounted) return null;

  return (
    <>
      {/* Chat Window Panel */}
      <div
        id="penny-chat-panel"
        data-theme={darkMode ? "dark" : "light"}
        className="penny-panel"
        style={{
          position: "fixed",
          zIndex: 99998,
          bottom: "calc(88px + env(safe-area-inset-bottom, 0px))",
          right: "20px",
          display: isOpen ? "flex" : "none",
          flexDirection: "column",
          width: expanded ? "min(92vw, 640px)" : "min(410px, calc(100vw - 24px))",
          height: expanded ? "min(90vh, 820px)" : "720px",
          maxHeight: "calc(100vh - 80px)",
          maxWidth: "calc(100vw - 24px)",
          borderRadius: "18px",
          overflow: "hidden",
          background: "#ffffff",
          boxShadow: "0 12px 40px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06)",
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
        }}
      >
        {/* Header */}
        <div
          className="penny-header"
          style={{
            background: "linear-gradient(135deg, #4F46E5 0%, #6C63FF 100%)",
            color: "#ffffff",
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.12)"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: "#8B85FF",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "18px",
                  boxShadow: "inset 0 1px 2px rgba(255,255,255,0.3)"
                }}
              >
                🪙
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "15px", letterSpacing: "-0.2px" }}>
                  Penny — Web AI
                </div>
                <div style={{ fontSize: "11px", opacity: 0.9, display: "flex", alignItems: "center", gap: "5px" }}>
                  <span
                    style={{
                      width: "7px",
                      height: "7px",
                      borderRadius: "50%",
                      background: "#A5A0FF",
                      display: "inline-block"
                    }}
                  />
                  Website Data Connected ({analysis.entryCount} items · {formatCurrency(analysis.totalSpent)})
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                type="button"
                onClick={handleCopyFullContext}
                title="Copy all website data to clipboard"
                aria-label="Copy website data"
                style={{
                  background: copiedToast ? "#A5A0FF" : "rgba(255,255,255,0.18)",
                  border: "none",
                  borderRadius: "8px",
                  color: "#fff",
                  padding: "6px 10px",
                  fontSize: "11px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  fontWeight: 600,
                  transition: "background 0.2s"
                }}
              >
                📋 {copiedToast ? "Copied!" : "Copy All Data"}
              </button>

              <button
                type="button"
                onClick={() => setExpanded(prev => !prev)}
                aria-label={expanded ? "Collapse chat" : "Expand chat"}
                title={expanded ? "Collapse" : "Expand"}
                style={{
                  background: "rgba(255,255,255,0.18)",
                  border: "none",
                  borderRadius: "8px",
                  color: "#fff",
                  padding: "6px 10px",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontWeight: 600
                }}
              >
                {expanded ? "Collapse" : "Expand"}
              </button>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close chat"
                style={{
                  background: "rgba(255,255,255,0.18)",
                  border: "none",
                  borderRadius: "50%",
                  width: "28px",
                  height: "28px",
                  color: "#fff",
                  fontSize: "14px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <div
            style={{
              display: "flex",
              background: "rgba(0,0,0,0.25)",
              borderRadius: "8px",
              padding: "2px",
              fontSize: "12px"
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("native")}
              style={{
                flex: 1,
                border: "none",
                background: activeTab === "native" ? "#ffffff" : "transparent",
                color: activeTab === "native" ? "#4F46E5" : "rgba(255,255,255,0.85)",
                fontWeight: activeTab === "native" ? 600 : 400,
                padding: "6px 8px",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "all 0.15s"
              }}
            >
              ⚡ Web AI (Live Data)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("embed")}
              style={{
                flex: 1,
                border: "none",
                background: activeTab === "embed" ? "#ffffff" : "transparent",
                color: activeTab === "embed" ? "#4F46E5" : "rgba(255,255,255,0.85)",
                fontWeight: activeTab === "embed" ? 600 : 400,
                padding: "6px 8px",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "all 0.15s"
              }}
            >
              🌐 Web AI (Cloud Embed)
            </button>
          </div>
        </div>

        {/* Live Website Snapshot Bar */}
        <div
          className="penny-snapshot"
          style={{
            background: "#F7F5FF",
            borderBottom: "1px solid #E8E6FF",
            padding: "8px 14px",
            fontSize: "12px",
            color: "#6C63FF",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <div>
            <strong>Spent:</strong> {formatCurrency(analysis.totalSpent)}
            {analysis.budget > 0 && (
              <span style={{ marginLeft: "8px", color: "#555" }}>
                · <strong>Budget:</strong> {formatCurrency(analysis.budget)}
              </span>
            )}
          </div>
          <div style={{ fontSize: "11px", color: "#8B85FF", fontWeight: 600 }}>
            {analysis.topCategory ? `${analysis.topCategory.icon} ${analysis.topCategory.label}` : "All Synced"}
          </div>
        </div>

        {/* Dynamic Financial Coach Banner (Motivating or Danger Alert) */}
        {analysis.budget > 0 && (
          <div
            className="penny-coach"
            style={{
              padding: "8px 14px",
              fontSize: "11.5px",
              fontWeight: 600,
              display: "flex",
              alignItems: "flex-start",
              gap: "7px",
              lineHeight: 1.4,
              background:
                analysis.remainingBudget < 0 || analysis.budgetUsagePercent >= 90
                  ? "#fef2f2"
                  : analysis.budgetUsagePercent >= 75
                  ? "#fffbeb"
                  : "#f0fdf4",
              borderBottom: `1px solid ${
                analysis.remainingBudget < 0 || analysis.budgetUsagePercent >= 90
                  ? "#fca5a5"
                  : analysis.budgetUsagePercent >= 75
                  ? "#fde68a"
                  : "#86efac"
              }`,
              color:
                analysis.remainingBudget < 0 || analysis.budgetUsagePercent >= 90
                  ? "#991b1b"
                  : analysis.budgetUsagePercent >= 75
                  ? "#92400e"
                  : "#4F46E5"
            }}
          >
            <span style={{ flexShrink: 0 }}>
              {analysis.remainingBudget < 0 || analysis.budgetUsagePercent >= 90
                ? "🚨"
                : analysis.budgetUsagePercent >= 75
                ? "⚠️"
                : "🌟"}
            </span>
            <span>
              {analysis.remainingBudget < 0
                ? `CRITICAL DANGER: Over budget by ${formatCurrency(-analysis.remainingBudget)}! Freeze non-essentials immediately.`
                : analysis.budgetUsagePercent >= 90
                ? `DANGER ZONE: Only ${formatCurrency(analysis.remainingBudget)} left (${analysis.budgetUsagePercent}% spent)! Stop non-essentials to protect your funds!`
                : analysis.budgetUsagePercent >= 75
                ? `Caution: Low funds remaining (${formatCurrency(analysis.remainingBudget)} left). Slow down discretionary spending!`
                : analysis.budgetUsagePercent <= 50
                ? `Super Saver! ${formatCurrency(analysis.remainingBudget)} preserved. Keep crushing it and save even more today! 🚀`
                : `Solid savings pace! ${formatCurrency(analysis.remainingBudget)} saved. Stay disciplined and grow your cushion! 💪`}
            </span>
          </div>
        )}

        {/* Tab 1: Web AI (Live Data) */}
        {activeTab === "native" && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            {/* Messages Area */}
            <div
              className="penny-messages"
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
                background: "#fafafa"
              }}
            >
              {messages.map(msg => {
                const isUser = msg.role === "user";
                return (
                  <div
                    key={msg.id}
                    style={{
                      display: "flex",
                      justifyContent: isUser ? "flex-end" : "flex-start",
                      gap: "8px"
                    }}
                  >
                    {!isUser && (
                      <div
                        style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "50%",
                          background: "#6C63FF",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "14px",
                          flexShrink: 0
                        }}
                      >
                        🪙
                      </div>
                    )}
                    <div
                      style={{
                        maxWidth: "82%",
                        padding: "10px 14px",
                        borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                        background: isUser ? "#6C63FF" : "#ffffff",
                        color: isUser ? "#ffffff" : "#222222",
                        fontSize: "13.5px",
                        lineHeight: "1.5",
                        boxShadow: isUser
                          ? "0 2px 6px rgba(45,106,79,0.25)"
                          : "0 2px 8px rgba(0,0,0,0.06)",
                        border: isUser ? "none" : "1px solid #ebebeb",
                        whiteSpace: "pre-wrap"
                      }}
                    >
                      {cleanAsterisks(msg.text)}
                    </div>
                  </div>
                );
              })}

              {isThinking && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      background: "#6C63FF",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "14px"
                    }}
                  >
                    🪙
                  </div>
                  <div
                    style={{
                      padding: "8px 14px",
                      borderRadius: "14px",
                      background: "#ffffff",
                      border: "1px solid #e0e0e0",
                      fontSize: "12px",
                      color: "#666",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px"
                    }}
                  >
                    <span style={{ animation: "pulse 1s infinite" }}>●</span> Penny Web AI is reading website data…
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Prompt Chips */}
            <div
              style={{
                display: "flex",
                gap: "6px",
                overflowX: "auto",
                padding: "8px 12px",
                background: "#ffffff",
                borderTop: "1px solid #eee",
                scrollbarWidth: "none"
              }}
            >
              {quickPrompts.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSendMessage(p.query)}
                  style={{
                    whiteSpace: "nowrap",
                    background: "#F3F2FF",
                    color: "#6C63FF",
                    border: "1px solid #D8D6FF",
                    borderRadius: "12px",
                    padding: "4px 10px",
                    fontSize: "11.5px",
                    cursor: "pointer",
                    fontWeight: 500,
                    transition: "all 0.15s"
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = "#6C63FF";
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "#F3F2FF";
                    e.currentTarget.style.color = "#6C63FF";
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Input Bar */}
            <form
              onSubmit={e => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="penny-inputbar"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 14px",
                background: "#ffffff",
                borderTop: "1px solid #e5e5e5"
              }}
            >
              <input
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder="Ask Web AI anything about your expenses, budgets, or website…"
                style={{
                  flex: "1",
                  padding: "10px 14px",
                  borderRadius: "18px",
                  border: "1px solid #D8D6FF",
                  fontSize: "13px",
                  outline: "none",
                  transition: "border-color 0.2s"
                }}
                onFocus={e => (e.target.style.borderColor = "#6C63FF")}
                onBlur={e => (e.target.style.borderColor = "#d0d0d0")}
              />
              <button
                type="button"
                onClick={startVoiceInput}
                id="pennyMicBtn"
                disabled={isThinking}
                ref={micButtonRef}
                aria-label={isVoiceListening ? "Stop listening" : "Voice command"}
                aria-pressed={isVoiceListening}
                style={{
                  width: "38px",
                  height: "38px",
                  borderRadius: "50%",
                  background: isVoiceListening ? "#ef4444" : "#F0EEFF",
                  color: isVoiceListening ? "#fff" : "#6C63FF",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "16px",
                  transition: "all 0.2s",
                  boxShadow: isVoiceListening ? "0 0 0 4px rgba(239,68,68,0.2)" : "none"
                }}
              >
                {isVoiceListening ? "⏹" : "🎙️"}
              </button>
              <button
                type="submit"
                id="pennySendBtn"
                disabled={!inputValue.trim() || isThinking}
                aria-label="Send message"
                style={{
                  width: "38px",
                  height: "38px",
                  borderRadius: "50%",
                  background: inputValue.trim() && !isThinking ? "#6C63FF" : "#cccccc",
                  color: "#fff",
                  border: "none",
                  cursor: inputValue.trim() && !isThinking ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "16px",
                  transition: "background 0.2s"
                }}
              >
                ➤
              </button>
            </form>
          </div>
        )}

        {/* Tab 2: Web AI (Cloud Embed) with Live Data Bridge */}
        {activeTab === "embed" && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, position: "relative" }}>
            <div
              className="penny-bridge"
              style={{
                background: "#F7F5FF",
                borderBottom: "1px solid #D8D6FF",
                padding: "10px 12px",
                fontSize: "12px",
                color: "#4F46E5",
                display: "flex",
                flexDirection: "column",
                gap: "6px"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>
                  ⚡ <strong>Website Data Bridge:</strong> {analysis.entryCount} expenses · {formatCurrency(analysis.totalSpent)} synced
                </span>
                <button
                  type="button"
                  onClick={handleCopyFullContext}
                  style={{
                    background: copiedToast ? "#A5A0FF" : "#6C63FF",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "4px 9px",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "background 0.2s"
                  }}
                >
                  {copiedToast ? "✓ Copied to Clipboard!" : "📋 Copy All Data"}
                </button>
              </div>
              <div style={{ fontSize: "11px", opacity: 0.85, color: "#6C63FF" }}>
                💡 Click <strong>Copy All Data</strong> and paste (Ctrl+V) in the chat below to provide all your transactions to Web AI!
              </div>
            </div>
            <iframe
              ref={iframeRef}
              src={PENNY_URL}
              title="Penny — PocketWise Assistant"
              style={{ width: "100%", height: "100%", border: 0, flex: 1 }}
              allow="clipboard-write; microphone"
            />
          </div>
        )}
      </div>

      {/* Floating Launcher Button */}
      <button
        id="penny-chat-button"
        type="button"
        aria-label="Chat with Penny Web AI"
        onClick={() => setIsOpen(prev => !prev)}
        style={{
          position: "fixed",
          zIndex: 99999,
          bottom: "20px",
          right: "20px",
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          background: "#6C63FF",
          color: "#fdf9f3",
          fontSize: "24px",
          boxShadow: "0 6px 20px rgba(45,106,79,0.36), 0 2px 6px rgba(0,0,0,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "transform 0.18s ease, box-shadow 0.18s ease"
        }}
      >
        {isOpen ? "✕" : "💬"}
      </button>
    </>
  );
}
