import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FREE_TEXT_LENGTH,
  MAX_OUTCOME_OPTIONS,
  MAX_OUTCOME_SELECTIONS,
  MIN_OUTCOME_OPTIONS,
  applyOutcomeAdvisory,
  areNearDuplicates,
  buildOutcomeContext,
  buildRationale,
  createUserDefinedOutcome,
  dedupeOutcomeLabels,
  normalizeOutcomeLabel,
  outcomeSelectionResponseSchema,
  parseOutcomeSelectionResponse,
  questionWantsThresholdComparison,
  scoreOutcome,
  selectOutcomes,
  stripUnsafeContent,
  validateFreeTextOutcome,
  type OutcomeContext
} from "./outcome-selection.ts";
import { OUTCOME_ONTOLOGY } from "./outcome-ontology.ts";
import { QUESTION_TYPES, type SpecialtyKey } from "./kb.ts";

const THERAPY = "Therapy / Prevention";
const DIAGNOSIS = "Diagnosis";

function context(overrides: Partial<Parameters<typeof buildOutcomeContext>[0]> = {}, extras: Parameters<typeof buildOutcomeContext>[2] = {}): OutcomeContext {
  return buildOutcomeContext(
    { specialty: "obstetrics", questionType: THERAPY, framework: "PICO", ...overrides },
    {},
    extras
  );
}

const SHORT_CERVIX = context(
  { specialty: "obstetrics", condition: "short cervix", intervention: "vaginal progesterone", comparator: "cervical cerclage" },
  { originalInput: "In pregnant women with a short cervix, does progesterone versus cerclage prevent preterm birth?", population: "pregnant women with a short cervix" }
);
const ENDOMETRIOSIS = context(
  { specialty: "gynecology", condition: "endometriosis", intervention: "GnRH agonist", comparator: "levonorgestrel IUS" },
  { originalInput: "In women with endometriosis does a GnRH agonist versus LNG-IUS improve pain?", population: "women with endometriosis" }
);
const PCOS = context(
  { specialty: "gynecology", condition: "PCOS", intervention: "letrozole", comparator: "clomiphene citrate" },
  { originalInput: "In women with PCOS does letrozole versus clomiphene improve live birth?", population: "women with PCOS" }
);
const GDM = context(
  { specialty: "obstetrics", condition: "gestational diabetes", intervention: "metformin", comparator: "insulin" },
  { originalInput: "In women with gestational diabetes does metformin versus insulin reduce macrosomia?", population: "pregnant women with gestational diabetes" }
);
const PREECLAMPSIA = context(
  { specialty: "obstetrics", condition: "preeclampsia", intervention: "low-dose aspirin", comparator: "placebo" },
  { originalInput: "In pregnant women with gestational hypertension does low-dose aspirin prevent pre-eclampsia?", population: "pregnant women with gestational hypertension" }
);
const RIF = context(
  { specialty: "infertility", condition: "recurrent implantation failure", intervention: "IVF", comparator: "IUI" },
  { originalInput: "In couples with recurrent implantation failure, does IVF versus IUI improve live birth?", population: "couples with recurrent implantation failure" }
);
const ONCOLOGY = context(
  { specialty: null, condition: "breast cancer", intervention: "tamoxifen", comparator: "placebo" },
  { originalInput: "Does tamoxifen versus placebo improve survival in breast cancer?", population: "women with breast cancer" }
);

// ---------------------------------------------------------------------------- normalization

test("OS-N01. normalization preserves the gest week threshold", () => {
  const n = normalizeOutcomeLabel("Preterm birth before 37 completed weeks");
  assert.equal(n.weeks, 37);
  assert.ok(n.tokens.includes("preterm"));
});

test("OS-N02. normalization reads a bare week unit", () => {
  assert.equal(normalizeOutcomeLabel("birth <37w").weeks, 37);
  assert.equal(normalizeOutcomeLabel("delivery at 34 weeks").weeks, 34);
});

test("OS-N03. normalization does not read a patient count as a threshold", () => {
  assert.equal(normalizeOutcomeLabel("pain score in 37 patients").weeks, null);
});

test("OS-N04. a word ending in s is never truncated (regression: endometriosis -> endometriosi)", () => {
  for (const word of ["endometriosis", "prognosis", "sepsis", "analysis", "fibrosis", "thrombosis"]) {
    const n = normalizeOutcomeLabel(word);
    assert.deepEqual(n.tokens, [word], `"${word}" must survive normalization intact`);
  }
});

test("OS-N05. two threshold values stay distinguishable", () => {
  assert.notEqual(normalizeOutcomeLabel("birth before 37 weeks").weeks, normalizeOutcomeLabel("birth before 34 weeks").weeks);
});

test("OS-N05b. the same threshold written differently is one outcome", () => {
  // The cutoff must not survive as an ordinary token, otherwise "before 37 completed weeks" and
  // "<37w" look like two different outcomes and both reach the clinician.
  assert.deepEqual(
    dedupeOutcomeLabels(["Spontaneous preterm birth before 37 completed weeks", "Spontaneous preterm birth <37w"]),
    ["Spontaneous preterm birth before 37 completed weeks"]
  );
  assert.deepEqual(
    dedupeOutcomeLabels(["Birth at 34 weeks", "Birth before 34 weeks gestation"]),
    ["Birth at 34 weeks"]
  );
});

test("OS-N06. punctuation, case and parentheticals do not change meaning", () => {
  const a = normalizeOutcomeLabel("Live birth (n=120) rate, per cycle.");
  const b = normalizeOutcomeLabel("live birth rate per cycle");
  assert.deepEqual(a.tokens, b.tokens);
});

test("OS-N07. unsafe markup and control characters are stripped", () => {
  const dirty = `<script>alert("x")</script><b>Live birth</b>\u0000\u001f rate`;
  const clean = stripUnsafeContent(dirty);
  assert.ok(!clean.includes("<"));
  assert.ok(!clean.includes("alert"));
  assert.ok(!/[\u0000-\u001f]/.test(clean));
  assert.ok(clean.includes("Live birth"));
});

test("OS-N08. case never decides whether a phrase matches", () => {
  // The phrase table is folded but the question text is not; comparing them raw meant
  // "GnRH agonist" in a question never reached the "gnrh agonist" intervention entry.
  assert.ok(ENDOMETRIOSIS.intervention.includes("GnRH"));
  const scored = scoreOutcome(OUTCOME_ONTOLOGY.find(c => c.id === "pain-reduction")!, ENDOMETRIOSIS);
  assert.equal(scored.tier, "specific");
});

// ---------------------------------------------------------------------------- dedupe

