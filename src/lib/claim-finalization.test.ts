import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceSet } from "./evidence-set.ts";
import { finalizeClaims, splitSentences } from "./claim-finalization.ts";
import type { AuditableRef, PicoElement } from "./relevance.ts";

const PICO: PicoElement[] = [
  { label: "Population", value: "short cervix" },
  { label: "Intervention", value: "progesterone" },
  { label: "Comparator", value: "cerclage" },
  { label: "Outcome", value: "preterm birth" }
];

const SUPPORTING: AuditableRef = {
  pmid: "1",
  title: "Vaginal progesterone versus cerclage in women with a short cervix",
  authors: "Likes M, Berghella V",
  year: "2019",
  journal: "Obstet Gynecol",
  doi: "10.1001/og.2019.0001",
  context: "short cervix progesterone cerclage preterm birth before 37 weeks"
};

const CONTRADICTING: AuditableRef = {
  pmid: "2",
  title: "Progesterone did not reduce preterm birth in women with a short cervix",
  authors: "Hulshoff J",
  year: "2012",
  journal: "BJOG",
  doi: "10.1111/bjog.2012.0002",
  context: "short cervix progesterone cerclage preterm birth no significant difference"
};

const OFF_PICO: AuditableRef = {
  pmid: "3",
  title: "Breast cancer screening trial",
  authors: "Smith J",
  year: "2020",
  journal: "JCO",
  doi: "10.1200/jco.2020.0003",
  context: "breast cancer screening"
};

test("a supported claim citing a directly relevant source is retained", async () => {
  const es = await buildEvidenceSet([SUPPORTING]);
  const res = finalizeClaims({
    fields: { discussion: "Progesterone reduced preterm birth compared with cerclage (Likes 2019)." },
    evidenceSet: es,
    elements: PICO
  });
  const claim = res.claims[0];
  assert.equal(claim.supported, true, JSON.stringify(claim));
  assert.equal(res.removedClaims.length, 0);
  assert.ok(res.fields.discussion.includes("Progesterone reduced preterm birth"));
});

test("a strong claim with a citation that resolves to nothing is rewritten as a limitation", async () => {
  const es = await buildEvidenceSet([SUPPORTING]);
  const res = finalizeClaims({
    fields: { discussion: "Progesterone is superior to cerclage for reducing preterm birth (Unknown 2020)." },
    evidenceSet: es,
    elements: PICO
  });
  assert.equal(res.claims[0].reason, "citation-not-in-evidence-set");
  assert.ok(!res.fields.discussion.includes("superior"), "the unsupported assertion is not retained");
  assert.ok(res.fields.discussion.includes("unresolved uncertainty"), "an explicit limitation replaces it");
  assert.equal(res.limitations.length, 1);
});

test("a valid citation attached to the wrong claim is not treated as support", async () => {
  const es = await buildEvidenceSet([SUPPORTING]);
  // The citation resolves to a retained record, but that record does not address the outcome
  // asserted here, so the citation cannot stand in for support.
  const res = finalizeClaims({
    fields: { discussion: "Progesterone prevents all-cause mortality (Likes 2019)." },
    evidenceSet: es,
    elements: PICO
  });
  assert.equal(res.claims[0].supported, false);
  assert.ok(["outcome-not-reported", "pico-not-addressed"].includes(res.claims[0].reason!), res.claims[0].reason);
  assert.ok(!res.fields.discussion.includes("all-cause mortality"));
});

test("a source reporting the opposite direction does not support the claim", async () => {
  const es = await buildEvidenceSet([CONTRADICTING]);
  const res = finalizeClaims({
    fields: { discussion: "Progesterone reduced preterm birth compared with cerclage (Hulshoff 2012)." },
    evidenceSet: es,
    elements: PICO
  });
  assert.equal(res.claims[0].supported, false);
  assert.ok(["direction-contradicted", "pico-not-addressed"].includes(res.claims[0].reason!), res.claims[0].reason);
  assert.ok(!res.fields.discussion.includes("Progesterone reduced preterm birth"));
});

test("an assertive sentence with no citation at all is not retained as a finding", async () => {
  const es = await buildEvidenceSet([SUPPORTING]);
  const res = finalizeClaims({
    fields: { discussion: "Progesterone should be offered to every patient with a short cervix." },
    evidenceSet: es,
    elements: PICO
  });
  assert.equal(res.claims[0].reason, "no-citation");
  assert.equal(res.removedClaims.length, 1);
  assert.ok(!res.fields.discussion.includes("should be offered to every patient"));
  assert.ok(res.fields.discussion.includes("unresolved uncertainty"));
});

test("background and method prose is retained without being called a finding", async () => {
  const es = await buildEvidenceSet([SUPPORTING, OFF_PICO]);
  const text = "Cervical length was measured by transvaginal ultrasound. We searched three databases.";
  const res = finalizeClaims({ fields: { discussion: text }, evidenceSet: es, elements: PICO });
  assert.equal(res.fields.discussion, text);
  assert.equal(res.removedClaims.length, 0);
  for (const c of res.claims) assert.equal(c.supported, false);
});

