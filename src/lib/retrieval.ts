/**
 * Biomedical literature retrieval engine for AIPICO v5.
 *
 * Implements multi-database retrieval with:
 * - Abstract retrieval via PubMed efetch (XML), Europe PMC core, OpenAlex inverted-index, and Semantic Scholar (D-06)
 * - Structured PICO query building and second design-filtered PubMed query (D-05)
 * - Evidence type classification across 15 standard types (D-09)
 * - Fuzzy deduplication with token similarity and author verification (D-14)
 * - Noise control: drops pre-2010 records for AI/ML queries and ungrounded book chapters
 * - Run log provenance tracking for all executed queries
 */

import type { AuditableRef, EvidenceType } from "./relevance.ts";
import { designOf, sigTokens } from "./relevance.ts";
import type { PicoWord } from "./pico-roles.ts";
import {
  buildPicoQuery,
  isAiMlQuery
} from "./concept-map.ts";
import { sanitizePhrase } from "./pubmed-query.ts";

export const API_TIMEOUT_MS = 10_000;
export const EFETCH_TIMEOUT_MS = 6_000;

export interface RunLogEntry {
  source: string;
  query: string;
  hits: number;
  timestamp: string;
}

export interface RunLog {
  queries: RunLogEntry[];
  totalRetrieved: number;
  abstractCoverage: { total: number; withAbstract: number; pct: number };
}

/**
 * Reconstructs an abstract from an OpenAlex abstract_inverted_index object.
 */
export function reconstructInvertedIndex(
  invertedIndex: Record<string, number[]> | undefined | null
): string {
  if (!invertedIndex || typeof invertedIndex !== "object") return "";
  const pairs: Array<{ word: string; pos: number }> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (Array.isArray(positions)) {
      for (const pos of positions) {
        pairs.push({ word, pos });
      }
    }
  }
  if (pairs.length === 0) return "";
  pairs.sort((a, b) => a.pos - b.pos);
  return pairs.map(p => p.word).join(" ");
}

/**
 * Unescapes basic XML entities.
 */
function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses PubMed XML returned by efetch into typed AuditableRef records.
 */
export function parsePubMedXml(xml: string): AuditableRef[] {
  if (!xml || typeof xml !== "string") return [];

  const articles: AuditableRef[] = [];
  const articleBlocks = xml.split(/<PubmedArticle(?:[\s>])/i).slice(1);

  for (const block of articleBlocks) {
    const endIdx = block.indexOf("</PubmedArticle>");
    const articleXml = endIdx !== -1 ? block.slice(0, endIdx) : block;

    // 1. PMID
    const pmidMatch = articleXml.match(/<PMID[^>]*>(\d+)<\/PMID>/i);
    const pmid = pmidMatch ? pmidMatch[1] : "";
    if (!pmid) continue;

    // 2. Title
    const titleMatch = articleXml.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/i);
    let title = titleMatch ? unescapeXml(titleMatch[1].replace(/<[^>]+>/g, "")) : "";
    title = title.replace(/\.$/, "").trim();
    if (!title) continue;

    // 3. Structured Abstract
    let context = "";
    const abstractMatch = articleXml.match(/<Abstract>([\s\S]*?)<\/Abstract>/i);
    if (abstractMatch) {
      const sectionMatches = abstractMatch[1].matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/gi);
      const parts: string[] = [];
      for (const m of sectionMatches) {
        const attr = m[1];
        const body = unescapeXml(m[2].replace(/<[^>]+>/g, ""));
        if (!body) continue;
        const labelMatch = attr.match(/Label="([^"]+)"/i);
        if (labelMatch && labelMatch[1]) {
          parts.push(`${labelMatch[1]}: ${body}`);
        } else {
          parts.push(body);
        }
      }
      context = parts.join(" ");
    }

    // 4. Authors
    const authorsArr: string[] = [];
    const authorMatches = articleXml.matchAll(/<Author[^>]*>([\s\S]*?)<\/Author>/gi);
    for (const am of authorMatches) {
      const aXml = am[1];
      const lastMatch = aXml.match(/<LastName[^>]*>([\s\S]*?)<\/LastName>/i);
      const initialsMatch = aXml.match(/<Initials[^>]*>([\s\S]*?)<\/Initials>/i) ||
        aXml.match(/<ForeName[^>]*>([\s\S]*?)<\/ForeName>/i);
      const collective = aXml.match(/<CollectiveName[^>]*>([\s\S]*?)<\/CollectiveName>/i);

      if (collective && collective[1]) {
        authorsArr.push(unescapeXml(collective[1].replace(/<[^>]+>/g, "")));
      } else if (lastMatch && lastMatch[1]) {
        const last = unescapeXml(lastMatch[1]);
        const init = initialsMatch ? unescapeXml(initialsMatch[1]) : "";
        authorsArr.push(init ? `${last} ${init}` : last);
      }
    }
    const authors = authorsArr.length > 2 ? `${authorsArr[0]} et al.` : authorsArr.join(", ");

    // 5. Journal & Year
    const journalMatch = articleXml.match(/<ISOAbbreviation[^>]*>([\s\S]*?)<\/ISOAbbreviation>/i) ||
      articleXml.match(/<Title[^>]*>([\s\S]*?)<\/Title>/i);
    const journal = journalMatch ? unescapeXml(journalMatch[1].replace(/<[^>]+>/g, "")) : "";

    const yearMatch = articleXml.match(/<JournalIssue[^>]*>[\s\S]*?<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/i) ||
      articleXml.match(/<PubDate>[\s\S]*?<MedlineDate>.*?(\d{4}).*?<\/MedlineDate>/i) ||
      articleXml.match(/<DateCompleted>[\s\S]*?<Year>(\d{4})<\/Year>/i);
    const year = yearMatch ? yearMatch[1] : "";

    // 6. DOI
    const doiMatch = articleXml.match(/<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/i);
    const doi = doiMatch ? unescapeXml(doiMatch[1].replace(/<[^>]+>/g, "")) : undefined;

    // 7. Publication Types
    const pubTypes: string[] = [];
    const ptMatches = articleXml.matchAll(/<PublicationType[^>]*>([\s\S]*?)<\/PublicationType>/gi);
    for (const ptm of ptMatches) {
      const pt = unescapeXml(ptm[1].replace(/<[^>]+>/g, ""));
      if (pt) pubTypes.push(pt);
    }

    // 8. MeSH Headings
    const mesh: string[] = [];
    const meshMatches = articleXml.matchAll(/<DescriptorName[^>]*>([\s\S]*?)<\/DescriptorName>/gi);
    for (const mm of meshMatches) {
      const heading = unescapeXml(mm[1].replace(/<[^>]+>/g, ""));
      if (heading) mesh.push(heading);
    }

    const abstractAvailable = Boolean(context && context.trim().length > 30);

    const ref: AuditableRef = {
      pmid,
      title,
      authors,
      journal,
      year,
      doi,
      context,
      source: "PubMed",
      abstractAvailable,
      pubTypes,
      mesh,
      evidenceType: classifyEvidenceType({
        pmid,
        doi,
        pubTypes,
        title,
        abstract: context,
        journal,
        source: "PubMed"
      })
    };

    articles.push(ref);
  }

  return articles;
}

