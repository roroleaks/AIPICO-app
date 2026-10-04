/**
 * Clinical keyword parsing, normalization, and conservative spelling suggestions.
 *
 * This module is intentionally dependency-free and side-effect-free so it can be unit
 * tested in isolation (see clinical-keywords.test.ts). Keeping it free of app/server
 * imports also means a real terminology service (SNOMED CT, Embase, MeSH) can later
 * replace `suggestCorrection` / the dictionary without touching the intake UI.
 */

/**
 * Why a suggestion is offered.
 * - `typo`  : edit-distance match against the clinical dictionary (misspelling).
 * - `alias` : a recognized but non-canonical spelling that maps to one canonical term,
 *             e.g. "vit d" -> "vitamin D" or "co enzyme q 10" -> "coenzyme Q10".
 * Aliases are confirmable rather than applied silently so that nothing the user typed is
 * rewritten behind their back.
 */
export type CorrectionKind = "typo" | "alias";

/** The user's explicit choice for a suggestion. Nothing is changed without one. */
export type CorrectionDecision = "applied" | "kept";

export interface KeywordCorrection {
  from: string;
  to: string;
  kind: CorrectionKind;
}

/** A suggestion plus the decision the user made. This is the persistent audit record. */
export interface CorrectionRecord extends KeywordCorrection {
  decision: CorrectionDecision;
}

export interface ParsedKeywords {
  /** Logical keywords exactly as the user typed them, after whitespace cleanup. */
  rawTokens: string[];
  /** Display/canonical forms to hand to PICO formulation and literature search. */
  normalizedTokens: string[];
  logicalCount: number;
  /** Suggestions still awaiting an Apply/Keep decision. */
  corrections: KeywordCorrection[];
  /** Every suggestion the user has already decided, oldest first. Never pruned. */
  history: CorrectionRecord[];
  errors: string[];
}

export function correctionKey(c: { from: string; to: string }): string {
  return `${c.from}→${c.to}`;
}

export const MIN_KEYWORDS = 4;
export const MAX_KEYWORDS = 6;

/**
 * Multi-word clinical expressions that must never be split into separate keywords.
 * Keeps the domain vocabulary close to `KB` in lib/kb.ts but standalone on purpose;
 * `tags.ts` folds the full knowledge base in via `extraVocab` at runtime.
 */
export const CLINICAL_PHRASES: string[] = [
  // Reproductive medicine
  "recurrent implantation failure", "implantation failure", "unexplained infertility",
  "male factor infertility", "diminished ovarian reserve", "thin endometrium",
  "recurrent pregnancy loss", "cumulative live birth rate", "live birth rate",
  "ongoing pregnancy rate", "clinical pregnancy rate", "implantation rate",
  "miscarriage rate", "deep infiltrating endometriosis", "deep endometriosis",
  "intrauterine system", "uterine artery embolization", "hysteroscopic surgery",
  "laparoscopic surgery", "clomiphene citrate", "myo inositol", "low amh",
  // Gynecology
  "heavy menstrual bleeding", "abnormal uterine bleeding", "endometrial hyperplasia",
  "pelvic organ prolapse", "endometrial ablation", "chronic pelvic pain",
  "transcervical endometrial resection", "levonorgestrel ius", "gnrh agonist",
  "gnrh antagonist", "clomiphene", "letrozole", "hmb", "uae", "lng ius",
  // Obstetrics
  "short cervix", "cervical length", "preterm birth", "preterm delivery",
  "fetal growth restriction", "gestational diabetes", "placenta accreta spectrum",
  "placenta accreta", "placenta previa", "preeclampsia", "gestational hypertension",
  "pre eclampsia", "spontaneous preterm birth", "indicated preterm birth",
  "cervical cerclage", "transcervical cerclage", "emergency cerclage",
  "selective cerclage", "progesterone supplementation", "neonatal morbidity",
  "gestational age", "small for gestational age", "gestational age at delivery",
  // Interventions and supplements
  "vitamin D", "vitamin E", "vitamin C", "coenzyme Q10", "CoQ10",
  "omega-3", "folic acid", "iron supplementation", "tranexamic acid",
  "maternal diabetes", "maternal obesity", "twin pregnancy", "singleton pregnancy",
  "first trimester", "second trimester", "third trimester", "neonatal intensive care",
  // Outcomes
  "patient reported symptom relief", "health related quality of life",
  "patient satisfaction", "reoperation rate", "major complications",
  "hemoglobin change", "menstrual blood loss reduction", "ovarian reserve"
];

