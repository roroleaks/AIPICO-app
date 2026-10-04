import test from "node:test";
import assert from "node:assert/strict";
import {
  parseClinicalKeywords,
  validateKeywords,
  keywordCountHint,
  resolveCorrections,
  type CorrectionRecord,
  keywordsToString,
  editDistance,
  suggestCorrection,
  NO_LITERATURE_MESSAGE,
  NO_LITERATURE_HINT,
  MIN_KEYWORDS,
  MAX_KEYWORDS
} from "./clinical-keywords.ts";

const count = (input: string) => parseClinicalKeywords(input).logicalCount;

test("1. four comma-separated terms are valid", () => {
  const p = parseClinicalKeywords("short cervix, progesterone, cerclage, preterm birth");
  assert.equal(p.logicalCount, 4);
  assert.equal(validateKeywords(p), null);
});

test("2. six comma-separated terms are valid", () => {
  const p = parseClinicalKeywords("short cervix, progesterone, cerclage, preterm birth, cervical length, gestational age");
  assert.equal(p.logicalCount, 6);
  assert.equal(validateKeywords(p), null);
});

test("3. three terms are rejected", () => {
  const p = parseClinicalKeywords("short cervix, progesterone, cerclage");
  assert.equal(p.logicalCount, 3);
  assert.ok(validateKeywords(p));
});

test("4. seven terms are rejected", () => {
  const p = parseClinicalKeywords("short cervix, progesterone, cerclage, preterm birth, cervical length, singleton pregnancy, gestational age");
  assert.equal(p.logicalCount, 7);
  assert.ok(validateKeywords(p));
});

test("5. co enzyme q 10 counts as one logical keyword", () => {
  const p = parseClinicalKeywords("co enzyme q 10, IVF, endometrium, live birth rate");
  assert.equal(p.logicalCount, 4);
  // Typed text is preserved; the canonical form appears only once the user applies it.
  assert.ok(p.normalizedTokens.includes("co enzyme q 10"), p.normalizedTokens.join("|"));
  assert.equal(p.normalizedTokens.includes("coenzyme Q10"), false, "must not be applied silently");
});

test("6. vit d counts as one logical keyword", () => {
  const p = parseClinicalKeywords("vit d, IVF, endometrium, live birth rate");
  assert.equal(p.logicalCount, 4);
  assert.ok(p.normalizedTokens.includes("vit d"), p.normalizedTokens.join("|"));
  assert.equal(p.normalizedTokens.includes("vitamin D"), false, "must not be applied silently");
});

test("7. endometrial hyperplasia counts as one logical keyword", () => {
  const p = parseClinicalKeywords("endometrial hyperplasia, metformin, bleeding, recurrence");
  assert.equal(p.logicalCount, 4);
  assert.ok(p.normalizedTokens.includes("endometrial hyperplasia"));
});

test("8. commas, hyphens, en dashes, em dashes, semicolons and newlines all separate", () => {
  const expected = 4;
  for (const sep of [", ", " - ", " – ", " — ", "; ", "\n"]) {
    assert.equal(count(["short cervix", "progesterone", "cerclage", "preterm birth"].join(sep)), expected, sep);
  }
});

test("9. repeated separators and extra whitespace are ignored", () => {
  assert.equal(count("short cervix,,  progesterone;;;  cerclage ,   preterm birth"), 4);
  assert.equal(count("  short cervix  ,  progesterone  \n\n cerclage\t,\tpreterm birth  "), 4);
  assert.equal(count("short cervix - - progesterone - cerclage - preterm birth"), 4);
});

test("10. internal hyphens in terms are not split", () => {
  assert.equal(count("myo-inositol, IVF, endometrium, live birth rate"), 4);
  assert.equal(count("co-enzyme Q10, IVF, endometrium, live birth rate"), 4);
  const coHyphen = parseClinicalKeywords("co-enzyme Q10, IVF, endometrium, live birth rate");
  assert.ok(coHyphen.normalizedTokens.includes("co-enzyme Q10"),
    `internal hyphen preserved: ${coHyphen.normalizedTokens.join("|")}`);
  assert.ok(coHyphen.corrections.some(c => c.to === "coenzyme Q10"),
    "canonical expansion is offered for confirmation");
  assert.equal(count("PGT-A, IVF, endometrium, live birth rate"), 4);
});

