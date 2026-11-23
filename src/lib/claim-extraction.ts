/**
 * Deterministic Claim Extraction and Classification Module for AIPICO v5 (PROMPT 03).
 *
 * Implements:
 * 1. Pure deterministic extraction of sample size (n), outcomes, effect direction,
 *    and effect sentence from study abstracts (zero LLM dependency).
 * 2. Guard for AUC / technical prediction models vs patient clinical outcomes (D-02).
 * 3. Evidence-grounded classification rules for ESTABLISHED, CONFLICTING, and GAP (D-15, D-16).
 */

import type { AuditableRef, EvidenceType } from "./relevance.ts";
import { CONCEPT_MAP } from "./concept-map.ts";

export type EffectDirection = "benefit" | "no_difference" | "harm" | "not_reported";
export type EvidenceRole = "clinical_efficacy" | "technical_performance";

export interface ExtractedClaim {
  key: string;
  evidenceType: EvidenceType;
  n?: number;
  outcomesMentioned: string[];
  effectDirection: EffectDirection;
  effectText: string;
  conflictsOfInterestFlag?: boolean;
  evidenceRole: EvidenceRole;
  basis: "abstract";
}

export interface ScreenCategoryResult {
  category: "established" | "conflicting" | "gap";
  phrase: string;
  basis: string;
  signalStrength: "none" | "weak" | "moderate";
  supportingRecordKeys: string[];
  rule: string;
}

export function getRecordKey(r: AuditableRef): string {
  if (r.pmid) return `p:${r.pmid}`;
  if (r.doi) return `d:${r.doi}`;
  return `t:${(r.title || "").slice(0, 40)}`;
}

/**
 * Normalizes an outcome string by matching against CONCEPT_MAP aliases
 * or returning lowercase trimmed outcome string.
 */
export function normalizeOutcome(raw: string): string {
  const lower = raw.toLowerCase().trim();
  for (const entry of CONCEPT_MAP) {
    if (entry.aliases.some(a => a.toLowerCase() === lower || lower.includes(a.toLowerCase()))) {
      return entry.canonical;
    }
  }
  return lower;
}

/**
 * Known clinical patient endpoints to detect in abstracts.
 */
const CLINICAL_ENDPOINTS: { canonical: string; patterns: RegExp[] }[] = [
  {
    canonical: "live birth",
    patterns: [
      /\blive\s+birth(?:s|\s+rate)?\b/i,
      /\blbr\b/i,
      /\bcumulative\s+live\s+birth(?:s|\s+rate)?\b/i,
      /\bclbr\b/i
    ]
  },
  {
    canonical: "clinical pregnancy",
    patterns: [
      /\bclinical\s+pregnancy(?:\s+rate)?\b/i,
      /\bcpr\b/i,
      /\bongoing\s+pregnancy(?:\s+rate)?\b/i,
      /\bopr\b/i,
      /\bimplantation(?:\s+rate)?\b/i
    ]
  },
  {
    canonical: "miscarriage",
    patterns: [
      /\bmiscarriage(?:\s+rate)?\b/i,
      /\bspontaneous\s+abortion\b/i,
      /\bpregnancy\s+loss\b/i
    ]
  },
  {
    canonical: "mortality",
    patterns: [
      /\bmortality\b/i,
      /\boverall\s+survival\b/i,
      /\bdeath\b/i,
      /\ball-cause\s+mortality\b/i
    ]
  },
  {
    canonical: "preterm birth",
    patterns: [
      /\bpreterm\s+birth\b/i,
      /\bpremature\s+birth\b/i,
      /\bpreterm\s+delivery\b/i
    ]
  }
];

/**
 * Technical prediction / diagnostic keywords indicating performance rather than clinical efficacy.
 */
const TECHNICAL_PERFORMANCE_PATTERNS = [
  /\bAUC\b/i,
  /\bROC\b/i,
  /\barea\s+under\s+the\s+curve\b/i,
  /\baccuracy\b/i,
  /\bsensitivity\b/i,
  /\bspecificity\b/i,
  /\bc-index\b/i,
  /\bconcordance\s+index\b/i,
  /\bc-statistic\b/i,
  /\bprediction\s+model\b/i,
  /\bdeep\s+learning\s+model\s+achieved\b/i,
  /\bmodel\s+achieved\b/i
];

/**
 * Extracts sample size (n) from text.
 */
