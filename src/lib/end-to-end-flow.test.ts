import test from "node:test";
import assert from "node:assert/strict";
import { generateDeterministicGapAnalysis } from "./deterministic-gap.ts";
import { extractPicoFromQuestion } from "./pico-parser.ts";
import { buildOutcomeContext, selectOutcomes } from "./outcome-selection.ts";
import { ruleFormulate } from "./rule-engine.ts";
import { generateDeterministicCommentary } from "./deterministic-commentary.ts";
import { validateDeliverableIntegrity } from "./deliverable-integrity.ts";
import { KB, type Analysis } from "./kb.ts";
import type { AuditableRef } from "./relevance.ts";

test("End-to-End Clinical Flow: Step 1 -> Step 2 -> Step 3 -> Step 4", () => {
  // Step 1: Clinician enters 5-6 clinical tag words
  const tagWords = "preterm labor, cervical length, vaginal progesterone, cerclage, gestational age";
  assert.ok(tagWords.split(",").length >= 5, "Step 1: 5-6 tag words entered");

  // Step 2: Evidence Map displays 4 Known, 4 Uncertain, 4 Gaps, 4 PICO questions
  const gapMap = generateDeterministicGapAnalysis(tagWords);
  assert.equal(gapMap.known.length, 4, "Step 2: Exactly 4 established knowledge points");
  assert.equal(gapMap.uncertain.length, 4, "Step 2: Exactly 4 conflicting points");
  assert.equal(gapMap.gaps.length, 4, "Step 2: Exactly 4 research gaps");
  assert.equal(gapMap.suggestedQuestions.length, 4, "Step 2: Exactly 4 PICO questions");

  // Clinician clicks 1 of the 4 PICO questions
  const selectedPico = gapMap.suggestedQuestions[0].question;
  assert.ok(selectedPico.length > 20, "Step 2: Clinician selected a valid PICO question");

  // Step 3: Automatic extraction of P, I, C, O (Zero manual typing needed)
  const picoParsed = extractPicoFromQuestion(selectedPico, gapMap.topic, gapMap.specialty as any);
  assert.ok(picoParsed.condition.length > 0, "Step 3: Population/condition extracted automatically");
  assert.ok(picoParsed.intervention.length > 0, "Step 3: Intervention extracted automatically");
  assert.ok(picoParsed.comparator.length > 0, "Step 3: Comparator extracted automatically");
  assert.equal(picoParsed.specialty, "obstetrics", "Step 3: Correct clinical specialty mapped");

  // System generates 4-6 literature-derived outcome options
  const outcomeContext = buildOutcomeContext(
    {
      specialty: picoParsed.specialty,
      condition: picoParsed.condition,
      intervention: picoParsed.intervention,
      comparator: picoParsed.comparator,
      questionType: "Therapy / Prevention"
    },
    {},
    {
      originalInput: tagWords,
      population: picoParsed.condition,
      keywords: [gapMap.topic, ...gapMap.known.map(k => k.point)]
    }
  );
  const outcomeSelection = selectOutcomes(outcomeContext);
  assert.ok(outcomeSelection.options.length >= 4 && outcomeSelection.options.length <= 6, "Step 3: Exactly 4-6 literature outcomes generated");
  assert.ok(outcomeSelection.recommendedOutcome, "Step 3: Primary recommended outcome identified");

  // Clinician clicks 1 outcome
  const clickedOutcome = outcomeSelection.options[0].label;
  assert.ok(clickedOutcome.length > 0, "Step 3: Clinician clicked 1 outcome");

  // System formulates PICO with zero manual inputs
  const analysis: Analysis = {
    specialty: picoParsed.specialty,
    specialtyLabel: KB[picoParsed.specialty].label,
    condition: picoParsed.condition,
    intervention: picoParsed.intervention,
    comparator: picoParsed.comparator,
    questionType: "Therapy / Prevention",
    framework: "PICO",
    missing: [],
    interpretation: `PICO targeting ${picoParsed.condition} with ${picoParsed.intervention}`,
    source: "rules"
  };
  const answered = {
    condition: picoParsed.condition,
    intervention: picoParsed.intervention,
    comparator: picoParsed.comparator,
    outcome: clickedOutcome
  };

  const formulation = ruleFormulate(analysis, answered);
  assert.equal(formulation.complete, true, "Step 3: Formulation is 100% complete with no missing elements");
  assert.equal(formulation.missingElements.length, 0, "Step 3: Zero missing elements - no manual prompt possible");
  assert.ok(formulation.finalQuestion.length > 20, "Step 3: Final question formulated");
  assert.ok(formulation.elements.length >= 4, "Step 3: PICO elements fully populated");

  // Step 4: Full Scientific Commentary Paper generates automatically
  const mockRef: AuditableRef = {
    pmid: "30514603",
    title: "Vaginal progesterone vs cervical cerclage for the prevention of preterm birth in women with a short cervix",
    authors: "Romero R, Conde-Agudelo A",
    year: "2018",
    journal: "Am J Obstet Gynecol",
    url: "https://pubmed.ncbi.nlm.nih.gov/30514603/"
  };

  const commentary = generateDeterministicCommentary({
    selectedQuestion: formulation.finalQuestion,
    outcomesText: clickedOutcome,
    reason: "Offline deterministic synthesis test",
    pool: [mockRef],
    elements: formulation.elements
  }) as {
    title: string;
    abstract: string;
    introduction: string;
    discussion: string;
    conclusion: string;
    references: string[];
  };

  assert.ok(commentary.title.length > 0, "Step 4: Title generated");
  assert.ok(commentary.abstract.length > 0, "Step 4: Abstract generated");
  assert.ok(commentary.introduction.length > 0, "Step 4: Introduction generated");
  assert.ok(commentary.discussion.length > 0, "Step 4: Discussion generated");
  assert.ok(commentary.conclusion.length > 0, "Step 4: Conclusion generated");
  assert.ok(commentary.references.length > 0, "Step 4: Verified references generated");
});
