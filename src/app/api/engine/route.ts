import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { KB, QUESTION_TYPES, rationalOutcomes, type Analysis } from "@/lib/kb";
import { applyOutcomeAdvisory } from "@/lib/outcome-selection";
import { ruleAnalyze, ruleClarify, ruleFormulate } from "@/lib/rule-engine";
// Claim-specific filtering boundary. The engine imports these rather than keeping its own
// copy, so the rule the unit tests verify is the rule that gates commentary, the rendered
// reference list and every export.
import {
  auditRef,
  checkCitations,
  curateReferences,
  filterByClaim,
  resolveReference,
  reconcileNarrative,
  type PicoElement,
  type RefAudit
} from "@/lib/relevance";
// The no-key / provider-failure fallback lives in a module rather than inline in this route so it
// can be unit tested: the previous inline version shipped unverified, which is how it kept
// emitting hardcoded keywords and a fabricated "supports the evaluated comparison" claim.
import { generateDeterministicCommentary } from "@/lib/deterministic-commentary";
// Confidence gate for LLM output evaluation and deterministic fallback telemetry
import { evaluateConfidence, shouldUseDeterministicFallback, createTelemetryEvent, DEFAULT_CONFIDENCE_CONFIG } from "@/lib/confidence-gate";
import { buildEvidenceSet } from "@/lib/evidence-set";
import type { AuditableRef } from "@/lib/relevance";
import { finalizeClaims } from "@/lib/claim-finalization";
import { validateDeliverableIntegrity } from "@/lib/deliverable-integrity";
import { generateDeterministicGapAnalysis } from "@/lib/deterministic-gap.ts";
import { extractPicoFromQuestion } from "@/lib/pico-parser";
import { parseClinicalScenario } from "@/lib/clinical-semantics";

export const maxDuration = 60;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const KEY = GEMINI_API_KEY || GROQ_API_KEY || OPENROUTER_API_KEY || OPENAI_API_KEY;

function hasAnyLlmKey(): boolean {
  return !!KEY;
}

const MODEL = process.env.LLM_MODEL || "gemini-2.0-flash";

// Bounded timeouts so dependencies degrade gracefully within request budget
const LLM_TIMEOUT_MS = 25_000;
const API_TIMEOUT_MS = 10_000;

class LlmFatal extends Error {}
class LlmTransient extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

// 4xx (other than 429) will never succeed on retry: bad key, bad request, wrong model.
const LLM_NON_RETRYABLE = new Set([400, 401, 403, 404, 422]);

function cleanJsonResponse(raw: string): Record<string, unknown> {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("Unable to parse JSON from LLM response");
  }
}

async function callGemini(modelName: string, apiKey: string, system: string, payload: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS)
    }
  );
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 240).replace(/\s+/g, " ");
    if (LLM_NON_RETRYABLE.has(res.status)) throw new LlmFatal(`Gemini ${res.status}: ${detail}`);
    const ra = Number(res.headers.get("retry-after"));
    const retryAfterMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 20_000) : 0;
    throw new LlmTransient(`Gemini ${res.status}: ${detail}`, retryAfterMs);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini response");
  return cleanJsonResponse(text);
}

async function callOpenAiCompatible(url: string, apiKey: string, model: string, system: string, payload: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS)
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 240).replace(/\s+/g, " ");
    if (LLM_NON_RETRYABLE.has(res.status)) throw new LlmFatal(`LLM ${res.status}: ${detail}`);
    throw new LlmTransient(`LLM ${res.status}: ${detail}`, 0);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty response from AI provider");
  return cleanJsonResponse(text);
}

