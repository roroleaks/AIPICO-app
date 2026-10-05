/**
 * Claim-specific reference relevance.
 *
 * This module is the single filtering boundary between retrieved literature and everything
 * downstream: the reference pool handed to the commentary generator, the reference list the
 * user sees, the citation/reference integrity check, and every export.
 *
 * It is deliberately dependency-free so the filter can be unit tested against a fixed
 * fixture (see relevance.test.ts). The engine route imports these functions directly, so the
 * tested behaviour and the shipped behaviour cannot drift apart.
 */

export interface PicoElement { label: string; value: string }

export interface AuditableRef {
  /** PubMed identifier. Absent for records that only a DOI or another provider knows about. */
  pmid?: string;
  title: string;
  authors?: string;
  year?: string;
  journal?: string;
  doi?: string;
  url?: string;
  context?: string;
  source?: string;
  /** Provider identifiers, kept so cross-provider deduplication can compare provenance. */
  crossrefId?: string;
  openAlexId?: string;
}

export interface MetadataCompleteness {
  hasAbstract: boolean;
  hasKeywords: boolean;
  hasDoi: boolean;
  hasPmid: boolean;
  hasOpenAlexId: boolean;
  confidence: "high" | "moderate" | "low";
}

export interface RefAudit {
  pmid: string;
  title: string;
  url: string;
  resolved: boolean;
  doiOk: boolean;
  design: string;
  population: boolean;
  intervention: boolean;
  comparator: boolean;
  outcome: boolean;
  score: number;
  metadataCompleteness?: MetadataCompleteness;
}

export interface CitationChecks {
  totalRefs: number;
  citedRefs: number;
  uncited: string[];
  orphans: string[];
  consistent: boolean;
}

const STOPWORDS = new Set([
  "and", "or", "not", "the", "a", "an", "of", "in", "on", "with", "for", "to",
  "is", "are", "as", "by", "at", "from"
]);

/** Clinical wording that should not break token matching. */
const SYNONYM_FIXES: Array<[RegExp, string]> = [
  [/\bin.?vitro fertiliz?ation(?: \/ ?ivf)?\b/gi, "ivf"],
  [/\bivf\b/g, "ivf"],
  [/\bpremature\b/g, "preterm"],
  [/\bpreterm\b/g, "preterm"],
  [/\bpregnancy loss|miscarriage\b/gi, "pregnancy loss"],
  [/\bcesarean|caesarean|c.?section\b/gi, "cesarean"],
  [/\bintrauterine\b/g, "intrauterine"],
  [/\blevonorgestrel.?releasing intrauterine system\b/gi, "lng ius"],
  [/\btranexamic\b/g, "tranexamic"],
  [/\bantifibrinolytic\b/g, "tranexamic"]
];

export function synonymize(s: string): string {
  let t = s.toLowerCase();
  for (const [re, fix] of SYNONYM_FIXES) t = t.replace(re, fix);
  return t;
}