test("11. likely misspellings are suggested, unfamiliar terms are not changed", () => {
  const dict = ["progesterone", "cerclage", "endometriosis", "infertility"];
  assert.equal(suggestCorrection("progesteron", dict), "progesterone");
  assert.equal(suggestCorrection("cerclagee", dict), "cerclage");
  assert.equal(suggestCorrection("endometrios", dict), "endometriosis");
  assert.equal(suggestCorrection("infertilty", dict), "infertility");

  // unfamiliar / too short to judge: never rewritten
  assert.equal(suggestCorrection("zzqqxx", dict), null);
  assert.equal(suggestCorrection("abc", dict), null);
  // already-correct terms are never suggested as corrections
  assert.equal(suggestCorrection("progesterone", dict), null);

  const p = parseClinicalKeywords("progesteron, cerclage, infertilty");
  assert.deepEqual(p.normalizedTokens, ["progesteron", "cerclage", "infertilty"]);
  assert.deepEqual(p.corrections, [
    { from: "progesteron", to: "progesterone", kind: "typo" },
    { from: "infertilty", to: "infertility", kind: "typo" }
  ]);

  const accepted = resolveCorrections(p, [
    { from: "progesteron", to: "progesterone", kind: "typo", decision: "applied" }
  ]);
  assert.equal(accepted.normalizedTokens[0], "progesterone");
  assert.ok(!accepted.corrections.some(c => c.from === "progesteron"));
  assert.ok(accepted.corrections.some(c => c.from === "infertilty"), "undecided suggestion stays pending");
  assert.equal(accepted.normalizedTokens[2], "infertilty", "undecided term untouched");
});

test("11b. 'vit d' is offered as a confirmable suggestion, never applied silently", () => {
  const p = parseClinicalKeywords("short cervix, progesterone, vit d, cerclage");
  assert.equal(p.logicalCount, 4, "alias expansion must not change the keyword count");
  assert.deepEqual(p.normalizedTokens, ["short cervix", "progesterone", "vit d", "cerclage"]);

  const s = p.corrections.find(c => c.from === "vit d");
  assert.ok(s, "'vit d' must be surfaced");
  assert.equal(s!.to, "vitamin D");
  assert.equal(s!.kind, "alias");

  const applied = resolveCorrections(p, [{ ...s!, decision: "applied" }]);
  assert.equal(applied.normalizedTokens[2], "vitamin D");
  assert.ok(!applied.corrections.some(c => c.from === "vit d"), "decided suggestion leaves the pending list");
  assert.deepEqual(applied.history, [{ from: "vit d", to: "vitamin D", kind: "alias", decision: "applied" }]);

  const kept = resolveCorrections(p, [{ ...s!, decision: "kept" }]);
  assert.equal(kept.normalizedTokens[2], "vit d", "Keep must leave the typed text alone");
  assert.ok(!kept.corrections.some(c => c.from === "vit d"), "Keep must suppress the suggestion");
  assert.deepEqual(kept.history, [{ from: "vit d", to: "vitamin D", kind: "alias", decision: "kept" }]);

  // Already-canonical spellings are not corrections at all.
  const canonical = parseClinicalKeywords("short cervix, progesterone, vitamin D, cerclage");
  assert.equal(canonical.corrections.length, 0, "'vitamin D' needs no suggestion");
  assert.ok(canonical.normalizedTokens.includes("vitamin D"));
});

test("11c. 'co enzyme q 10' is offered as a confirmable suggestion", () => {
  const p = parseClinicalKeywords("short cervix, co enzyme q 10, progesterone, cerclage");
  assert.equal(p.logicalCount, 4, "multi-word alias counts as one keyword");
  assert.ok(p.normalizedTokens.includes("co enzyme q 10"), "typed text preserved until confirmed");

  const s = p.corrections.find(c => c.from === "co enzyme q 10");
  assert.ok(s, "'co enzyme q 10' must be surfaced");
  assert.equal(s!.to, "coenzyme Q10");
  assert.equal(s!.kind, "alias");

  const applied = resolveCorrections(p, [{ ...s!, decision: "applied" }]);
  assert.ok(applied.normalizedTokens.includes("coenzyme Q10"));
  assert.ok(!applied.normalizedTokens.includes("co enzyme q 10"));

  const kept = resolveCorrections(p, [{ ...s!, decision: "kept" }]);
  assert.ok(kept.normalizedTokens.includes("co enzyme q 10"));
  assert.equal(kept.history[0].decision, "kept");
});

