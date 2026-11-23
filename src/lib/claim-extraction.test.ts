import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractRecordClaim,
  extractSampleSize,
  classifyClaimsForPico,
  type ExtractedClaim
} from "./claim-extraction.ts";
import type { AuditableRef } from "./relevance.ts";

test("CLM-1: Illingworth fixture extracts RCT, n=1066, clinical pregnancy, no_difference", () => {
  const illingworthRef: AuditableRef = {
    title: "A double-blind randomized controlled trial of artificial intelligence for embryo selection in in vitro fertilization",
    context: "In a double-blind randomized controlled trial involving 1,066 patients undergoing in vitro fertilization, embryos were selected using an artificial intelligence algorithm or conventional morphological assessment. Clinical pregnancy rate per transfer was 38.2% in the AI group compared with 38.5% in the control group. There was no statistically significant difference in clinical pregnancy rate between the two groups (RR 0.99, 95% CI 0.85-1.16).",
    journal: "Nat Med",
    year: "2024",
    pmid: "39122964",
    evidenceType: "rct"
  };

  const claim = extractRecordClaim(illingworthRef, ["clinical pregnancy", "live birth"]);

  assert.equal(claim.key, "p:39122964");
  assert.equal(claim.evidenceType, "rct");
  assert.equal(claim.n, 1066);
  assert.ok(claim.outcomesMentioned.includes("clinical pregnancy"));
  assert.equal(claim.effectDirection, "no_difference");
  assert.equal(claim.evidenceRole, "clinical_efficacy");
  assert.equal(claim.basis, "abstract");
  assert.ok(claim.effectText.toLowerCase().includes("no statistically significant difference"));
});

test("CLM-2: Yaghi fixture extracts meta-analysis, CPR no_difference, live birth not reported in pooled data", () => {
  const yaghiRef: AuditableRef = {
    title: "Artificial intelligence for embryo selection in assisted reproduction: a systematic review and meta-analysis",
    context: "This systematic review and meta-analysis evaluated artificial intelligence algorithms for embryo selection compared with conventional morphology in assisted reproduction. In pooled analysis of clinical pregnancy rate (CPR), AI embryo selection showed comparable clinical pregnancy rates to conventional grading with no significant difference. Live birth rate was rarely reported and could not be meta-analyzed due to lack of randomized trials.",
    journal: "Hum Reprod Update",
    year: "2026",
    pmid: "42914619",
    evidenceType: "meta_analysis"
  };

  const claim = extractRecordClaim(yaghiRef, ["clinical pregnancy", "live birth"]);

  assert.equal(claim.key, "p:42914619");
  assert.equal(claim.evidenceType, "meta_analysis");
  assert.ok(claim.outcomesMentioned.includes("clinical pregnancy"));
  assert.equal(claim.effectDirection, "no_difference");
  assert.equal(claim.evidenceRole, "clinical_efficacy");
});

test("CLM-3: AUC/prediction model without clinical endpoints tagged technical_performance", () => {
  const aucRef: AuditableRef = {
    title: "Deep learning predicts blastocyst quality from time-lapse imaging",
    context: "We developed a deep convolutional neural network for blastocyst quality assessment. The prediction model achieved an AUC of 0.88 and 82% accuracy in predicting blastocyst grade on external test sets. Receiver operating characteristic curves demonstrated high concordance.",
    journal: "Fertil Steril",
    year: "2023",
    pmid: "37000001",
    evidenceType: "cohort"
  };

  const claim = extractRecordClaim(aucRef, ["live birth", "clinical pregnancy"]);

  assert.equal(claim.evidenceRole, "technical_performance");
  assert.equal(claim.outcomesMentioned.length, 0);
});