/** Meaningful lowercase tokens, with clinical synonyms collapsed. */
export function sigTokens(s: string): string[] {
  return synonymize(s)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

/** PICO element labels are free text, so each is classified by its label wording. */
const ELEMENT_TYPE_RULES: Array<{
  type: "population" | "intervention" | "comparator" | "outcome";
  labelRe: RegExp;
}> = [
  { type: "population", labelRe: /population|patient|participants?|subjects?|women|neonates?|pregnant|people|adult/ },
  { type: "intervention", labelRe: /intervention|treatment|exposure|therapy|test|procedure|drug|dose|surgery|agent|device/ },
  { type: "comparator", labelRe: /comparator|comparison|control|placebo|sham|standard care|usual care|alternative/ },
  { type: "outcome", labelRe: /outcome|endpoint|result|efficacy|effectiveness|accuracy|impact|prognos/ }
];

export function elementByType(
  elements: PicoElement[]
): Partial<Record<"population" | "intervention" | "comparator" | "outcome", PicoElement>> {
  const assigned: Partial<Record<"population" | "intervention" | "comparator" | "outcome", PicoElement>> = {};
  const used = new Set<string>();
  for (const rule of ELEMENT_TYPE_RULES) {
    const el = elements.find(e => !used.has(e.label) && rule.labelRe.test(e.label.toLowerCase()));
    if (el && !assigned[rule.type]) {
      assigned[rule.type] = el;
      used.add(el.label);
    }
  }
  const order: Array<"population" | "intervention" | "comparator" | "outcome"> =
    ["population", "intervention", "comparator", "outcome"];
  for (const t of order) {
    if (assigned[t]) continue;
    const el = elements.find(e => !used.has(e.label));
    if (el) {
      assigned[t] = el;
      used.add(el.label);
    }
  }
  return assigned;
}

export function designOf(title: string, journal: string): string {
  if (/meta-analys|systematic review/i.test(`${title} ${journal}`)) return "systematic review / meta-analysis";
  if (/randomi[sz]ed/i.test(title)) return "randomized trial";
  if (/\btrials?\b/i.test(title)) return "clinical trial";
  if (/cohort/i.test(title)) return "cohort study";
  if (/review/i.test(title)) return "narrative review";
  return "unclassified";
}

/**
 * Cues that turn a nearby mention into the opposite of a match.
 *
 * Without this, a record reading "cervical length in women with a short cervix, with no
 * progesterone and no cerclage" was credited with both treatments, because the tokens were
 * present. Presence of a word is not evidence that the record used it.
 */
const NEGATION_CUE = /\b(no|not|without|never|absence of|lack of|rather than|instead of|none)\b/;
const CONTRASTIVE = /\b(but|however|although|though|yet|whereas)\b/;

/**
 * Whether a mention immediately after `before` is negated.
 *
 * A contrastive connector overrides the negation: in "not cerclage but progesterone",
 * "progesterone" is asserted even though "not" appears shortly before it.
 */
function isNegated(before: string): boolean {
  const m = NEGATION_CUE.exec(before);
  if (!m) return false;
  if (CONTRASTIVE.test(before.slice(m.index + m[0].length))) return false;
  return true;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A phrase counts only when it occurs somewhere that is not negated. */
function hasUnnegatedPhrase(normCtx: string, phrase: string): boolean {
  const re = new RegExp(`\\b${escapeRe(phrase)}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(normCtx))) {
    if (!isNegated(normCtx.slice(Math.max(0, m.index - 45), m.index))) return true;
  }
  return false;
}

/** A token counts only when it appears somewhere that is not negated. */
function hasUnnegatedMention(normCtx: string, token: string): boolean {
  const re = new RegExp(`\\b${escapeRe(token)}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(normCtx))) {
    if (!isNegated(normCtx.slice(Math.max(0, m.index - 45), m.index))) return true;
  }
  return false;
}

/**
 * Relevance of one record to the selected PICO, one boolean per element.
 *
 * An element matches when the record's title/journal/authors/abstract contains the element's
 * whole phrase, or otherwise corroborates it: for an element made of several significant
 * tokens, at least two of them must be present.
 *
 * Requiring two tokens matters. With one, "short" alone satisfied a population of "pregnant
 * individuals with a short cervix", so any paper whose title merely said "short" or "cervical"
 * passed and unrelated records reached the reference list. Single-token elements (a drug name
 * such as "progesterone") are unaffected, since one token is all they have.
 */
export function auditRef(ref: AuditableRef, elements: PicoElement[]): RefAudit {
  const ctx = `${ref.title} ${ref.journal || ""} ${ref.authors || ""} ${ref.year || ""} ${ref.context || ""}`;
  const byType = elementByType(elements);
  const design = designOf(ref.title || "", ref.journal || "");

  const matchFor = (type: "population" | "intervention" | "comparator" | "outcome"): boolean => {
    const el = byType[type];
    if (!el || !el.value || el.value.replace(/[^a-zA-Z]/g, "").length < 2) return false;
    const toks = sigTokens(el.value);
    if (!toks.length) return false;
    const normCtx = synonymize(ctx).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    const phrase = synonymize(el.value).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    if (phrase.length >= 6 && hasUnnegatedPhrase(normCtx, phrase)) return true;
    const needed = toks.length === 1 ? 1 : 2;
    let hits = 0;
    for (const t of toks) {
      if (!hasUnnegatedMention(normCtx, t)) continue;
      if (++hits >= needed) return true;
    }
    return false;
  };

  const population = matchFor("population");
  const intervention = matchFor("intervention");
  const comparator = matchFor("comparator");
  const outcome = matchFor("outcome");
  const score = [population, intervention, comparator, outcome].filter(Boolean).length;

  // Metadata completeness assessment (confidence)
  const hasAbstract = String(ref.context || "").length > 30;
  const hasKeywords = /\bkeywords?\b/i.test(String(ref.context || "")) || /\bmesh\b/i.test(String(ref.context || ""));
  const hasDoi = !!String(ref.doi || "").trim();
  const hasPmid = !!String(ref.pmid || "").trim() && /^\d+$/.test(String(ref.pmid || ""));
  const hasOpenAlexId = /openalex|oax/i.test(String(ref.pmid || "")) || /openalex/i.test(String(ref.url || ""));
  
  let confidence: "high" | "moderate" | "low" = "low";
  if (hasAbstract && (hasDoi || hasPmid)) {
    confidence = "high";
  } else if (score >= 3 && (hasAbstract || hasDoi || hasPmid)) {
    confidence = "moderate";
  } else if (score >= 2 && (hasDoi || hasPmid || String(ref.title || "").length > 20)) {
    confidence = "moderate";
  } else {
    confidence = "low";
  }

  return {
pmid: ref.pmid || "",
    title: ref.title,
    url: ref.url || "",
    resolved: !!ref.pmid && (/^\d+$/.test(ref.pmid) || /^(pmc|epmc|oax|cr):/.test(ref.pmid)),
    doiOk: /10\.\d{4,}\//.test(String(ref.doi || "")),
    design: design,
    population,
    intervention,
    comparator,
    outcome,
    score,
    metadataCompleteness: {
      hasAbstract,
      hasKeywords,
      hasDoi,
      hasPmid,
      hasOpenAlexId,
      confidence
    }
  };
}

/**
 * Which PICO elements the user actually selected. An element that was not selected, or was
 * left blank, imposes no requirement on a record.
 */
export function selectedElements(
  elements: PicoElement[]
): { population: boolean; intervention: boolean; comparator: boolean; outcome: boolean } {
  const byType = elementByType(elements);
  const has = (t: "population" | "intervention" | "comparator" | "outcome"): boolean => {
    const el = byType[t];
    return !!el && !!String(el.value || "").trim();
  };
  return {
    population: has("population"),
    intervention: has("intervention"),
    comparator: has("comparator"),
    outcome: has("outcome")
  };
}

/**
 * Direct support for the selected claim.
 *
 * The record must address the selected population, must address the treatment question, and
 * must report at least one selected outcome.
 *
 * The treatment test is `intervention || comparator` rather than both, and that is deliberate.
 * A head-to-head record names both arms â€” a cerclage trial abstract says "cerclage versus
 * progesterone" â€” so demanding both tokens separately cannot distinguish "progesterone was
 * given" from "progesterone was the comparator", and would reject exactly the comparative
 * trials the question is asking for. A record that names neither arm fails, and so does a
 * record that matches the population and outcome only.
 *
 * Known limitation: a single-arm study whose text names the other arm only as the alternative
 * under consideration can pass this test. Distinguishing arm role needs structured metadata
 * that the sources do not reliably expose.
 */
export function isDirectSupport(audit: RefAudit, elements: PicoElement[] = []): boolean {
  const sel = selectedElements(elements);
  const needTreatment = sel.intervention || sel.comparator;
  if (needTreatment) return audit.population && (audit.intervention || audit.comparator) && audit.outcome;
  // No treatment element selected: population plus an outcome is all that can be required.
  if (sel.population || sel.outcome) return audit.population && audit.outcome;
  return audit.population && (audit.intervention || audit.comparator) && audit.outcome;
}

/**
 * Metadata-confidence policy for direct support, in one place.
 *
 * High confidence may support a claim. Moderate confidence may support a claim only when every
 * required element of the claim is deterministically matched from the record's own title and
 * metadata, which is the same condition `isDirectSupport` already enforces. Low confidence is
 * never direct support: a record this app cannot resolve to a published paper cannot be the basis
 * of a finding, however well its text happens to match the claim.
 */
export function isDirectSupportEligible(
  ref: AuditableRef,
  elements: PicoElement[] = []
): { eligible: boolean; confidence: "high" | "moderate" | "low"; reason?: string } {
  const audit = auditRef(ref, elements);
  const confidence = audit.metadataCompleteness?.confidence ?? "low";
  // A published reference has to be checkable by the reader. A record with neither a DOI nor a
  // PMID cannot be resolved to a paper, so matching wording is not enough to publish it, however
  // long its title is and however well the text fits the claim.
  const resolvable = !!audit.metadataCompleteness?.hasDoi || !!audit.metadataCompleteness?.hasPmid;
  if (!resolvable) {
    return { eligible: false, confidence, reason: "no direct support: no resolvable identifier" };
  }
  if (confidence === "low") {
    return { eligible: false, confidence, reason: "no direct support: low metadata confidence" };
  }
  if (!isDirectSupport(audit, elements)) {
    return { eligible: false, confidence, reason: "no direct support: claim elements not matched" };
  }
  return { eligible: true, confidence };
}

/**
 * The claim-specific filter applied to a retrieved pool.
 *
 * Returns the retained direct-support records, their audits, and the excluded records with
 * the reason, so callers can report and test what was dropped instead of silently trimming.
 */
export function filterByClaim<T extends AuditableRef>(
  pool: T[],
  elements: PicoElement[]
): { kept: T[]; audits: Map<string, RefAudit>; excluded: Array<{ ref: T; audit: RefAudit; reason: string }> } {
  const audits = new Map<string, RefAudit>();
  const kept: T[] = [];
  const excluded: Array<{ ref: T; audit: RefAudit; reason: string }> = [];
  const sel = selectedElements(elements);

  for (const r of pool) {
    const audit = auditRef(r, elements);
    const key = r.pmid || r.title;
    audits.set(key, audit);
    if (isDirectSupport(audit, elements)) {
      // The confidence threshold is applied through one shared policy function, so the reference
      // list, the audit table and the tests cannot disagree about what counts as direct support.
      const decision = isDirectSupportEligible(r, elements);
      if (!decision.eligible) {
        excluded.push({ ref: r, audit, reason: decision.reason || "no direct support" });
        continue;
      }
      kept.push(r);
    } else {
      // Name the specific selected elements this record failed, so the UI and the tests can
      // say why it was dropped rather than only that it was.
      const missing: string[] = [];
      if (sel.population && !audit.population) missing.push("population");
      if ((sel.intervention || sel.comparator) && !audit.intervention && !audit.comparator) {
        missing.push("intervention/comparator");
      }
      if (sel.outcome && !audit.outcome) missing.push("outcome");
      if (!missing.length) missing.push("intervention/comparator");
      excluded.push({ ref: r, audit, reason: `no direct support: missing ${missing.join(", ")}` });
    }
  }
  return { kept, audits, excluded };
}

/**
 * Letters used to recognise a surname.
 *
 * These are Unicode-aware on purpose. With an ASCII-only class, "Å½arko AlfireviÄ‡" parsed as
 * the single surname "Alfirevi", the citation `(Å½arko AlfireviÄ‡ 2012)` resolved to no
 * reference, and the UI reported a legitimate citation as an orphan. Comparison also folds
 * diacritics so "Alfirevic" and "AlfireviÄ‡" are the same name.
 */
const SURNAME_LETTERS = "\\p{L}";
// Letters plus any Unicode dash (ASCII hyphen, U+2010/U+2011, en/em dash) and apostrophes,
// so "Condeâ€Agudelo" and "Sanchez-Ramos" each stay one name instead of splitting into two.
const NAME_INNER = `${SURNAME_LETTERS}\\p{Pd}'â€™`;
const NAME_TOKEN = new RegExp(`[\\p{Lu}][${NAME_INNER}]*`, "gu");
const CAPITALISED = new RegExp(`^\\p{Lu}[${NAME_INNER}]*$`, "u");

/**
 * Lowercase, strip diacritics, and unify dash variants so names compare regardless of how
 * they were typed. The literature sources are inconsistent: the same surname arrives with an
 * ASCII hyphen from one source and U+2010/U+2011 from another, and "Conde-Agudelo" in the text
 * has to match "Condeâ€Agudelo" in the reference.
 */
export function foldName(s: string): string {
  return s
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const NON_NAMES = /^(and|et|al|in|the|a|an|for|of|on|with|by|at|from)$/i;

/**
 * Surnames appearing before the first year in a reference string.
 *
 * Hyphens stay inside a surname, so "Sanchez-Ramos" is one name rather than "Sanchez-" and
 * "Ramos". Splitting it made every citation of that paper look like an unknown reference.
 */
export function surnamesOf(ref: string): string[] {
  const t = ref.trim().replace(/^\[?\d+\]?[\.\)]?\s*/, "");
  const y = /(19|20)\d{2}/.exec(t);
  if (!y) return [];
  // For Vancouver or Chicago, the author segment is before the first period or before the year:
  const periodIdx = t.indexOf(".");
  const sliceEnd = periodIdx > 0 && periodIdx < y.index ? periodIdx : y.index;
  const head = t.slice(0, sliceEnd);
  const names = head.match(NAME_TOKEN) || [];
  const filtered = names.filter(n => n.length > 1 && !NON_NAMES.test(n) && CAPITALISED.test(n));
  if (filtered.length) return filtered;
  const fallbackHead = t.slice(0, y.index);
  return (fallbackHead.match(NAME_TOKEN) || []).filter(n => n.length > 1 && !NON_NAMES.test(n) && CAPITALISED.test(n));
}

export function refSurnameYear(s: string): { surname: string; year: string } | null {
  const t = s.trim().replace(/^\[?\d+\]?[\.\)]?\s*/, "");
  const y = /(19|20)\d{2}/.exec(t);
  if (!y) return null;
  const first = t.match(NAME_TOKEN)?.[0];
  if (!first) return null;
  return { surname: first, year: y[0] };
}

