import test from "node:test";
import assert from "node:assert/strict";
import { composeManuscript } from "./manuscript-composer.ts";
import { generateDeterministicScreen } from "./deterministic-screen.ts";
import type { PicoWord } from "./pico-roles.ts";
import type { AuditableRef } from "./relevance.ts";

const FORBIDDEN_REGEXES = [
  /measurable improvements/i,
  /favorable signals/i,
  /consensus data/i,
  /baseline clinical guidance/i,
  /protocol variability/i,
  /heterogeneous patient response/i,
  /consistent clinical backing/i,
  /reveal conflicting/i,
  /valuable contextual grounding/i,
  /Author note: Insert/i,
  /baseline clinical formulation/i,
  /lacks conclusive consensus/i,
  /additional evaluation warranted/i
];

const TITLE_PICO_REGEX = /\((?:P|I|C|O)\)/i;

const EFFECT_VERB_REGEX = /\b(improve|improves|improving|improved|increase|increases|increasing|increased|reduce|reduces|reducing|reduced|superior|inferior|benefit|benefits|beneficial|harm|harms|harmful)\b/i;
const CITATION_MARKER_REGEX = /\[\d+(?:[–-]\d+)?(?:,\s*\d+)*\]|\(\d+\)|\[(?:[^\]]+)\]|\([A-Z][a-z]+(?:\s+et\s+al\.)?,\s*\d{4}\)/;

const testWords: PicoWord[] = [
  { word: "IVF", role: "population" },
  { word: "artificial intelligence embryo selection", role: "intervention" },
  { word: "conventional morphology", role: "comparator" },
  { word: "live birth", role: "outcome" }
];

const unrelatedOutcomeRecords: AuditableRef[] = [
  {
    title: "Deep learning models for blastocyst quality classification in in vitro fertilization",
    journal: "Fertil Steril",
    year: "2023",
    context: "Neural network achieved AUC 0.88 in embryo grading compared to embryologists."
  },
  {
    title: "Artificial intelligence evaluation of embryo images and time-lapse parameters",
    journal: "Hum Reprod",
    year: "2022",
    context: "Image features correlated with cell division timing in culture media."
  }
];

const categories = ["established", "conflicting", "gap"] as const;

test("NF1. Zero-records and no-outcome-mentioning records contain NO forbidden template phrases", () => {
  for (const category of categories) {
    // 1. Zero records
    const screenZero = generateDeterministicScreen(testWords, [], 0, 0);
    const msZero = composeManuscript({
      words: testWords,
      category,
      phrase: screenZero.phrases[category].phrase,
      records: [],
      screeningStats: { retrieved: 0, screened: 0, relaxationLevel: 0, excludedCount: 0 },
      style: "vancouver"
    });

    // 2. Records not mentioning outcome
    const screenUnrelated = generateDeterministicScreen(testWords, unrelatedOutcomeRecords, 0, 2);
    const msUnrelated = composeManuscript({
      words: testWords,
      category,
      phrase: screenUnrelated.phrases[category].phrase,
      records: unrelatedOutcomeRecords.map(r => ({ ...r, relevancePct: 75, matchedElements: ["P", "I"] })),
      screeningStats: { retrieved: 2, screened: 2, relaxationLevel: 0, excludedCount: 0 },
      style: "vancouver"
    });

    const payloadsToVerify = [
      { name: `Screen zero-records (${category})`, text: JSON.stringify(screenZero) },
      { name: `Screen unrelated-outcome (${category})`, text: JSON.stringify(screenUnrelated) },
      { name: `Manuscript zero-records (${category})`, text: JSON.stringify(msZero), title: msZero.title },
      { name: `Manuscript unrelated-outcome (${category})`, text: JSON.stringify(msUnrelated), title: msUnrelated.title }
    ];

    for (const item of payloadsToVerify) {
      for (const regex of FORBIDDEN_REGEXES) {
        assert.ok(!regex.test(item.text), `${item.name} must not match forbidden regex ${regex}`);
      }
      if (item.title) {
        assert.ok(!TITLE_PICO_REGEX.test(item.title), `${item.name} title must not contain (P), (I), (C), or (O) markers: "${item.title}"`);
      }
    }
  }
});

test("NF2. Manuscript title format conforms to neutral framing standard", () => {
  for (const category of categories) {
    const ms = composeManuscript({
      words: testWords,
      category,
      phrase: "Sample phrasing",
      records: unrelatedOutcomeRecords.map(r => ({ ...r, relevancePct: 80, matchedElements: ["P", "I"] })),
      screeningStats: { retrieved: 2, screened: 2, relaxationLevel: 0, excludedCount: 0 },
      style: "vancouver"
    });

    assert.ok(ms.title.includes("artificial intelligence embryo selection versus conventional morphology"));
    assert.ok(ms.title.includes("for live birth in IVF: evidence map and research framing"));
    assert.ok(!TITLE_PICO_REGEX.test(ms.title));
  }
});

test("NF3. Sentences with clinical effect verbs in evidence synthesis carry citations", () => {
  for (const category of categories) {
    const ms = composeManuscript({
      words: testWords,
      category,
      phrase: "Sample phrasing",
      records: unrelatedOutcomeRecords.map(r => ({ ...r, relevancePct: 92, matchedElements: ["P", "I"] })),
      screeningStats: { retrieved: 2, screened: 2, relaxationLevel: 0, excludedCount: 0 },
      style: "vancouver"
    });

    const synthSection = ms.sections.find(s => s.heading === "Evidence synthesis");
    assert.ok(synthSection, "Evidence synthesis section must exist");

    for (const p of synthSection.paragraphs) {
      // Split into sentences
      const sentences = p.split(/(?<=[.!?])\s+/);
      for (const sent of sentences) {
        // If a sentence in evidence synthesis contains an effect verb asserting evidence, it must carry a citation
        if (EFFECT_VERB_REGEX.test(sent)) {
          assert.ok(
            CITATION_MARKER_REGEX.test(sent),
            `Sentence asserting effect direction must carry citation: "${sent}"`
          );
        }
      }
    }
  }
});

test("NF4. AI embryo selection live-birth audit check: no claim of live-birth benefit", () => {
  const screen = generateDeterministicScreen(testWords, unrelatedOutcomeRecords, 0, 2);
  const ms = composeManuscript({
    words: testWords,
    category: "established",
    phrase: screen.phrases.established.phrase,
    records: unrelatedOutcomeRecords.map(r => ({ ...r, relevancePct: 75, matchedElements: ["P", "I"] })),
    screeningStats: { retrieved: 2, screened: 2, relaxationLevel: 0, excludedCount: 0 },
    style: "vancouver"
  });

  const allText = `${JSON.stringify(screen)} ${JSON.stringify(ms)}`.toLowerCase();
  assert.ok(!allText.includes("improves live birth"), "Must never claim AI embryo selection improves live birth");
  assert.ok(!allText.includes("higher live birth"), "Must never claim higher live birth without evidence");
  assert.ok(!allText.includes("favorable signals for live birth"), "Must never claim favorable signals");
});
