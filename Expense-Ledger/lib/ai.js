/* Shared AI helpers for ledger command understanding. */

/* The system prompt used wherever natural-language ledger commands
   (magic input, voice) are converted into strict JSON actions. */
export const LEDGER_AI_SYSTEM =
  "You are a financial assistant. The user wants to manage their ledger (voice or typed). Analyze the request and return ONLY a JSON object. \n\n" +
  "1. If they want to ADD an expense: {action: 'add', category: 'food|transport|shopping|bills|entertainment|health|other', amount: number, reason: 'string'}\n" +
  "   - Infer the category from the item name (pizza/tea/lunch -> food, auto/uber/petrol -> transport, shirt -> shopping, electricity/wifi -> bills, movie/game -> entertainment, medicine/doctor -> health).\n" +
  "   - 'spent 200 on pizza' or garbled speech like 'spend to hundreds on pizza' both mean amount 200 added under food.\n" +
  "2. If they want to REMOVE/DELETE an expense: {action: 'delete', query: 'string'}\n" +
  "   - If they want to REMOVE ALL expenses / clear the whole ledger ('remove all expenses', 'clear everything'): {action: 'clearAll'}\n" +
  "   - If they want to UNDO / RESTORE the recently removed expenses ('undo', 'bring back the expenses I removed'): {action: 'undo'}\n" +
  "3. If they want to SET or CHANGE the MONTHLY SAVINGS GOAL (the words goal/target/milestone): {action: 'setGoal', amount: number}\n" +
  "4. If they want to SET or CHANGE the OVERALL MONTHLY BUDGET (the words 'monthly budget', 'total budget', or just 'budget' when NO category is named): {action: 'setBudget', amount: number}\n" +
  "5. If they want to SET or CHANGE a CATEGORY SPENDING LIMIT (the word limit, or budget WITH a category named like 'food budget'): {action: 'setLimit', category: 'all|food|transport|shopping|bills|entertainment|health|other', amount: number}\n" +
  "6. If you are unsure: {action: 'unknown'}\n\n" +
  "Rules: amounts are INR numbers without commas; category MUST be one of the listed ids, never an item name; reason is a short item description. Return ONLY JSON. No markdown, no explanation.";

/* The AI occasionally replies with single-quoted JSON or markdown fences
   despite instructions, so try strict JSON first, then quote-normalized JSON,
   then a regex extraction as a last resort. */
export function parseAiJson(rawText) {
  const text = String(rawText || "")
    .replace(/```json|```/g, "")
    .replace(/^`+|`+$/g, "")
    .trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_) {}

  try {
    return JSON.parse(text.replace(/'/g, '"'));
  } catch (_) {}

  const pick = name => {
    const match = text.match(new RegExp(`["']?${name}["']?\\s*:\\s*["']([^"']*)["']`, "i"));
    return match ? match[1] : undefined;
  };
  const pickNumber = name => {
    const match = text.match(new RegExp(`["']?${name}["']?\\s*:\\s*"?(-?[\\d.,]+)"?`, "i"));
    if (!match) return undefined;
    const value = Number(String(match[1]).replace(/,/g, ""));
    return Number.isFinite(value) ? value : undefined;
  };

  const collected = {
    action: pick("action"),
    category: pick("category"),
    reason: pick("reason"),
    query: pick("query"),
    amount: pickNumber("amount")
  };

  const hasAnything = Object.values(collected).some(value => value !== undefined);
  return hasAnything ? collected : null;
}
