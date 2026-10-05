import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SingleFlight, TtlLruCache } from "@/lib/pubmed-cache";
import { buildCacheKey, buildCandidates, type ClinicalSearchInput } from "@/lib/pubmed-query";

// Candidate fallback plus rate-limit backoff can legitimately take longer than one probe.
export const maxDuration = 60;

interface PubMedResult {
  pmid: string;
  title: string;
  journal: string;
  year: string;
  authors: string;
  doi?: string;
  url: string;
}

interface ESummaryDoc {
  title?: string;
  sortfirstauthor?: string;
  pubdate?: string;
  fulljournalname?: string;
  source?: string;
  elocationid?: string;
}

interface SearchPayload {
  results: PubMedResult[];
  term: string;
}

const API_TIMEOUT_MS = 12_000;
const EURETS_REVALIDATE_SECONDS = 3600;
// NCBI allows 3 requests/second without an api_key, or 10 requests/second with one.
// Exceeding it returns 429, and a single throttled call previously surfaced as a generic "search failed".
const NCBI_API_KEY = process.env.NCBI_API_KEY || process.env.PUBMED_API_KEY || "";
const NCBI_MIN_INTERVAL_MS = NCBI_API_KEY ? 100 : 400;

// Entry caps, not just TTLs: clinician free text yields unbounded distinct queries, so an
// unbounded cache would trade an NCBI rate-limit problem for a server memory leak.
const SEARCH_CACHE_MAX = 200;
const SUMMARY_CACHE_MAX = 500;
// Search hits shift over months as literature is published, but a repeated identical query
// inside one evidence-gap session must not re-bill the same upstream lookup on every render.
const SEARCH_TTL_MS = 60 * 60 * 1000;
// ESummary records for a published PMID are effectively immutable, so a day-long TTL is safe.
const SUMMARY_TTL_MS = 24 * 60 * 60 * 1000;

const searchCache = new TtlLruCache<SearchPayload>(SEARCH_CACHE_MAX, SEARCH_TTL_MS);
const summaryCache = new TtlLruCache<ESummaryDoc>(SUMMARY_CACHE_MAX, SUMMARY_TTL_MS);
const searchFlight = new SingleFlight<string, SearchPayload>();

let lastEutilsAt = 0;

async function throttleEutils() {
  const wait = lastEutilsAt + NCBI_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastEutilsAt = Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function eutilsFetch(url: string, attempts = 4): Promise<Response> {
  let lastStatus = 0;
  // The key rides in the query string (E-utilities has no header auth), so this URL must never
  // be logged, cached, or surfaced in an error message.
  const apiKeyParam = NCBI_API_KEY ? `&api_key=${encodeURIComponent(NCBI_API_KEY)}` : "";
  const finalUrl = url.includes("?") ? `${url}${apiKeyParam}` : `${url}?${apiKeyParam.slice(1)}`;
  // Next's shared data cache is keyed by URL and persists to disk, so a credentialed URL would
  // end up written into .next/cache/fetch-cache. Keyed traffic therefore bypasses that cache and
  // relies on the in-memory caches below, which store results rather than request URLs.
  const cacheOptions: RequestInit = NCBI_API_KEY ? {} : { next: { revalidate: EURETS_REVALIDATE_SECONDS } };
  for (let attempt = 0; attempt < attempts; attempt++) {
    await throttleEutils();
    const res = await fetch(finalUrl, {
      ...cacheOptions,
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (res.status === 429 || res.status === 503) {
      lastStatus = res.status;
      // Never sleep after the final attempt.
      if (attempt < attempts - 1) {
        const ra = Number(res.headers.get("retry-after"));
        // Jitter matters here: several concurrent candidates all throttled by NCBI would
        // otherwise retry in lockstep and re-create the burst that caused the 429.
        const backoff = 1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10_000) : backoff);
      }
      continue;
    }
    return res;
  }
  throw new Error(`E-utilities throttled (${lastStatus})`);
}

async function fetchEsearchIds(candidate: string): Promise<string[]> {
  const esearch = await eutilsFetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=10&sort=relevance&term=${encodeURIComponent(candidate)}`
  );
  if (!esearch.ok) throw new Error(`esearch ${esearch.status}`);
  const parsed = (await esearch.json()) as { esearchresult?: { idlist?: string[] } };
  return parsed?.esearchresult?.idlist || [];
}

/** ESummary for ids not already cached. Summaries are cached per PMID so a partially cached
 *  result set only pays for the records it is missing. */
async function fetchSummaries(ids: string[]): Promise<Map<string, ESummaryDoc>> {
  const docs = new Map<string, ESummaryDoc>();
  const missing: string[] = [];
  for (const id of ids) {
    const hit = summaryCache.get(id);
    if (hit) docs.set(id, hit);
    else missing.push(id);
  }
  if (!missing.length) return docs;

  const esummary = await eutilsFetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${missing.join(",")}`
  );
  if (!esummary.ok) throw new Error(`esummary ${esummary.status}`);
  const data = (await esummary.json()) as { result?: Record<string, ESummaryDoc> };
  for (const id of missing) {
    const doc = data?.result?.[id];
    if (doc) {
      summaryCache.set(id, doc);
      docs.set(id, doc);
    }
  }
  return docs;
}

