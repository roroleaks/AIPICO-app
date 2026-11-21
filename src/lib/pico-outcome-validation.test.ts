import test from "node:test";
import assert from "node:assert/strict";
import {
  parseClinicalScenario,
  extractPicoSlots,
  formulateOutcomeVerbPhrase,
  resolveKnownOutcome,
  dedupeOutcomes
} from "./clinical-semantics.ts";

test("Regression 1: parseClinicalScenario normalizes misspelled intervention and excludes it from outcome slots", () => {
  const scenario = parseClinicalScenario("poor ovarian response, growth hormone, co enzyem q 10");
  assert.equal(scenario.population, "poor ovarian response");
  assert.equal(scenario.intervention, "growth hormone");
  assert.ok(
    scenario.comparisonOptions?.some(opt => opt.intervention.includes("coenzyme Q10") || opt.comparator.includes("coenzyme Q10")),
    "Should include normalized coenzyme Q10 in comparison options"
  );
  assert.ok(scenario.picoSlots, "Scenario must contain picoSlots");
  assert.ok(scenario.picoSlots.population.includes("poor ovarian response"), "P must contain poor ovarian response");
  assert.ok(scenario.picoSlots.interventions.includes("growth hormone"), "I must contain growth hormone");
  assert.ok(scenario.picoSlots.interventions.includes("coenzyme Q10"), "I must contain normalized coenzyme Q10");
  assert.ok(
    scenario.picoSlots.comparators.some(c => c.includes("no growth hormone")),
    "Comparators should include implied per-adjuvant standard protocol"
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

test("Regression 2: Prose input with comparative cue correctly separates I, C, O, P", () => {
  const slots = extractPicoSlots("growth hormone versus letrozole for live birth rate in poor ovarian response");
  assert.deepEqual(slots.interventions, ["growth hormone"]);
  assert.deepEqual(slots.comparators, ["letrozole"]);
  assert.deepEqual(slots.outcomes, ["live birth rate"]);
  assert.deepEqual(slots.population, ["poor ovarian response"]);
  assert.ok(slots.cues.comparative.includes("versus"), "Must detect comparative cue 'versus'");
});

test("Regression 3: Multi-adjuvant input recognizes both interventions and avoids auto head-to-head comparator", () => {
  const slots = extractPicoSlots("growth hormone and coenzyme q10");
  assert.ok(slots.interventions.includes("growth hormone"));
  assert.ok(slots.interventions.includes("coenzyme Q10"));
  assert.ok(slots.comparators.some(c => c.includes("no growth hormone")));
  assert.ok(slots.comparators.some(c => c.includes("no coenzyme Q10")));
  assert.ok(!slots.comparators.includes("coenzyme Q10"), "Second adjuvant must not be auto head-to-head comparator");
});

test("Regression 5: Unresolvable input lands in unresolved without being slotted and raises clarification", () => {
  const slots = extractPicoSlots("poor ovarian response, growth hormone, xyzzy foo");
  assert.ok(slots.unresolved.includes("xyzzy foo"), "Unresolvable phrase must be in unresolved slot");
  assert.ok(!slots.outcomes.includes("xyzzy foo"), "Unresolvable phrase must not land in outcomes");
  assert.ok(!slots.interventions.includes("xyzzy foo"), "Unresolvable phrase must not land in interventions");

  const scenario = parseClinicalScenario("poor ovarian response, growth hormone, xyzzy foo");
  assert.equal(scenario.clarificationRequired, true, "Clarification must be required");
  assert.ok(scenario.clarificationPrompt?.includes("xyzzy foo"), "Prompt must mention unresolvable phrase");
  assert.ok(!scenario.outcomes.includes("xyzzy foo"), "Scenario outcomes must not contain unresolvable phrase");
});

test("Regression 6: Prose input without commas preserves stated interventions without KB-default substitution", () => {
  const scenario = parseClinicalScenario("poor ovarian response growth hormone coenzyme q10");
  assert.equal(scenario.population, "poor ovarian response");
  assert.equal(scenario.intervention, "growth hormone");
  assert.ok(!scenario.intervention.toLowerCase().includes("letrozole"), "Must not substitute letrozole");
  assert.ok(!scenario.comparator.toLowerCase().includes("clomiphene"), "Must not substitute clomiphene");
});

test("Regression 7: Outcome deduplication removes near-duplicate outcomes with Jaccard overlap > 0.7", () => {
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

test("Regression 9: formulateOutcomeVerbPhrase rejects non-outcomes and validates directionality", () => {
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

test("Regression 12: Demographic qualifiers in clinical scenario are captured in population cues", () => {
  const slots = extractPicoSlots("pregnant women with short cervix vaginal progesterone versus cerclage preterm birth");
  assert.deepEqual(slots.population, ["short cervix"]);
  assert.ok(
    slots.cues.population?.some(p => p.includes("pregnant women")),
    "Demographic qualifier must be preserved in population cues"
  );
});
