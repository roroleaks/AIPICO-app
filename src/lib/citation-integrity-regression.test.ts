import test from "node:test";
import assert from "node:assert/strict";
import {
  filterByClaim,
  sanitizeCitationsAgainstEvidenceSet,
  reconcileNarrative,
  checkCitations,
  type AuditableRef,
  type PicoElement
} from "./relevance.ts";

const PICO: PicoElement[] = [
  { label: "Population", value: "short cervix" },
  { label: "Intervention", value: "progesterone" },
  { label: "Comparator", value: "cerclage" },
  { label: "Outcome", value: "preterm birth" }
];

const FIXTURE: AuditableRef[] = [
  {
    pmid: "11100001",
    title: "Vaginal progesterone versus cerclage",
    authors: "Likes M, Smith J",
    year: "2019",
    journal: "OG",
    doi: "10.1001/og.2020.0001",
    context: "progesterone cerclage short cervix preterm birth",
    url: "https://example.com/1"
  },
  {
    pmid: "11100002",
    title: "Cerclage vs progesterone",
    authors: "Likes M, Jones K",
    year: "2021",
    journal: "BJOG",
    doi: "10.1111/bjog.2021.0002",
    context: "cerclage progesterone preterm birth",
    url: "https://example.com/2"
  }
];

const allowedCitationKeys = new Set(["doi:10.1001/og.2020.0001", "doi:10.1111/bjog.2021.0002"]);
const citationMap = new Map<string, AuditableRef>([
  ["doi:10.1001/og.2020.0001", FIXTURE[0]],
  ["doi:10.1111/bjog.2021.0002", FIXTURE[1]]
]);

test("T1-T4: only a citation to a retained record survives sanitization", async () => {
  const bad = "Work (Likes 2019; Unknown 2025; Likes 2020; Other 2020).";
  const r = sanitizeCitationsAgainstEvidenceSet(bad, allowedCitationKeys, citationMap);
  assert.ok(r.text.includes("Likes 2019"), "the supported citation is kept");
  assert.ok(!r.text.includes("Unknown 2025"), "an unresolvable citation is removed");
  assert.ok(!r.text.includes("Likes 2020"), "a wrong-year citation is removed");
  assert.ok(!r.text.includes("Other 2020"), "a citation to no retained record is removed");
  assert.ok(r.warnings.length >= 1, "removals are reported");
});

test("T9: a record that does not address the claim is excluded from direct support", async () => {
  const eligible: AuditableRef = {
    pmid: "1",
    title: "Vaginal progesterone versus cerclage",
    authors: "Likes M",
    year: "2019",
    journal: "OG",
    doi: "10.1001/og.2020.0001",
    context: "progesterone cerclage short cervix preterm birth"
  };
  const ineligible: AuditableRef = {
    pmid: "2",
    title: "Breast cancer screening",
    authors: "X Y",
    year: "2020",
    journal: "JCO",
    doi: "10.1200/jco.2020.0002",
    context: "breast cancer screening"
  };
  const res = filterByClaim([eligible, ineligible], PICO);
  assert.deepEqual(res.kept.map(r => r.pmid), ["1"], "only the claim-relevant record is direct support");
  assert.equal(res.excluded.length, 1);
  assert.equal(res.excluded[0].ref.pmid, "2");
  assert.ok(res.excluded[0].reason.length > 0, "the exclusion reason is recorded");
});

test("T10-T11: supported citations are left exactly as written", async () => {
  const discussion = "Progesterone reduced preterm birth (Likes 2019) and later work agreed (Likes 2021).";
  const r = sanitizeCitationsAgainstEvidenceSet(discussion, allowedCitationKeys, citationMap);
  assert.equal(r.text, discussion);
});

test("T12: no claim-relevant evidence yields no reference that can be published", async () => {
  const irrelevant: AuditableRef[] = [
    {
      pmid: "x",
      title: "Breast cancer",
      authors: "X",
      year: "2020",
      journal: "JCO",
      doi: "10.1200/jco.2020.000x",
      context: "breast cancer"
    }
  ];
  const res = filterByClaim(irrelevant, PICO);
  assert.equal(res.kept.length, 0, "nothing is direct support");
  const refs = res.kept.map((_, i) => `Ref ${i + 1}`);
  assert.equal(refs.length, 0, "no reference can be listed");
  const reconciled = reconcileNarrative({ discussion: "No evidence was found." }, refs, new Set(), new Map());
  assert.deepEqual(reconciled.references, []);
  assert.deepEqual(checkCitations(reconciled.fields.discussion, []).orphans, []);
});

test("T13: sanitization is stable across repeated runs and across draft shapes", async () => {
  const drafts = [
    "(Likes 2019)",
    "(Likes 2019; Likes 2021)",
    "(Likes 2019; Likes 2021; Unknown 2025)"
  ];
  for (let run = 0; run < 20; run++) {
    const draft = drafts[run % drafts.length];
    const r1 = sanitizeCitationsAgainstEvidenceSet(draft, allowedCitationKeys, citationMap);
    const r2 = sanitizeCitationsAgainstEvidenceSet(draft, allowedCitationKeys, citationMap);
    assert.equal(r1.text, r2.text, `unstable result for ${draft}`);
  }
});

test("T14: a record with no identifiers at all exposes neither a DOI nor a PMID", async () => {
  const rec: AuditableRef = { title: "T", authors: "A B", year: "2020", journal: "J" };
  assert.equal(rec.doi, undefined, "no DOI is invented");
  assert.equal(rec.pmid, undefined, "no PMID is invented");
});

test("T15: the no-evidence message is the exact published string", async () => {
  const { NO_LITERATURE_MESSAGE, NO_LITERATURE_HINT } = await import("./clinical-keywords.ts");
  assert.equal(NO_LITERATURE_MESSAGE, "No literature related to your search found");
  assert.equal(
    NO_LITERATURE_HINT,
    "Try revising or broadening your keywords. Include a condition or population, intervention, comparator, and outcome, and check the spelling of the terms."
  );
});
