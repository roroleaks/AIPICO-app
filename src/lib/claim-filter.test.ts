/**
 * Citation-curation tests for the claim-filtering pipeline.
 *
 * These exercise the functions the engine route actually calls (`curateReferences`,
 * `resolveReference`, `filterByClaim`), not a copy of them, so they fail if the shipped
 * curation path changes. The property under test is the acceptance criterion: a model
 * reference is accepted only when it resolves to a record that passed the claim filter, so
 * an off-topic source cannot be laundered into the commentary or an export by being named.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  auditRef,
  checkCitations,
  stripOrphanCitations,
  curateReferences,
  filterByClaim,
  formatReference,
  refIdentityKey,
  resolveReference
} from "./relevance.ts";
import type { PicoElement } from "./relevance.ts";

interface Rec {
  pmid: string;
  title: string;
  authors: string;
  year: string;
  journal: string;
  doi?: string;
  url: string;
  context?: string;
}

const PICO: PicoElement[] = [
  { label: "Population", value: "pregnant individuals with a short cervix" },
  { label: "Intervention", value: "progesterone" },
  { label: "Comparator", value: "cerclage" },
  { label: "Outcome", value: "preterm birth before 37 weeks; gestational age at delivery" }
];

const RELEVANT: Rec[] = [
  {
    pmid: "30000001",
    title: "Vaginal progesterone to prevent preterm birth in women with a short cervix",
    authors: "Owen DD", year: "2020", journal: "Obstet Gynecol", doi: "10.1001/og.2020.1",
    url: "https://pubmed.ncbi.nlm.nih.gov/30000001/",
    context: "randomized trial in pregnant women with a short cervix; progesterone vs cerclage; preterm birth before 37 weeks and gestational age at delivery"
  },
  {
    pmid: "30000002",
    title: "Cerclage versus progesterone in women with a short cervix meta-analysis",
    authors: "Hodgetts Morton J", year: "2021", journal: "BJOG", doi: "10.1111/bjog.2021.1",
    url: "https://pubmed.ncbi.nlm.nih.gov/30000002/",
    context: "short cervix; cerclage compared with progesterone; preterm birth, gestational age at delivery"
  },
  {
    pmid: "30000003",
    title: "Emergency cerclage versus progesterone in a short cervix population",
    authors: "Kansal A", year: "2022", journal: "Am J Obstet Gynecol", doi: "10.1067/ajog.2022.1",
    url: "https://pubmed.ncbi.nlm.nih.gov/30000003/",
    context: "pregnant individuals with short cervix; cerclage and progesterone; gestational age at delivery"
  }
];

const CANCER: Rec = {
  pmid: "40000001",
  title: "Progesterone receptor antagonist therapy in advanced breast cancer",
  authors: "CancerAuthor C", year: "2019", journal: "J Clin Oncol", doi: "10.1200/jco.2019.1",
  url: "https://pubmed.ncbi.nlm.nih.gov/40000001/",
  context: "breast cancer, progesterone receptor antagonist"
};

const CANCER2: Rec = {
  pmid: "40000004",
  title: "Adjuvant therapy and survival in cervical cancer: a registry study",
  authors: "OncoTwo D", year: "2018", journal: "Lancet Oncol", doi: "10.1016/S1470-2045(18)3",
  url: "https://pubmed.ncbi.nlm.nih.gov/40000004/",
  context: "cervical cancer registry cohort"
};

const BASIC: Rec = {
  pmid: "40000002",
  title: "Collagen synthesis in human cervical stromal cells in vitro",
  authors: "BasicBio B", year: "2015", journal: "J Cell Physiol", doi: "10.1002/jcp.2015.1",
  url: "https://pubmed.ncbi.nlm.nih.gov/40000002/",
  context: "in vitro fibroblast biology"
};

const ENDO: Rec = {
  pmid: "40000003",
  title: "Endometriosis and the risk of preterm birth: a cohort study",
  authors: "EndoAuthor E", year: "2020", journal: "Hum Reprod", doi: "10.1093/humrep/deaa1",
  url: "https://pubmed.ncbi.nlm.nih.gov/40000003/",
  context: "women with endometriosis"
};

const NOVEL: Rec = {
  pmid: "50000001",
  title: "Short cervical length and spontaneous preterm birth in a general obstetric population",
  authors: "WrongPop F", year: "2019", journal: "Obstet Gynecol", doi: "10.1001/og.2019.1",
  url: "https://pubmed.ncbi.nlm.nih.gov/50000001/",
  context: "cervical length assessment in an unselected population; no cervical length threshold for treatment"
};

const WRONG_TREATMENT: Rec = {
  pmid: "50000002",
  title: "Short cervix and preterm birth: a longitudinal study without pharmacologic treatment or cerclage",
  authors: "WrongInt G", year: "2017", journal: "Ultrasound Obstet Gynecol", doi: "10.1002/uog.2017.1",
  url: "https://pubmed.ncbi.nlm.nih.gov/50000002/",
  context: "serial cervical length measurement in pregnant women with a short cervix; no progesterone and no cerclage; preterm birth before 37 weeks"
};

/** Names neither arm of the comparison: population and outcome only. */
const COMPARATOR_ONLY: Rec = {
  pmid: "50000003",
  title: "Suturing of the cervix and preterm birth before 37 weeks",
  authors: "NoArm H", year: "2021", journal: "Obstet Gynecol", doi: "10.1001/og.2021.3",
  url: "https://pubmed.ncbi.nlm.nih.gov/50000003/",
  context: "pregnant women with a short cervix; surgical cervical suturing; preterm birth before 37 weeks and gestational age at delivery"
};

