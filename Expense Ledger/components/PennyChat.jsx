"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { CATEGORIES, STORAGE_KEY, LANG_KEY, TOUR_SEEN_KEY } from "../lib/constants";
import { sanitizeState } from "../lib/utils";

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
    query.includes("how much can i spend")
  ) {
    if (analysis.budget <= 0) {
      return `You haven't set an overall monthly budget yet! 💰\n\n• Total spent so far: ${formatCurrency(analysis.totalSpent)} across ${analysis.entryCount} entries.\n• Top category: ${analysis.topCategory ? `${analysis.topCategory.icon} ${analysis.topCategory.label} (${formatCurrency(analysis.topCategory.spent)})` : "N/A"}.\n\n💡 Tip: Set your monthly budget on the main dashboard to track how much you have left!`;
    }

    const isOver = analysis.remainingBudget < 0;
    const isNear = analysis.budgetUsagePercent >= 85 && !isOver;

    return `Here is your current Budget & Balance Status: 💳\n\n` +
      `• Total Budget: ${formatCurrency(analysis.budget)}\n` +
      `• Total Spent: ${formatCurrency(analysis.totalSpent)} (${analysis.budgetUsagePercent}% of budget)\n` +
      `• Remaining Balance: ${formatCurrency(analysis.remainingBudget)}\n\n` +
      (isOver
        ? `⚠️ Alert: You have exceeded your overall budget by ${formatCurrency(Math.abs(analysis.remainingBudget))}! Consider reviewing optional expenses in ${analysis.topCategory?.label || "your top categories"}.`
        : isNear
        ? `⚠️ Heads up: You have used ${analysis.budgetUsagePercent}% of your budget with ${formatCurrency(analysis.remainingBudget)} remaining. Try capping non-essential spending for the rest of the period!`
        : `✅ Looking healthy! You have ${formatCurrency(analysis.remainingBudget)} left to spend safely.`);
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

    return `Here are some personalized Money-Saving Tips: 💡\n\n` +
      `1. Focus on your #1 expense: ${customTip}\n\n` +
      `2. Track daily: Logging small ₹20 - ₹100 cash expenses prevents unaccounted leaks.\n\n` +
      `3. Budget Health: You've spent ${formatCurrency(analysis.totalSpent)} so far. Keep an eye on your remaining ${analysis.budget > 0 ? formatCurrency(analysis.remainingBudget) : "balance"}!`;
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
  const [copiedToast, setCopiedToast] = useState(false);

  const messagesEndRef = useRef(null);

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

  const analysis = useMemo(
    () => analyzeFullWebsite(mounted ? siteData : readFullWebsiteData()),
    [mounted, siteData]
  );

  const handleSendMessage = textToSend => {
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

    setTimeout(() => {
      const currentData = readFullWebsiteData();
      const currentAnalysis = analyzeFullWebsite(currentData);
      const replyText = generatePennyReply(text, currentAnalysis);

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
    navigator.clipboard.writeText(fullText).then(() => {
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2800);
    });
  };

  const quickPrompts = [
    { label: "📊 Summary", query: "Give me an overview summary of my expenses" },
    { label: "🍔 Food Spent", query: "How much did I spend on food?" },
    { label: "💰 Remaining Balance", query: "What is my remaining budget and balance?" },
    { label: "🔍 Biggest Expense", query: "What was my highest expense?" },
    { label: "🕒 Recent Items", query: "Show my recent transactions" },
    { label: "📁 How to Export", query: "How do I export my data to CSV?" },
    { label: "💡 Savings Tips", query: "Give me tips to save money based on my habits" }
  ];

  return (
    <>
      {/* Chat Window Panel */}
      <div
        id="penny-chat-panel"
        style={{
          position: "fixed",
          zIndex: 99998,
          bottom: "88px",
          right: "20px",
          display: isOpen ? "flex" : "none",
          flexDirection: "column",
          width: "410px",
          height: "640px",
          maxHeight: "calc(100vh - 110px)",
          maxWidth: "calc(100vw - 32px)",
          borderRadius: "18px",
          overflow: "hidden",
          background: "#ffffff",
          boxShadow: "0 12px 40px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06)",
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
        }}
      >
        {/* Header */}
        <div
          style={{
            background: "linear-gradient(135deg, #1b4332 0%, #2d6a4f 100%)",
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
                  background: "#40916c",
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
                      background: "#52b788",
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
                  background: copiedToast ? "#52b788" : "rgba(255,255,255,0.18)",
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
                color: activeTab === "native" ? "#1b4332" : "rgba(255,255,255,0.85)",
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
                color: activeTab === "embed" ? "#1b4332" : "rgba(255,255,255,0.85)",
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
          style={{
            background: "#f3f9f4",
            borderBottom: "1px solid #d4ebd8",
            padding: "8px 14px",
            fontSize: "12px",
            color: "#2d6a4f",
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
          <div style={{ fontSize: "11px", color: "#40916c", fontWeight: 600 }}>
            {analysis.topCategory ? `${analysis.topCategory.icon} ${analysis.topCategory.label}` : "All Synced"}
          </div>
        </div>

        {/* Tab 1: Web AI (Live Data) */}
        {activeTab === "native" && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            {/* Messages Area */}
            <div
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
                          background: "#2d6a4f",
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
                        background: isUser ? "#2d6a4f" : "#ffffff",
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
                      background: "#2d6a4f",
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
                    background: "#f0f7f3",
                    color: "#2d6a4f",
                    border: "1px solid #c7e6d4",
                    borderRadius: "12px",
                    padding: "4px 10px",
                    fontSize: "11.5px",
                    cursor: "pointer",
                    fontWeight: 500,
                    transition: "all 0.15s"
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = "#2d6a4f";
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "#f0f7f3";
                    e.currentTarget.style.color = "#2d6a4f";
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
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: "22px",
                  border: "1px solid #d0d0d0",
                  fontSize: "13px",
                  outline: "none",
                  transition: "border-color 0.2s"
                }}
                onFocus={e => (e.target.style.borderColor = "#2d6a4f")}
                onBlur={e => (e.target.style.borderColor = "#d0d0d0")}
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isThinking}
                aria-label="Send message"
                style={{
                  width: "38px",
                  height: "38px",
                  borderRadius: "50%",
                  background: inputValue.trim() && !isThinking ? "#2d6a4f" : "#cccccc",
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
              style={{
                background: "#f0f8f3",
                borderBottom: "1px solid #c9e8d2",
                padding: "10px 12px",
                fontSize: "12px",
                color: "#1e5138",
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
                    background: copiedToast ? "#52b788" : "#2d6a4f",
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
              <div style={{ fontSize: "11px", opacity: 0.85, color: "#2d6a4f" }}>
                💡 Click <strong>Copy All Data</strong> and paste (Ctrl+V) in the chat below to provide all your transactions to Web AI!
              </div>
            </div>
            <iframe
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
          background: "#2d6a4f",
          color: "#fdf9f3",
          fontSize: "24px",
          boxShadow: "0 6px 20px rgba(45,106,79,0.36), 0 2px 6px rgba(0,0,0,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "transform 0.18s ease, box-shadow 0.18s ease"
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = "scale(1.08)";
          e.currentTarget.style.boxShadow = "0 8px 24px rgba(45,106,79,0.48)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = "0 6px 20px rgba(45,106,79,0.36), 0 2px 6px rgba(0,0,0,0.15)";
        }}
      >
        {isOpen ? "✕" : "💬"}
      </button>
    </>
  );
}