/**
 * Input spellings that are ambiguous to the word matcher but map to one canonical term.
 * Keyed by the normalized key produced by `aliasKey`.
 */
const ALIASES: Record<string, string> = {
  "vit d": "vitamin D",
  "vit d3": "vitamin D",
  "vit d2": "vitamin D",
  "vitamin d3": "vitamin D",
  "co enzyme q 10": "coenzyme Q10",
  "co enzyme q10": "coenzyme Q10",
  "coenz q10": "coenzyme Q10",
  "co q 10": "coenzyme Q10",
  "coq10": "coenzyme Q10",
  "q10": "coenzyme Q10",
  "myo inositol": "myo-inositol",
  "lgb r": "live birth rate",
  "preeclampsia": "preeclampsia",
  "pre eclampsia": "preeclampsia",
  "hmb": "heavy menstrual bleeding",
  "aub": "abnormal uterine bleeding",
  "pas": "placenta accreta spectrum",
  "fgr": "fetal growth restriction",
  "sga": "small for gestational age",
  "ivf": "IVF",
  "icsi": "ICSI",
  "iui": "IUI",
  "art": "ART",
  "ohss": "OHSS",
  "rif": "recurrent implantation failure",
  "lbr": "live birth rate",
  "cpr": "clinical pregnancy rate",
  "pgt a": "PGT-A",
  "g csf": "G-CSF",
  "gnrh": "GnRH",
  "h pylori": "H. pylori",
  "pcos": "PCOS"
};

/** Words that carry no clinical intent and must not become standalone keywords. */
const STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "with", "for", "to", "and", "or",
  "is", "are", "was", "were", "as", "by", "at", "from", "vs", "versus",
  "than", "compared", "about", "after", "before", "during", "into"
]);

/**
 * Dashes are ambiguous: `short cervix - cerclage` separates two keywords, while
 * `co-enzyme Q10` and `myo-inositol` contain an internal hyphen. A dash therefore only
 * separates when it is already surrounded by whitespace (or sits at a chunk boundary),
 * which is the near-universal convention for separator dashes.
 */
const HARD_SEPARATORS = /[,;\r\n]+/;
// A dash is a separator only when whitespace-adjacent, which keeps internal hyphens
// (`co-enzyme`, `myo-inositol`, `PGT-A`) intact. Repeated dash runs are handled by
// splitting repeatedly in `splitChunks`.
const DASH_SEPARATOR = /\s[-–—]+\s*|^\s*[-–—]+|\s*[-–—]+$/g;