/**
 * Citation slots inside one bracket, each slot being one citation.
 *
 * A slot is split on the separators the model writes between citations, then names are paired
 * with the years in their own slot. Pairing names against the first year the bracket happens to
 * end on, as a single regex does, reports "(Berghella 2026; Broad 2009)" as two citations both
 * dated 2009, which then makes an integrity check and a citation stripper disagree about the same
 * sentence. A slot carrying a name but no year, as in "(Smith; Jones 2019)", inherits the single
 * year the bracket as a whole declares; with several years present the pairing would be a guess,
 * so it is left alone.
 */
export function parseCitationSlots(inner: string): { names: string[]; years: string[] }[] {
  const slots: { names: string[]; years: string[] }[] = [];
  for (const chunk of inner.split(/[;,]|\band\b/i)) {
    const names = (chunk.match(NAME_TOKEN) || []).filter(n => n.length >= 2 && !NON_NAMES.test(n));
    const years = chunk.match(/(?:19|20)\d{2}/g) || [];
    // A chunk that carries a year but no author belongs to the citation before it, as in
    // "(Gen 2012, 2014)" and "(Gen., 2012)", where the separator sits between the author and
    // its years rather than between two citations.
    const previous = slots[slots.length - 1];
    if (!names.length && years.length && previous) {
      previous.years.push(...years);
      continue;
    }
    if (names.length) slots.push({ names, years });
  }
  const declared = [...new Set(slots.flatMap(s => s.years))];
  if (declared.length === 1) {
    for (const slot of slots) if (!slot.years.length) slot.years = [declared[0]];
  }
  return slots.filter(s => s.years.length > 0);
}

