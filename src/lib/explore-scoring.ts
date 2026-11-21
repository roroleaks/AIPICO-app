/**
 * Deterministic scoring module for AIPICO v4 Step 3 (Evidence Explorer).
 * Computes per-record percentage relevance to a selected PICO phrase,
 * applies category-specific evidence bonuses (capped at +10),
 * filters blocked/seen records, and sorts deterministically.
 * Pure, synchronous, zero AI/network calls.
 */

import { auditRef, designOf } from "./relevance.ts";
import type { AuditableRef, PicoElement } from "./relevance.ts";
import { extractPicoFromQuestion } from "./pico-parser.ts";

export interface ExploreRecord extends AuditableRef {
  relevancePct: number;
  matchedElements: string[];
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
 * Computes deterministic relevance percentages and filters blocked keys.
 * Category bonuses are additive and strictly capped at +10 total.
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

  // 1. Filter out blocked records and calculate element coverage counts across surviving records
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

    if (audit) {
      if (audit.population) matchedElements.push("P");
      if (audit.intervention) matchedElements.push("I");
      if (audit.comparator) matchedElements.push("C");
      if (audit.outcome) matchedElements.push("O");
    }

    // Base score calculation (0–75 from matched elements, +15 from metadata completeness/design)
    const elementRatio = elements.length > 0 ? matchedElements.length / elements.length : 0;
    let baseScore = Math.round(elementRatio * 75);

    if (audit?.metadataCompleteness?.hasAbstract) baseScore += 5;
    if (audit?.doiOk || audit?.pmidResolved) baseScore += 5;
    const design = designOf(r.title || "", r.journal || "");
    if (design !== "unclassified") baseScore += 5;

    // Category bonus calculation (additive, capped at +10)
    let rawCategoryBonus = 0;
    const fullText = `${r.title || ""} ${r.journal || ""} ${r.context || ""}`;

    if (category === "established") {
      // Systematic review / meta-analysis design: +5
      if (design === "systematic review / meta-analysis") rawCategoryBonus += 5;
      // Consensus wording: +3
      if (ESTABLISHED_BONUS_WORDS.test(fullText)) rawCategoryBonus += 3;
    } else if (category === "conflicting") {
      // Disagreement wording: +5
      if (CONFLICTING_BONUS_WORDS.test(fullText)) rawCategoryBonus += 5;
      // Small sample designs: +2
      if (CONFLICTING_SMALL_SAMPLE.test(fullText) || /case|pilot/i.test(design)) rawCategoryBonus += 2;
    } else if (category === "gap") {
      // Record matches the lowest-coverage element in the corpus: +5
      if (lowestCoverageElement && matchedElements.includes(lowestCoverageElement)) {
        rawCategoryBonus += 5;
      }
      // Research hurdle wording: +3
      if (GAP_BONUS_WORDS.test(fullText)) rawCategoryBonus += 3;
    }

    const categoryBonus = Math.min(10, Math.max(0, rawCategoryBonus));
    const totalScore = Math.max(0, Math.min(100, Math.round(baseScore + categoryBonus)));
    const relevancePct = Number.isFinite(totalScore) ? totalScore : 0;

    scored.push({
      ...r,
      relevancePct,
      matchedElements
    });
  }

  // 3. Sort deterministically: relevancePct desc -> year desc -> title asc
  scored.sort((a, b) => {
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