/** Also names neither arm: population and outcome, an unrelated intervention. */
const INTERVENTION_ONLY: Rec = {
  pmid: "50000004",
  title: "Aspirin and the risk of preterm birth in women with a short cervix",
  authors: "WrongDrug I", year: "2020", journal: "BJOG", doi: "10.1111/bjog.2020.4",
  url: "https://pubmed.ncbi.nlm.nih.gov/50000004/",
  context: "low-dose aspirin in pregnant individuals with a short cervix; preterm birth before 37 weeks; gestational age at delivery"
};

/** A head-to-head record: names both arms and compares them, so it is direct evidence. */
const HEAD_TO_HEAD: Rec = {
  pmid: "30000004",
  title: "Vaginal progesterone versus cerclage in women with a short cervix",
  authors: "Both Arms J", year: "2023", journal: "BJOG", doi: "10.1111/bjog.2023.5",
  url: "https://pubmed.ncbi.nlm.nih.gov/30000004/",
  context: "progesterone compared with cerclage in pregnant individuals with a short cervix; preterm birth before 37 weeks; gestational age at delivery"
};

const ONE_ARM_PICO: PicoElement[] = [
  { label: "Population", value: "pregnant individuals with a short cervix" },
  { label: "Intervention", value: "progesterone" },
  { label: "Outcome", value: "preterm birth before 37 weeks; gestational age at delivery" }
];

const OFF_TOPIC = [CANCER, CANCER2, BASIC, ENDO, NOVEL, WRONG_TREATMENT];

test("C1. an off-topic record is rejected before it can be cited", () => {
  const cancerRef = formatReference(CANCER);
  assert.equal(resolveReference(cancerRef, RELEVANT), null, "cancer trial does not resolve");
  const c = curateReferences([cancerRef], RELEVANT, { min: 0, max: 8 });
  assert.equal(c.references.length, 0, "so it cannot be curated");
  assert.deepEqual(c.dropped, [cancerRef]);
});

test("C2. basic-science and unrelated-condition records are rejected the same way", () => {
  for (const r of [CANCER2, BASIC, ENDO]) {
    assert.equal(resolveReference(formatReference(r), RELEVANT), null, `${r.pmid} must not resolve`);
  }
});

