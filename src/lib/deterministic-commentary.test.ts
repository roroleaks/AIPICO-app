import test from "node:test";
import assert from "node:assert/strict";
import { generateDeterministicCommentary } from "./deterministic-commentary.ts";
import { buildEvidenceSet } from "./evidence-set.ts";
import { finalizeClaims } from "./claim-finalization.ts";
import { validateDeliverableIntegrity } from "./deliverable-integrity.ts";
import { checkCitations, filterByClaim, refSurnameYear, type AuditableRef, type PicoElement } from "./relevance.ts";

/**
 * Deterministic commentary is what every user without a provider key now receives, so it is the
 * most-read clinical text in the product for desktop and self-hosted installs. It shipped for
 * years inline in the engine route, untested, and three separate defects lived in it: it was
 * unreachable because `if (!KEY) return 503` ran first, it hardcoded keywords from one unrelated
 * question, and it cited only the first of the eight references it listed.
 *
 * The route cannot be unit tested (it needs a live request context), so the generator was moved to
 * this module. That is the same move made for the rule fallback in F-03/F-04.
 */

const CERVIX: PicoElement[] = [
  { label: "P — Population", value: "Women with a short cervix" },
  { label: "I — Intervention", value: "Vaginal progesterone" },
  { label: "C — Comparator", value: "Placebo" },
  { label: "O — Outcome", value: "Spontaneous preterm birth" }
];

// `context` is the abstract. It is not decoration: `auditRef` scores a record on title, journal,
// authors and abstract, `isDirectSupportEligible` rejects low-metadata-confidence records, and the
// PICO match itself reads the abstract. A fixture without abstracts is excluded before the
// deterministic generator ever sees it, which would silently test the wrong pipeline.
const CERVIX_RECORDS: AuditableRef[] = [
  {
    pmid: "42575275",
    authors: "Kumar N, Singer P, Sachdeva R",
    year: "2026",
    title: "Nestorone prevents preterm birth in murine models of premature labor",
    journal: "Am J Obstet Gynecol",
    doi: "10.1016/j.ajog.2026.07.032",
    url: "https://pubmed.ncbi.nlm.nih.gov/42575275/",
    context:
      "Keywords: short cervix; progesterone; preterm birth. We studied women with a short cervix " +
      "treated with vaginal progesterone or placebo and measured spontaneous preterm birth in a murine model."
  },
  {
    pmid: "42161360",
    authors: "Zethelius M, Bergman L, Ekelund AC",
    year: "2026",
    title: "Universal cervical length screening with vaginal progesterone: a systematic review",
    journal: "Acta Obstet Gynecol Scand",
    doi: "10.1111/aogs.70253",
    url: "https://pubmed.ncbi.nlm.nih.gov/42161360/",
    context:
      "Keywords: cervical length; progesterone. Systematic review of vaginal progesterone versus placebo " +
      "in women with a short cervix, with spontaneous preterm birth as the primary outcome."
  },
  {
    pmid: "26531775",
    authors: "Agustin Conde A, Agudelo RJ, Romero R",
    year: "2015",
    title: "Vaginal progesterone to prevent preterm birth in women with a short cervix",
    journal: "Am J Obstet Gynecol",
    doi: "10.1016/j.ajog.2015.09.102",
    url: "https://pubmed.ncbi.nlm.nih.gov/26531775/",
    context:
      "Keywords: cervical insufficiency; progesterone. Vaginal progesterone compared with placebo in " +
      "women with a short cervix reduced spontaneous preterm birth in a randomised trial."
  }
];

const FIELDS = ["abstract", "introduction", "discussion", "conclusion"] as const;

function narrative(d: Record<string, unknown>): Record<string, string> {
  return {
    abstract: String(d.abstract || ""),
    introduction: String(d.introduction || ""),
    discussion: String(d.discussion || ""),
    conclusion: String(d.conclusion || "")
  };
}

test("deterministic commentary returns the full field contract", () => {
  const out = generateDeterministicCommentary({
    selectedQuestion:
      "In women with a short cervix, does vaginal progesterone compared with placebo improve spontaneous preterm birth?",
    outcomesText: "spontaneous preterm birth",
    reason: "no AI provider key is configured for this instance",
    pool: CERVIX_RECORDS,
    elements: CERVIX
  });

  for (const f of ["title", "abstract", "keywords", "introduction", "discussion", "conclusion", "references"]) {
    assert.ok(f in out, `missing field: ${f}`);
  }
  assert.ok(Array.isArray(out.keywords));
  assert.ok(Array.isArray(out.references));
});

