/**
 * Deterministic screening module for AIPICO v5 Step 2.
 * Classifies literature corpus matching intake words into:
 * (i) Established knowledge, (ii) Conflicting evidence, (iii) Research gap.
 * Builds exactly 3 differentiated PICO-formatted phrases with evidence-grounded basis.
 */

import { designOf, sigTokens } from "./relevance.ts";
import type { AuditableRef } from "./relevance.ts";
import type { PicoWord } from "./pico-roles.ts";
import {
  extractAllClaims,
  classifyClaimsForPico,
  getRecordKey
} from "./claim-extraction.ts";

export { getRecordKey };

export type ScreenCategory = "established" | "conflicting" | "gap";

export type SignalStrength = "none" | "weak" | "moderate";

export interface ScreenPhrase {
  category: ScreenCategory;
  phrase: string;
  basis: string;
  signalStrength: SignalStrength;
  supportingRecordKeys: string[];
  rule?: string;
}

export interface ScreenCorpusStats {
  retrieved: number;
  screened: number;
  relaxationLevel: 0 | 1 | 2;
}

export interface ScreenRecordSummary {
  key: string;
  title: string;
  year?: string;
  evidenceType?: string;
  abstractAvailable: boolean;
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
  records?: ScreenRecordSummary[];
  runLog?: {
    timestamp: string;
    queries: Array<{ source: string; query: string; count: number }>;
    abstractCoverage: number;
  };
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
  const totalRetrieved = retrievedCount !== undefined ? retrievedCount : corpus.length;
  const totalScreened = corpus.length;

  // 1. Normalize submitted words into role slots
  const pList = words.filter(w => w.role === "population").map(w => w.word);
  const iList = words.filter(w => w.role === "intervention").map(w => w.word);
  const cList = words.filter(w => w.role === "comparator").map(w => w.word);
  const oList = words.filter(w => w.role === "outcome").map(w => w.word);

  const P = pList[0] || "target clinical population";
  const I1 = iList[0] || "clinical intervention";
  const I2 = iList[1];
  const C = cList[0];
  const O = oList[0];

  // Records summary for API payload
  const recordSummaries: ScreenRecordSummary[] = corpus.map(r => ({
    key: getRecordKey(r),
    title: r.title,
    year: r.year,
    evidenceType: r.evidenceType,
    abstractAvailable: Boolean(r.context && r.context.trim().length > 30)
  }));

  // Edge case: zero records
  if (totalScreened === 0) {
    const zeroC = C ? C : (I2 ? I2 : "an optimal control regimen");
    return {
      inputWords: words.map(w => w.word),
      source: "deterministic",
      phrases: {
        established: {
          category: "established",
          phrase: "No established finding could be identified from the screened records.",
          basis: "0 records were retrieved during screening; no established evidence could be identified.",
          signalStrength: "none",
          supportingRecordKeys: [],
          rule: "no_records_retrieved"
        },
        conflicting: {
          category: "conflicting",
          phrase: "No conflict signal detected among the screened records.",
          basis: "0 records were retrieved during screening; no conflict signal could be detected.",
          signalStrength: "none",
          supportingRecordKeys: [],
          rule: "no_records_retrieved"
        },
        gap: {
          category: "gap",
          phrase: `In ${P} (P), does ${I1} (I) compared with ${zeroC} (C) improve long-term safety and quality-of-life outcomes (O)?`,
          basis: "0 records were retrieved during screening (abstracts not available) — this is NOT evidence of a research gap.",
          signalStrength: "none",
          supportingRecordKeys: [],
          rule: "no_records_retrieved"
        }
      },
      corpusStats: {
        retrieved: totalRetrieved,
        screened: totalScreened,
        relaxationLevel
      },
      records: recordSummaries
    };
  }

  // Extract claims from all abstracts in the corpus
  const claims = extractAllClaims(corpus, oList);
  const claimClassification = classifyClaimsForPico(corpus, claims, {
    P,
    I: I1,
    C: C || "usual care",
    O: O
  });

  // Coverage check on words across record titles + context
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

  // 1. Established phrase
  let establishedPhrase = claimClassification.established.phrase;
  let establishedBasis = claimClassification.established.basis;
  let establishedStrength = claimClassification.established.signalStrength;
  let establishedKeys = claimClassification.established.supportingRecordKeys;
  let establishedRule = claimClassification.established.rule;

  // Fallback to title/design heuristic if claims were sparse but SR/RCTs exist
  if (establishedStrength === "none") {
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
    if (srMaRecords.length >= 1 || rctRecords.length >= 2) {
      const estRecords = [...srMaRecords, ...rctRecords];
      establishedKeys = estRecords.map(getRecordKey);
      establishedStrength = "moderate";
      const estC = C ? C : "usual care";
      const estO = O || "clinical outcomes";
      establishedPhrase = `In ${P} (P), evidence from ${establishedKeys.length} systematic review(s)/trial(s) addresses ${I1} (I) compared with ${estC} (C) for ${estO} (O).`;
      establishedBasis = `${establishedKeys.length} records are titled/typed as systematic review or meta-analysis/RCT evaluating this comparison (record IDs: ${establishedKeys.join(", ")}).`;
      establishedRule = "title_design_concordant";
    }
  }

