/* Global undo stack for removals: any surface (dashboard, Penny chat, voice)
   that deletes or clears expenses pushes a snapshot here, so "undo" can
   reliably bring the removed entries back — even across page reloads. */

const UNDO_KEY = "pocketwise_undo_v1";
const MAX_UNDO = 10;

export function loadUndoStack() {
  try {
    const parsed = JSON.parse(localStorage.getItem(UNDO_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

export function pushUndoSnapshot(removedEntries) {
  try {
    if (!Array.isArray(removedEntries) || removedEntries.length === 0) return;
    const stack = loadUndoStack();
    stack.push({ ts: Date.now(), entries: removedEntries });
    if (stack.length > MAX_UNDO) stack.splice(0, stack.length - MAX_UNDO);
    localStorage.setItem(UNDO_KEY, JSON.stringify(stack));
  } catch (error) {
    /* No undo history without storage. */
  }
}

/* Pops the most recent snapshot's removed entries (LIFO). */
export function popUndoSnapshot() {
  try {
    const stack = loadUndoStack();
    const last = stack.pop();
    if (last) {
      localStorage.setItem(UNDO_KEY, JSON.stringify(stack));
      return Array.isArray(last.entries) ? last.entries : null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/* Re-insert removed entries that are not already back in the ledger. */
export function mergeUndoEntries(poppedEntries, currentEntries) {
  const popped = Array.isArray(poppedEntries) ? poppedEntries : [];
  const missing = popped.filter(item =>
    item && !currentEntries.some(entry => entry.id === item.id)
  );
  return [...currentEntries, ...missing];
}
