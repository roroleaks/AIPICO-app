function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage;
    }
    if (typeof sessionStorage !== "undefined") {
      return sessionStorage;
    }
  } catch {}
  return null;
}

export function sset(key: string, value: unknown) {
  try {
    getStorage()?.setItem(key, JSON.stringify(value));
  } catch {}
}

export function sget<T>(key: string): T | null {
  try {
    const raw = getStorage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export const KEYS = {
  // Stores the structured ClinicalInput payload (read on mount by /).
  input: "cq_input",
  // Canonical comma-joined normalized keywords.
  inputText: "cq_input_text",
  picoWords: "cq_pico_words",
  screen: "cq_screen",
  choice: "cq_choice",
  explore: "cq_explore",
  excluded: "cq_excluded",
  style: "cq_style"
};

export interface ExcludedState {
  phrase: string;
  category: string;
  userExcluded: string[];
  seen: string[];
}

/**
 * Validates whether a cached literature-screening snapshot matches current PICO words and has all 3 phrases.
 */
export function isMatchingScreenCache(
  cached: {
    inputWords?: string[];
    phrases?: {
      established?: unknown;
      conflicting?: unknown;
      gap?: unknown;
    };
  } | null | undefined,
  currentWords: Array<{ word: string; role?: unknown } | string> | null | undefined
): boolean {
  if (!cached || !currentWords || !Array.isArray(cached.inputWords) || !Array.isArray(currentWords)) return false;
  if (!cached.phrases?.established || !cached.phrases?.conflicting || !cached.phrases?.gap) return false;
  if (cached.inputWords.length !== currentWords.length) return false;

  for (let i = 0; i < currentWords.length; i++) {
    const rawCurr = currentWords[i];
    const currStr = (typeof rawCurr === "string" ? rawCurr : rawCurr?.word ?? "").trim().toLowerCase();
    const cachedStr = (cached.inputWords[i] ?? "").trim().toLowerCase();
    if (!currStr || currStr !== cachedStr) return false;
  }
  return true;
}

/**
 * Validates whether a cached explore snapshot matches the current choice selection.
 */
export function isMatchingExploreCache(
  cached: { phrase?: string; category?: string; records?: unknown[] } | null | undefined,
  choice: { phrase?: string; category?: string } | null | undefined,
  excludedState?: ExcludedState | null | undefined
): boolean {
  if (!cached || !choice) return false;
  if (!cached.phrase || !cached.category || !choice.phrase || !choice.category) return false;
  if (cached.phrase !== choice.phrase) return false;
  if (cached.category !== choice.category) return false;
  if (!Array.isArray(cached.records)) return false;
  if (excludedState && (excludedState.phrase !== choice.phrase || excludedState.category !== choice.category)) {
    return false;
  }
  return true;
}

export const LEGACY_KEYS = [
  "cq_input",
  "cq_input_text",
  "cq_mode",
  "cq_gap",
  "cq_question",
  "cq_formulation",
  "cq_commentary",
  "cq_outcomes",
  "cq_citation_style",
  "cq_outcome"
] as const;

/**
 * Completely clears all session state and storage when starting over,
 * explicitly purging legacy keys to avoid state leakage from older versions.
 */
export function resetSession() {
  try {
    const storage = getStorage();
    if (!storage) return;
    for (const key of Object.values(KEYS)) {
      storage.removeItem(key);
    }
    for (const leg of LEGACY_KEYS) {
      storage.removeItem(leg);
    }
    storage.clear();
  } catch {}
}
