import { NextRequest, NextResponse } from "next/server";

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

const API_TIMEOUT_MS = 12_000;
// NCBI allows 3 requests/second without an api_key. Exceeding it returns 429, and a single
// throttled call previously surfaced as a generic "search failed" to the user.
const NCBI_MIN_INTERVAL_MS = 400;
let lastEutilsAt = 0;

async function throttleEutils() {
  const wait = lastEutilsAt + NCBI_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastEutilsAt = Date.now();
}

async function eutilsFetch(url: string, attempts = 4): Promise<Response> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await throttleEutils();
    const res = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    if (res.status === 429 || res.status === 503) {
      lastStatus = res.status;
      // Never sleep after the final attempt.
      if (attempt < attempts - 1) {
        const ra = Number(res.headers.get("retry-after"));
        const backoff = 1500 * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10_000) : backoff));
      }
      continue;
    }
    return res;
  }
  throw new Error(`E-utilities throttled (${lastStatus})`);
}

// Clinician free text goes straight into an E-utilities query, so PubMed operators and
// field tags are stripped and multi-word phrases are quoted. Without this a stray
// parenthesis or quote produces a malformed query and a generic "search failed".
function toPhrase(v: string | undefined): string {
  if (!v) return "";
  const cleaned = v
    .replace(/["()[\]]/g, " ")
    .replace(/\b(AND|OR|NOT)\b/gi, " ")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (!cleaned) return "";
  return cleaned.includes(" ") ? `"${cleaned}"` : cleaned;
}

export async function POST(req: NextRequest) {
  let body: Record<string, string | undefined>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ results: [], error: "Invalid JSON body" });
  }
  const population = toPhrase(body.population);
  const outcome = toPhrase(body.outcome);
  const interventionPhrase = toPhrase(body.intervention);
  const comparatorPhrase = toPhrase(body.comparator);
  const interventionClause = interventionPhrase
    ? `(${interventionPhrase}[tiab]${comparatorPhrase ? ` OR ${comparatorPhrase}[tiab]` : ""})`
    : "";
  const strictTerm = [
    population && `(${population})`,
    interventionClause,
    outcome && `(${outcome})`
  ].filter(Boolean).join(" AND ");
  const candidates = [
    strictTerm,
    [population && `(${population})`, interventionClause].filter(Boolean).join(" AND "),
    [interventionClause, outcome && `(${outcome})`].filter(Boolean).join(" AND "),
    interventionClause || population || outcome || strictTerm,
    outcome || population || strictTerm
  ].filter(Boolean).filter((t, i, a) => a.indexOf(t) === i);

  if (!candidates.length) return NextResponse.json({ results: [], error: "Provide at least one search term." });

  try {
    let term = strictTerm;
    let ids: string[] = [];
    for (let ci = 0; ci < candidates.length; ci++) {
      const candidate = candidates[ci];
      const esearch = await eutilsFetch(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=10&sort=relevance&term=${encodeURIComponent(candidate)}`
      );
      if (!esearch.ok) throw new Error(`esearch ${esearch.status}`);
      ids = (await esearch.json())?.esearchresult?.idlist || [];
      if (ids.length) { term = candidate; break; }
    }
    if (!ids.length) return NextResponse.json({ results: [], term });

    const esummary = await eutilsFetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`
    );
    if (!esummary.ok) throw new Error(`esummary ${esummary.status}`);
    const data = await esummary.json();
    const result: Record<string, ESummaryDoc> = data?.result || {};
    const results: PubMedResult[] = ids
      .map((id: string) => {
        const doc = result?.[id];
        return {
          pmid: id,
          // Some ESummary records carry no title; skip them instead of emitting a placeholder.
          title: (doc?.title || "").trim(),
          journal: doc?.fulljournalname || doc?.source || "",
          year: doc?.pubdate?.slice(0, 4) || "",
          authors: doc?.sortfirstauthor || "",
          doi: doc?.elocationid?.replace("doi: ", "") || undefined,
          url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
        };
      })
      .filter(r => r.title.length > 0);
    return NextResponse.json({ results, term });
  } catch (e) {
    console.error("[pubmed] search failed:", e);
    return NextResponse.json({ results: [], error: "PubMed search failed" });
  }
}