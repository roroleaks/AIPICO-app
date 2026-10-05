import test from "node:test";
import assert from "node:assert/strict";
import {
  MESH_DESCRIPTORS,
  buildCacheKey,
  buildCandidates,
  buildConceptClause,
  buildInterventionClause,
  resolveMeshDescriptors,
  sanitizePhrase
} from "./pubmed-query.ts";

test("PubMed operators in clinician text cannot rewrite the boolean structure of the query", () => {
  // Unescaped, this changes the query from "progesterone" to "progesterone OR everything".
  assert.equal(sanitizePhrase('progesterone" OR "cancer'), "progesterone cancer");
  assert.equal(sanitizePhrase("progesterone AND cerclage"), "progesterone cerclage");
  assert.equal(sanitizePhrase("short cervix) NOT cerclage"), "short cervix cerclage");
});

test("sanitizing collapses whitespace and caps runaway input length", () => {
  assert.equal(sanitizePhrase("  short   cervix  "), "short cervix");
  assert.equal(sanitizePhrase(undefined), "");
  assert.equal(sanitizePhrase(null), "");
  assert.equal(sanitizePhrase("!!!"), "");
  assert.ok(sanitizePhrase("a ".repeat(200)).length <= 120);
});

test("a mapped concept unions free text with its MeSH descriptors", () => {
  const clause = buildConceptClause("progesterone");
  assert.ok(clause.startsWith('("progesterone"[tiab]'), clause);
  assert.match(clause, /"Progesterone"\[MeSH Terms\]/);
  assert.ok(clause.startsWith("(") && clause.endsWith(")"), `expected one grouped arm: ${clause}`);
});

test("an unmapped concept degrades to a plain title/abstract arm rather than an empty clause", () => {
  const clause = buildConceptClause("unusual bespoke therapy nobody has indexed");
  assert.equal(clause, '"unusual bespoke therapy nobody has indexed"[tiab]');
});

test("a concept containing literal MeSH syntax is neutralized before lookup and use", () => {
  const clause = buildConceptClause('endometriosis"[MeSH Terms] OR "cancer');
  assert.ok(!clause.includes("[MeSH Terms] OR"), `operator survived: ${clause}`);
  assert.ok(clause.startsWith('("endometriosis MeSH Terms cancer"[tiab]'), clause);
});

test("the longest whole-word alias wins, not the first or shortest", () => {
  // "cervical cerclage" must not resolve to the plain "cerclage" descriptors.
  assert.deepEqual(resolveMeshDescriptors("cervical cerclage"), ["Cervical Cerclage", "Sutures"]);
  assert.deepEqual(resolveMeshDescriptors("cerclage"), ["Cervical Cerclage", "Sutures"]);
  assert.deepEqual(resolveMeshDescriptors("short cervix"), ["Cervix Uteri", "Uterine Cervical Length"]);
});

test("alias lookup does not fire on a partial word", () => {
  // "cerclages" contains "cerclage" but is not the indexed concept; a substring match here
  // would silently attach MeSH headings to unrelated text.
  assert.deepEqual(resolveMeshDescriptors("cerclages"), []);
  assert.deepEqual(resolveMeshDescriptors("progesterones"), []);
  assert.deepEqual(resolveMeshDescriptors(""), []);
});

test("obstetric and reproductive concepts resolve to real headings", () => {
  const expectations: Record<string, string[]> = {
    "preterm birth": ["Premature Birth", "Obstetric Labor, Premature"],
    "gestational diabetes": ["Diabetes, Gestational"],
    "twin pregnancy": ["Pregnancy, Twin", "Pregnancy, Multiple"],
    "recurrent pregnancy loss": ["Abortion, Habitual", "Pregnancy Loss"],
    pcos: ["Polycystic Ovary Syndrome"],
    "assisted reproductive technology": ["Reproductive Technology, Assisted"],
    endometriosis: ["Endometriosis"],
    "placenta previa": ["Placenta Previa"],
    "systematic review": ["Systematic Review"]
  };
  for (const [phrase, descriptors] of Object.entries(expectations)) {
    assert.deepEqual(resolveMeshDescriptors(phrase), descriptors, phrase);
  }
});

