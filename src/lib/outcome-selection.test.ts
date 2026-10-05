import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FREE_TEXT_LENGTH,
  MAX_OUTCOME_OPTIONS,
  MAX_OUTCOME_SELECTIONS,
  MIN_OUTCOME_OPTIONS,
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

const THERAPY = "Therapy / Prevention";

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