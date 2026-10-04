import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceSet } from "./evidence-set.ts";
import { reconcileNarrative, checkCitations } from "./relevance.ts";
import type { AuditableRef } from "./relevance.ts";

const POOL: AuditableRef[] = [
  { pmid: "1", title: "Vaginal progesterone versus cerclage", authors: "Likes M, Smith J", year: "2019", journal: "OG", doi: "10.1/a", context: "short cervix progesterone cerclage preterm birth" },
  { pmid: "2", title: "Cerclage versus progesterone", authors: "Hulshoff J", year: "2012", journal: "BJOG", doi: "10.1/b", context: "short cervix cerclage preterm birth" }
];

test("reconcile removes citations whose reference is gone and vice versa", async () => {
  const es = await buildEvidenceSet(POOL);
  const refs = ["Likes, M, J. 2019. \"Vaginal progesterone versus cerclage.\" OG. doi:10.1/a"];
  // Text cites Likes 2019 (kept) plus two authors not in the reference list at all.
  const r = reconcileNarrative(
    { discussion: "Progesterone may reduce preterm birth (Likes 2019); earlier work suggested otherwise (Hulshoff 2009; Hulshoff 2012)." },
    refs,
    es.allowedCitationKeys,
    es.citationMap
  );
  const checks = checkCitations(r.fields.discussion, r.references);
  assert.deepEqual(checks.orphans, []);
  assert.deepEqual(checks.uncited, []);
  assert.equal(checks.consistent, true);
});

test("reconcile trims a reference left uncited after citation removal", async () => {
  const es = await buildEvidenceSet(POOL);
  const refs = [
    "Likes, M, J. 2019. \"Vaginal progesterone versus cerclage.\" OG. doi:10.1/a",
    "Hulshoff, J. 2012. \"Cerclage versus progesterone.\" BJOG. doi:10.1/b"
  ];
  // Only Hulshoff is cited; the unsupported Zombie 2025 citation must be removed, which
  // leaves the Likes reference uncited, so it must also be trimmed.
  const r = reconcileNarrative(
    { discussion: "Cervical cerclage has been evaluated (Hulshoff 2012); an unrelated citation follows (Zombie 2025)." },
    refs,
    es.allowedCitationKeys,
    es.citationMap
  );
  const checks = checkCitations(r.fields.discussion, r.references);
  assert.deepEqual(checks.orphans, []);
  assert.deepEqual(checks.uncited, []);
  assert.equal(r.references.length, 1);
});

test("reconcile is deterministic across repeated runs on the same input", async () => {
  const es = await buildEvidenceSet(POOL);
  const refs = ["Likes, M, J. 2019. \"Vaginal progesterone versus cerclage.\" OG. doi:10.1/a"];
  const fields = { discussion: "Evidence is limited (Likes 2019; Kansal 2026; Hulshoff 2009)." };
  const first = reconcileNarrative(fields, refs, es.allowedCitationKeys, es.citationMap);
  for (let i = 0; i < 20; i++) {
    const again = reconcileNarrative(fields, refs, es.allowedCitationKeys, es.citationMap);
    assert.equal(again.fields.discussion, first.fields.discussion);
    assert.deepEqual(again.references, first.references);
    assert.deepEqual(again.removedCitations, first.removedCitations);
  }
});

test("reconcile reaches a fixpoint: re-running its own output changes nothing", async () => {
  const es = await buildEvidenceSet(POOL);
  const refs = [
    "Likes, M, J. 2019. \"Vaginal progesterone versus cerclage.\" OG. doi:10.1/a",
    "Hulshoff, J. 2012. \"Cerclage versus progesterone.\" BJOG. doi:10.1/b"
  ];
  // Feeding the output back in is the property that actually matters: a caller that re-runs
  // reconciliation, or a second pass over an already-reconciled document, must be a no-op
  // rather than a fresh source of drift.
  const first = reconcileNarrative(
    { discussion: "Progesterone may reduce preterm birth (Likes 2019); an unrelated citation follows (Zombie 2025)." },
    refs,
    es.allowedCitationKeys,
    es.citationMap
  );
  const second = reconcileNarrative(
    { discussion: first.fields.discussion },
    first.references,
    es.allowedCitationKeys,
    es.citationMap
  );
  assert.equal(second.fields.discussion, first.fields.discussion);
  assert.deepEqual(second.references, first.references);
  assert.deepEqual(second.removedCitations, []);
});

test("reconcile reaches orphans and uncited references across all narrative fields at once", async () => {
  const es = await buildEvidenceSet(POOL);
  const refs = [
    "Likes, M, J. 2019. \"Vaginal progesterone versus cerclage.\" OG. doi:10.1/a",
    "Hulshoff, J. 2012. \"Cerclage versus progesterone.\" BJOG. doi:10.1/b"
  ];
  // The two defects live in different fields: an unsupported citation in the introduction and a
  // reference cited only there. Handling one field at a time leaves the other inconsistent.
  const r = reconcileNarrative(
    {
      abstract: "Short cervix is a risk factor for preterm birth.",
      introduction: "Progesterone has been studied in this population (Likes 2019; Zombie 2025).",
      discussion: "The evidence base remains limited.",
      conclusion: "Shortened cervical length predicts preterm birth."
    },
    refs,
    es.allowedCitationKeys,
    es.citationMap
  );
  const joined = [r.fields.abstract, r.fields.introduction, r.fields.discussion, r.fields.conclusion].join(" ");
  const checks = checkCitations(joined, r.references);
  assert.deepEqual(checks.orphans, []);
  assert.deepEqual(checks.uncited, []);
  assert.ok(r.references.includes(refs[0]), "the reference cited in the introduction must survive");
  assert.ok(!r.fields.introduction.includes("Zombie"), "the unsupported citation must be gone from every field");
});