  // 2. Conflicting phrase
  let conflictingPhrase = claimClassification.conflicting.phrase;
  if (!C && I2 && conflictingPhrase.includes("usual care (C)")) {
    conflictingPhrase = conflictingPhrase.replace("usual care (C)", `${I2} (C)`);
  }
  let conflictingBasis = claimClassification.conflicting.basis;
  let conflictingStrength = claimClassification.conflicting.signalStrength;
  let conflictingKeys = claimClassification.conflicting.supportingRecordKeys;
  let conflictingRule = claimClassification.conflicting.rule;

  // Fallback to text disagreement signals if claim extraction did not find opposing pairs
  if (conflictingStrength === "none") {
    const conflictRecords = corpus.filter(r => {
      const text = `${r.title} ${r.journal || ""} ${r.context || ""}`;
      return CONFLICTING_REGEX.test(text) || SMALL_SAMPLE_REGEX.test(text);
    });
    if (conflictRecords.length > 0) {
      conflictingKeys = conflictRecords.map(getRecordKey);
      conflictingStrength = conflictingKeys.length >= 2 ? "moderate" : "weak";
      const confO = O || "clinical outcomes";
      if (C) {
        conflictingPhrase = `In ${P} (P), is ${I1} (I) superior to ${C} (C) for ${confO} (O)?`;
      } else if (I2) {
        conflictingPhrase = `In ${P} (P), does ${I1} (I) compared with ${I2} (C) improve ${confO} (O)?`;
      } else {
        conflictingPhrase = `In ${P} (P), does ${I1} (I) compared with usual care (C) consistently improve ${confO} (O) across study designs?`;
      }
      conflictingBasis = `${conflictingKeys.length} record(s) contain disagreement wording (record IDs: ${conflictingKeys.join(", ")}).`;
      conflictingRule = "wording_disagreement";
    }
  }

  // 3. Gap phrase
  let gapPhrase = claimClassification.gap.phrase;
  let gapBasis = claimClassification.gap.basis;
  let gapStrength = claimClassification.gap.signalStrength;
  let gapKeys = claimClassification.gap.supportingRecordKeys;
  let gapRule = claimClassification.gap.rule;

  // If a submitted word has zero coverage in the corpus
  const zeroCoverageWords = words.filter(w => (wordCoverage.get(w.word) ?? 0) === 0);
  if (zeroCoverageWords.length > 0) {
    const missing = zeroCoverageWords[0];
    const missingWord = missing.word;
    const cOrI2OrDefault = C ? C : (I2 ? I2 : "usual care");

    gapPhrase = missing.role === "outcome"
      ? `In ${P} (P), does ${I1} (I) compared with ${cOrI2OrDefault} (C) improve ${missingWord} (O)?`
      : missing.role === "comparator"
      ? `In ${P} (P), does ${I1} (I) compared with ${missingWord} (C) improve ${O || "clinical outcomes"} (O)?`
      : missing.role === "intervention"
      ? `In ${P} (P), does ${missingWord} (I) compared with ${(missingWord === I1 ? (I2 ? I2 : "usual care") : (I1 ? I1 : "usual care"))} (C) improve ${O || "clinical outcomes"} (O)?`
      : `In unstudied cohorts of ${missingWord} (P), does ${I1} (I) compared with ${cOrI2OrDefault} (C) improve ${O || "clinical outcomes"} (O)?`;

    gapBasis = `'${missingWord}' was not reported in any screened abstract (abstracts reviewed: ${claims.length}; rule: outcome_not_reported_in_abstracts).`;
    gapStrength = claims.length > 0 ? "weak" : "none";
    gapKeys = claims.map(c => c.key);
    gapRule = "outcome_not_reported_in_abstracts";
  }

  // Ensure pairwise distinctness
  if (gapPhrase === establishedPhrase && establishedStrength !== "none") {
    if (!C) {
      gapPhrase = gapPhrase.replace("compared with usual care (C)", "compared with an optimal control regimen (C)");
    } else {
      gapPhrase = gapPhrase.replace(`In ${P} (P)`, `In high-risk subgroups of ${P} (P)`);
    }
  }
  if (conflictingPhrase === establishedPhrase && establishedStrength !== "none") {
    conflictingPhrase = `In ${P} (P), does ${I1} (I) compared with ${C || "usual care"} (C) consistently improve ${O || "clinical outcomes"} (O) across study designs?`;
  }

  // Word coverage check across phrases and bases
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
        supportingRecordKeys: establishedKeys,
        rule: establishedRule
      },
      conflicting: {
        category: "conflicting",
        phrase: conflictingPhrase,
        basis: conflictingBasis,
        signalStrength: conflictingStrength,
        supportingRecordKeys: conflictingKeys,
        rule: conflictingRule
      },
      gap: {
        category: "gap",
        phrase: gapPhrase,
        basis: gapBasis,
        signalStrength: gapStrength,
        supportingRecordKeys: gapKeys,
        rule: gapRule
      }
    },
    corpusStats: {
      retrieved: totalRetrieved,
      screened: totalScreened,
      relaxationLevel
    },
    records: recordSummaries
  };
}
