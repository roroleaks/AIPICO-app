import type { AuditableRef } from "./relevance.ts";
import { checkCitations, extractInTextCites, formatReference, foldName } from "./relevance.ts";
import { normalizeDoi, type EvidenceWarning } from "./evidence-set.ts";

/**
 * Narrative fields the reader can see. Citation integrity has to hold across all of them: a
 * citation stranded in the conclusion is the same defect as one stranded in the discussion,
 * because the reader still meets an attribution the bibliography does not support.
 */
export const NARRATIVE_FIELDS = ["abstract", "introduction", "discussion", "conclusion"] as const;
export type NarrativeField = (typeof NARRATIVE_FIELDS)[number];

export interface DeliverableIntegrityInput {
  /** Every narrative field that can reach a deliverable. */
  fields: Record<string, string>;
  /** The reference list as it will be published. */
  references: string[];
  /** Exactly the records behind `references`: the claim-specific retained evidence set. */
  retainedRecords: AuditableRef[];
  /**
   * Reference strings a deliverable is about to emit (PDF/Word/clipboard). When present these
   * must resolve into `retainedRecords`, which is what stops an export reintroducing a source
   * the claim filter rejected.
   */
  exportReferences?: string[];
  /** Canonical keys the evidence set allows, when available, for stricter resolution. */
  allowedKeys?: Set<string>;
  citationMap?: Map<string, AuditableRef>;
}

export interface DeliverableIntegrityResult {
  ok: boolean;
  /** Citations naming an author/year with no record behind it. */
  unsupportedCitations: string[];
  /** Citations with no matching entry in the published reference list. */
  orphanCitations: string[];
  /** Published references that nothing in the narrative cites. */
  uncitedReferences: string[];
  /** Published references that resolve to no retained record. */
  unresolvedReferences: string[];
  /** Emitted deliverable references absent from the retained evidence set. */
  extraExportReferences: string[];
  duplicateCitationKeys: string[];
  warnings: EvidenceWarning[];
}

