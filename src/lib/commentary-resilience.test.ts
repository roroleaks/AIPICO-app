import test from "node:test";
import assert from "node:assert/strict";
import { generateDeterministicCommentary } from "./deterministic-commentary.ts";
import { validateDeliverableIntegrity } from "./deliverable-integrity.ts";
import { reconcileNarrative, type AuditableRef, type PicoElement } from "./relevance.ts";
import { buildEvidenceSet } from "./evidence-set.ts";

const MOCK_ELEMENTS: PicoElement[] = [
  { label: "Population", value: "women with short cervical length" },
  { label: "Intervention", value: "vaginal progesterone" },
  { label: "Comparator", value: "placebo" },
  { label: "Outcome", value: "spontaneous preterm birth" }
];

const MOCK_REFS: AuditableRef[] = [
  {
    pmid: "30514603",
    title: "Vaginal progesterone vs cervical cerclage for preterm birth in women with a short cervix",
    authors: "Romero R, Conde-Agudelo A",
    year: "2018",
    journal: "Am J Obstet Gynecol",
    url: "https://pubmed.ncbi.nlm.nih.gov/30514603/"
  },
  {
    pmid: "26531775",
    title: "Vaginal progesterone to decrease preterm birth in women with a short cervix",
    authors: "Agustin Conde A, Romero R",
    year: "2015",
    journal: "Am J Obstet Gynecol",
    url: "https://pubmed.ncbi.nlm.nih.gov/26531775/"
  }
];

test("CR1. Deterministic commentary generates valid deliverable from clinical elements", async () => {
  const comm = generateDeterministicCommentary({
    selectedQuestion: "In women with short cervical length, does vaginal progesterone reduce spontaneous preterm birth?",
    outcomesText: "spontaneous preterm birth",
    reason: "clinician requested deterministic synthesis",
    pool: MOCK_REFS,
    elements: MOCK_ELEMENTS
  }) as {
    title: string;
    abstract: string;
    introduction: string;
    discussion: string;
    conclusion: string;
    references: string[];
  };

  assert.ok(comm.title.length > 0);
  assert.ok(comm.abstract.length > 0);
  assert.ok(comm.references.length > 0);

  const integrity = validateDeliverableIntegrity({
    fields: {
      abstract: comm.abstract,
      introduction: comm.introduction,
      discussion: comm.discussion,
      conclusion: comm.conclusion
    },
    references: comm.references,
    retainedRecords: MOCK_REFS
  });

  assert.equal(integrity.ok, true, "Deterministic deliverable passes deliverable integrity");
});

test("CR2. Deterministic commentary handles empty pool gracefully with valid integrity", () => {
  const comm = generateDeterministicCommentary({
    selectedQuestion: "In women with unexplained symptoms, what is the optimal management?",
    outcomesText: "clinical resolution",
    reason: "Offline deterministic synthesis fallback",
    pool: [],
    elements: []
  }) as {
    title: string;
    abstract: string;
    introduction: string;
    discussion: string;
    conclusion: string;
    references: string[];
  };

  assert.ok(comm.title.length > 0);
  assert.equal(comm.references.length, 0);

  const integrity = validateDeliverableIntegrity({
    fields: {
      abstract: comm.abstract,
      introduction: comm.introduction,
      discussion: comm.discussion,
      conclusion: comm.conclusion
    },
    references: comm.references,
    retainedRecords: []
  });

  assert.equal(integrity.ok, true, "Empty pool commentary passes integrity without errors");
});

test("CR3. Recovery pathway transforms malformed draft into clean deliverable", async () => {
  const evidenceSet = await buildEvidenceSet(MOCK_REFS);
  
  // Simulated malformed draft with hallucinated citation [99] and unsupported author
  const malformedDraft = {
    abstract: "Clinical review of preterm birth [1]. Unsupported claim (UnknownAuthor 2099) with [99].",
    introduction: "Progesterone mechanism [2].",
    discussion: "Discussion of findings [1, 2].",
    conclusion: "Clinical conclusion [1]."
  };

  // Reconcile narrative strips unsupported citations
  const reconciled = reconcileNarrative(
    malformedDraft,
    [
      "1. Romero R, Conde-Agudelo A. Vaginal progesterone. Am J Obstet Gynecol. 2018. https://pubmed.ncbi.nlm.nih.gov/30514603/",
      "2. Agustin Conde A, Romero R. Vaginal progesterone. Am J Obstet Gynecol. 2015. https://pubmed.ncbi.nlm.nih.gov/26531775/"
    ],
    evidenceSet.allowedCitationKeys,
    evidenceSet.citationMap
  );

  const integrity = validateDeliverableIntegrity({
    fields: reconciled.fields,
    references: reconciled.references,
    retainedRecords: MOCK_REFS,
    allowedKeys: evidenceSet.allowedCitationKeys,
    citationMap: evidenceSet.citationMap
  });

  assert.equal(integrity.ok, true, "Reconciled deliverable passes deliverable integrity");
});