export function extractSampleSize(text: string): number | undefined {
  if (!text) return undefined;

  // Pattern 1: n = 1,066 or N = 500
  const nEqualMatch = text.match(/\b[nN]\s*=\s*([\d,]+)\b/);
  if (nEqualMatch) {
    const val = parseInt(nEqualMatch[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(val) && val > 0 && val < 5_000_000) return val;
  }

  // Pattern 2: 1,066 patients/women/cycles/participants/subjects/embryos
  const cohortMatch = text.match(/\b([\d,]+)\s*(?:patients|women|cycles|participants|subjects|embryos|couples|pregnancies)\b/i);
  if (cohortMatch) {
    const val = parseInt(cohortMatch[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(val) && val > 0 && val < 5_000_000) return val;
  }

  // Pattern 3: total of 1,066 ...
  const totalMatch = text.match(/total\s+of\s+([\d,]+)\b/i);
  if (totalMatch) {
    const val = parseInt(totalMatch[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(val) && val > 0 && val < 5_000_000) return val;
  }

  return undefined;
}

/**
 * Splits text into sentences.
 */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/g)
    .map(s => s.trim())
    .filter(s => s.length > 5);
}

/**
 * Determines effect direction and supporting sentence from abstract sentences.
 */
export function extractEffect(sentences: string[], targetOutcomes: string[]): {
  direction: EffectDirection;
  sentence: string;
} {
  // Regexes for effect direction
  const NO_DIFF_REGEX = /\b(no\s+(?:statistically\s+)?significant\s+difference|not\s+(?:able\s+to\s+demonstrate|show|find)\s+(?:noninferiority|superiority|benefit|difference)|did\s+not\s+(?:differ|improve|increase|show)|failed\s+to\s+(?:differ|improve|increase|demonstrate)|comparable\s+(?:rates?|results?|outcomes?|efficacy)|were\s+comparable|similar\s+(?:rates?|results?|outcomes?|efficacy)|were\s+similar|no\s+difference|(?:RR|OR|HR)\s*[:=]?\s*[\d.]+\s*(?:,\s*95%\s*CI|\s*\(?95%\s*CI)?\s*[:=\[]?\s*0?\.\d+\s*(?:-|to|,)\s*[1-9]\d*\.?\d*)\b/i;
  const BENEFIT_REGEX = /\b(significantly\s+(?:higher|improved|increased|greater|better|superior)|superior\s+(?:to|over)|superiority|improved\s+(?:clinical|live\s+birth|pregnancy|overall|survival)|significantly\s+(?:reduced|lower|decreased)\s+(?:miscarriage|mortality|adverse|death|loss))\b/i;
  const HARM_REGEX = /\b(significantly\s+(?:lower|reduced|decreased|worse)\s+(?:rate|live\s+birth|pregnancy|survival)|inferior|harmful|detrimental|significantly\s+increased\s+(?:miscarriage|mortality|death|adverse|risk))\b/i;

  // Search sentences in reverse (conclusions and results are usually near the end)
  const candidateSentences = [...sentences].reverse();

  // 1. Try finding a sentence mentioning both a target outcome and a direction
  for (const s of candidateSentences) {
    const mentionsTarget = targetOutcomes.some(o => s.toLowerCase().includes(o.toLowerCase()));
    if (mentionsTarget) {
      if (NO_DIFF_REGEX.test(s)) {
        return { direction: "no_difference", sentence: s.slice(0, 300) };
      }
      if (HARM_REGEX.test(s)) {
        return { direction: "harm", sentence: s.slice(0, 300) };
      }
      if (BENEFIT_REGEX.test(s)) {
        return { direction: "benefit", sentence: s.slice(0, 300) };
      }
    }
  }

  // 2. Try any sentence with direction keywords
  for (const s of candidateSentences) {
    if (NO_DIFF_REGEX.test(s)) {
      return { direction: "no_difference", sentence: s.slice(0, 300) };
    }
    if (HARM_REGEX.test(s)) {
      return { direction: "harm", sentence: s.slice(0, 300) };
    }
    if (BENEFIT_REGEX.test(s)) {
      return { direction: "benefit", sentence: s.slice(0, 300) };
    }
  }

  // Default fallback: return last sentence or first sentence
  const fallbackSentence = candidateSentences[0] || "";
  return { direction: "not_reported", sentence: fallbackSentence.slice(0, 300) };
}

/**
 * Extracts a structured claim object from an AuditableRef with an abstract.
 */
export function extractRecordClaim(
  r: AuditableRef,
  userOutcomes: string[] = []
): ExtractedClaim {
  const text = `${r.title} ${r.context || ""}`;
  const key = getRecordKey(r);
  const evidenceType: EvidenceType = r.evidenceType || "unclassified";
  const n = extractSampleSize(text);

  // Identify outcomes mentioned
  const outcomesMentioned: string[] = [];
  const textLower = text.toLowerCase();

  for (const ep of CLINICAL_ENDPOINTS) {
    if (ep.patterns.some(p => p.test(text))) {
      outcomesMentioned.push(ep.canonical);
    }
  }

  for (const uo of userOutcomes) {
    const norm = normalizeOutcome(uo);
    if (!outcomesMentioned.includes(norm) && textLower.includes(uo.toLowerCase())) {
      outcomesMentioned.push(norm);
    }
  }

  // Check technical performance vs patient clinical outcomes
  const hasTechnicalTerms = TECHNICAL_PERFORMANCE_PATTERNS.some(p => p.test(text));
  const hasPatientOutcomes = outcomesMentioned.length > 0;
  const isPredictionWithoutPatientOutcomes = hasTechnicalTerms && !hasPatientOutcomes;

  const evidenceRole: EvidenceRole = isPredictionWithoutPatientOutcomes
    ? "technical_performance"
    : "clinical_efficacy";

  // Check conflict of interest
  const conflictsOfInterestFlag = /\b(conflict(?:s)?\s+of\s+interest|competing\s+interest|commercial\s+sponsor|employed\s+by|employee\s+of)\b/i.test(text);

  // Extract sentences and determine effect direction
  const sentences = splitSentences(r.context || r.title);
  const targetList = outcomesMentioned.length > 0 ? outcomesMentioned : userOutcomes;
  const { direction, sentence } = extractEffect(sentences, targetList);

  return {
    key,
    evidenceType,
    n,
    outcomesMentioned,
    effectDirection: direction,
    effectText: sentence,
    conflictsOfInterestFlag,
    evidenceRole,
    basis: "abstract"
  };
}

/**
 * Extracts claims for all records that have abstracts available.
 */
export function extractAllClaims(
  records: AuditableRef[],
  userOutcomes: string[] = []
): ExtractedClaim[] {
  return records
    .filter(r => Boolean(r.context && r.context.trim().length > 30))
    .map(r => extractRecordClaim(r, userOutcomes));
}

/**
 * Helper to build PICO established / conflicting / gap statements from claims.
 */
export function classifyClaimsForPico(
  records: AuditableRef[],
  claims: ExtractedClaim[],
  pico: { P: string; I: string; C?: string; O?: string }
): {
  established: ScreenCategoryResult;
  conflicting: ScreenCategoryResult;
  gap: ScreenCategoryResult;
} {
  const P = pico.P;
  const I = pico.I;
  const C = pico.C || "conventional morphology";
  const targetOutcome = pico.O ? normalizeOutcome(pico.O) : "clinical pregnancy";

  // Filter clinical efficacy claims vs technical performance
  const efficacyClaims = claims.filter(c => c.evidenceRole === "clinical_efficacy");
  const techClaims = claims.filter(c => c.evidenceRole === "technical_performance");

  // -------------------------------------------------------------
  // 1. ESTABLISHED CLASSIFICATION
  // Rule: >=1 SR/MA OR >=2 RCTs reporting the selected outcome (or nearest reported outcome),
  // with the SAME effectDirection and none contradicting.
  // -------------------------------------------------------------
  const highLevelClaims = efficacyClaims.filter(c =>
    (c.evidenceType === "systematic_review" || c.evidenceType === "meta_analysis" || c.evidenceType === "rct") &&
    (c.outcomesMentioned.includes(targetOutcome) || (targetOutcome === "live birth" && c.outcomesMentioned.includes("clinical pregnancy")))
  );

  // Group by effect direction
  const srMaCount = highLevelClaims.filter(c => c.evidenceType === "systematic_review" || c.evidenceType === "meta_analysis").length;
  const rctCount = highLevelClaims.filter(c => c.evidenceType === "rct").length;

  const directionsPresent = new Set(highLevelClaims.map(c => c.effectDirection).filter(d => d !== "not_reported"));

  let established: ScreenCategoryResult;

  if ((srMaCount >= 1 || rctCount >= 2) && directionsPresent.size === 1) {
    const commonDir = Array.from(directionsPresent)[0];
    const outcomeReported = highLevelClaims.some(c => c.outcomesMentioned.includes(targetOutcome))
      ? targetOutcome
      : "clinical pregnancy";

    const dirText = commonDir === "no_difference"
      ? "no significant difference"
      : commonDir === "benefit"
      ? "a significant benefit"
      : "significant harm";

    const typeSummary = srMaCount >= 1 && rctCount >= 1
      ? `${srMaCount} systematic review/meta-analysis and ${rctCount} RCT(s)`
      : srMaCount >= 1
      ? `${srMaCount} systematic review/meta-analysis`
      : `${rctCount} randomised controlled trials`;

    const keys = highLevelClaims.map(c => c.key);
    const citeString = keys.join(", ");

    established = {
      category: "established",
      phrase: `In ${P} (P), evidence from ${typeSummary} reporting ${outcomeReported} (O) found ${dirText} for ${I} (I) vs ${C} (C).`,
      basis: `${keys.length} high-level evidence record(s) evaluating ${I} vs ${C} for ${outcomeReported} found ${dirText} (${citeString}).`,
      signalStrength: "moderate",
      supportingRecordKeys: keys,
      rule: srMaCount >= 1 ? "sr_ma_concordant" : "multiple_rct_concordant"
    };
  } else {
    established = {
      category: "established",
      phrase: "No established finding identified from screened records.",
      basis: `0 records met the threshold of systematic review/meta-analysis or multiple randomized trials with concordant effect direction for ${targetOutcome} among ${records.length} screened records.`,
      signalStrength: "none",
      supportingRecordKeys: [],
      rule: "insufficient_high_level_evidence"
    };
  }

  // -------------------------------------------------------------
  // 2. CONFLICTING CLASSIFICATION
  // Rule: >=2 records with evidenceType in {rct, cohort, systematic_review, meta_analysis}
  // reporting the same outcome with DIFFERENT effectDirection.
  // -------------------------------------------------------------
  const relevantConflictCandidates = efficacyClaims.filter(c =>
    ["rct", "cohort", "systematic_review", "meta_analysis"].includes(c.evidenceType) &&
    c.effectDirection !== "not_reported" &&
    (c.outcomesMentioned.includes(targetOutcome) || (targetOutcome === "live birth" && c.outcomesMentioned.includes("clinical pregnancy")))
  );

  const conflictOutcomes = Array.from(new Set(relevantConflictCandidates.flatMap(c => c.outcomesMentioned)));
  let foundConflictOutcome: string | null = null;
  let opposingSideA: ExtractedClaim[] = [];
  let opposingSideB: ExtractedClaim[] = [];

  for (const outcome of conflictOutcomes) {
    const claimsForOutcome = relevantConflictCandidates.filter(c => c.outcomesMentioned.includes(outcome));
    const directions = Array.from(new Set(claimsForOutcome.map(c => c.effectDirection)));
    if (directions.length >= 2) {
      foundConflictOutcome = outcome;
      opposingSideA = claimsForOutcome.filter(c => c.effectDirection === directions[0]);
      opposingSideB = claimsForOutcome.filter(c => c.effectDirection === directions[1]);
      break;
    }
  }

  let conflicting: ScreenCategoryResult;

  if (foundConflictOutcome && opposingSideA.length > 0 && opposingSideB.length > 0) {
    const allConflictKeys = [...opposingSideA.map(c => c.key), ...opposingSideB.map(c => c.key)];
    const formatSide = (claims: ExtractedClaim[]) => {
      return claims.map(c => `${c.key} (${c.evidenceType}${c.n ? `, n=${c.n}` : ""}: ${c.effectDirection})`).join(", ");
    };

    conflicting = {
      category: "conflicting",
      phrase: `In ${P} (P), does ${I} (I) compared with ${C} (C) improve ${foundConflictOutcome} (O)?`,
      basis: `Conflicting results detected among ${allConflictKeys.length} records reporting ${foundConflictOutcome}: [${formatSide(opposingSideA)}] vs [${formatSide(opposingSideB)}].`,
      signalStrength: "moderate",
      supportingRecordKeys: allConflictKeys,
      rule: "opposing_effect_directions"
    };
  } else {
    const countReporting = relevantConflictCandidates.length;
    conflicting = {
      category: "conflicting",
      phrase: `No conflicting results detected among screened records.`,
      basis: `No conflicting results detected among ${countReporting} record(s) reporting ${targetOutcome}.`,
      signalStrength: "none",
      supportingRecordKeys: [],
      rule: "no_conflicting_signals"
    };
  }

  // -------------------------------------------------------------
  // 3. GAP CLASSIFICATION
  // Rules (in order):
  // (a) outcome never reported in any abstract (state "abstracts reviewed: N")
  // (b) only non-randomised / prediction-only evidence for the outcome
  // (c) only preprints/registrations for the outcome
  // (d) registered trials without results (trial_registration)
  // -------------------------------------------------------------
  let gap: ScreenCategoryResult;

  const abstractsCount = claims.length;
  const claimsWithTargetOutcome = claims.filter(c => c.outcomesMentioned.includes(targetOutcome));

  // Check rule (d): registered trials without results
  const trialRegistrations = records.filter(r => r.evidenceType === "trial_registration");

  // Check rule (a): outcome never reported in any abstract
  if (claimsWithTargetOutcome.length === 0) {
    gap = {
      category: "gap",
      phrase: `In ${P} (P), does ${I} (I) compared with ${C} (C) improve ${targetOutcome} (O)?`,
      basis: `Outcome '${targetOutcome}' was not reported in any screened abstract (abstracts reviewed: ${abstractsCount}; rule: outcome_not_reported_in_abstracts).`,
      signalStrength: abstractsCount > 0 ? "weak" : "none",
      supportingRecordKeys: claims.map(c => c.key),
      rule: "outcome_not_reported_in_abstracts"
    };
  }
  // Check rule (b): only non-randomised or prediction-only evidence for the outcome
  else if (claimsWithTargetOutcome.every(c => c.evidenceRole === "technical_performance" || ["cohort", "observational", "case_control"].includes(c.evidenceType))) {
    const keys = claimsWithTargetOutcome.map(c => c.key);
    gap = {
      category: "gap",
      phrase: `In ${P} (P), does ${I} (I) compared with ${C} (C) improve ${targetOutcome} (O) in randomised trials?`,
      basis: `Only non-randomised or technical prediction evidence is available for '${targetOutcome}'; randomised controlled trials and cumulative efficacy data are lacking (abstracts reviewed: ${abstractsCount}; rule: only_non_randomised_evidence).`,
      signalStrength: "weak",
      supportingRecordKeys: keys,
      rule: "only_non_randomised_evidence"
    };
  }
  // Check rule (c): only preprints or registrations for the outcome
  else if (claimsWithTargetOutcome.every(c => ["preprint", "trial_registration"].includes(c.evidenceType))) {
    const keys = claimsWithTargetOutcome.map(c => c.key);
    gap = {
      category: "gap",
      phrase: `In ${P} (P), does ${I} (I) compared with ${C} (C) improve ${targetOutcome} (O) in peer-reviewed trials?`,
      basis: `Evidence for '${targetOutcome}' is currently confined to preprints or trial registrations without peer-reviewed journal publication (abstracts reviewed: ${abstractsCount}; rule: only_preprints_or_registrations).`,
      signalStrength: "weak",
      supportingRecordKeys: keys,
      rule: "only_preprints_or_registrations"
    };
  }
  // Check rule (d): registered trials without results exist
  else if (trialRegistrations.length > 0) {
    const regKeys = trialRegistrations.map(getRecordKey);
    gap = {
      category: "gap",
      phrase: `In ${P} (P), will ongoing clinical trials establish whether ${I} (I) compared with ${C} (C) improves ${targetOutcome} (O)?`,
      basis: `Registered clinical trials evaluating this comparison are currently active without completed published results (trial records: ${regKeys.join(", ")}; rule: registered_trials_pending).`,
      signalStrength: "weak",
      supportingRecordKeys: regKeys,
      rule: "registered_trials_pending"
    };
  }
  // Fallback: outcome is addressed in trials; subgroup or long-term safety gap
  else {
    gap = {
      category: "gap",
      phrase: `In high-risk subgroups of ${P} (P), does ${I} (I) compared with ${C} (C) improve ${targetOutcome} (O) without additional adverse events (O)?`,
      basis: `Primary outcome '${targetOutcome}' is addressed in screened randomised evidence; subgroup-specific efficacy, cumulative live birth, and health economic outcomes require appraisal.`,
      signalStrength: "none",
      supportingRecordKeys: [],
      rule: "subgroup_and_longterm_gap"
    };
  }

  // Also note technical performance claims if any
  if (techClaims.length > 0 && gap.category === "gap" && gap.signalStrength !== "none") {
    gap.basis += ` Note: ${techClaims.length} prediction model record(s) reporting AUC/accuracy without clinical endpoints were separated from efficacy.`;
  }

  return { established, conflicting, gap };
}
