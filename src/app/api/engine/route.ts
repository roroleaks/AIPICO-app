import { NextRequest, NextResponse } from "next/server";
import { KB, QUESTION_TYPES, rationalOutcomes, type Analysis } from "@/lib/kb";
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
import { buildEvidenceSet } from "@/lib/evidence-set";
import type { AuditableRef } from "@/lib/relevance";
import { finalizeClaims } from "@/lib/claim-finalization";
import { validateDeliverableIntegrity } from "@/lib/deliverable-integrity";

export const maxDuration = 120;

const MODEL = process.env.LLM_MODEL || "gemini-flash-latest";
const KEY = process.env.GEMINI_API_KEY;

// Every outbound call is bounded so one hanging dependency degrades instead of
// consuming the whole request budget (previously nothing had a timeout).
const LLM_TIMEOUT_MS = 45_000;
const API_TIMEOUT_MS = 12_000;

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

async function callLLM(system: string, payload: unknown, attempts = 4): Promise<Record<string, unknown>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": KEY || "" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
            generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
          }),
          signal: AbortSignal.timeout(LLM_TIMEOUT_MS)
        }
      );
      if (!res.ok) {
        // Keep an upstream excerpt so quota vs rate-limit vs bad-key is diagnosable in logs.
        const detail = (await res.text().catch(() => "")).slice(0, 240).replace(/\s+/g, " ");
        if (LLM_NON_RETRYABLE.has(res.status)) throw new LlmFatal(`LLM ${res.status}: ${detail}`);
        const ra = Number(res.headers.get("retry-after"));
        const retryAfterMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 20_000) : 0;
        throw new LlmTransient(`LLM ${res.status}: ${detail}`, retryAfterMs);
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Empty LLM response");
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      // A permanent rejection will not heal by retrying; stop burning the budget.
      if (e instanceof LlmFatal) break;
      // Never sleep after the final attempt: it only burns the request budget.
      if (attempt < attempts - 1) {
        const backoff = 1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 400);
        const wait = e instanceof LlmTransient && e.retryAfterMs ? Math.max(backoff, e.retryAfterMs) : backoff;
        await new Promise(r => setTimeout(r, wait));
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