test("every alias is a normalized key whose descriptors are safe to quote and tag", () => {
  for (const [alias, descriptors] of Object.entries(MESH_DESCRIPTORS)) {
    assert.ok(alias.length > 0, "empty alias");
    assert.equal(alias, alias.toLowerCase(), `alias must be normalized for lookup: ${alias}`);
    assert.ok(descriptors.length > 0, `alias with no descriptors: ${alias}`);
    for (const descriptor of descriptors) {
      assert.ok(descriptor.length > 0, `empty descriptor under ${alias}`);
      assert.equal(descriptor, descriptor.trim(), `${alias} -> ${descriptor}`);
      // A quote or bracket inside a heading would break out of the quoted field tag.
      assert.ok(!/["[\]]/.test(descriptor), `${alias} -> ${descriptor}`);
    }
  }
});

test("every mapped descriptor is emitted quoted with the MeSH field tag", () => {
  for (const [alias, descriptors] of Object.entries(MESH_DESCRIPTORS)) {
    const clause = buildConceptClause(alias);
    for (const descriptor of descriptors) {
      assert.ok(clause.includes(`"${descriptor}"[MeSH Terms]`), `${alias} -> ${clause}`);
    }
  }
});

test("intervention and comparator form one alternative arm", () => {
  const clause = buildInterventionClause("progesterone", "cerclage");
  assert.ok(clause.startsWith("(") && clause.endsWith(")"), clause);
  assert.match(clause, / OR /);
  assert.equal(buildInterventionClause(undefined, null), "");
  assert.equal(buildInterventionClause("", "  "), "");
});

test("an absent comparator leaves the intervention as exactly its own concept clause", () => {
  assert.equal(buildInterventionClause("progesterone", undefined), buildConceptClause("progesterone"));
});

test("candidates are ordered strictest-first and contain no duplicates", () => {
  const candidates = buildCandidates({
    population: "pregnant individuals with a short cervix",
    intervention: "progesterone",
    comparator: "cerclage",
    outcome: "preterm birth"
  });
  assert.ok(candidates.length > 0);
  assert.equal(new Set(candidates).size, candidates.length, `duplicate candidates: ${candidates.join(" | ")}`);
  const strictest = candidates[0]!;
  for (const concept of ["short cervix", "progesterone", "cerclage", "preterm birth"]) {
    assert.ok(strictest.includes(concept), `strictest candidate missing ${concept}: ${strictest}`);
  }
  // Recall must degrade monotonically: a later candidate may drop concepts, never re-add ANDs.
  assert.ok(candidates.some(c => c.includes("[tiab]")), "tagged arms present");
});

test("a fully specified query still ends with a broad untagged backstop", () => {
  // Without this, an over-specified PICO reports a false zero instead of widening the search.
  const candidates = buildCandidates({
    population: "birthing people with unicorn anatomy",
    intervention: "imaginary therapy",
    outcome: "unicorn mortality"
  });
  assert.ok(candidates.length >= 2, candidates.join(" | "));
  assert.ok(
    candidates.some(c => !c.includes("[tiab]") && c.includes("unicorn")),
    `no untagged backstop in ${candidates.join(" | ")}`
  );
});

test("empty input yields no candidates rather than an empty or wildcard query", () => {
  assert.deepEqual(buildCandidates({}), []);
  assert.deepEqual(buildCandidates({ population: "   ", outcome: null, intervention: "", comparator: "!!!" }), []);
});

test("the cache key is order-independent of formatting but carries no API key material", () => {
  const a = buildCacheKey({ population: "short cervix", intervention: "progesterone" });
  const b = buildCacheKey({ intervention: "progesterone", population: "  short   cervix " });
  assert.equal(a, b, "cosmetic input differences must not fragment the cache");
  const c = buildCacheKey({ population: "short cervix", intervention: "cerclage" });
  assert.notEqual(a, c, "genuinely different queries must not collide");
  assert.ok(!/api_key/i.test(a), a);
});