test("C3. a fabricated citation that matches no record is rejected", () => {
  const bogus = 'Kansal, A. 2026. "Randomized trial of progesterone to prevent miscarriage." NEJM. doi:10.1056/NEJM20260001';
  assert.equal(resolveReference(bogus, RELEVANT), null);
  assert.equal(curateReferences([bogus], RELEVANT, { min: 0 }).references.length, 0);
});

test("C4. a genuine reference with a wrong year is rejected", () => {
  const wrongYear = 'Hodgetts Morton, J. 2019. "Cerclage versus progesterone in women with a short cervix meta-analysis." BJOG. doi:10.1111/bjog.2021.1';
  assert.equal(resolveReference(wrongYear, RELEVANT), null);
});

test("C5. a genuine reference with the right year still resolves", () => {
  const hit = resolveReference(formatReference(RELEVANT[1]), RELEVANT);
  assert.equal(hit?.pmid, "30000002");
});

test("C6. a near-identical title with a fabricated year is rejected", () => {
  // Same author and a plausible title, but a year no record carries: title+author agree,
  // so only the year check can catch it.
  const noYear = 'Kansal, A. 2018. "Emergency cerclage versus progesterone in a short cervix population." Am J Obstet Gynecol. doi:10.1067/ajog.2022.1';
  assert.equal(resolveReference(noYear, RELEVANT), null);
});

test("C7. curation keeps on-topic references and drops everything else", () => {
  const modelRefs = [
    formatReference(RELEVANT[0]),
    formatReference(CANCER),
    formatReference(RELEVANT[1]),
    formatReference(ENDO),
    formatReference(BASIC)
  ];
  const { references, dropped } = curateReferences(modelRefs, RELEVANT, { min: 0, max: 8 });
  assert.equal(references.length, 2);
  assert.ok(references[0].includes("Vaginal progesterone"));
  assert.ok(references[1].includes("Cerclage versus progesterone"));
  assert.ok(!references.some(r => /cancer|in vitro|endometriosis/i.test(r)));
  assert.equal(dropped.length, 3);
});

test("C8. curation caps the list at max", () => {
  const many = Array.from({ length: 12 }, (_, i) => formatReference(RELEVANT[i % 3]));
  assert.ok(curateReferences(many, RELEVANT, { min: 0, max: 8 }).references.length <= 8);
});

test("C9. the curated list satisfies citation integrity end to end", () => {
  const { references } = curateReferences(RELEVANT.map(r => formatReference(r)), RELEVANT, { min: 4, max: 8 });
  assert.equal(references.length, 3);
  const discussion = [
    "Progesterone reduced preterm birth (Owen 2020).",
    "Cerclage performed better in meta-analysis (Hodgetts Morton 2021).",
    "Emergency cerclage was also studied (Kansal 2022)."
  ].join(" ");
  const c = checkCitations(discussion, references);
  assert.deepEqual(c.uncited, []);
  assert.deepEqual(c.orphans, []);
  assert.equal(c.consistent, true);
});

test("C10. every curated reference maps back to a direct-support record", () => {
  const { kept } = filterByClaim([...RELEVANT, ...OFF_TOPIC], PICO);
  assert.deepEqual(kept.map(r => r.pmid), RELEVANT.map(r => r.pmid));
  for (const r of OFF_TOPIC) assert.ok(!kept.includes(r), `${r.pmid} excluded`);
});

test("C11. an empty filtered pool yields an empty curated list", () => {
  const c = curateReferences(OFF_TOPIC.map(r => formatReference(r)), [], { min: 4, max: 8 });
  assert.deepEqual(c.references, []);
  assert.equal(c.dropped.length, OFF_TOPIC.length);
});

test("C12. the exported set is exactly the retained set", () => {
  const { kept } = filterByClaim([...RELEVANT, ...OFF_TOPIC], PICO);
  const { references } = curateReferences(kept.map(r => formatReference(r)), kept, { min: 4, max: 8 });
  assert.deepEqual(
    [...references].map(r => refIdentityKey(r)).sort(),
    kept.map(r => refIdentityKey(formatReference(r))).sort()
  );
});