/** In-text citations in either "(Author Year)" or "Author et al. (Year)" form. */
export function extractInTextCites(text: string): { author: string; year: string }[] {
  const out: { author: string; year: string }[] = [];
  // Round, square and brace brackets all carry citations in practice, and a citation an integrity
  // check cannot see is a citation no later stage can remove.
  const paren = /([\(\[\{])([^()\[\]{}]*)([\)\]\}])/g;
  let m: RegExpExecArray | null;
  while ((m = paren.exec(text))) {
    for (const slot of parseCitationSlots(m[2])) {
      // One author can carry several years, as in "(Gen 2012, 2014)".
      for (const year of slot.years) for (const author of slot.names) out.push({ author, year });
    }
  }
  const narr = new RegExp(`(${NAME_TOKEN.source}(?:\\s+et\\s+al\\.?)?)\\s*\\((\\d{4})\\)`, "gu");
  while ((m = narr.exec(text))) {
    const year = m[2];
    for (const n of (m[1].match(NAME_TOKEN) || [])) {
      if (n.length < 2 || NON_NAMES.test(n)) continue;
      out.push({ author: n, year });
    }
  }
  return out;
}

/**
 * Citation/reference integrity.
 *
 * `uncited` are references nothing points at. `orphans` are in-text author-year citations
 * that map to no reference at all, which is how an unresolved citation such as
 * "Kansal 2026" is caught.
 *
 * Names are compared with diacritics folded, so an accented surname matches whether the text
 * spells it with or without the accent.
 */