function toPubMedResult(id: string, doc: ESummaryDoc | undefined): PubMedResult | null {
  const title = (doc?.title || "").trim();
  // Some ESummary records carry no title; skip them instead of emitting a placeholder.
  if (!title) return null;
  return {
    pmid: id,
    title,
    journal: doc?.fulljournalname || doc?.source || "",
    year: doc?.pubdate?.slice(0, 4) || "",
    authors: doc?.sortfirstauthor || "",
    doi: doc?.elocationid?.replace("doi: ", "") || undefined,
    url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
  };
}

async function runSearch(input: ClinicalSearchInput): Promise<SearchPayload> {
  const candidates = buildCandidates(input);
  for (const candidate of candidates) {
    const ids = await fetchEsearchIds(candidate);
    if (!ids.length) continue;
    const docs = await fetchSummaries(ids);
    const results = ids
      .map(id => toPubMedResult(id, docs.get(id)))
      .filter((r): r is PubMedResult => r !== null);
    // Every record was malformed; treat the rung as a miss so the next candidate can still answer.
    if (!results.length) continue;
    return { results, term: candidate };
  }
  return { results: [], term: candidates[0] || "" };
}

const pubmedSchema = z.object({
  population: z.string().max(500).optional().nullable(),
  outcome: z.string().max(500).optional().nullable(),
  intervention: z.string().max(500).optional().nullable(),
  comparator: z.string().max(500).optional().nullable(),
});

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    // Every error path here used to answer 200, so monitoring and uptime checks saw a
    // permanently healthy endpoint. The client reads `error` from the body either way, so
    // these statuses make the failures observable without changing what the UI renders.
    return NextResponse.json({ results: [], error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = pubmedSchema.safeParse(json);
  if (!parseResult.success) {
    return NextResponse.json(
      { results: [], error: "Invalid parameters: " + parseResult.error.issues.map(e => e.message).join(", ") },
      { status: 400 }
    );
  }

  const body = parseResult.data;
  const input: ClinicalSearchInput = {
    population: body.population,
    outcome: body.outcome,
    intervention: body.intervention,
    comparator: body.comparator
  };

  if (!buildCandidates(input).length) {
    return NextResponse.json({ results: [], error: "Provide at least one search term." }, { status: 400 });
  }

  const cacheKey = buildCacheKey(input);
  try {
    const cached = searchCache.get(cacheKey);
    if (cached) return NextResponse.json({ ...cached, cached: true });

    // Single-flight keyed on the same key as the cache: a burst of identical requests that all
    // missed at once shares one upstream ladder instead of one ladder per request.
    const payload = await searchFlight.run(cacheKey, async () => {
      const raced = searchCache.get(cacheKey);
      if (raced) return raced;
      const fresh = await runSearch(input);
      // A zero-hit outcome is not cached. NCBI outages and partial outages surface as empty
      // results, and caching that would make one bad minute read as "no evidence exists" for an hour.
      if (fresh.results.length) searchCache.set(cacheKey, fresh);
      return fresh;
    });
    return NextResponse.json({ ...payload, cached: false });
  } catch (e) {
    // The error object only, never the request URL: that URL carries the NCBI API key.
    console.error("[pubmed] search failed:", e);
    // 502: the request was well formed, the upstream dependency was not reachable. Reporting
    // this as 200 told callers the search succeeded and returned zero results, which reads as
    // "no evidence exists" rather than "the search could not run" - a distinction that matters
    // a great deal in an evidence-synthesis tool.
    return NextResponse.json({ results: [], error: "PubMed search failed" }, { status: 502 });
  }
}