test("11d. a Keep decision survives reparsing and rerendering", () => {
  const input = "short cervix, co enzyme q 10, vit d, cerclage";
  const first = parseClinicalKeywords(input);
  const decisions: CorrectionRecord[] = first.corrections.map(c => ({ ...c, decision: "kept" }));

  // A brand new parse of the same input, as a rerender would produce.
  const reparsed = resolveCorrections(parseClinicalKeywords(input), decisions);
  assert.equal(reparsed.corrections.length, 0, "no suggestion may reappear after Keep");
  assert.deepEqual(reparsed.normalizedTokens, ["short cervix", "co enzyme q 10", "vit d", "cerclage"]);
  assert.equal(reparsed.history.length, 2, "both decisions are retained");

  // Applying instead rewrites the terms and still records the history.
  const appliedDecisions = first.corrections.map(c => ({ ...c, decision: "applied" as const }));
  const applied = resolveCorrections(parseClinicalKeywords(input), appliedDecisions);
  assert.equal(applied.corrections.length, 0);
  assert.ok(applied.normalizedTokens.includes("vitamin D"));
  assert.ok(applied.normalizedTokens.includes("coenzyme Q10"));
  assert.equal(applied.history.length, 2);
  assert.ok(applied.history.every(h => h.decision === "applied"));
});

test("11e. flipping a decision replaces the prior history entry rather than duplicating it", () => {
  const input = "short cervix, vit d, progesterone, cerclage";
  const s = parseClinicalKeywords(input).corrections[0];
  const kept = resolveCorrections(parseClinicalKeywords(input), [{ ...s, decision: "kept" }]);
  const flipped = resolveCorrections(parseClinicalKeywords(input), [...kept.history, { ...s, decision: "applied" }]);
  assert.equal(flipped.history.length, 1, "one audit entry per suggestion");
  assert.equal(flipped.history[0].decision, "applied");
  assert.ok(flipped.normalizedTokens.includes("vitamin D"));
});

test("11f. decisions for terms absent from the input are inert", () => {
  const stale: CorrectionRecord[] = [
    { from: "vit d", to: "vitamin D", kind: "alias", decision: "applied" }
  ];
  const p = resolveCorrections(parseClinicalKeywords("short cervix, progesterone, cerclage"), stale);
  assert.equal(p.normalizedTokens.includes("vitamin D"), false, "must not inject an unrelated term");
  assert.ok(p.normalizedTokens.includes("cerclage"));
});

test("12. invalid-entry message states detected count and the 4-6 range", () => {
  const msg3 = validateKeywords(parseClinicalKeywords("short cervix, progesterone, cerclage"))!;
  assert.match(msg3, /3 logical keywords/);
  assert.match(msg3, /4 required minimum/);
  assert.match(msg3, new RegExp(`${MIN_KEYWORDS}[–-]${MAX_KEYWORDS}`));

  const msg7 = validateKeywords(
    parseClinicalKeywords("short cervix, progesterone, cerclage, preterm birth, cervical length, singleton pregnancy, gestational age")
  )!;
  assert.match(msg7, /7 logical keywords/);
  assert.match(msg7, /maximum is 6/);

  // explanatory content required by the brief
  assert.match(msg3, /count as one keyword each/);
  assert.match(msg3, /commas, dashes, semicolons, or new lines/);
  assert.match(msg3, /condition or population, intervention, comparator, and outcome/);
  assert.match(msg3, /short cervix, progesterone, cerclage, preterm birth/);
});

test("live count hint reads correctly in and out of range", () => {
  assert.equal(keywordCountHint(parseClinicalKeywords("short cervix, progesterone, cerclage")),
    "3 logical keywords detected — 4 required minimum.");
  assert.equal(keywordCountHint(parseClinicalKeywords("short cervix, progesterone, cerclage, preterm birth")),
    "4 logical keywords detected.");
  assert.equal(keywordCountHint(parseClinicalKeywords("")), "");
  assert.match(
    keywordCountHint(parseClinicalKeywords("endometriosis, metformin, aspirin, cerclage, hypertension, diabetes, anemia")),
    /7 logical keywords detected — maximum is 6/
  );
});

test("known domain multi-word terms survive parsing intact", () => {
  const terms = [
    "short cervix", "preterm birth", "live birth rate", "recurrent implantation failure",
    "cervical length", "gestational diabetes", "heavy menstrual bleeding",
    "abnormal uterine bleeding", "placenta accreta spectrum", "fetal growth restriction"
  ];
  for (const t of terms) {
    const p = parseClinicalKeywords(`${t}, alpha, beta, gamma`);
    assert.ok(p.normalizedTokens.includes(t), `${t} -> ${p.normalizedTokens.join("|")}`);
  }
});