test("C13. when the model returns nothing, the top-up still comes from the filtered pool", () => {
  const { references } = curateReferences([], RELEVANT, { min: 4, max: 8 });
  assert.equal(references.length, 3, "cannot invent a 4th record that does not exist");
  for (const r of references) {
    assert.ok(resolveReference(r, RELEVANT), "each topped-up reference resolves to a real record");
  }
});

test("C14. a thin but real evidence base stays thin instead of being padded with off-topic records", () => {
  const thin = [RELEVANT[0]];
  const { references } = curateReferences([], thin, { min: 4, max: 8 });
  assert.equal(references.length, 1);
  assert.ok(!references.some(r => /cancer|in vitro|endometriosis/i.test(r)));
});

test("C15. curation is deterministic and order-stable", () => {
  const refs = [CANCER, RELEVANT[1], ENDO, RELEVANT[0], RELEVANT[2], BASIC].map(r => formatReference(r));
  const a = curateReferences(refs, RELEVANT, { min: 4, max: 8 }).references;
  const b = curateReferences(refs, RELEVANT, { min: 4, max: 8 }).references;
  assert.deepEqual(a, b);
});

test("C16. duplicate model entries do not produce duplicate references", () => {
  const dup = [formatReference(RELEVANT[0]), formatReference(RELEVANT[0]), formatReference(RELEVANT[0])];
  const { references } = curateReferences(dup, RELEVANT, { min: 0, max: 8 });
  assert.equal(references.length, 1);
});

test("C17. no curated reference resolves to an excluded record", () => {
  const { kept, excluded } = filterByClaim([...RELEVANT, ...OFF_TOPIC], PICO);
  const excludedIds = new Set(excluded.map(e => refIdentityKey(formatReference(e.ref))));
  const { references } = curateReferences(
    [...RELEVANT, ...OFF_TOPIC].map(r => formatReference(r)),
    kept,
    { min: 4, max: 8 }
  );
  for (const r of references) assert.ok(!excludedIds.has(refIdentityKey(r)));
});

test("C18. a record naming neither arm is not direct evidence", () => {
  const { kept, excluded } = filterByClaim([COMPARATOR_ONLY], PICO);
  assert.equal(kept.length, 0, "neither progesterone nor cerclage appears");
  const drop = excluded[0];
  assert.match(drop.reason, /intervention\/comparator/);
  assert.equal(drop.audit.population, true, "population does match");
  assert.equal(drop.audit.outcome, true, "outcome does match");
  assert.equal(drop.audit.intervention, false);
  assert.equal(drop.audit.comparator, false);
});

test("C19. an unrelated intervention is not direct evidence", () => {
  const { kept, excluded } = filterByClaim([INTERVENTION_ONLY], PICO);
  assert.equal(kept.length, 0, "aspirin is neither the intervention nor the comparator");
  assert.match(excluded[0].reason, /intervention\/comparator/);
  assert.equal(excluded[0].audit.population, true);
  assert.equal(excluded[0].audit.outcome, true);
});

test("C20. a head-to-head record is direct evidence for the comparison", () => {
  const { kept, excluded } = filterByClaim([HEAD_TO_HEAD], PICO);
  assert.deepEqual(kept.map(r => r.pmid), [HEAD_TO_HEAD.pmid],
    "naming both arms satisfies the treatment requirement");
  assert.equal(excluded.length, 0);
});

test("C21. a one-arm question still excludes a record naming neither arm", () => {
  const { kept } = filterByClaim([HEAD_TO_HEAD, COMPARATOR_ONLY, INTERVENTION_ONLY], ONE_ARM_PICO);
  assert.deepEqual(kept.map(r => r.pmid), [HEAD_TO_HEAD.pmid]);
});

test("C22. a population mismatch is named as such", () => {
  const { kept, excluded } = filterByClaim([NOVEL], PICO);
  assert.equal(kept.length, 0);
  assert.match(excluded[0].reason, /population/);
});