/**
 * Extract numerical citation references from text (e.g. "[1]", "[1, 2]", "[1-3]").
 * Returns a set of 1-based reference numbers and raw matched brackets.
 */
export function extractNumericCites(text: string): { citedNumbers: Set<number>; rawBrackets: string[] } {
  const citedNumbers = new Set<number>();
  const rawBrackets: string[] = [];
  const bracketRegex = /\[([\d\s,\-]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = bracketRegex.exec(text || ""))) {
    const inner = match[1].trim();
    rawBrackets.push(match[0]);
    const parts = inner.split(/\s*,\s*/);
    for (const part of parts) {
      if (/^\d+$/.test(part)) {
        const num = parseInt(part, 10);
        if (num > 0) citedNumbers.add(num);
      } else if (/^(\d+)\s*-\s*(\d+)$/.test(part)) {
        const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          if (start > 0 && end >= start && end - start < 100) {
            for (let i = start; i <= end; i++) citedNumbers.add(i);
          }
        }
      }
    }
  }
  return { citedNumbers, rawBrackets };
}

/**
 * Citation/reference integrity.
 *
 * Supports both Vancouver numerical citation style (`[1]`, `[2]`, `[1-3]`) and
 * author-year author-date style (`(Owen 2020)`).
 *
 * `uncited` are references nothing points at. `orphans` are in-text author-year citations
 * or out-of-range numeric citations (e.g. `[9]` when only 4 references exist)
 * that map to no reference at all.
 *
 * Names are compared with diacritics folded, so an accented surname matches whether the text
 * spells it with or without the accent.
 */
export function checkCitations(discussion: string, refs: string[]): CitationChecks {
  const parsed = refs
    .map(r => ({ ref: r, year: /(19|20)\d{2}/.exec(r)?.[0] || "", names: surnamesOf(r).map(foldName) }))
    .filter(x => x.year);
  const cites = extractInTextCites(discussion || "");
  const { citedNumbers } = extractNumericCites(discussion || "");
  const uncited: string[] = [];
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const folded = foldName(discussion || "");

  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    const refNum = i + 1;
    // 1. Matched via Vancouver numerical citation: [1], [2], etc.
    if (citedNumbers.has(refNum)) {
      continue;
    }
    // 2. Matched via Author-Year citation: (Owen 2020)
    const p = refSurnameYear(r);
    const props = parsed.find(x => x.ref === r);
    const candidates = props?.names.length ? props.names : p ? [foldName(p.surname)] : [];
    if (!candidates.length) { uncited.push(r); continue; }
    const found = candidates.some(nm => {
      const yr = props?.year || "";
      return new RegExp(
        `\\b${esc(nm)}\\b[^()]{0,80}\\b${yr}\\b|\\b${yr}\\)?[^()]{0,40}\\b${esc(nm)}\\b`
      ).test(folded);
    });
    if (!found) uncited.push(r);
  }

  const orphans: string[] = [];
  // Author-year orphans
  for (const c of cites) {
    const author = foldName(c.author);
    const matched = parsed.some(
      p => p.year === c.year && p.names.some(nm => nm === author)
    );
    if (!matched && !orphans.includes(`${c.author} ${c.year}`)) orphans.push(`${c.author} ${c.year}`);
  }
  // Vancouver numerical orphans: e.g. [5] when only 3 references exist
  for (const num of citedNumbers) {
    if (num > refs.length) {
      const label = `[${num}]`;
      if (!orphans.includes(label)) orphans.push(label);
    }
  }

  return {
    totalRefs: refs.length,
    citedRefs: refs.length - uncited.length,
    uncited,
    orphans,
    consistent: uncited.length === 0 && orphans.length === 0
  };
}

