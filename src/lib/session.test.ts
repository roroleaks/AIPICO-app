import test from "node:test";
import assert from "node:assert/strict";
import { isMatchingGapCache, KEYS } from "./session.ts";

test("SES-1. isMatchingGapCache identifies valid matching cache snapshot", () => {
  const cached = {
    inputText: "poor responders, ivf, growth hormone, live birth rate",
    known: [{ point: "Test established theme", references: [] }],
    uncertain: []
  };

  assert.equal(
    isMatchingGapCache(cached, "poor responders, ivf, growth hormone, live birth rate"),
    true
  );
  assert.equal(
    isMatchingGapCache(cached, "unexplained infertility, rct"),
    false,
    "Stale cache with different input text must not match"
  );
  assert.equal(
    isMatchingGapCache(null, "poor responders"),
    false
  );
  assert.equal(
    isMatchingGapCache({ inputText: "poor responders", known: [], uncertain: [] }, "poor responders"),
    false,
    "Empty snapshot without known or uncertain points must not match"
  );
});

test("SES-2. KEYS catalog contains defined session keys", () => {
  assert.equal(KEYS.gap, "cq_gap");
  assert.equal(KEYS.inputText, "cq_input_text");
});