export interface ClassifyInput {
  pmid?: string;
  doi?: string;
  pubTypes?: string[];
  pubType?: string;
  crossrefType?: string;
  source?: string;
  title: string;
  abstract?: string;
  journal?: string;
}

/**
 * Classifies the evidence type according to D-09 priority order:
 * 1. PubMed PublicationType
 * 2. Europe PMC pubType
 * 3. Crossref type
 * 4. DOI prefix (10.21203 -> Research Square, 10.1101 -> bioRxiv/medRxiv)
 * 5. ClinicalTrials.gov
 * 6. Title / abstract heuristics (designOf)
 */
export function classifyEvidenceType(input: ClassifyInput): EvidenceType {
  const { pmid, doi, pubTypes = [], pubType = "", crossrefType = "", source = "", title = "", abstract = "", journal = "" } = input;
  const fullText = `${title} ${journal} ${abstract}`.toLowerCase();
  const cleanDoi = (doi || "").toLowerCase().trim();

  // 1. PubMed PublicationType
  if (pubTypes.length > 0) {
    const ptLower = pubTypes.map(t => t.toLowerCase());
    if (ptLower.some(t => t.includes("randomized controlled trial") || t === "controlled clinical trial")) {
      return "rct";
    }
    if (ptLower.some(t => t.includes("meta-analysis"))) {
      return "meta_analysis";
    }
    if (ptLower.some(t => t.includes("systematic review"))) {
      return "systematic_review";
    }
    if (ptLower.some(t => t.includes("guideline") || t.includes("practice guideline"))) {
      return "guideline";
    }
    if (ptLower.some(t => t.includes("editorial") || t.includes("comment") || t.includes("letter"))) {
      return "editorial_commentary";
    }
    if (ptLower.some(t => t.includes("review"))) {
      return "narrative_review";
    }
    if (ptLower.some(t => t.includes("observational study") || t.includes("cohort studies"))) {
      return "cohort";
    }
  }

  // 2. Europe PMC pubType
  if (pubType) {
    const pt = pubType.toLowerCase();
    if (pt.includes("systematic-review") || pt.includes("systematic review")) return "systematic_review";
    if (pt.includes("meta-analysis")) return "meta_analysis";
    if (pt.includes("randomized-controlled-trial") || pt.includes("randomized controlled trial")) return "rct";
    if (pt.includes("preprint")) return "preprint";
    if (pt.includes("review-article") || pt === "review") return "narrative_review";
  }

  // 3. Crossref type
  if (crossrefType) {
    const ct = crossrefType.toLowerCase();
    if (ct === "posted-content") return "preprint";
    if (ct === "book-chapter" || ct === "book-section" || ct === "book") return "book_chapter";
    if (ct === "dissertation") return "thesis";
  }

  // 4. DOI prefix
  if (cleanDoi.includes("10.21203/") || cleanDoi.includes("10.1101/")) {
    return "preprint";
  }

  // 5. ClinicalTrials.gov
  if (
    source.toLowerCase().includes("clinicaltrials") ||
    (pmid && pmid.startsWith("ctg:")) ||
    /NCT\d{8}/i.test(title) ||
    /NCT\d{8}/i.test(journal)
  ) {
    return "trial_registration";
  }

  // 6. Title / Abstract heuristics (designOf and regex)
  if (/book chapter|handbook of|encyclopedia/i.test(journal) || /chapter \d+/i.test(title)) {
    return "book_chapter";
  }
  if (/thesis|dissertation/i.test(journal) || /master's thesis|doctoral dissertation/i.test(title)) {
    return "thesis";
  }
  if (/biorxiv|medrxiv|research square|preprints\.org/i.test(journal)) {
    return "preprint";
  }

  const d = designOf(title, journal);
  if (d === "systematic review / meta-analysis") {
    if (/meta-analys/i.test(fullText)) return "meta_analysis";
    return "systematic_review";
  }
  if (d === "randomized controlled trial") {
    return "rct";
  }

  if (/\bcohort\b|\bprospective (?:cohort|study)\b|\bretrospective (?:cohort|study)\b/i.test(fullText)) {
    return "cohort";
  }
  if (/\bcase-control\b|\bcase control\b/i.test(fullText)) {
    return "case_control";
  }
  if (/\bcross-sectional\b|\bcross sectional\b/i.test(fullText)) {
    return "cross_sectional";
  }
  if (/\bcase report\b|\bcase series\b/i.test(fullText)) {
    return "case_series";
  }
  if (/\bguideline\b|\bconsensus statement\b|\bclinical guidance\b/i.test(fullText)) {
    return "guideline";
  }
  if (/\bcommentary\b|\beditorial\b|\bopinion\b|\bletter to the editor\b/i.test(fullText)) {
    return "editorial_commentary";
  }
  if (/\bnarrative review\b|\bliterature review\b|\bmini-review\b|\bstate-of-the-art review\b/i.test(fullText)) {
    return "narrative_review";
  }

  return "unclassified";
}