test("every listed reference is cited, and every citation resolves", () => {
  const out = generateDeterministicCommentary({
    selectedQuestion:
      "In women with a short cervix, does vaginal progesterone compared with placebo improve spontaneous preterm birth?",
    outcomesText: "spontaneous preterm birth",
    reason: "no AI provider key is configured for this instance",
    pool: CERVIX_RECORDS,
    elements: CERVIX
  });

  const refs = out.references as string[];
  assert.equal(refs.length, 3, "all three retained records should be published");

  // The regression: the previous version listed up to eight references and cited only the first,
  // which the integrity gate reports as uncited references.
  const checks = checkCitations(String(out.discussion), refs);
  assert.deepEqual(checks.uncited, [], "every published reference must be cited");
  assert.deepEqual(checks.orphans, [], "every citation must name a published reference");
  assert.equal(checks.consistent, true);
  assert.equal(checks.citedRefs, refs.length);
});

test("citation tokens are non-empty and parse back to the record they name", () => {
  const out = generateDeterministicCommentary({
    selectedQuestion:
      "In women with a short cervix, does vaginal progesterone compared with placebo improve spontaneous preterm birth?",
    outcomesText: "spontaneous preterm birth",
    reason: "no AI provider key is configured for this instance",
    pool: CERVIX_RECORDS,
    elements: CERVIX
  });

  const refs = out.references as string[];
  // The regression: citation tokens were built from a bare author list ("Owen C, Greiner K")
  // instead of the formatted reference, so every token came back empty and the bibliography was
  // dropped entirely.
  for (const ref of refs) {
    const parsed = refSurnameYear(ref);
    assert.ok(parsed, `reference has no resolvable citation: ${ref}`);
    assert.ok(parsed.surname.length > 0, `empty surname for: ${ref}`);
    assert.match(parsed.year, /^(19|20)\d{2}$/);
  }
  assert.match(String(out.discussion), /\(Kumar 2026\)/);
});

test("keywords come from this question's PICO, not a hardcoded list", () => {
  const out = generateDeterministicCommentary({
    selectedQuestion:
      "In women with a short cervix, does vaginal progesterone compared with placebo improve spontaneous preterm birth?",
    outcomesText: "spontaneous preterm birth",
    reason: "no AI provider key is configured for this instance",
    pool: CERVIX_RECORDS,
    elements: CERVIX
  });

  const kw = (out.keywords as string[]).map(k => k.toLowerCase());
  assert.ok(kw.includes("vaginal progesterone"), "intervention should appear as a phrase");

  // An unrelated question must not inherit this one's vocabulary.
  const other = generateDeterministicCommentary({
    selectedQuestion: "In women with unexplained infertility, does myosin-inhibitor ultrasound versus standard timing improve live birth?",
    outcomesText: "live birth",
    reason: "the AI writing service did not respond",
    pool: CERVIX_RECORDS,
    elements: [
      { label: "P — Population", value: "Women with unexplained infertility" },
      { label: "I — Intervention", value: "Myosin-inhibitor ultrasound" },
      { label: "C — Comparator", value: "Standard timing" }
    ]
  });
  const otherKw = (other.keywords as string[]).map(k => k.toLowerCase());
  assert.ok(
    otherKw.includes("myosin-inhibitor ultrasound"),
    `unrelated question keywords should come from its own PICO: ${JSON.stringify(other.keywords)}`
  );
  for (const leaked of ["vaginal progesterone", "placebo", "short cervix", "cerclage"]) {
    assert.ok(!otherKw.includes(leaked), `leaked unrelated keyword: ${leaked}`);
  }
});

test("the text asserts no clinical finding", () => {
  const out = generateDeterministicCommentary({
    selectedQuestion:
      "In women with a short cervix, does vaginal progesterone compared with placebo improve spontaneous preterm birth?",
    outcomesText: "spontaneous preterm birth",
    reason: "no AI provider key is configured for this instance",
    pool: CERVIX_RECORDS,
    elements: CERVIX
  });

  const text = Object.values(narrative(out)).join(" ").toLowerCase();
  // "supports the evaluated comparison" is the exact fabricated claim the previous version opened
  // with. It reported a conclusion from records it had never read.
  for (const phrase of [
    "supports the evaluated comparison",
    "the evidence supports",
    "demonstrates that",
    "confirms that",
    "proves that",
    "should be recommended",
    "is effective"
  ]) {
    assert.ok(!text.includes(phrase), `fabricated claim present: ${phrase}`);
  }
  assert.ok(!/risk ratio|p = 0\.|95% ci/i.test(text), "no effect estimate may be invented");
});

test("the reason no synthesis was produced is stated to the reader", () => {
  const out = generateDeterministicCommentary({
    selectedQuestion: "Does X compared with Y improve Z?",
    outcomesText: "Z",
    reason: "no AI provider key is configured for this instance",
    pool: CERVIX_RECORDS,
    elements: CERVIX
  });
  const text = Object.values(narrative(out)).join(" ");
  assert.ok(text.includes("no AI provider key is configured for this instance"));
  assert.ok(/evidence list, not as a review/i.test(text));
});

