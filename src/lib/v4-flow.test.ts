import test from "node:test";
import assert from "node:assert/strict";
import { assignPicoRoles, type PicoWord } from "./pico-roles.ts";
import { generateDeterministicScreen } from "./deterministic-screen.ts";
import { scoreRecords } from "./explore-scoring.ts";
import { buildSummaryPayload } from "./summary-payload.ts";
import type { AuditableRef } from "./relevance.ts";

test("V4-FLOW. Complete 4-step pure pipeline execution", () => {
  // Step 1: Assign PICO roles
  const inputWords = ["poor responders", "ivf", "growth hormone", "clinical pregnancy rate"];
  const picoWords: PicoWord[] = assignPicoRoles(inputWords);

  assert.equal(picoWords.length, 4);
  assert.equal(picoWords[0].role, "population");
  assert.equal(picoWords[1].role, "intervention");
  assert.equal(picoWords[2].role, "intervention");
  assert.equal(picoWords[3].role, "outcome");

  // Step 2: Deterministic literature screening
  const fixtureCorpus = [
    {
      pmid: "30000001",
      title: "Growth hormone co-treatment in IVF for poor responders: a randomized trial",
      authors: "Smith J, Doe A",
      journal: "Hum Reprod",
      year: "2023",
      context: "Growth hormone addition showed conflicting evidence for clinical pregnancy rate in poor responders."
    },
    {
      pmid: "30000002",
      title: "Adjuvant growth hormone in poor ovarian response",
      authors: "Lee K, Chen M",
      journal: "Fertil Steril",
      year: "2022",
      context: "No significant difference in clinical pregnancy rate observed between groups."
    }
  ];

  const screenResult = generateDeterministicScreen(picoWords, fixtureCorpus, 0, 2);
  assert.ok(screenResult.phrases.established.phrase.length > 10);
  assert.ok(screenResult.phrases.conflicting.phrase.length > 10);
  assert.ok(screenResult.phrases.gap.phrase.length > 10);

  // Pairwise distinct phrases
  assert.notEqual(screenResult.phrases.established.phrase, screenResult.phrases.conflicting.phrase);
  assert.notEqual(screenResult.phrases.conflicting.phrase, screenResult.phrases.gap.phrase);
  assert.notEqual(screenResult.phrases.established.phrase, screenResult.phrases.gap.phrase);

  // Step 3: Evidence exploration with deterministic scoring and exclusion
  const chosenPhrase = screenResult.phrases.conflicting.phrase;
  const rawRecords: AuditableRef[] = [
    {
      pmid: "30000001",
      title: "Growth hormone co-treatment in IVF for poor responders: a randomized trial",
      authors: "Smith J, Doe A",
      journal: "Hum Reprod",
      year: "2023"
    },
    {
      pmid: "30000002",
      title: "Adjuvant growth hormone in poor ovarian response",
      authors: "Lee K, Chen M",
      journal: "Fertil Steril",
      year: "2022"
    },
    {
      pmid: "30000003",
      title: "Unrelated oncology report",
      authors: "Brown T",
      journal: "Lancet Oncol",
      year: "2021"
    }
  ];

  // Block the second record via user exclusion
  const blockedKeys = ["p:30000002"];
  const scoredOutput = scoreRecords(rawRecords, chosenPhrase, "conflicting", blockedKeys);

  assert.equal(scoredOutput.removedByBlock, 1, "Blocked record must be filtered out");
  assert.equal(scoredOutput.scored.length, 2, "Two non-blocked records must survive");

  const topScored = scoredOutput.scored[0];
  assert.ok(topScored.relevancePct >= 0 && topScored.relevancePct <= 100);
  assert.equal(topScored.pmid, "30000001");

  // Step 4: Summary payload builder consolidation
  const exploreSnapshot = {
    records: scoredOutput.scored,
    corpusStats: {
      retrieved: 2,
      screened: 2,
      blocked: 1,
      returned: 2
    },
    hasMore: false,
    phrase: chosenPhrase,
    category: "conflicting"
  };

  const choiceState = {
    category: "conflicting" as const,
    phrase: chosenPhrase
  };

  const excludedState = {
    phrase: chosenPhrase,
    category: "conflicting",
    userExcluded: ["p:30000002"],
    seen: ["p:30000001"]
  };

  const summaryPayload = buildSummaryPayload(
    picoWords,
    choiceState,
    screenResult,
    exploreSnapshot,
    excludedState
  );

  assert.equal(summaryPayload.words.length, 4);
  assert.equal(summaryPayload.words[0].word, "poor responders");
  assert.equal(summaryPayload.words[0].role, "population");
  assert.equal(summaryPayload.category, "conflicting");
  assert.equal(summaryPayload.phrase, chosenPhrase);
  assert.equal(summaryPayload.screeningStats.retrieved, 2);
  assert.equal(summaryPayload.screeningStats.screened, 2);
  assert.equal(summaryPayload.screeningStats.excludedCount, 1);

  assert.ok(summaryPayload.papers.length >= 1, "Must contain at least 1 paper");
  assert.equal(summaryPayload.papers[0].rank, 1);
  assert.equal(summaryPayload.papers[0].relevancePct, topScored.relevancePct);
  assert.equal(summaryPayload.papers[0].title, topScored.title);
});