test("C23. a record with no treatment at all names both required elements", () => {
  const { kept, excluded } = filterByClaim([WRONG_TREATMENT], PICO);
  assert.equal(kept.length, 0);
  assert.match(excluded[0].reason, /intervention\/comparator/);
});

test("C24. every non-direct record is excluded, including treatment-only matches", () => {
  const { kept, excluded } = filterByClaim(
    [...RELEVANT, HEAD_TO_HEAD, ...OFF_TOPIC, COMPARATOR_ONLY, INTERVENTION_ONLY],
    PICO
  );
  assert.deepEqual(kept.map(r => r.pmid), [...RELEVANT.map(r => r.pmid), HEAD_TO_HEAD.pmid]);
  const droppedIds = excluded.map(e => e.ref.pmid);
  for (const r of [...OFF_TOPIC, COMPARATOR_ONLY, INTERVENTION_ONLY]) {
    assert.ok(droppedIds.includes(r.pmid), `${r.pmid} excluded`);
  }
});

test("C25. a treatment-only record is never cited for a question it does not address", () => {
  const { kept } = filterByClaim([...RELEVANT, HEAD_TO_HEAD, ...OFF_TOPIC, COMPARATOR_ONLY], PICO);
  const { references } = curateReferences(
    [HEAD_TO_HEAD, COMPARATOR_ONLY, INTERVENTION_ONLY].map(r => formatReference(r)),
    kept,
    { min: 4, max: 8 }
  );
  assert.ok(references.every(r => /progesterone|cerclage/i.test(r)),
    "no reference names a treatment the question did not ask about");
});

test("C26. a drug named only under negation is not treated as evidence", () => {
  const { kept, excluded } = filterByClaim([WRONG_TREATMENT], PICO);
  assert.equal(kept.length, 0, '"no progesterone and no cerclage" must not read as both arms');
  assert.equal(excluded[0].audit.population, true, "the population really does match");
  assert.equal(excluded[0].audit.outcome, true, "the outcome really does match");
  assert.equal(excluded[0].audit.intervention, false);
  assert.equal(excluded[0].audit.comparator, false);
});

test("C27. a negated treatment is dropped even when every other element matches", () => {
  const negatedOutcome: Rec = {
    pmid: "50000005",
    title: "Progesterone without a reduction in preterm birth in a short cervix population",
    authors: "Negated J", year: "2022", journal: "JAMA", doi: "10.1001/jama.2022.5",
    url: "https://pubmed.ncbi.nlm.nih.gov/50000005/",
    context: "pregnant individuals with a short cervix; cerclage; progesterone without a reduction in preterm birth"
  };
  const { kept } = filterByClaim([negatedOutcome], PICO);
  assert.equal(kept.length, 0);
});

test("C28. a contrastive negation still asserts the contrasted treatment", () => {
  const contrastive: Rec = {
    pmid: "30000005",
    title: "Not cerclage but progesterone in women with a short cervix",
    authors: "Contrastive K", year: "2021", journal: "Obstet Gynecol", doi: "10.1001/og.2021.6",
    url: "https://pubmed.ncbi.nlm.nih.gov/30000005/",
    context: "progesterone rather than cerclage in pregnant women with a short cervix; preterm birth before 37 weeks"
  };
  const { kept } = filterByClaim([contrastive], PICO);
  assert.deepEqual(kept.map(r => r.pmid), [contrastive.pmid],
    '"not cerclage but progesterone" asserts progesterone');
});

test("C29. a single generic token does not satisfy a multi-token population", () => {
  const audit = auditRef(NOVEL, PICO);
  assert.equal(audit.population, false,
    '"short" alone is not the population "pregnant individuals with a short cervix"');
});

