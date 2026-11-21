import test from "node:test";
import assert from "node:assert/strict";
import { isMatchingScreenCache, isMatchingExploreCache, resetSession, KEYS, LEGACY_KEYS } from "./session.ts";

test("SES-1. KEYS catalog contains active session keys and omits retired keys", () => {
  // Live keys must be present
  assert.equal(KEYS.input, "cq_input");
  assert.equal(KEYS.inputText, "cq_input_text");
  assert.equal(KEYS.picoWords, "cq_pico_words");
  assert.equal(KEYS.screen, "cq_screen");
  assert.equal(KEYS.choice, "cq_choice");
  assert.equal(KEYS.explore, "cq_explore");
  assert.equal(KEYS.excluded, "cq_excluded");
  assert.equal(KEYS.style, "cq_style");

  // Legacy keys must be absent from KEYS
  const keysObj = KEYS as Record<string, string | undefined>;
  assert.equal(keysObj.gap, undefined, "KEYS.gap must be removed");
  assert.equal(keysObj.question, undefined, "KEYS.question must be removed");
  assert.equal(keysObj.formulation, undefined, "KEYS.formulation must be removed");
  assert.equal(keysObj.commentary, undefined, "KEYS.commentary must be removed");
  assert.equal(keysObj.outcomes, undefined, "KEYS.outcomes must be removed");
  assert.equal(keysObj.citationStyle, undefined, "KEYS.citationStyle must be removed");
  assert.equal(keysObj.mode, undefined, "KEYS.mode must be removed");

  // LEGACY_KEYS list must contain retired storage keys
  assert.equal(LEGACY_KEYS.includes("cq_gap"), true);
  assert.equal(LEGACY_KEYS.includes("cq_mode"), true);
  assert.equal(LEGACY_KEYS.includes("cq_outcomes"), true);
});

test("SES-2. isMatchingScreenCache validates matching cache and phrases", () => {
  const cached = {
    inputWords: ["poor responders", "ivf", "growth hormone"],
    phrases: {
      established: { phrase: "PICO 1", basis: "Basis 1" },
      conflicting: { phrase: "PICO 2", basis: "Basis 2" },
      gap: { phrase: "PICO 3", basis: "Basis 3" }
    }
  };

  const words = [
    { word: "Poor Responders", role: "population" as const },
    { word: "IVF", role: "intervention" as const },
    { word: "growth hormone", role: "comparator" as const }
  ];

  assert.equal(isMatchingScreenCache(cached, words), true);
  assert.equal(isMatchingScreenCache(cached, ["poor responders", "ivf", "growth hormone"]), true);

  // Different words
  assert.equal(
    isMatchingScreenCache(cached, [
      { word: "endometriosis", role: "population" as const },
      { word: "ivf", role: "intervention" as const }
    ]),
    false
  );

  // Missing one phrase category
  const incompleteCached: Parameters<typeof isMatchingScreenCache>[0] = {
    inputWords: ["poor responders", "ivf", "growth hormone"],
    phrases: {
      established: { phrase: "PICO 1", basis: "Basis 1" },
      conflicting: { phrase: "PICO 2", basis: "Basis 2" }
    }
  };
  assert.equal(isMatchingScreenCache(incompleteCached, words), false);

  // Null checks
  assert.equal(isMatchingScreenCache(null, words), false);
  assert.equal(isMatchingScreenCache(cached, null), false);
});

test("SES-3. isMatchingExploreCache validates matching phrase, category, and record array", () => {
  const cached = {
    phrase: "In poor responders (P), does ivf (I) compared with usual care (C) improve clinical pregnancy rate (O)?",
    category: "established",
    records: [{ title: "Study 1", pmid: "12345" }]
  };

  const choice = {
    phrase: "In poor responders (P), does ivf (I) compared with usual care (C) improve clinical pregnancy rate (O)?",
    category: "established"
  };

  assert.equal(isMatchingExploreCache(cached, choice), true);

  // Different category
  assert.equal(
    isMatchingExploreCache(cached, { ...choice, category: "conflicting" }),
    false
  );

  // Different phrase
  assert.equal(
    isMatchingExploreCache(cached, { ...choice, phrase: "Other phrase" }),
    false
  );

  // Non-array records
  assert.equal(
    isMatchingExploreCache({ ...cached, records: null as unknown as [] }, choice),
    false
  );

  // Nulls
  assert.equal(isMatchingExploreCache(null, choice), false);
  assert.equal(isMatchingExploreCache(cached, null), false);
});

test("SES-4. resetSession purges both active keys and legacy keys from storage", () => {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  };

  (globalThis as unknown as { window: { sessionStorage: typeof mockStorage } }).window = {
    sessionStorage: mockStorage
  };

  // Populate active and legacy keys
  store.set(KEYS.picoWords, JSON.stringify(["p1"]));
  store.set(KEYS.choice, JSON.stringify({ category: "established", phrase: "p" }));
  store.set("cq_mode", "pubmed");
  store.set("cq_outcomes", '["test"]');
  store.set("cq_gap", '{"data":1}');

  assert.equal(store.size, 5);

  resetSession();

  assert.equal(store.size, 0, "resetSession must clear all keys from storage");
  assert.equal(store.get("cq_mode"), undefined, "Legacy cq_mode must be purged");
  assert.equal(store.get("cq_outcomes"), undefined, "Legacy cq_outcomes must be purged");

  // Clean up mock
  delete (globalThis as unknown as { window?: unknown }).window;
});
