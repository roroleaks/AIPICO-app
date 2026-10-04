import test from "node:test";
import assert from "node:assert/strict";
import {
  auditRef,
  filterByClaim,
  isDirectSupportEligible,
  type AuditableRef,
  type PicoElement
} from "./relevance.ts";

const PICO: PicoElement[] = [
  { label: "Population", value: "pregnant individuals with a short cervix" },
  { label: "Intervention", value: "progesterone" },
  { label: "Comparator", value: "cerclage" },
  { label: "Outcome", value: "preterm birth before 37 weeks; gestational age at delivery" }
];

function confidenceOf(ref: AuditableRef): string {
  return auditRef(ref, PICO).metadataCompleteness?.confidence ?? "low";
}

test("a record with no resolvable identifier is never direct support, however well it matches", () => {
  // Matches every element of the claim by wording, but has neither a DOI nor a PMID, so a reader
  // cannot check it against a published paper.
  const unidentifiable: AuditableRef = {
    title: "Progesterone and cerclage for a short cervix and preterm birth",
    authors: "A",
    year: "2020",
    context: "short cervix progesterone cerclage preterm birth"
  };
  const decision = isDirectSupportEligible(unidentifiable, PICO);
  assert.equal(decision.eligible, false, JSON.stringify(decision));
  if (decision.eligible) return;
  assert.match(decision.reason || "", /no resolvable identifier/);
});

test("weak records never reach the confidence rule, because they fail a prior gate", () => {
  const weak: AuditableRef[] = [
    { title: "Progesterone and cerclage for a short cervix and preterm birth", authors: "A", year: "2020", context: "short cervix progesterone cerclage preterm birth" },
    { title: "Progesterone cerclage preterm", authors: "B", year: "2020", context: "short cervix" },
    { pmid: "3", title: "Obstetrics update", authors: "C", year: "2020", journal: "OG", doi: "10.1000/o", context: "general obstetrics" }
  ];
  for (const ref of weak) {
    const decision = isDirectSupportEligible(ref, PICO);
    assert.equal(decision.eligible, false, `${ref.title}: ${JSON.stringify(decision)}`);
    if (decision.eligible) continue;
    assert.ok(decision.reason && decision.reason.length > 0, "every rejection names its gate");
  }
});

test("a record whose metadata is only a broad specialty is not direct support", () => {
  const broad: AuditableRef = {
    pmid: "998",
    title: "Obstetrics and gynecology update",
    authors: "X Y",
    year: "2020",
    journal: "OG",
    doi: "10.1000/obg",
    context: "general obstetrics and gynecology practice review"
  };
  const res = filterByClaim([broad], PICO);
  assert.equal(res.kept.length, 0);
  assert.equal(res.excluded.length, 1);
});

test("a high-confidence record addressing the whole claim is direct support", () => {
  const strong: AuditableRef = {
    pmid: "1",
    title: "Vaginal progesterone versus cerclage in women with a short cervix",
    authors: "Likes M",
    year: "2020",
    journal: "Obstet Gynecol",
    doi: "10.1001/og.2020.0001",
    context:
      "pregnant individuals with a short cervix randomized to vaginal progesterone or cerclage, preterm birth before 37 weeks and gestational age at delivery"
  };
  assert.equal(confidenceOf(strong), "high");
  const res = filterByClaim([strong], PICO);
  assert.deepEqual(res.kept.map(r => r.pmid), ["1"]);
});

test("a missing abstract alone does not disqualify an otherwise specific record", () => {
  // No abstract at all: everything the claim needs is deterministically matched from the title,
  // and the record carries both a DOI and a PMID.
  const noAbstract: AuditableRef = {
    pmid: "2",
    title: "Progesterone versus cerclage in a short cervix population: preterm birth outcomes",
    authors: "Berghella V",
    year: "2020",
    journal: "AJOG",
    doi: "10.1016/j.ajog.2020.0002"
  };
  const audit = auditRef(noAbstract, PICO);
  assert.equal(audit.metadataCompleteness?.hasAbstract, false, "the fixture really has no abstract");
  assert.ok(audit.population && audit.intervention && audit.comparator && audit.outcome, "every element is matched");
  const res = filterByClaim([noAbstract], PICO);
  assert.deepEqual(res.kept.map(r => r.pmid), ["2"], "moderate is allowed when every element matches");
});

test("the confidence policy and the claim filter agree on every fixture", () => {
  const pool: AuditableRef[] = [
    {
      pmid: "1",
      title: "Vaginal progesterone versus cerclage in women with a short cervix",
      authors: "Likes M",
      year: "2020",
      journal: "Obstet Gynecol",
      doi: "10.1001/og.2020.0001",
      context: "short cervix progesterone cerclage preterm birth before 37 weeks"
    },
    { pmid: "2", title: "Obstetrics update", authors: "X Y", year: "2020", journal: "OG", doi: "10.1000/o", context: "general obstetrics" },
    { title: "Progesterone and cerclage for a short cervix and preterm birth", authors: "A", year: "2020", context: "short cervix progesterone cerclage preterm birth" }
  ];
  const res = filterByClaim(pool, PICO);
  for (const ref of pool) {
    const decision = isDirectSupportEligible(ref, PICO);
    const kept = res.kept.some(k => k === ref);
    assert.equal(decision.eligible, kept, `${ref.title}: policy and filter disagree`);
  }
});