function splitChunks(raw: string): string[] {
  return raw
    .split(HARD_SEPARATORS)
    .flatMap(part => {
      // Split while any whitespace-adjacent dash remains, so ` - - ` yields one boundary.
      // Order is preserved by expanding each fragment in place rather than queueing.
      let pieces = [part];
      for (let pass = 0; pass < 8; pass++) {
        let changed = false;
        pieces = pieces.flatMap(chunk => {
          const next = chunk.split(DASH_SEPARATOR);
          if (next.length > 1) changed = true;
          return next;
        });
        if (!changed) break;
      }
      return pieces;
    })
    .map(chunk => chunk.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Normalized lookup key: lowercase, punctuation collapsed to single spaces. */
function wordKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** Compact key used for dictionary lookups and edit distance. */
function compact(value: string): string {
  return wordKey(value).replace(/ /g, "");
}

/**
 * Canonical display form for a dictionary entry. Returns the dictionary text verbatim
 * (including intended capitalization such as "vitamin D") rather than re-casing it, so
 * downstream search terms and the UI both read the way the term is normally written.
 */
function display(term: string): string {
  return term.replace(/\s+/g, " ").trim();
}

/**
 * Optimal string alignment (restricted Damerau-Levenshtein). Handles the single
 * transposition that plain Levenshtein misses, which is the most common human typo
 * shape in clinical free text.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) rows.push([i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = best;
    }
  }
  return rows[a.length][b.length];
}

/**
 * Conservative nearest-term suggestion.
 *
 * Returns a suggestion only when the candidate is unambiguously closest, the edit
 * budget is small relative to word length, and the word is long enough that a
 * coincidental match is implausible. Anything else returns null so that unfamiliar
 * clinical terms are never silently rewritten.
 */
export function suggestCorrection(word: string, dictionary: string[]): string | null {
  const w = compact(word);
  if (w.length < 5) return null;
  if (dictionary.some(d => compact(d) === w)) return null; // already known

  const budget = w.length >= 9 ? 2 : 1;
  let best: string | null = null;
  let bestDistance = budget + 1;
  // Relative distance breaks ties in favour of the candidate that retains more of the
  // typed text ("endometrios" -> "endometriosis" rather than "endometrial").
  let bestRatio = Number.POSITIVE_INFINITY;
  let ambiguous = false;

  for (const candidate of dictionary) {
    const c = compact(candidate);
    if (!c.length || Math.abs(c.length - w.length) > budget) continue;
    const d = editDistance(w, c);
    if (d > budget) continue;
    const ratio = d / c.length;
    if (d < bestDistance || (d === bestDistance && ratio < bestRatio)) {
      bestDistance = d;
      bestRatio = ratio;
      best = candidate;
      ambiguous = false;
    } else if (d === bestDistance && Math.abs(ratio - bestRatio) < 1e-9) {
      ambiguous = true;
    }
  }

  if (!best || ambiguous) return null;
  // Reject corrections that would still differ substantially.
  if (bestDistance / w.length > 0.34) return null;
  return best;
}

/**
 * Parse free-text clinical input into 4–6 logical keyword units.
 *
 * `extraVocab` lets the app fold in the live knowledge base so new clinical terms are
 * recognised as single units without editing this file.
 */
export function parseClinicalKeywords(input: string, extraVocab: string[] = []): ParsedKeywords {
  const errors: string[] = [];
  const raw = String(input || "");
  const corrections: KeywordCorrection[] = [];
  const normalizedTokens: string[] = [];
  const rawTokens: string[] = [];

  // 1. Split on unambiguous separators, then on whitespace-adjacent dashes.
  const chunks = splitChunks(raw);

  // 2. Build the phrase dictionary, longest first, for greedy longest-match.
  // `words` keeps word boundaries so "short cervix" can match the words "short","cervix";
  // `compact` is the space-free form used for single-word lookups and edit distance.
  const allEntries = [...CLINICAL_PHRASES, ...extraVocab];
  // Keys compare case-insensitively, so "vitamin D" and "vitamin d" collapse to one entry.
  // When they do, keep whichever spelling carries more intentional capitalisation (the
  // knowledge base's "vitamin D" over the bare list's "vitamin d") so the canonical display
  // form is the one normally written.
  const upperCount = (s: string) => (s.match(/[A-Z]/g) || []).length;
  const byKey = new Map<string, { words: string[]; text: string }>();
  for (const entry of allEntries) {
    const words = wordKey(entry).split(" ").filter(Boolean);
    if (!words.length) continue;
    const key = words.join(" ");
    const existing = byKey.get(key);
    if (!existing || upperCount(entry) > upperCount(existing.text)) {
      byKey.set(key, { words, text: entry });
    }
  }
  const phraseDict = [...byKey.values()];
  phraseDict.sort((a, b) => b.words.length - a.words.length);

  const phraseByKey = new Map<string, string>();
  for (const entry of phraseDict) phraseByKey.set(entry.words.join(" "), entry.text);

  const knownKeys = new Set([...phraseByKey.keys(), ...Object.keys(ALIASES).map(wordKey)]);

  const pushCorrection = (from: string, to: string, kind: CorrectionKind) => {
    if (correctionKey({ from, to }) === correctionKey({ from: to, to })) return; // identity
    const key = correctionKey({ from, to });
    if (corrections.some(c => correctionKey(c) === key)) return;
    corrections.push({ from, to, kind });
  };

  /**
   * An alias is only applied silently when it changes nothing but capitalisation, i.e. it is
   * the same term written differently (IVF -> IVF). Any change to the actual characters,
   * such as "vit d" -> "vitamin D" or "co enzyme q 10" -> "coenzyme Q10", is offered as a
   * suggestion the user must confirm.
   */
  const isDisplayOnlyChange = (from: string, to: string) => from.toLowerCase() === to.toLowerCase();

  // Word-level dictionary for typo suggestions.
  const wordDict = new Set<string>();
  for (const entry of phraseDict) {
    for (const w of entry.words) if (w.length >= 5) wordDict.add(w);
  }

  const phraseFor = (words: string[]): string | null =>
    phraseByKey.get(words.join(" ")) ?? null;

  for (const chunk of chunks) {
    const aliasKey = wordKey(chunk);
    const alias = ALIASES[aliasKey];
    // A chunk that is itself a dictionary phrase is left to the phrase matcher below, so
    // legitimate short forms that are also dictionary entries are never questioned.
    if (alias && !phraseByKey.has(aliasKey)) {
      rawTokens.push(chunk);
      if (isDisplayOnlyChange(chunk, alias)) {
        // Same term, different capitalisation (e.g. "ivf" -> "IVF"). Not a correction.
        normalizedTokens.push(alias);
      } else {
        // Recognised shorthand for a longer term. Keep what the user typed and let them
        // confirm the canonical form instead of rewriting it silently.
        normalizedTokens.push(chunk);
        pushCorrection(chunk, alias, "alias");
      }
      continue;
    }

    const words = chunk.toLowerCase().split(" ").filter(Boolean);
    let i = 0;
    while (i < words.length) {
      // Greedy longest phrase match keeps recognized multi-word terms intact.
      let matched = false;
      for (let len = Math.min(5, words.length - i); len >= 1; len--) {
        const candidate = words.slice(i, i + len);
        const phrase = phraseFor(candidate);
        if (phrase) {
          const typed = candidate.join(" ");
          rawTokens.push(typed);
          const canonical = display(phrase);
          if (typed.toLowerCase() === canonical.toLowerCase()) {
            // Identical apart from capitalisation; nothing for the user to decide.
            normalizedTokens.push(canonical);
          } else {
            // A recognised shorthand spelled out, e.g. "vit d" -> "vitamin D". Suggest it
            // rather than rewriting the user's own words.
            normalizedTokens.push(typed);
            pushCorrection(typed, canonical, "alias");
          }
          i += len;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Unrecognised words are one medical term, not one keyword each. The user already
      // declared the term boundary with a comma; "amniotic fluid embolism" is a single
      // clinical concept, and counting its three words inflated the total and could push a
      // valid search past the maximum. Only stopwords break the run, so filler such as
      // "cerclage vs none" still separates into its two real terms.
      const run: string[] = [];
      while (i < words.length) {
        const word = words[i];
        if (STOPWORDS.has(word)) break;
        // A recognised phrase or single recognised token starting here ends the run, so
        // "amniotic fluid embolism cerclage" splits at "cerclage".
        if (phraseFor([word])) break;
        if (knownKeys.has(word)) break;
        run.push(word);
        i++;
        if (run.length >= 5) break;
      }
      if (!run.length) { i++; continue; }

      for (const word of run) {
        // Conservative spelling suggestion. It is recorded for the user to accept or
        // reject; the token itself keeps what they typed so nothing changes silently.
        if (!knownKeys.has(word) && word.length >= 5) {
          const suggestion = suggestCorrection(word, [...wordDict]);
          if (suggestion) pushCorrection(word, display(suggestion), "typo");
        }
      }

      const typed = run.join(" ");
      rawTokens.push(typed);
      normalizedTokens.push(typed);
    }
  }

  // Everything the user typed was separator/stopword noise, e.g. ",,," or "with and".
  if (!chunks.length || !normalizedTokens.length) {
    errors.push("No clinical keywords were detected in the entry.");
  }

  return {
    rawTokens,
    normalizedTokens,
    logicalCount: normalizedTokens.length,
    corrections,
    history: [],
    errors
  };
}

/**
 * Reconcile a fresh parse against the user's recorded decisions.
 *
 * Decisions are keyed by `from→to`, so they survive reparsing and rerendering: a suggestion
 * the user has decided no longer reappears, whether it was applied or kept. Applied
 * decisions rewrite `normalizedTokens`; kept decisions deliberately leave the typed text
 * alone. Both are appended to `history` and never removed, giving a full audit trail.
 */
export function resolveCorrections(
  parsed: ParsedKeywords,
  decisions: CorrectionRecord[]
): ParsedKeywords {
  if (!decisions.length) return parsed;

  const byKey = new Map(decisions.map(d => [correctionKey(d), d]));

  // "Applied" decisions that actually match a term in the current parse drive the rewrite.
  const replacements = new Map<string, string>();
  for (const d of byKey.values()) {
    if (d.decision !== "applied") continue;
    const parsedCorrection = parsed.corrections.find(c => correctionKey(c) === correctionKey(d));
    if (!parsedCorrection && !parsed.rawTokens.some(t => t.toLowerCase() === d.from.toLowerCase())) {
      continue; // term no longer present in the input
    }
    replacements.set(d.from.toLowerCase(), d.to);
  }

  const normalizedTokens = replacements.size
    ? parsed.normalizedTokens.map(token => replacements.get(token.toLowerCase()) ?? token)
    : parsed.normalizedTokens;

  const pending = parsed.corrections.filter(c => !byKey.has(correctionKey(c)));

  // Merge new decisions into history, replacing an earlier decision for the same pair.
  const history: CorrectionRecord[] = [...parsed.history];
  for (const d of decisions) {
    const key = correctionKey(d);
    const at = history.findIndex(h => correctionKey(h) === key);
    if (at >= 0) history[at] = d;
    else history.push(d);
  }

  return {
    ...parsed,
    normalizedTokens,
    corrections: pending,
    history,
    errors: [...parsed.errors]
  };
}

/** Canonical string to persist and send downstream: logical boundaries preserved. */
export function keywordsToString(keywords: string[]): string {
  return keywords.map(k => k.trim()).filter(Boolean).join(", ");
}

/**
 * Professional explanatory validation message. States the detected count, the required
 * range, how multi-word phrases are counted, accepted separators, and a worked example.
 */
export function validateKeywords(parsed: ParsedKeywords): string | null {
  const { logicalCount } = parsed;
  if (logicalCount >= MIN_KEYWORDS && logicalCount <= MAX_KEYWORDS) return null;

  const detected = logicalCount === 1 ? "1 logical keyword" : `${logicalCount} logical keywords`;
  const why = logicalCount < MIN_KEYWORDS
    ? `${detected} detected — ${MIN_KEYWORDS} required minimum.`
    : `${detected} detected — maximum is ${MAX_KEYWORDS}.`;

  return `Please enter ${MIN_KEYWORDS}–${MAX_KEYWORDS} clinically meaningful keywords or phrases. `
    + `Multi-word clinical expressions such as “short cervix”, “preterm birth”, “vitamin D”, `
    + `and “endometrial hyperplasia” count as one keyword each. `
    + `Separate terms with commas, dashes, semicolons, or new lines. `
    + `Your current entry contains ${why} `
    + `Include terms that describe the condition or population, intervention, comparator, and outcome. `
    + `Example: “short cervix, progesterone, cerclage, preterm birth”.`;
}

/** Short live count shown while typing. Empty string when nothing has been entered. */
export function keywordCountHint(parsed: ParsedKeywords): string {
  const n = parsed.logicalCount;
  if (n === 0) return "";
  const noun = n === 1 ? "keyword" : "keywords";
  if (n < MIN_KEYWORDS) return `${n} logical ${noun} detected — ${MIN_KEYWORDS} required minimum.`;
  if (n > MAX_KEYWORDS) return `${n} logical ${noun} detected — maximum is ${MAX_KEYWORDS}.`;
  return `${n} logical ${noun} detected.`;
}

/** Exact user-facing message required when no literature matches the search. */
export const NO_LITERATURE_MESSAGE = "No literature related to your search found";

/** Secondary guidance shown beneath `NO_LITERATURE_MESSAGE`. */
export const NO_LITERATURE_HINT =
  "Try revising or broadening your keywords. Include a condition or population, intervention, "
  + "comparator, and outcome, and check the spelling of the terms.";