test("OS-D01. identical labels collapse", () => {
  assert.deepEqual(dedupeOutcomeLabels(["Live birth", "Live birth"]), ["Live birth"]);
});

test("OS-D02. a birth outcome is not offered twice under different wording", () => {
  assert.deepEqual(dedupeOutcomeLabels(["Birth", "Live birth", "Deliveries"]), ["Birth"]);
});

test("OS-D03. different thresholds are preserved", () => {
  const labels = dedupeOutcomeLabels(["Spontaneous preterm birth <37 weeks", "Spontaneous preterm birth <34 weeks"]);
  assert.equal(labels.length, 2);
});

test("OS-D04. distinct clinical events are not merged", () => {
  assert.ok(!areNearDuplicates("Live birth", "Miscarriage rate"));
  assert.ok(!areNearDuplicates("Preterm birth <37 weeks", "Stillbirth"));
});

test("OS-D05. plural and singular forms of one outcome collapse", () => {
  assert.deepEqual(dedupeOutcomeLabels(["Ovulation rates", "Ovulation rate"]), ["Ovulation rates"]);
});

test("OS-D06. the first occurrence wins so the ranked label survives", () => {
  assert.deepEqual(dedupeOutcomeLabels(["Live birth rate", "birth"]), ["Live birth rate"]);
});

test("OS-D07. empty and whitespace labels are dropped", () => {
  assert.deepEqual(dedupeOutcomeLabels(["", "   ", "Live birth"]), ["Live birth"]);
});

// ---------------------------------------------------------------------------- ranking

test("OS-R01. a specific question leads with a condition-specific outcome", () => {
  const result = selectOutcomes(SHORT_CERVIX);
  assert.equal(result.recommendedOutcome.id, "preterm-birth-37");
  assert.ok(result.options.some(o => o.id === result.recommendedOutcome.id));
});

test("OS-R02. a therapy question about pain leads with pain, not a generic endpoint", () => {
  const result = selectOutcomes(ENDOMETRIOSIS);
  assert.equal(result.recommendedOutcome.id, "pain-reduction");
  assert.notEqual(result.recommendedOutcome.family, "target-event");
});

test("OS-R03. different questions produce materially different options", () => {
  const ids = [SHORT_CERVIX, ENDOMETRIOSIS, PCOS, GDM, PREECLAMPSIA, RIF].map(c => selectOutcomes(c).options.map(o => o.id).join("|"));
  assert.equal(new Set(ids).size, ids.length, "each clinical context must yield its own option set");
});

test("OS-R04. the same context always yields the same ordering", () => {
  assert.deepEqual(selectOutcomes(GDM).options.map(o => o.id), selectOutcomes(GDM).options.map(o => o.id));
});

test("OS-R05. options stay within the required bounds", () => {
  for (const c of [SHORT_CERVIX, ENDOMETRIOSIS, PCOS, GDM, PREECLAMPSIA, RIF, ONCOLOGY]) {
    const result = selectOutcomes(c);
    assert.ok(result.options.length >= MIN_OUTCOME_OPTIONS, `too few options: ${result.options.length}`);
    assert.ok(result.options.length <= MAX_OUTCOME_OPTIONS, `too many options: ${result.options.length}`);
  }
});

test("OS-R06. options are unique by id and by family", () => {
  for (const c of [SHORT_CERVIX, ENDOMETRIOSIS, PCOS, GDM, PREECLAMPSIA, RIF]) {
    const ids = selectOutcomes(c).options.map(o => o.id);
    assert.equal(new Set(ids).size, ids.length);
    const families = selectOutcomes(c).options.map(o => o.family);
    assert.equal(new Set(families).size, families.length, "one option per outcome family");
  }
});

test("OS-R07. a threshold comparison offers both cutoffs", () => {
  const ctx = context(
    { specialty: "obstetrics", condition: "preterm birth risk", intervention: "cerclage" },
    { originalInput: "Does cerclage reduce spontaneous birth before 34 versus 37 weeks?" }
  );
  assert.ok(questionWantsThresholdComparison(ctx));
  const ids = selectOutcomes(ctx).options.map(o => o.id);
  assert.ok(ids.includes("preterm-birth-37") && ids.includes("preterm-birth-34"), ids.join(","));
});

test("OS-R08. a non-threshold question offers one preterm-birth cutoff", () => {
  const ids = selectOutcomes(SHORT_CERVIX).options.map(o => o.id);
  const preterm = ids.filter(id => id.startsWith("preterm-birth-"));
  assert.equal(preterm.length, 1);
});

test("OS-R09. a therapy question includes a harm outcome", () => {
  assert.ok(selectOutcomes(PCOS).options.some(o => o.category === "safety"));
});

test("OS-R10. a pregnancy question includes a neonatal outcome", () => {
  assert.ok(selectOutcomes(PREECLAMPSIA).options.some(o => o.category === "neonatal"));
});

test("OS-R11. quality of life is offered for a chronic pain condition", () => {
  const ids = selectOutcomes(ENDOMETRIOSIS).options.map(o => o.id);
  assert.ok(ids.includes("quality-of-life"), ids.join(","));
});

test("OS-R12. quality of life is not forced onto an unrelated question", () => {
  const ids = selectOutcomes(SHORT_CERVIX).options.map(o => o.id);
  assert.ok(!ids.includes("quality-of-life"), ids.join(","));
});

test("OS-R13. fertility outcomes lead an IVF question", () => {
  const result = selectOutcomes(RIF);
  assert.equal(result.recommendedOutcome.category, "fertility");
  assert.ok(result.options.some(o => o.id === "implantation-rate"));
});

test("OS-R14. a generic outcome never wins a condition-specific question", () => {
  for (const c of [SHORT_CERVIX, ENDOMETRIOSIS, PCOS, GDM, PREECLAMPSIA, RIF]) {
    const recommended = selectOutcomes(c).recommendedOutcome;
    assert.ok(recommended.applicableConditions.length > 0);
    assert.ok(
      !recommended.applicableConditions.every(x => x === "unknown" || x === "unspecified"),
      `generic fallback recommended for a specific question: ${recommended.id}`
    );
  }
});

test("OS-R15. adverse effects is a fallback, never the default recommendation", () => {
  for (const c of [SHORT_CERVIX, ENDOMETRIOSIS, PCOS, GDM, PREECLAMPSIA, RIF]) {
    assert.notEqual(selectOutcomes(c).recommendedOutcome.id, "adverse-effects-of-intervention");
  }
});