test("C30. element matching needs two corroborating tokens, not one", () => {
  const oneTokenOnly: Rec = {
    pmid: "50000006",
    title: "Short pregnancy outcomes in a general population",
    authors: "TokenOnly L", year: "2020", journal: "BJOG", doi: "10.1111/bjog.2020.6",
    url: "https://pubmed.ncbi.nlm.nih.gov/50000006/",
    context: "short report; outcomes in an unselected population"
  };
  const audit = auditRef(oneTokenOnly, PICO);
  assert.equal(audit.population, false);
});

test("C31. the published entry uses the record's metadata, not the model's text", () => {
  // Author, year and title are right, but the model garbled the journal and invented a DOI.
  // Resolution succeeds on the parts it got right; the published entry must carry the
  // record's journal and DOI.
  const modelText = 'Owen, D. D. 2020. "Vaginal progesterone to prevent preterm birth in women with a short cervix." Journal of Obstetrics and Gynecology 99(9):1-9. doi:10.9999/fake.1';
  const { references, records } = curateReferences([modelText], [RELEVANT[0]], { min: 0, max: 8 });
  assert.equal(references.length, 1);
  assert.equal(records[0].pmid, RELEVANT[0].pmid);
  assert.equal(references[0], formatReference(RELEVANT[0]),
    "the entry is regenerated from the record");
  assert.ok(!references[0].includes("fake"));
  assert.ok(references[0].includes("10.1001/og.2020.1"), "the real DOI is used");
  assert.ok(references[0].includes("Obstet Gynecol"), "the real journal is used");
});

test("C31b. a citation whose title belongs to a different paper is rejected", () => {
  // Correct author and year, but a title that does not belong to this record: the entry is
  // dropped rather than published under this record's metadata.
  const wrongTitle = 'Owen, D. D. 2020. "Progesterone receptor antagonist therapy in advanced breast cancer." Obstet Gynecol. doi:10.1001/og.2020.1';
  const { references, dropped } = curateReferences([wrongTitle], [RELEVANT[0]], { min: 0, max: 8 });
  assert.equal(references.length, 0);
  assert.deepEqual(dropped, [wrongTitle]);
});

test("C32. a fabricated DOI on an otherwise real citation is corrected, not propagated", () => {
  const tampered = `${formatReference(RELEVANT[2]).replace(/doi:10\.\S+/, "doi:10.1056/NEJMoa99999999")}`;
  const { references, records } = curateReferences([tampered], [RELEVANT[2]], { min: 0, max: 8 });
  assert.equal(references.length, 1);
  assert.equal(records[0].pmid, "30000003");
  assert.ok(references[0].includes("10.1067/ajog.2022.1"));
  assert.ok(!references[0].includes("NEJMoa99999999"));
});

test("C33. references, records and the audit are the same set in the same order", () => {
  const { kept } = filterByClaim([...RELEVANT, HEAD_TO_HEAD, ...OFF_TOPIC], PICO);
  const { references, records, resolved } = curateReferences(kept.map(r => formatReference(r)), kept, { min: 4, max: 8 });
  assert.equal(references.length, records.length);
  for (let i = 0; i < references.length; i++) {
    assert.equal(references[i], formatReference(records[i]));
    assert.equal(resolved.get(references[i])?.pmid, records[i].pmid);
    const audit = auditRef(records[i], PICO);
    assert.equal(audit.resolved, true, `${records[i].pmid} resolves to a source record`);
  }
});

test("C34. the reference list and the sources export render identical text", () => {
  // Both the on-screen bibliography and the sources PDF call formatReference, so a record
  // cannot appear with one set of metadata in one place and another set elsewhere.
  const { kept } = filterByClaim(RELEVANT, PICO);
  const { references, records } = curateReferences([], kept, { min: 4, max: 8 });
  assert.deepEqual(references, records.map(r => formatReference(r)));
});