/**
 * Normalises a title string for token comparison.
 */
export function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Calculates Token Dice similarity between two titles: 2 * |A ∩ B| / (|A| + |B|).
 */
export function titleSimilarity(t1: string, t2: string): number {
  const words1 = normalizeTitle(t1).split(" ").filter(w => w.length > 2);
  const words2 = normalizeTitle(t2).split(" ").filter(w => w.length > 2);
  if (words1.length === 0 || words2.length === 0) return 0;
  const s1 = new Set(words1);
  const s2 = new Set(words2);
  let intersection = 0;
  for (const tok of s1) {
    if (s2.has(tok)) intersection++;
  }
  return (2 * intersection) / (s1.size + s2.size);
}

/**
 * Extracts author surnames for deduplication matching.
 */
export function extractSurnames(authors?: string): Set<string> {
  if (!authors) return new Set();
  const clean = authors
    .replace(/\bet al\.?\b/gi, "")
    .replace(/[^\w\s,]/g, "")
    .toLowerCase();
  const parts = clean.split(/[,;\s]+/).filter(w => w.length > 2 && !/^(and|the|of|for|in|jr|sr|iii|ii)$/i.test(w));
  return new Set(parts);
}

/**
 * Checks whether two reference records share at least one author surname.
 */
export function hasSharedAuthor(a1?: string, a2?: string): boolean {
  const s1 = extractSurnames(a1);
  const s2 = extractSurnames(a2);
  if (s1.size === 0 || s2.size === 0) return true; // Do not block dedup if one record has missing authors
  for (const surname of s1) {
    if (s2.has(surname)) return true;
  }
  return false;
}

/**
 * Deduplicates retrieved records using exact ID matching (PMID, DOI)
 * and fuzzy title similarity (Dice >= 0.85) + shared author verification (D-14).
 * Prefers peer-reviewed journal articles with PMID over preprints, preserving the preprint DOI in relatedIds.
 */
export function dedupeRefs(refs: AuditableRef[]): AuditableRef[] {
  const out: AuditableRef[] = [];

  for (const candidate of refs) {
    const candPmid = candidate.pmid ? candidate.pmid.trim() : "";
    const candDoi = candidate.doi ? candidate.doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, "").trim() : "";
    const candTitle = candidate.title ? candidate.title.trim() : "";

    let matchIdx = -1;

    for (let i = 0; i < out.length; i++) {
      const existing = out[i];
      const exPmid = existing.pmid ? existing.pmid.trim() : "";
      const exDoi = existing.doi ? existing.doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, "").trim() : "";

      // 1. Exact PMID match
      if (candPmid && exPmid && candPmid === exPmid) {
        matchIdx = i;
        break;
      }

      // 2. Exact DOI match
      if (candDoi && exDoi && candDoi === exDoi) {
        matchIdx = i;
        break;
      }

      // 3. Fuzzy title match (>=0.85) AND shared author surname (D-14)
      if (candTitle && existing.title) {
        const sim = titleSimilarity(candTitle, existing.title);
        if (sim >= 0.85 && hasSharedAuthor(candidate.authors, existing.authors)) {
          matchIdx = i;
          break;
        }
      }
    }

    if (matchIdx === -1) {
      out.push({ ...candidate, relatedIds: candidate.relatedIds ? [...candidate.relatedIds] : [] });
    } else {
      const existing = out[matchIdx];
      const existingIsPreprint = existing.evidenceType === "preprint" || existing.source === "Preprint";
      const candidateIsPreprint = candidate.evidenceType === "preprint" || candidate.source === "Preprint";

      // If existing is preprint and candidate is journal/PMID, upgrade existing to candidate
      if (existingIsPreprint && !candidateIsPreprint) {
        const related = new Set<string>(candidate.relatedIds || []);
        if (existing.doi) related.add(existing.doi);
        if (existing.pmid) related.add(`pmid:${existing.pmid}`);
        out[matchIdx] = {
          ...candidate,
          relatedIds: Array.from(related),
          context: candidate.context || existing.context,
          abstractAvailable: candidate.abstractAvailable || existing.abstractAvailable
        };
      } else {
        // Keep existing, merge relatedIds and context if missing
        const related = new Set<string>(existing.relatedIds || []);
        if (candDoi) related.add(candDoi);
        if (candPmid) related.add(`pmid:${candPmid}`);
        existing.relatedIds = Array.from(related);
        if (!existing.context && candidate.context) {
          existing.context = candidate.context;
          existing.abstractAvailable = candidate.abstractAvailable;
        }
        if (!existing.doi && candidate.doi) {
          existing.doi = candidate.doi;
        }
      }
    }
  }

  return out;
}

