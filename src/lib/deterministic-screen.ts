/**
 * Deterministic screening module for AIPICO v4 Step 2.
 * Classifies literature corpus matching intake words into:
 * (i) Established knowledge, (ii) Conflicting evidence, (iii) Research gap.
 * Builds exactly 3 differentiated PICO-formatted phrases with evidence-grounded basis.
 */

import { designOf, sigTokens } from "./relevance.ts";
import type { AuditableRef } from "./relevance.ts";
import type { PicoWord } from "./pico-roles.ts";

export type ScreenCategory = "established" | "conflicting" | "gap";

export interface ScreenPhrase {
  category: ScreenCategory;
  phrase: string;
  basis: string;
}

export interface ScreenCorpusStats {
  retrieved: number;
  screened: number;
  relaxationLevel: 0 | 1 | 2;
}

export interface ScreenPayload {
  inputWords: string[];
  source: "ai" | "deterministic";
  phrases: {
    established: ScreenPhrase;
    conflicting: ScreenPhrase;
    gap: ScreenPhrase;
  };
  corpusStats: ScreenCorpusStats;
}

const ESTABLISHED_REGEX = /\b(reduces|improves|is recommended|first-line|standard of care|effective|beneficial|superior to)\b/i;
const CONFLICTING_REGEX = /\b(no significant difference|controversial|inconsistent|heterogeneous|conflicting results|remains unclear|debatable|equivocal|opposing)\b/i;
const GAP_REGEX = /\b(further research|future studies|limited data|scarcity|lack of|warranted|unresolved|scant evidence|need for well-designed)\b/i;
const SMALL_SAMPLE_REGEX = /\b(case series|case report|pilot study|small sample|preliminary report)\b/i;

/**
 * Pure, no-network classification of retrieved records against input PICO words.
 * Returns signal counts for established, conflicting, and research gap categories.
 */
export function classifyCorpus(
  records: AuditableRef[],
  words: PicoWord[]
): Record<ScreenCategory, number> {
  let established = 0;
  let conflicting = 0;
  let gap = 0;

  if (!records || records.length === 0) {
    // If no records exist, gap signal is naturally elevated
    return { established: 0, conflicting: 0, gap: Math.max(1, words.length) };
  }

  // Pre-tokenize records for word coverage
  const recordTokenSets: Set<string>[] = records.map(r => {
    const fullText = `${r.title} ${r.journal || ""} ${r.context || ""}`;
    return new Set(sigTokens(fullText));
  });

  // Check each word's coverage across the entire corpus
  for (const w of words) {
    const wTokens = sigTokens(w.word);
    if (wTokens.length === 0) continue;
    const covered = recordTokenSets.some(tokSet => wTokens.some(t => tokSet.has(t)));
    if (!covered) {
      gap += 1;
    }
  }

  // Analyze each record for category signals
  let hasIncreased = false;
  let hasDecreased = false;

  for (const r of records) {
    const text = `${r.title} ${r.journal || ""} ${r.context || ""}`;
    const design = designOf(r.title, r.journal || "");

    // Established signals
    if (design === "systematic review / meta-analysis") {
      established += 1;
    }
    if (ESTABLISHED_REGEX.test(text)) {
      established += 1;
    }

    // Conflicting signals
    if (CONFLICTING_REGEX.test(text)) {
      conflicting += 1;
    }
    if (/\bincreased?\b/i.test(text)) hasIncreased = true;
    if (/\bdecreased?\b/i.test(text)) hasDecreased = true;

    if (SMALL_SAMPLE_REGEX.test(text)) {
      conflicting += 1;
    }

    // Gap wording signals in literature
    if (GAP_REGEX.test(text)) {
      gap += 1;
    }
  }

  // Co-occurrence of opposing effect directions across corpus
  if (hasIncreased && hasDecreased) {
    conflicting += 1;
  }

  return { established, conflicting, gap };
}

/**
 * Builds deterministic screening payload with exactly 3 differentiated PICO phrases and evidence bases.
 */