test("every narrative field is finalized, not only the discussion", async () => {
  const es = await buildEvidenceSet([SUPPORTING]);
  const res = finalizeClaims({
    fields: {
      abstract: "Progesterone reduced preterm birth (Likes 2019).",
      introduction: "Progesterone is superior for all indications (Unknown 2020).",
      discussion: "Progesterone reduced preterm birth (Likes 2019).",
      conclusion: "Progesterone should be recommended routinely."
    },
    evidenceSet: es,
    elements: PICO
  });
  assert.ok(res.fields.abstract.includes("reduced preterm birth"), "supported abstract claim survives");
  assert.ok(!res.fields.introduction.includes("superior"), "unsupported introduction claim is replaced");
  assert.ok(!res.fields.conclusion.includes("recommended routinely"), "uncited conclusion claim is replaced");
  assert.equal(res.removedClaims.length, 2);
  assert.ok(res.claims.every(c => c.field.length > 0), "every claim records the field it came from");
});

test("finalization is deterministic and idempotent across repeated runs", async () => {
  const es = await buildEvidenceSet([SUPPORTING, CONTRADICTING, OFF_PICO]);
  const fields = {
    abstract: "Progesterone reduced preterm birth (Likes 2019).",
    discussion: "Progesterone prevents all-cause mortality (Likes 2019). Hulshoff 2012 found no significant difference."
  };
  const first = finalizeClaims({ fields, evidenceSet: es, elements: PICO });
  for (let i = 0; i < 20; i++) {
    const again = finalizeClaims({ fields, evidenceSet: es, elements: PICO });
    assert.deepEqual(again.fields, first.fields);
    assert.deepEqual(again.removedClaims, first.removedClaims);
    assert.deepEqual(again.limitations, first.limitations);
  }
});

/**
 * Sentence splitting is on the critical path for citation integrity: `finalizeClaims` judges one
 * sentence at a time, so a boundary drawn in the wrong place makes a real citation invisible.
 *
 * `(Smith et al. 2020)` was split in half at the period in `et al.`, leaving `... agree (Smith et
 * al.` and the orphaned `2020).` as separate sentences with no citation in either. The surrounding
 * prose was then rewritten into the uncertainty boilerplate. On a live AI commentary this produced
 * 17 stripped claims, seven repetitions of the boilerplate in one paragraph, and stray `2026).`
 * fragments published in the final text.
 */
test("splitSentences does not cut a citation in half at 'et al.'", async () => {
  const sents = splitSentences(
    "Several trials agree (Smith et al. 2020). Kumar 2026 extended this finding."
  );

  assert.equal(sents.length, 2, `expected 2 sentences, got ${JSON.stringify(sents)}`);
  assert.ok(sents[0].includes("(Smith et al. 2020)"), "the citation must survive intact");
  assert.ok(!sents.some(s => /^\s*\d{4}\)\./.test(s)), "no orphaned year fragment");
});

test("splitSentences keeps other abbreviations whole", () => {
  for (const text of [
    "Rates fell (Kumar 2026), i.e. the effect persisted. It held.",
    "Progesterone was effective (Zethelius 2026), cf. Fig. 2. Rates fell.",
    "No. 4 was excluded (Kumar 2026). Rates fell."
  ]) {
    const sents = splitSentences(text);
    assert.ok(!sents.some(s => /^\s*\d{4}[).]/.test(s)), `orphaned fragment in: ${JSON.stringify(sents)}`);
  }
});

test("a citation written with 'et al.' is recognised, not orphaned", async () => {
  const es = await buildEvidenceSet([SUPPORTING]);
  const withEtAl = "Progesterone reduced preterm birth (Likes et al. 2019).";
  const res = finalizeClaims({ fields: { discussion: withEtAl }, evidenceSet: es, elements: PICO });

  // Before the fix the citation was split across two sentences, neither of which carried it, so
  // this correctly-cited and correctly-supported sentence was stripped.
  assert.deepEqual(res.removedClaims, [], "a supported 'et al.' citation must not be removed");
  assert.match(res.fields.discussion, /reduced preterm birth/);
  assert.deepEqual(res.warnings, []);
});

test("adjacent unsupported sentences do not repeat the boilerplate", async () => {
  const es = await buildEvidenceSet([SUPPORTING]);
  const fields = {
    discussion:
      "Progesterone reduced preterm birth. " +
      "Vaginal progesterone improved outcomes. " +
      "Treatment should be offered routinely. " +
      "Progesterone was superior to cerclage."
  };
  const res = finalizeClaims({ fields, evidenceSet: es, elements: PICO });

  const boilerplate =
    "Direct evidence supporting this statement was not identified in the retained sources";
  const occurrences = res.fields.discussion.split(boilerplate).length - 1;

  // Every removal is still reported; only the duplicated prose is collapsed.
  assert.equal(res.removedClaims.length, 4, "all four unsupported claims are still recorded");
  assert.equal(res.warnings.length, 4, "all four removals are still reported");
  assert.equal(occurrences, 1, `boilerplate appeared ${occurrences} times in one field`);
  assert.equal(res.limitations.length, 1);
});

test("non-adjacent unsupported sentences keep their own limitation", async () => {
  const es = await buildEvidenceSet([SUPPORTING]);
const res = finalizeClaims({
    fields: {
      discussion:
        "Progesterone reduced preterm birth (Likes 2019). " +
        "Progesterone improved outcomes. " +
        "Treatment reduced preterm birth before 37 weeks (Likes 2019)."
    },
    evidenceSet: es,
    elements: PICO
  });
  // Only consecutive runs collapse: a supported sentence between two unsupported ones separates
  // them, and replacing both would misrepresent the paragraph.
assert.equal(res.limitations.length, 1);
  assert.match(res.fields.discussion, /reduced preterm birth \(Likes 2019\)/);
  assert.match(res.fields.discussion, /reduced preterm birth before 37 weeks \(Likes 2019\)/);
});

