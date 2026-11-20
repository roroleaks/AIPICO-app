import test from "node:test";
import assert from "node:assert/strict";
import { parseClinicalScenario, formulateOutcomeVerbPhrase, resolveKnownOutcome, dedupeOutcomes } from "./clinical-semantics.ts";
import { ruleFormulate } from "./rule-engine.ts";
import type { Analysis } from "./kb.ts";

test("Regression 1: parseClinicalScenario normalizes misspelled intervention and excludes it from outcome slots", () => {
  const scenario = parseClinicalScenario("poor ovarian response, growth hormone, co enzyem q 10");
  assert.equal(scenario.intervention, "growth hormone");
  assert.ok(
    scenario.comparisonOptions?.some(opt => opt.intervention.includes("coenzyme Q10") || opt.comparator.includes("coenzyme Q10")),
    "Should include normalized coenzyme Q10 in comparison options"
  );
  for (const sq of scenario.suggestedQuestions) {
    assert.ok(!sq.question.includes("co enzyem q 10"), `Must not contain typo: ${sq.question}`);
    assert.ok(!sq.question.includes("growth hormone (O)"), `Must not have growth hormone in (O): ${sq.question}`);
    assert.ok(!sq.question.includes("coenzyme Q10 (O)"), `Must not have coenzyme Q10 in (O): ${sq.question}`);
    const oMatch = sq.question.match(/(?:\(C\)[^]*?)(?:improve|increase|reduce|shorten|optimize)\s+(?:the\s+)?([^(]+?)\s*\(O\)/i);
    assert.ok(oMatch && oMatch[1], `Question must have an (O) slot: ${sq.question}`);
    const oToken = oMatch[1].trim();
    assert.ok(!/coenzyme|growth hormone/i.test(oToken), `(O) slot must not contain an intervention: ${oToken}`);
    const resolved = resolveKnownOutcome(oToken);
    assert.ok(resolved && resolved.valid, `(O) slot token must resolve to a valid outcome: ${oToken}`);
  }
});

test("Regression 2: Prose input without commas preserves stated interventions without KB-default substitution", () => {
  const scenario = parseClinicalScenario("poor ovarian response growth hormone coenzyme q10");
  assert.equal(scenario.population, "poor ovarian response");
  assert.equal(scenario.intervention, "growth hormone");
  assert.ok(!scenario.intervention.toLowerCase().includes("letrozole"), "Must not substitute letrozole");
  assert.ok(!scenario.comparator.toLowerCase().includes("clomiphene"), "Must not substitute clomiphene");
});

test("Regression 3: formulateOutcomeVerbPhrase rejects non-outcomes and validates directionality", () => {
  const invalidResult = formulateOutcomeVerbPhrase("secondary", "co enzyem q 10");
  assert.equal(invalidResult, null, "Must return null for unresolvable or intervention token");

  const validResult = formulateOutcomeVerbPhrase("primary", "live birth rate");
  assert.equal(validResult, "improve the live birth rate", "Desirable outcome must use improve");

  const adverseResult = formulateOutcomeVerbPhrase("secondary", "ovarian hyperstimulation syndrome");
  assert.ok(
    adverseResult && adverseResult.includes("ovarian hyperstimulation syndrome") && (adverseResult.includes("reduce") || adverseResult.includes("decrease") || adverseResult.includes("lower")),
    "Adverse outcome must use direction-appropriate reducing verb"
  );
});

test("Regression 4: formulate stage with complete gap analysis contains actual condition and intervention without placeholders", () => {
  const analysis: Partial<Analysis> = {
    condition: "poor ovarian response",
    intervention: "growth hormone",
    specialty: "infertility",
    framework: "PICO"
  };
  const formulation = ruleFormulate(analysis as Analysis, {});
  assert.equal(formulation.complete, true);
  assert.ok(formulation.finalQuestion.includes("poor ovarian response"));
  assert.ok(formulation.finalQuestion.includes("growth hormone"));
  assert.ok(!formulation.finalQuestion.includes("high-risk clinical population"), "Must not contain high-risk clinical population placeholder");
  assert.ok(!formulation.finalQuestion.includes("a clinically meaningful outcome"), "Must not contain clinically meaningful outcome placeholder");
});

test("Regression 5: Two-adjuvant input defaults comparator to standard protocol and provides clarification prompt", () => {
  const scenario = parseClinicalScenario("poor ovarian response, growth hormone, coenzyme q10");
  assert.notEqual(scenario.comparator, "coenzyme Q10", "Comparator must not be silently assigned the second adjuvant without choice");
  assert.equal(scenario.comparator, "no growth hormone (standard protocol)");
  assert.equal(scenario.clarificationRequired, true);
  assert.ok(scenario.clarificationPrompt && scenario.clarificationPrompt.length > 0);
  assert.ok(scenario.comparisonOptions && scenario.comparisonOptions.length >= 3);
});

test("Regression 6: Outcome deduplication removes near-duplicate outcomes with Jaccard overlap > 0.7", () => {
  const rawList = ["cumulative live birth rate", "live birth rate", "clinical pregnancy rate", "miscarriage rate"];
  const deduped = dedupeOutcomes(rawList);
  assert.ok(
    deduped.includes("cumulative live birth rate"),
    "Should retain more specific outcome"
  );
  assert.ok(
    !deduped.includes("live birth rate"),
    "Should deduplicate live birth rate when cumulative live birth rate is present"
  );
  assert.ok(deduped.length < rawList.length, "Deduped list must have fewer items than raw list");
});