/**
 * Noise control filter (D-05 / D-09 / PROMPT 02):
 * 1. For queries whose intervention concept contains AI/ML terms, drop records published before 2010
 *    unless they are systematic reviews of the comparator.
 * 2. Drop book chapters whose title shares no I-concept term with the query.
 */
export function applyNoiseFilters(records: AuditableRef[], words: PicoWord[]): AuditableRef[] {
  const iWords = words.filter(w => w.role === "intervention").map(w => w.word);
  const cWords = words.filter(w => w.role === "comparator").map(w => w.word);
  const isAiQuery = isAiMlQuery(iWords.length > 0 ? iWords : words.map(w => w.word));

  const iTokens = sigTokens(iWords.join(" "));
  const cTokens = sigTokens(cWords.join(" "));

  return records.filter(r => {
    const yearNum = parseInt(r.year || "0", 10);
    const titleLower = r.title.toLowerCase();

    // Noise filter 1: AI/ML pre-2010 drop
    if (isAiQuery && yearNum > 0 && yearNum < 2010) {
      const isSrMa = r.evidenceType === "systematic_review" || r.evidenceType === "meta_analysis";
      const matchesComparator = cTokens.length > 0 && cTokens.some(t => titleLower.includes(t.toLowerCase()));
      if (!(isSrMa && matchesComparator)) {
        return false;
      }
    }

    // Noise filter 2: Book chapters without I-concept terms
    if (r.evidenceType === "book_chapter" || r.rawType === "book-chapter" || r.rawType === "book_chapter") {
      const hasIConcept = iTokens.length > 0 && iTokens.some(t => titleLower.includes(t.toLowerCase()));
      if (!hasIConcept) {
        return false;
      }
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// Network Fetchers (PubMed, Europe PMC, OpenAlex, Semantic Scholar, etc.)
// ---------------------------------------------------------------------------

export async function fetchPubMedReferences(
  query: string,
  maxResults = 25,
  runLog?: RunLogEntry[]
): Promise<AuditableRef[]> {
  const startTime = Date.now();
  try {
    const ncbiEmail = process.env.NCBI_EMAIL || "aipico@drraouf.com";
    const apiKeyParam = process.env.NCBI_API_KEY ? `&api_key=${encodeURIComponent(process.env.NCBI_API_KEY)}` : "";
    const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=${maxResults}&sort=relevance&tool=aipico&email=${encodeURIComponent(ncbiEmail)}${apiKeyParam}`;

    const searchRes = await fetch(esearchUrl, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!searchRes.ok) return [];

    const searchData = await searchRes.json();
    const idList: string[] = searchData?.esearchresult?.idlist || [];
    if (!idList.length) {
      if (runLog) {
        runLog.push({ source: "PubMed", query, hits: 0, timestamp: new Date().toISOString() });
      }
      return [];
    }

    // efetch batched <= 200
    const batch = idList.slice(0, 200);
    const efetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=${batch.join(",")}&tool=aipico&email=${encodeURIComponent(ncbiEmail)}${apiKeyParam}`;

    const fetchRes = await fetch(efetchUrl, {
      signal: AbortSignal.timeout(EFETCH_TIMEOUT_MS)
    });
    if (!fetchRes.ok) return [];

    const xmlText = await fetchRes.text();
    const parsed = parsePubMedXml(xmlText);

    if (runLog) {
      runLog.push({ source: "PubMed", query, hits: parsed.length, timestamp: new Date().toISOString() });
    }
    return parsed;
  } catch (err) {
    console.warn(`[retrieval] PubMed fetch failed after ${Date.now() - startTime}ms:`, err);
    return [];
  }
}

export async function fetchEuropePMC(
  query: string,
  maxResults = 10,
  runLog?: RunLogEntry[]
): Promise<AuditableRef[]> {
  try {
    const terms = sanitizePhrase(query).split(" ").filter(Boolean).slice(0, 8).map(t => `"${t}"`).join(" AND ");
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(terms)}&format=json&pageSize=${Math.min(maxResults + 4, 25)}&resultType=core`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const list: Array<Record<string, unknown>> = data?.resultList?.result || [];
    const out: AuditableRef[] = [];

    for (const item of list) {
      const title = String(item.title || "").replace(/\.$/, "").trim();
      if (!title || title.length < 15) continue;
      const authors = String(item.authorString || "").replace(/\.$/, "").trim();
      const journal = String(
        item.journalTitle ||
        (item.journalInfo && ((item.journalInfo as Record<string, unknown>).journal as Record<string, unknown>)?.title) ||
        ""
      ).trim();
      const year = String(item.pubYear || "").match(/\b(19\d\d|20\d\d)\b/)?.[1] || "";
      const doi = typeof item.doi === "string" ? item.doi : undefined;
      const pmid = typeof item.pmid === "string" && /^\d+$/.test(item.pmid) ? item.pmid : "";
      const context = typeof item.abstractText === "string" ? unescapeXml(item.abstractText.replace(/<[^>]+>/g, "")) : "";

      const pubTypeList = (item.pubTypeList as Record<string, string[]>)?.pubType || [];
      const pubTypes = Array.isArray(pubTypeList) ? pubTypeList : [String(pubTypeList)];

      out.push({
        pmid,
        title,
        authors: authors.length > 80 ? authors.slice(0, 77) + "..." : authors,
        journal,
        year,
        doi,
        context,
        source: "Europe PMC",
        abstractAvailable: Boolean(context && context.trim().length > 30),
        pubTypes,
        evidenceType: classifyEvidenceType({
          pmid,
          doi,
          pubTypes,
          pubType: pubTypes.join(", "),
          title,
          abstract: context,
          journal,
          source: "Europe PMC"
        })
      });
      if (out.length >= maxResults) break;
    }

    if (runLog) {
      runLog.push({ source: "Europe PMC", query, hits: out.length, timestamp: new Date().toISOString() });
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchOpenAlex(
  query: string,
  maxResults = 10,
  runLog?: RunLogEntry[]
): Promise<AuditableRef[]> {
  try {
    const terms = sanitizePhrase(query).split(" ").filter(Boolean).slice(0, 8).join(" ");
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(terms)}&per-page=${Math.min(maxResults + 4, 25)}&mailto=aipico@drraouf.com`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const results: Array<Record<string, unknown>> = data?.results || [];
    const out: AuditableRef[] = [];

    for (const item of results) {
      const title = String(item.display_name || item.title || "").replace(/\.$/, "").trim();
      if (!title || title.length < 15) continue;
      const year = String(item.publication_year || "");
      const doiRaw = typeof item.doi === "string" ? item.doi : "";
      const doi = doiRaw.replace(/^https?:\/\/doi\.org\//i, "");

      const pmidRaw = (item.ids as Record<string, unknown>)?.pmid;
      const pmid = typeof pmidRaw === "string"
        ? pmidRaw.replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//, "").replace(/\//g, "")
        : "";

      const primaryLoc = item.primary_location as Record<string, unknown> | undefined;
      const sourceObj = primaryLoc?.source as Record<string, unknown> | undefined;
      const journal = String(sourceObj?.display_name || "").trim();

      const authorships = (item.authorships || []) as Array<{ author?: { display_name?: string } }>;
      const authorsArr = authorships.map(a => a.author?.display_name).filter(Boolean);
      const authors = authorsArr.length > 2 ? `${authorsArr[0]} et al.` : authorsArr.join(", ");

      const context = reconstructInvertedIndex(item.abstract_inverted_index as Record<string, number[]>);
      const rawType = typeof item.type === "string" ? item.type : "";

      out.push({
        pmid,
        title,
        authors,
        journal,
        year,
        doi,
        context,
        source: "OpenAlex",
        abstractAvailable: Boolean(context && context.trim().length > 30),
        rawType,
        evidenceType: classifyEvidenceType({
          pmid,
          doi,
          crossrefType: rawType,
          title,
          abstract: context,
          journal,
          source: "OpenAlex"
        })
      });
      if (out.length >= maxResults) break;
    }

    if (runLog) {
      runLog.push({ source: "OpenAlex", query, hits: out.length, timestamp: new Date().toISOString() });
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchSemanticScholar(
  query: string,
  maxResults = 10,
  runLog?: RunLogEntry[]
): Promise<AuditableRef[]> {
  try {
    const terms = sanitizePhrase(query).split(" ").filter(Boolean).slice(0, 8).join(" ");
    const fields = "title,authors,year,journal,externalIds,abstract,publicationTypes";
    const endpoint = ["https://api.semanticscholar.org/graph/v1", "paper", "search"].join("/");
    const url = `${endpoint}?query=${encodeURIComponent(terms)}&fields=${fields}&limit=${Math.min(maxResults + 4, 25)}`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const papers: Array<Record<string, unknown>> = data?.data || [];
    const out: AuditableRef[] = [];

    for (const p of papers) {
      const title = String(p.title || "").replace(/\.$/, "").trim();
      if (!title || title.length < 15) continue;
      const year = p.year ? String(p.year) : "";
      const externalIds = (p.externalIds || {}) as Record<string, unknown>;
      const doi = typeof externalIds.DOI === "string" ? externalIds.DOI : undefined;
      const pmid = typeof externalIds.PubMed === "string" ? externalIds.PubMed : "";

      const journalObj = p.journal as Record<string, unknown> | undefined;
      const journal = String(journalObj?.name || "").trim();

      const authorsArr = Array.isArray(p.authors)
        ? p.authors.map((a: { name?: string }) => a.name).filter(Boolean)
        : [];
      const authors = authorsArr.length > 2 ? `${authorsArr[0]} et al.` : authorsArr.join(", ");
      const context = typeof p.abstract === "string" ? p.abstract.trim() : "";
      const pubTypes = Array.isArray(p.publicationTypes) ? (p.publicationTypes as string[]) : [];

      out.push({
        pmid,
        title,
        authors,
        journal,
        year,
        doi,
        context,
        source: "Semantic Scholar",
        abstractAvailable: Boolean(context && context.trim().length > 30),
        pubTypes,
        evidenceType: classifyEvidenceType({
          pmid,
          doi,
          pubTypes,
          title,
          abstract: context,
          journal,
          source: "Semantic Scholar"
        })
      });
      if (out.length >= maxResults) break;
    }

    if (runLog) {
      runLog.push({ source: "Semantic Scholar", query, hits: out.length, timestamp: new Date().toISOString() });
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchCochraneCentral(
  query: string,
  maxResults = 8,
  runLog?: RunLogEntry[]
): Promise<AuditableRef[]> {
  try {
    const terms = sanitizePhrase(query).split(" ").filter(Boolean).slice(0, 6).map(t => `"${t}"`).join(" AND ");
    const cochraneQuery = `(${terms}) AND (SRC:"Cochrane Central Register of Controlled Trials" OR SRC:"CENTRAL")`;
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(cochraneQuery)}&format=json&pageSize=${Math.min(maxResults + 4, 15)}&resultType=core`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const list: Array<Record<string, unknown>> = data?.resultList?.result || [];
    const out: AuditableRef[] = [];

    for (const item of list) {
      const title = String(item.title || "").replace(/\.$/, "").trim();
      if (!title || title.length < 15) continue;
      const authors = String(item.authorString || "").replace(/\.$/, "").trim();
      const year = String(item.pubYear || "").match(/\b(19\d\d|20\d\d)\b/)?.[1] || "";
      const doi = typeof item.doi === "string" ? item.doi : undefined;
      const pmid = typeof item.pmid === "string" && /^\d+$/.test(item.pmid) ? item.pmid : "";
      const context = typeof item.abstractText === "string" ? unescapeXml(item.abstractText.replace(/<[^>]+>/g, "")) : "";

      out.push({
        pmid,
        title,
        authors: authors.length > 80 ? authors.slice(0, 77) + "..." : authors,
        journal: "Cochrane CENTRAL",
        year,
        doi,
        context,
        source: "Cochrane CENTRAL",
        abstractAvailable: Boolean(context && context.trim().length > 30),
        evidenceType: "rct"
      });
      if (out.length >= maxResults) break;
    }

    if (runLog) {
      runLog.push({ source: "Cochrane CENTRAL", query, hits: out.length, timestamp: new Date().toISOString() });
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchClinicalTrials(
  query: string,
  maxResults = 6,
  runLog?: RunLogEntry[]
): Promise<AuditableRef[]> {
  try {
    const terms = sanitizePhrase(query).split(" ").filter(Boolean).slice(0, 6).join(" ");
    const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(terms)}&pageSize=${Math.min(maxResults + 2, 12)}&format=json`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const studies: Array<Record<string, unknown>> = data?.studies || [];
    const out: AuditableRef[] = [];

    for (const study of studies) {
      const protocol = study.protocolSection as Record<string, unknown> | undefined;
      const idModule = protocol?.identificationModule as Record<string, unknown> | undefined;
      const nctId = String(idModule?.nctId || "");
      const briefTitle = String(idModule?.briefTitle || "").trim();
      if (!nctId || !briefTitle) continue;

      const statusModule = protocol?.statusModule as Record<string, unknown> | undefined;
      const startDate = String((statusModule?.startDateStruct as Record<string, unknown>)?.date || "");
      const year = startDate.match(/\b(20\d\d|19\d\d)\b/)?.[1] || "";

      const sponsorModule = protocol?.sponsorCollaboratorsModule as Record<string, unknown> | undefined;
      const leadSponsor = sponsorModule?.leadSponsor as Record<string, unknown> | undefined;
      const sponsor = String(leadSponsor?.name || "").trim();

      const descModule = protocol?.descriptionModule as Record<string, unknown> | undefined;
      const context = String(descModule?.briefSummary || "").trim();

      out.push({
        pmid: `ctg:${nctId}`,
        title: briefTitle,
        authors: sponsor,
        journal: `ClinicalTrials.gov ${nctId}`,
        year,
        context,
        source: "ClinicalTrials.gov",
        abstractAvailable: Boolean(context && context.length > 30),
        evidenceType: "trial_registration"
      });
      if (out.length >= maxResults) break;
    }

    if (runLog) {
      runLog.push({ source: "ClinicalTrials.gov", query, hits: out.length, timestamp: new Date().toISOString() });
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchPreprints(
  query: string,
  maxResults = 6,
  runLog?: RunLogEntry[]
): Promise<AuditableRef[]> {
  try {
    const terms = sanitizePhrase(query).split(" ").filter(Boolean).slice(0, 6).join(" ");
    const preprintQuery = `(${terms}) AND (SRC:"medrxiv" OR SRC:"biorxiv" OR PUBLISHER:"Cold Spring Harbor Laboratory")`;
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(preprintQuery)}&format=json&pageSize=${Math.min(maxResults + 4, 15)}&resultType=core`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const list: Array<Record<string, unknown>> = data?.resultList?.result || [];
    const out: AuditableRef[] = [];

    for (const item of list) {
      const title = String(item.title || "").replace(/\.$/, "").trim();
      if (!title || title.length < 15) continue;
      const authors = String(item.authorString || "").replace(/\.$/, "").trim();
      const year = String(item.pubYear || "").match(/\b(20\d\d|19\d\d)\b/)?.[1] || "";
      const doi = typeof item.doi === "string" ? item.doi : undefined;
      const pmid = typeof item.pmid === "string" && /^\d+$/.test(item.pmid) ? item.pmid : "";

      const bookOrJournal = String(item.bookTitle || item.journalTitle || "").toLowerCase();
      const journal = bookOrJournal.includes("biorxiv")
        ? "bioRxiv"
        : bookOrJournal.includes("medrxiv")
        ? "medRxiv"
        : "Preprint";

      const context = typeof item.abstractText === "string" ? unescapeXml(item.abstractText.replace(/<[^>]+>/g, "")) : "";

      out.push({
        pmid,
        title,
        authors: authors.length > 80 ? authors.slice(0, 77) + "..." : authors,
        journal,
        year,
        doi,
        context,
        source: "Preprint",
        abstractAvailable: Boolean(context && context.trim().length > 30),
        evidenceType: "preprint"
      });
      if (out.length >= maxResults) break;
    }

    if (runLog) {
      runLog.push({ source: "Preprint", query, hits: out.length, timestamp: new Date().toISOString() });
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchCrossref(
  query: string,
  maxResults = 10,
  runLog?: RunLogEntry[]
): Promise<AuditableRef[]> {
  try {
    const terms = sanitizePhrase(query).split(" ").filter(Boolean).slice(0, 8).join(" ");
    const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(terms)}&rows=${Math.min(maxResults + 4, 25)}&mailto=aipico@drraouf.com`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const items: Array<Record<string, unknown>> = data?.message?.items || [];
    const out: AuditableRef[] = [];

    for (const item of items) {
      const titleArr = item.title as string[] | undefined;
      const title = (titleArr?.[0] || "").replace(/\.$/, "").trim();
      if (!title || title.length < 15) continue;

      const doi = typeof item.DOI === "string" ? item.DOI : undefined;
      const containerArr = item["container-title"] as string[] | undefined;
      const journal = containerArr?.[0] || "";

      const issued = item.issued as Record<string, unknown> | undefined;
      const dateParts = issued?.["date-parts"] as number[][] | undefined;
      const year = dateParts?.[0]?.[0] ? String(dateParts[0][0]) : "";

      const authorsArr = Array.isArray(item.author)
        ? (item.author as Array<{ family?: string; given?: string }>).map(a => `${a.family || ""} ${a.given || ""}`.trim()).filter(Boolean)
        : [];
      const authors = authorsArr.length > 2 ? `${authorsArr[0]} et al.` : authorsArr.join(", ");

      const rawAbstract = typeof item.abstract === "string" ? item.abstract : "";
      const context = rawAbstract ? unescapeXml(rawAbstract.replace(/<[^>]+>/g, "")) : "";
      const rawType = typeof item.type === "string" ? item.type : "";

      out.push({
        pmid: "",
        title,
        authors,
        journal,
        year,
        doi,
        context,
        source: "Crossref",
        abstractAvailable: Boolean(context && context.trim().length > 30),
        rawType,
        evidenceType: classifyEvidenceType({
          doi,
          crossrefType: rawType,
          title,
          abstract: context,
          journal,
          source: "Crossref"
        })
      });
      if (out.length >= maxResults) break;
    }

    if (runLog) {
      runLog.push({ source: "Crossref", query, hits: out.length, timestamp: new Date().toISOString() });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Executes a multi-database retrieval run for Step 2 and Step 3.
 * Queries PubMed (standard + design filter), Europe PMC, OpenAlex, Semantic Scholar,
 * Cochrane CENTRAL, ClinicalTrials, Preprints, and Crossref.
 */
export async function retrieveLiterature(
  words: PicoWord[],
  options: {
    maxRecords?: number;
    includeOutcomeInQuery?: boolean;
    includeComparatorInQuery?: boolean;
    runLog?: RunLogEntry[];
  } = {}
): Promise<{ records: AuditableRef[]; runLog: RunLog }> {
  const runLogList: RunLogEntry[] = options.runLog || [];

  // 1. Build structured PICO query and second high-evidence design query (D-05)
  const basePubMedQuery = buildPicoQuery(words, {
    includeComparator: options.includeComparatorInQuery,
    includeOutcome: options.includeOutcomeInQuery,
    designFilter: false,
    humanFilter: true
  });

  const designFilterQuery = buildPicoQuery(words, {
    includeComparator: options.includeComparatorInQuery,
    includeOutcome: options.includeOutcomeInQuery,
    designFilter: true,
    humanFilter: true
  });

  const broadTerms = words
    .filter(w => options.includeOutcomeInQuery || w.role !== "outcome")
    .map(w => `"${sanitizePhrase(w.word)}"`)
    .join(" AND ");

  // 2. Multi-source parallel retrieval
  const [
    pmStandard,
    pmDesign,
    cochrane,
    trials,
    semantic,
    preprints,
    epmc,
    openalex,
    crossref
  ] = await Promise.all([
    fetchPubMedReferences(basePubMedQuery, 25, runLogList).catch(() => []),
    fetchPubMedReferences(designFilterQuery, 15, runLogList).catch(() => []),
    fetchCochraneCentral(broadTerms, 8, runLogList).catch(() => []),
    fetchClinicalTrials(broadTerms, 6, runLogList).catch(() => []),
    fetchSemanticScholar(broadTerms, 10, runLogList).catch(() => []),
    fetchPreprints(broadTerms, 6, runLogList).catch(() => []),
    fetchEuropePMC(broadTerms, 12, runLogList).catch(() => []),
    fetchOpenAlex(broadTerms, 12, runLogList).catch(() => []),
    fetchCrossref(broadTerms, 12, runLogList).catch(() => [])
  ]);

  const rawCorpus: AuditableRef[] = [
    ...pmStandard,
    ...pmDesign,
    ...cochrane,
    ...trials,
    ...semantic,
    ...preprints,
    ...epmc,
    ...openalex,
    ...crossref
  ];

  // 3. Deduplicate
  const deduped = dedupeRefs(rawCorpus);

  // 4. Apply Noise Filters (D-05 / D-09)
  const cleaned = applyNoiseFilters(deduped, words);

  // 5. Compute Abstract Coverage
  const withAbstract = cleaned.filter(r => r.abstractAvailable).length;
  const total = cleaned.length;
  const pct = total > 0 ? Math.round((withAbstract / total) * 100) : 0;

  const runLog: RunLog = {
    queries: runLogList,
    totalRetrieved: total,
    abstractCoverage: { total, withAbstract, pct }
  };

  return { records: cleaned, runLog };
}

/**
 * Screening query ladder for Step 2.
 * Executes structured concept queries with progressive relaxation if yield is low.
 */
export async function screenQueryLadder(
  words: PicoWord[],
  deadlineMs = 25_000
): Promise<{ corpus: AuditableRef[]; totalRetrieved: number; relaxationLevel: 0 | 1 | 2; runLog: RunLog }> {
  const startTime = Date.now();
  let relaxationLevel: 0 | 1 | 2 = 0;
  const runLogList: RunLogEntry[] = [];

  // L0: Standard concept blocks
  const { records: l0Records } = await retrieveLiterature(words, {
    maxRecords: 30,
    includeOutcomeInQuery: false,
    includeComparatorInQuery: true,
    runLog: runLogList
  });
  let deduped = dedupeRefs(l0Records);

  // L1: If < 12 records, drop outcome-role words if any were present
  if (deduped.length < 12 && Date.now() - startTime < deadlineMs) {
    const l1Words = words.filter(w => w.role !== "outcome");
    if (l1Words.length > 0 && l1Words.length < words.length) {
      relaxationLevel = 1;
      const { records: l1Records } = await retrieveLiterature(l1Words, {
        maxRecords: 20,
        includeOutcomeInQuery: false,
        includeComparatorInQuery: true,
        runLog: runLogList
      });
      deduped = dedupeRefs([...deduped, ...l1Records]);
    }
  }

  // L2: If still < 8 records, drop comparator-role words (keep P + I)
  if (deduped.length < 8 && Date.now() - startTime < deadlineMs) {
    const l2Words = words.filter(w => w.role === "population" || w.role === "intervention");
    if (l2Words.length > 0 && l2Words.length < words.length) {
      relaxationLevel = 2;
      const { records: l2Records } = await retrieveLiterature(l2Words, {
        maxRecords: 20,
        includeOutcomeInQuery: false,
        includeComparatorInQuery: false,
        runLog: runLogList
      });
      deduped = dedupeRefs([...deduped, ...l2Records]);
    }
  }

  const cleaned = applyNoiseFilters(deduped, words);
  const totalRetrieved = cleaned.length;
  const corpus = cleaned.slice(0, 30);

  const withAbstract = corpus.filter(r => r.abstractAvailable).length;
  const pct = corpus.length > 0 ? Math.round((withAbstract / corpus.length) * 100) : 0;

  const runLog: RunLog = {
    queries: runLogList,
    totalRetrieved,
    abstractCoverage: { total: corpus.length, withAbstract, pct }
  };

  return { corpus, totalRetrieved, relaxationLevel, runLog };
}
