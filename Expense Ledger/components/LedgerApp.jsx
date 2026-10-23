"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  CATEGORIES,
  CAT,
  LANG_KEY,
  QUICK_AMOUNTS,
  STORAGE_KEY,
  TOUR_SEEN_KEY,
  emptyLedger
} from "../lib/constants";
import { I18N, TOUR_STEPS } from "../lib/i18n";
import {
  csvCell,
  dayKeyOf,
  daysInMonth,
  money,
  monthKeyOf,
  round2,
  sanitizeState,
  slashDate,
  startOfMonth,
  timeLabel,
  uid
} from "../lib/utils";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

function readStoredLanguage() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    return saved === "hi" || saved === "en" ? saved : "en";
  } catch (error) {
    return "en";
  }
}

function readStoredLedger() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return sanitizeState(raw ? JSON.parse(raw) : null);
  } catch (error) {
    return sanitizeState(null);
  }
}

export default function LedgerApp() {
  const [ready, setReady] = useState(false);
  const [lang, setLang] = useState("en");
  const [darkMode, setDarkMode] = useState(false);
  const [themeAnimating, setThemeAnimating] = useState(false);
  const [ledger, setLedger] = useState(emptyLedger);
  const [view, setView] = useState(() => startOfMonth(new Date()));
  const [editingId, setEditingId] = useState(null);
  const [activeCategory, setActiveCategory] = useState("food");
  const [filter, setFilter] = useState({ q: "", cat: "all" });
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [formError, setFormError] = useState("");
  const [stackedNotice, setStackedNotice] = useState(null);
  const [storageOK, setStorageOK] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState("0");
  const [limitDrafts, setLimitDrafts] = useState(() => ({ ...emptyLedger().limits }));
  const [savingsGoalDraft, setSavingsGoalDraft] = useState(() => String(emptyLedger().savingsGoal));
  const [toast, setToast] = useState(null);
  const [newEntryId, setNewEntryId] = useState(null);
  const [tourVisible, setTourVisible] = useState(false);
  const [tourShown, setTourShown] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [tourPlacement, setTourPlacement] = useState("below");
  const [tourPulse, setTourPulse] = useState(false);

  const ledgerRef = useRef(emptyLedger());
  const storageRef = useRef(true);
  const amountRef = useRef(null);
  const amountWrapRef = useRef(null);
  const descRef = useRef(null);
  const formCardRef = useRef(null);
  const detailsRef = useRef(null);
  const budgetInputRef = useRef(null);
  const toastTimerRef = useRef(null);
  const newRowTimerRef = useRef(null);
  const lastDeletedRef = useRef(null);
  const stackNoticeTimerRef = useRef(null);
  const tourVisibleRef = useRef(false);
  const tourBtnRef = useRef(null);
  const tourOverlayRef = useRef(null);
  const tourBubbleRef = useRef(null);
  const tourSpotRef = useRef(null);
  const tourReturnFocusRef = useRef(null);
  const tourFocusPendingRef = useRef(false);
  const tourCloseIntentRef = useRef(false);
  const tourCloseTimerRef = useRef(null);
  const tourScrollTimerRef = useRef(null);
  const autoTourTimerRef = useRef(null);

  const t = useCallback(
    (key, vars) => {
      const pack = I18N[lang] || I18N.en;
      let text = pack[key] || I18N.en[key] || key;
      if (vars) {
        Object.keys(vars).forEach(name => {
          text = text.split(`{${name}}`).join(String(vars[name]));
        });
      }
      return text;
    },
    [lang]
  );

  const catLabel = useCallback(
    id => t(`cat_${CAT.has(id) ? id : "other"}`),
    [t]
  );

  const dateLocale = lang === "hi" ? "hi-IN" : "en-IN";

  const persist = useCallback(next => {
    if (!storageRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      storageRef.current = false;
      setStorageOK(false);
    }
  }, []);

  const commitLedger = useCallback(
    updater => {
      const next = typeof updater === "function" ? updater(ledgerRef.current) : updater;
      ledgerRef.current = next;
      setLedger(next);
      persist(next);
      try {
        window.dispatchEvent(new CustomEvent("pocketwise_ledger_change", { detail: next }));
      } catch (error) {}
    },
    [persist]
  );

  const hasSeenTour = useCallback(() => {
    if (!storageRef.current) return true;
    try {
      return localStorage.getItem(TOUR_SEEN_KEY) === "1";
    } catch (error) {
      return true;
    }
  }, []);

  const markTourSeen = useCallback(() => {
    if (!storageRef.current) return;
    try {
      localStorage.setItem(TOUR_SEEN_KEY, "1");
    } catch (error) {
      /* Storage can be unavailable; the tutorial simply opens next time. */
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("pocketwise_dark_mode");
      if (saved === "1") {
        setDarkMode(true);
        document.documentElement.classList.add("dark");
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    try { localStorage.setItem("pocketwise_dark_mode", darkMode ? "1" : "0"); } catch (_) {}
  }, [darkMode]);

  function toggleDarkMode(e) {
    if (themeAnimating) return;
    setThemeAnimating(true);

    // Grab toggle button center for the ripple origin
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    document.documentElement.style.setProperty("--toggle-x", `${x}px`);
    document.documentElement.style.setProperty("--toggle-y", `${y}px`);

    const goingDark = !darkMode;
    document.documentElement.dataset.themeDir = goingDark ? "to-dark" : "to-light";

    const doSwitch = () => {
      flushSync(() => setDarkMode(goingDark));
    };

    if (
      typeof document.startViewTransition !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      doSwitch();
      setTimeout(() => setThemeAnimating(false), 500);
      return;
    }

    const transition = document.startViewTransition(doSwitch);
    transition.finished.finally(() => {
      setThemeAnimating(false);
      delete document.documentElement.dataset.themeDir;
    });
  }

  useEffect(() => {
    let ok = true;
    try {
      const probe = "__pw_probe__";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
    } catch (error) {
      ok = false;
    }

    storageRef.current = ok;
    const savedLanguage = ok ? readStoredLanguage() : "en";
    const nextLedger = ok ? readStoredLedger() : sanitizeState(null);

    ledgerRef.current = nextLedger;
    setStorageOK(ok);
    setLang(savedLanguage);
    setLedger(nextLedger);
    setBudgetDraft(String(nextLedger.budget));
    setLimitDrafts({ ...nextLedger.limits });
    setSavingsGoalDraft(String(nextLedger.savingsGoal));
    setReady(true);

    if (ok) {
      try {
        const firstVisit =
          localStorage.getItem(TOUR_SEEN_KEY) !== "1" &&
          localStorage.getItem(STORAGE_KEY) === null;
        if (firstVisit) {
          autoTourTimerRef.current = setTimeout(() => {
            if (!hasSeenTour() && !tourVisibleRef.current) openTour();
          }, 500);
        }
      } catch (error) {
        /* Ignore storage access errors. */
      }
    }

    return () => {
      clearTimeout(autoTourTimerRef.current);
    };
    // This is deliberately a one-time boot effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t("pageTitle");
  }, [lang, t]);

  useEffect(() => {
    if (!toast) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
      return undefined;
    }
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, toast.duration || 2800);
    return () => clearTimeout(toastTimerRef.current);
  }, [toast]);

  useEffect(() => {
    if (!newEntryId) return undefined;
    clearTimeout(newRowTimerRef.current);
    newRowTimerRef.current = setTimeout(() => setNewEntryId(null), 900);
    return () => clearTimeout(newRowTimerRef.current);
  }, [newEntryId]);

  useEffect(() => {
    if (!tourVisible) return undefined;
    document.body.classList.add("tour-open");
    return () => document.body.classList.remove("tour-open");
  }, [tourVisible]);

  useEffect(() => {
    if (!tourVisible || tourShown || tourCloseIntentRef.current) return undefined;
    const frame = requestAnimationFrame(() => {
      if (!tourCloseIntentRef.current) setTourShown(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [tourVisible, tourShown]);

  useEffect(() => {
    if (!tourShown || !tourFocusPendingRef.current) return;
    tourFocusPendingRef.current = false;
    tourBubbleRef.current?.focus({ preventScroll: true });
  }, [tourShown]);

  useEffect(() => {
    if (!tourVisible || !tourShown) return undefined;
    setTourPulse(false);
    let pulseTimer = null;
    const frame = requestAnimationFrame(() => {
      setTourPulse(true);
      scrollTourTarget();
      pulseTimer = setTimeout(() => setTourPulse(false), 360);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(pulseTimer);
    };
    // The functions used here intentionally read the current tour step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourVisible, tourShown, tourIndex, lang]);

  useEffect(() => {
    if (!tourVisible) return undefined;
    const onScroll = () => positionTour();
    const onResize = () => positionTour();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourVisible, tourShown, tourIndex, lang]);

  useEffect(() => {
    if (!tourVisible) return undefined;
    const overlay = tourOverlayRef.current;
    if (!overlay) return undefined;
    const onWheel = event => {
      if (!event.target.closest(".tour-bubble")) event.preventDefault();
    };
    overlay.addEventListener("wheel", onWheel, { passive: false });
    return () => overlay.removeEventListener("wheel", onWheel);
  }, [tourVisible]);

  useEffect(() => {
    if (!tourVisible || tourIndex !== 0) return;
    if (document.activeElement?.id === "tourBack") {
      document.getElementById("tourNext")?.focus({ preventScroll: true });
    }
  }, [tourIndex, tourVisible]);

  useEffect(
    () => () => {
      clearTimeout(toastTimerRef.current);
      clearTimeout(newRowTimerRef.current);
      clearTimeout(tourCloseTimerRef.current);
      clearTimeout(tourScrollTimerRef.current);
      clearTimeout(autoTourTimerRef.current);
      document.body.classList.remove("tour-open");
    },
    []
  );

  const now = new Date();
  const viewIndex = view.getFullYear() * 12 + view.getMonth();
  const nowIndex = now.getFullYear() * 12 + now.getMonth();
  const isCurrent = monthKeyOf(view) === monthKeyOf(now);
  const monthLabel = view.toLocaleDateString(dateLocale, {
    month: "long",
    year: "numeric",
    numberingSystem: "latn"
  });

  const monthEntries = useMemo(() => {
    const key = monthKeyOf(view);
    return ledger.entries
      .filter(entry => monthKeyOf(new Date(entry.ts)) === key)
      .sort((a, b) => b.ts - a.ts);
  }, [ledger.entries, view]);

  const spent = round2(monthEntries.reduce((sum, entry) => sum + entry.amount, 0));
  const left = ledger.budget > 0 ? round2(ledger.budget - spent) : 0;
  const hasBudget = ledger.budget > 0;
  const budgetPct = hasBudget ? Math.round((spent / ledger.budget) * 100) : 0;
  const daysLeft = daysInMonth(now) - now.getDate() + 1;

  const netSavings = Math.max(0, left);
  const savingsGoal = ledger.savingsGoal || 0;
  const savingsProgress = savingsGoal > 0 ? Math.min(100, Math.round((netSavings / savingsGoal) * 100)) : 0;
  const REWARD_BADGES = [
    { threshold: 500, points: 50, label: "Saver Starter" },
    { threshold: 1000, points: 100, label: "Smart Saver" },
    { threshold: 2000, points: 250, label: "Super Saver" },
    { threshold: 3000, points: 400, label: "Savings Champion" }
  ];
  const unlockedBadges = REWARD_BADGES.filter(badge => netSavings >= badge.threshold);
  const totalRewardPoints = unlockedBadges.reduce((sum, badge) => sum + badge.points, 0);

  let spentSub = t("summaryNothing");
  if (spent !== 0) {
    spentSub = hasBudget
      ? t("summaryUsed", { pct: budgetPct })
      : t("summarySpentNoBudget", { amount: money(spent) });
  }

  let leftSub = t("summaryNoBudget");
  if (hasBudget) {
    if (left < 0) leftSub = t("summaryOverBy", { amount: money(-left) });
    else if (isCurrent) {
      leftSub = t(daysLeft === 1 ? "summaryPerDayOne" : "summaryPerDay", {
        amount: money(Math.round(left / daysLeft)),
        days: daysLeft
      });
    } else leftSub = t("summaryLeftMonth");
  }

  const statusSeed = Math.floor(Math.abs(spent * 100 + left * 10 + budgetPct));
  const pickVariant = (variants) => variants[statusSeed % variants.length];

  const status = (() => {
    if (ledger.budget <= 0) {
      const variants = [t("statusNoBudget")];
      return { tone: "neutral", icon: "💡", text: pickVariant(variants) };
    }
    if (spent === 0) {
      const variants = [isCurrent ? t("statusNoCurrent") : t("statusNoPast", { month: monthLabel })];
      return { tone: "good", icon: "🌱", text: pickVariant(variants) };
    }
    if (left < 0) {
      const variants = [
        t("statusOver", { amount: money(-left) }),
        t("statusNearly", { pct: budgetPct, amount: money(left) })
      ];
      return { tone: "danger", icon: "🚨", text: pickVariant(variants) };
    }
    if (budgetPct >= 90) {
      const variants = [
        t("statusNearly", { pct: budgetPct, amount: money(left) }),
        t("statusOver", { amount: money(-left) })
      ];
      return { tone: "danger", icon: "🚨", text: pickVariant(variants) };
    }
    if (budgetPct >= 75) {
      const variants = [
        t(isCurrent ? "statusAtCurrent" : "statusAtPast", { pct: budgetPct, amount: money(left), perDay: money(Math.round(left / daysLeft)) }),
        t("statusNearly", { pct: budgetPct, amount: money(left) })
      ];
      return { tone: "warn", icon: "⚠️", text: pickVariant(variants) };
    }
    if (budgetPct <= 45) {
      const variants = [
        t(isCurrent ? "statusSuperSaving" : "statusGoodPast", { pct: budgetPct, amount: money(left), perDay: money(Math.round(left / daysLeft)) }),
        t(isCurrent ? "statusGoodCurrent" : "statusGoodPast", { pct: budgetPct, amount: money(left), perDay: money(Math.round(left / daysLeft)) })
      ];
      return { tone: "good", icon: "🌟", text: pickVariant(variants) };
    }
    const variants = [
      t(isCurrent ? "statusGoodCurrent" : "statusGoodPast", { pct: budgetPct, amount: money(left), perDay: money(Math.round(left / daysLeft)) }),
      t(isCurrent ? "statusSuperSaving" : "statusGoodPast", { pct: budgetPct, amount: money(left), perDay: money(Math.round(left / daysLeft)) })
    ];
    return { tone: "good", icon: "✨", text: pickVariant(variants) };
  })();

  const breakdown = useMemo(() => {
    const totals = {};
    CATEGORIES.forEach(category => {
      totals[category.id] = 0;
    });
    monthEntries.forEach(entry => {
      totals[entry.category] = (totals[entry.category] || 0) + entry.amount;
    });
    return CATEGORIES.slice()
      .sort(
        (a, b) =>
          totals[b.id] - totals[a.id] ||
          catLabel(a.id).localeCompare(catLabel(b.id), dateLocale)
      )
      .map(category => {
        const categorySpent = round2(totals[category.id]);
        const limit = ledger.limits[category.id];
        const hasLimit = limit > 0;
        const pct = hasLimit ? (categorySpent / limit) * 100 : 0;
        return {
          ...category,
          label: catLabel(category.id),
          spent: categorySpent,
          limit,
          hasLimit,
          pct,
          fillClass: pct > 100 ? "over" : pct >= 70 ? "warn" : "",
          width: hasLimit && categorySpent > 0 ? Math.max(Math.min(100, pct), 2) : 0,
          valueText: hasLimit
            ? `${money(categorySpent)} / ${money(limit)}`
            : `${money(categorySpent)} · ${t("noLimit")}`,
          over: hasLimit && categorySpent > limit
        };
      });
  }, [monthEntries, ledger.limits, catLabel, dateLocale, t]);

  const transactionCounts = useMemo(() => {
    const counts = {};
    CATEGORIES.forEach(category => {
      counts[category.id] = 0;
    });
    monthEntries.forEach(entry => {
      counts[entry.category] = (counts[entry.category] || 0) + 1;
    });
    return counts;
  }, [monthEntries]);

  const query = filter.q.trim().toLowerCase();
  const visibleEntries = useMemo(
    () =>
      monthEntries.filter(entry => {
        if (filter.cat !== "all" && entry.category !== filter.cat) return false;
        if (!query) return true;
        return (
          entry.reason.toLowerCase().includes(query) ||
          CAT.get(entry.category).label.toLowerCase().includes(query) ||
          catLabel(entry.category).toLowerCase().includes(query)
        );
      }),
    [monthEntries, filter.cat, query, catLabel]
  );

  const countText =
    visibleEntries.length === monthEntries.length
      ? monthEntries.length === 1
        ? t("countOne")
        : t("countMany", { n: monthEntries.length })
      : t("countFiltered", { visible: visibleEntries.length, total: monthEntries.length });

  const dayGroups = useMemo(() => {
    const groups = new Map();
    visibleEntries.forEach(entry => {
      const key = dayKeyOf(new Date(entry.ts));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
    return Array.from(groups.entries());
  }, [visibleEntries]);

  const todayKey = dayKeyOf(now);
  const yesterdayKey = dayKeyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const categoryOnly = filter.cat !== "all" && !query;

  let emptyState = null;
  if (monthEntries.length === 0) {
    emptyState = {
      icon: "🧾",
      title: t("emptyMonth", { month: monthLabel }),
      sub: t("emptyMonthSub")
    };
  } else if (visibleEntries.length === 0) {
    emptyState = {
      icon: categoryOnly ? "🗂️" : "🔍",
      title: categoryOnly
        ? t("emptyCategory", { category: catLabel(filter.cat), month: monthLabel })
        : t("emptyFilter"),
      sub: categoryOnly
        ? t("emptyCategorySub", { category: catLabel(filter.cat) })
        : t("emptyFilterSub")
    };
  }

  const quickActive = Number(amount);

  function dayLabel(key, list) {
    const date = new Date(list[0].ts);
    if (key === todayKey) return `${t("today")} (${slashDate(date)})`;
    if (key === yesterdayKey) return `${t("yesterday")} (${slashDate(date)})`;
    return date.toLocaleDateString(dateLocale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      numberingSystem: "latn"
    });
  }

  function hideToast() {
    setToast(null);
  }

  function showToast(message, action = null) {
    setToast({
      id: `${Date.now()}-${Math.random()}`,
      message,
      action,
      duration: action?.duration || 2800
    });
  }

  function resetForm() {
    setEditingId(null);
    setDesc("");
    setAmount("");
    setFormError("");
    setActiveCategory("food");
  }

  function resetFilters() {
    setFilter({ q: "", cat: "all" });
  }

  function handleSubmit(event) {
    event.preventDefault();
    setFormError("");
    const value = round2(Number(amount));
    if (!amount.trim() || !Number.isFinite(value) || value <= 0) {
      setFormError(t("formAmountError"));
      amountRef.current?.focus();
      return;
    }
    if (value > 100000000) {
      setFormError(t("formLargeError"));
      amountRef.current?.focus();
      return;
    }

    const current = ledgerRef.current;
    const existing = editingId ? current.entries.find(item => item.id === editingId) : null;
    const ts = existing ? existing.ts : Date.now();
    const reason = desc.trim().slice(0, 80);
    const createdId = existing ? null : uid();

    const nextEntries = existing
      ? current.entries.map(item =>
          item.id === existing.id
            ? { ...item, category: activeCategory, reason, amount: value, ts }
            : item
        )
      : [
          ...current.entries,
          {
            id: createdId,
            category: activeCategory,
            reason,
            amount: value,
            ts
          }
        ];

    commitLedger({ ...current, entries: nextEntries });
    if (monthKeyOf(new Date(ts)) !== monthKeyOf(view)) {
      setView(startOfMonth(new Date(ts)));
    }

    setEditingId(null);
    resetForm();
    resetFilters();
    if (createdId) setNewEntryId(createdId);
    showToast(existing ? t("toastUpdated") : t("toastAdded"));
    requestAnimationFrame(() => descRef.current?.focus());
  }

  function startEdit(id) {
    const entry = ledgerRef.current.entries.find(item => item.id === id);
    if (!entry) return;
    setEditingId(entry.id);
    setActiveCategory(entry.category);
    setDesc(entry.reason);
    setAmount(String(entry.amount));
    setFormError("");
    formCardRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start"
    });
    requestAnimationFrame(() => {
      amountRef.current?.focus();
      amountRef.current?.select();
    });
  }

  function undoDelete() {
    const deleted = lastDeletedRef.current;
    if (!deleted) return;
    commitLedger(current => {
      const entries = current.entries.slice();
      entries.splice(Math.min(deleted.index, entries.length), 0, deleted.entry);
      return { ...current, entries };
    });
    lastDeletedRef.current = null;
    showToast(t("toastRestored"));
  }

  function deleteEntry(id) {
    const current = ledgerRef.current;
    const index = current.entries.findIndex(entry => entry.id === id);
    if (index < 0) return;
    const removed = current.entries[index];
    const entries = current.entries.slice();
    entries.splice(index, 1);
    if (editingId === id) resetForm();
    commitLedger({ ...current, entries });
    lastDeletedRef.current = { entry: removed, index };
    showToast(t("toastDeleted"), {
      label: t("undo"),
      onClick: undoDelete,
      duration: 6000
    });
  }

  function shiftMonth(delta) {
    const target = new Date(view.getFullYear(), view.getMonth() + delta, 1);
    if (target > startOfMonth(new Date())) return;
    if (editingId) resetForm();
    setView(target);
  }

  function goToday() {
    if (editingId) resetForm();
    setView(startOfMonth(new Date()));
  }

  function syncBudgetDrafts() {
    const current = ledgerRef.current;
    setBudgetDraft(String(current.budget));
    setLimitDrafts({ ...current.limits });
    setSavingsGoalDraft(String(current.savingsGoal));
  }

  function handleBudgetSubmit(event) {
    event.preventDefault();
    const budget = Number(budgetDraft);
    if (!Number.isFinite(budget) || budget < 0) {
      showToast(t("toastBudgetError"));
      budgetInputRef.current?.focus();
      return;
    }
    const limits = {};
    for (const category of CATEGORIES) {
      const value = Number(limitDrafts[category.id]);
      if (!Number.isFinite(value) || value < 0) {
        showToast(t("toastLimitError", { category: catLabel(category.id) }));
        document.getElementById(`limit-${category.id}`)?.focus();
        return;
      }
      limits[category.id] = round2(value);
    }
    const nextBudget = round2(budget);
    commitLedger(current => ({ ...current, budget: nextBudget, limits }));
    setBudgetDraft(String(nextBudget));
    setLimitDrafts({ ...limits });
    showToast(t("toastBudgetUpdated"));
  }

  function openSettings() {
    syncBudgetDrafts();
    setSettingsOpen(true);
    requestAnimationFrame(() => {
      detailsRef.current?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "center"
      });
      budgetInputRef.current?.focus({ preventScroll: true });
      budgetInputRef.current?.select();
    });
  }

  function handleSettingsToggle(event) {
    const open = event.currentTarget.open;
    setSettingsOpen(open);
    if (open) syncBudgetDrafts();
  }

  function addSampleEntries() {
    const existing = monthEntries;
    if (existing.length && !window.confirm(t("confirmSample", { n: existing.length }))) return;

    const year = view.getFullYear();
    const month = view.getMonth();
    const current = new Date();
    const isViewCurrent = monthKeyOf(view) === monthKeyOf(current);
    const maxDay = isViewCurrent ? current.getDate() : daysInMonth(view);
    const samples = [
      ["food", "sampleLunch", 120],
      ["transport", "sampleBus", 500],
      ["food", "sampleCoffee", 180],
      ["shopping", "sampleBooks", 650],
      ["entertainment", "sampleMovie", 300],
      ["bills", "samplePhone", 299],
      ["health", "samplePharmacy", 150],
      ["other", "sampleStationery", 90]
    ];
    const usedDays = new Set();
    const added = samples.map((sample, index) => {
      let day = Math.max(1, maxDay - index * 2);
      while (usedDays.has(day) && day < maxDay) day += 1;
      while (usedDays.has(day) && day > 1) day -= 1;
      usedDays.add(day);
      return {
        id: uid(),
        category: sample[0],
        reason: t(sample[1]),
        amount: sample[2],
        ts: new Date(year, month, day, 9 + (index % 9), 20).getTime()
      };
    });

    commitLedger(currentLedger => ({
      ...currentLedger,
      entries: [...currentLedger.entries, ...added]
    }));
    resetFilters();
    showToast(t("toastSampleAdded"));
  }

  function clearAll() {
    const current = ledgerRef.current;
    if (current.entries.length === 0) {
      showToast(t("toastNoDelete"));
      return;
    }
    if (!window.confirm(t("confirmClear", { n: current.entries.length }))) return;
    commitLedger({ ...current, entries: [] });
    resetForm();
    resetFilters();
    showToast(t("toastAllDeleted"));
  }

  function exportCsv() {
    const entries = monthEntries.slice().sort((a, b) => a.ts - b.ts);
    if (entries.length === 0) {
      showToast(t("toastNoCsv"));
      return;
    }
    const rows = [[t("csvDate"), t("csvTime"), t("csvCategory"), t("csvDescription"), t("csvAmount")]];
    entries.forEach(entry => {
      const date = new Date(entry.ts);
      rows.push([
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
        timeLabel(entry.ts),
        catLabel(entry.category),
        entry.reason || catLabel(entry.category),
        entry.amount.toFixed(2)
      ]);
    });
    const csv = `\uFEFF${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pocketwise-expenses-${monthKeyOf(view)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(t("toastCsv"));
  }

  function handleLanguageChange(event) {
    const next = event.target.value === "hi" ? "hi" : "en";
    if (next === lang) return;
    setLang(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch (error) {
      /* Language still applies for this session. */
    }
    hideToast();
    setFormError("");
  }

  function selectCategory(category) {
    setActiveCategory(category);
    amountRef.current?.focus();
  }

  function handleCardMouseMove(e) {
    if (prefersReducedMotion()) return;
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = -((y - centerY) / centerY) * 8.5;
    const rotateY = ((x - centerX) / centerX) * 8.5;
    card.style.transform = `perspective(600px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-6px) scale(1.025)`;
    const glare = card.querySelector(".card-glare");
    if (glare) {
      glare.style.opacity = "0.32";
      glare.style.transform = `translate(${x - 65}px, ${y - 65}px)`;
    }
  }

  function handleCardMouseLeave(e) {
    const card = e.currentTarget;
    card.style.transform = "perspective(600px) rotateX(0deg) rotateY(0deg) translateY(0) scale(1)";
    const glare = card.querySelector(".card-glare");
    if (glare) {
      glare.style.opacity = "0";
    }
  }

  function handleCardMouseDown(e) {
    e.currentTarget.style.transform = "perspective(600px) scale(0.97)";
  }

  function handleCardMouseUp(e) {
    e.currentTarget.style.transform = "perspective(600px) translateY(-6px) scale(1.025)";
  }

  function chooseQuickAmount(value, event) {
    const currentVal = Number(amount) || 0;
    const nextVal = currentVal > 0 ? round2(currentVal + value) : value;
    setAmount(String(nextVal));
    setFormError("");

    clearTimeout(stackNoticeTimerRef.current);
    setStackedNotice({ added: value, total: nextVal, stacked: currentVal > 0 });
    stackNoticeTimerRef.current = setTimeout(() => {
      setStackedNotice(null);
    }, 2200);

    amountRef.current?.focus({ preventScroll: true });
    const wrap = amountWrapRef.current;
    if (wrap) {
      wrap.classList.remove("flash");
      void wrap.offsetWidth;
      wrap.classList.add("flash");
      setTimeout(() => wrap.classList.remove("flash"), 650);
    }
    const button = event.currentTarget;
    button.classList.remove("pop");
    void button.offsetWidth;
    button.classList.add("pop");
    setTimeout(() => button.classList.remove("pop"), 400);
  }

  function chooseCategoryFilter(category) {
    setFilter(current => ({
      ...current,
      cat: category !== "all" && current.cat === category ? "all" : category
    }));
  }

  function tourTargetFor(step) {
    if (!step?.target) return null;
    try {
      return document.querySelector(step.target);
    } catch (error) {
      return null;
    }
  }

  function positionTour() {
    if (!tourVisibleRef.current) return;
    const step = TOUR_STEPS[lang][tourIndex];
    const target = tourTargetFor(step);
    const bubble = tourBubbleRef.current;
    const spot = tourSpotRef.current;
    if (!bubble || !spot) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 12;
    const gap = 16;
    const bRect = bubble.getBoundingClientRect();
    const bw = bRect.width || Math.min(380, vw - 28);
    const bh = bRect.height || 280;

    if (!target) {
      spot.hidden = true;
      setTourPlacement("");
      bubble.style.left = `${Math.max(margin, (vw - bw) / 2)}px`;
      bubble.style.top = `${Math.max(margin, (vh - bh) / 2)}px`;
      return;
    }

    spot.hidden = false;
    const rect = target.getBoundingClientRect();
    const pad = 7;
    const spotLeft = Math.max(6, rect.left - pad);
    const spotTop = Math.max(6, rect.top - pad);
    spot.style.left = `${spotLeft}px`;
    spot.style.top = `${spotTop}px`;
    spot.style.width = `${Math.max(8, Math.min(vw - spotLeft - 6, rect.width + pad * 2))}px`;
    spot.style.height = `${Math.max(8, Math.min(vh - spotTop - 6, rect.height + pad * 2))}px`;

    const roomBelow = vh - rect.bottom - gap - margin;
    const roomAbove = rect.top - gap - margin;
    const placeBelow = roomBelow >= bh || roomBelow >= roomAbove;
    let top = placeBelow ? rect.bottom + gap : rect.top - bh - gap;
    let left = rect.left + rect.width / 2 - bw / 2;
    top = Math.max(margin, Math.min(vh - bh - margin, top));
    left = Math.max(margin, Math.min(vw - bw - margin, left));
    setTourPlacement(placeBelow ? "below" : "above");
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    const arrow = Math.max(22, Math.min(bw - 22, rect.left + rect.width / 2 - left));
    bubble.style.setProperty("--arrow", `${arrow}px`);
  }

  function scrollTourTarget() {
    const step = TOUR_STEPS[lang][tourIndex];
    const target = tourTargetFor(step);
    clearTimeout(tourScrollTimerRef.current);
    tourScrollTimerRef.current = null;
    if (!target) {
      positionTour();
      return;
    }
    const rect = target.getBoundingClientRect();
    const needsScroll = rect.top < 96 || rect.bottom > window.innerHeight - 96;
    if (!needsScroll) {
      document.body.classList.add("tour-open");
      positionTour();
      return;
    }
    document.body.classList.remove("tour-open");
    target.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth"
    });
    tourScrollTimerRef.current = setTimeout(
      () => {
        if (!tourVisibleRef.current) return;
        document.body.classList.add("tour-open");
        positionTour();
        tourScrollTimerRef.current = null;
      },
      prefersReducedMotion() ? 20 : 320
    );
  }

  function openTour() {
    if (tourVisibleRef.current) return;
    clearTimeout(tourCloseTimerRef.current);
    tourCloseTimerRef.current = null;
    tourCloseIntentRef.current = false;
    const active = document.activeElement;
    tourReturnFocusRef.current =
      active === document.body ? tourBtnRef.current : active;
    tourFocusPendingRef.current = true;
    tourVisibleRef.current = true;
    setTourIndex(0);
    setTourPlacement("below");
    setTourPulse(false);
    setTourShown(false);
    setTourVisible(true);
  }

  function closeTour() {
    if (!tourVisibleRef.current) return;
    markTourSeen();
    tourCloseIntentRef.current = true;
    clearTimeout(tourScrollTimerRef.current);
    tourScrollTimerRef.current = null;
    document.body.classList.remove("tour-open");
    setTourShown(false);

    const finish = () => {
      tourVisibleRef.current = false;
      tourCloseIntentRef.current = false;
      setTourVisible(false);
      setTourPulse(false);
      setTourPlacement("below");
      const bubble = tourBubbleRef.current;
      if (bubble) {
        bubble.style.left = "";
        bubble.style.top = "";
        bubble.style.removeProperty("--arrow");
      }
      const spot = tourSpotRef.current;
      if (spot) {
        spot.hidden = true;
        spot.style.left = "";
        spot.style.top = "";
        spot.style.width = "";
        spot.style.height = "";
      }
      const returnFocus = tourReturnFocusRef.current;
      tourReturnFocusRef.current = null;
      if (returnFocus && document.contains(returnFocus) && typeof returnFocus.focus === "function") {
        returnFocus.focus({ preventScroll: true });
      }
      tourCloseTimerRef.current = null;
    };

    clearTimeout(tourCloseTimerRef.current);
    if (prefersReducedMotion()) finish();
    else tourCloseTimerRef.current = setTimeout(finish, 200);
  }

  function goTourStep(delta) {
    const total = TOUR_STEPS[lang].length;
    setTourIndex(current => Math.max(0, Math.min(total - 1, current + delta)));
  }

  function nextTourStep() {
    if (tourIndex >= TOUR_STEPS[lang].length - 1) {
      closeTour();
      return;
    }
    goTourStep(1);
  }

  function handleTourKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeTour();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      nextTourStep();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTourStep(-1);
      return;
    }
    if (event.key !== "Tab") return;
    const bubble = tourBubbleRef.current;
    if (!bubble) return;
    const items = Array.from(bubble.querySelectorAll("button:not([disabled])")).filter(
      node => !node.hidden
    );
    if (!items.length) {
      event.preventDefault();
      bubble.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || active === bubble || !bubble.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || active === bubble || !bubble.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  const tourSteps = TOUR_STEPS[lang] || TOUR_STEPS.en;
  const tourStep = tourSteps[Math.min(tourIndex, tourSteps.length - 1)] || tourSteps[0];
  const tourTargetMissing = !tourStep.target;
  const tourBubbleClass = [
    "tour-bubble",
    tourPlacement,
    tourPulse ? "step-in" : ""
  ]
    .filter(Boolean)
    .join(" ");

  if (!ready) {
    return (
      <div className="boot-screen" aria-busy="true" role="status">
        <span className="brand-mark" aria-hidden="true">₹</span>
        <span>Loading your ledger…</span>
      </div>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main">{t("skip")}</a>

      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">₹</span>
            <span className="brand-text">
              <span className="brand-name">PocketWise</span>
              <span className="brand-sub">{t("brandSub")}</span>
            </span>
          </div>
          <div className="top-actions">
            <select
              className="lang-select"
              id="langSelect"
              aria-label={t("language")}
              title={t("language")}
              value={lang}
              onChange={handleLanguageChange}
            >
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
            </select>
            <button
              type="button"
              className={`theme-toggle${themeAnimating ? " animating" : ""}`}
              id="themeToggle"
              aria-label={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
              title={darkMode ? "Light Mode" : "Dark Mode"}
              onClick={toggleDarkMode}
            >
              <span className="theme-toggle-track">
                <span className="theme-toggle-thumb">
                  <span className="theme-icon sun" aria-hidden="true">☀️</span>
                  <span className="theme-icon moon" aria-hidden="true">🌙</span>
                </span>
              </span>
            </button>
            <button
              type="button"
              className="btn"
              id="exportBtn"
              aria-label={t("exportCsv")}
              onClick={exportCsv}
            >
              <span aria-hidden="true">⬇</span>{" "}
              <span className="export-label">{t("exportCsv")}</span>
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="wrap">
        <div className="page-head">
          <div>
            <h1>{t("pageHeading")}</h1>
            <p>{t("pageSubtitle")}</p>
            <button
              type="button"
              className="tour-btn"
              id="tourBtn"
              ref={tourBtnRef}
              aria-haspopup="dialog"
              aria-controls="tourOverlay"
              aria-label={t("tourOpenAria")}
              onClick={openTour}
            >
              <span className="tour-btn-ico" aria-hidden="true">?</span>
              <span>{t("tourOpen")}</span>
            </button>
          </div>
          <div className="month-nav" role="group" aria-label={t("chooseMonth")}>
            <button
              type="button"
              className="month-btn"
              id="prevMonth"
              aria-label={t("prevMonth")}
              onClick={() => shiftMonth(-1)}
            >
              ‹
            </button>
            <span className="month-label" id="monthLabel" aria-live="polite">
              {monthLabel}
            </span>
            <button
              type="button"
              className="month-btn"
              id="nextMonth"
              aria-label={t("nextMonth")}
              disabled={viewIndex >= nowIndex}
              onClick={() => shiftMonth(1)}
            >
              ›
            </button>
            <button
              type="button"
              className="today-btn"
              id="todayBtn"
              disabled={viewIndex === nowIndex}
              onClick={goToday}
            >
              {t("thisMonth")}
            </button>
          </div>
        </div>

        <p className="storage-warn" id="storageNote" hidden={storageOK}>
          ⚠️ {t("storageWarning").replace(/^⚠️\s*/, "")}
        </p>

        <section className="summary" aria-label={t("summaryAria")}>
          <article
            className="sum-card purple budget"
            onMouseMove={handleCardMouseMove}
            onMouseLeave={handleCardMouseLeave}
            onMouseDown={handleCardMouseDown}
            onMouseUp={handleCardMouseUp}
          >
            <div className="card-glare" aria-hidden="true" />
            <div className="sum-label">{t("monthlyBudget")}</div>
            <div className="sum-value" id="statBudget">{money(ledger.budget)}</div>
            <div className="sum-sub">{t("tapEdit")}</div>
            <button
              type="button"
              className="card-link"
              id="editBudgetBtn"
              aria-label={t("editBudgetAria")}
              onClick={openSettings}
            >
              {t("edit")}
            </button>
          </article>
          <article
            className="sum-card orange spent"
            onMouseMove={handleCardMouseMove}
            onMouseLeave={handleCardMouseLeave}
            onMouseDown={handleCardMouseDown}
            onMouseUp={handleCardMouseUp}
          >
            <div className="card-glare" aria-hidden="true" />
            <div className="sum-label">{t("spent")}</div>
            <div className="sum-value" id="statSpent">{money(spent)}</div>
            <div className="sum-sub" id="statSpentSub">{spentSub}</div>
          </article>
          <article
            className={`sum-card left ${left < 0 ? "red" : "green"}`}
            id="sumLeft"
            onMouseMove={handleCardMouseMove}
            onMouseLeave={handleCardMouseLeave}
            onMouseDown={handleCardMouseDown}
            onMouseUp={handleCardMouseUp}
          >
            <div className="card-glare" aria-hidden="true" />
            <div className="sum-label">{t("leftToSpend")}</div>
            <div className="sum-value" id="statLeft">{money(left)}</div>
            <div className="sum-sub" id="statLeftSub">{leftSub}</div>
          </article>
        </section>

        <div className={`status ${status.tone}`} id="statusBanner" role="status" aria-live="polite">
          <span className="status-ico" id="statusIcon" aria-hidden="true">{status.icon}</span>
          <span id="statusText">{status.text}</span>
        </div>

        <div className="layout">
          <div className="col-main">
            <section
              className={`card entry-card${editingId ? " editing" : ""}`}
              id="formCard"
              ref={formCardRef}
              aria-labelledby="formTitle"
            >
              <div className="card-head">
                <h2 className="card-title" id="formTitle">
                  {editingId ? t("formEditTitle") : t("formAddTitle")}
                </h2>
                <span className="card-note">{t("formNote")}</span>
              </div>
              <form id="entryForm" noValidate onSubmit={handleSubmit}>
                <div className="cat-chips" id="catChips" role="group" aria-label={t("categoryGroup")}>
                  {CATEGORIES.map(category => (
                    <button
                      type="button"
                      className="chip"
                      key={category.id}
                      data-cat={category.id}
                      aria-pressed={category.id === activeCategory}
                      title={catLabel(category.id)}
                      onClick={() => selectCategory(category.id)}
                    >
                      <span aria-hidden="true">{category.icon}</span> {catLabel(category.id)}
                    </button>
                  ))}
                </div>
                <div className="form-grid">
                  <div className="field field-desc">
                    <label htmlFor="desc">
                      <span>{t("descLabel")}</span>{" "}
                      <span className="label-hint">{t("optional")}</span>
                    </label>
                    <input
                      type="text"
                      id="desc"
                      ref={descRef}
                      maxLength={80}
                      placeholder={t(`descPlaceholder_${CAT.has(activeCategory) ? activeCategory : "other"}`)}
                      autoComplete="off"
                      value={desc}
                      onChange={event => setDesc(event.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="amount">{t("amountLabel")}</label>
                    <div className="amount-wrap" ref={amountWrapRef}>
                      <span aria-hidden="true">₹</span>
                      <input
                        type="number"
                        id="amount"
                        ref={amountRef}
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="0"
                        autoComplete="off"
                        value={amount}
                        onChange={event => {
                          setAmount(event.target.value);
                          setFormError("");
                          setStackedNotice(null);
                        }}
                      />
                      {amount && (
                        <button
                          type="button"
                          className="amount-clear-icon"
                          aria-label="Clear amount"
                          onClick={() => {
                            setAmount("");
                            setStackedNotice(null);
                            amountRef.current?.focus();
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="quick-amounts">
                    <div className="quick-header-row">
                      <span className="quick-label" id="quickLabel">
                        {t("quickLabel")} <span className="quick-hint-tag">Tap to stack (+)</span>
                      </span>
                      {stackedNotice && (
                        <span className="stack-badge pop-in" role="status" aria-live="polite">
                          +{money(stackedNotice.added)} → Total: {money(stackedNotice.total)} ✨
                        </span>
                      )}
                    </div>
                    <div className="quick-chips" id="quickChips" role="group" aria-label={t("quickGroup")}>
                      {QUICK_AMOUNTS.map(value => (
                        <button
                          type="button"
                          className="quick-chip"
                          key={value}
                          data-amount={value}
                          aria-label={t("setAmountAria", { amount: money(value) })}
                          onClick={event => chooseQuickAmount(value, event)}
                        >
                          +{money(value)}
                        </button>
                      ))}
                      {Number(amount) > 0 && (
                        <button
                          type="button"
                          className="quick-chip clear"
                          onClick={() => {
                            setAmount("");
                            setStackedNotice(null);
                            amountRef.current?.focus();
                          }}
                          title="Reset amount"
                        >
                          ↺ Clear
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn-primary" id="submitBtn">
                      {editingId ? t("saveChanges") : t("addExpense")}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      id="cancelEdit"
                      hidden={!editingId}
                      onClick={() => {
                        resetForm();
                        requestAnimationFrame(() => descRef.current?.focus());
                      }}
                    >
                      {t("cancel")}
                    </button>
                  </div>
                </div>
                <p className="form-error" id="formError" role="alert" hidden={!formError}>
                  {formError}
                </p>
              </form>
            </section>

            <section className="card" aria-labelledby="txnTitle">
              <div className="card-head">
                <h2 className="card-title" id="txnTitle">{t("txnTitle")}</h2>
                <span className="card-note" id="txnCount" aria-live="polite">{countText}</span>
              </div>
              <div className="txn-tools">
                <label className="sr-only" htmlFor="searchBox">{t("searchAria")}</label>
                <input
                  type="search"
                  id="searchBox"
                  placeholder={t("searchPlaceholder")}
                  autoComplete="off"
                  value={filter.q}
                  onChange={event =>
                    setFilter(current => ({ ...current, q: event.target.value }))
                  }
                />
              </div>
              <div className="txn-cats" id="txnCats" role="group" aria-label={t("filterAria")}>
                <button
                  type="button"
                  className={`txn-cat${monthEntries.length === 0 ? " txn-cat-empty" : ""}`}
                  data-txn-cat="all"
                  aria-pressed={filter.cat === "all"}
                  onClick={() => chooseCategoryFilter("all")}
                >
                  <span aria-hidden="true">✦</span>
                  <span>{t("allCategories")}</span>
                  <span className="txn-cat-count">{monthEntries.length}</span>
                </button>
                {CATEGORIES.map(category => (
                  <button
                    type="button"
                    className={`txn-cat${transactionCounts[category.id] === 0 ? " txn-cat-empty" : ""}`}
                    key={category.id}
                    data-txn-cat={category.id}
                    aria-pressed={filter.cat === category.id}
                    onClick={() => chooseCategoryFilter(category.id)}
                  >
                    <span aria-hidden="true">{category.icon}</span>
                    <span>{catLabel(category.id)}</span>
                    <span className="txn-cat-count">{transactionCounts[category.id]}</span>
                  </button>
                ))}
              </div>
              <div id="txnList" key={monthKeyOf(view)} className="view-enter">
                {emptyState ? (
                  <div className="empty">
                    <div className="empty-ico" aria-hidden="true">{emptyState.icon}</div>
                    <p>{emptyState.title}</p>
                    <p className="empty-sub">{emptyState.sub}</p>
                  </div>
                ) : (
                  dayGroups.map(([key, list]) => (
                    <section className="day-group" key={key}>
                      <h3 className="day-label">{dayLabel(key, list)}</h3>
                      <ul className="txn-list">
                        {list.map(entry => {
                          const category = CAT.get(entry.category) || CAT.get("other");
                          const reason = entry.reason || catLabel(category.id);
                          const meta = entry.reason
                            ? `${catLabel(category.id)} · ${timeLabel(entry.ts)}`
                            : timeLabel(entry.ts);
                          return (
                            <li
                              className={`txn${entry.id === newEntryId ? " txn-new" : ""}`}
                              key={entry.id}
                              data-id={entry.id}
                            >
                              <span className={`txn-ico ${category.id}`} aria-hidden="true">
                                {category.icon}
                              </span>
                              <div className="txn-main">
                                <div className="txn-desc" title={reason}>{reason}</div>
                                <div className="txn-meta">{meta}</div>
                              </div>
                              <div className="txn-amt">−{money(entry.amount)}</div>
                              <div className="txn-actions">
                                <button
                                  type="button"
                                  className="icon-btn"
                                  data-edit={entry.id}
                                  aria-label={t("editAria", { reason })}
                                  title={t("edit")}
                                  onClick={() => startEdit(entry.id)}
                                >
                                  ✎
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn danger"
                                  data-del={entry.id}
                                  aria-label={t("deleteAria", { reason })}
                                  title={t("delete")}
                                  onClick={() => deleteEntry(entry.id)}
                                >
                                  ×
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))
                )}
              </div>
            </section>
          </div>

          <aside className="col-side">
            <section className="card" aria-labelledby="rewardsTitle">
              <div className="card-head">
                <h2 className="card-title" id="rewardsTitle">Monthly Savings Rewards</h2>
                <span className="card-note">Earn points for saving</span>
              </div>
              <div className="rewards-stats">
                <div className="reward-stat">
                  <span className="reward-label">Income (budget)</span>
                  <span className="reward-value">{money(ledger.budget)}</span>
                </div>
                <div className="reward-stat">
                  <span className="reward-label">Expenses</span>
                  <span className="reward-value">{money(spent)}</span>
                </div>
                <div className="reward-stat">
                  <span className="reward-label">Net savings</span>
                  <span className="reward-value">{money(netSavings)}</span>
                </div>
                <div className="reward-stat">
                  <span className="reward-label">Reward points</span>
                  <span className="reward-value">{totalRewardPoints}</span>
                </div>
              </div>
              <div className="savings-goal">
                <label htmlFor="savingsGoalInput">Monthly savings goal</label>
                <form
                  onSubmit={event => {
                    event.preventDefault();
                    const value = Number(savingsGoalDraft);
                    if (!Number.isFinite(value) || value < 0) return;
                    commitLedger(current => ({ ...current, savingsGoal: round2(value) }));
                    setSavingsGoalDraft(String(round2(value)));
                  }}
                >
                  <div className="savings-goal-box">
                    <span className="savings-goal-currency" aria-hidden="true">₹</span>
                    <input
                      type="number"
                      id="savingsGoalInput"
                      min="0"
                      step="100"
                      value={savingsGoalDraft}
                      onChange={event => setSavingsGoalDraft(event.target.value)}
                      placeholder="Enter monthly saving goal"
                    />
                  </div>
                  <button type="submit" className="btn-primary btn-block" style={{ marginTop: "8px" }}>
                    Save goal
                  </button>
                </form>
                <div className="progress-wrap">
                  <div className="progress-bar" role="progressbar" aria-valuenow={savingsProgress} aria-valuemin="0" aria-valuemax="100">
                    <div className="progress-fill" style={{ width: `${savingsProgress}%` }} />
                  </div>
                  <span className="progress-text">{savingsProgress}% of goal</span>
                </div>
              </div>
              <div className="badges">
                {REWARD_BADGES.map(badge => {
                  const unlocked = netSavings >= badge.threshold;
                  return (
                    <div key={badge.threshold} className={`badge ${unlocked ? "unlocked" : "locked"}`}>
                      <span className="badge-icon">{unlocked ? "🏆" : "🔒"}</span>
                      <span className="badge-label">{badge.label}</span>
                      <span className="badge-meta">₹{badge.threshold}+ · {badge.points} pts</span>
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="card" aria-labelledby="budgetTitle">
              <div className="card-head">
                <h2 className="card-title" id="budgetTitle">{t("budgetTitle")}</h2>
                <span className="card-note">{t("thisMonthNote")}</span>
              </div>
              <div id="breakdown" key={monthKeyOf(view)}>
                {breakdown.map(category => (
                  <div className="bd-row" key={category.id}>
                    <div className="bd-top">
                      <span className="bd-name">
                        <span aria-hidden="true">{category.icon}</span> {category.label}
                        {category.over ? (
                          <span className="over-flag">{t("overFlag")}</span>
                        ) : null}
                      </span>
                      <span className="bd-val">{category.valueText}</span>
                    </div>
                    <div className="track" aria-hidden="true">
                      <div
                        className={`fill ${category.fillClass}`}
                        style={{ width: `${category.width}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <details
                className="settings"
                id="budgetDetails"
                ref={detailsRef}
                open={settingsOpen}
                onToggle={handleSettingsToggle}
              >
                <summary>{t("budgetDetails")}</summary>
                <div className="settings-body">
                  <form id="budgetForm" noValidate onSubmit={handleBudgetSubmit}>
                    <div className="field">
                      <label htmlFor="budgetInput">{t("monthlyBudgetLabel")}</label>
                      <div className="amount-wrap">
                        <span aria-hidden="true">₹</span>
                        <input
                          type="number"
                          id="budgetInput"
                          ref={budgetInputRef}
                          inputMode="decimal"
                          min="0"
                          step="100"
                          value={budgetDraft}
                          onChange={event => setBudgetDraft(event.target.value)}
                        />
                      </div>
                    </div>
                    <p className="hint">{t("budgetHint")}</p>
                    <div className="limit-grid" id="limitGrid">
                      {CATEGORIES.map(category => (
                        <label className="limit-field" key={category.id}>
                          <span data-limit-label={category.id}>
                            {category.icon} {catLabel(category.id)}
                          </span>
                          <input
                            type="number"
                            id={`limit-${category.id}`}
                            min="0"
                            step="50"
                            inputMode="numeric"
                            value={limitDrafts[category.id]}
                            onChange={event =>
                              setLimitDrafts(current => ({
                                ...current,
                                [category.id]: event.target.value
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <button type="submit" className="btn-primary btn-block" id="saveSettings">
                      {t("saveBudgets")}
                    </button>
                  </form>
                  <div className="data-actions">
                    <button type="button" className="btn-ghost" id="sampleBtn" onClick={addSampleEntries}>
                      {t("sampleEntries")}
                    </button>
                    <button type="button" className="btn-ghost danger" id="clearBtn" onClick={clearAll}>
                      {t("deleteAll")}
                    </button>
                  </div>
                </div>
              </details>
            </section>
          </aside>
        </div>

        <footer className="foot">
          <span>
            © <span id="year">{new Date().getFullYear()}</span>{" "}
            <span>{t("footerBrand")}</span>
          </span>
          <span>{t("footerPrivacy")}</span>
        </footer>
      </main>

      <div className={`toast${toast ? " show" : ""}`} id="toast" role="status" aria-live="polite">
        <span id="toastMsg">{toast?.message || ""}</span>
        <button
          type="button"
          id="toastAction"
          hidden={!toast?.action}
          onClick={() => {
            const action = toast?.action;
            hideToast();
            action?.onClick?.();
          }}
        >
          {toast?.action?.label || t("undo")}
        </button>
      </div>

      <div
        className={`tour-layer${tourShown ? " show" : ""}${tourTargetMissing ? " final" : ""}`}
        id="tourOverlay"
        ref={tourOverlayRef}
        hidden={!tourVisible}
        onKeyDown={handleTourKeydown}
      >
        <div className="tour-backdrop" id="tourBackdrop" aria-hidden="true" />
        <div
          className="tour-spot"
          id="tourSpot"
          ref={tourSpotRef}
          aria-hidden="true"
          hidden={tourTargetMissing}
        />
        <div
          className={tourBubbleClass}
          id="tourBubble"
          ref={tourBubbleRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tourTitle"
          aria-describedby="tourBody"
          tabIndex={-1}
        >
          <div className="tour-top">
            <span className="tour-step" id="tourStepLabel">
              {t("tourStepCount", { n: tourIndex + 1, total: tourSteps.length })}
            </span>
            <button type="button" className="tour-skip" id="tourSkip" onClick={closeTour}>
              {t("tourSkip")}
            </button>
          </div>
          <div className="tour-icon" id="tourIcon" aria-hidden="true">{tourStep.icon}</div>
          <div className="tour-copy" aria-live="polite">
            <h2 className="tour-title" id="tourTitle">{tourStep.title}</h2>
            <p className="tour-body" id="tourBody">{tourStep.body}</p>
          </div>
          <div className="tour-tip" id="tourTip">{tourStep.tip || ""}</div>
          <div className="tour-foot">
            <div className="tour-dots" id="tourDots" aria-hidden="true">
              {tourSteps.map((step, index) => (
                <span
                  className={`tour-dot${index === tourIndex ? " active" : ""}`}
                  key={step.title}
                />
              ))}
            </div>
            <div className="tour-actions">
              <button
                type="button"
                className="btn-ghost tour-back"
                id="tourBack"
                disabled={tourIndex === 0}
                onClick={() => goTourStep(-1)}
              >
                {t("tourBack")}
              </button>
              <button
                type="button"
                className="btn-primary tour-next"
                id="tourNext"
                onClick={nextTourStep}
              >
                {tourIndex === tourSteps.length - 1 ? t("tourFinish") : t("tourNext")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
