/**
 * Deterministic scoring module for AIPICO v5 Step 3 (Evidence Explorer).
 * Computes per-record percentage relevance to a selected PICO phrase,
 * extracts per-element (P, I, C, O) match status (abstract vs title vs absent),
 * removes the +15 metadata/design bonus from percentage (D-18),
 * filters blocked/seen records, and sorts by evidenceType rank > concept coverage > year.
 * Pure, synchronous, zero AI/network calls.
 */

import { auditRef, designOf, sigTokens, synonymize } from "./relevance.ts";
import type { AuditableRef, PicoElement, EvidenceType } from "./relevance.ts";
import { extractPicoFromQuestion } from "./pico-parser.ts";
import { extractRecordClaim } from "./claim-extraction.ts";

export type MatchStatus = "abstract" | "title" | "absent";

export interface ElementMatchDetail {
  status: MatchStatus;
  terms: string[];
}

export interface PicoMatchDetails {
  P: ElementMatchDetail;
  I: ElementMatchDetail;
  C: ElementMatchDetail;
  O: ElementMatchDetail;
}

export interface ExploreRecord extends AuditableRef {
  relevancePct: number;
  matchedElements: string[];
  picoMatches?: PicoMatchDetails;
  evidenceRole?: "clinical_efficacy" | "technical_performance";
}

export interface ScoreRecordsResult {
  scored: ExploreRecord[];
  removedByBlock: number;
}

const ESTABLISHED_BONUS_WORDS = /\b(reduces|improves|first-line|recommended)\b/i;
const CONFLICTING_BONUS_WORDS = /\b(no significant difference|heterogeneous|inconsistent|controversial|conflicting)\b/i;
const CONFLICTING_SMALL_SAMPLE = /\b(case series|case report|pilot study|small sample|preliminary report)\b/i;
const GAP_BONUS_WORDS = /\b(limited data|further research|scarcity|unresolved|need for well-designed)\b/i;

/**
 * Ranks evidence types according to the hierarchy of evidence (D-18).
 * SR/MA > RCT > cohort > case-control > observational > narrative review > preprint > trial registration > book chapter / thesis > unclassified.
 */
export function getEvidenceTypeRank(evidenceType?: EvidenceType): number {
  switch (evidenceType) {
    case "meta_analysis":
      return 10;
    case "systematic_review":
      return 9;
    case "rct":
      return 8;
    case "cohort":
      return 7;
    case "case_control":
      return 6;
    case "cross_sectional":
    case "case_series":
      return 5;
    case "guideline":
    case "narrative_review":
      return 4;
    case "preprint":
      return 3;
    case "trial_registration":
      return 2;
    case "book_chapter":
    case "thesis":
    case "editorial_commentary":
      return 1;
    case "unclassified":
    default:
      return 0;
  }
}

/**
 * Derives canonical identifier keys for an auditable reference.
 * Matches the key structure used across engine retrieval stages.
 */
export function refCanonicalKeys(r: AuditableRef): string[] {
  const keys: string[] = [];
  if (r.pmid) keys.push("p:" + r.pmid.trim());
  if (r.doi) keys.push("d:" + r.doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, "").trim());
  const t = (r.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (t.length > 12) keys.push("t:" + t.slice(0, 50));
  return keys;
}

/**
 * Parses a PICO phrase into structured PicoElement list.
 * Falls back to regex segmentation on markers if standard parsing fails.
 */
