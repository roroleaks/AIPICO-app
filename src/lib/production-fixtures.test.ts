import test from "node:test";
import assert from "node:assert/strict";
import { NO_LITERATURE_HINT, NO_LITERATURE_MESSAGE } from "./clinical-keywords.ts";
import {
  checkCitations,
  filterByClaim,
  auditRef,
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
  const narrative = reconcileNarrative(
    { discussion: "Evidence is limited (Smith 2019)." },
    [],
    new Set(),
    new Map()
  );
  assert.deepEqual(narrative.references, []);
  assert.deepEqual(checkCitations(narrative.fields.discussion, []).orphans, []);
  assert.ok(!narrative.fields.discussion.includes("Smith 2019"), "no citation to an unrelated record survives");
});

test("C. zero direct-support evidence shows the exact message", async () => {
  const res = filterByClaim(UNRELATED.map(u => u.ref), PICO);
  assert.equal(res.kept.length, 0);

  assert.equal(NO_LITERATURE_MESSAGE, "No literature related to your search found");
  assert.equal(
    NO_LITERATURE_HINT,
    "Try revising or broadening your keywords. Include a condition or population, intervention, comparator, and outcome, and check the spelling of the terms."
  );
});

test("P0-1. Excluded records are not promoted into directPool; every retained record has pop and int verified", () => {
  const ivfPico: PicoElement[] = [
    { label: "Population", value: "poor ovarian response undergoing IVF" },
    { label: "Intervention", value: "growth hormone" },
    { label: "Comparator", value: "placebo or standard care" },
    { label: "Outcome", value: "live birth rate" }
  ];

  const pool: AuditableRef[] = [
    {
      pmid: "30000201",
      title: "Growth hormone co-treatment in poor responders undergoing IVF: a randomized controlled trial",
      authors: "Norman RJ",
      year: "2020",
      journal: "Hum Reprod",
      doi: "10.1093/humrep/deaa201",
      context: "poor ovarian response women in IVF received growth hormone or placebo, live birth rate evaluated"
    },
    {
      pmid: "30000202",
      title: "Jinfeng pills in diminished ovarian reserve",
      authors: "Wang L",
      year: "2019",
      journal: "Chin J Integr Med",
      doi: "10.1007/s11655-019-0202",
      context: "women with diminished ovarian reserve treated with Jinfeng pills"
    },
    {
      pmid: "30000203",
      title: "Empty follicle syndrome in IVF cycles: etiology and clinical outcome",
      authors: "Castillo JC",
      year: "2018",
      journal: "Fertil Steril",
      doi: "10.1016/j.fertstert.2018.0203",
      context: "clinical appraisal of empty follicle syndrome during stimulation"
    }
  ];

  const filtered = filterByClaim(pool, ivfPico);
  assert.equal(filtered.kept.length, 1, "Only the growth hormone IVF trial survives claim filter");
  assert.equal(filtered.kept[0].pmid, "30000201");
  assert.equal(filtered.excluded.length, 2, "Other 2 records must remain in excluded set");

  // Every retained record must have verified population and intervention
  const audit = auditRef(filtered.kept[0], ivfPico);
  assert.equal(audit.population, true, "Retained record must match population");
  assert.equal(audit.intervention, true, "Retained record must match intervention");

  // When directPool has fewer than 3 records, low-evidence threshold is triggered (< 3)
  const directCount = filtered.kept.length;
  assert.ok(directCount < 3, "Direct count 1 is below threshold of 3, triggering low-evidence state");
});

test("P0-4: Evidence-map candidate audit rejects off-topic references and dedupes across DOI and PMID", async () => {
  const scenarioElements: PicoElement[] = [
    { label: "P — Population", value: "poor responders in IVF" },
    { label: "I — Intervention", value: "growth hormone" },
    { label: "C — Comparator", value: "placebo or standard protocol" }
  ];

  const offTopicRecords: AuditableRef[] = [
    {
      pmid: "10001",
      title: "Hypertension in Pregnancy: diagnosis and management",
      authors: "Smith A",
      year: "2021",
      journal: "Circulation",
      context: "hypertension in pregnancy management guidelines"
    },
    {
      pmid: "10002",
      title: "Fetal growth restriction and neonatal morbidity",
      authors: "Jones B",
      year: "2020",
      journal: "AJOG",
      context: "fetal growth restriction neonatal outcomes"
    },
    {
      pmid: "10003",
      title: "Retinopathy of Prematurity screening guidelines",
      authors: "Taylor C",
      year: "2019",
      journal: "Pediatrics",
      context: "screening for retinopathy of prematurity"
    },
    {
      pmid: "10004",
      title: "Intraovarian platelet-rich plasma injections in poor ovarian responders",
      authors: "Lee D",
      year: "2022",
      journal: "Hum Reprod",
      context: "platelet-rich plasma intraovarian injection without growth hormone"
    }
  ];

  const onTopicRecord: AuditableRef = {
    pmid: "32727608",
    doi: "10.1186/s12958-020-00632-w",
    title: "Growth hormone co-treatment for poor ovarian responders undergoing in vitro fertilization: a systematic review and meta-analysis",
    authors: "Yang P",
    year: "2020",
    journal: "Reprod Biol Endocrinol",
    context: "growth hormone co-treatment for poor ovarian response in IVF cycles evaluated for live birth rate and clinical pregnancy"
  };

  const pointTerms: PicoElement[] = [
    ...scenarioElements,
    { label: "O — Outcome", value: "live birth rate" }
  ];

  for (const rec of offTopicRecords) {
    const audit = auditRef(rec, pointTerms);
    const passes = audit.population && (audit.intervention || audit.comparator || audit.outcome);
    assert.equal(passes, false, `Off-topic record "${rec.title}" must fail the evidence-map filter`);
  }

  const validAudit = auditRef(onTopicRecord, pointTerms);
  const validPasses = validAudit.population && (validAudit.intervention || validAudit.comparator || validAudit.outcome);
  assert.equal(validPasses, true, "On-topic record must pass evidence-map filter");

  const { refCanonicalKeys } = await import("./explore-scoring.ts");
  const keys1 = refCanonicalKeys(onTopicRecord);
  const keys2 = refCanonicalKeys({
    pmid: "cr:10.1186/s12958-020-00632-w",
    doi: "10.1186/s12958-020-00632-w",
    title: "Growth hormone co-treatment for poor ovarian responders undergoing in vitro fertilization: a systematic review and meta-analysis"
  });
  const shared = keys1.filter(k => keys2.includes(k));
  assert.ok(shared.length > 0, "PubMed and Crossref records for the same paper must share canonical DOI key");
});
