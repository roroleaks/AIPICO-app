import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { designOf, type AuditableRef } from "@/lib/relevance";
import { sanitizePhrase, HUMAN_SUBJECT_FILTER } from "@/lib/pubmed-query";
import { generateDeterministicScreen, type ScreenPayload } from "@/lib/deterministic-screen";
import { scoreRecords, parsePhraseElements, type ExploreRecord } from "@/lib/explore-scoring";
import { composeManuscript, validateEnrichedManuscript } from "@/lib/manuscript-composer";
import type { CitationStyle } from "@/lib/citation-formatter";
import type { PicoWord } from "@/lib/pico-roles";
import { isAllowedOrigin, corsHeaders } from "@/lib/security-headers";
import { checkRateLimit } from "@/lib/rate-limiter";

export const maxDuration = 60;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const KEY = GEMINI_API_KEY || GROQ_API_KEY || OPENROUTER_API_KEY || OPENAI_API_KEY;

function hasAnyLlmKey(): boolean {
  return !!KEY;
}

// Bounded timeouts so dependencies degrade gracefully within request budget
const LLM_TIMEOUT_MS = 6_000;
const API_TIMEOUT_MS = 3_500;

class LlmFatal extends Error {}
class LlmTransient extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "LlmTransient";
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 1_500;
  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return Math.min(Math.max(seconds * 1_000, 500), 5_000);
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return Math.min(Math.max(delta, 500), 5_000);
  }
  return 1_500;
}

function classifyHttp(status: number, retryHeader: string | null): Error {
  if (status === 429) {
    return new LlmTransient("Rate limited by LLM provider (HTTP 429)", parseRetryAfter(retryHeader));
  }
  if (status >= 500) {
    return new LlmTransient(`LLM provider transient error (HTTP ${status})`, 1_000);
  }
  return new LlmFatal(`LLM provider fatal client error (HTTP ${status})`);
}

async function callLLM(
  prompt: string,
  userContent: unknown,
  opts: { stage: string; timeoutMs?: number }
): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (GEMINI_API_KEY) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: prompt }] },
          contents: [{ parts: [{ text: JSON.stringify(userContent) }] }],
          generationConfig: {
            temperature: 0.1,
            response_mime_type: "application/json"
          }
        })
      });
      if (!res.ok) {
        throw classifyHttp(res.status, res.headers.get("retry-after"));
      }
      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new LlmFatal("Empty content received from Gemini API");
      return JSON.parse(cleanJsonResponse(rawText));
    }

    if (GROQ_API_KEY) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: JSON.stringify(userContent) }
          ]
        })
      });
      if (!res.ok) {
        throw classifyHttp(res.status, res.headers.get("retry-after"));
      }
      const data = await res.json();
      const rawText = data?.choices?.[0]?.message?.content;
      if (!rawText) throw new LlmFatal("Empty content received from Groq API");
      return JSON.parse(cleanJsonResponse(rawText));
    }

    if (OPENROUTER_API_KEY) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: JSON.stringify(userContent) }
          ]
        })
      });
      if (!res.ok) {
        throw classifyHttp(res.status, res.headers.get("retry-after"));
      }
      const data = await res.json();
      const rawText = data?.choices?.[0]?.message?.content;
      if (!rawText) throw new LlmFatal("Empty content received from OpenRouter API");
      return JSON.parse(cleanJsonResponse(rawText));
    }

    if (OPENAI_API_KEY) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: JSON.stringify(userContent) }
          ]
        })
      });
      if (!res.ok) {
        throw classifyHttp(res.status, res.headers.get("retry-after"));
      }
      const data = await res.json();
      const rawText = data?.choices?.[0]?.message?.content;
      if (!rawText) throw new LlmFatal("Empty content received from OpenAI API");
      return JSON.parse(cleanJsonResponse(rawText));
    }

    throw new LlmFatal("No configured LLM API key found");
  } finally {
    clearTimeout(timer);
  }
}

function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  return cleaned.trim();
}

const EMPTY_REF_SET = new Set<string>();

interface PubMedRef {
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  year: string;
  doi?: string;
  context?: string;
  source?: string;
}