export function parsePhraseElements(phrase: string): PicoElement[] {
  try {
    const extracted = extractPicoFromQuestion(phrase);
    const elements: PicoElement[] = [];
    if (extracted.condition) elements.push({ label: "P — Population", value: extracted.condition });
    if (extracted.intervention) elements.push({ label: "I — Intervention", value: extracted.intervention });
    if (extracted.comparator) elements.push({ label: "C — Comparator", value: extracted.comparator });
    if (extracted.outcome) elements.push({ label: "O — Outcome", value: extracted.outcome });
    if (elements.length > 0) return elements;
  } catch {}

  // Fallback regex extraction of literal (P), (I), (C), (O) tagged segments
  const fallback: PicoElement[] = [];
  const pMatch = phrase.match(/^(?:In|For|Among)?\s*(.+?)\s*\(P\)/i) || phrase.match(/([^(]+?)\s*\(P\)/i);
  const iMatch = phrase.match(/\(P\)[^]*?\b(?:does|is|do)?\s+(.+?)\s*\(I\)/i) || phrase.match(/([^(]+?)\s*\(I\)/i);
  const cMatch = phrase.match(/\(I\)[^]*?\b(?:compared with|versus|vs\.?|superior to)?\s+(.+?)\s*\(C\)/i) || phrase.match(/([^(]+?)\s*\(C\)/i);
  const oMatch = phrase.match(/\(C\)[^]*?(?:improve|reduce|increase|for|affect)?\s+(.+?)\s*\(O\)/i) || phrase.match(/([^(]+?)\s*\(O\)/i);

  if (pMatch?.[1]?.trim()) fallback.push({ label: "P — Population", value: pMatch[1].trim() });
  if (iMatch?.[1]?.trim()) fallback.push({ label: "I — Intervention", value: iMatch[1].trim() });
  if (cMatch?.[1]?.trim()) fallback.push({ label: "C — Comparator", value: cMatch[1].trim() });
  if (oMatch?.[1]?.trim()) fallback.push({ label: "O — Outcome", value: oMatch[1].trim() });

  return fallback;
}

/**
 * Checks whether an element's concept matches in title vs abstract vs absent.
 */
function checkElementMatch(
  element: PicoElement | undefined,
  title: string,
  abstractText: string
): ElementMatchDetail {
  if (!element || !element.value || element.value.replace(/[^a-zA-Z]/g, "").length < 2) {
    return { status: "absent", terms: [] };
  }

  const toks = sigTokens(element.value);
  if (toks.length === 0) {
    return { status: "absent", terms: [] };
  }

  const normTitle = synonymize(title || "").toLowerCase();
  const normAbstract = synonymize(abstractText || "").toLowerCase();

  const titleHits = toks.filter(t => normTitle.includes(t.toLowerCase()));
  const abstractHits = toks.filter(t => normAbstract.includes(t.toLowerCase()));

  const minHits = toks.length === 1 ? 1 : 2;

  if (abstractHits.length >= minHits) {
    return { status: "abstract", terms: abstractHits };
  }
  if (titleHits.length >= minHits) {
    return { status: "title", terms: titleHits };
  }

  // Also check if entire element phrase is present
  const normVal = synonymize(element.value).toLowerCase();
  if (normVal.length >= 5) {
    if (normAbstract.includes(normVal)) {
      return { status: "abstract", terms: [element.value] };
    }
    if (normTitle.includes(normVal)) {
      return { status: "title", terms: [element.value] };
    }
  }

  // Check 1 hit for multi-word if title or abstract matched
  if (abstractHits.length >= 1 && toks.length > 1) {
    return { status: "abstract", terms: abstractHits };
  }
  if (titleHits.length >= 1 && toks.length > 1) {
    return { status: "title", terms: titleHits };
  }

  return { status: "absent", terms: [] };
}

/**
 * Computes deterministic relevance percentages and filters blocked keys.
 * Removes the +15 metadata/design bonus (D-18).
 * Assigns P/I/C/O match details.
 * Sorts by evidenceType rank > relevancePct > year > title.
 */
export function scoreRecords(
  records: AuditableRef[],
  phrase: string,
  category: "established" | "conflicting" | "gap",
  blockedKeys: string[] = []
): ScoreRecordsResult {
  if (!records || !Array.isArray(records)) {
    return { scored: [], removedByBlock: 0 };
  }

  const blockedSet = new Set(blockedKeys.map(k => k.trim()).filter(Boolean));
  const elements = parsePhraseElements(phrase);

  const elP = elements.find(e => e.label.startsWith("P"));
  const elI = elements.find(e => e.label.startsWith("I"));
  const elC = elements.find(e => e.label.startsWith("C"));
  const elO = elements.find(e => e.label.startsWith("O"));

  // 1. Filter out blocked records
  const unblocked: AuditableRef[] = [];
  let removedByBlock = 0;

  for (const r of records) {
    const keys = refCanonicalKeys(r);
    const isBlocked = keys.some(k => blockedSet.has(k));
    if (isBlocked) {
      removedByBlock += 1;
    } else {
      unblocked.push(r);
    }
  }

  // Pre-audit surviving records to determine element coverage for gap category bonus
  const audits = unblocked.map(r => ({
    ref: r,
    audit: elements.length > 0 ? auditRef(r, elements) : null
  }));

  let lowestCoverageElement: "P" | "I" | "C" | "O" | null = null;
  if (category === "gap" && elements.length > 0) {
    const counts = {
      P: audits.filter(a => a.audit?.population).length,
      I: audits.filter(a => a.audit?.intervention).length,
      C: audits.filter(a => a.audit?.comparator).length,
      O: audits.filter(a => a.audit?.outcome).length
    };
    const order: Array<"P" | "I" | "C" | "O"> = ["P", "I", "C", "O"];
    let minVal = Infinity;
    for (const el of order) {
      if (counts[el] < minVal) {
        minVal = counts[el];
        lowestCoverageElement = el;
      }
    }
  }

  // 2. Score each surviving record
  const scored: ExploreRecord[] = [];

  for (const item of audits) {
    const r = item.ref;
    const audit = item.audit;
    const matchedElements: string[] = [];

    // Detailed P/I/C/O match check for chips
    const pMatch = checkElementMatch(elP, r.title, r.context || "");
    const iMatch = checkElementMatch(elI, r.title, r.context || "");
    const cMatch = checkElementMatch(elC, r.title, r.context || "");
    const oMatch = checkElementMatch(elO, r.title, r.context || "");

    const picoMatches: PicoMatchDetails = {
      P: pMatch,
      I: iMatch,
      C: cMatch,
      O: oMatch
    };

    if (audit) {
      if (audit.population || pMatch.status !== "absent") matchedElements.push("P");
      if (audit.intervention || iMatch.status !== "absent") matchedElements.push("I");
      if (audit.comparator || cMatch.status !== "absent") matchedElements.push("C");
      if (audit.outcome || oMatch.status !== "absent") matchedElements.push("O");
    }

    // Base score calculation: strictly from concept matches (0–90).
    // The +15 metadata/design bonus is removed (D-18); design is rendered as an evidence badge.
    const elementRatio = elements.length > 0 ? matchedElements.length / elements.length : 0;
    const baseScore = Math.round(elementRatio * 90);

    // Category bonus calculation (additive, capped at +10)
    let rawCategoryBonus = 0;
    const fullText = `${r.title || ""} ${r.journal || ""} ${r.context || ""}`;
    const design = designOf(r.title || "", r.journal || "");

    if (category === "established") {
      if (design === "systematic review / meta-analysis" || r.evidenceType === "meta_analysis" || r.evidenceType === "systematic_review") {
        rawCategoryBonus += 5;
      }
      if (ESTABLISHED_BONUS_WORDS.test(fullText)) rawCategoryBonus += 3;
    } else if (category === "conflicting") {
      if (CONFLICTING_BONUS_WORDS.test(fullText)) rawCategoryBonus += 5;
      if (CONFLICTING_SMALL_SAMPLE.test(fullText) || /case|pilot/i.test(design)) rawCategoryBonus += 2;
    } else if (category === "gap") {
      if (lowestCoverageElement && matchedElements.includes(lowestCoverageElement)) {
        rawCategoryBonus += 5;
      }
      if (GAP_BONUS_WORDS.test(fullText)) rawCategoryBonus += 3;
    }

    const categoryBonus = Math.min(10, Math.max(0, rawCategoryBonus));
    const totalScore = Math.max(0, Math.min(100, Math.round(baseScore + categoryBonus)));
    const relevancePct = Number.isFinite(totalScore) ? totalScore : 0;

    const claim = extractRecordClaim(r);

    scored.push({
      ...r,
      relevancePct,
      matchedElements,
      picoMatches,
      evidenceRole: claim.evidenceRole
    });
  }

  // 3. Sort deterministically:
  // evidenceType rank desc -> relevancePct desc -> year desc -> title asc
  scored.sort((a, b) => {
    const rankA = getEvidenceTypeRank(a.evidenceType);
    const rankB = getEvidenceTypeRank(b.evidenceType);
    if (rankB !== rankA) {
      return rankB - rankA;
    }
    if (b.relevancePct !== a.relevancePct) {
      return b.relevancePct - a.relevancePct;
    }
    const yearA = parseInt(a.year || "0", 10) || 0;
    const yearB = parseInt(b.year || "0", 10) || 0;
    if (yearB !== yearA) {
      return yearB - yearA;
    }
    return (a.title || "").localeCompare(b.title || "");
  });

  return { scored, removedByBlock };
}
