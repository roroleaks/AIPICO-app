import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCorpus,
  generateDeterministicScreen
} from "./deterministic-screen.ts";
import type { AuditableRef } from "./relevance.ts";
import type { PicoWord } from "./pico-roles.ts";

test("SCR-1. classifyCorpus identifies established, conflicting, and gap signals in fixture corpus", () => {
  const fixtureCorpus: AuditableRef[] = [
    // 2 Reviews / Meta-analyses with established wording
    {
      title: "Growth hormone supplementation for poor responders in IVF: systematic review and meta-analysis",
      journal: "Hum Reprod Update",
      context: "Growth hormone significantly improves live birth rates and reduces cycle cancellation in poor ovarian response."
    },
    {
      title: "Systematic review of adjuvants in poor ovarian response protocols",
      journal: "Fertil Steril",
      context: "Intervention is recommended as standard of care in selected subgroups."
    },
    // 2 Conflicting records with "no significant difference" and controversy
    {
      title: "Randomized trial of adjuvant therapy in poor ovarian response",
      journal: "Reprod Biomed Online",
      context: "There was no significant difference in clinical pregnancy rates between treatment and placebo groups."
    },
    {
      title: "Controversial outcomes of growth hormone in in vitro fertilization",
      journal: "J Assist Reprod Genet",
      context: "Conflicting results and heterogeneous outcomes remain unclear across patient populations."
    }
  ];

  // 4 words, with "acupuncture" completely absent from all fixture records
  const words: PicoWord[] = [
    { word: "poor responders", role: "population" },
    { word: "growth hormone", role: "intervention" },
    { word: "usual care", role: "comparator" },
    { word: "acupuncture", role: "outcome" }
  ];

  const signals = classifyCorpus(fixtureCorpus, words);

  assert.ok(signals.established >= 2, `Expected >= 2 established signals, got ${signals.established}`);
  assert.ok(signals.conflicting >= 2, `Expected >= 2 conflicting signals, got ${signals.conflicting}`);
  assert.ok(signals.gap >= 1, `Expected >= 1 gap signals for absent word, got ${signals.gap}`);
});

test("SCR-2. Smoke fixture: 2 interventions assign I2 to conflicting comparator slot, established keeps usual care, and phrases are pairwise distinct", () => {
  const words: PicoWord[] = [
    { word: "poor responders", role: "population" },
    { word: "ivf", role: "intervention" },
    { word: "growth hormone", role: "intervention" },
    { word: "clinical pregnancy rate", role: "outcome" }
  ];

  const smallCorpus: AuditableRef[] = [
    {
      title: "IVF outcomes in poor responders: systematic review and meta-analysis",
      journal: "Hum Reprod",
      context: "IVF with adjuvant growth hormone improves clinical pregnancy rate in poor responders."
    },
    {
      title: "Adjuvant growth hormone in poor responders: randomized trial",
      journal: "Fertil Steril",
      context: "There was no significant difference between groups; conflicting results across trials."
    }
  ];

  const res = generateDeterministicScreen(words, smallCorpus, 0, 2);

  // Established keeps usual care in (C)
  assert.ok(res.phrases.established.phrase.includes("usual care (C)"));
  assert.ok(res.phrases.established.phrase.includes("ivf (I)"));
  assert.ok(res.phrases.established.phrase.includes("poor responders (P)"));
  assert.equal(res.phrases.established.signalStrength, "moderate");

  // Conflicting uses I2 (growth hormone) in (C) slot
  assert.ok(res.phrases.conflicting.phrase.includes("growth hormone (C)"));
  assert.ok(res.phrases.conflicting.phrase.includes("ivf (I)"));
  assert.equal(res.phrases.conflicting.signalStrength, "weak");

  // All 3 phrases must be pairwise distinct
  assert.notEqual(res.phrases.established.phrase, res.phrases.conflicting.phrase);
  assert.notEqual(res.phrases.established.phrase, res.phrases.gap.phrase);
  assert.notEqual(res.phrases.conflicting.phrase, res.phrases.gap.phrase);

  // Every submitted word must appear somewhere across phrases and bases
  const allText = `${res.phrases.established.phrase} ${res.phrases.conflicting.phrase} ${res.phrases.gap.phrase} ${res.phrases.established.basis} ${res.phrases.conflicting.basis} ${res.phrases.gap.basis}`.toLowerCase();
  for (const w of words) {
    assert.ok(allText.includes(w.word.toLowerCase()), `Word '${w.word}' must appear in phrases or bases`);
  }
});

test("SCR-3. Comparator word fixture: uses submitted comparator with distinct templates (improve vs superior-to)", () => {
  const words: PicoWord[] = [
    { word: "short cervix", role: "population" },
    { word: "vaginal progesterone", role: "intervention" },
    { word: "cervical cerclage", role: "comparator" },
    { word: "preterm birth", role: "outcome" }
  ];

  const corpus: AuditableRef[] = [
    {
      title: "Vaginal progesterone versus cervical cerclage for women with short cervix: a systematic review and meta-analysis",
      journal: "Ultrasound Obstet Gynecol",
      context: "Both interventions show efficacy in reducing preterm birth in short cervix."
    },
    {
      title: "Cervical cerclage vs progesterone: controversial results in short cervix",
      journal: "Am J Obstet Gynecol",
      context: "Conflicting results and heterogeneous outcomes observed."
    }
  ];

  const res = generateDeterministicScreen(words, corpus, 0, 2);

  // Both use cervical cerclage in (C)
  assert.ok(res.phrases.established.phrase.includes("cervical cerclage (C)"));
  assert.ok(res.phrases.established.phrase.includes("preterm birth (O)"));

  assert.ok(res.phrases.conflicting.phrase.includes("cervical cerclage (C)"));
  assert.ok(res.phrases.conflicting.phrase.includes("is vaginal progesterone (I) superior to cervical cerclage (C)"));

  // Pairwise distinctness
  assert.notEqual(res.phrases.established.phrase, res.phrases.conflicting.phrase);
  assert.notEqual(res.phrases.established.phrase, res.phrases.gap.phrase);
  assert.notEqual(res.phrases.conflicting.phrase, res.phrases.gap.phrase);
});