async function callLLM(system: string, payload: unknown, attempts = 2): Promise<Record<string, unknown>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (GEMINI_API_KEY) {
        try {
          return await callGemini(MODEL, GEMINI_API_KEY, system, payload);
        } catch (geminiErr) {
          if (MODEL !== "gemini-1.5-flash") {
            try {
              return await callGemini("gemini-1.5-flash", GEMINI_API_KEY, system, payload);
            } catch {
              // fall through to throw geminiErr
            }
          }
          throw geminiErr;
        }
      } else if (GROQ_API_KEY) {
        const groqModel = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
        return await callOpenAiCompatible("https://api.groq.com/openai/v1/chat/completions", GROQ_API_KEY, groqModel, system, payload);
      } else if (OPENROUTER_API_KEY) {
        const orModel = process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-exp:free";
        return await callOpenAiCompatible("https://openrouter.ai/api/v1/chat/completions", OPENROUTER_API_KEY, orModel, system, payload);
      } else if (OPENAI_API_KEY) {
        const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
        const oaModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
        return await callOpenAiCompatible(`${baseUrl}/chat/completions`, OPENAI_API_KEY, oaModel, system, payload);
      } else {
        throw new Error("No AI provider key configured");
      }
    } catch (e) {
      lastErr = e;
      if (e instanceof LlmFatal) break;
      if (attempt < attempts - 1) {
        const backoff = 1000 * Math.pow(2, attempt);
        const wait = e instanceof LlmTransient && e.retryAfterMs ? Math.max(backoff, e.retryAfterMs) : backoff;
        await new Promise(r => setTimeout(r, Math.min(wait, 5000)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM failed");
}

interface PubMedRef { pmid: string; title: string; authors: string; year: string; journal: string; doi?: string; url: string; context?: string; source?: string }

interface ESummaryDoc {
  title?: string;
  sortfirstauthor?: string;
  pubdate?: string;
  fulljournalname?: string;
  source?: string;
  elocationid?: string;
}

function refKeys(r: PubMedRef): string[] {
  const keys: string[] = [];
  if (r.pmid) keys.push("p:" + r.pmid);
  if (r.doi) keys.push("d:" + r.doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, ""));
  const t = (r.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (t.length > 12) keys.push("t:" + t.slice(0, 50));
  return keys;
}

// Only http(s) links are ever emitted, so a crafted javascript:/data: URL from a
// tampered request body can never reach an href in the UI.
function safeUrl(u: unknown, fallback = ""): string {
  const s = typeof u === "string" ? u.trim() : "";
  return /^https?:\/\//i.test(s) ? s : fallback;
}

function dedupeRefs(refs: PubMedRef[]): PubMedRef[] {
  const seen = new Set<string>();
  const out: PubMedRef[] = [];
  for (const r of refs) {
    // A record without a title is not citable; never let one reach the pool.
    if (!(r.title || "").trim()) continue;
    const keys = refKeys(r);
    if (keys.length && keys.some(k => seen.has(k))) continue;
    keys.forEach(k => seen.add(k));
    out.push(r);
  }
  return out;
}

const NCBI_API_KEY = process.env.NCBI_API_KEY || process.env.PUBMED_API_KEY || "";

async function esearchIds(term: string, retmax: number, filters = ""): Promise<string[]> {
  const apiKeyParam = NCBI_API_KEY ? `&api_key=${encodeURIComponent(NCBI_API_KEY)}` : "";
  const res = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${retmax}&sort=relevance${filters}&term=${encodeURIComponent(term)}${apiKeyParam}`,
    { signal: AbortSignal.timeout(API_TIMEOUT_MS) }
  );
  if (!res.ok) throw new Error(`esearch ${res.status}`);
  const data = await res.json();
  return (data?.esearchresult?.idlist as string[]) || [];
}

async function esummaryForIds(ids: string[]): Promise<Record<string, ESummaryDoc>> {
  // An empty id list makes NCBI return an error payload, which would otherwise
  // throw and burn two pointless retry rounds.
  if (!ids.length) return {};
  const apiKeyParam = NCBI_API_KEY ? `&api_key=${encodeURIComponent(NCBI_API_KEY)}` : "";
  const res = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}${apiKeyParam}`,
    { signal: AbortSignal.timeout(API_TIMEOUT_MS) }
  );
  if (!res.ok) throw new Error(`esummary ${res.status}`);
  const data = await res.json();
  return (data?.result as Record<string, ESummaryDoc>) || {};
}

async function fetchPubMedReferences(query: string, maxResults = 3, excluded: Set<string> = EMPTY_REF_SET): Promise<PubMedRef[]> {
  const term = `${query} NOT "study protocol"[Publication Type] NOT "clinical trial protocol"[Publication Type]`;
  const extra = Math.min(excluded.size, 25);
  const want = Math.max(maxResults, 6);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const reviewIds = await esearchIds(term, want + extra, "&filter=pubt.review");
      if (!NCBI_API_KEY) await new Promise(r => setTimeout(r, 120));
      const generalIds = await esearchIds(term, want + extra);
      if (!reviewIds.length && !generalIds.length) return [];
      const ids = Array.from(new Set([...reviewIds, ...generalIds]))
        .filter(id => !excluded.has(id))
        .slice(0, maxResults);
      if (!NCBI_API_KEY) await new Promise(r => setTimeout(r, 120));
      const result = await esummaryForIds(ids);
      const refs = ids
        .map((id) => {
          const doc = result?.[id];
          return {
            pmid: id,
            title: (doc?.title || "").trim(),
            authors: doc?.sortfirstauthor || "",
            year: doc?.pubdate?.slice(0, 4) || "",
            journal: doc?.fulljournalname || doc?.source || "",
            doi: doc?.elocationid?.replace("doi: ", "") || "",
            source: "pubmed",
            url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
          };
        })
        // Some ESummary records carry no title at all; never emit a placeholder reference.
        .filter(r => r.title.length > 0);
      return dedupeRefs(refs);
    } catch {
      if (attempt === 2) return [];
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return [];
}

interface EuropePMCBase {
  id: string;
  source: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  firstPublicationDate?: string;
  journalTitle?: string;
  // With resultType=core, Europe PMC puts the journal under journalInfo. `journalTitle` is
  // frequently absent there, which left published references with no journal at all.
  journalInfo?: { journal?: { title?: string; medlineAbbreviation?: string } };
  abstractText?: string;
  pubTypeList?: { pubType?: string } | null;
}

const EXCLUDED_PUB_TYPES = /protocol|letter|erratum|correction|conference abstract|comment|retraction|news/i;

async function fetchEuropePMC(query: string, maxResults = 4): Promise<PubMedRef[]> {
  try {
    const terms = sanitizeQuery(query).split(" ").filter(Boolean).slice(0, 5).map(t => `"${t}"`).join(" AND ");
    if (!terms) return [];
    const typeFilter = ` AND NOT (PUB_TYPE:"Letter" OR PUB_TYPE:"Editorial" OR PUB_TYPE:"Erratum" OR PUB_TYPE:"Case Reports")`;
    const url =
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(terms + typeFilter)}` +
      `&resultType=core&format=json&pageSize=${Math.max(maxResults + 8, 12)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`europepmc ${res.status}`);
    const data = await res.json();
    const hits = (data?.resultList?.result || []) as EuropePMCBase[];
    const refs: PubMedRef[] = [];
    for (const h of hits) {
      const types = [h.pubTypeList?.pubType].flat().join(" ").toLowerCase();
      if (EXCLUDED_PUB_TYPES.test(types)) continue;
      const title = (h.title || "").trim();
      if (!title) continue;
      const pmid = h.pmid ? h.pmid : h.pmcid ? `pmc:${h.pmcid}` : `epmc:${h.source || ""}:${h.id}`;
      refs.push({
        pmid,
        title,
        authors: h.authorString || "",
        year: (h.firstPublicationDate || "").slice(0, 4),
        journal: h.journalTitle || h.journalInfo?.journal?.title || h.journalInfo?.journal?.medlineAbbreviation || "",
        doi: h.doi || "",
        source: "europepmc",
        url: h.pmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${h.pmid}/`
          : h.pmcid
            ? `https://europepmc.org/article/PMC/${h.pmcid}`
            : `https://europepmc.org/abstract/${h.source}/${encodeURIComponent(h.id)}`,
        context: h.abstractText || ""
      });
    }
    return dedupeRefs(refs).slice(0, maxResults);
  } catch {
    return [];
  }
}

interface OpenAlexWork {
  id?: string;
  doi?: string;
  title?: string;
  publication_year?: number;
  ids?: { pmid?: string; doi?: string; openalex?: string };
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: { source?: { display_name?: string } };
}

async function fetchOpenAlex(query: string, maxResults = 4): Promise<PubMedRef[]> {
  try {
    const terms = sanitizeQuery(query).split(" ").filter(Boolean).slice(0, 8).join(" ");
    if (!terms) return [];
    const select = "id,ids,doi,title,publication_year,authorships,primary_location";
    const url =
      `https://api.openalex.org/works?search=${encodeURIComponent(terms)}&filter=type:article` +
      `&per_page=${Math.min(Math.max(maxResults + 4, 8), 25)}&select=${select}&mailto=support@aipico.app`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`openalex ${res.status}`);
    const data = await res.json();
    const hits = (data?.results || []) as OpenAlexWork[];
    const refs: PubMedRef[] = [];
    for (const w of hits) {
      const title = (w.title || "").trim();
      if (!title || /protocol/i.test(title)) continue;
      const pmidRaw = w.ids?.pmid ? String(w.ids.pmid).replace(/\D/g, "") : "";
      const oaId = (w.ids?.openalex || w.id || "").split("/").pop() || "";
      const pmid = pmidRaw || (oaId ? `oax:${oaId}` : "");
      if (!pmid) continue;
      const doi = (w.doi || w.ids?.doi || "").replace(/^https?:\/\/doi\.org\//, "");
      refs.push({
        pmid,
        title,
        authors: (w.authorships || []).slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(", "),
        year: w.publication_year ? String(w.publication_year) : "",
        journal: w.primary_location?.source?.display_name || "",
        doi,
        source: "openalex",
        url: doi ? `https://doi.org/${doi}` : (w.ids?.openalex || w.id || "")
      });
    }
    return dedupeRefs(refs).slice(0, maxResults);
  } catch {
    return [];
  }
}

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  "container-title"?: string[];
  issued?: { "date-parts"?: number[][] };
  author?: Array<{ family?: string; given?: string }>;
  type?: string;
}

async function fetchCrossref(query: string, maxResults = 4): Promise<PubMedRef[]> {
  try {
    const terms = sanitizeQuery(query).split(" ").filter(Boolean).slice(0, 8).join(" ");
    if (!terms) return [];
    const select = "title,issued,DOI,author,container-title,type,URL";
    const url =
      `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(terms)}` +
      `&rows=${Math.min(Math.max(maxResults + 4, 8), 25)}&select=${select}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "aipico/1.0 (mailto:support@aipico.app)" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`crossref ${res.status}`);
    const data = await res.json();
    const hits = (data?.message?.items || []) as CrossrefItem[];
    const refs: PubMedRef[] = [];
    for (const it of hits) {
      const title = (it.title && it.title[0] ? it.title[0] : "").trim();
      if (!title || /protocol/i.test(title)) continue;
      // Only peer-reviewed journal articles: Crossref also returns datasets,
      // posted-content and other non-journal records that are not citable evidence.
      if (it.type && it.type !== "journal-article") continue;
      const doi = (it.DOI || "").replace(/^https?:\/\/doi\.org\//, "");
      if (!doi) continue;
      const year = it.issued?.["date-parts"]?.[0]?.[0];
      const a0 = it.author?.[0];
      refs.push({
        pmid: `cr:${doi}`,
        title,
        authors: [a0?.family, a0?.given].filter(Boolean).join(" "),
        year: year ? String(year) : "",
        journal: (it["container-title"] && it["container-title"][0]) || "",
        doi,
        source: "crossref",
        url: `https://doi.org/${doi}`
      });
    }
    return dedupeRefs(refs).slice(0, maxResults);
  } catch {
    return [];
  }
}

async function fetchReferencesBroad(query: string, maxResults = 8, excluded: Set<string> = EMPTY_REF_SET): Promise<PubMedRef[]> {
  const pubmed = await fetchPubMedReferences(query, maxResults, excluded);
  const [europe, openalex, crossref] = await Promise.all([
    fetchEuropePMC(query, maxResults),
    fetchOpenAlex(query, maxResults),
    fetchCrossref(query, maxResults)
  ]);
  const notExcluded = (r: PubMedRef): boolean => !excluded.has(r.pmid);
  const merged = dedupeRefs([
    ...pubmed,
    ...europe.filter(notExcluded),
    ...openalex.filter(notExcluded),
    ...crossref.filter(notExcluded)
  ]);
  const want = Math.max(maxResults, 6);
  const byScore = (r: PubMedRef): number => {
    let s = r.pmid && /^\d+$/.test(r.pmid) ? 2 : 0;
    s += r.doi ? 1 : 0;
    s += r.context ? 1 : 0;
    return s;
  };
  const bySource = (r: PubMedRef): string => {
    if (r.source) return r.source;
    if (/^\d+$/.test(r.pmid)) return "pubmed";
    if (/^(pmc|epmc):/.test(r.pmid)) return "europepmc";
    if (/^oax:/.test(r.pmid)) return "openalex";
    if (/^cr:/.test(r.pmid)) return "crossref";
    return "other";
  };
  // Score all, but guarantee the non-PubMed sources (EuropePMC/OpenAlex/Crossref) are
  // represented in the final pool instead of being crowded out by PubMed records.
  const scored = merged
    .map(r => ({ r, s: byScore(r), src: bySource(r) }))
    .sort((a, b) => b.s - a.s);
  const picked: PubMedRef[] = [];
  const srcCount: Record<string, number> = {};
  for (const it of scored) {
    if (it.src === "pubmed" || it.src === "other") continue;
    if ((srcCount[it.src] || 0) >= 2 || picked.length >= want) continue;
    picked.push(it.r);
    srcCount[it.src] = (srcCount[it.src] || 0) + 1;
  }  for (const it of scored) {
    if (picked.length >= want) break;
    if (picked.includes(it.r)) continue;
    picked.push(it.r);
  }
  return picked.sort((a, b) => byScore(b) - byScore(a)).slice(0, want);
}