test("CLM-4: AI-embryo fixture set classifies ESTABLISHED as no difference, CONFLICTING as none, GAP for live birth", () => {
  const illingworthRef: AuditableRef = {
    title: "Double-blind randomized controlled trial of artificial intelligence embryo selection",
    context: "In a randomized controlled trial of 1,066 patients, clinical pregnancy rate was comparable between AI and conventional morphology with no significant difference (RR 0.99, 95% CI 0.85-1.16).",
    journal: "Nat Med",
    year: "2024",
    pmid: "39122964",
    evidenceType: "rct"
  };

  const yaghiRef: AuditableRef = {
    title: "Artificial intelligence for embryo selection: systematic review and meta-analysis",
    context: "In pooled meta-analysis of clinical pregnancy rate, AI embryo selection showed no statistically significant difference compared with conventional morphology.",
    journal: "Hum Reprod",
    year: "2026",
    pmid: "42914619",
    evidenceType: "meta_analysis"
  };

  const aucRef: AuditableRef = {
    title: "Computer vision blastocyst prediction model",
    context: "The deep learning model achieved an AUC of 0.89 and high sensitivity for blastocyst viability.",
    journal: "Comput Biol Med",
    year: "2023",
    pmid: "36000002",
    evidenceType: "cohort"
  };

  const records = [illingworthRef, yaghiRef, aucRef];
  const claims: ExtractedClaim[] = [
    extractRecordClaim(illingworthRef, ["clinical pregnancy", "live birth"]),
    extractRecordClaim(yaghiRef, ["clinical pregnancy", "live birth"]),
    extractRecordClaim(aucRef, ["clinical pregnancy", "live birth"])
  ];

  const result = classifyClaimsForPico(records, claims, {
    P: "IVF patients",
    I: "artificial intelligence embryo selection",
    C: "conventional morphology",
    O: "live birth"
  });

  // ESTABLISHED: based on nearest reported high-level evidence (clinical pregnancy), asserts no significant difference
  assert.equal(result.established.category, "established");
  assert.equal(result.established.signalStrength, "moderate");
  assert.ok(result.established.phrase.includes("no significant difference"));
  assert.ok(result.established.supportingRecordKeys.includes("p:42914619"));

  // CONFLICTING: none detected because both high-level studies found no difference
  assert.equal(result.conflicting.category, "conflicting");
  assert.equal(result.conflicting.signalStrength, "none");
  assert.ok(result.conflicting.phrase.includes("No conflicting results detected"));

  // GAP: live birth was not reported in any screened abstract, only technical/cpr
  assert.equal(result.gap.category, "gap");
  assert.equal(result.gap.signalStrength, "weak");
  assert.ok(result.gap.rule === "outcome_not_reported_in_abstracts" || result.gap.rule === "only_non_randomised_evidence");
  assert.ok(result.gap.basis.includes("live birth"));
});

test("CLM-5: Fixture with one positive cohort and one null RCT fires CONFLICTING and cites both", () => {
  const positiveCohort: AuditableRef = {
    title: "Cohort study of AI embryo selection in blastocyst transfer",
    context: "Among 450 women undergoing IVF, AI embryo selection was associated with significantly higher clinical pregnancy rates compared with morphology controls (52% vs 41%, p < 0.05).",
    journal: "Reprod Biomed Online",
    year: "2023",
    pmid: "37111111",
    evidenceType: "cohort"
  };

  const nullRct: AuditableRef = {
    title: "Randomized controlled trial of AI embryo ranking",
    context: "In a randomized controlled trial of 600 cycles, there was no significant difference in clinical pregnancy rate between AI ranking and conventional morphology controls.",
    journal: "Hum Reprod",
    year: "2024",
    pmid: "38222222",
    evidenceType: "rct"
  };

  const records = [positiveCohort, nullRct];
  const claims = [
    extractRecordClaim(positiveCohort, ["clinical pregnancy"]),
    extractRecordClaim(nullRct, ["clinical pregnancy"])
  ];

  const result = classifyClaimsForPico(records, claims, {
    P: "IVF patients",
    I: "AI embryo selection",
    C: "conventional morphology",
    O: "clinical pregnancy"
  });

  assert.equal(result.conflicting.category, "conflicting");
  assert.equal(result.conflicting.signalStrength, "moderate");
  assert.equal(result.conflicting.rule, "opposing_effect_directions");
  assert.ok(result.conflicting.supportingRecordKeys.includes("p:37111111"));
  assert.ok(result.conflicting.supportingRecordKeys.includes("p:38222222"));
  assert.ok(result.conflicting.basis.includes("benefit"));
  assert.ok(result.conflicting.basis.includes("no_difference"));
});

test("CLM-6: extractSampleSize extracts diverse sample formats", () => {
  assert.equal(extractSampleSize("n = 1,066 participants were randomized"), 1066);
  assert.equal(extractSampleSize("A cohort of 450 women underwent IVF"), 450);
  assert.equal(extractSampleSize("In total of 2,340 embryos evaluated"), 2340);
  assert.equal(extractSampleSize("No numbers here"), undefined);
});