test("SCR-4. Zero-coverage fixture: unaddressed word is placed in gap phrase and basis states missing evidence", () => {
  const words: PicoWord[] = [
    { word: "poor responders", role: "population" },
    { word: "growth hormone", role: "intervention" },
    { word: "usual care", role: "comparator" },
    { word: "acupuncture", role: "outcome" }
  ];

  const corpus: AuditableRef[] = [
    {
      title: "Growth hormone in poor responders undergoing IVF: systematic review",
      journal: "Hum Reprod",
      context: "Growth hormone improves clinical outcomes compared with usual care."
    }
  ];

  const res = generateDeterministicScreen(words, corpus, 0, 1);

  // Gap phrase centers on the zero-coverage word 'acupuncture'
  assert.ok(res.phrases.gap.phrase.includes("acupuncture"));
  assert.ok(res.phrases.gap.basis.includes("acupuncture"));
  assert.ok(res.phrases.gap.basis.includes("was not reported in any screened abstract"));
  assert.equal(res.phrases.gap.signalStrength, "weak");

  // Pairwise distinctness
  assert.notEqual(res.phrases.established.phrase, res.phrases.conflicting.phrase);
  assert.notEqual(res.phrases.established.phrase, res.phrases.gap.phrase);
  assert.notEqual(res.phrases.conflicting.phrase, res.phrases.gap.phrase);
});

test("SCR-5. All-covered fixture: gap phrase uses subgroup and adverse events variant and differs from established", () => {
  const words: PicoWord[] = [
    { word: "poor responders", role: "population" },
    { word: "growth hormone", role: "intervention" },
    { word: "placebo", role: "comparator" },
    { word: "live birth rate", role: "outcome" }
  ];

  // Corpus where every word has at least 2 matching records
  const corpus: AuditableRef[] = [
    {
      title: "Growth hormone vs placebo in poor responders: systematic review",
      journal: "Hum Reprod Update",
      context: "Improves live birth rate significantly in poor responders."
    },
    {
      title: "Live birth rate after growth hormone versus placebo in poor responders",
      journal: "Fertil Steril",
      context: "Poor responders receiving growth hormone vs placebo achieved higher live birth rate."
    }
  ];

  const res = generateDeterministicScreen(words, corpus, 0, 2);

  // Gap phrase uses subgroup/adverse events variant
  assert.ok(res.phrases.gap.phrase.includes("high-risk subgroups of poor responders (P)"));
  assert.ok(res.phrases.gap.phrase.includes("without additional adverse events (O)"));
  assert.notEqual(res.phrases.gap.phrase, res.phrases.established.phrase);

  // Pairwise distinctness
  assert.notEqual(res.phrases.established.phrase, res.phrases.conflicting.phrase);
  assert.notEqual(res.phrases.established.phrase, res.phrases.gap.phrase);
  assert.notEqual(res.phrases.conflicting.phrase, res.phrases.gap.phrase);
});

test("SCR-6. Zero-corpus edge case returns 3 valid, pairwise-distinct honest framings with defaults", () => {
  const words: PicoWord[] = [
    { word: "thin endometrium", role: "population" },
    { word: "prp", role: "intervention" }
  ];

  const res = generateDeterministicScreen(words, [], 2, 0);

  assert.equal(res.source, "deterministic");
  assert.equal(res.corpusStats.retrieved, 0);
  assert.equal(res.corpusStats.screened, 0);
  assert.equal(res.corpusStats.relaxationLevel, 2);

  // Pairwise distinctness
  assert.notEqual(res.phrases.established.phrase, res.phrases.conflicting.phrase);
  assert.notEqual(res.phrases.established.phrase, res.phrases.gap.phrase);
  assert.notEqual(res.phrases.conflicting.phrase, res.phrases.gap.phrase);

  // Established reports no established finding
  assert.equal(res.phrases.established.phrase, "No established finding could be identified from the screened records.");
  assert.equal(res.phrases.established.signalStrength, "none");
  assert.equal(res.phrases.established.supportingRecordKeys.length, 0);

  // Conflicting reports no conflict signal detected
  assert.equal(res.phrases.conflicting.phrase, "No conflict signal detected among the screened records.");
  assert.equal(res.phrases.conflicting.signalStrength, "none");
  assert.equal(res.phrases.conflicting.supportingRecordKeys.length, 0);

  // Gap reports titles missing word and clarifies this is not evidence of a gap
  assert.ok(res.phrases.gap.phrase.includes("thin endometrium"));
  assert.ok(res.phrases.gap.phrase.includes("prp"));
  assert.equal(res.phrases.gap.signalStrength, "none");
  assert.ok(res.phrases.gap.basis.includes("0 records were retrieved during screening (abstracts not available) — this is NOT evidence of a research gap."));
});