const STOPWORDS = new Set(["and", "or", "not", "the", "a", "an", "of", "in", "on", "with", "for", "to", "is", "are", "as", "by", "at", "from"]);

const EMPTY_REF_SET = new Set<string>();

const TERM_FIXES: Array<[RegExp, string]> = [
  [/\blapururgical\b/gi, "laparoscopic"],
  [/\blaparosurgical\b/gi, "laparoscopic"],
  [/\blaparos??copic\b/gi, "laparoscopic"],
  [/\bhysteretomy\b/gi, "hysterectomy"],
  [/\bhysterecomy\b/gi, "hysterectomy"],
  [/\bhysterctmy\b/gi, "hysterectomy"],
  [/\bendometriotis\b/gi, "endometriosis"],
  [/\bendometriois\b/gi, "endometriosis"],
  [/\bgynacological\b/gi, "gynecological"],
  [/\bgynaecological\b/gi, "gynecological"],
  [/\bgyncological\b/gi, "gynecological"],
  [/\bendometreal\b/gi, "endometrial"],
  [/\bintra uterin\b/gi, "intrauterine"],
];

function fixTerms(s: string): string {
  return TERM_FIXES.reduce((acc, [re, fix]) => acc.replace(re, fix), s);
}

function sanitizeQuery(q: string): string {
  return q
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w.toLowerCase()))
    .slice(0, 8)
    .join(" ");
}

function buildRefQuery(point: string, topic: string): string {
  const pw = sanitizeQuery(point).split(" ").slice(0, 5);
  const tw = sanitizeQuery(topic).split(" ").slice(0, 3);
  const words = pw.length >= 3 ? pw : [...pw, ...tw].slice(0, 6);
  return words.join(" ").slice(0, 120);
}

function cleanTopicQuery(topic: string): string {
  return sanitizeQuery(topic);
}

async function fetchReferencesForPoints(
  points: Array<{ point: string; searchQuery?: string }>,
  topic: string,
  excluded: Set<string>
): Promise<Array<{ point: string; references: PubMedRef[] }>> {
  const results: Array<{ point: string; references: PubMedRef[] }> = [];
  for (const p of points) {
    const query = p.searchQuery && p.searchQuery.length > 3 ? sanitizeQuery(p.searchQuery) : buildRefQuery(p.point, topic);
    let refs = await fetchPubMedReferences(query, 3, excluded);
    if (!refs.length) refs = await fetchPubMedReferences(buildRefQuery(p.point, topic), 3, excluded);
    if (!refs.length) refs = await fetchPubMedReferences(sanitizeQuery(p.point), 3, excluded);
    if (refs.length < 2) {
      const need = 4 - refs.length;
      const [europe, openalex, crossref] = await Promise.all([
        fetchEuropePMC(query, need),
        fetchOpenAlex(query, need),
        fetchCrossref(query, need)
      ]);
      // Round-robin across the supplemental sources, otherwise the first bucket
      // (Europe PMC) fills every remaining slot and OpenAlex/Crossref never appear.
      const buckets = [europe, openalex, crossref].map(b =>
        b.filter(r => !excluded.has(r.pmid) && !refs.some(x => x.pmid === r.pmid))
      );
      for (let i = 0; refs.length < 4; i++) {
        let added = false;
        for (const b of buckets) {
          if (i < b.length) {
            refs.push(b[i]);
            added = true;
            if (refs.length >= 4) break;
          }
        }
        if (!added) break;
      }
    }
    // Truncate BEFORE marking as used, otherwise references dropped by the slice
    // are permanently excluded from every later point.
    const finalRefs = dedupeRefs(refs).slice(0, 4);
    for (const r of finalRefs) {
      if (r.pmid) excluded.add(r.pmid);
    }
    results.push({ point: p.point, references: finalRefs });
    await new Promise(r => setTimeout(r, 50));
  }
  return results;
}

function kbContext() {
  return {
    specialties: KB,
    questionTypes: QUESTION_TYPES
  };
}

const isSpecialty = (s: unknown): s is keyof typeof KB =>
  typeof s === "string" && Object.prototype.hasOwnProperty.call(KB, s);

// Relevance, citation and audit logic now lives in @/lib/relevance (imported above) so the
// claim-specific filter is unit-testable and shared by the engine, the UI and exports.

/**
 * `input` carries clinician free text. Coercing it with String() turned a JSON number or object
 * into a plausible-looking clinical phrase - `{"stage":"intent","input":123}` returned
 * `intervention: "123"` with HTTP 200 - which then flowed into literature queries and the session
 * store as though a clinician had typed it. Reject the wrong type instead of inventing a term.
 */
