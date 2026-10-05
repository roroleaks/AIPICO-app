import test from "node:test";
import assert from "node:assert/strict";
import { generateDeterministicGapAnalysis } from "./deterministic-gap.ts";

test("deterministic gap analysis generates exactly 4 points for each category", () => {
  const result = generateDeterministicGapAnalysis("cervical cerclage twin pregnancy preterm birth");

  assert.equal(result.known.length, 4, "Must have exactly 4 known points");
  assert.equal(result.uncertain.length, 4, "Must have exactly 4 uncertain points");
  assert.equal(result.gaps.length, 4, "Must have exactly 4 gaps");
  assert.equal(result.suggestedQuestions.length, 4, "Must have exactly 4 suggested PICO questions");

  for (const k of result.known) {
    assert.ok(k.point.length > 10, "Known point must not be empty");
    assert.ok(typeof k.searchQuery === "string" && k.searchQuery.length > 0, "Known point must have a searchQuery");
  }

  for (const u of result.uncertain) {
    assert.ok(u.point.length > 10, "Uncertain point must not be empty");
    assert.ok(typeof u.searchQuery === "string" && u.searchQuery.length > 0, "Uncertain point must have a searchQuery");
  }

  for (const g of result.gaps) {
    assert.ok(g.gap.length > 10, "Gap must not be empty");
    assert.ok(g.why.length > 10, "Why must not be empty");
  }

  for (const q of result.suggestedQuestions) {
    assert.ok(q.question.includes("(P)") || q.question.includes("In women"), "Must be PICO formatted");
    assert.ok(q.rationale.length > 5, "Rationale must not be empty");
  }
});

test("deterministic gap analysis handles empty input gracefully without throwing", () => {
  const result = generateDeterministicGapAnalysis("");

  assert.equal(result.known.length, 4);
  assert.equal(result.uncertain.length, 4);
  assert.equal(result.gaps.length, 4);
  assert.equal(result.suggestedQuestions.length, 4);
});
