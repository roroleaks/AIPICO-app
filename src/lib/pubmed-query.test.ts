import test from "node:test";
import assert from "node:assert/strict";
import {
  MESH_DESCRIPTORS,
  buildCacheKey,
  buildCandidates,
  buildConceptClause,
  buildInterventionClause,
  resolveMeshDescriptors,
  sanitizePhrase,
  checkQueryScope,
  checkQueryVagueness
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

test("boundary test suite: specialty scope gating and vagueness checks (DEF-012, DEF-008)", () => {
  // In-scope maternal cardiology / OB-GYN queries must NOT be refused
  const inScopeCases = [
    { name: "peripartum cardiomyopathy", input: { population: "peripartum cardiomyopathy", intervention: "bromocriptine" } },
    { name: "cardiac disease in pregnancy", input: { population: "cardiac disease in pregnancy", intervention: "beta blockers" } },
    { name: "preeclampsia and cardiovascular risk", input: { population: "preeclampsia", intervention: "cardiovascular risk" } },
    { name: "ovarian stimulation in women with heart disease", input: { population: "women with heart disease", intervention: "ovarian stimulation" } },
    { name: "PCOS and metabolic syndrome", input: { population: "PCOS", intervention: "metabolic syndrome" } },
    { name: "gestational diabetes and neonatal outcomes", input: { population: "gestational diabetes", intervention: "dietary counseling", outcome: "neonatal outcomes" } },
    { name: "thin endometrium intrauterine PRP", input: { population: "thin endometrium", intervention: "intrauterine PRP" } },
  ];

  for (const c of inScopeCases) {
    const scope = checkQueryScope(c.input);
    assert.equal(scope.inScope, true, `Expected ${c.name} to be inScope: true, got: ${JSON.stringify(scope)}`);
  }

  // Out-of-scope non-OB/GYN queries MUST be refused
  const outOfScopeCases = [
    { name: "chest pain in a 55-year-old man", input: { population: "chest pain in a 55-year-old man", intervention: "aspirin" }, expSpecialty: "Cardiology" },
    { name: "knee osteoarthritis injections", input: { population: "knee osteoarthritis", intervention: "corticosteroid injections" }, expSpecialty: "Orthopedics & Rheumatology" },
  ];

  for (const c of outOfScopeCases) {
    const scope = checkQueryScope(c.input);
    assert.equal(scope.inScope, false, `Expected ${c.name} to be refused (inScope: false), got: ${JSON.stringify(scope)}`);
    assert.equal(scope.specialty, c.expSpecialty);
  }

  // Underspecified queries MUST be flagged as vague / needing clarification
  const vagueCases = [
    { name: "PCOS alone", input: { population: "PCOS" } },
    { name: "infertility alone", input: { population: "infertility" } },
    { name: "women treatment better outcome", input: { population: "women", intervention: "treatment", comparator: "better", outcome: "outcome" } }
  ];

  for (const c of vagueCases) {
    const vagueness = checkQueryVagueness(c.input);
    assert.equal(vagueness.isVague, true, `Expected ${c.name} to be flagged as isVague: true`);
  }
});

test("conjunction tokens split into operands with AND/OR and preserve MeSH descriptors (DEF-010)", () => {
  // Conjunction "or" joins operands with OR union
  const orClause = buildConceptClause("metformin or insulin");
  assert.equal(orClause, '("metformin"[tiab] OR "insulin"[tiab])');

  // Conjunction "and" joins operands with AND of [tiab] terms
  const andClause = buildConceptClause("labor and delivery");
  assert.equal(andClause, '("labor"[tiab] AND "delivery"[tiab])');

  // MeSH mappings on operands are preserved
  const meshClause = buildConceptClause("PCOS and infertility");
  assert.ok(meshClause.includes('"Polycystic Ovary Syndrome"[MeSH Terms]'));
  assert.ok(meshClause.includes('"Infertility"[MeSH Terms]'));
  assert.ok(meshClause.includes(" AND "));
});
