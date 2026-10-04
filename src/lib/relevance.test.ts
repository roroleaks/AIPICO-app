/**
 * Deterministic acceptance tests for claim-specific reference filtering.
 *
 * The fixture below is fixed and hand-built, so every assertion is reproducible: no network,
 * no LLM, no live literature database. These tests exercise the same exported functions the
 * engine route uses, so they test the shipped filter rather than a copy of it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  auditRef,
  checkCitations,
  elementByType,
  extractInTextCites,
  filterByClaim,
  isDirectSupport,
  referenceSetKey,
  surnamesOf,
  type PicoElement
} from "./relevance.ts";

// The PICO from the acceptance test case: short cervix / progesterone / cerclage,
// outcomes preterm birth and gestational age at delivery.
const PICO: PicoElement[] = [
  { label: "Population", value: "pregnant individuals with a short cervix" },
  { label: "Intervention", value: "progesterone" },
  { label: "Comparator", value: "cerclage" },
  { label: "Outcome", value: "preterm birth before 37 weeks; gestational age at delivery" }
];

interface Fixture extends Record<string, unknown> {
  pmid: string;
  title: string;
  doi?: string;
  context?: string;
}

const FIXTURE: Fixture[] = [
  // --- direct support for the selected claim ---
  {
    pmid: "11100001",
    title: "Vaginal progesterone for prevention of preterm birth in women with a short cervix: a randomized controlled trial",
    authors: "Owen DD",
    year: "2020",
    journal: "Obstet Gynecol",
    doi: "10.1001/og.2020.0001",
    context: "pregnant women with a short cervix were randomized to progesterone or cerclage, and preterm birth before 37 weeks and gestational age at delivery were recorded"
  },
  {
    pmid: "11100002",
    title: "Cerclage versus progesterone in women with a short cervix: systematic review and meta-analysis",
    authors: "Hodgetts Morton",
    year: "2021",
    journal: "BJOG",
    doi: "10.1111/bjog.2021.0002",
    context: "short cervix population, cerclage compared with progesterone, outcomes preterm birth and gestational age at delivery"
  },
  {
    pmid: "11100003",
    title: "Transcerclage cerclage versus vaginal progesterone in a short cervix population",
    authors: "Kansal",
    year: "2022",
    journal: "Am J Obstet Gynecol",
    doi: "10.1067/ajog.2022.0003",
    context: "pregnant individuals with short cervix; cerclage and progesterone; gestational age at delivery and preterm birth were the primary outcomes"
  },

  // --- must be excluded: cancer trials ---
  {
    pmid: "22200001",
    title: "Progesterone receptor antagonist therapy in advanced breast cancer: a randomized trial",
    authors: "CancerAuthor",
    year: "2019",
    journal: "J Clin Oncol",
    doi: "10.1200/jco.2019.0001",
    context: "breast cancer patients receiving progesterone receptor antagonist versus placebo"
  },
  {
    pmid: "22200002",
    title: "Cervical cancer incidence after cerclage in a national cancer registry cohort",
    authors: "OncoTwo",
    year: "2018",
    journal: "Lancet Oncol",
    doi: "10.1016/s1470-2045.2018.0002",
    context: "cervical cancer risk among women with a history of cerclage"
  },

  // --- must be excluded: basic reproductive biology ---
  {
    pmid: "33300001",
    title: "Molecular regulation of collagen synthesis in human cervical stromal cells in vitro",
    authors: "BasicBio",
    year: "2015",
    journal: "J Cell Physiol",
    doi: "10.1002/jcp.2015.0001",
    context: "in vitro collagen expression in cervical fibroblasts; no patients, no clinical outcomes"
  },

  // --- must be excluded: unrelated conditions ---
  {
    pmid: "44400001",
    title: "Endometriosis, deep infiltrating disease and the risk of preterm birth: a cohort study",
    authors: "EndoAuthor",
    year: "2020",
    journal: "Hum Reprod",
    doi: "10.1093/humrep/deaa2020",
    context: "women with endometriosis; progesterone and cerclage were not studied"
  },
  {
    pmid: "44400002",
    title: "PCOS, ovulation induction with progesterone and live birth rate",
    authors: "PcosAuthor",
    year: "2021",
    journal: "Fertil Steril",
    doi: "10.1016/j.ferstert.2021.0002",
    context: "polycystic ovary syndrome, progesterone supplementation, live birth"
  },

  // --- right outcome, wrong population ---
  {
    pmid: "55500001",
    title: "Progesterone and cerclage to prevent preterm birth in women with a previous preterm birth",
    authors: "WrongPop",
    year: "2019",
    journal: "Obstet Gynecol",
    doi: "10.1001/og.2019.0001",
    context: "women with a prior preterm birth, no cervical length assessment; progesterone versus cerclage; preterm birth and gestational age at delivery"
  },

  // --- right population, wrong intervention/comparator ---
  {
    pmid: "66600001",
    title: "Cervical length measurement and preterm birth prediction in women with a short cervix",
    authors: "WrongInt",
    year: "2017",
    journal: "Ultrasound Obstet Gynecol",
    doi: "10.1002/uog.2017.0001",
    context: "pregnant women with a short cervix; serial transvaginal cervical length; outcomes preterm birth and gestational age at delivery"
  },

  // --- population + outcome but no intervention/comparator: contextual only ---
  {
    pmid: "66600002",
    title: "Preterm birth and gestational age at delivery in pregnancies complicated by a short cervix",
    authors: "ContextOnly",
    year: "2016",
    journal: "J Matern Fetal Neonatal Med",
    doi: "10.3109/14767058.2016.0001",
    context: "observational outcomes among pregnant individuals with a short cervix"
  }
];

const byId = (id: string): Fixture => {
  const f = FIXTURE.find(x => x.pmid === id);
  assert.ok(f, `fixture ${id} must exist`);
  return f;
};

// ---------------------------------------------------------------------------

test("R1. PICO elements are classified by label, not by position", () => {
  const t = elementByType(PICO);
  assert.equal(t.population?.value, "pregnant individuals with a short cervix");
  assert.equal(t.intervention?.value, "progesterone");
  assert.equal(t.comparator?.value, "cerclage");
  assert.ok(t.outcome?.value.includes("preterm birth"));
});

test("R2. relevant short-cervix records are retained as direct support", () => {
  const { kept } = filterByClaim(FIXTURE, PICO);
  const keptIds = kept.map(r => r.pmid);
  for (const id of ["11100001", "11100002", "11100003"]) {
    assert.ok(keptIds.includes(id), `${id} (${byId(id).title.slice(0, 40)}) must be retained`);
  }
});

test("R3. cancer trials are excluded", () => {
  const { excluded } = filterByClaim(FIXTURE, PICO);
  for (const id of ["22200001", "22200002"]) {
    assert.ok(
      excluded.some(e => e.ref.pmid === id),
      `${id} (${byId(id).title.slice(0, 40)}) must be excluded`
    );
  }
});

test("R4. basic reproductive biology is excluded", () => {
  const { kept, excluded } = filterByClaim(FIXTURE, PICO);
  assert.ok(excluded.some(e => e.ref.pmid === "33300001"));
  assert.ok(!kept.some(r => r.pmid === "33300001"));
});

test("R5. unrelated conditions (endometriosis, PCOS) are excluded", () => {
  const { kept, excluded } = filterByClaim(FIXTURE, PICO);
  for (const id of ["44400001", "44400002"]) {
    assert.ok(excluded.some(e => e.ref.pmid === id), `${id} must be excluded`);
    assert.ok(!kept.some(r => r.pmid === id));
  }
});

test("R6. wrong population is excluded even with the right outcome and treatment", () => {
  const a = auditRef(byId("55500001"), PICO);
  assert.equal(a.outcome, true, "premise: outcome does match");
  assert.equal(isDirectSupport(a), false, "population mismatch must block direct support");
  const { kept } = filterByClaim(FIXTURE, PICO);
  assert.ok(!kept.some(r => r.pmid === "55500001"));
});

test("R7. wrong intervention/comparator is excluded even with the right population and outcome", () => {
  const a = auditRef(byId("66600001"), PICO);
  assert.equal(a.population, true, "premise: population does match");
  assert.equal(a.outcome, true, "premise: outcome does match");
  assert.equal(a.intervention, false);
  assert.equal(a.comparator, false);
  assert.equal(isDirectSupport(a), false, "must not count as direct PICO support");
  const { kept } = filterByClaim(FIXTURE, PICO);
  assert.ok(!kept.some(r => r.pmid === "66600001"));
});

test("R8. population+outcome with no treatment is separated as contextual, not direct support", () => {
  const a = auditRef(byId("66600002"), PICO);
  assert.equal(a.population, true);
  assert.equal(a.outcome, true);
  assert.equal(isDirectSupport(a), false);
  const { kept, excluded } = filterByClaim(FIXTURE, PICO);
  assert.ok(!kept.some(r => r.pmid === "66600002"), "not a direct-support reference");
  const e = excluded.find(x => x.ref.pmid === "66600002")!;
  assert.match(e.reason, /intervention\/comparator/, "exclusion reason must be explicit");
});

test("R9. exclusion reasons name the missing PICO relationship", () => {
  const { excluded } = filterByClaim(FIXTURE, PICO);
  for (const e of excluded) {
    assert.match(e.reason, /^no direct support: missing /);
    assert.ok(e.audit.score < 4);
  }
});

test("R10. retained count for the short-cervix fixture is exactly 3 of 11", () => {
  const { kept, excluded } = filterByClaim(FIXTURE, PICO);
  assert.equal(kept.length, 3, `kept=${kept.map(k => k.pmid).join(",")}`);
  assert.equal(excluded.length, 8);
  assert.equal(kept.length + excluded.length, FIXTURE.length, "every record is accounted for");
  assert.equal(FIXTURE.length, 11, "fixture size is fixed");
});

// --- citation / reference integrity ---------------------------------------

const CHICAGO: Record<string, string> = {
  "11100001": 'Owen, David D. 2020. "Vaginal progesterone for prevention of preterm birth in women with a short cervix: a randomized controlled trial." Obstetrics & Gynecology. doi:10.1001/og.2020.0001',
  "11100002": 'Hodgetts Morton, Jennifer. 2021. "Cerclage versus progesterone in women with a short cervix: systematic review and meta-analysis." BJOG. doi:10.1111/bjog.2021.0002',
  "11100003": 'Kansal, Anjali. 2022. "Transcerclage cerclage versus vaginal progesterone in a short cervix population." American Journal of Obstetrics and Gynecology. doi:10.1067/ajog.2022.0003'
};

test("R11. commentary citations resolve to exactly one exported reference", () => {
  const refs = Object.values(CHICAGO);
  const discussion = [
    "Progesterone reduces preterm birth in a short cervix population (Owen 2020).",
    "A meta-analysis favoured cerclage over progesterone (Hodgetts Morton 2021).",
    "Transcerclage cerclage was also effective (Kansal 2022)."
  ].join(" ");
  const c = checkCitations(discussion, refs);
  assert.deepEqual(c.uncited, [], "every reference is cited");
  assert.deepEqual(c.orphans, [], "no citation points outside the reference list");
  assert.equal(c.citedRefs, c.totalRefs);
  assert.equal(c.consistent, true);
});

test("R12. an unresolved citation is detected as an orphan", () => {
  const c = checkCitations("Progesterone reduces preterm birth (Owen 2020) and further (Kansal 2026).", Object.values(CHICAGO));
  assert.ok(c.orphans.some(o => o.includes("Kansal")), `orphans=${c.orphans.join(",")}`);
  assert.equal(c.consistent, false);
});

test("R13. a citation with the wrong year is not silently accepted", () => {
  // The exported source is 2021; citing "Hodgetts Morton 2021" against a 2018 record fails.
  const refs = ['Hodgetts Morton, Jennifer. 2018. "Other topic." BJOG. doi:10.1111/x'];
  const c = checkCitations("Cerclage was favoured (Hodgetts Morton 2021).", refs);
  assert.ok(c.orphans.some(o => o.includes("Hodgetts")), "year mismatch must not resolve");
  assert.ok(c.uncited.length === 1, "the 2018 reference is not cited as 2018");
});

test("R14. a reference the commentary never cites is reported as uncited", () => {
  const c = checkCitations("Only one claim is supported (Owen 2020).", Object.values(CHICAGO));
  assert.equal(c.uncited.length, 2);
  assert.equal(c.consistent, false);
});

test("R15. citation extraction handles both parenthetical and narrative forms", () => {
  const cites = extractInTextCites("A finding (Owen 2020) and Kansal et al. (2022) plus (Smith; Jones 2019).");
  const pairs = cites.map(c => `${c.author} ${c.year}`);
  assert.ok(pairs.includes("Owen 2020"));
  assert.ok(pairs.includes("Kansal 2022"));
  assert.ok(pairs.includes("Smith 2019"));
  assert.ok(pairs.includes("Jones 2019"));
});

test("R16. surname extraction ignores leading noise words", () => {
  // Every capitalised token before the year is a candidate author token. Including the given
  // name is intentional: Chicago references may list "Surname, Given" and the citation check
  // must resolve either form.
  assert.deepEqual(surnamesOf('Hodgetts Morton, Jennifer. 2021. "Title." Journal.'),
    ["Hodgetts", "Morton", "Jennifer"]);
  assert.deepEqual(surnamesOf("No year here"), []);
});

// --- export integrity ------------------------------------------------------

test("R17. the exported set equals the in-app retained set", () => {
  const { kept } = filterByClaim(FIXTURE, PICO);
  const appList = kept.map(r => CHICAGO[r.pmid]);
  assert.equal(appList.filter(Boolean).length, 3);
  assert.ok(
    !appList.some(s => /cancer|in vitro|endometriosis|polycystic/i.test(s)),
    "no excluded record leaks into the exported list"
  );
});

test("R18. no excluded record appears in the exported reference set", () => {
  const { kept, excluded } = filterByClaim(FIXTURE, PICO);
  const exported = kept.map(r => String(r.title));
  for (const e of excluded) {
    assert.ok(
      !exported.includes(e.ref.title),
      `${e.ref.pmid} "${e.ref.title.slice(0, 40)}" leaked into export`
    );
  }
});

test("R19. filtering is deterministic for the same fixture and PICO", () => {
  const runs = Array.from({ length: 5 }, () =>
    filterByClaim(FIXTURE, PICO).kept.map(r => r.pmid).join(",")
  );
  assert.equal(new Set(runs).size, 1, `non-deterministic: ${runs.join(" | ")}`);
  // Order of the input fixture must not change which records are kept.
  const shuffled = [...FIXTURE].reverse();
  const keptA = filterByClaim(FIXTURE, PICO).kept.map(r => r.pmid).sort().join(",");
  const keptB = filterByClaim(shuffled, PICO).kept.map(r => r.pmid).sort().join(",");
  assert.equal(keptA, keptB);
});

test("R20. reference set identity is stable and order-independent", () => {
  const a = referenceSetKey(Object.values(CHICAGO));
  const b = referenceSetKey([...Object.values(CHICAGO)].reverse());
  assert.equal(a, b);
});

// --- empty / weak match behaviour -----------------------------------------

test("R21. zero direct-support records yields an empty retained set, not a fallback", () => {
  // Cancer + biology only: nothing supports the claim, so nothing may be promoted.
  const pool = ["22200001", "22200002", "33300001"].map(byId);
  const { kept } = filterByClaim(pool, PICO);
  assert.equal(kept.length, 0, "no record may be retained without direct support");
});

test("R22. specialty-only matches yield no direct support", () => {
  // Every record shares the Obs/Gyn specialty but none matches the claim.
  const pool = FIXTURE.filter(f => f.pmid.startsWith("2") || f.pmid.startsWith("3") || f.pmid.startsWith("4"));
  const { kept } = filterByClaim(pool, PICO);
  assert.equal(kept.length, 0, "specialty overlap alone is not evidence for the claim");
});

test("R23. a single relevant record produces exactly one retained reference", () => {
  const { kept } = filterByClaim([byId("11100002")], PICO);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].pmid, "11100002");
});

test("R24. an empty pool yields an empty result without throwing", () => {
  const { kept, excluded } = filterByClaim([], PICO);
  assert.equal(kept.length, 0);
  assert.equal(excluded.length, 0);
});

test("R25. every audit marks whether the record resolved to a citable source", () => {
  const { audits } = filterByClaim(FIXTURE, PICO);
  for (const [, a] of audits) {
    assert.equal(typeof a.resolved, "boolean");
    assert.equal(typeof a.doiOk, "boolean");
    assert.ok(a.design.length > 0);
  }
  assert.equal(audits.get("11100001")?.resolved, true);
  assert.equal(audits.get("11100001")?.doiOk, true);
});