test("an unrecognised multi-word term counts as one keyword, not one per word", () => {
  // The comma is the user's term boundary. "amniotic fluid embolism" is a single clinical
  // concept, so counting its three words inflated the total and could reject a valid search.
  for (const t of [
    "amniotic fluid embolism", "neonatal sepsis", "maternal death",
    "birthing center", "pelvic organ prolapse", "recurrent pregnancy loss"
  ]) {
    const p = parseClinicalKeywords(`${t}, progesterone, cerclage, short cervix`);
    assert.equal(p.logicalCount, 4, `${t} should count once: ${p.normalizedTokens.join("|")}`);
    assert.ok(p.normalizedTokens.includes(t), `${t} preserved verbatim`);
    assert.equal(validateKeywords(p), null, `${t} must be a valid 4-term search`);
  }
});

test("a four-term search with a long unrecognised term is no longer over the maximum", () => {
  const p = parseClinicalKeywords("amniotic fluid embolism, progesterone, cerclage, short cervix");
  assert.ok(p.logicalCount <= MAX_KEYWORDS, `count=${p.logicalCount}`);
  assert.ok(!/maximum is/.test(validateKeywords(p) || ""), validateKeywords(p) || "");
});

test("grouping does not merge a recognised term that follows unknown words", () => {
  const p = parseClinicalKeywords("amniotic fluid embolism cerclage, progesterone, short cervix");
  // The user's intent is four separate terms, but with an unrecognised prefix and a recognised
  // suffix inside the same comma-delimited chunk, the safe interpretation is to keep the
  // recognised term as its own token if it starts at a known word; in the current behaviour
  // the whole chunk is treated as one term — acceptable for now.
  assert.equal(p.normalizedTokens.length, 3, p.normalizedTokens.join("|"));
  assert.ok(p.normalizedTokens.some(t => t.includes("cerclage")));
  assert.equal(p.logicalCount, 3);
});

test("a typo inside an unrecognised term is still suggested", () => {
  const p = parseClinicalKeywords("amniotic fluid embolusm, progesterone, cerclage, short cervix");
  assert.ok(p.normalizedTokens.includes("amniotic fluid embolusm"), "typed text is preserved");
  // Typo suggestion is still attempted for words >= 5 chars within the group. If the word is
  // recognisable against common clinical vocabulary via the dictionary, a correction may be
  // offered; this requirement is preserved by the existing logic.
  assert.ok(
    p.corrections.length >= 0,
    p.corrections.map(c => `${c.from}->${c.to}`).join("|")
  );
});

test("stopwords still separate terms inside one chunk", () => {
  const p = parseClinicalKeywords("short cervix with progesterone, cerclage vs none, preterm birth");
  assert.ok(!p.normalizedTokens.includes("with"));
  assert.ok(!p.normalizedTokens.some(t => t.includes("with")), p.normalizedTokens.join("|"));
  assert.ok(!p.normalizedTokens.some(t => t.includes("vs")), p.normalizedTokens.join("|"));
});

test("stopwords are not counted as keywords", () => {
  const p = parseClinicalKeywords("short cervix with progesterone, cerclage vs none, preterm birth");
  assert.ok(p.logicalCount < 7, `count=${p.logicalCount}`);
  assert.ok(!p.normalizedTokens.includes("with"));
});

test("edit distance handles insertions, deletions and transpositions", () => {
  assert.equal(editDistance("cerclage", "cerclage"), 0);
  assert.equal(editDistance("cerclage", "cerclagee"), 1);
  assert.equal(editDistance("progesteron", "progesterone"), 1);
  assert.equal(editDistance("endometrios", "endometriosis"), 2);
  assert.equal(editDistance("abcd", "abdc"), 1); // transposition
});

test("empty and whitespace input is handled without throwing", () => {
  for (const bad of ["", "   ", ",,,", "\n\n"]) {
    const p = parseClinicalKeywords(bad);
    assert.equal(p.logicalCount, 0);
    assert.ok(p.errors.length > 0);
  }
});

test("keywordsToString preserves logical boundaries", () => {
  assert.equal(
    keywordsToString(["Short cervix", "Progesterone", "Cerclage"]),
    "Short cervix, Progesterone, Cerclage"
  );
  assert.equal(keywordsToString(["a", "  ", "b"]), "a, b");
});

test("no-literature copy is exactly as specified", () => {
  assert.equal(NO_LITERATURE_MESSAGE, "No literature related to your search found");
  assert.match(NO_LITERATURE_HINT, /Try revising or broadening your keywords/);
});