function readFreeText(
  value: unknown,
  field: string,
  max = 2000
): { ok: true; text: string } | { ok: false; response: NextResponse } {
  if (value === undefined || value === null) return { ok: true, text: "" };
  if (typeof value !== "string") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Field "${field}" must be a string.` },
        { status: 400 }
      )
    };
  }
  return { ok: true, text: value.slice(0, max) };
}

/**
 * `clarify` and `formulate` both require the analysis object produced by `intent`. Without this
 * check a missing or malformed `analysis` fell through to the catch block and was reported as
 * "The AI service is temporarily unavailable" (503) � filing a client-side validation error as a
 * provider outage, which corrupts availability metrics and sends the user after the wrong fix.
 *
 * Also rejects an `analysis` that is structurally valid but clinically empty. Answering such a
 * request produces a confident, content-free clinical question, which is worse than an error.
 */
function readAnalysisStage(
  body: Record<string, unknown>,
  stage: string
): { ok: true; analysis: Analysis; answered: Record<string, string> } | { ok: false; response: NextResponse } {
  const bad = (error: string) => ({
    ok: false as const,
    response: NextResponse.json({ error }, { status: 400 })
  });

  const raw = body.analysis;
  if (raw === undefined || raw === null) {
    return bad(`Stage "${stage}" requires an "analysis" object.`);
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return bad(`Field "analysis" must be an object, received ${raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw}.`);
  }
  const a = raw as Partial<Analysis>;
  if (a.missing !== undefined && !Array.isArray(a.missing)) {
    return bad('Field "analysis.missing" must be an array of strings.');
  }
  const answeredRaw = body.answered;
  if (
    answeredRaw !== undefined && answeredRaw !== null &&
    (typeof answeredRaw !== "object" || Array.isArray(answeredRaw))
  ) {
    return bad('Field "answered" must be an object.');
  }

  const missing = Array.isArray(a.missing) ? a.missing.filter((f): f is string => typeof f === "string") : [];
  const hasContent = Boolean(
    a.specialty ||
    String(a.condition || "").trim() ||
    String(a.intervention || "").trim() ||
    String(a.comparator || "").trim() ||
    missing.length
  );
  if (!hasContent) {
    return bad(
      `Stage "${stage}" requires an analysis containing clinical content; run the "intent" stage first.`
    );
  }

  return {
    ok: true,
    analysis: { ...(a as Analysis), missing },
    answered: (answeredRaw || {}) as Record<string, string>
  };
}

/**
 * A formulation that cannot state a real clinical question is a 400, not a 200 with placeholders
 * (F-05). The response names the missing PICO elements and the question to ask for the first of
 * them, so the caller can resume clarification instead of presenting "Women with the population of
 * interest" to a clinician as though it were a formulated question.
 */
function formulated(f: ReturnType<typeof ruleFormulate>): NextResponse {
  if (f.complete) return NextResponse.json(f);
  const [first, ...rest] = f.missingElements;
  const question =
    first === "condition"
      ? "What is the clinical problem or population?"
      : first === "intervention"
        ? "What intervention are you considering?"
        : `What is the ${first}?`;
  return NextResponse.json(
    {
      error: `Cannot formulate a clinical question without ${f.missingElements.join(" and ")}.`,
      missing: f.missingElements,
      field: first ?? null,
      questionText: question,
      otherMissing: rest
    },
    { status: 400 }
  );
}

const analysisZodSchema = z.object({
  specialty: z.string().max(100).nullable().optional(),
  specialtyLabel: z.string().max(100).optional(),
  condition: z.string().max(1000).optional().nullable(),
  intervention: z.string().max(1000).optional().nullable(),
  comparator: z.string().max(1000).optional().nullable(),
  questionType: z.string().max(100).optional().nullable(),
  framework: z.string().max(100).optional().nullable(),
  missing: z.array(z.string().max(100)).optional().nullable(),
  interpretation: z.string().max(2000).optional().nullable(),
  source: z.string().max(50).optional().nullable(),
});

const intentGapSchema = z.object({
  stage: z.enum(["intent", "gap"]),
  input: z.string().max(2000).optional().nullable(),
});

const clarifyFormulateSchema = z.object({
  stage: z.enum(["clarify", "formulate"]),
  analysis: analysisZodSchema.optional().nullable(),
  answered: z.record(z.string(), z.string().max(1000)).optional().nullable(),
});

const commentaryZodSchema = z.object({
  stage: z.literal("commentary"),
  topic: z.string().max(2000).optional().nullable(),
  gapAnalysis: z.object({
    known: z.array(z.any()).optional().nullable(),
    uncertain: z.array(z.any()).optional().nullable(),
  }).optional().nullable(),
  selectedQuestion: z.string().max(1000).optional().nullable(),
  outcome: z.string().max(1000).optional().nullable(),
  outcomes: z.array(z.string().max(1000)).optional().nullable(),
  picoElements: z.array(z.object({
    label: z.string().max(200),
    value: z.string().max(2000),
  })).optional().nullable(),
});

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const stageSchema = z.object({
    stage: z.enum(["intent", "clarify", "formulate", "gap", "commentary"]),
  });

  const baseResult = stageSchema.safeParse(body);
  if (!baseResult.success) {
    return NextResponse.json(
      { error: "Invalid stage parameter: " + baseResult.error.issues.map(e => e.message).join(", ") },
      { status: 400 }
    );
  }
  const stage = baseResult.data.stage;

  if (stage === "intent" || stage === "gap") {
    const res = intentGapSchema.safeParse(body);
    if (!res.success) {
      return NextResponse.json({ error: "Invalid parameters: " + res.error.issues.map(e => e.message).join(", ") }, { status: 400 });
    }
  } else if (stage === "clarify" || stage === "formulate") {
    const res = clarifyFormulateSchema.safeParse(body);
    if (!res.success) {
      return NextResponse.json({ error: "Invalid parameters: " + res.error.issues.map(e => e.message).join(", ") }, { status: 400 });
    }
  } else if (stage === "commentary") {
    const res = commentaryZodSchema.safeParse(body);
    if (!res.success) {
      return NextResponse.json({ error: "Invalid parameters: " + res.error.issues.map(e => e.message).join(", ") }, { status: 400 });
    }
  }

  try {
    if (stage === "commentary") {
      const { topic, gapAnalysis, selectedQuestion, outcome, outcomes, picoElements } = body as {
        topic?: string; gapAnalysis?: { known?: unknown[]; uncertain?: unknown[] };
        selectedQuestion?: string; outcome?: string; outcomes?: Array<unknown>; picoElements?: Array<{ label?: unknown; value?: unknown }>;
      };
      // NOTE: there is deliberately no `if (!KEY) return 503` here. That guard made the
      // deterministic fallback below unreachable whenever no key was configured, which is the
      // situation of every desktop install (F-23) - so the evidence-critical stage failed outright
      // even though retrieval, claim filtering and citation integrity all work without a provider.
      // Absence of a key now selects the deterministic path further down, and the response reports
      // which path produced it.
      const outcomesArr = Array.isArray(outcomes)
        ? outcomes.filter((o): o is string => typeof o === "string").map(o => o.trim()).filter(Boolean)
        : [];
      const outcomesText = outcomesArr.length
        ? outcomesArr.join("; ")
        : (String(outcome || "").trim() || "the primary outcome for this question");
      let refPool = await fetchReferencesBroad(cleanTopicQuery(String(topic || "")), 12);
      if (refPool.length < 6 && selectedQuestion) {
        const alt = await fetchReferencesBroad(sanitizeQuery(String(selectedQuestion)), 8);
        refPool.push(...alt);
      }
      const extra = Array.isArray(gapAnalysis?.known) ? gapAnalysis.known : [];
      const extra2 = Array.isArray(gapAnalysis?.uncertain) ? gapAnalysis.uncertain : [];
      // These references round-trip through the browser, so rebuild each one field by
      // field instead of trusting the payload: it blocks javascript:/data: URLs and
      // arbitrary extra keys from reaching the pool.
      for (const p of [...extra, ...extra2] as Array<{ references?: Array<Record<string, unknown>> }>) {
        for (const r of (p?.references || [])) {
          const pmid = String(r?.pmid || "").trim();
          const title = String(r?.title || "").trim();
          if (!pmid || !title) continue;
          if (refPool.some(x => x.pmid === pmid)) continue;
          refPool.push({
            pmid,
            title,
            authors: String(r?.authors || ""),
            year: String(r?.year || ""),
            journal: String(r?.journal || ""),
            doi: typeof r?.doi === "string" ? r.doi : undefined,
            url: safeUrl(r?.url, `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`),
            context: typeof r?.context === "string" ? r.context : undefined,
            source: typeof r?.source === "string" ? r.source : undefined
          });
        }
      }
      refPool = dedupeRefs(refPool);
      const elements: PicoElement[] = Array.isArray(picoElements)
        ? picoElements
            .map(e => ({ label: String(e?.label || ""), value: String(e?.value || "") }))
            .filter(e => e.label && e.value)
        : [];
      // ---- Claim-specific filtering boundary ----
      // Everything downstream (commentary generation, the rendered reference list, the audit
      // table, and every export) is derived from `directPool`. The model may only cite from
      // it, so an unrelated record can never reach the commentary or the reference list.
      let { kept: directPool, excluded: excludedByClaim } = filterByClaim(refPool, elements);

      // Targeted PICO & Outcome retrieval fallback if directPool has zero matches.
      // Often the broad topic search misses records that explicitly evaluate the target outcome.
      // Before declaring "No literature related to your search found", perform targeted searches
      // specifically for the target outcome combined with the intervention and population.
      if (directPool.length === 0 && elements.length > 0) {
        const byType = elements.reduce((acc, el) => {
          const l = el.label.toLowerCase();
          if (l.includes("pop")) acc.population = el.value;
          else if (l.includes("interv")) acc.intervention = el.value;
          else if (l.includes("comp")) acc.comparator = el.value;
          else if (l.includes("out")) acc.outcome = el.value;
          return acc;
        }, {} as Record<string, string>);

        const targetPop = byType.population || "";
        const targetInt = byType.intervention || "";
        const targetOut = byType.outcome || outcome || outcomesArr[0] || "";

        const queriesToTry = [
          // 1. Intervention + Outcome + core Population
          sanitizeQuery(`${targetInt} ${targetOut} ${targetPop}`),
          // 2. Focused Treatment + Outcome
          sanitizeQuery(`${targetInt} ${targetOut}`),
          // 3. Selected Question directly
          selectedQuestion ? sanitizeQuery(String(selectedQuestion)) : ""
        ].filter(
          (q, idx, arr) => q && q.length > 3 && arr.indexOf(q) === idx && q !== cleanTopicQuery(String(topic || ""))
        );

        for (const query of queriesToTry) {
          const additionalRefs = await fetchReferencesBroad(query, 8);
          if (additionalRefs.length) {
            refPool = dedupeRefs([...refPool, ...additionalRefs]);
            const filtered = filterByClaim(refPool, elements);
            directPool = filtered.kept;
            excludedByClaim = filtered.excluded;
            if (directPool.length > 0) break;
          }
        }
      }

      // Build canonical evidence set from retained records to serve as the single source of truth
      // for allowed citations, deduplication and revalidation.
      const evidenceSet = await buildEvidenceSet(directPool as AuditableRef[]);
      // Records that match the population and outcome but not the selected treatment are
      // genuine background. They are kept out of the reference list and shown separately so
      // the user can see what was retrieved but not treated as direct evidence.
      const contextualPool = excludedByClaim
        .filter(e => e.audit.population && e.audit.outcome)
        .map(e => e.ref);
      const poolForPrompt = evidenceSet.retainedRecords.slice(0, 18).map(r => ({
        authors: r.authors, year: r.year, title: r.title, journal: r.journal,
        doi: r.doi, url: r.url, abstract: (r.context || "").slice(0, 500)
      }));
      const strictOutcomes = outcomesArr.length > 0;
      // No record survived the claim filter: there is nothing to comment on. Calling the model
      // here would only invite it to assert findings it has no source for, so the request is
      // answered with the explicit no-evidence state instead of a commentary.
      if (directPool.length === 0) {
        return NextResponse.json({
          title: "No literature related to your search found",
          abstract: "",
          keywords: [],
          introduction: "",
          discussion: "",
          conclusion: "",
          references: [],
          fetchedReferences: [],
          additionalEvidence: [],
          contextualReferences: contextualPool,
          retainedCount: 0,
          retrievedCount: refPool.length,
          excludedCount: excludedByClaim.length,
          excludedReferences: excludedByClaim.slice(0, 20).map(e => ({
            pmid: e.ref.pmid, title: e.ref.title, reason: e.reason,
            url: safeUrl(e.ref.url, `https://pubmed.ncbi.nlm.nih.gov/${e.ref.pmid}/`)
          })),
          droppedReferences: [],
          noDirectEvidence: true,
          refAudit: [],
          paperRefAudit: [],
          citationChecks: { totalRefs: 0, citedRefs: 0, uncited: [], orphans: [], consistent: true }
        });
      }
      // The model is asked for a self-consistent draft: every listed reference cited, every
      // citation resolvable. When it is not, one corrective retry names the offending
      // citations rather than shipping a commentary whose reference list it does not support.
      const basePrompt = `You are an expert medical writer specializing in Obstetrics and Gynecology.


Generate a full scientific commentary paper that is strictly centered on the given research question and the SELECTED OUTCOMES listed below.

RESEARCH QUESTION: ${String(selectedQuestion || topic || "")}

SELECTED OUTCOMES: ${outcomesText}

HARD RULES${strictOutcomes ? " (mandatory)" : ""}:
${strictOutcomes ? `- Discuss ONLY the selected outcomes as target outcomes for this paper. Do NOT introduce any unselected outcome as a target outcome — this includes keywords, abstract, discussion, and conclusion.
- Secondary or exploratory outcomes may be mentioned only when clearly labeled as contextual evidence (e.g., begin the sentence with "As a secondary consideration, ..."), never as a target outcome of the paper.
- keywords must be derived ONLY from the selected outcomes, the patient population, and the intervention. Never include an outcome keyword that was not selected.
- The title must explicitly name the primary target of the paper, anchored to the first selected outcome.
- The abstract must state each selected outcome and the direction/strength of the evidence for it.
- The discussion must contain a clearly-labeled subsection for EACH selected outcome that evaluates the evidence for that specific outcome.` : `- Cover the primary outcome(s) that are most aligned with the research question and state them explicitly.`}
- The paper must include:
  - title: concise scientific title
  - abstract: structured abstract (Background, Methods, Results, Conclusion) - 250-300 words
  - keywords: 5-6 MeSH-aligned keywords
  - introduction: background, clinical significance, and rationale (2-3 paragraphs)
  - discussion: comprehensive synthesis of current evidence organized by subthemes with short subheaders, covering strengths/limitations of evidence, controversies, and identified research gaps
  - conclusion: clear take-home message and implications (1-2 paragraphs)
  - references: array of AT LEAST 4 strings in Vancouver style (ICMJE/NLM) built ONLY from the provided referencePool in sequential order of citation. Format: [Number]. Author(s) (up to 6, then et al.). Article title (no quotes). Journal. Year;Volume(Issue):Pages. doi:10.xxx (or URL).
- Every in-text citation MUST use Vancouver numbered square brackets matching the reference list (e.g., [1], [2], [1, 2], [1-3]). You may optionally include author surnames alongside the bracket, e.g. Owen et al. [1]. Never cite a reference number not present in the references list.
- The references MUST be numbered sequentially starting with 1 in the exact order they are first cited in the discussion. Cite EACH listed reference at least once in the text; do not list a reference you never cite.
- The referencePool has ALREADY been filtered for claim-specific relevance: every record in it directly addresses the Population AND (Intervention or Comparator) AND the SELECTED OUTCOMES. Records from other conditions, cancer trials, or basic-science work are not present and must never be cited or listed.
- Cite and list references ONLY from the provided referencePool.
- Every sentence that asserts an effect, a magnitude, a mechanism or a recommendation MUST carry its own in-text citation (e.g. [1]), not just one citation per paragraph. Sentences are judged one at a time: a sentence that asserts something and cites nothing is deleted and replaced with a statement that direct evidence was not identified, so an uncited assertive sentence never reaches the reader.
- Do not state an effect size, percentage, p-value or confidence interval unless the cited record reports that number. Write only what the cited records support.`;
      const promptPayload = {
        topic, gapAnalysis, selectedQuestion, outcome: outcomesText, referencePool: poolForPrompt
      };
      const responseShape = `Respond ONLY with JSON: {title, abstract, keywords, introduction, discussion, conclusion, references}.`;

      // The model is asked for a self-consistent draft: every listed reference cited, every
      // citation resolvable. When it is not, a bounded corrective retry names the offending
      // citations rather than shipping a commentary whose reference list it does not support.
      // The loop stops at the first self-consistent draft, so a good first pass costs one call.
