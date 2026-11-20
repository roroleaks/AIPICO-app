import test from "node:test";
import assert from "node:assert/strict";
import { formatVancouver, formatApa, formatHarvard } from "./citation-formatter.ts";
import { isDirectSupportEligible, auditRef, type AuditableRef, type PicoElement } from "./relevance.ts";
import { resolveProvenance } from "./provenance.ts";

const PICO: PicoElement[] = [
  { label: "Population", value: "pregnant individuals with short cervix" },
  { label: "Intervention", value: "vaginal progesterone" },
  { label: "Comparator", value: "expectant management" },
  { label: "Outcome", value: "preterm birth before 34 weeks" }
];

test("SS1. Clinical trial registrations are excluded from direct support and tagged correctly", () => {
  const trialRef: AuditableRef = {
    pmid: "ctg:NCT04567890",
    title: "Vaginal Progesterone in Short Cervix Gestation: A Phase III Clinical Trial",
    authors: "National Institute of Child Health",
    year: "2023",
    journal: "ClinicalTrials.gov",
    source: "clinicaltrials",
    url: "https://clinicaltrials.gov/study/NCT04567890",
    context: "Interventional trial evaluating vaginal progesterone versus expectant management for preterm birth before 34 weeks."
  };

  const decision = isDirectSupportEligible(trialRef, PICO);
  assert.equal(decision.eligible, false, "Clinical trial registration must not count as direct evidence of effect");
  assert.match(decision.reason || "", /trial registration/i);

  const formatted = formatVancouver(trialRef, 1);
  assert.ok(formatted.includes("[trial registration — not evidence of effect]"), "Vancouver reference must include trial registration badge");
});

test("SS2. Preprint records carry unreviewed badge and are flagged", () => {
  const preprintRef: AuditableRef = {
    pmid: "pre:10.1101/2024.01.15.575000",
    title: "Vaginal progesterone versus expectant management: an updated systematic review",
    authors: "Smith AB, Cooper CD",
    year: "2024",
    journal: "medRxiv",
    doi: "10.1101/2024.01.15.575000",
    source: "preprint",
    url: "https://doi.org/10.1101/2024.01.15.575000",
    context: "Systematic review of vaginal progesterone for preterm birth before 34 weeks in pregnant individuals with short cervix."
  };

  const van = formatVancouver(preprintRef, 1);
  assert.ok(van.includes("[preprint — not peer reviewed]"), "Vancouver reference must include preprint badge");

  const apa = formatApa(preprintRef);
  assert.ok(apa.includes("[preprint — not peer reviewed]"), "APA reference must include preprint badge");

  const harvard = formatHarvard(preprintRef);
  assert.ok(harvard.includes("[preprint — not peer reviewed]"), "Harvard reference must include preprint badge");
});

test("SS3. Cochrane CENTRAL and Semantic Scholar identifiers resolve properly", () => {
  const centralRef: AuditableRef = {
    pmid: "cen:CN-01234567",
    title: "Progesterone versus expectant management in short cervix pregnancy",
    authors: "Johnson K, Davis L",
    year: "2022",
    journal: "Cochrane Central Register of Controlled Trials",
    source: "central",
    doi: "10.1002/14651858.CD000000",
    context: "Randomized trial of progesterone in pregnant individuals with short cervix for preterm birth before 34 weeks."
  };

  const auditCentral = auditRef(centralRef, PICO);
  assert.equal(auditCentral.resolved, true, "Cochrane CENTRAL cen: id must resolve");
  assert.equal(auditCentral.doiOk, true);

  const s2Ref: AuditableRef = {
    pmid: "s2:abcdef1234567890",
    title: "Progesterone versus expectant management in short cervix pregnancy",
    authors: "Williams M",
    year: "2021",
    journal: "American Journal of Obstetrics and Gynecology",
    source: "semantic-scholar",
    doi: "10.1016/j.ajog.2021.05.001",
    context: "Evaluation of progesterone in pregnant individuals with short cervix for preterm birth before 34 weeks."
  };

  const auditS2 = auditRef(s2Ref, PICO);
  assert.equal(auditS2.resolved, true, "Semantic Scholar s2: id must resolve");
  assert.equal(auditS2.doiOk, true);
});

test("SS4. Provenance metadata honestly records enginesQueried and Google Scholar coverage proxy", () => {
  const prov = resolveProvenance();

  assert.ok(Array.isArray(prov.enginesQueried), "enginesQueried must be an array");
  const engines = prov.enginesQueried as string[];

  assert.ok(engines.some(e => /pubmed/i.test(e)), "Must include PubMed");
  assert.ok(engines.some(e => /central/i.test(e)), "Must include Cochrane CENTRAL");
  assert.ok(engines.some(e => /clinicaltrials/i.test(e)), "Must include ClinicalTrials.gov");
  assert.ok(engines.some(e => /semantic scholar/i.test(e)), "Must include Semantic Scholar");
  assert.ok(engines.some(e => /preprint/i.test(e)), "Must include Preprints");
  assert.ok(engines.some(e => /google scholar/i.test(e)), "Must include Google Scholar proxy");

  assert.ok(prov.googleScholarNotice, "Must include Google Scholar notice");
  assert.match(prov.googleScholarNotice as string, /OpenAlex|Semantic Scholar/i);
});

test("SS5. Bounded concurrency helper restricts in-flight tasks to max 2", async () => {
  let inFlight = 0;
  let maxObservedInFlight = 0;
  const items = [1, 2, 3, 4, 5, 6];

  async function mockTask(num: number) {
    inFlight++;
    if (inFlight > maxObservedInFlight) {
      maxObservedInFlight = inFlight;
    }
    await new Promise(r => setTimeout(r, 20));
    inFlight--;
    return num * 10;
  }

  // Implementation of bounded concurrency helper (same logic as in route.ts)
  const CONCURRENCY_LIMIT = 2;
  const results = new Array<number>(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await mockTask(items[idx]);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, items.length) }, () => worker());
  await Promise.all(workers);

  assert.equal(maxObservedInFlight, 2, `Max concurrent tasks must be exactly 2; observed ${maxObservedInFlight}`);
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60]);
});