/**
 * Resolve a model-written reference string back to the record it claims to be.
 *
 * Matching is deliberately strict and the pool passed in must be the claim-filtered one:
 * author, year (within one year, to absorb online-first vs issue dates) and title must all
 * agree. Requiring the title stops a different paper by a similarly named author from
 * satisfying the match, and a record that did not survive `filterByClaim` can never resolve
 * even if the model names it, because it is simply not in the pool.
 */
export function resolveReference<T extends AuditableRef>(raw: string, pool: T[]): T | null {
  const y = /(19|20)\d{2}/.exec(raw)?.[0];
  if (!y) return null;
  const names = new Set(surnamesOf(raw).map(n => n.toLowerCase()));
  if (!names.size) return null;
  const quoted = raw.toLowerCase().match(/"([^"]{12,})"/)?.[1];
  const strippedNum = raw.replace(/^\[?\d+\]?[\.\)]?\s*/, "");
  const unquotedCandidate = strippedNum.split(/\.\s+/)[1];
  const titleCore = (quoted || unquotedCandidate || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().slice(0, 28);
  let best: T | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const r of pool) {
    const ry = parseInt(r.year || "", 10);
    if (!ry || Math.abs(ry - parseInt(y, 10)) > 1) continue;
    const authorHit = (r.authors || "").split(/[\s,]+/).filter(Boolean)
      .some(a => a.length > 1 && names.has(a.toLowerCase()));
    if (!authorHit) continue;
    if (titleCore && titleCore.length >= 6) {
      const t = (r.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!t.includes(titleCore)) continue;
    }
    // Prefer the closest year when several records match the author and title.
    const delta = Math.abs(ry - parseInt(y, 10));
    if (delta < bestDelta) { best = r; bestDelta = delta; }
  }
  return best;
}

/**
 * Canonical bibliography entry for a record.
 *
 * Emits Vancouver style (ICMJE / NLM format), which is standard in medical and obstetric
 * literature: Author(s). Title. Journal. Year. doi URL.
 * (Titles are not enclosed in quotation marks, and year follows the journal specification).
 */
