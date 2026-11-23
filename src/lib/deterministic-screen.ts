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

export type SignalStrength = "none" | "weak" | "moderate";

export interface ScreenPhrase {
  category: ScreenCategory;
  phrase: string;
  basis: string;
  signalStrength: SignalStrength;
  supportingRecordKeys: string[];
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

export function getRecordKey(r: AuditableRef): string {
  if (r.pmid) return `p:${r.pmid}`;
  if (r.doi) return `d:${r.doi}`;
  return `t:${r.title.slice(0, 40)}`;
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
  const _counts = classifyCorpus(corpus, words);
  void _counts;
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

  // Check mention of I and O in records
  const iTokens = sigTokens(I1);
  const oTokens = O ? sigTokens(O) : [];
  const mentionsIAndO = (r: AuditableRef) => {
    const text = `${r.title} ${r.journal || ""} ${r.context || ""}`.toLowerCase();
    const hasI = iTokens.length > 0 ? iTokens.some(t => text.includes(t.toLowerCase())) : true;
    const hasO = oTokens.length > 0 ? oTokens.some(t => text.includes(t.toLowerCase())) : true;
    return hasI && hasO;
  };

  const srMaRecords = corpus.filter(
    r => designOf(r.title, r.journal || "") === "systematic review / meta-analysis" && mentionsIAndO(r)
  );
  const rctRecords = corpus.filter(
    r => designOf(r.title, r.journal || "") === "randomized controlled trial" && mentionsIAndO(r)
  );

  // 1. Established phrase & basis
  // Stated as declarative evidence statement ONLY when supported (>=1 SR/MA or >=2 RCTs mentioning both I and O)
  const isEstSupported = srMaRecords.length >= 1 || rctRecords.length >= 2;
  const estSupportingRecords = [...srMaRecords, ...rctRecords];
  const estSupportingKeys = estSupportingRecords.map(getRecordKey);

  const estC = C ? C : "usual care";
  const estO = O && (wordCoverage.get(O) ?? 0) > 0 ? O : (O && totalScreened === 0 ? O : "clinical outcomes");

  let establishedPhrase = "";
  let establishedBasis = "";
  let establishedStrength: SignalStrength = "none";

  if (isEstSupported) {
    establishedPhrase = `In ${P} (P), evidence from ${estSupportingKeys.length} systematic review(s)/trial(s) addresses ${I1} (I) compared with ${estC} (C) for ${estO} (O).`;
    establishedBasis = `${estSupportingKeys.length} records are titled/typed as systematic review or meta-analysis/RCT evaluating this comparison (record IDs: ${estSupportingKeys.join(", ")}).`;
    establishedStrength = "moderate";
  } else {
    establishedPhrase = "No established finding could be identified from the screened records.";
    establishedStrength = "none";
    if (totalScreened > 0) {
      establishedBasis = `0 records met the threshold of systematic review/meta-analysis or multiple randomized trials evaluating both intervention and outcome among ${totalScreened} screened records.`;
    } else {
      establishedBasis = "0 records were retrieved during screening; no established evidence could be identified.";
    }
  }

  // 2. Conflicting phrase & basis
  const conflictRecords = corpus.filter(r => {
    const text = `${r.title} ${r.journal || ""} ${r.context || ""}`;
    return CONFLICTING_REGEX.test(text) || SMALL_SAMPLE_REGEX.test(text);
  });
  const conflictKeys = conflictRecords.map(getRecordKey);

  const confO = O ? O : "clinical outcomes";
  let conflictingPhrase = "";
  let conflictingBasis = "";
  let conflictingStrength: SignalStrength = "none";

  if (conflictKeys.length > 0) {
    if (C) {
      conflictingPhrase = `In ${P} (P), is ${I1} (I) superior to ${C} (C) for ${confO} (O)?`;
    } else if (I2) {
      conflictingPhrase = `In ${P} (P), does ${I1} (I) compared with ${I2} (C) improve ${confO} (O)?`;
    } else {
      conflictingPhrase = `In ${P} (P), does ${I1} (I) compared with usual care (C) consistently improve ${confO} (O) across study designs?`;
    }
    conflictingBasis = `${conflictKeys.length} record(s) contain disagreement wording (record IDs: ${conflictKeys.join(", ")}).`;
    conflictingStrength = conflictKeys.length >= 2 ? "moderate" : "weak";
  } else {
    conflictingPhrase = "No conflict signal detected among the screened records.";
    conflictingBasis = "0 records contain disagreement wording; no conflict signal was detected.";
    conflictingStrength = "none";
  }

  // 3. Gap phrase & basis
  const cOrI2OrDefault = C ? C : (I2 ? I2 : "usual care");
  let gapPhrase = "";
  let gapBasis = "";
  let gapStrength: SignalStrength = "none";
  let gapSupportingKeys: string[] = [];

  if (zeroCoverageWords.length > 0 && totalScreened > 0) {
    const zeroOutcome = zeroCoverageWords.find(w => w.role === "outcome");
    const zeroComparator = zeroCoverageWords.find(w => w.role === "comparator");
    const zeroIntervention = zeroCoverageWords.find(w => w.role === "intervention");
    const zeroPopulation = zeroCoverageWords.find(w => w.role === "population");
    const missing = zeroOutcome || zeroComparator || zeroIntervention || zeroPopulation || zeroCoverageWords[0];
    const missingWord = missing.word;

    gapPhrase = missing.role === "outcome"
      ? `In ${P} (P), does ${I1} (I) compared with ${cOrI2OrDefault} (C) improve ${missingWord} (O)?`
      : missing.role === "comparator"
      ? `In ${P} (P), does ${I1} (I) compared with ${missingWord} (C) improve ${O || "clinical outcomes"} (O)?`
      : missing.role === "intervention"
      ? `In ${P} (P), does ${missingWord} (I) compared with ${(missingWord === I1 ? (I2 ? I2 : "usual care") : (I1 ? I1 : "usual care"))} (C) improve ${O || "clinical outcomes"} (O)?`
      : `In unstudied cohorts of ${missingWord} (P), does ${I1} (I) compared with ${cOrI2OrDefault} (C) improve ${O || "clinical outcomes"} (O)?`;

    gapBasis = `'${missingWord}' was not found in the titles screened (abstracts not available) — this is NOT evidence of a research gap.`;
    gapStrength = "none";
    gapSupportingKeys = [];
  } else if (totalScreened > 0) {
    const gapRecords = corpus.filter(r => {
      const text = `${r.title} ${r.journal || ""} ${r.context || ""}`;
      return GAP_REGEX.test(text);
    });
    if (gapRecords.length > 0) {
      gapSupportingKeys = gapRecords.map(getRecordKey);
      gapStrength = "weak";
      gapPhrase = `In ${P} (P), does ${I1} (I) compared with ${cOrI2OrDefault} (C) address identified uncertainty in ${O || "clinical outcomes"} (O)?`;
      gapBasis = `${gapSupportingKeys.length} record(s) contain explicit gap or uncertainty wording (record IDs: ${gapSupportingKeys.join(", ")}).`;
    } else {
      gapPhrase = `In high-risk subgroups of ${P} (P), does ${I1} (I) compared with ${cOrI2OrDefault} (C) improve ${O || "clinical outcomes"} (O) without additional adverse events (O)?`;
      gapBasis = `All submitted words were identified at least once in screened titles (${totalScreened} records); full-text appraisal is required to evaluate evidence gaps.`;
      gapStrength = "none";
      gapSupportingKeys = [];
    }
  } else {
    // Zero-corpus edge case
    const zeroC = C ? C : (I2 ? I2 : "an optimal control regimen");
    gapPhrase = `In ${P} (P), does ${I1} (I) compared with ${zeroC} (C) improve long-term safety and quality-of-life outcomes (O)?`;
    gapBasis = "0 records were retrieved during screening (abstracts not available) — this is NOT evidence of a research gap.";
    gapStrength = "none";
    gapSupportingKeys = [];
  }

  // Safety differentiation check to ensure pairwise distinctness
  if (gapPhrase === establishedPhrase && establishedPhrase !== "No established finding could be identified from the screened records.") {
    if (!C) {
      gapPhrase = gapPhrase.replace("compared with usual care (C)", "compared with an optimal control regimen (C)");
    } else {
      gapPhrase = gapPhrase.replace(`In ${P} (P)`, `In high-risk subgroups of ${P} (P)`);
    }
  }
  if (conflictingPhrase === establishedPhrase && establishedPhrase !== "No established finding could be identified from the screened records.") {
    conflictingPhrase = `In ${P} (P), does ${I1} (I) compared with ${estC} (C) consistently improve ${confO} (O) across study designs?`;
  }

  // Word coverage check across phrases and bases:
  // Every submitted word must appear in at least one of the three phrases or bases.
  const allPhrasesText = `${establishedPhrase} ${conflictingPhrase} ${gapPhrase}`.toLowerCase();
  for (const w of words) {
    if (!allPhrasesText.includes(w.word.toLowerCase())) {
      const allBasesText = `${establishedBasis} ${conflictingBasis} ${gapBasis}`.toLowerCase();
      if (!allBasesText.includes(w.word.toLowerCase())) {
        gapBasis += ` Parameter '${w.word}' was not assigned to a primary PICO slot.`;
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
        basis: establishedBasis,
        signalStrength: establishedStrength,
        supportingRecordKeys: estSupportingKeys
      },
      conflicting: {
        category: "conflicting",
        phrase: conflictingPhrase,
        basis: conflictingBasis,
        signalStrength: conflictingStrength,
        supportingRecordKeys: conflictKeys
      },
      gap: {
        category: "gap",
        phrase: gapPhrase,
        basis: gapBasis,
        signalStrength: gapStrength,
        supportingRecordKeys: gapSupportingKeys
      }
    },
    corpusStats: {
      retrieved: totalRetrieved,
      screened: totalScreened,
      relaxationLevel
    }
  };
}