let commentary: Record<string, unknown>;
      // Provenance is reported to the client. A deterministic evidence list and a model-written
      // synthesis are very different things to hand a clinician, and the response previously gave
      // no way to tell them apart (`source` came back undefined for both).
      let commentarySource: "ai" | "deterministic";
      const commentaryStartTime = Date.now();
      if (!KEY) {
        commentarySource = "deterministic";
        commentary = generateDeterministicCommentary({
          selectedQuestion: String(selectedQuestion || topic || ""),
          outcomesText,
          reason: "no AI provider key is configured for this instance",
          pool: evidenceSet.retainedRecords as AuditableRef[],
          elements
        });
      } else {
        try {
          commentary = await callLLM(`${basePrompt}\n${responseShape}`, promptPayload, 2);
          commentarySource = "ai";
        } catch (e) {
          console.error("[engine] LLM commentary generation failed, using deterministic fallback:", e);
          commentarySource = "deterministic";
          commentary = generateDeterministicCommentary({
            selectedQuestion: String(selectedQuestion || topic || ""),
            outcomesText,
            reason: "the AI writing service did not respond",
            pool: evidenceSet.retainedRecords as AuditableRef[],
            elements
          });
        }
      }
      
      // Evaluate LLM output through confidence gate when AI path was attempted
      // If confidence gates fail, gracefully fall back to deterministic output
      if (commentarySource === "ai") {
        const confidenceResult = evaluateConfidence(
          commentary,
          evidenceSet,
          elements,
          { ...DEFAULT_CONFIDENCE_CONFIG, llmAvailable: !!KEY }
        );
        
        // Telemetry logging for LLM vs deterministic path tracking
        const telemetry = createTelemetryEvent(confidenceResult.telemetry, {
          stage: "commentary",
          question: selectedQuestion,
          outcomes: outcomesText,
          fallbackTriggered: false,
          processingTimeMs: Date.now() - commentaryStartTime
        });
        console.log("[engine] [telemetry]", JSON.stringify(telemetry));
        
        // If confidence gates fail, gracefully fall back to deterministic output
        if (shouldUseDeterministicFallback(confidenceResult)) {
          console.warn("[engine] Confidence gates failed, falling back to deterministic:", confidenceResult.fallbackReason);
          commentarySource = "deterministic";
          commentary = generateDeterministicCommentary({
            selectedQuestion: String(selectedQuestion || topic || ""),
            outcomesText,
            reason: confidenceResult.fallbackReason || "AI output failed confidence validation",
            pool: evidenceSet.retainedRecords as AuditableRef[],
            elements
          });
          
          // Log fallback telemetry
          const fallbackTelemetry = createTelemetryEvent({
            pathUsed: "deterministic",
            fallbackTriggered: true,
            failedGates: confidenceResult.gates.filter(g => !g.passed).length,
            llmAvailable: true
          }, {
            stage: "commentary",
            question: selectedQuestion,
            fallbackReason: confidenceResult.fallbackReason,
            processingTimeMs: Date.now() - commentaryStartTime
          });
          console.log("[engine] [telemetry] [fallback]", JSON.stringify(fallbackTelemetry));
        }
      } else {
        // Deterministic path telemetry
        const fallbackReason = !KEY ? "no_key" : "llm_failure";
        const telemetry = createTelemetryEvent({
          pathUsed: "deterministic",
          fallbackTriggered: true,
          failedGates: 0,
          llmAvailable: !!KEY
        }, {
          stage: "commentary",
          question: selectedQuestion,
          outcomes: outcomesText,
          fallbackReason,
          processingTimeMs: Date.now() - commentaryStartTime
        });
        console.log("[engine] [telemetry]", JSON.stringify(telemetry));
      }
      let curated = curateModelRefs(commentary);
      let citationChecks = checkCitations(String(commentary.discussion || ""), curated.references);
      let repairs = 0;
      // Only a model-produced draft can be repaired by asking the model again. A deterministic
      // draft is already built to cite every record it lists, so retrying would just burn two
      // provider calls that cannot succeed.
      while (commentarySource === "ai" && (citationChecks.orphans.length || citationChecks.uncited.length) && repairs < 2) {
        repairs++;
          try {
            commentary = await callLLM(
              `${basePrompt}
- Your previous draft was rejected for citation integrity. These in-text citations name no reference you listed: ${citationChecks.orphans.join("; ") || "none"}. These references you listed were never cited in the text: ${citationChecks.uncited.map(u => u.split(".")[0]).join("; ") || "none"}. Fix both: cite each listed reference at least once using sequential Vancouver numeric brackets [1], [2], etc., and delete or correct every citation that is not in the referencePool.
${responseShape}`,
              promptPayload,
              2
            );
          } catch (e) {
            console.error("[engine] LLM commentary repair failed, using current commentary:", e);
          }
        curated = curateModelRefs(commentary);
        citationChecks = checkCitations(String(commentary.discussion || ""), curated.references);
      }

