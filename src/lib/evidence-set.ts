/**
 * Canonical evidence set for filtered references.
 *
 * This module enforces a single source of truth for which records are allowed
 * to be cited. All downstream components (commentary generation, audits,
 * exports, UI) must use the set produced here. The canonical key is stable
 * and prefers PMID, then DOI, then identifiers from known sources, and finally
 * a deterministic fingerprint of title + first author + year.
 */

import type { AuditableRef } from "./relevance.ts";
import { formatReference, foldName, surnamesOf } from "./relevance.ts";

export interface EvidenceExclusion {
  ref: AuditableRef;
  reason: string;
}

export interface EvidenceWarning {
  type: "duplicate";
  key: string;
  kept: AuditableRef;
  dropped: AuditableRef;
}

export interface EvidenceRecord extends AuditableRef {
  canonicalKey: string;
  formatted: string;
}

export interface EvidenceSet {
  retainedRecords: EvidenceRecord[];
  excludedRecords: EvidenceExclusion[];
  allowedCitationKeys: Set<string>;
  citationMap: Map<string, EvidenceRecord>;
  warnings: EvidenceWarning[];
  retrievedCount: number;
  retainedCount: number;
  excludedCount: number;
}

function firstAuthorName(authors: string): string {
  if (!authors) return "";
  const parts = authors.split(/[,;]+/);
  const first = parts[0]?.trim() || "";
  if (!first) return "";
  const surnames = surnamesOf(first);
  if (surnames.length > 0) return foldName(surnames[0]);
  return foldName(first.replace(/\s+.*/, ""));
}

/**
 * Canonical DOI form.
 *
 * The same DOI reaches this app as a bare string, as a `doi:` prefix and as a resolver URL, and
 * citation strings often carry a trailing period or bracket. Keys are compared across providers,
 * so all of those forms have to collapse to one value or the same paper is retained twice.
 */
export function normalizeDoi(raw: unknown): string {
  let doi = String(raw ?? "").trim();
  if (!doi) return "";
  doi = doi.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "").replace(/^info:doi\//i, "");
  doi = doi.replace(/^doi:\s*/i, "");
  doi = doi.replace(/[\s.,;:)\]}]+$/, "");
  return doi.toLowerCase();
}

export function normalizeCitationKey(rec: AuditableRef): string {
  // DOI first: it is the only identifier two providers are guaranteed to agree on, so a record
  // carrying both a PMID and a DOI has to key on the DOI or PubMed and Crossref copies of one
  // paper are retained as two unrelated records.
  const doi = normalizeDoi(rec.doi);
  if (doi) return `doi:${doi}`;
  const pmid = String(rec.pmid || "").trim();
  if (pmid && /^\d+$/.test(pmid)) return `pmid:${pmid}`;
  const url = String(rec.url || "").trim();
  if (url) {
    try {
      const u = new URL(url);
      if (u.hostname === "openalex.org") {
        const id = u.pathname.split("/").filter(Boolean).pop() || "";
        if (id.startsWith("W")) return `openalex:${id.toUpperCase()}`;
        return `openalex:${id}`;
      }
      if (u.hostname.includes("crossref.org")) {
        const id = u.pathname.split("/").filter(Boolean).pop() || "";
        const clean = id.replace(/^cr:/i, "");
        return `crossref:${clean}`;
      }
    } catch {
      // ignore
    }
  }
  const oa = String((rec as unknown as Record<string, unknown>).openalexId || (rec as unknown as Record<string, unknown>).openAlexId || "").trim();
  if (oa) return `openalex:${oa.replace(/^https?:.*\//, "").toUpperCase()}`;
  const crRaw = String((rec as unknown as Record<string, unknown>).crossrefId || (rec as unknown as Record<string, unknown>).crossref || "").trim();
  if (crRaw) {
    const clean = crRaw.replace(/^cr:/i, "");
    return `crossref:${clean}`;
  }
  const title = foldName(String(rec.title || ""));
  const year = String(rec.year || "").trim();
  const fa = firstAuthorName(String(rec.authors || ""));
  const base = [title.replace(/\s+/g, " "), fa, year].filter(Boolean).join("|");
  // Deterministic short hash of base as fallback key
  // Note: sync fallback uses numeric hash above; this is a pure function value
  let h = 0;
  for (let i = 0; i < base.length; i++) {
    const chr = base.charCodeAt(i);
    h = (h << 5) - h + chr;
    h |= 0;
  }
  const hex = h.toString(16);
  return `fp:${hex}:${base.slice(0, 40)}`;
}

export async function buildEvidenceSet(
  records: AuditableRef[]
): Promise<EvidenceSet> {
  const retainedRecords: EvidenceRecord[] = [];
  const excludedRecords: EvidenceExclusion[] = [];
  const allowedCitationKeys = new Set<string>();
  const citationMap = new Map<string, EvidenceRecord>();
  const warnings: EvidenceWarning[] = [];
  const seen = new Map<string, EvidenceRecord>();

  for (const rec of records || []) {
    const key = normalizeCitationKey(rec);
    const doi = String(rec.doi || "").trim().toLowerCase();
    if (doi) {
      const doiKey = `doi:${doi}`;
      if (seen.has(doiKey)) {
        const keptRec = seen.get(doiKey)!;
        warnings.push({ type: "duplicate", key: doiKey, kept: keptRec, dropped: rec as EvidenceRecord });
        continue;
      }
      if (seen.has(key)) {
        const keptRec = seen.get(key)!;
        warnings.push({ type: "duplicate", key, kept: keptRec, dropped: rec as EvidenceRecord });
        continue;
      }
      const formatted = formatReference(rec);
      const ev: EvidenceRecord = { ...rec, canonicalKey: doiKey, formatted };
      seen.set(doiKey, ev);
      seen.set(key, ev); // also index by original key
      retainedRecords.push(ev);
      allowedCitationKeys.add(doiKey);
      citationMap.set(doiKey, ev);
      continue;
    }
    if (seen.has(key)) {
      const keptRec = seen.get(key)!;
      warnings.push({ type: "duplicate", key, kept: keptRec, dropped: rec as EvidenceRecord });
      continue;
    }
    const formatted = formatReference(rec);
    const ev: EvidenceRecord = { ...rec, canonicalKey: key, formatted };
    seen.set(key, ev);
    retainedRecords.push(ev);
    allowedCitationKeys.add(key);
    citationMap.set(key, ev);
  }

  return {
    retainedRecords,
    excludedRecords,
    allowedCitationKeys,
    citationMap,
    warnings,
    retrievedCount: records?.length || 0,
    retainedCount: retainedRecords.length,
    excludedCount: excludedRecords.length
  };
}