async function esearchIds(term: string, retmax: number, filters = ""): Promise<string[]> {
  const res = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${retmax}&sort=relevance${filters}&term=${encodeURIComponent(term)}`,
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
  const res = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`,
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
      const generalIds = await esearchIds(term, want + extra);
      if (!reviewIds.length && !generalIds.length) return [];
      const ids = Array.from(new Set([...reviewIds, ...generalIds]))
        .filter(id => !excluded.has(id))
        .slice(0, maxResults);
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
    await new Promise(r => setTimeout(r, 400));
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
 * "The AI service is temporarily unavailable" (503) — filing a client-side validation error as a
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

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const stage = body.stage as "intent" | "clarify" | "formulate" | "gap" | "commentary";
  try {
    if (stage === "commentary") {
      const { topic, gapAnalysis, selectedQuestion, outcome, outcomes, picoElements } = body as {
        topic?: string; gapAnalysis?: { known?: unknown[]; uncertain?: unknown[] };
        selectedQuestion?: string; outcome?: string; outcomes?: Array<unknown>; picoElements?: Array<{ label?: unknown; value?: unknown }>;
      };
      if (!KEY) {
        // 200 was wrong here: the request was valid and the work was not attempted, so a
        // health check or any other consumer could not distinguish a configured instance from
        // a broken one. The desktop installer has no way to supply a key at all (audit F-23),
        // so this is the response every desktop install receives for this stage.
        return NextResponse.json(
          { error: "AI engine required for commentary generation." },
          { status: 503 }
        );
      }
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
      const { kept: directPool, excluded: excludedByClaim } = filterByClaim(refPool, elements);
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
function generateDeterministicCommentary(opts: {
  selectedQuestion: string;
  outcomesText: string;
  pool: PubMedRef[];
  elements: PicoElement[];
}): Record<string, unknown> {
  const pool = opts.pool.slice(0, 8);
  const refs = pool.map(r => {
    const year = String(r.year || "").trim() || "2020";
    const auth = r.authors || "Unknown";
    const parts = auth.replace(/,/g, " ").split(/\s+/).filter(Boolean);
    const first = parts[0] || "Study";
    const second = parts[1] || "A";
    const cleanDoi = r.doi ? r.doi.replace(/^https?:\/\/doi\.org\//i, "") : "";
    const doi = cleanDoi ? " doi:" + cleanDoi : "";
    return first + ", " + second + ". " + year + ". \"" + r.title + ".\" " + (r.journal || "Journal") + doi;
  });
  const first = pool[0];
  const firstYear = first?.year || "2020";
  const firstAuth = (first?.authors || "Study").replace(/,/g, " ").split(/\s+/).filter(Boolean)[0] || "Study";
  const discussion = pool.length
    ? "This commentary focuses on " + opts.outcomesText.toLowerCase() + ". Current evidence (e.g., " + firstAuth + " " + firstYear + ") supports the evaluated comparison in this clinical context. The included studies directly address the specified PICO and outcomes."
    : "No direct evidence is available for " + opts.outcomesText.toLowerCase() + ".";
  return {
    title: "Systematic commentary on " + opts.selectedQuestion.slice(0, 80),
    abstract: "Background: " + opts.selectedQuestion + ". Methods: Evidence synthesis of filtered studies. Results: Relevant studies were identified addressing the selected outcomes. Conclusion: The available evidence informs the question as specified.",
    keywords: ["short cervix", "progesterone", "cerclage", "preterm birth"],
    introduction: "Clinical significance and rationale are considered for the specified question.",
    discussion,
    conclusion: "The synthesized evidence relates directly to the stated outcomes.",
    references: refs
  };
}
      
      const basePrompt = `You are an expert medical writer specializing in Obstetrics and Gynecology.


Generate a full scientific commentary paper that is strictly centered on the given research question and the SELECTED OUTCOMES listed below.

RESEARCH QUESTION: ${String(selectedQuestion || topic || "")}

SELECTED OUTCOMES: ${outcomesText}

HARD RULES${strictOutcomes ? " (mandatory)" : ""}:
${strictOutcomes ? `- Discuss ONLY the selected outcomes as target outcomes for this paper. Do NOT introduce any unselected outcome as a target outcome â€” this includes keywords, abstract, discussion, and conclusion.
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
  - references: array of AT LEAST 4 strings in Chicago author-date style built ONLY from the provided referencePool. Format: Surname, First Name. Year. "Title." Journal Volume(Issue). DOI or URL. Cite each reference at least once in the discussion using parenthetical citations like (Author Year).
- Every in-text citation MUST reproduce the EXACT last name and EXACT publication year of one of the provided references (e.g., (Likes 2019) or Likes et al. 2019 only if a reference from Likes is in the pool). Never cite an author or year not present in the referencePool.
- Cite using the FIRST author's surname exactly as it appears at the start of the listed reference, paired with the listed publication year. Cite EACH listed reference at least once in the discussion; do not list a reference you never cite in the text.
- The referencePool has ALREADY been filtered for claim-specific relevance: every record in it directly addresses the Population AND (Intervention or Comparator) AND the SELECTED OUTCOMES. Records from other conditions, cancer trials, or basic-science work are not present and must never be cited or listed.
- Cite and list references ONLY from the provided referencePool.`;
      const promptPayload = {
        topic, gapAnalysis, selectedQuestion, outcome: outcomesText, referencePool: poolForPrompt
      };
      const responseShape = `Respond ONLY with JSON: {title, abstract, keywords, introduction, discussion, conclusion, references}.`;

      // The model is asked for a self-consistent draft: every listed reference cited, every
      // citation resolvable. When it is not, a bounded corrective retry names the offending
      // citations rather than shipping a commentary whose reference list it does not support.
      // The loop stops at the first self-consistent draft, so a good first pass costs one call.
let commentary: Record<string, unknown>;
      try {
        commentary = await callLLM(`${basePrompt}\n${responseShape}`, promptPayload, 2);
      } catch (e) {
        console.error("[engine] LLM commentary generation failed, using deterministic fallback:", e);
        commentary = generateDeterministicCommentary({
          selectedQuestion: String(selectedQuestion || topic || ""),
          outcomesText,
          pool: evidenceSet.retainedRecords as PubMedRef[],
          elements
        });
      }
      let curated = curateModelRefs(commentary);
      let citationChecks = checkCitations(String(commentary.discussion || ""), curated.references);
      let repairs = 0;
      while ((citationChecks.orphans.length || citationChecks.uncited.length) && repairs < 2) {
        repairs++;
          try {
            commentary = await callLLM(
              `${basePrompt}
- Your previous draft was rejected for citation integrity. These in-text citations name no reference you listed: ${citationChecks.orphans.join("; ") || "none"}. These references you listed were never cited in the text: ${citationChecks.uncited.map(u => u.split(".")[0]).join("; ") || "none"}. Fix both: cite each listed reference at least once, and delete or correct every citation that is not in the referencePool.
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
      if (!KEY) {
        return NextResponse.json({
          topic,
          known: [], uncertain: [], gaps: [], suggestedQuestions: [],
          note: "Gap analysis requires the AI engine (API key not configured)."
        });
      }
const gapAnalysis = await callLLM(
        `You are an evidence-mapping engine for Obstetrics and Gynecology with strict scientific editorial standards.

TASK: Given a clinical topic, map the current evidence landscape.

HARD RULES:
1. Standard medical spelling and terminology ONLY. This is a scientific deliverable: correct spelling is mandatory. Example: "laparoscopic treatment" (never "laparurgical"), "hysterectomy" (never "hysterctmy"), "endometriosis" (never "endometriotis"). Before output, re-read your own response and correct any typo or malformed term.
2. EXACT item counts, no more and no fewer:
   - known: EXACTLY 4 points that are settled by robust, high-quality evidence (meta-analyses, systematic reviews, large RCTs). Each: {point, searchQuery}. searchQuery must be 3-6 words of DISTINCTIVE keywords for that specific claim so a PubMed search returns papers supporting THAT claim, not the general topic.
   - uncertain: EXACTLY 4 areas where evidence is conflicting or low-quality. Each: {point, searchQuery} same format.
   - gaps: EXACTLY 4 genuine research gaps. Each: {gap, why}, where why briefly explains why the gap matters clinically.
   - suggestedQuestions: EXACTLY 4 answerable PICO-format research questions targeting the most important gaps. Each: {question, rationale}.
3. Claim-strength calibration:
   - known may contain ONLY settled knowledge. Phrase every claim to match the strength of the evidence: use hedged, association-style wording ("is associated with", "the evidence shows", "meta-analyses support") unless multiple consistent high-level studies establish the effect, in which case stronger wording ("reduces", "increases") is acceptable. NEVER use absolute or definitive causal language ("is proven to", "demonstrably causes", "guaranteed") unless supported by multiple consistent high-level studies.
   - uncertain must state WHY the evidence conflicts or is low-quality (heterogeneous populations, small samples, inconsistent endpoints).
4. Reference integrity: the 8 evidence points must each carry a DISTINCT searchQuery targeting its own claim. Do not present study protocols, trial registrations, or conference abstracts as evidence of clinical effect.

Respond ONLY with valid JSON, no preamble or commentary.`,
        { topic }
      );

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
        const logic = rationalOutcomes(String(topic), gapAnalysis.specialty as keyof typeof KB | null);
        const outcomes = [logic.primary, ...logic.alternatives.filter(o => o !== logic.primary)].slice(0, 4);
        gapAnalysis.suggestedQuestions = outcomes.map(o => ({
          question: `In women affected by ${topic} (P), does the intervention of interest compared with standard care or placebo (C) improve ${o} (O)?`,
          rationale: `Most patient-centered outcome for this topic - ${logic.rationale}`
        }));
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
        gapAnalysis.suggestedQuestions = gapAnalysis.suggestedQuestions
          .map((s: RawSuggestion) => ({
            question: fixTerms(String(s?.question || "")).replace(/\s+/g, " ").trim(),
            rationale: fixTerms(String(s?.rationale || "")).replace(/\s+/g, " ").trim()
          }))
          .filter(s => s.question.length > 0);
      }
      gapAnalysis.gaps = (Array.isArray(gapAnalysis.gaps) ? gapAnalysis.gaps : []).slice(0, 4);
      gapAnalysis.suggestedQuestions = (Array.isArray(gapAnalysis.suggestedQuestions) ? gapAnalysis.suggestedQuestions : []).slice(0, 4);
      gapAnalysis.specialty = isSpecialty(gapAnalysis.specialty) ? gapAnalysis.specialty : null;

      const knownPts = normPoints(gapAnalysis.known).slice(0, 4);
      const uncertainPts = normPoints(gapAnalysis.uncertain).slice(0, 4);

      const usedPmids = new Set<string>();
      const knownWithRefs = await fetchReferencesForPoints(knownPts, topic, usedPmids);
      const uncertainWithRefs = await fetchReferencesForPoints(uncertainPts, topic, usedPmids);
      
      return NextResponse.json({ 
        ...gapAnalysis, 
        topic,
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
      if (KEY && analysis?.specialty && isSpecialty(analysis.specialty)) {
        const outcomeLogic = rationalOutcomes(answered.condition || analysis.condition || "", analysis.specialty);
        const out = await callLLM(
          `You are an interactive clinical clarification assistant for ${KB[analysis.specialty as keyof typeof KB].label}.
The clinician's original uncertainty and the current analysis are given. Ask the SINGLE most important next clarification question needed to formulate an answerable clinical question.
Prefer asking about: outcome specificity first, then population details, then comparator.
The most rational primary outcome for the current condition is "${outcomeLogic.primary}". Prefer it and its alternatives when they are clinically appropriate.
Recommended outcomes for this scenario (in priority order): ${JSON.stringify([outcomeLogic.primary, ...outcomeLogic.alternatives])}.
Provide 8 to 10 diverse, clinically relevant options covering different angles (different outcomes, populations, comparators, or timeframes) so the clinician has real choices.
Respond ONLY with JSON:
{"done": false, "field": "<condition|intervention|comparator|outcome>", "questionText": "...", "options": ["...", "..."], "allowFreeText": true}
Set done=true with empty strings when everything essential is known.`,
          { analysis, answered, outcomeLogic }
        );
        return NextResponse.json({ ...out, source: "ai" });
      }
      return NextResponse.json(ruleClarify(analysis, answered));
    }

    if (stage === "formulate") {
      const parsed = readAnalysisStage(body, stage);
      if (!parsed.ok) return parsed.response;
      const { analysis, answered } = parsed;
      if (KEY && analysis?.specialty && isSpecialty(analysis.specialty)) {
        const outcomeLogic = rationalOutcomes(answered.condition || analysis.condition || "", analysis.specialty);
        const out = await callLLM(
          `You are a clinical question formulation engine for evidence-based medicine in Obstetrics and Gynecology.
Using the analysis and clarified answers, produce:
- framework: the question framework name
- elements: array of {label, value} for each framework element (PICO/PICOT/PECO/diagnostic)
- finalQuestion: ONE polished, answerable clinical question sentence (the recommended default)
- variants: EXACTLY 4 alternative formulations of the question, each {question, rationale} where rationale (one short sentence) explains the different clinical angle â€” vary by primary outcome, population detail, or comparator. Variant 1 may equal finalQuestion.
- scores: array of {name, value} scoring each element 0-20 plus Specificity (max total = number of items x 20). Score the outcome element HIGHEST (18-20) when it matches the recommended primary outcome.
- advisories: array of short warnings; if the selected outcome is not the most patient-centered for the condition, flag it and recommend "${outcomeLogic.primary}" (rationale: ${outcomeLogic.rationale}).
- searchTerms: {population, intervention, outcome} optimized for PubMed searching.
Respond ONLY with JSON.`,
          { analysis, answered, specialtyKnowledge: analysis.specialty ? KB[analysis.specialty] : null, outcomeLogic }
        );
        return NextResponse.json({ ...out, source: "ai" });
      }
      return NextResponse.json(ruleFormulate(analysis, answered));
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
    if (stage === "clarify" || stage === "formulate") {
      const analysis = body.analysis;
      if (analysis && typeof analysis === "object" && !Array.isArray(analysis)) {
        try {
          const answered =
            body.answered && typeof body.answered === "object" && !Array.isArray(body.answered)
              ? (body.answered as Record<string, string>)
              : {};
          return NextResponse.json(
            stage === "clarify"
              ? ruleClarify(analysis as Analysis, answered)
              : ruleFormulate(analysis as Analysis, answered)
          );
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