// Claim-level finalization runs on every narrative field, before references are curated. A
      // citation proves a paper exists, not that it supports the sentence citing it, so each
      // assertive sentence is judged against the retained sources it points at. An assertive
      // sentence with no surviving support is replaced by an explicit statement of uncertainty
      // rather than left standing as a finding with its attribution removed.
      const finalized = finalizeClaims({
        fields: {
          abstract: String(commentary.abstract || ""),
          introduction: String(commentary.introduction || ""),
          discussion: String(commentary.discussion || ""),
          conclusion: String(commentary.conclusion || "")
        },
        evidenceSet,
        elements
      });
      commentary.abstract = finalized.fields.abstract;
      commentary.introduction = finalized.fields.introduction;
      commentary.discussion = finalized.fields.discussion;
      commentary.conclusion = finalized.fields.conclusion;
      const claimWarnings = finalized.warnings;

      const narrativeOf = () =>
        [commentary.abstract, commentary.introduction, commentary.discussion, commentary.conclusion]
          .map(v => String(v || ""))
          .join(" ");

      // A reference the text never cites is not part of this commentary's evidence base. Drop
      // them so the published list is exactly what the prose supports, rather than a list the
      // user is then told is partly uncited.
      // Trimming, orphan removal and canonical revalidation are one deterministic fixpoint across
      // the whole narrative, because each of them can undo the others: dropping a reference strands
      // its citation, removing that citation strands the reference, and neither half-consistent
      // state is one this app is willing to publish.
      const reconciled = reconcileNarrative(
        {
          abstract: String(commentary.abstract || ""),
          introduction: String(commentary.introduction || ""),
          discussion: String(commentary.discussion || ""),
          conclusion: String(commentary.conclusion || "")
        },
        curated.references,
        evidenceSet.allowedCitationKeys,
        evidenceSet.citationMap
      );
      const evidenceWarnings: string[] = [];
      commentary.abstract = reconciled.fields.abstract;
      commentary.introduction = reconciled.fields.introduction;
      commentary.discussion = reconciled.fields.discussion;
      commentary.conclusion = reconciled.fields.conclusion;
      const finalRefs = [...reconciled.references];
      const removedCitations = reconciled.removedCitations;
      const droppedRefs = curated.dropped;
      commentary.references = finalRefs;
      citationChecks = checkCitations(narrativeOf(), finalRefs);
      const resolvedDirect = new Map(finalRefs.map((r, i) => [r, curated.records[i]]));
      // The source list is the record behind each surviving reference, re-resolved after
      // reconciliation so `fetchedReferences` can never drift from `references`.
      const curatedRecords: AuditableRef[] = [];
      for (const raw of finalRefs) {
        const rec = resolveReference(raw, evidenceSet.retainedRecords as AuditableRef[]);
        if (rec) curatedRecords.push(rec);
      }

      function curateModelRefs(c: Record<string, unknown>) {
        const fromModel = (Array.isArray(c.references) ? c.references : [])
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0);
        // A model-produced reference is only accepted when it resolves to a record that passed
        // the claim filter. Resolution and the top-up both run against the canonical retained set.
        return curateReferences(fromModel, evidenceSet.retainedRecords as AuditableRef[], { min: 4, max: 8 });
      }
      // Retained records that are not in the bibliography. Shown as additional evidence so the
      // user can see the full evidence base, never mixed into the reference list.
      const citedKeys = new Set(curatedRecords.map(r => r.doi ? `doi:${r.doi.toLowerCase()}` : (r.title || "").slice(0, 60).toLowerCase()));
      const additionalEvidence = directPool.filter(r =>
        !citedKeys.has(r.doi ? `doi:${r.doi.toLowerCase()}` : (r.title || "").slice(0, 60).toLowerCase())
      );
      // Audits describe only records that survived the claim filter and are actually cited,
      // so the UI can never present an audit row for a reference that is not in the list.
      const paperRefAudit = finalRefs
        .map((raw: string) => {
          const rec = resolvedDirect.get(raw) ?? resolveReference(raw, evidenceSet.retainedRecords as AuditableRef[]);
          if (!rec) return null;
          return { ref: raw, audit: auditRef(rec, elements) };
        })
        .filter((x: { ref: string; audit: RefAudit } | null): x is { ref: string; audit: RefAudit } => !!x);
      // `fetchedReferences` is exactly the records behind `commentary.references`: the rendered
      // list, the audit table and both PDF exports are therefore the same set, built from
      // authoritative source metadata. The filtering itself is auditable from the counts.