test("C35. every published reference carries a resolvable identifier", () => {
  const { references } = curateReferences([], RELEVANT, { min: 4, max: 8 });
  for (const r of references) {
    assert.ok(/10\.\d{4,}/.test(r) || /https?:\/\//.test(r), `resolvable link or DOI: ${r}`);
  }
});

test("C36. a citation of an accented surname is not reported as an orphan", () => {
  // Regression: the surname scan was ASCII-only, so "Žarko Alfirević" was read as the single
  // name "Alfirevi" and this genuine citation was reported as missing from the list.
  const ref = 'Žarko Alfirević, John Owen, E. Carreras. 2012. "Vaginal progesterone for preterm birth prevention." J Matern Fetal Neonatal Med. doi:10.3109/14767058.2012.712231';
  const c = checkCitations("Progesterone reduced preterm birth (Žarko Alfirević 2012).", [ref]);
  assert.deepEqual(c.orphans, [], "an accented citation must resolve");
  assert.deepEqual(c.uncited, []);
  assert.equal(c.consistent, true);
});

test("C37. an accented citation also resolves when the text drops the accent", () => {
  const ref = 'Žarko Alfirević, John Owen, E. Carreras. 2012. "Vaginal progesterone for preterm birth prevention." J Matern Fetal Neonatal Med. doi:10.3109/14767058.2012.712231';
  const c = checkCitations("Progesterone reduced preterm birth (Alfirevic 2012).", [ref]);
  assert.deepEqual(c.orphans, []);
  assert.deepEqual(c.uncited, []);
});

test("C38. a hyphenated surname is one name, not two", () => {
  // Regression: "Sanchez-Ramos" was split into "Sanchez-" and "Ramos", so both halves were
  // reported as citations with no matching reference.
  const ref = 'Sanchez-Ramos Luis. 2018. "Vaginal progesterone is an alternative to cerclage." Am J Obstet Gynecol. doi:10.1016/j.ajog.2018.03.028';
  const c = checkCitations("Progesterone was as effective as cerclage (Sanchez-Ramos 2018).", [ref]);
  assert.deepEqual(c.orphans, [], "a hyphenated surname must resolve as a whole");
  assert.deepEqual(c.uncited, []);
  assert.equal(c.consistent, true);
});

test("C39. a surname with a non-ASCII hyphen still resolves", () => {
  // Europe PMC and Crossref return U+2010/U+2011 hyphens inside surnames.
  const ref = 'Agustín Conde‐Agudelo, Roberto J. Romero. 2018. "Vaginal progesterone versus cerclage." Am J Obstet Gynecol. doi:10.1016/j.ajog.2018.03.028';
  const c = checkCitations("Both were comparable (Conde‐Agudelo 2018).", [ref]);
  assert.deepEqual(c.orphans, []);
  assert.deepEqual(c.uncited, []);
});

test("C40. a genuinely unknown citation is still reported", () => {
  // The accent/hyphen tolerance must not swallow a real orphan such as a misattributed year.
  const ref = 'Agustín Conde‐Agudelo, Roberto J. Romero. 2018. "Vaginal progesterone versus cerclage." Am J Obstet Gynecol. doi:10.1016/j.ajog.2018.03.028';
  const c = checkCitations("A large Swedish trial agrees (Berghella 2026).", [ref]);
  assert.deepEqual(c.orphans, ["Berghella 2026"]);
  assert.equal(c.consistent, false);
});

test("C41. a citation with a wrong year for a real author is still an orphan", () => {
  const ref = 'Agustín Conde‐Agudelo, Roberto J. Romero. 2018. "Vaginal progesterone versus cerclage." Am J Obstet Gynecol. doi:10.1016/j.ajog.2018.03.028';
  const c = checkCitations("Both were comparable (Conde-Agudelo 2026).", [ref]);
  assert.deepEqual(c.orphans, ["Conde-Agudelo 2026"], "right author, wrong year is still an orphan");
});

test("C42. an ASCII hyphen in the text matches a U+2010 hyphen in the reference", () => {
  // Sources are inconsistent about hyphen code points, so the same surname arrives spelled two
  // ways and the citation was reported as an unknown reference.
  const ref = 'Agustín Conde‐Agudelo, Roberto J. Romero. 2018. "Vaginal progesterone versus cerclage." Am J Obstet Gynecol. doi:10.1016/j.ajog.2018.03.028';
  const c = checkCitations("Both were comparable (Conde-Agudelo 2018).", [ref]);
  assert.deepEqual(c.orphans, [], "dash variant must not break the match");
  assert.deepEqual(c.uncited, []);
  assert.equal(c.consistent, true);
});

test("C43. an unresolvable citation is stripped, leaving the prose and the real citations", () => {
  const kept = 'Berghella V, Paladino I. 2026. "Progesterone and cerclage." Am J Obstet Gynecol. doi:10.1016/j.ajogmf.2026.102055';
  const body = "Progesterone lowered the rate (Berghella 2026). An older study disagreed (Broad 2009).";
  const r = stripOrphanCitations(body, ["Broad 2009"]);
  assert.equal(r.removed.length, 1);
  assert.equal(r.text.includes("Broad"), false, "the unverifiable attribution is gone");
  assert.equal(r.text.includes("Berghella 2026"), true, "resolvable citations are untouched");
  assert.deepEqual(checkCitations(r.text, [kept]).orphans, [], "the surviving text cites only listed work");
  assert.deepEqual(checkCitations(r.text, [kept]).uncited, []);
});

test("C44. stripping handles narrative citations and leaves no double spaces", () => {
  const r = stripOrphanCitations("Park et al. (2009) reported a benefit.", ["Park 2009"]);
  assert.equal(r.text.includes("2009"), false);
  assert.equal(/[ \t]{2,}/.test(r.text), false, "no double space is left behind");
});

test("C45. a dash-variant orphan is stripped the same way it would be matched", () => {
  const r = stripOrphanCitations("Both matched (Conde‐Agudelo 2026).", ["Conde-Agudelo 2026"]);
  assert.equal(r.text.includes("2026"), false, "U+2010 orphan is still removed");
  assert.equal(r.removed.length, 1);
});

test("C46. one orphan inside a multi-citation bracket does not remove the others", () => {
  const kept = 'Berghella V, Paladino I. 2026. "Progesterone and cerclage." Am J Obstet Gynecol. doi:10.1016/j.ajogmf.2026.102055';
  const body = "Rates fell (Berghella 2026; Broad 2009) in this cohort.";
  const r = stripOrphanCitations(body, ["Broad 2009"]);
  assert.equal(r.text.includes("Berghella 2026"), true, "the resolvable citation survives");
  assert.equal(r.text.includes("Broad"), false, "only the orphan is removed");
  assert.deepEqual(checkCitations(r.text, [kept]).orphans, []);
  assert.deepEqual(checkCitations(r.text, [kept]).uncited, []);
});

test("C47. a repeated-name bracket like (Park and Park 2026) is removed whole", () => {
  const body = "Cervical length fell in selected cohorts (Park and Park 2026). Later work repeated it.";
  const r = stripOrphanCitations(body, ["Park 2026"]);
  assert.equal(r.text.includes("2026"), false);
  assert.equal(r.text.includes("Park"), false, "no dangling author name is left behind");
  assert.equal(r.text.includes("Later work repeated it."), true, "surrounding prose survives");
  assert.equal(/[()]/.test(r.text), false, "no empty bracket is left behind");
});

test("C48. an accented orphan still matches the unaccented text spelling", () => {
  // checkCitations reports the single surname token it failed to match, which is how the
  // diacritic-only difference reaches the strip step.
  const r = stripOrphanCitations("The pessary data are limited (Žarko Alfirević 2012).", ["Alfirević 2012"]);
  assert.equal(r.removed.length, 1, "accent variant is recognised");
  assert.equal(r.text.includes("2012"), false);
  assert.equal(/\(/.test(r.text), false, "the bracket goes with its last citation");
});

test("C49. stripping is a no-op when nothing is orphaned", () => {
  const body = "Rate fell (Berghella 2026).";
  const r = stripOrphanCitations(body, []);
  assert.equal(r.text, body);
  assert.deepEqual(r.removed, []);
});