/** Canonical key of a reference *string*, independent of which record happens to match it. */
function referenceKey(ref: string): string {
  const doi = normalizeDoi((String(ref).match(/10\.\d{4,9}\/[^\s"'<>,;)\]]+/i) || [])[0] || "");
  if (doi) return `doi:${doi}`;
  const pmid = (String(ref).match(/\bPMID:?\s*(\d{6,9})\b/i) || [])[1]
    || (/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{6,9})/.exec(String(ref)) || [])[1];
  if (pmid) return `pmid:${pmid}`;
  return `str:${foldName(ref).slice(0, 80)}`;
}

/**
 * Surnames an in-text citation may legitimately use for a record.
 *
 * This mirrors the resolution the evidence pipeline itself performs (`findKeyForCitation` and
 * `checkCitations` both match any surname on the record). The gate deliberately does not tighten
 * it: a gate that resolves citations more strictly than the code it gates will reject output the
 * pipeline considers sound, and it will disagree with the reference list it is meant to verify.
 * Strictness about what may be cited belongs to the claim filter and the reconciliation
 * fixpoint, which are directly tested; this function's job is to confirm the deliverables carry
 * exactly the set those stages approved.
 */
function citingSurnames(rec: AuditableRef): string[] {
  const fromAuthors = String(rec.authors || "")
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(a => foldName(a));
  const fromFormatted = formatReference(rec).split(/[,;]/).map(s => foldName(s)).filter(Boolean);
  return [...new Set([...fromAuthors, ...fromFormatted])].filter(s => s.length > 1);
}

function citationMatchesRecord(author: string, year: string, rec: AuditableRef): boolean {
  if (String(rec.year || "") !== String(year || "")) return false;
  return citingSurnames(rec).includes(foldName(author));
}

/**
 * A reference string is trusted only when a retained record accounts for it, preferring the
 * identifiers a publisher guarantees over author-name resemblance.
 */
function referenceIsBackedBy(ref: string, retained: AuditableRef[]): boolean {
  const target = String(ref);
  const refDoi = referenceKey(target).startsWith("doi:") ? referenceKey(target).slice(4) : "";
  const refPmid = referenceKey(target).startsWith("pmid:") ? referenceKey(target).slice(5) : "";
  const refFolded = foldName(target);
  return retained.some(rec => {
    const recDoi = normalizeDoi(rec.doi);
    if (refDoi && recDoi) return refDoi === recDoi;
    const recPmid = String(rec.pmid || "").trim();
    if (refPmid && recPmid) return refPmid === recPmid;
    // Only fall back to text similarity when neither side carries a usable identifier, so a
    // DOI-bearing reference can never be "backed" by an unrelated record with a similar title.
    if (recDoi || recPmid) return false;
    const canonical = foldName(formatReference(rec));
    return (canonical.length > 40 && refFolded.includes(canonical.slice(0, 60)))
      || (Boolean(rec.title) && refFolded.includes(foldName(String(rec.title)).slice(0, 60)));
  });
}

export function validateDeliverableIntegrity(input: DeliverableIntegrityInput): DeliverableIntegrityResult {
  const fields = input.fields || {};
  const narrative = Object.keys(fields).map(n => fields[n] || "").join(" ");
  const references = Array.isArray(input.references) ? input.references : [];
  const retained = Array.isArray(input.retainedRecords) ? input.retainedRecords : [];
  const exportReferences = Array.isArray(input.exportReferences) ? input.exportReferences : [];

  const unsupportedCitations: string[] = [];
  const seenUnsupported = new Set<string>();
  const citedRecordIndexes = new Set<number>();

  for (const c of extractInTextCites(narrative)) {
    const label = `${c.author} ${c.year}`.trim();
    if (!label) continue;
    const matching = retained
      .map((rec, i) => ({ rec, i }))
      .filter(({ rec }) => citationMatchesRecord(c.author, c.year, rec));
    if (matching.length === 0) {
      if (!seenUnsupported.has(label)) {
        seenUnsupported.add(label);
        unsupportedCitations.push(label);
      }
      continue;
    }
    matching.forEach(({ i }) => citedRecordIndexes.add(i));
  }

  // Orphan and uncited detection is delegated to the same checker the pipeline reconciles with,
  // so the gate reports exactly the defects that survived reconciliation rather than a second,
  // divergent opinion about them.
  const checks = checkCitations(narrative, references);
  const orphanCitations = [...checks.orphans];
  // Whether a reference is cited at all is only knowable when the narrative travels with it. A
  // references-only export (the reference-list PDFs, a Word bibliography) legitimately arrives
  // without prose, and treating every reference there as uncited would refuse a correct export.
  const hasNarrative = narrative.trim().length > 0;
  const uncitedReferences = hasNarrative ? [...checks.uncited] : [];

  const unresolvedReferences = references.filter(r => !referenceIsBackedBy(r, retained));
  const extraExportReferences = exportReferences.filter(er => !referenceIsBackedBy(er, retained));

  const seenKeys = new Set<string>();
  const duplicateCitationKeys: string[] = [];
  for (const ref of references) {
    const key = referenceKey(ref);
    if (seenKeys.has(key) && !duplicateCitationKeys.includes(key)) duplicateCitationKeys.push(key);
    seenKeys.add(key);
  }

  const ok =
    unsupportedCitations.length === 0 &&
    orphanCitations.length === 0 &&
    uncitedReferences.length === 0 &&
    unresolvedReferences.length === 0 &&
    extraExportReferences.length === 0 &&
    duplicateCitationKeys.length === 0;

  return {
    ok,
    unsupportedCitations,
    orphanCitations,
    uncitedReferences,
    unresolvedReferences,
    extraExportReferences,
    duplicateCitationKeys,
    warnings: []
  };
}
