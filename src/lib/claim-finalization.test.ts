import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceSet } from "./evidence-set.ts";
import { finalizeClaims } from "./claim-finalization.ts";
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