async function fetchPubMedReferences(
  query: string,
  maxResults = 3,
  excluded: Set<string> = EMPTY_REF_SET
): Promise<PubMedRef[]> {
  try {
    const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=${maxResults + excluded.size + 2}&sort=relevance`;
    const searchRes = await fetch(esearchUrl, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!searchRes.ok) return [];

    const searchData = await searchRes.json();
    const idList: string[] = searchData?.esearchresult?.idlist || [];
    const filteredIds = idList.filter(id => !excluded.has(`p:${id}`)).slice(0, maxResults);
    if (!filteredIds.length) return [];

    const esummaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${filteredIds.join(",")}&retmode=json`;
    const summaryRes = await fetch(esummaryUrl, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!summaryRes.ok) return [];

    const summaryData = await summaryRes.json();
    const result = summaryData?.result || {};

    const rawList: (PubMedRef | null)[] = filteredIds.map(id => {
      const item = result[id];
      if (!item || !item.title) return null;

      const articleIds: Array<{ idtype: string; value: string }> = item.articleids || [];
      const doiObj = articleIds.find(a => a.idtype === "doi");

      const authorsArr = Array.isArray(item.authors)
        ? item.authors.map((a: { name?: string }) => a.name).filter(Boolean)
        : [];
      const authors =
        authorsArr.length > 2
          ? `${authorsArr[0]} et al.`
          : authorsArr.join(", ");

      const ref: PubMedRef = {
        pmid: id,
        title: String(item.title).replace(/\.$/, "").trim(),
        authors,
        journal: String(item.source || item.fulljournalname || "").trim(),
        year: String(item.pubdate || "").match(/\b(19\d\d|20\d\d)\b/)?.[1] || "",
        doi: doiObj?.value,
        source: "PubMed"
      };
      return ref;
    });

    return rawList.filter((r): r is PubMedRef => Boolean(r && r.title));
  } catch {
    return [];
  }
}