test("OS-R16. an unrecognized specialty falls back to generic, question-type connected outcomes", () => {
  const result = selectOutcomes(ONCOLOGY);
  assert.ok(result.options.length >= MIN_OUTCOME_OPTIONS);
  // No obstetric or fertility endpoint may answer a breast-cancer question.
  for (const option of result.options) {
    assert.equal(option.applicableSpecialties.length, 0, `${option.id} should not be OB/GYN scoped`);
  }
  assert.ok(result.options.some(o => o.category === "safety"));
  assert.ok(result.options.every(o => o.applicableQuestionTypes.includes(THERAPY)));
});

test("OS-R17. scoring is transparent and ordered by contribution", () => {
  const pain = OUTCOME_ONTOLOGY.find(c => c.id === "pain-reduction")!;
  const generic = OUTCOME_ONTOLOGY.find(c => c.id === "clinical-event-rate")!;
  assert.ok(scoreOutcome(pain, ENDOMETRIOSIS).score > scoreOutcome(generic, ENDOMETRIOSIS).score);
});

test("OS-R18. an unknown question type still returns options", () => {
  const ctx = buildOutcomeContext({ specialty: "obstetrics", condition: "short cervix" }, {}, {});
  assert.ok(selectOutcomes(ctx).options.length >= MIN_OUTCOME_OPTIONS);
});

test("OS-R19. an empty context degrades to the generic fallback", () => {
  const empty = buildOutcomeContext(null, null, {});
  const result = selectOutcomes(empty);
  assert.ok(result.options.length >= MIN_OUTCOME_OPTIONS);
  assert.ok(result.options.length <= MAX_OUTCOME_OPTIONS);
});

// ---------------------------------------------------------------------------- rationales

test("OS-T01. every rationale explains relevance without claiming an effect", () => {
  const banned = /\b(more effective|less effective|superior|efficacious|works better|is better than|outperform\w*)\b|\b(reduce[sd]?|improve[sd]?|prevent(?:s|ed)?|lower(?:s|ed)?|increas(?:e|es|ed))\s+(the\s+)?(risk|rate|incidence|mortality|morbidity|complication|pain|bleeding)\b/i;
  for (const c of [SHORT_CERVIX, ENDOMETRIOSIS, PCOS, GDM, PREECLAMPSIA, RIF]) {
    for (const option of selectOutcomes(c).options) {
      assert.ok(option.rationale.length > 0);
      assert.ok(!banned.test(option.rationale), `rationale makes a claim of effect: "${option.rationale}"`);
    }
  }
});

test("OS-T02. a rationale introduces no intervention that is not in the context", () => {
  const drugs = /\b(metformin|insulin|letrozole|clomiphene|tamoxifen|aspirin|cerclage|progesterone|agonist|antagonist)\b/i;
  for (const c of [SHORT_CERVIX, ENDOMETRIOSIS, PCOS, GDM, PREECLAMPSIA, RIF]) {
    const own = [c.intervention, c.comparator, c.originalInput, c.condition].join(" ");
    for (const option of selectOutcomes(c).options) {
      const mentioned = option.rationale.match(drugs)?.[0] ?? "";
      if (!mentioned) continue;
      assert.ok(new RegExp(mentioned, "i").test(own), `${option.id} rationale names "${mentioned}", which is not in this question`);
    }
  }
});

test("OS-T03. the option rationale is exactly what the builder produces from the ontology entry", () => {
  const result = selectOutcomes(SHORT_CERVIX);
  for (const option of result.options) {
    const base = OUTCOME_ONTOLOGY.find(c => c.id === option.id);
    assert.ok(base, `option ${option.id} is not an ontology entry`);
    assert.equal(option.rationale, buildRationale(base!, SHORT_CERVIX));
  }
});

// ---------------------------------------------------------------------------- response shape

test("OS-S01. a selection response satisfies its own schema", () => {
  for (const c of [SHORT_CERVIX, ENDOMETRIOSIS, PCOS, GDM, PREECLAMPSIA, RIF, ONCOLOGY]) {
    const result = selectOutcomes(c);
    assert.equal(outcomeSelectionResponseSchema.safeParse(result).success, true);
  }
});

test("OS-S02. the response declares the selection rules the UI must enforce", () => {
  const result = selectOutcomes(GDM);
  assert.equal(result.maxSelections, MAX_OUTCOME_SELECTIONS);
  assert.equal(result.allowFreeText, true);
  assert.ok(result.questionText.length > 0);
  assert.ok(["rules", "ai", "hybrid"].includes(result.source));
});

test("OS-S03. the recommended outcome is always present in the options", () => {
  for (const c of [SHORT_CERVIX, ENDOMETRIOSIS, PCOS, GDM, PREECLAMPSIA, RIF, ONCOLOGY]) {
    const result = selectOutcomes(c);
    assert.ok(result.options.some(o => o.id === result.recommendedOutcome.id));
  }
});

// ---------------------------------------------------------------------------- untrusted payloads

test("OS-P01. a well-formed AI payload is accepted", () => {
  const base = selectOutcomes(GDM, { source: "ai" });
  const parsed = parseOutcomeSelectionResponse({ ...base, source: "ai" }, GDM);
  assert.equal(parsed.usedFallback, false);
  assert.equal(parsed.response.source, "ai");
});

test("OS-P02. an unknown field is stripped rather than trusted", () => {
  const base = selectOutcomes(GDM) as unknown as Record<string, unknown>;
  const parsed = parseOutcomeSelectionResponse({ ...base, surpriseField: 1 }, GDM);
  assert.equal(outcomeSelectionResponseSchema.safeParse(parsed.response).success, true);
  assert.ok(!("surpriseField" in (parsed.response as unknown as Record<string, unknown>)));
});

test("OS-P03. a malformed payload falls back to the deterministic selection", () => {
  for (const bad of [null, undefined, 42, "text", [], { options: "nope" }, { options: [] }]) {
    const parsed = parseOutcomeSelectionResponse(bad, GDM);
    assert.equal(parsed.usedFallback, true);
    assert.ok(parsed.response.options.length >= MIN_OUTCOME_OPTIONS);
    assert.equal(outcomeSelectionResponseSchema.safeParse(parsed.response).success, true);
  }
});

test("OS-P04. a wrong field type is repaired or rejected, never passed through", () => {
  const base = selectOutcomes(GDM) as unknown as Record<string, unknown>;
  const broken = { ...base, maxSelections: "two", options: (base.options as unknown[]).map(o => ({ ...(o as object), priority: "high" })) };
  const parsed = parseOutcomeSelectionResponse(broken, GDM);
  assert.equal(outcomeSelectionResponseSchema.safeParse(parsed.response).success, true);
  assert.equal(typeof parsed.response.maxSelections, "number");
  for (const option of parsed.response.options) {
    assert.equal(typeof option.priority, "number", `${option.id} kept a non-numeric priority`);
  }
});