export function formatReference(ref: AuditableRef, style: "vancouver" | "chicago" = "vancouver"): string {
  const url = ref.url || (ref.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${ref.pmid}/` : "");
  if (style === "chicago") {
    return [
      ref.authors ? `${ref.authors}.` : "",
      ref.year ? `${ref.year}.` : "",
      `"${(ref.title || "").replace(/\.$/, "")}."`,
      ref.journal ? `${ref.journal}.` : "",
      ref.doi ? `doi:${ref.doi}` : "",
      url
    ].filter(Boolean).join(" ");
  }

  // Vancouver style (NLM / ICMJE convention)
  const authors = ref.authors ? `${ref.authors.trim().replace(/\.$/, "")}.` : "";
  const title = ref.title ? `${ref.title.trim().replace(/\.$/, "")}.` : "";
  const journal = ref.journal ? `${ref.journal.trim().replace(/\.$/, "")}.` : "";
  const year = ref.year ? `${String(ref.year).trim()}.` : "";
  const doi = ref.doi ? `doi:${ref.doi.replace(/^doi:\s*/i, "")}` : "";

  return [
    authors,
    title,
    journal ? `${journal} ${year}`.trim() : year,
    doi,
    url
  ].filter(Boolean).join(" ");
}

export function formatVancouverReference(ref: AuditableRef, index?: number): string {
  const prefix = typeof index === "number" && index > 0 ? `${index}. ` : "";
  const formatted = formatReference(ref, "vancouver");
  return `${prefix}${formatted}`.trim();
}

export interface CuratedReferences {
  /** Accepted reference strings, in order, capped at `max`. */
  references: string[];
  /** The filtered records backing `references`, in the same order. */
  records: AuditableRef[];
  /** For each accepted string, the filtered record it resolved to. */
  resolved: Map<string, AuditableRef>;
  /** Model strings dropped because they resolved to nothing in the filtered pool. */
  dropped: string[];
}

/**
 * Turn the model's proposed bibliography into the final one.
 *
 * A proposal is accepted only when it resolves to a record in `pool`, which callers populate
 * with `filterByClaim(...).kept`. The accepted entry is then replaced by `formatReference` of
 * that record, so the published bibliography carries authoritative metadata from the source
 * rather than the model's recollection of it. If the model proposes fewer than `min`
 * references the list is topped up from the same filtered pool.
 *
 * There is no path here that can introduce a record the claim filter rejected, so an off-topic
 * source cannot reach the commentary or an export.
 */
export function curateReferences<T extends AuditableRef>(
  modelRefs: string[],
  pool: T[],
  opts: { min?: number; max?: number } = {}
): CuratedReferences {
  const max = opts.max ?? 8;
  const min = opts.min ?? 4;
  const references: string[] = [];
  const records: AuditableRef[] = [];
  const resolved = new Map<string, AuditableRef>();
  const usedKeys = new Set<string>();
  const dropped: string[] = [];

  const add = (rec: AuditableRef): boolean => {
    const key = rec.doi ? `doi:${rec.doi.toLowerCase()}` : (rec.title || "").slice(0, 60).toLowerCase();
    if (usedKeys.has(key)) return false;
    usedKeys.add(key);
    const formatted = formatReference(rec);
    references.push(formatted);
    records.push(rec);
    resolved.set(formatted, rec);
    return true;
  };

  for (const raw of Array.isArray(modelRefs) ? modelRefs : []) {
    if (references.length >= max) break;
    if (typeof raw !== "string" || !raw.trim()) continue;
    const hit = resolveReference(raw, pool);
    if (!hit) { dropped.push(raw); continue; }
    add(hit);
  }

  if (references.length < min) {
    for (const r of pool) {
      if (references.length >= min) break;
      add(r);
    }
  }

  return { references: references.slice(0, max), records, resolved, dropped };
}

/**
 * Remove in-text citations that resolve to no reference.
 *
 * A citation is a claim that a specific paper supports a specific sentence. When no retained
 * record matches it, the claim cannot be substantiated, and leaving it in place would put an
 * unverifiable attribution in a scientific deliverable. Dropping the citation marker is the
 * conservative action: the prose survives, the unsupported attribution does not. Callers are
 * expected to report what was removed.
 *
 * The author is matched loosely (any capitalised name token) and then confirmed by comparing
 * folded forms, because a precomposed letter such as "Ä‡" cannot be matched by a plain `[c]`
 * pattern. Brackets are handled as a unit because the model writes more than one citation per
 * bracket, such as "(Park and Park 2026)" or "(Berghella 2026; Broad 2009)".
 */
export function stripOrphanCitations(text: string, orphans: string[]): { text: string; removed: string[] } {
  const numericOrphans = orphans.filter(o => /^\[\d+\]$/.test(o.trim()));
  const wanted = orphans
    .map(o => {
      const sp = o.lastIndexOf(" ");
      if (sp < 1) return null;
      const author = o.slice(0, sp).trim();
      const year = o.slice(sp + 1).trim();
      return /^(19|20)\d{2}$/.test(year) && author ? { author, year, key: `${foldName(author)}|${year}` } : null;
    })
    .filter((x): x is { author: string; year: string; key: string } => !!x);
  if (!wanted.length && !numericOrphans.length) return { text: text || "", removed: [] };

  const removed: string[] = [];
  let out = text || "";

  // Strip numeric orphans like [5]
  for (const no of numericOrphans) {
    const num = no.replace(/[\[\]]/g, "").trim();
    out = out.replace(new RegExp(`\\[\\s*${num}\\s*\\]`, "g"), () => {
      if (!removed.includes(no)) removed.push(no);
      return "";
    });
    out = out.replace(new RegExp(`\\[([^\\]]*)\\b${num}\\b([^\\]]*)\\]`, "g"), (match, pre, post) => {
      const remaining = `${pre},${post}`.split(",").map(s => s.trim()).filter(s => s && s !== num);
      if (!removed.includes(no)) removed.push(no);
      return remaining.length ? `[${remaining.join(", ")}]` : "";
    });
  }

  const NAME = NAME_TOKEN.source;
  const orphanKeys = new Set(wanted.map(w => w.key));

  const note = (author: string, year: string) => {
    const label = `${author} ${year}`;
    if (!removed.includes(label)) removed.push(label);
  };

  // Brackets are rebuilt from the same parser that produced the orphan list, so the two can never
  // disagree. Matching author-year pairs against a regex instead leaves orphans behind whenever the
  // model writes a form the regex does not model, such as "(Gen 2012, 2014)" or "(Gen., 2012)".
  const BRACKET = /([\(\[\{])([^()\[\]{}]{0,240}?\b(?:19|20)\d{2}[a-z]?\b[^()\[\]{}]{0,240}?)([\)\]\}])/g;
  out = out.replace(BRACKET, (match, open: string, inner: string, close: string) => {
    // A slot is one citation, so it is dropped as a unit: when "(Žarko Alfirević 2012)" matches
    // only on the surname the model used, removing just that token would leave the rest of the
    // slot standing as a citation to a paper that was never resolved.
    const slots = parseCitationSlots(inner);
    if (!slots.length) return match;

    const survivors = slots.filter(slot =>
      !slot.names.some(n => slot.years.some(y => orphanKeys.has(`${foldName(n)}|${y}`)))
    );
    if (survivors.length === slots.length) return match;
    for (const slot of slots) {
      for (const n of slot.names) {
        for (const y of slot.years) if (orphanKeys.has(`${foldName(n)}|${y}`)) note(n, y);
      }
    }
    // A bracket with no surviving citation is no longer a citation, so it goes entirely rather
    // than leaving a dangling author name behind.
    if (!survivors.length) return "";
    const rendered = survivors.map(slot => `${slot.names.join(" ")} ${slot.years.join(", ")}`).join("; ");
    return `${open}${rendered}${close}`;
  });

  // Narrative form, where the author sits outside the bracket: "Park et al. (2026)" or "Park, 2026".
  for (const w of wanted) {
    out = out.replace(
      new RegExp(`(${NAME})(?:\\s+et\\s+al\\.?)?\\s*(?:\\(|\\[|\\{)?\\s*,?\\s*${w.year}[a-z]?\\s*(?:\\)|\\]|\\})?`, "gu"),
      (match, name: string) => {
        if (foldName(name) !== foldName(w.author)) return match;
        note(name, w.year);
        return "";
      }
    );
  }

  return {
    text: out
      .replace(/\(\s*\)/g, "")
      .replace(/\s+([,.;:])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
    removed
  };
}

/**
 * Rewrite text so that every in-text citation author-year is only kept if it
 * resolves to a record in the allowed set. Returns the sanitized text and
 * structured warnings for citations that were removed.
 */
export function sanitizeCitationsAgainstEvidenceSet(
  discussion: string,
  allowedKeys: Set<string>,
  citationMap: Map<string, AuditableRef>
): { text: string; warnings: Array<{ type: "removed-unsupported-citation"; citation: string; reason: string }> } {
  const warnings: Array<{ type: "removed-unsupported-citation"; citation: string; reason: string }> = [];
  const orphaned = extractOrphansAgainstSet(discussion || "", allowedKeys, citationMap);
  const stripped = stripOrphanCitations(discussion || "", orphaned);
  for (const c of stripped.removed) {
    warnings.push({
      type: "removed-unsupported-citation",
      citation: c,
      reason: "Citation was not present in the validated final evidence set"
    });
  }
  return { text: stripped.text, warnings };
}

function extractOrphansAgainstSet(
  discussion: string,
  allowedKeys: Set<string>,
  citationMap: Map<string, AuditableRef>
): string[] {
  const cites = extractInTextCites(discussion || "");
  const orphans: string[] = [];
  for (const c of cites) {
    const key = findKeyForCitation(c.author, c.year, citationMap);
    if (!key || !allowedKeys.has(key)) {
      const label = `${c.author} ${c.year}`;
      if (!orphans.includes(label)) orphans.push(label);
    }
  }
  return orphans;
}

export function findKeyForCitation(author: string, year: string, citationMap: Map<string, AuditableRef>): string | null {
  const fa = foldName(author);
  for (const [k, rec] of citationMap) {
    const ry = String(rec.year || "");
    if (ry !== year) continue;
    const surnames = surnamesOf(formatReference(rec)).map(foldName);
    if (surnames.includes(fa)) return k;
    const rawSurnames = (rec.authors || "").split(/[\s,;]+/).filter(Boolean).map(a => foldName(a));
    if (rawSurnames.some(s => s === fa)) return k;
  }
  return null;
}

/**
 * Drive every narrative field and the reference list to agreement, deterministically.
 *
 * Citations are checked across the whole narrative rather than one field, because a reference
 * cited only in the introduction and a citation stranded in the conclusion are the same defect:
 * the reader sees an attribution the bibliography does not support. Each pass sanitizes against the
 * canonical evidence set, removes citations that resolve to no reference, then drops references
 * nothing cites, and repeats until neither the text nor the list changes.
 */
export function reconcileNarrative(
  fields: Record<string, string>,
  references: string[],
  allowedKeys: Set<string>,
  citationMap: Map<string, AuditableRef>
): { fields: Record<string, string>; references: string[]; removedCitations: string[] } {
  const out: Record<string, string> = { ...fields };
  let refs = [...(references || [])];
  const removedCitations: string[] = [];
  const names = Object.keys(out);
  const joined = () => names.map(n => out[n] || "").join(" ");

  for (let pass = 0; pass < 5; pass++) {
    const before = `${joined()} ${refs.join(" ")}`;

    for (const name of names) {
      const canonical = sanitizeCitationsAgainstEvidenceSet(out[name] || "", allowedKeys, citationMap);
      if (canonical.text !== (out[name] || "")) {
        out[name] = canonical.text;
        for (const w of canonical.warnings) {
          if (w.type === "removed-unsupported-citation" && !removedCitations.includes(w.citation)) {
            removedCitations.push(w.citation);
          }
        }
      }
    }

    const checks = checkCitations(joined(), refs);
    if (checks.orphans.length) {
      for (const name of names) {
        const stripped = stripOrphanCitations(out[name] || "", checks.orphans);
        if (stripped.text !== (out[name] || "")) out[name] = stripped.text;
        for (const r of stripped.removed) if (!removedCitations.includes(r)) removedCitations.push(r);
      }
    }

    const after = checkCitations(joined(), refs);
    if (after.uncited.length) {
      const kept = refs.filter(r => !after.uncited.includes(r));
      if (kept.length !== refs.length) {
        refs = kept;
        continue;
      }
    }

    if (`${joined()} ${refs.join(" ")}` === before) break;
  }

  return { fields: out, references: refs, removedCitations };
}
/** Stable identity for a reference string, preferring DOI. */
export function refIdentityKey(raw: string): string {
  return (/(?:doi:)?(10\.\S+)/i.exec(raw)?.[1] || raw.slice(0, 60).toLowerCase()).toLowerCase();
}

/** Stable, order-independent identity for a pool of references, for determinism testing. */
export function referenceSetKey(refs: string[]): string {
  return [...new Set(refs.map(refIdentityKey))].sort().join("|");
}