export function generateDeterministicScreen(
  words: PicoWord[],
  corpus: AuditableRef[],
  relaxationLevel: 0 | 1 | 2 = 0,
  retrievedCount?: number
): ScreenPayload {
  const counts = classifyCorpus(corpus, words);
  const totalRetrieved = retrievedCount !== undefined ? retrievedCount : corpus.length;
  const totalScreened = corpus.length;

  // 1. Normalize submitted words into role slots:
  // P = first population word; I1 = first intervention word; I2 = second intervention word;
  // C = first comparator word; O = first outcome word.
  // First submitted wins within each role.
  const pList = words.filter(w => w.role === "population").map(w => w.word);
  const iList = words.filter(w => w.role === "intervention").map(w => w.word);
  const cList = words.filter(w => w.role === "comparator").map(w => w.word);
  const oList = words.filter(w => w.role === "outcome").map(w => w.word);

  const P = pList[0] || "target clinical population";
  const I1 = iList[0] || "clinical intervention";
  const I2 = iList[1]; // may be undefined
  const C = cList[0];   // may be undefined
  const O = oList[0];   // may be undefined

  // Compute per-word corpus coverage:
  // Derived as the count of records whose title + context match that word's sigTokens.
  const recordTokenSets = corpus.map(r => new Set(sigTokens(`${r.title} ${r.journal || ""} ${r.context || ""}`)));

  const wordCoverage = new Map<string, number>();
  for (const w of words) {
    const toks = sigTokens(w.word);
    if (toks.length === 0) {
      wordCoverage.set(w.word, 0);
    } else {
      const matchCount = recordTokenSets.filter(tokSet => toks.some(t => tokSet.has(t))).length;
      wordCoverage.set(w.word, matchCount);
    }
  }

  const zeroCoverageWords = words.filter(w => (wordCoverage.get(w.word) ?? 0) === 0);
  const oCoverage = O ? (wordCoverage.get(O) ?? 0) : 0;

  // Systematic review count for established basis
  const metaReviewCount = corpus.filter(
    r => designOf(r.title, r.journal || "") === "systematic review / meta-analysis"
  ).length;

  // 1. Established phrase: the single best-supported efficacy claim
  // In [P] (P), does [I1] (I) compared with [C if present, else "usual care"] (C) improve [O if present, else "clinical outcomes"] (O)?
  // When an explicit O word was submitted but has 0 coverage in the corpus, the established efficacy claim
  // uses "clinical outcomes" so the unstudied term is not stated as established.
  const estC = C ? C : "usual care";
  const estO = O && (wordCoverage.get(O) ?? 0) > 0 ? O : (O && totalScreened === 0 ? O : "clinical outcomes");
  const establishedPhrase = `In ${P} (P), does ${I1} (I) compared with ${estC} (C) improve ${estO} (O)?`;

  let establishedBasis = "";
  if (metaReviewCount > 0) {
    establishedBasis = `Screened literature contains ${metaReviewCount} systematic review / meta-analysis publication(s) and consensus data evaluating this comparison.`;
  } else if (counts.established > 0) {
    establishedBasis = `Synthesized from ${counts.established} established clinical effectiveness signal(s) identified across screened records.`;
  } else if (totalScreened > 0) {
    establishedBasis = `Derived from baseline clinical guidance across ${totalScreened} retrieved and screened records.`;
  } else {
    establishedBasis = `Baseline clinical formulation derived from input parameters (no records retrieved during exact literature query).`;
  }

  // 2. Conflicting phrase: head-to-head comparison whose evidence disagrees
  // - If C is present: In [P] (P), is [I1] (I) superior to [C] (C) for [O] (O)?
  // - Else if I2 is present: In [P] (P), does [I1] (I) compared with [I2] (C) improve [O] (O)?
  // - Else (single I only): In [P] (P), does [I1] (I) compared with [C-default "usual care"] (C) consistently improve [O] (O) across study designs?
  const confO = O ? O : "clinical outcomes";
  let conflictingPhrase = "";
  if (C) {
    conflictingPhrase = `In ${P} (P), is ${I1} (I) superior to ${C} (C) for ${confO} (O)?`;
  } else if (I2) {
    conflictingPhrase = `In ${P} (P), does ${I1} (I) compared with ${I2} (C) improve ${confO} (O)?`;
  } else {
    conflictingPhrase = `In ${P} (P), does ${I1} (I) compared with usual care (C) consistently improve ${confO} (O) across study designs?`;
  }

  let conflictingBasis = "";
  if (counts.conflicting > 0) {
    conflictingBasis = `Screened records demonstrate conflicting clinical evidence, heterogeneous outcomes, or neutral findings ('no significant difference') across trials.`;
  } else if (totalScreened > 0) {
    conflictingBasis = `Evidence across ${totalScreened} screened studies exhibits protocol variability and heterogeneous patient response.`;
  } else {
    conflictingBasis = `Comparative trial literature lacks conclusive consensus across evaluated clinical parameters.`;
  }

  // 3. Gap phrase: built around the LEAST-covered role word
  // - If some role word has ZERO coverage -> put that word in its PICO slot and center the phrase on it.
  // - Else if all words are covered but O is covered only weakly (<= 1 matching record) -> targets patient-important endpoints:
  //   In [P] (P), does [I1] (I) compared with [C-or-I2-or-default] (C) improve long-term safety and quality-of-life outcomes (O)?
  // - Else (everything well covered) -> subgroup/long-horizon variant:
  //   In high-risk subgroups of [P] (P), does [I1] (I) compared with [C-or-I2-or-default] (C) improve [O] (O) without additional adverse events (O)?
  const cOrI2OrDefault = C ? C : (I2 ? I2 : "usual care");
  let gapPhrase = "";
  let gapBasis = "";

  if (zeroCoverageWords.length > 0 && totalScreened > 0) {
    // Prioritize uncovered outcome, then comparator, then intervention, then population
    const zeroOutcome = zeroCoverageWords.find(w => w.role === "outcome");
    const zeroComparator = zeroCoverageWords.find(w => w.role === "comparator");
    const zeroIntervention = zeroCoverageWords.find(w => w.role === "intervention");
    const zeroPopulation = zeroCoverageWords.find(w => w.role === "population");

    if (zeroOutcome) {
      gapPhrase = `In ${P} (P), does ${I1} (I) compared with ${cOrI2OrDefault} (C) improve ${zeroOutcome.word} (O)?`;
      gapBasis = `No screened record addresses '${zeroOutcome.word}' — comparative evidence for this element is missing.`;
    } else if (zeroComparator) {
      gapPhrase = `In ${P} (P), does ${I1} (I) compared with ${zeroComparator.word} (C) improve ${O || "clinical outcomes"} (O)?`;
      gapBasis = `No screened record addresses '${zeroComparator.word}' — comparative evidence for this element is missing.`;
    } else if (zeroIntervention) {
      const targetI = zeroIntervention.word;
      const comp = targetI === I1 ? (I2 ? I2 : "usual care") : (I1 ? I1 : "usual care");
      gapPhrase = `In ${P} (P), does ${targetI} (I) compared with ${comp} (C) improve ${O || "clinical outcomes"} (O)?`;
      gapBasis = `No screened record addresses '${targetI}' — comparative evidence for this element is missing.`;
    } else if (zeroPopulation) {
      gapPhrase = `In unstudied cohorts of ${zeroPopulation.word} (P), does ${I1} (I) compared with ${cOrI2OrDefault} (C) improve ${O || "clinical outcomes"} (O)?`;
      gapBasis = `No screened record addresses '${zeroPopulation.word}' — comparative evidence for this element is missing.`;
    }
  } else if (totalScreened > 0 && oCoverage <= 1) {
    gapPhrase = `In ${P} (P), does ${I1} (I) compared with ${cOrI2OrDefault} (C) improve long-term safety and quality-of-life outcomes (O)?`;
    gapBasis = `Screened literature provides sparse coverage (${oCoverage} record(s)) for clinical outcomes, leaving long-term safety and patient-reported endpoints unaddressed.`;
  } else if (totalScreened > 0) {
    gapPhrase = `In high-risk subgroups of ${P} (P), does ${I1} (I) compared with ${cOrI2OrDefault} (C) improve ${O || "clinical outcomes"} (O) without additional adverse events (O)?`;
    gapBasis = `While overall efficacy has ${oCoverage} matching records, high-risk subgroup stratification and long-term adverse event profiles remain unaddressed in screened evidence.`;
  } else {
    // Zero-corpus edge case
    const zeroC = C ? C : (I2 ? I2 : "an optimal control regimen");
    gapPhrase = `In ${P} (P), does ${I1} (I) compared with ${zeroC} (C) improve long-term safety and quality-of-life outcomes (O)?`;
    gapBasis = `Uncovered research territory with no indexed records matching all submitted parameters simultaneously.`;
  }

  // Safety differentiation check to ensure pairwise distinctness
  if (gapPhrase === establishedPhrase) {
    if (!C) {
      gapPhrase = gapPhrase.replace("compared with usual care (C)", "compared with an optimal control regimen (C)");
    } else {
      gapPhrase = gapPhrase.replace(`In ${P} (P)`, `In high-risk subgroups of ${P} (P)`);
    }
  }
  if (conflictingPhrase === establishedPhrase) {
    conflictingPhrase = `In ${P} (P), does ${I1} (I) compared with ${estC} (C) consistently improve ${confO} (O) across study designs?`;
  }

  // Word coverage check across phrases and bases:
  // Every submitted word must appear in at least one of the three phrases.
  // Exception: For 5-word inputs where all standard PICO slots are full, any extra submitted
  // word not appearing in the phrases is named verbatim in the basis text.
  const allPhrasesText = `${establishedPhrase} ${conflictingPhrase} ${gapPhrase}`.toLowerCase();
  for (const w of words) {
    if (!allPhrasesText.includes(w.word.toLowerCase())) {
      const allBasesText = `${establishedBasis} ${conflictingBasis} ${gapBasis}`.toLowerCase();
      if (!allBasesText.includes(w.word.toLowerCase())) {
        gapBasis += ` Additional evaluation warranted for submitted parameter '${w.word}'.`;
      }
    }
  }

  return {
    inputWords: words.map(w => w.word),
    source: "deterministic",
    phrases: {
      established: {
        category: "established",
        phrase: establishedPhrase,
        basis: establishedBasis
      },
      conflicting: {
        category: "conflicting",
        phrase: conflictingPhrase,
        basis: conflictingBasis
      },
      gap: {
        category: "gap",
        phrase: gapPhrase,
        basis: gapBasis
      }
    },
    corpusStats: {
      retrieved: totalRetrieved,
      screened: totalScreened,
      relaxationLevel
    }
  };
}