test("OS-P05. a partial option list is salvaged, not discarded", () => {
  const parsed = parseOutcomeSelectionResponse(
    { questionText: "Which outcome matters most?", options: [{ id: "live-birth", label: "Live birth" }, { id: "stillbirth", label: "Stillbirth" }], allowFreeText: true, maxSelections: 2, source: "ai" },
    RIF
  );
  assert.equal(parsed.usedFallback, false);
  assert.deepEqual(parsed.response.options.map(o => o.label), ["Live birth", "Stillbirth"]);
  assert.equal(parsed.response.recommendedOutcome.id, "live-birth");
});

test("OS-P06. a salvaged option is rebuilt from the ontology rather than trusted", () => {
  const parsed = parseOutcomeSelectionResponse(
    { options: [{ id: "pain-reduction", label: "Pain reduction", category: "bogus-category", applicableSpecialties: ["dermatology"] }] },
    ENDOMETRIOSIS
  );
  const option = parsed.response.options[0]!;
  assert.equal(option.category, "patient-important");
  assert.deepEqual(option.applicableSpecialties, ["gynecology"]);
  assert.ok(option.rationale.length > 0);
});

test("OS-P07. duplicated options in an AI payload are collapsed", () => {
  const parsed = parseOutcomeSelectionResponse(
    { options: [{ id: "live-birth", label: "Live birth" }, { id: "birth", label: "Birth" }, { id: "live-birth", label: "Live birth" }] },
    RIF
  );
  assert.equal(parsed.response.options.length, 1);
});

test("OS-P08. a recommended outcome outside the option list is repaired", () => {
  const base = selectOutcomes(GDM);
  const parsed = parseOutcomeSelectionResponse(
    { ...base, recommendedOutcome: { ...base.recommendedOutcome, id: "not-in-options" } },
    GDM
  );
  assert.ok(parsed.response.options.some(o => o.id === parsed.response.recommendedOutcome.id));
});

test("OS-P09. unsafe content in an AI label is stripped", () => {
  const parsed = parseOutcomeSelectionResponse(
    { options: [{ id: "x", label: "<script>alert(1)</script>Live birth" }] },
    RIF
  );
  assert.ok(!parsed.response.options[0]!.label.includes("<script"));
});

test("OS-P10. a fallback payload still reports the rules source", () => {
  assert.equal(parseOutcomeSelectionResponse("garbage", GDM).response.source, "rules");
});

// ---------------------------------------------------------------------------- free text

test("OS-F01. a clinician-typed outcome is accepted", () => {
  const check = validateFreeTextOutcome("Neonatal intensive care admission");
  assert.equal(check.ok, true);
});

test("OS-F02. empty input is refused with a reason", () => {
  for (const bad of ["", "   ", "\u0000"]) {
    const check = validateFreeTextOutcome(bad);
    assert.equal(check.ok, false);
    assert.ok(check.ok === false && check.reason.length > 0);
  }
});

test("OS-F03. markup is neutralised rather than stored", () => {
  const check = validateFreeTextOutcome('<img src=x onerror="alert(1)">Neonatal death');
  assert.equal(check.ok, true);
  assert.ok(check.ok === true && !check.value.includes("<"));
  assert.ok(check.ok === true && !check.value.includes("onerror"));
});

test("OS-F04. an over-long outcome is refused", () => {
  const check = validateFreeTextOutcome("a".repeat(MAX_FREE_TEXT_LENGTH + 1));
  assert.equal(check.ok, false);
  assert.ok(check.ok === false && check.reason.includes(String(MAX_FREE_TEXT_LENGTH)));
});

test("OS-F05. a user-defined outcome becomes a valid candidate", () => {
  const candidate = createUserDefinedOutcome("Neonatal intensive care admission", RIF);
  assert.equal(outcomeSelectionResponseSchema.safeParse({ ...selectOutcomes(RIF), options: [candidate] }).success, true);
  assert.ok(candidate.label.length > 0);
});

test("OS-F06. a user-defined outcome is marked as unverified ground", () => {
  const candidate = createUserDefinedOutcome("Custom clinician endpoint", RIF);
  assert.equal(candidate.preferredForPrimaryOutcome, false);
  assert.equal(candidate.measurable, false);
  assert.ok(!candidate.id.startsWith("preterm"));
});

// ---------------------------------------------------------------------------- ontology integrity

