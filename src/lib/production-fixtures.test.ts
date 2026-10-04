import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceSet } from "./evidence-set.ts";
import { NO_LITERATURE_HINT, NO_LITERATURE_MESSAGE } from "./clinical-keywords.ts";
import { finalizeClaims } from "./claim-finalization.ts";
import {
  checkCitations,
  filterByClaim,
  reconcileNarrative,
  type AuditableRef,
  type PicoElement
} from "./relevance.ts";

const PICO: PicoElement[] = [
  { label: "Population", value: "pregnant individuals with a short cervix" },
  { label: "Intervention", value: "progesterone" },
  { label: "Comparator", value: "cerclage" },
  { label: "Outcome", value: "preterm birth before 37 weeks; gestational age at delivery" }
];

const RELEVANT: AuditableRef[] = [
  {
    pmid: "30000001",
    title: "Vaginal progesterone versus cerclage in women with a short cervix",
    authors: "Likes M, Berghella V",
    year: "2019",
    journal: "Obstet Gynecol",
    doi: "10.1001/og.2019.0001",
    context:
      "pregnant individuals with a short cervix were randomized to vaginal progesterone or cerclage; preterm birth before 37 weeks and gestational age at delivery"
  },
  {
    pmid: "30000002",
    title: "Progesterone compared with cerclage for preterm birth prevention",
    authors: "Owen C",
    year: "2020",
    journal: "Am J Obstet Gynecol",
    doi: "10.1016/j.ajog.2020.0002",
    context:
      "short cervix population randomized to progesterone or cerclage, reporting preterm birth before 37 weeks and gestational age at delivery"
  }
];

/** Every unrelated record carries a resolvable identifier, so it is excluded for relevance alone. */
const UNRELATED: { label: string; ref: AuditableRef }[] = [
  {
    label: "cancer trial",
    ref: { pmid: "30000101", title: "Capecitabine in metastatic breast cancer", authors: "Xu L", year: "2020", journal: "JCO", doi: "10.1200/jco.2020.101", context: "metastatic breast cancer chemotherapy trial" }
  },
  {
    label: "basic reproductive biology",
    ref: { pmid: "30000102", title: "Oocyte activation signalling in mouse oocytes", authors: "Nagy G", year: "2019", journal: "Cell", doi: "10.1016/j.cell.2019.102", context: "oocyte activation intracellular signalling in mice" }
  },
  {
    label: "PCOS",
    ref: { pmid: "30000103", title: "Metformin in polycystic ovary syndrome", authors: "Legro R", year: "2020", journal: "Hum Reprod", doi: "10.1093/humrep/dez.103", context: "polycystic ovary syndrome insulin resistance metformin" }
  },
  {
    label: "endometriosis",
    ref: { pmid: "30000104", title: "Endometriosis pain after laparoscopic excision", authors: "Vercellini P", year: "2020", journal: "Fertil Steril", doi: "10.1016/j.fertstert.2020.104", context: "endometriosis pain laparoscopic excision" }
  },
  {
    label: "unrelated infertility intervention",
    ref: { pmid: "30000105", title: "Single embryo transfer versus multiple in IVF", authors: "Havrev D", year: "2021", journal: "Fertil Steril", doi: "10.1016/j.fertstert.2021.105", context: "in vitro fertilization single embryo transfer live birth" }
  },
  {
    label: "unrelated neonatal condition",
    ref: { pmid: "30000106", title: "Early onset neonatal sepsis in preterm infants", authors: "Stoll B", year: "2020", journal: "Pediatrics", doi: "10.1542/peds.2019.3106", context: "neonatal sepsis antibiotics preterm infants" }
  },
  {
    label: "correct outcome, wrong population",
    ref: {
      pmid: "30000107",
      title: "Progesterone to prevent preterm birth after in vitro fertilization",
      authors: "Benhalima S",
      year: "2020",
      journal: "Ultrasound Obstet Gynecol",
      doi: "10.1002/uog.2106",
      context: "progesterone to reduce preterm birth in women conceived by in vitro fertilization"
    }
  },
  {
    label: "correct population, wrong intervention and comparator",
    ref: {
      pmid: "30000108",
      title: "Vaginal pessary for a short cervix",
      authors: "Gupathirajan A",
      year: "2020",
      journal: "Obstet Gynecol",
      doi: "10.1097/AOG.0000000000005343",
      context: "women with a short cervix randomized to a vaginal pessary or bed rest, preterm birth"
    }
  }
];

test("A. only the directly relevant short-cervix records are retained", () => {
  const res = filterByClaim(RELEVANT, PICO);
  assert.deepEqual(res.kept.map(r => r.pmid).sort(), ["30000001", "30000002"]);
  assert.equal(res.excluded.length, 0);
  for (const ref of res.kept) {
    assert.ok(ref.doi, "every retained record has a resolvable identifier");
  }
});

test("B. each unrelated record is excluded from direct support, for relevance", () => {
  for (const { label, ref } of UNRELATED) {
    const res = filterByClaim([ref], PICO);
    assert.equal(res.kept.length, 0, `${label} must not be direct support`);
    assert.equal(res.excluded.length, 1, `${label} must be reported as excluded`);
    assert.match(res.excluded[0].reason, /no direct support/, `${label}: ${res.excluded[0].reason}`);
  }
});

test("B. unrelated records cannot reach the reference list or the deliverables", async () => {
  const res = filterByClaim(UNRELATED.map(u => u.ref), PICO);
  assert.equal(res.kept.length, 0, "no unrelated record survives the claim filter");
  const es = await buildEvidenceSet(res.kept);
  assert.equal(es.retainedCount, 0);
  assert.equal(es.allowedCitationKeys.size, 0);
  const narrative = reconcileNarrative(
    { discussion: "Evidence is limited (Smith 2019)." },
    [],
    es.allowedCitationKeys,
    es.citationMap
  );
  assert.deepEqual(narrative.references, []);
  assert.deepEqual(checkCitations(narrative.fields.discussion, []).orphans, []);
  assert.ok(!narrative.fields.discussion.includes("Smith 2019"), "no citation to an unrelated record survives");
});

test("C. zero direct-support evidence shows the exact message and no claims", async () => {
  const res = filterByClaim(UNRELATED.map(u => u.ref), PICO);
  assert.equal(res.kept.length, 0);
  const es = await buildEvidenceSet(res.kept);

  assert.equal(NO_LITERATURE_MESSAGE, "No literature related to your search found");
  assert.equal(
    NO_LITERATURE_HINT,
    "Try revising or broadening your keywords. Include a condition or population, intervention, comparator, and outcome, and check the spelling of the terms."
  );

  const finalized = finalizeClaims({
    fields: { discussion: "Progesterone reduces preterm birth before 37 weeks compared with cerclage." },
    evidenceSet: es,
    elements: PICO
  });
  const supported = finalized.claims.filter(c => c.supported);
  assert.equal(supported.length, 0, "no efficacy claim is retained without evidence");
  assert.equal(finalized.removedClaims.length, 1, "the unsupported efficacy claim is removed");
  assert.ok(!/reduces preterm birth/.test(finalized.fields.discussion), "the claim is not restated as a finding");
  assert.ok(
    finalized.fields.discussion.includes("unresolved uncertainty"),
    "the reader is told the claim is unsupported rather than shown a finding"
  );
});