test("records with no resolvable citation are dropped rather than published uncited", () => {
  const out = generateDeterministicCommentary({
    selectedQuestion: "Does X compared with Y improve Z?",
    outcomesText: "Z",
    reason: "no AI provider key is configured for this instance",
    pool: [{ title: "Untitled record with no author and no year" }, ...CERVIX_RECORDS],
    elements: CERVIX
  });

  const refs = out.references as string[];
  assert.equal(refs.length, 3);
  assert.ok(!refs.some(r => /Untitled record/.test(r)));
  // The count in the prose must match what is actually published.
  assert.match(String(out.discussion), /^3 records/);
});

test("an empty pool degrades without throwing and cites nothing", () => {
  const out = generateDeterministicCommentary({
    selectedQuestion: "Does X compared with Y improve Z?",
    outcomesText: "Z",
    reason: "no AI provider key is configured for this instance",
    pool: [],
    elements: []
  });

  assert.deepEqual(out.references, []);
  assert.ok(!/\(\s*\)/.test(String(out.discussion)), "no empty citation tokens");
  assert.ok(!/\(\s*,\s*\)/.test(String(out.discussion)), "no comma-only citation tokens");
  assert.match(String(out.discussion), /No records with a verifiable citation were retained/);

  // With no PICO to draw phrases from, the fallback reads the question. Verbs and comparators are
  // not search terms, so they must not survive: "compared, improve" is what it used to publish.
  const kw = out.keywords as string[];
  assert.ok(kw.length <= 6, "keyword list stays bounded");
  for (const junk of ["compared", "improve", "does", "with"]) {
    assert.ok(!kw.some(k => k.toLowerCase() === junk), `question verb leaked into keywords: ${junk}`);
  }
});

test("missing inputs fall back to explicit placeholders instead of empty prose", () => {
  const out = generateDeterministicCommentary({
    selectedQuestion: "",
    outcomesText: "",
    reason: "no AI provider key is configured for this instance",
    pool: CERVIX_RECORDS,
    elements: []
  });
  assert.match(String(out.title), /the selected clinical question/);
  assert.match(String(out.abstract), /the selected outcome/);
});

test("integrates with the real pipeline: no claim rewrite, integrity gate passes", async () => {
  const elements = CERVIX;
  // Mirror the route exactly: the claim filter runs first and its verdict is what gives the
  // evidence set its per-element audit data. Skipping it makes `finalizeClaims` report
  // `pico-not-addressed` for every claim, which would test a pipeline the product never runs.
  const { kept: directPool } = filterByClaim(CERVIX_RECORDS, elements);
  assert.ok(directPool.length > 0, "fixture must survive claim filtering");
  const evidenceSet = await buildEvidenceSet(directPool as AuditableRef[]);
  const out = generateDeterministicCommentary({
    selectedQuestion:
      "In women with a short cervix, does vaginal progesterone compared with placebo improve spontaneous preterm birth?",
    outcomesText: "spontaneous preterm birth",
    reason: "no AI provider key is configured for this instance",
    pool: evidenceSet.retainedRecords as AuditableRef[],
    elements
  });

  const finalized = finalizeClaims({
    fields: narrative(out),
    evidenceSet,
    elements
  });

  // The regression that only a live probe caught: restating the question names clinical concepts,
  // so `finalizeClaims` replaced the abstract and introduction openings with an uncertainty
  // notice. The fix was to put the citations inside the question's own sentence, because the "?"
  // is itself a sentence boundary.
  assert.deepEqual(finalized.warnings, [], "deterministic prose must survive claim finalization");
  assert.deepEqual(finalized.limitations, []);

  const fields = FIELDS.reduce<Record<string, string>>((acc, f) => {
    acc[f] = finalized.fields[f];
    return acc;
  }, {});

  const integrity = validateDeliverableIntegrity({
    fields,
    references: out.references as string[],
    retainedRecords: evidenceSet.retainedRecords as AuditableRef[],
    allowedKeys: evidenceSet.allowedCitationKeys,
    citationMap: evidenceSet.citationMap
  });

  assert.equal(integrity.ok, true, `integrity failed: ${JSON.stringify(integrity)}`);
});

test("the reference pool is capped so a large pool cannot flood the paper", () => {
  const many: AuditableRef[] = Array.from({ length: 40 }, (_, i) => ({
    authors: `Author${i} A, Coauthor B`,
    year: String(2000 + i),
    title: `Study number ${i}`,
    journal: "Test Journal"
  }));

  const out = generateDeterministicCommentary({
    selectedQuestion: "Does X compared with Y improve Z?",
    outcomesText: "Z",
    reason: "no AI provider key is configured for this instance",
    pool: many,
    elements: CERVIX
  });

  assert.equal((out.references as string[]).length, 8);
  const checks = checkCitations(String(out.discussion), out.references as string[]);
  assert.deepEqual(checks.uncited, []);
  assert.deepEqual(checks.orphans, []);
});