test("OS-O01. every ontology id is unique", () => {
  const ids = OUTCOME_ONTOLOGY.map(o => o.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("OS-O02. every ontology entry is fully specified", () => {
  for (const o of OUTCOME_ONTOLOGY) {
    assert.ok(o.id && o.label && o.shortLabel && o.family && o.rationale, `incomplete entry ${o.id}`);
    assert.ok(o.applicableQuestionTypes.length > 0, `${o.id} has no question type`);
    assert.ok(o.keywords.length > 0, `${o.id} has no keywords`);
  }
});

test("OS-O03. the ontology spans every required category", () => {
  const categories = new Set(OUTCOME_ONTOLOGY.map(o => o.category));
  for (const required of ["patient-important", "safety", "neonatal", "fertility", "quality-of-life", "maternal"]) {
    assert.ok(categories.has(required as never), `missing category ${required}`);
  }
});

test("OS-O04. no ontology label duplicates another", () => {
  const labels = OUTCOME_ONTOLOGY.map(o => o.label.toLowerCase());
  assert.equal(new Set(labels).size, labels.length);
});

test("OS-O05. no ontology rationale claims an effect", () => {
  // Descriptive use ("reduced blood loss") is legitimate; a comparative claim about the
  // intervention is not. So the ban targets claims of benefit, not any past-participle verb.
  const banned = /\b(more effective|less effective|superior|efficacious|works better|is better than|outperform\w*)\b|\b(reduce[sd]?|improve[sd]?|prevent(?:s|ed)?|lower(?:s|ed)?|increas(?:e|es|ed))\s+(the\s+)?(risk|rate|incidence|mortality|morbidity|complication|pain|bleeding)\b/i;
  for (const o of OUTCOME_ONTOLOGY) {
    assert.ok(!banned.test(o.rationale), `${o.id} rationale claims an effect: ${o.rationale}`);
  }
});

// The advisory layer is the boundary that keeps an untrusted model from inventing outcomes, and it
// runs on the live /api/engine path, so it is tested directly rather than only through the selector.
const ADVISORY_BASE = () => selectOutcomes(context({
  condition: "short cervix",
  intervention: "progesterone"
}));

test("OS-A01. advisory cannot introduce an outcome the deterministic selection did not produce", () => {
  const base = ADVISORY_BASE();
  const hallucinated = applyOutcomeAdvisory(base, {
    options: [{ id: "oncology.response-rate" }, { id: "not-a-real-outcome" }],
    recommendedOutcomeId: "oncology.response-rate"
  });
  assert.deepEqual(
    hallucinated.options.map(o => o.id),
    base.options.map(o => o.id),
    "advisory changed the option set"
  );
  assert.ok(!hallucinated.options.some(o => o.id === "oncology.response-rate"));
  assert.equal(hallucinated.recommendedOutcome.id, base.recommendedOutcome.id);
});

test("OS-A02. advisory cannot rename or relabel a deterministic option", () => {
  const base = ADVISORY_BASE();
  const renamed = applyOutcomeAdvisory(base, {
    options: [{ id: base.options[0]!.id, label: "curative cancer survival (guaranteed)" }]
  });
  assert.equal(renamed.options[0]!.label, base.options[0]!.label);
  assert.ok(renamed.options.every(o => !/curative|guaranteed/i.test(o.label)));
  assert.ok(renamed.options.every(o => base.options.some(b => b.id === o.id && b.label === o.label)));
});

test("OS-A03. advisory reorders by ontology id and promotes the requested recommendation", () => {
  const base = ADVISORY_BASE();
  const last = base.options[base.options.length - 1]!;
  const reordered = applyOutcomeAdvisory(base, {
    options: [{ id: last.id }],
    recommendedOutcomeId: last.id
  });
  assert.equal(reordered.options[0]!.id, last.id);
  assert.equal(reordered.recommendedOutcome.id, last.id);
  assert.deepEqual(
    reordered.options.map(o => o.id),
    [last.id, ...base.options.filter(o => o.id !== last.id).map(o => o.id)],
    "advisory must be a permutation of the deterministic options"
  );
  assert.equal(reordered.source, "hybrid");
});

test("OS-A04. advisory accepts a label the model echoed back instead of an id", () => {
  const base = ADVISORY_BASE();
  const target = base.options[2]!;
  const byLabel = applyOutcomeAdvisory(base, { options: [target.label] });
  assert.equal(byLabel.options[0]!.id, target.id);
  const semantic = applyOutcomeAdvisory(base, { options: [target.label.toLowerCase()] });
  assert.equal(semantic.options[0]!.id, target.id);
});

test("OS-A05. an unusable advisory leaves the deterministic order intact", () => {
  const base = ADVISORY_BASE();
  for (const advisory of [
    undefined,
    null,
    "",
    "   ",
    {},
    { options: [] },
    { options: [{ id: "" }] },
    { options: "not-an-array" },
    { options: [{ nope: true }] },
    { recommendedOutcomeId: "hallucinated-outcome" }
  ]) {
    const result = applyOutcomeAdvisory(base, advisory);
    assert.deepEqual(result.options.map(o => o.id), base.options.map(o => o.id));
    assert.equal(result.recommendedOutcome.id, base.recommendedOutcome.id);
    assert.equal(result.source, "hybrid", "a consulted-but-unusable advisory is still hybrid");
  }
});

test("OS-A06. advisory cannot drop, duplicate, or exceed the option count", () => {
  const base = ADVISORY_BASE();
  const noisy = applyOutcomeAdvisory(base, {
    options: [
      { id: base.options[0]!.id },
      { id: base.options[0]!.id },
      { id: base.options[0]!.label },
      { id: base.options[1]!.id }
    ],
    recommendedOutcomeId: base.options[1]!.id
  });
  const ids = noisy.options.map(o => o.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate option");
  assert.equal(ids.length, base.options.length, "option count changed");
  assert.ok(ids.length <= MAX_OUTCOME_OPTIONS);
});

test("OS-A07. advisory cannot enlarge the selection cap or weaken the max-selections contract", () => {
  const base = ADVISORY_BASE();
  const noisy = applyOutcomeAdvisory(base, { options: base.options, extra: { maxSelections: 99 } });
  assert.equal(noisy.maxSelections, base.maxSelections);
  assert.ok(noisy.maxSelections <= MAX_OUTCOME_SELECTIONS);
});

test("OS-A08. a deeply nested advisory payload is bounded, not walked forever", () => {
  const base = ADVISORY_BASE();
  let nested: unknown = { id: base.options[0]!.id };
  for (let i = 0; i < 12; i++) nested = { recommendedOutcome: nested };
  const result = applyOutcomeAdvisory(base, nested);
  assert.deepEqual(result.options.map(o => o.id), base.options.map(o => o.id));
});

test("OS-A09. a recommended option always remains one of the offered options", () => {
  const base = ADVISORY_BASE();
  for (const advisory of [
    { options: base.options.map(o => ({ id: o.id })).reverse(), recommendedOutcomeId: base.options[3]!.id },
    { options: [{ id: "hallucinated" }], recommendedOutcomeId: "hallucinated" },
    { options: [{ id: base.options[1]!.id }], recommendedOutcome: { id: base.options[2]!.id } }
  ]) {
    const result = applyOutcomeAdvisory(base, advisory);
    assert.ok(
      result.options.some(o => o.id === result.recommendedOutcome.id),
      "recommended outcome is not in the offered options"
    );
  }
});

// The universal tier is what stands between an unrecognised context and an empty or unusably short
// list. The OB/GYN-only UI never exercises it, so it is probed directly for every question type.
const UNIVERSAL_IDS = new Set([
  "incidence-of-event", "relative-risk-of-event", "adverse-effects-of-intervention",
  "treatment-discontinuation", "symptom-resolution", "clinical-event-rate"
]);

test("OS-U01. every question type still offers a usable list when nothing is recognised", () => {
  for (const { type } of QUESTION_TYPES) {
    const sel = selectOutcomes(buildOutcomeContext(
      { specialty: undefined, condition: "zzz unrecognised condition", intervention: "qqq unrecognised drug",
        questionType: type, framework: "PICO" },
      {}
    ));
    assert.ok(
      sel.options.length >= MIN_OUTCOME_OPTIONS && sel.options.length <= MAX_OUTCOME_OPTIONS,
      `${type} produced ${sel.options.length} options`
    );
    assert.ok(sel.recommendedOutcome, `${type} has no recommended outcome`);
    for (const o of sel.options) assert.ok(o.rationale.trim(), `${type}/${o.id} has no rationale`);
  }
});

test("OS-U02. an unrecognised specialty offers universal outcomes and never OB/GYN-specific ones", () => {
  const sel = selectOutcomes(buildOutcomeContext(
    { specialty: "oncology" as never, condition: "metastatic colorectal cancer",
      intervention: "pembrolizumab", questionType: THERAPY, framework: "PICO" },
    {}
  ));
  assert.ok(sel.options.length >= MIN_OUTCOME_OPTIONS);
  for (const o of sel.options) {
    assert.ok(
      UNIVERSAL_IDS.has(o.id),
      `${o.id} ("${o.label}") is not a universal outcome and must not answer a non-OB/GYN question`
    );
    assert.ok(!/pre-?eclampsia|gestational|caesarean|cerclage|amniotic/i.test(o.label), `OB/GYN leakage: ${o.label}`);
  }
});

test("OS-U03. the universal tier is reached, not merely present in the ontology", () => {
  const sel = selectOutcomes(buildOutcomeContext(
    { specialty: undefined, condition: "zzz unrecognised", intervention: "qqq unrecognised",
      questionType: THERAPY, framework: "PICO" },
    {}
  ));
  const universal = sel.options.filter(o => UNIVERSAL_IDS.has(o.id));
  assert.ok(universal.length > 0, "no universal outcome survived selection");
  assert.ok(
    sel.options.every(o => !o.label || typeof o.label === "string"),
    "an option reached selection without a label"
  );
});

test("OS-U04. a diagnostic question can offer more than one accuracy measure", () => {
  const sel = selectOutcomes(buildOutcomeContext(
    { specialty: undefined, condition: "zzz unrecognised", intervention: "qqq unrecognised",
      questionType: "Diagnosis", framework: "Diagnostic accuracy (PIRD)" },
    {}
  ));
  const accuracy = sel.options.filter(o => o.family === "diagnosis-accuracy");
  assert.ok(accuracy.length >= 2, "diagnostic selection offered a single accuracy measure");
  assert.ok(sel.options.length <= MAX_OUTCOME_OPTIONS);
});

test("OS-U05. an unrecognised specialty never receives a rationale that invents a domain", () => {
  const sel = selectOutcomes(buildOutcomeContext(
    { specialty: "oncology" as never, condition: "metastatic colorectal cancer",
      intervention: "pembrolizumab", questionType: THERAPY, framework: "PICO" },
    {}
  ));
  for (const o of sel.options) {
    assert.ok(!/infertility|pregnan|obstetric|gynecolog/i.test(o.rationale), `${o.id}: ${o.rationale}`);
  }
});

// The selection mechanism itself: slots must be filled by relevance, and the outcome that wins must
// be the one the question actually asks about. These are the properties that were broken.
test("OS-M01. the highest-scoring in-scope outcome is always offered", () => {
  // Comparators are omitted so that the ranking is decided by condition and intervention matches
  // alone. With a comparator present the comparator-keyword bonus dominates and every winner sits in
  // the same tier, which would hide a loop that fills slots by tier instead of by score.
  const CASES = [
    { specialty: "infertility", condition: "IVF", intervention: "single embryo transfer" },
    { specialty: "gynecology", condition: "fibroids", intervention: "uterine artery embolisation" },
    { specialty: "obstetrics", condition: "short cervix", intervention: "vaginal progesterone" },
    { specialty: "infertility", condition: "endometriosis", intervention: "laparoscopic surgery" },
    { specialty: "infertility", condition: "recurrent pregnancy loss", intervention: "progesterone" },
    { specialty: "gynecology", condition: "adenomyosis", intervention: "hysterectomy" }
  ] as const;
  for (const c of CASES) {
    const context = buildOutcomeContext({ ...c, questionType: THERAPY, framework: "PICO" }, {});
const ranked = OUTCOME_ONTOLOGY
      .map(o => scoreOutcome(o, context))
      .filter(s => s.candidate.applicableSpecialties.includes(context.specialty!))
      .sort((a, b) => b.score - a.score);
    const offered = selectOutcomes(context).options;
const best = ranked[0]!;
    assert.ok(
      offered.some(o => o.id === best.candidate.id),
      `best-scoring outcome "${best.candidate.label}" (${best.score}, tier ${best.tier}) was not offered for ${c.condition}`
    );
  }
});

test("OS-M02. the recommendation answers the question that was asked", () => {
  const CASES: [SpecialtyKey, string, string, string, RegExp][] = [
    ["infertility", "endometriosis", "laparoscopic surgery", "improve pain", /pain/i],
    ["gynecology", "fibroids", "uterine artery embolisation", "reduce menstrual blood loss", /blood loss|haemoglobin/i],
    ["infertility", "IVF", "single embryo transfer", "improve live birth rate", /live birth/i],
    ["obstetrics", "short cervix", "vaginal progesterone", "prevent preterm birth", /preterm/i],
    ["obstetrics", "preeclampsia", "aspirin", "reduce incidence of pre-eclampsia", /pre-?eclampsia/i],
    ["obstetrics", "gestational diabetes", "continuous glucose monitoring", "improve glycaemic control", /glycaem|glucose/i],
    ["infertility", "PCOS", "letrozole", "improve live birth rate", /live birth/i],
    ["gynecology", "endometrial hyperplasia", "progestin", "achieve regression of hyperplasia", /regression|carcinoma/i],
    ["infertility", "recurrent pregnancy loss", "progesterone", "reduce miscarriage risk", /miscarriage|pregnancy loss/i],
    ["gynecology", "adenomyosis", "hysterectomy", "reduce pain", /pain/i],
    ["infertility", "thin endometrium", "estrogen", "improve clinical pregnancy rate", /pregnancy|endometri/i]
  ];
  for (const [specialty, condition, intervention, comparator, expected] of CASES) {
    const sel = selectOutcomes(buildOutcomeContext(
      { specialty, condition, intervention, comparator, questionType: THERAPY, framework: "PICO" }, {}
    ));
    assert.match(sel.recommendedOutcome.label, expected,
      `${condition} / ${intervention} should recommend something matching ${expected}`);
  }
});

test("OS-M08. the offered list, not only the recommendation, follows the question's intent", () => {
  // Regression: one shared endpoint won nearly every question in a specialty, and the rest of the
  // list barely moved, so two questions with different intents looked like the same question. The
  // recommendation alone was already checked by OS-M02 and OS-M03; this pins the ordering of the
  // remaining options, which is what the clinician actually scans.
  const options = (comparator: string) => selectOutcomes(buildOutcomeContext(
    { specialty: "gynecology", condition: "adenomyosis", intervention: "hysterectomy",
      comparator, questionType: THERAPY, framework: "PICO" },
    {}
  )).options.map(o => o.label);

  const pain = options("reduce pain");
  const bleeding = options("reduce menstrual blood loss");
  const quality = options("improve quality of life");

  assert.equal(pain[0], "Patient-reported pain reduction");
  assert.equal(bleeding[0], "Menstrual blood loss reduction");
  assert.equal(quality[0], "Health-related quality of life");

  // Each intent must actually reorder the list, not merely head it.
  const shifted = (a: string[], b: string[]) => a.filter((x, i) => b[i] !== x).length;
  assert.ok(shifted(pain, bleeding) >= 2, `pain vs bleeding barely differ: ${bleeding.join(" | ")}`);
  assert.ok(shifted(pain, quality) >= 2, `pain vs quality of life barely differ: ${quality.join(" | ")}`);
});

test("OS-M13. the keywords the clinician typed choose between outcomes that all match the condition", () => {
  // Every outcome can list the same condition, so a condition match does not choose between them.
  // "Live birth" and "Patient-reported pain reduction" both match endometriosis exactly, and the
  // fertility endpoint used to win even when the clinician had typed "pelvic pain" and
  // "dyspareunia". Naming the outcome in the entry has to count.
  const sel = selectOutcomes(buildOutcomeContext(
    { specialty: "infertility", condition: "endometriosis", intervention: "laparoscopic surgery",
      comparator: "Medical therapy (e.g., hormonal suppression)",
      questionType: THERAPY, framework: "PICO" },
    {},
    { originalInput: "endometriosis, laparoscopic surgery, pelvic pain, dyspareunia" }
  ));
  assert.match(sel.recommendedOutcome.label, /pain/i,
    `expected a pain outcome, got ${sel.recommendedOutcome.id}: ${sel.options.map(o => o.id).join(", ")}`);

  // Same reasoning for a blood-loss entry: the typed keyword must beat a generic patient-important
  // endpoint that happens to list the same condition.
  const bleeding = selectOutcomes(buildOutcomeContext(
    { specialty: "gynecology", condition: "fibroids", intervention: "hysterectomy",
      comparator: "Expectant management / no intervention",
      questionType: THERAPY, framework: "PICO" },
    {},
    { originalInput: "fibroids, hysterectomy, menstrual blood loss, haemoglobin" }
  ));
  assert.match(bleeding.recommendedOutcome.label, /blood loss|haemoglobin/i,
    `expected a blood-loss outcome, got ${bleeding.recommendedOutcome.id}: ${bleeding.options.map(o => o.id).join(", ")}`);
});

test("OS-M11. an outcome scoped to another specialty cannot win on an incidental keyword", () => {
  // "Spontaneous preterm birth before 37 completed weeks" is scoped to obstetrics but lists
  // "progesterone" among its keywords, so on an IVF question about luteal-phase progesterone it
  // outscored "Live birth" and took the recommendation. An entry that declares it does not apply to
  // this specialty must not win that way.
  const ivf = selectOutcomes(buildOutcomeContext(
    { specialty: "infertility", condition: "IVF", intervention: "progesterone",
      comparator: "support the luteal phase", questionType: THERAPY, framework: "PICO" }, {}
  ));
  assert.equal(ivf.recommendedOutcome.id, "live-birth",
    `IVF / progesterone recommended ${ivf.recommendedOutcome.id}`);
  // It may still be offered lower down: IVF pregnancies really do carry preterm-birth risk, so
  // excluding the endpoint entirely would be wrong. It must not lead, though.
  const pretermSlot = ivf.options.findIndex(o => o.id === "preterm-birth-37");
  assert.ok(pretermSlot < 0 || pretermSlot >= 2,
    `preterm-birth-37 ranked at slot ${pretermSlot}: ${ivf.options.map(o => o.id).join(", ")}`);

  // The penalty must not override an exact condition match. Pain reduction is scoped to gynaecology,
  // but on an endometriosis pain question it is still the answer whichever route the question took.
  for (const specialty of ["infertility", "gynecology"] as SpecialtyKey[]) {
    const pain = selectOutcomes(buildOutcomeContext(
      { specialty, condition: "endometriosis", intervention: "laparoscopic surgery",
        comparator: "improve pain", questionType: THERAPY, framework: "PICO" }, {}
    ));
    assert.match(pain.recommendedOutcome.label, /pain/i,
      `${specialty} / endometriosis / laparoscopic surgery recommended ${pain.recommendedOutcome.id}`);
  }
});

test("OS-M12. a diagnostic question prefers accuracy measures over process success rates", () => {
  // "Implantation rate" and "Sperm retrieval success" are process rates. They say how often a
  // procedure worked, not how well a test recognises disease, so they must not answer a question
  // about making a diagnosis.
  const CASES: [SpecialtyKey, string, string][] = [
    ["infertility", "recurrent pregnancy loss", "karyotyping"],
    ["obstetrics", "preeclampsia", "blood pressure measurement"],
    ["gynecology", "cervical dysplasia", "colposcopy"]
  ];
  for (const [specialty, condition, intervention] of CASES) {
    const sel = selectOutcomes(buildOutcomeContext(
      { specialty, condition, intervention, questionType: DIAGNOSIS, framework: "PICO" }, {}
    ));
    assert.equal(sel.recommendedOutcome.family, "diagnosis-accuracy",
      `${condition} / ${intervention} recommended ${sel.recommendedOutcome.id} (${sel.recommendedOutcome.family})`);
    assert.ok(sel.options.some(o => o.family === "diagnosis-accuracy"),
      `no accuracy measure offered for ${condition}: ${sel.options.map(o => o.id).join(", ")}`);
  }
});

test("OS-M10. a comparator with no ontology keyword still steers the recommendation", () => {
  // None of these comparators contains a single ontology keyword, so the comparator-keyword bonus
  // cannot fire and the intent bonus over shared label terms is the only signal that can move the
  // answer. Without it the recommendation for a given condition never changes.
  const rec = (specialty: SpecialtyKey, condition: string, intervention: string, comparator: string) =>
    selectOutcomes(buildOutcomeContext(
      { specialty, condition, intervention, comparator, questionType: THERAPY, framework: "PICO" }, {}
    )).recommendedOutcome.id;

  assert.equal(rec("infertility", "hydrosalpinx", "salpingectomy", "improve time to pregnancy"), "time-to-pregnancy");
  assert.equal(rec("obstetrics", "short cervix", "cerclage", "reduce fetal growth restriction"), "fetal-growth-restriction");
  assert.equal(rec("obstetrics", "preeclampsia", "aspirin", "reduce need for repeat surgery"), "reoperation-rate");

  // The same condition must answer different comparators differently.
  const cervix = ["reduce fetal growth restriction", "improve sleep quality", "reduce need for repeat surgery"]
    .map((c) => rec("obstetrics", "short cervix", "cerclage", c));
  assert.equal(new Set(cervix).size, 3, `three intents on one condition collapsed to ${new Set(cervix).size}: ${cervix.join(" | ")}`);
});

test("OS-M09. a shared-condition question does not stack variants of one idea without a comparator", () => {
  // Without a comparator there is nothing to rank by beyond the condition, so the guard against a
  // family-monoculture has to be structural: at most one outcome per family unless the family is
  // explicitly allowed to repeat.
  const sel = selectOutcomes(buildOutcomeContext(
    { specialty: "gynecology", condition: "adenomyosis", intervention: "hysterectomy",
      questionType: THERAPY, framework: "PICO" },
    {}
  ));
  const byFamily = new Map<string, number>();
  for (const o of sel.options) byFamily.set(o.family, (byFamily.get(o.family) ?? 0) + 1);
  for (const [family, count] of byFamily) {
    assert.ok(count <= 1, `family "${family}" appears ${count} times: ${sel.options.map(o => o.label).join(" | ")}`);
  }
});

test("OS-M03. two questions about the same condition but different intent get different recommendations", () => {
  const rec = (intervention: string, comparator: string) => selectOutcomes(buildOutcomeContext(
    { specialty: "gynecology", condition: "fibroids", intervention, comparator,
      questionType: THERAPY, framework: "PICO" },
    {}
  )).recommendedOutcome.label;
  assert.match(rec("uterine artery embolisation", "reduce menstrual blood loss"), /blood loss|haemoglobin/i);
  assert.match(rec("myomectomy", "improve quality of life"), /quality of life/i);
});

test("OS-M04. slot filling is ordered by relevance, not by an internal tier label", () => {
  // Regression: slot filling walked tiers in the order specific -> specialty -> keyword -> generic
  // and filled every slot from the first non-empty tier. Tier and score disagree here: "Live birth"
  // scores 92 in the keyword tier while "Spontaneous conception rate" scores 82 in the specific
  // tier, so tier-first filling offered the weaker outcome and blocked the better one. The label
  // pairing is incidental; what matters is that a lower-scoring entry outranked a higher-scoring one.
  //
  // No specialty filter is applied to the expected ranking, because the selector's scope gate also
  // admits a specific-tier outcome from another specialty. Here the keyword-tier winner scores 80
  // while the specialty-tier runner-up scores 58, and the two are in different families, so nothing
  // except the fill order decides between them.
  const context = buildOutcomeContext(
    { specialty: "obstetrics", condition: "IVF", intervention: "aspirin",
      questionType: THERAPY, framework: "PICO" },
    {}
  );
  const ranked = OUTCOME_ONTOLOGY
    .map(o => scoreOutcome(o, context))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]!;
  const runnerUp = ranked[1]!;
  assert.ok(best.score > runnerUp.score, "fixture no longer discriminates on score");
  assert.notEqual(best.tier, runnerUp.tier, "fixture no longer discriminates on tier");

  const sel = selectOutcomes(context);
  assert.equal(sel.recommendedOutcome.label, best.candidate.label);
  assert.ok(sel.options.some(o => o.id === best.candidate.id),
    `higher-scoring "${best.candidate.label}" (${best.score}, ${best.tier}) lost to `
    + `"${runnerUp.candidate.label}" (${runnerUp.score}, ${runnerUp.tier})`);
});

test("OS-M05. a question with no comparator does not stack options from one family", () => {
  // Regression: with no comparator to discriminate them, every outcome that merely matched the
  // condition scored within a few points of the others, so the top of the ranking filled with
  // same-family neighbours and the clinician saw three variants of one idea instead of a choice.
  const CASES: [SpecialtyKey, string, string][] = [
    ["gynecology", "fibroids", "uterine artery embolisation"],
    ["infertility", "IVF", "single embryo transfer"],
    ["obstetrics", "gestational diabetes", "insulin"],
    ["gynecology", "pelvic organ prolapse", "physiotherapy"],
    ["obstetrics", "short cervix", "cervical cerclage"]
  ];
  for (const [specialty, condition, intervention] of CASES) {
    const sel = selectOutcomes(buildOutcomeContext(
      { specialty, condition, intervention, questionType: THERAPY, framework: "PICO" }, {}
    ));
    const families = sel.options.map(o => o.family);
    const adjacentRepeats = families.filter((f, i) => i > 0 && f === families[i - 1]).length;
    assert.equal(adjacentRepeats, 0,
      `${condition}: repeated family back to back -> ${families.join(", ")}`);
  }
});

test("OS-M06. a comparator naming a concept outranks the specialty's default endpoints", () => {
  // Regression: the generic category bonuses (patientImportant + preferredPrimary) are constant
  // within a specialty, so they cannot separate two outcomes that both match the condition. They
  // let "Patient-reported pain reduction" beat "Menstrual blood loss reduction" on a blood-loss
  // question, and "Live birth" beat pain on a pain question.
  const bloodLoss = selectOutcomes(buildOutcomeContext(
    { specialty: "gynecology", condition: "fibroids", intervention: "uterine artery embolisation",
      comparator: "reduce menstrual blood loss", questionType: THERAPY, framework: "PICO" }, {}
  ));
  assert.match(bloodLoss.recommendedOutcome.label, /blood loss|haemoglobin/i);

  const pain = selectOutcomes(buildOutcomeContext(
    { specialty: "infertility", condition: "endometriosis", intervention: "laparoscopic surgery",
      comparator: "improve pain", questionType: THERAPY, framework: "PICO" }, {}
  ));
  assert.match(pain.recommendedOutcome.label, /pain/i);
});

test("OS-M07. distinct clinical questions do not all collapse onto one endpoint", () => {
  const CASES: [SpecialtyKey, string, string, string][] = [
    ["obstetrics", "short cervix", "vaginal progesterone", "prevent preterm birth"],
    ["obstetrics", "preeclampsia", "aspirin", "reduce incidence of pre-eclampsia"],
    ["obstetrics", "gestational diabetes", "insulin", "improve glycaemic control"],
    ["infertility", "endometriosis", "laparoscopic surgery", "improve pain"],
    ["gynecology", "fibroids", "hysterectomy", "reduce menstrual blood loss"],
    ["gynecology", "endometrial hyperplasia", "progestin", "achieve regression of hyperplasia"],
    ["infertility", "PCOS", "letrozole", "improve live birth rate"],
["gynecology", "pelvic organ prolapse", "physiotherapy", "improve quality of life"]
  ];
  const recs = CASES.map(([specialty, condition, intervention, comparator]) =>
    selectOutcomes(buildOutcomeContext(
      { specialty, condition, intervention, comparator, questionType: THERAPY, framework: "PICO" }, {}
    )).recommendedOutcome.label);
  // Six of eight questions recommending the same endpoint was the reported symptom.
  assert.ok(new Set(recs).size >= 6,
    `only ${new Set(recs).size} distinct recommendations across 8 questions: ${recs.join(" | ")}`);
});