const noDirectEvidence = directPool.length === 0;
      // Last gate before publication. The reconciliation above already drives the narrative and
      // the list into agreement, and this asserts that on the exact payload being returned, so a
      // future edit cannot ship an orphan citation, an uncited reference, or a reference that
      // resolves to nothing in the retained set without this failing loudly.
      const integrity = validateDeliverableIntegrity({
        fields: {
          abstract: String(commentary.abstract || ""),
          introduction: String(commentary.introduction || ""),
          discussion: String(commentary.discussion || ""),
          conclusion: String(commentary.conclusion || "")
        },
        references: finalRefs,
        retainedRecords: curatedRecords,
        allowedKeys: evidenceSet.allowedCitationKeys,
        citationMap: evidenceSet.citationMap
      });
      if (!integrity.ok) {
        return NextResponse.json({
          error: "Commentary failed citation integrity validation and was not published.",
          integrity
        }, { status: 500 });
      }
      return NextResponse.json({
        ...commentary,
        source: commentarySource,
        synthesisGenerated: commentarySource === "ai",
        ...(commentarySource === "deterministic"
          ? {
              notice:
                "No AI provider key is configured, so this is a deterministic evidence list rather than a written synthesis. No findings are asserted."
            }
          : {}),
        fetchedReferences: curatedRecords,
        additionalEvidence,
        contextualReferences: contextualPool,
        retainedCount: directPool.length,
        retrievedCount: refPool.length,
        excludedCount: excludedByClaim.length,
        excludedReferences: excludedByClaim.map(e => ({
          pmid: e.ref.pmid, title: e.ref.title, reason: e.reason,
          url: safeUrl(e.ref.url, `https://pubmed.ncbi.nlm.nih.gov/${e.ref.pmid}/`)
        })),
droppedReferences: droppedRefs,
        removedCitations,
        evidenceWarnings,
        claimWarnings,
        claimAudit: finalized.claims,
        canonicalCitationKeys: Array.from(evidenceSet.allowedCitationKeys),
        noDirectEvidence,
refAudit: directPool.map(r => auditRef(r, elements)),
        paperRefAudit,
        citationChecks,
        integrity
      });
    }

    if (stage === "gap") {
      const parsedTopic = readFreeText(body.input, "input");
      if (!parsedTopic.ok) return parsedTopic.response;
      const topic = parsedTopic.text;
      const scenario = parseClinicalScenario(topic);

      let gapAnalysis: Record<string, unknown> | null = null;
      let gapSource: "ai" | "deterministic" = "deterministic";

      if (hasAnyLlmKey()) {
        try {
          gapAnalysis = await callLLM(
            `You are an evidence-mapping engine for Obstetrics and Gynecology with strict scientific editorial standards.

TASK: Given a clinical topic, map the current evidence landscape.

CLINICAL TOPIC DECOMPOSITION:
- Specialty: ${scenario.specialty}
- Clinical Population / Condition (P): ${scenario.population}
- Primary Intervention (I): ${scenario.intervention}
- Comparison / Control (C): ${scenario.comparator}
- Candidate Clinical Endpoints (O): ${scenario.outcomes.join(", ")}

HARD RULES:
1. Standard medical spelling and terminology ONLY. This is a scientific deliverable: correct spelling is mandatory. Example: "laparoscopic treatment" (never "laparurgical"), "hysterectomy" (never "hysterctmy"), "endometriosis" (never "endometriotis"). Before output, re-read your own response and correct any typo or malformed term.
2. EXACT item counts, no more and no fewer:
   - known: EXACTLY 4 points that are settled by robust, high-quality evidence (meta-analyses, systematic reviews, large RCTs). Each: {point, searchQuery}. searchQuery must be 3-6 words of DISTINCTIVE keywords for that specific claim so a PubMed search returns papers supporting THAT claim, not the general topic.
   - uncertain: EXACTLY 4 areas where evidence is conflicting or low-quality. Each: {point, searchQuery} same format.
   - gaps: EXACTLY 4 genuine research gaps. Each: {gap, why}, where why briefly explains why the gap matters clinically.
   - suggestedQuestions: EXACTLY 4 answerable PICO-format research questions targeting the most important gaps. Each: {question, rationale}.
      STRICT PICO SEPARATION: Each question must strictly separate Population (P), Intervention (I), Comparator (C), and Outcome (O).
      Format: "In [Population/Condition ONLY] (P), does [Intervention ONLY] (I) compared with [Comparator ONLY] (C) [Verb Phrase] [Outcome ONLY] (O)?"
      MANDATORY:
      - (P) must contain ONLY the patient population (e.g. "${scenario.population}"). NEVER put intervention or comparator into (P).
      - (I) must contain ONLY the evaluated intervention (e.g. "${scenario.intervention}").
      - (C) must contain ONLY the comparison arm (e.g. "${scenario.comparator}").
      - (O) must contain ONLY the clinical endpoint.
3. Claim-strength calibration:
    - known may contain ONLY settled knowledge. Phrase every claim to match the strength of the evidence: use hedged, association-style wording ("is associated with", "the evidence shows", "meta-analyses support") unless multiple consistent high-level studies establish the effect, in which case stronger wording ("reduces", "increases") is acceptable. NEVER use absolute or definitive causal language ("is proven to", "demonstrably causes", "guaranteed") unless supported by multiple consistent high-level studies.
    - uncertain must state WHY the evidence conflicts or is low-quality (heterogeneous populations, small samples, inconsistent endpoints).
4. Reference integrity: the 8 evidence points must each carry a DISTINCT searchQuery targeting its own claim. Do not present study protocols, trial registrations, or conference abstracts as evidence of clinical effect.

Respond ONLY with valid JSON, no preamble or commentary.`,
            { topic }
          );
          gapSource = "ai";
        } catch (llmErr) {
          console.warn("[engine] LLM gap analysis failed, using deterministic fallback:", llmErr);
        }
      }

      if (!gapAnalysis) {
        gapAnalysis = generateDeterministicGapAnalysis(topic) as unknown as Record<string, unknown>;
        gapSource = "deterministic";
      }

      interface RawGapPoint { point?: unknown; text?: unknown; searchQuery?: unknown }

      const normPoints = (arr: unknown): Array<{ point: string; searchQuery?: string }> =>
        Array.isArray(arr)
          ? arr
              .map((p): { point: string; searchQuery?: string } => {
                if (typeof p === "string") return { point: fixTerms(p) };
                const obj = p as RawGapPoint;
                const point = typeof obj?.point === "string" && obj.point ? obj.point : typeof obj?.text === "string" ? obj.text : "";
                return {
                  point: fixTerms(point),
                  searchQuery: typeof obj?.searchQuery === "string" && obj.searchQuery ? fixTerms(obj.searchQuery) : undefined
                };
              })
              .map(x => ({ ...x, point: x.point.replace(/\s+/g, " ").trim() }))
              .filter(x => x.point.length > 0)
          : [];

      if (!Array.isArray(gapAnalysis.suggestedQuestions) || gapAnalysis.suggestedQuestions.length === 0) {
        gapAnalysis.suggestedQuestions = scenario.suggestedQuestions;
      }
      interface RawGapItem { gap?: unknown; why?: unknown }
      interface RawSuggestion { question?: unknown; rationale?: unknown }
      if (Array.isArray(gapAnalysis.gaps)) {
        gapAnalysis.gaps = gapAnalysis.gaps
          .map((g: RawGapItem) => ({
            gap: fixTerms(String(g?.gap || "")).replace(/\s+/g, " ").trim(),
            why: fixTerms(String(g?.why || "")).replace(/\s+/g, " ").trim()
          }))
          .filter(g => g.gap.length > 0);
      }
      if (!Array.isArray(gapAnalysis.gaps) || gapAnalysis.gaps.length === 0) {
        gapAnalysis.gaps = [{ gap: "Primary evidence gap under investigation", why: "Confirm specific gaps with a focused literature review." }];
      }
      if (Array.isArray(gapAnalysis.suggestedQuestions)) {
        const sqList: Array<{ question: string; rationale: string }> = gapAnalysis.suggestedQuestions
          .map((s: RawSuggestion) => ({
            question: fixTerms(String(s?.question || "")).replace(/\s+/g, " ").trim(),
            rationale: fixTerms(String(s?.rationale || "")).replace(/\s+/g, " ").trim()
          }))
          .filter(s => s.question.length > 0);

        // Sanity check: Ensure strict PICO separation and no mixing of P, I, C
        const isMalformed = (sq: { question: string }) => {
          const q = sq.question;
          if (!q.includes("(P)") || !q.includes("(I)") || !q.includes("(C)")) return true;
          const pMatch = q.match(/In\s+(.+?)\s+\(P\)/i);
          if (!pMatch) return true;
          const pText = pMatch[1].toLowerCase();
          // Detect if comma-separated tags or intervention words contaminated Population
          if (pText.includes(",") || pText.includes(scenario.intervention.toLowerCase()) || pText.includes(scenario.comparator.toLowerCase())) {
            return true;
          }
          return false;
        };

        const hasMalformed = sqList.length < 4 || sqList.some(isMalformed);
        gapAnalysis.suggestedQuestions = hasMalformed ? scenario.suggestedQuestions : sqList;
      }
      gapAnalysis.gaps = (Array.isArray(gapAnalysis.gaps) ? gapAnalysis.gaps : []).slice(0, 4);
      gapAnalysis.suggestedQuestions = (Array.isArray(gapAnalysis.suggestedQuestions) ? gapAnalysis.suggestedQuestions : []).slice(0, 4);
      gapAnalysis.specialty = isSpecialty(gapAnalysis.specialty) ? gapAnalysis.specialty : null;

      const knownPts = normPoints(gapAnalysis.known).slice(0, 4);
      const uncertainPts = normPoints(gapAnalysis.uncertain).slice(0, 4);

      const usedPmids = new Set<string>();
      let knownWithRefs: Array<{ point: string; references: PubMedRef[] }> = [];
      let uncertainWithRefs: Array<{ point: string; references: PubMedRef[] }> = [];
      try {
        knownWithRefs = await fetchReferencesForPoints(knownPts, topic, usedPmids);
        uncertainWithRefs = await fetchReferencesForPoints(uncertainPts, topic, usedPmids);
      } catch (refErr) {
        console.warn("[engine] Reference fetching encountered an issue, returning points without external refs:", refErr);
        knownWithRefs = knownPts.map(p => ({ point: p.point, references: [] }));
        uncertainWithRefs = uncertainPts.map(p => ({ point: p.point, references: [] }));
      }
      
      return NextResponse.json({ 
        ...gapAnalysis, 
        topic,
        source: gapSource,
        known: knownWithRefs,
        uncertain: uncertainWithRefs
      });
    }

    if (stage === "intent") {
      const parsedInput = readFreeText(body.input, "input");
      if (!parsedInput.ok) return parsedInput.response;
      const input = parsedInput.text;
      if (KEY) {
        const out = await callLLM(
          `You are a clinical intent recognition engine for Obstetrics and Gynecology.
Given a clinician's raw, vague clinical uncertainty, identify:
- specialty: one of ${Object.keys(KB).join(", ")} (or null)
- condition: the clinical problem/population (empty string if unclear)
- intervention: treatment/test/exposure mentioned (empty string if none)
- comparator: comparison mentioned (empty string if none)
- questionType and framework chosen from: ${JSON.stringify(QUESTION_TYPES)}
- missing: list of missing PICO elements from ["condition","intervention","comparator","outcome"]
- interpretation: one sentence explaining your reading of the uncertainty.
Respond ONLY with JSON.`, { input, knowledgeBase: kbContext() });
        const r = out as unknown as Analysis;
        const valid = isSpecialty(r.specialty);
        return NextResponse.json({
          ...r,
          specialty: valid ? r.specialty : null,
          source: "ai",
          specialtyLabel: valid ? KB[r.specialty as keyof typeof KB].label : "Unknown"
        });
      }
      return NextResponse.json(ruleAnalyze(input));
    }

    if (stage === "clarify") {
      const parsed = readAnalysisStage(body, stage);
      if (!parsed.ok) return parsed.response;
      const { analysis, answered } = parsed;

      // The deterministic selection is computed first and is the authority for the outcome field.
      // The model may only reorder it; it can never introduce, rename or invent an option.
      const deterministic = ruleClarify(analysis, answered);

      if (deterministic.field !== "outcome") {
        if (KEY && analysis?.specialty && isSpecialty(analysis.specialty)) {
          const out = await callLLM(
            `You are an interactive clinical clarification assistant for ${KB[analysis.specialty as keyof typeof KB].label}.
The clinician's original uncertainty and the current analysis are given. Ask the SINGLE most important next clarification question needed to formulate an answerable clinical question.
Prefer asking about: outcome specificity first, then population details, then comparator.
Provide 4 to 6 diverse, clinically relevant options so the clinician has real choices.
Respond ONLY with JSON:
{"done": false, "field": "<condition|intervention|comparator|outcome>", "questionText": "...", "options": ["...", "..."], "allowFreeText": true}
Set done=true with empty strings when everything essential is known.`,
            { analysis, answered }
          );
          return NextResponse.json({ ...out, source: "ai" });
        }
        return NextResponse.json(deterministic);
      }

      const outcomeSelection = deterministic.outcomeSelection;
      if (!outcomeSelection || !(KEY && analysis?.specialty && isSpecialty(analysis.specialty))) {
        return NextResponse.json(deterministic);
      }

      const advisory = await callLLM(
        `You are helping a clinician choose the primary outcome for a clinical question.
These outcomes were selected for this question and are already ranked by clinical relevance:
${JSON.stringify(outcomeSelection.options.map(o => ({ id: o.id, label: o.label, category: o.category })), null, 1)}
Reorder them only if this specific question is clearly better served by a different order, and name the single outcome that should be the recommended primary.
You MUST use the ids exactly as given. You MUST NOT invent, rename, or add outcomes.
Respond ONLY with JSON:
{"recommendedOutcomeId": "<id from the list>", "options": ["<id>", "..."]}`,
        { analysis, answered, question: deterministic.questionText }
      );
      const advised = applyOutcomeAdvisory(outcomeSelection, advisory);
      return NextResponse.json({
        ...deterministic,
        questionText: typeof advisory === "object" && advisory && typeof (advisory as { questionText?: unknown }).questionText === "string"
          ? String((advisory as { questionText: string }).questionText).slice(0, 600)
          : deterministic.questionText,
        options: advised.options.map(o => o.label),
        outcomeSelection: advised,
        source: advised.source
      });
    }

    if (stage === "formulate") {
      const parsed = readAnalysisStage(body, stage);
      if (!parsed.ok) return parsed.response;
      const { analysis, answered } = parsed;

      // Ensure condition, intervention and comparator are populated from question/topic if missing
      const textToExtract = String(body.selectedQuestion || analysis.interpretation || body.topic || "").trim();
      if ((!answered.condition && !analysis.condition) || (!answered.intervention && !analysis.intervention)) {
        if (textToExtract) {
          const recovered = extractPicoFromQuestion(textToExtract, String(body.topic || ""));
          if (!answered.condition && !analysis.condition) {
            analysis.condition = recovered.condition;
            answered.condition = recovered.condition;
          }
          if (!answered.intervention && !analysis.intervention) {
            analysis.intervention = recovered.intervention;
            answered.intervention = recovered.intervention;
          }
          if (!answered.comparator && !analysis.comparator) {
            analysis.comparator = recovered.comparator;
            answered.comparator = recovered.comparator;
          }
          if (!analysis.specialty) {
            analysis.specialty = recovered.specialty;
          }
        }
      }

      if (KEY && analysis?.specialty && isSpecialty(analysis.specialty)) {
        const outcomeLogic = rationalOutcomes(answered.condition || analysis.condition || "", analysis.specialty);
        const out = await callLLM(
          `You are a clinical question formulation engine for evidence-based medicine in Obstetrics and Gynecology.
Using the analysis and clarified answers, produce:
- framework: the question framework name
- elements: array of {label, value} for each framework element (PICO/PICOT/PECO/diagnostic)
- finalQuestion: ONE polished, answerable clinical question sentence (the recommended default)
- variants: EXACTLY 4 alternative formulations of the question, each {question, rationale} where rationale (one short sentence) explains the different clinical angle — vary by primary outcome, population detail, or comparator. Variant 1 may equal finalQuestion.
- scores: array of {name, value} scoring each element 0-20 plus Specificity (max total = number of items x 20). Score the outcome element HIGHEST (18-20) when it matches the recommended primary outcome.
- advisories: array of short warnings; if the selected outcome is not the most patient-centered for the condition, flag it and recommend "${outcomeLogic.primary}" (rationale: ${outcomeLogic.rationale}).
- searchTerms: {population, intervention, outcome} optimized for PubMed searching.
Respond ONLY with JSON.`,
          { analysis, answered, specialtyKnowledge: analysis.specialty ? KB[analysis.specialty] : null, outcomeLogic }
        );
        return NextResponse.json({ ...out, source: "ai", complete: true, missingElements: [] });
      }
      return formulated(ruleFormulate(analysis, answered));
    }

    return NextResponse.json({ error: "Unknown stage" }, { status: 400 });
  } catch (e) {
    // Never swallow this silently: an unexplained 503 is impossible to diagnose in production.
    console.error(`[engine] stage "${stage}" failed:`, e);
    // The rule-based fallbacks run *inside* this catch, so a failure in a fallback used to
    // escape it entirely and surface as a bare HTTP 500 with a zero-byte body: no message for the
    // user and nothing for alerting to read. Each fallback is now guarded on its own and
    // degrades to the same structured 503, so a double failure is reported honestly instead of
    // crashing the request.
    if (stage === "intent") {
      try {
        return NextResponse.json(ruleAnalyze(typeof body.input === "string" ? body.input : ""));
      } catch (fallbackError) {
        console.error(`[engine] rule fallback for "intent" also failed:`, fallbackError);
      }
    }
    if (stage === "gap") {
      try {
        const topic = typeof body.input === "string" ? body.input : "";
        const fallback = generateDeterministicGapAnalysis(topic);
        return NextResponse.json({
          ...fallback,
          topic,
          source: "deterministic",
          known: fallback.known.map(k => ({ point: k.point, references: [] })),
          uncertain: fallback.uncertain.map(u => ({ point: u.point, references: [] }))
        });
      } catch (fallbackError) {
        console.error(`[engine] rule fallback for "gap" also failed:`, fallbackError);
      }
    }
    if (stage === "clarify" || stage === "formulate") {
      const analysis = body.analysis;
      if (analysis && typeof analysis === "object" && !Array.isArray(analysis)) {
        try {
          const answered =
            body.answered && typeof body.answered === "object" && !Array.isArray(body.answered)
              ? (body.answered as Record<string, string>)
              : {};
          return stage === "clarify"
            ? NextResponse.json(ruleClarify(analysis as Analysis, answered))
            : formulated(ruleFormulate(analysis as Analysis, answered));
        } catch (fallbackError) {
          console.error(`[engine] rule fallback for "${stage}" also failed:`, fallbackError);
        }
      }
    }
    return NextResponse.json(
      { error: "The AI service is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}
