import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidates,
  checkQueryScope,
  checkQueryVagueness,
  type ClinicalSearchInput
} from "./pubmed-query.ts";

test("RS1. Query candidate ladder includes NLM human filter and excludes single-arm outcome fallback", () => {
  const c010Input: ClinicalSearchInput = {
    population: "thin endometrium",
    intervention: "PRP intrauterine",
    comparator: "control",
    outcome: "pregnancy rate"
  };

  const candidates = buildCandidates(c010Input);
  assert.ok(candidates.length > 0, "Must produce candidate queries");

  // Every generated candidate must contain the NLM human subject filter
  for (const c of candidates) {
    assert.ok(
      c.includes("NOT (animals[mh] NOT humans[mh])"),
      `Candidate query must include NLM human filter: ${c}`
    );
  }

  // No candidate query may consist solely of the outcome clause
  for (const c of candidates) {
    const isOutcomeOnly = c.startsWith("(\"pregnancy rate\"[tiab]") &&
      !c.includes("thin endometrium") &&
      !c.includes("PRP intrauterine");
    assert.ok(
      !isOutcomeOnly,
      `Candidate query must not fall back to outcome alone: ${c}`
    );
  }
});

test("RS2. Specialty scope validation accepts OB/GYN queries and rejects out-of-scope non-OB/GYN queries", () => {
  // 5 Out-of-scope queries (Group 2 from design doc)
  const outOfScopeCases: { id: string; input: ClinicalSearchInput }[] = [
    {
      id: "NON-01",
      input: { population: "acute ST-elevation MI", intervention: "primary PCI", outcome: "30-day mortality" }
    },
    {
      id: "NON-02",
      input: { population: "acute ischemic stroke", intervention: "tenecteplase", outcome: "modified rankin scale" }
    },
    {
      id: "NON-03",
      input: { population: "knee osteoarthritis", intervention: "hyaluronic acid injection", outcome: "pain score" }
    },
    {
      id: "NON-04",
      input: { population: "ulcerative colitis", intervention: "vedolizumab", outcome: "mucosal healing" }
    },
    {
      id: "NON-05",
      input: { population: "plaque psoriasis", intervention: "secukinumab", outcome: "PASI-90 response rate" }
    }
  ];

  for (const tc of outOfScopeCases) {
    const scope = checkQueryScope(tc.input);
    assert.equal(
      scope.inScope,
      false,
      `Case ${tc.id} (${JSON.stringify(tc.input)}) must be flagged out-of-scope`
    );
  }

  // 10 In-scope OB/GYN queries (Group 1 from design doc)
  const inScopeCases: { id: string; input: ClinicalSearchInput }[] = [
    { id: "OB-01", input: { population: "short cervix", intervention: "vaginal progesterone", outcome: "preterm birth" } },
    { id: "OB-02", input: { population: "prior preterm birth", intervention: "cervical cerclage", outcome: "gestational age" } },
    { id: "OB-03", input: { population: "thin endometrium", intervention: "intrauterine PRP", outcome: "clinical pregnancy rate" } },
    { id: "OB-04", input: { population: "severe preeclampsia", intervention: "magnesium sulfate", outcome: "eclamptic seizure" } },
    { id: "OB-05", input: { population: "labor induction", intervention: "oral misoprostol", outcome: "vaginal delivery" } },
    { id: "OB-06", input: { population: "recurrent pregnancy loss", intervention: "low-dose aspirin", outcome: "live birth rate" } },
    { id: "OB-07", input: { population: "polycystic ovary syndrome", intervention: "letrozole", outcome: "ovulation" } },
    { id: "OB-08", input: { population: "diminished ovarian reserve", intervention: "DHEA supplementation", outcome: "oocyte yield" } },
    { id: "OB-09", input: { population: "endometrioma", intervention: "laparoscopic cystectomy", outcome: "ovarian reserve" } },
    { id: "OB-10", input: { population: "peripartum cardiomyopathy", intervention: "bromocriptine", outcome: "ventricular recovery" } }
  ];

  for (const tc of inScopeCases) {
    const scope = checkQueryScope(tc.input);
    assert.equal(
      scope.inScope,
      true,
      `Case ${tc.id} (${JSON.stringify(tc.input)}) must be recognized as in-scope OB/GYN`
    );
  }
});

test("RS3. Vague queries with only generic clinical stop-words are flagged for clarification", () => {
  // 5 Vague queries (Group 3 from design doc)
  const vagueCases: { id: string; input: ClinicalSearchInput }[] = [
    { id: "VAG-01", input: { population: "women", intervention: "treatment", comparator: "better", outcome: "outcome" } },
    { id: "VAG-02", input: { population: "patients", intervention: "medicine", comparator: "control", outcome: "cure" } },
    { id: "VAG-03", input: { population: "pain", intervention: "drugs", comparator: "placebo", outcome: "relief" } },
    { id: "VAG-04", input: { population: "pregnancy", intervention: "care", comparator: "standard", outcome: "good" } },
    { id: "VAG-05", input: { population: "bleeding", intervention: "pill", comparator: "none", outcome: "stops" } }
  ];

  for (const tc of vagueCases) {
    const vagueness = checkQueryVagueness(tc.input);
    assert.equal(
      vagueness.isVague,
      true,
      `Case ${tc.id} (${JSON.stringify(tc.input)}) must be flagged as vague`
    );
  }

  // Clear clinical query must NOT be flagged as vague
  const specificInput: ClinicalSearchInput = {
    population: "cervical insufficiency",
    intervention: "progesterone",
    outcome: "preterm birth"
  };
  const specificVagueness = checkQueryVagueness(specificInput);
  assert.equal(specificVagueness.isVague, false, "Specific OB/GYN query must not be flagged as vague");
});