async function fetchEuropePMC(query: string, maxResults = 4): Promise<PubMedRef[]> {
  try {
    const terms = sanitizeQuery(query).split(" ").filter(Boolean).slice(0, 5).map(t => `"${t}"`).join(" AND ");
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(terms)}&format=json&pageSize=${Math.min(maxResults + 4, 15)}&resultType=lite`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const list: Array<Record<string, unknown>> = data?.resultList?.result || [];
    const out: PubMedRef[] = [];

    for (const item of list) {
      const title = String(item.title || "").replace(/\.$/, "").trim();
      if (!title || title.length < 15) continue;
      const authors = String(item.authorString || "").replace(/\.$/, "").trim();
      const journal = String(item.journalTitle || item.journalInfo && (item.journalInfo as Record<string, unknown>).journal && ((item.journalInfo as Record<string, unknown>).journal as Record<string, unknown>).title || "").trim();
      const year = String(item.pubYear || "").match(/\b(19\d\d|20\d\d)\b/)?.[1] || "";
      const doi = typeof item.doi === "string" ? item.doi : undefined;
      const pmid = typeof item.pmid === "string" && /^\d+$/.test(item.pmid) ? item.pmid : "";

      out.push({
        pmid,
        title,
        authors: authors.length > 80 ? authors.slice(0, 77) + "..." : authors,
        journal,
        year,
        doi,
        source: "Europe PMC"
      });
      if (out.length >= maxResults) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchOpenAlex(query: string, maxResults = 4): Promise<PubMedRef[]> {
  try {
    const terms = sanitizeQuery(query).split(" ").filter(Boolean).slice(0, 8).join(" ");
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(terms)}&per-page=${Math.min(maxResults + 4, 15)}&mailto=aipico@drraouf.com`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const results: Array<Record<string, unknown>> = data?.results || [];
    const out: PubMedRef[] = [];

    for (const item of results) {
      const title = String(item.display_name || item.title || "").replace(/\.$/, "").trim();
      if (!title || title.length < 15) continue;
      const year = String(item.publication_year || "");
      const doiRaw = typeof item.doi === "string" ? item.doi : "";
      const doi = doiRaw.replace(/^https?:\/\/doi\.org\//i, "");

      const pmidRaw = (item.ids as Record<string, unknown>)?.pmid;
      const pmid = typeof pmidRaw === "string" ? pmidRaw.replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//, "").replace(/\//g, "") : "";

      const primaryLoc = item.primary_location as Record<string, unknown> | undefined;
      const sourceObj = primaryLoc?.source as Record<string, unknown> | undefined;
      const journal = String(sourceObj?.display_name || "").trim();

      const authorships = (item.authorships || []) as Array<{ author?: { display_name?: string } }>;
      const authorsArr = authorships.map(a => a.author?.display_name).filter(Boolean);
      const authors = authorsArr.length > 2 ? `${authorsArr[0]} et al.` : authorsArr.join(", ");

      out.push({
        pmid,
        title,
        authors,
        journal,
        year,
        doi,
        source: "OpenAlex"
      });
      if (out.length >= maxResults) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchCochraneCentral(query: string, maxResults = 4): Promise<PubMedRef[]> {
  try {
    const terms = sanitizeQuery(query).split(" ").filter(Boolean).slice(0, 5).map(t => `"${t}"`).join(" AND ");
    const cochraneQuery = `(${terms}) AND (SRC:"Cochrane Central Register of Controlled Trials" OR SRC:"CENTRAL")`;
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(cochraneQuery)}&format=json&pageSize=${Math.min(maxResults + 4, 12)}&resultType=lite`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const list: Array<Record<string, unknown>> = data?.resultList?.result || [];
    const out: PubMedRef[] = [];

    for (const item of list) {
      const title = String(item.title || "").replace(/\.$/, "").trim();
      if (!title || title.length < 15) continue;
      const authors = String(item.authorString || "").replace(/\.$/, "").trim();
      const year = String(item.pubYear || "").match(/\b(19\d\d|20\d\d)\b/)?.[1] || "";
      const doi = typeof item.doi === "string" ? item.doi : undefined;
      const pmid = typeof item.pmid === "string" && /^\d+$/.test(item.pmid) ? item.pmid : "";

      out.push({
        pmid,
        title,
        authors: authors.length > 80 ? authors.slice(0, 77) + "..." : authors,
        journal: "Cochrane CENTRAL",
        year,
        doi,
        source: "Cochrane CENTRAL"
      });
      if (out.length >= maxResults) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchClinicalTrials(query: string, maxResults = 4): Promise<PubMedRef[]> {
  try {
    const terms = sanitizeQuery(query).split(" ").filter(Boolean).slice(0, 6).join(" ");
    const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(terms)}&pageSize=${Math.min(maxResults + 2, 10)}&format=json`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const studies: Array<Record<string, unknown>> = data?.studies || [];
    const out: PubMedRef[] = [];

    for (const study of studies) {
      const protocol = study.protocolSection as Record<string, unknown> | undefined;
      const idModule = protocol?.identificationModule as Record<string, unknown> | undefined;
      const nctId = String(idModule?.nctId || "");
      const briefTitle = String(idModule?.briefTitle || "").trim();
      if (!nctId || !briefTitle) continue;

      const statusModule = protocol?.statusModule as Record<string, unknown> | undefined;
      const startDate = String(statusModule?.startDateStruct && (statusModule.startDateStruct as Record<string, unknown>).date || "");
      const year = startDate.match(/\b(20\d\d|19\d\d)\b/)?.[1] || "";

      const sponsorModule = protocol?.sponsorCollaboratorsModule as Record<string, unknown> | undefined;
      const leadSponsor = sponsorModule?.leadSponsor as Record<string, unknown> | undefined;
      const sponsor = String(leadSponsor?.name || "").trim();

      out.push({
        pmid: "",
        title: briefTitle,
        authors: sponsor,
        journal: `ClinicalTrials.gov ${nctId}`,
        year,
        source: "ClinicalTrials.gov"
      });
      if (out.length >= maxResults) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchSemanticScholar(query: string, maxResults = 4): Promise<PubMedRef[]> {
  try {
    const terms = sanitizeQuery(query).split(" ").filter(Boolean).slice(0, 6).join(" ");
    const fields = "title,authors,year,journal,externalIds,openAccessPdf";
    const endpoint = ["https://api.semanticscholar.org/graph/v1", "paper", "search"].join("/");
    const url = `${endpoint}?query=${encodeURIComponent(terms)}&fields=${fields}&limit=${Math.min(Math.max(maxResults + 4, 8), 20)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const papers: Array<Record<string, unknown>> = data?.data || [];
    const out: PubMedRef[] = [];

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

      out.push({
        pmid,
        title,
        authors,
        journal,
        year,
        doi,
        source: "Semantic Scholar"
      });
      if (out.length >= maxResults) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchPreprints(query: string, maxResults = 4): Promise<PubMedRef[]> {
  try {
    const terms = sanitizeQuery(query).split(" ").filter(Boolean).slice(0, 6).join(" ");
    const preprintQuery = `(${terms}) AND (SRC:"medrxiv" OR SRC:"biorxiv" OR PUBLISHER:"Cold Spring Harbor Laboratory")`;
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(preprintQuery)}&format=json&pageSize=${Math.min(maxResults + 4, 12)}&resultType=lite`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const list: Array<Record<string, unknown>> = data?.resultList?.result || [];
    const out: PubMedRef[] = [];

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
        : "Preprint (medRxiv/bioRxiv)";

      out.push({
        pmid,
        title,
        authors: authors.length > 80 ? authors.slice(0, 77) + "..." : authors,
        journal,
        year,
        doi,
        source: "Preprint"
      });
      if (out.length >= maxResults) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchCrossref(query: string, maxResults = 4): Promise<PubMedRef[]> {
  try {
    const terms = sanitizeQuery(query).split(" ").filter(Boolean).slice(0, 8).join(" ");
    const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(terms)}&rows=${Math.min(maxResults + 4, 15)}&mailto=aipico@drraouf.com`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const items: Array<Record<string, unknown>> = data?.message?.items || [];
    const out: PubMedRef[] = [];

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

      out.push({
        pmid: "",
        title,
        authors,
        journal,
        year,
        doi,
        source: "Crossref"
      });
      if (out.length >= maxResults) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchReferencesBroad(
  query: string,
  maxResults = 8,
  excluded: Set<string> = EMPTY_REF_SET
): Promise<PubMedRef[]> {
  const [pmRefs, cochraneRefs, trialsRefs, ssRefs, preRefs, epmcRefs, alexRefs, crossRefs] = await Promise.all([
    fetchPubMedReferences(query, maxResults, excluded),
    fetchCochraneCentral(query, Math.max(Math.floor(maxResults / 2), 3)),
    fetchClinicalTrials(query, Math.max(Math.floor(maxResults / 2), 3)),
    fetchSemanticScholar(query, Math.max(Math.floor(maxResults / 2), 3)),
    fetchPreprints(query, Math.max(Math.floor(maxResults / 2), 3)),
    fetchEuropePMC(query, maxResults),
    fetchOpenAlex(query, maxResults),
    fetchCrossref(query, maxResults)
  ]);

  return dedupeRefs([
    ...pmRefs,
    ...cochraneRefs,
    ...trialsRefs,
    ...ssRefs,
    ...preRefs,
    ...epmcRefs,
    ...alexRefs,
    ...crossRefs
  ]);
}

function dedupeRefs(refs: PubMedRef[]): PubMedRef[] {
  const seenPmid = new Set<string>();
  const seenDoi = new Set<string>();
  const seenTitle = new Set<string>();
  const out: PubMedRef[] = [];

  for (const r of refs) {
    if (r.pmid && seenPmid.has(r.pmid)) continue;
    const cleanDoi = (r.doi || "").toLowerCase().trim();
    if (cleanDoi && seenDoi.has(cleanDoi)) continue;
    const cleanT = r.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
    if (cleanT && seenTitle.has(cleanT)) continue;

    if (r.pmid) seenPmid.add(r.pmid);
    if (cleanDoi) seenDoi.add(cleanDoi);
    if (cleanT) seenTitle.add(cleanT);
    out.push(r);
  }
  return out;
}

const TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bpoor\s+responder(?:s)?\b/gi, "poor ovarian response"],
  [/\bivf\b/gi, "in vitro fertilization"],
  [/\bicsi\b/gi, "intracytoplasmic sperm injection"],
  [/\bpcos\b/gi, "polycystic ovary syndrome"],
  [/\bohss\b/gi, "ovarian hyperstimulation syndrome"],
  [/\bdor\b/gi, "diminished ovarian reserve"],
  [/\brpl\b/gi, "recurrent pregnancy loss"],
  [/\brif\b/gi, "recurrent implantation failure"],
  [/\bpgt-?a\b/gi, "preimplantation genetic testing"],
  [/\bamh\b/gi, "anti-mullerian hormone"],
  [/\bfsh\b/gi, "follicle stimulating hormone"],
  [/\blh\b/gi, "luteinizing hormone"],
  [/\bgh\b/gi, "growth hormone"],
  [/\bcoq10\b/gi, "coenzyme Q10"],
  [/\bdhea\b/gi, "dehydroepiandrosterone"],
  [/\bprp\b/gi, "platelet-rich plasma"],
  [/\bet\b/gi, "embryo transfer"],
  [/\bfet\b/gi, "frozen embryo transfer"],
  [/\bcpr\b/gi, "clinical pregnancy rate"],
  [/\blbr\b/gi, "live birth rate"]
];

function cleanTerms(s: string): string {
  return TERM_REPLACEMENTS.reduce((acc, [re, repl]) => acc.replace(re, repl), s);
}

function sanitizeQuery(q: string): string {
  const expanded = cleanTerms(q);
  return expanded
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function screenQueryLadder(
  words: PicoWord[],
  deadlineMs = 25_000
): Promise<{ corpus: PubMedRef[]; totalRetrieved: number; relaxationLevel: 0 | 1 | 2 }> {
  const startTime = Date.now();
  let relaxationLevel: 0 | 1 | 2 = 0;
  const allRetrieved: PubMedRef[] = [];

  const runQuery = async (activeWords: PicoWord[]) => {
    const qTerms = activeWords.map(w => `"${sanitizePhrase(w.word)}"`).join(" AND ");
    const qPubMed = `${qTerms} ${HUMAN_SUBJECT_FILTER}`;
    const qBroad = qTerms;

    const [pmRefs, broadRefs] = await Promise.all([
      fetchPubMedReferences(qPubMed, 20).catch(() => []),
      fetchReferencesBroad(qBroad, 10).catch(() => [])
    ]);
    return dedupeRefs([...pmRefs, ...broadRefs]);
  };

  // L0: all words
  const l0Refs = await runQuery(words);
  allRetrieved.push(...l0Refs);
  let deduped = dedupeRefs(allRetrieved);

  // L1: if < 12 records, drop outcome-role words
  if (deduped.length < 12 && Date.now() - startTime < deadlineMs) {
    const l1Words = words.filter(w => w.role !== "outcome");
    if (l1Words.length > 0 && l1Words.length < words.length) {
      relaxationLevel = 1;
      const l1Refs = await runQuery(l1Words);
      allRetrieved.push(...l1Refs);
      deduped = dedupeRefs(allRetrieved);
    }
  }

  // L2: if still < 8 records, drop comparator-role words (keep Population + Intervention words)
  if (deduped.length < 8 && Date.now() - startTime < deadlineMs) {
    const l2Words = words.filter(w => w.role === "population" || w.role === "intervention");
    const pCount = l2Words.filter(w => w.role === "population").length;
    const iCount = l2Words.filter(w => w.role === "intervention").length;
    if (pCount > 0 && iCount > 0 && l2Words.length < words.length) {
      relaxationLevel = 2;
      const l2Refs = await runQuery(l2Words);
      allRetrieved.push(...l2Refs);
      deduped = dedupeRefs(allRetrieved);
    }
  }

  const totalRetrieved = deduped.length;
  const corpus = deduped.slice(0, 30);
  return { corpus, totalRetrieved, relaxationLevel };
}

function validateScreenLlmResponse(data: unknown): {
  established: { phrase: string; basis: string };
  conflicting: { phrase: string; basis: string };
  gap: { phrase: string; basis: string };
} | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const categories: Array<"established" | "conflicting" | "gap"> = ["established", "conflicting", "gap"];
  const out: Partial<Record<"established" | "conflicting" | "gap", { phrase: string; basis: string }>> = {};

  for (const cat of categories) {
    const item = obj[cat] as Record<string, unknown> | undefined;
    if (!item || typeof item !== "object") return null;
    const phrase = typeof item.phrase === "string" ? item.phrase.trim() : "";
    const basis = typeof item.basis === "string" ? item.basis.trim() : "";

    if (!phrase || !basis) return null;
    if (basis.length > 400) return null;
    if (!phrase.includes("(P)") || !phrase.includes("(I)") || !phrase.includes("(C)") || !phrase.includes("(O)")) {
      return null;
    }
    out[cat] = { phrase, basis };
  }

  return {
    established: out.established!,
    conflicting: out.conflicting!,
    gap: out.gap!
  };
}

/** Handle CORS preflight for /api/engine */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  if (isAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin!) });
  }
  return new NextResponse(null, { status: 403 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  const cors = isAllowedOrigin(origin) ? corsHeaders(origin!) : {};

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
  const limit = await checkRateLimit(ip, "engine", 20, 60);
  if (!limit.success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait and try again." },
      {
        status: 429,
        headers: {
          ...cors,
          "Retry-After": String(Math.ceil((limit.reset - Date.now()) / 1000)),
        },
      }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const stageSchema = z.object({
    stage: z.enum(["screen", "explore", "compose"]),
  });

  const baseResult = stageSchema.safeParse(body);
  if (!baseResult.success) {
    return NextResponse.json(
      { error: "Invalid stage parameter: " + baseResult.error.issues.map(e => e.message).join(", ") },
      { status: 400 }
    );
  }
  const stage = baseResult.data.stage;

  if (stage === "screen") {
    const screenZodSchema = z.object({
      stage: z.literal("screen"),
      words: z.array(
        z.object({
          word: z.string().trim().min(1).max(80),
          role: z.enum(["population", "intervention", "comparator", "outcome"])
        })
      ).min(3).max(5)
    });
    const res = screenZodSchema.safeParse(body);
    if (!res.success) {
      return NextResponse.json({ error: "Invalid parameters: " + res.error.issues.map(e => e.message).join(", ") }, { status: 422 });
    }
  } else if (stage === "explore") {
    const exploreZodSchema = z.object({
      stage: z.literal("explore"),
      phrase: z.string().trim().min(1).max(240).refine(
        p => p.includes("(P)") && p.includes("(I)") && p.includes("(C)") && p.includes("(O)"),
        { message: "Phrase must contain (P), (I), (C), and (O) markers" }
      ),
      category: z.enum(["established", "conflicting", "gap"]),
      userExcluded: z.array(z.string()).optional(),
      seen: z.array(z.string()).optional()
    });
    const res = exploreZodSchema.safeParse(body);
    if (!res.success) {
      return NextResponse.json({ error: "Invalid parameters: " + res.error.issues.map(e => e.message).join(", ") }, { status: 422 });
    }
  } else if (stage === "compose") {
    const composeZodSchema = z.object({
      stage: z.literal("compose"),
      words: z.array(
        z.object({
          word: z.string().trim().min(1).max(80),
          role: z.enum(["population", "intervention", "comparator", "outcome"])
        })
      ).min(3).max(5),
      category: z.enum(["established", "conflicting", "gap"]),
      phrase: z.string().trim().min(1).max(240),
      screeningStats: z.object({
        retrieved: z.number().int().nonnegative(),
        screened: z.number().int().nonnegative(),
        relaxationLevel: z.number().int().min(0).max(2),
        excludedCount: z.number().int().nonnegative()
      }),
      records: z.array(z.any()).max(50),
      userExcluded: z.array(z.string()).optional(),
      style: z.enum(["vancouver", "apa", "harvard"]).default("vancouver")
    });
    const res = composeZodSchema.safeParse(body);
    if (!res.success) {
      return NextResponse.json({ error: "Invalid parameters: " + res.error.issues.map(e => e.message).join(", ") }, { status: 422 });
    }
  }

  try {
    if (stage === "screen") {
      const { words } = body as { words: PicoWord[] };
      const { corpus, totalRetrieved, relaxationLevel } = await screenQueryLadder(words, 25_000);

      let screenPayload: ScreenPayload | null = null;

      if (hasAnyLlmKey()) {
        try {
          const corpusDigest = corpus
            .map((r, i) => `[${i + 1}] ${r.title}\n${(r.context || "").slice(0, 300)}`)
            .join("\n\n");

          const systemPrompt = `You are a clinical literature screening engine for Evidence-Based Medicine with strict scientific editorial standards.

TASK: Based on the screened literature digest and clinical PICO words, generate EXACTLY 3 main PICO phrases (one established knowledge, one conflicting evidence, one research gap).

CLINICAL PICO WORDS:
${words.map(w => `- ${w.role.toUpperCase()}: ${w.word}`).join("\n")}

SCREENED LITERATURE DIGEST (${corpus.length} records):
${corpusDigest || "(No records retrieved matching exact query)"}

HARD RULES:
1. Standard medical spelling and terminology ONLY.
2. EXACTLY 3 phrases — one "established", one "conflicting", one "gap".
3. Each phrase MUST be a single question sentence in the strict PICO format with literal (P), (I), (C), and (O) markers:
   "In [Population] (P), does [Intervention] (I) compared with [Comparator] (C) affect [Outcome] (O)?"
   - (P) must contain the population parameter.
   - (I) must contain the evaluated intervention.
   - (C) must contain the comparator (e.g. usual care, placebo, or specified control).
   - (O) must contain the clinical endpoint or outcome.
4. Each phrase MUST have a 1-2 sentence "basis" that ONLY references findings or evidence patterns present in the provided corpus digest (or explicitly notes absence/scarcity of evidence for the gap). Maximum 400 characters per basis.
5. Respond ONLY with valid JSON, no markdown formatting, no preamble:
{
  "established": { "phrase": "...", "basis": "..." },
  "conflicting": { "phrase": "...", "basis": "..." },
  "gap": { "phrase": "...", "basis": "..." }
}`;

          const rawLlm = await callLLM(systemPrompt, { words }, { stage: "screen", timeoutMs: 22_000 });
          const validated = validateScreenLlmResponse(rawLlm);
          if (validated) {
            screenPayload = {
              inputWords: words.map(w => w.word),
              source: "ai",
              phrases: {
                established: {
                  category: "established",
                  phrase: validated.established.phrase,
                  basis: validated.established.basis,
                  signalStrength: "moderate",
                  supportingRecordKeys: []
                },
                conflicting: {
                  category: "conflicting",
                  phrase: validated.conflicting.phrase,
                  basis: validated.conflicting.basis,
                  signalStrength: "moderate",
                  supportingRecordKeys: []
                },
                gap: {
                  category: "gap",
                  phrase: validated.gap.phrase,
                  basis: validated.gap.basis,
                  signalStrength: "weak",
                  supportingRecordKeys: []
                }
              },
              corpusStats: {
                retrieved: totalRetrieved,
                screened: corpus.length,
                relaxationLevel
              }
            };
          }
        } catch (llmErr) {
          console.warn("[engine] LLM screen analysis failed, using deterministic fallback:", llmErr);
        }
      }

      if (!screenPayload) {
        screenPayload = generateDeterministicScreen(words, corpus, relaxationLevel, totalRetrieved);
      }

      return NextResponse.json(screenPayload, {
        headers: { "x-aipico-source": screenPayload.source }
      });
    }

    if (stage === "explore") {
      const { phrase, category, userExcluded = [], seen = [] } = body as {
        phrase: string;
        category: "established" | "conflicting" | "gap";
        userExcluded?: string[];
        seen?: string[];
      };

      const startTime = Date.now();
      const blockedKeys = [...userExcluded, ...seen];

      const elements = parsePhraseElements(phrase);
      const popWords = elements.filter(e => e.label.startsWith("P")).map(e => e.value.trim()).filter(Boolean);
      const intWords = elements.filter(e => e.label.startsWith("I")).map(e => e.value.trim()).filter(Boolean);
      const outWords = elements.filter(e => e.label.startsWith("O")).map(e => e.value.trim()).filter(Boolean);
      const allWords = elements.map(e => e.value.trim()).filter(Boolean);

      const mainTerms = allWords.map(w => `"${sanitizePhrase(w)}"`).join(" AND ");
      const mainPubMed = `${mainTerms} ${HUMAN_SUBJECT_FILTER}`;
      const mainBroad = mainTerms;

      const [r1, r2, r3, r4, r5] = await Promise.all([
        fetchPubMedReferences(mainPubMed, 30).catch(() => []),
        fetchReferencesBroad(mainBroad, 15).catch(() => []),
        fetchEuropePMC(mainBroad, 10).catch(() => []),
        fetchOpenAlex(mainBroad, 10).catch(() => []),
        fetchCochraneCentral(mainBroad, 10).catch(() => [])
      ]);

      let allRetrieved: PubMedRef[] = dedupeRefs([...r1, ...r2, ...r3, ...r4, ...r5]);
      let scoredResult = scoreRecords(allRetrieved as AuditableRef[], phrase, category, blockedKeys);
      let candidates = scoredResult.scored.filter(r => r.relevancePct >= 20);

      let usedVariants = false;
      if (candidates.length < 8 && Date.now() - startTime < 22_000) {
        usedVariants = true;
        const variants: string[][] = [
          [...popWords, ...intWords],
          [...popWords, ...outWords],
          [...intWords, ...outWords]
        ].filter(v => v.length > 0);

        for (const vWords of variants) {
          if (Date.now() - startTime >= 22_000) break;
          const vTerms = vWords.map(w => `"${sanitizePhrase(w)}"`).join(" AND ");
          const varPubMed = `${vTerms} ${HUMAN_SUBJECT_FILTER}`;
          const varBroad = vTerms;

          const [vr1, vr2] = await Promise.all([
            fetchPubMedReferences(varPubMed, 20).catch(() => []),
            fetchReferencesBroad(varBroad, 10).catch(() => [])
          ]);
          const newRefs = dedupeRefs([...allRetrieved, ...vr1, ...vr2]);
          allRetrieved = newRefs;
          scoredResult = scoreRecords(allRetrieved as AuditableRef[], phrase, category, blockedKeys);
          candidates = scoredResult.scored.filter(r => r.relevancePct >= 20);
          if (candidates.length >= 8) break;
        }
      }

      const returnedRecords = candidates.slice(0, 16);
      const hasMore = scoredResult.removedByBlock >= 20 || usedVariants || candidates.length > 16;

      const payload = {
        records: returnedRecords,
        corpusStats: {
          retrieved: allRetrieved.length,
          screened: scoredResult.scored.length + scoredResult.removedByBlock,
          blocked: scoredResult.removedByBlock,
          returned: returnedRecords.length
        },
        hasMore
      };

      return NextResponse.json(payload, {
        headers: { "x-aipico-source": "deterministic" }
      });
    }

    if (stage === "compose") {
      const {
        words,
        category,
        phrase,
        screeningStats,
        records = [],
        userExcluded = [],
        style = "vancouver"
      } = body as {
        words: PicoWord[];
        category: "established" | "conflicting" | "gap";
        phrase: string;
        screeningStats: { retrieved: number; screened: number; relaxationLevel: number; excludedCount: number };
        records: ExploreRecord[];
        userExcluded?: string[];
        style?: CitationStyle;
      };

      const deterministicManuscript = composeManuscript({
        words,
        category,
        phrase,
        screeningStats,
        records,
        userExcluded,
        style
      });

      let finalManuscript = deterministicManuscript;

      if (hasAnyLlmKey()) {
        try {
          const excludedSet = new Set((userExcluded || []).map(k => k.trim().toLowerCase()));
          const retained = records.filter(r => {
            const pmidKey = (r.pmid || "").trim().toLowerCase();
            const doiKey = (r.doi || "").trim().toLowerCase();
            const titleKey = (r.title || "").trim().toLowerCase();
            return !excludedSet.has(pmidKey) && !excludedSet.has(doiKey) && !excludedSet.has(titleKey);
          });

          const prompt = `You are an expert scientific manuscript editor for academic peer-reviewed medicine.
TASK: Improve the narrative prose flow, scholarly transition, and readability of the provided scientific manuscript.

STRICT EDITORIAL RULES:
1. Do NOT invent or fabricate any facts, findings, authors, years, journals, DOIs, numbers, or study sources.
2. Keep the EXACT section headings in this order:
   - "Background"
   - "Search strategy and screening"
   - "Evidence synthesis"
   - "Limitations"
   - "Conclusion"
3. In-text citation markers must be preserved and must point ONLY to the provided retained records.
4. Output zero hyperlinks, zero URLs, and zero "http" or "https" occurrences.
5. Keep length within 0.5x to 1.75x of the input word count.
6. Return valid JSON only with this schema:
{
  "title": "...",
  "abstract": ["sentence 1", "sentence 2", "sentence 3", "sentence 4"],
  "sections": [
    { "heading": "Background", "paragraphs": ["..."] },
    { "heading": "Search strategy and screening", "paragraphs": ["..."] },
    { "heading": "Evidence synthesis", "paragraphs": ["..."] },
    { "heading": "Limitations", "paragraphs": ["..."] },
    { "heading": "Conclusion", "paragraphs": ["..."] }
  ]
}`;

          const userPayload = {
            manuscript: deterministicManuscript,
            retainedRecords: retained.map((r, idx) => ({
              index: idx + 1,
              title: r.title,
              authors: r.authors,
              year: r.year,
              journal: r.journal,
              design: designOf(r.title, r.journal || "") || "Observational study"
            }))
          };

          const rawLlm = await callLLM(prompt, userPayload, { stage: "compose", timeoutMs: 15_000 });
          const validated = validateEnrichedManuscript(rawLlm, deterministicManuscript, retained, style);
          if (validated) {
            finalManuscript = validated;
          }
        } catch (llmErr) {
          console.warn("[engine] LLM compose enrichment failed, using deterministic fallback:", llmErr);
        }
      }

      return NextResponse.json(finalManuscript, {
        headers: { "x-aipico-source": finalManuscript.aiEnriched ? "ai" : "deterministic" }
      });
    }

    return NextResponse.json(
      { error: "Unknown stage" },
      { status: 400 }
    );
  } catch (err) {
    console.error("[engine] execution error:", err);
    return NextResponse.json(
      { error: "Service error occurred. Please try again." },
      { status: 500 }
    );
  }
}