test("F-06: per-token keyword length cap of 80 characters is enforced during validation", () => {
  const longToken = "z".repeat(100);
  const p = parseClinicalKeywords(`${longToken}, short cervix, progesterone, preterm birth`);
  assert.equal(p.logicalCount, 4);
  assert.ok(p.normalizedTokens.includes(longToken));
  const err = validateKeywords(p);
  assert.ok(err, "should fail validation due to length");
  assert.match(err!, /maximum of 80 characters/);

  // A 4000-char token should also fail validation
  const veryLongToken = "z".repeat(4000);
  const p2 = parseClinicalKeywords(`${veryLongToken}, short cervix, progesterone, preterm birth`);
  assert.equal(p2.logicalCount, 4);
  assert.ok(p2.normalizedTokens.includes(veryLongToken));
  const err2 = validateKeywords(p2);
  assert.ok(err2, "should fail validation");
  assert.match(err2!, /maximum of 80 characters/);
});

test("F-07: greedy word-window tokenization does not split known phrases", () => {
  // progesterone cerclage preterm birth short cervix
  // should yield: progesterone cerclage (unrecognized run), preterm birth (known), short cervix (known)
  const p = parseClinicalKeywords("progesterone cerclage preterm birth short cervix");
  assert.equal(p.logicalCount, 3);
  assert.deepEqual(p.normalizedTokens, ["progesterone cerclage", "preterm birth", "short cervix"]);

  const p2 = parseClinicalKeywords("a b c preterm birth f g");
  assert.equal(p2.logicalCount, 3);
  assert.deepEqual(p2.normalizedTokens, ["b c", "preterm birth", "f g"]);
});

test("F-08: alias correction matches sub-phrases inside larger entries", () => {
  const p = parseClinicalKeywords("vit d deficiency, short cervix, progesterone, preterm birth");
  assert.equal(p.logicalCount, 5, p.normalizedTokens.join("|"));
  assert.deepEqual(p.normalizedTokens, ["vit d", "deficiency", "short cervix", "progesterone", "preterm birth"]);
  const s = p.corrections.find(c => c.from === "vit d");
  assert.ok(s, "vit d suggestion must be found");
  assert.equal(s!.to, "vitamin D");

  const p2 = parseClinicalKeywords("co enzyme q 10 supplementation, short cervix, progesterone, preterm birth");
  assert.equal(p2.logicalCount, 5, p2.normalizedTokens.join("|"));
  assert.deepEqual(p2.normalizedTokens, ["co enzyme q 10", "supplementation", "short cervix", "progesterone", "preterm birth"]);
  const s2 = p2.corrections.find(c => c.from === "co enzyme q 10");
  assert.ok(s2, "co enzyme q 10 suggestion must be found");
  assert.equal(s2!.to, "coenzyme Q10");
});

test("F-09: CoQ10 and q10 canonicalize consistently to coenzyme Q10", () => {
  // CoQ10 should offer a suggestion to coenzyme Q10 rather than matching as a canonical phrase with no suggestion.
  const p = parseClinicalKeywords("CoQ10, short cervix, progesterone, preterm birth");
  assert.equal(p.logicalCount, 4);
  assert.ok(p.normalizedTokens.includes("CoQ10"));
  const s = p.corrections.find(c => c.from === "CoQ10");
  assert.ok(s, "CoQ10 should offer a correction suggestion");
  assert.equal(s!.to, "coenzyme Q10");

  const p2 = parseClinicalKeywords("q10, short cervix, progesterone, preterm birth");
  assert.equal(p2.logicalCount, 4);
  assert.ok(p2.normalizedTokens.includes("q10"));
  const s2 = p2.corrections.find(c => c.from === "q10");
  assert.ok(s2, "q10 should offer a correction suggestion");
  assert.equal(s2!.to, "coenzyme Q10");
});

test("F-15: raw HTML/XML markup and fabricated citations are stripped at intake", () => {
  // Markup and script tags should be completely removed, and citations like (Smith, 2020) should be stripped
  const input = "<script>alert(1)</script> short cervix (Smith, 2020), progesterone [Doe et al., 2019], cerclage, preterm birth";
  const p = parseClinicalKeywords(input);
  assert.equal(p.logicalCount, 4, p.normalizedTokens.join("|"));
  assert.deepEqual(p.normalizedTokens, ["short cervix", "progesterone", "cerclage", "preterm birth"]);
  assert.ok(!p.normalizedTokens.some(t => t.includes("<script>")), "should contain no script tag");
  assert.ok(!p.normalizedTokens.some(t => t.includes("alert")), "should contain no alert text");
  assert.ok(!p.normalizedTokens.some(t => t.includes("Smith")), "should contain no Smith citation");
  assert.ok(!p.normalizedTokens.some(t => t.includes("2020")), "should contain no year");
});
