/**
 * Deterministic, PICO-aware outcome selection.
 *
 * Everything here is a pure function so it can be tested directly and shared verbatim between the
 * API and the browser. The server and the client must agree: when the server returns a valid
 * selection the client renders it, and when it does not, the client calls `selectOutcomes` with
 * the same context rather than inventing a second list.
 *
 * Ranking weights are documented at `scoreOutcome`. They are intentionally integer arithmetic
 * with an explicit tie-break chain (score, then priority, then id) so the recommended outcome is
 * reproducible across runs, platforms and LLM availability.
 */

import { z } from "zod";
import { OUTCOME_ONTOLOGY, type OutcomeCandidate, type OutcomeCategory } from "./outcome-ontology.ts";
import type { SpecialtyKey } from "./kb.ts";

export type { OutcomeCandidate, OutcomeCategory };

export interface OutcomeContext {
  specialty: SpecialtyKey | null;
  condition: string;
  population: string;
  intervention: string;
  comparator: string;
  questionType: string;
  framework: string;
  originalInput: string;
  keywords: string[];
}

export interface OutcomeSelectionResponse {
  questionText: string;
  recommendedOutcome: OutcomeCandidate;
  options: OutcomeCandidate[];
  allowFreeText: boolean;
  maxSelections: number;
  source: "rules" | "ai" | "hybrid";
}

export const MAX_OUTCOME_SELECTIONS = 2;
export const MIN_OUTCOME_OPTIONS = 4;
export const MAX_OUTCOME_OPTIONS = 6;
export const MAX_FREE_TEXT_LENGTH = 120;

/** Outcome families that may be shown twice, and only when the question is about thresholds. */
const THRESHOLD_EXCEPTION_FAMILY = "preterm-birth";

/** Sensitivity, specificity and missed-diagnosis rate: how well a test recognises disease. */
const DIAGNOSTIC_ACCURACY_FAMILY = "diagnosis-accuracy";

/**
 * Families allowed more than one member.
 *
 * Most families are near-duplicates, so one per selection is right. Diagnostic accuracy is the
 * exception: sensitivity, specificity and missed-diagnosis rate answer different halves of the
 * same question, and offering only one of them leaves a diagnostic selection too thin to use.
 */
const DIAGNOSTIC_FAMILY_ALLOWANCE: Record<string, number> = {
  [DIAGNOSTIC_ACCURACY_FAMILY]: 3
};

/**
 * Wording that carries no distinguishing clinical meaning.
 *
 * These are dropped before duplicate detection so that "live birth rate" and "live birth" are
 * recognized as the same outcome. Keeping them made every rate-style outcome look distinct from
 * its own plain form, which is precisely the repetition this module exists to remove.
 */
const GENERIC_MEASUREMENT_WORDS = new Set([
  "rate", "rates", "incidence", "frequency", "occurrence", "proportion", "percentage", "risk",
  "of", "the", "a", "an", "and", "or", "in", "with", "by", "for", "to", "at", "on",
  // Time-base nouns qualify a cutoff without naming a different outcome: "birth before 34 weeks
  // gestation" and "birth at 34 weeks" are one measurement.
  "gestation", "term"
]);

/**
 * Modifiers that do not make a distinct outcome.
 *
 * "Preterm birth" and "spontaneous preterm birth" are the same thing to a clinician choosing what
 * to measure, so a label that differs only by these words is a near-duplicate. Measurement
 * differences (a week threshold, a mode of delivery) are NOT in this set and stay distinct.
 */
const NON_DISTINCTING_MODIFIERS = new Set([
  "spontaneous", "clinical", "confirmed", "objective", "standardised", "standardized",
  "patient", "reported", "self", "overall", "total", "any", "new", "current",
  // "Birth" and "Live birth" are one outcome to a clinician choosing what to measure, and the
  // synonym table already folds deliver/delivery/delivered into "birth". Leaving "live" as
  // distinguishing offered the same endpoint twice under two labels.
  "live"
]);

/** Clinical synonyms folded before comparison. Bidirectional and single-token. */
const OUTCOME_SYNONYMS: Readonly<Record<string, string>> = {
  deliver: "birth",
  delivered: "birth",
  delivery: "birth",
  deliveries: "birth",
  born: "birth",
  parturition: "birth",
  infant: "neonate",
  babies: "neonate",
  baby: "neonate",
  mortality: "death",
  morbidity: "illness",
  qol: "quality",
  hba1c: "glycation",
  "haemoglobin": "hemoglobin",
  "haemorrhage": "hemorrhage",
  "hypoglycaemia": "hypoglycemia",
  "diarrhoea": "diarrhea",
  "paediatric": "pediatric",
  "foetal": "fetal",
  "anaemia": "anemia",
  fibroids: "fibroid",
  miscarriages: "miscarriage",
  pregnancies: "pregnancy",
  screening: "screen",
  screened: "screen"
};

/** Labels too vague to be a useful primary outcome; penalised rather than banned. */
const OVERLY_GENERIC_PATTERNS: RegExp[] = [
  /^clinical outcome$/,
  /^outcome$/,
  /^adverse events?$/,
  /^complications?$/,
  /^effectiveness$/,
  /^efficacy$/,
  /^results?$/,
  /^success$/,
  /^benefit$/
];

/**
 * A normalized, comparison-ready view of an outcome label.
 *
 * The week threshold is pulled out separately because it is the one place where two labels that
 * look alike are legitimately different outcomes: "before 34 weeks" and "before 37 weeks" are
 * distinct measurements of the same event, while "birth before 37 completed weeks" and
 * "preterm birth <37w" are the same outcome written twice.
 */
export interface NormalizedOutcome {
  /** Lowercase, punctuation-free, singular-folded token string. */
  text: string;
  /** Content tokens after generic measurement words and synonyms are folded away. */
  tokens: string[];
  /** Gestational week threshold found in the label, or null. */
  weeks: number | null;
}

const HTML_TAG = /<[^>]*>/g;
const SCRIPT_BLOCK = /<script[\s\S]*?<\/script>/gi;

/**
 * Strips anything that must never reach the PICO or the DOM.
 *
 * Angle brackets are removed rather than escaped because every downstream consumer treats the
 * result as plain text; a label containing markup is not a clinical outcome and is better reduced
 * to its words than displayed or stored.
 */
export function stripUnsafeContent(raw: string): string {
  return String(raw ?? "")
    .replace(SCRIPT_BLOCK, " ")
    .replace(HTML_TAG, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, " and ")
    .replace(/&lt;/gi, " before ")
    .replace(/&gt;/gi, " after ")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .trim();
}

/**
 * Plural-insensitive token equality that never rewrites the stored word.
 *
 * An earlier version singularized by stripping a trailing "s". That silently turned
 * "endometriosis" into "endometriosi", "prognosis" into "prognosi", and "sepsis" into "sepsi",
 * which broke every condition match on a -sis word. Relating a token only to its own "+s" form
 * keeps matching symmetric ("rate" matches "rates") without corrupting real vocabulary.
 */
function stemEq(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return a + "s" === b || a === b + "s";
}

function foldToken(token: string): string {
  return OUTCOME_SYNONYMS[token] ?? token;
}

function extractWeeks(lowerText: string): number | null {
  // Accepts 37, <37, <=37, 37w, "37 completed weeks". Gestational thresholds are always < 45,
  // so a bare two-digit number in range is treated as a week threshold only when a week unit or
  // a comparison word is present; that avoids reading "37 patients" as a threshold. The compact
  // "w" is common clinical shorthand ("PTB <37w"), so it counts as a unit too.
  const explicit = lowerText.match(/(\d{1,2})\s*(?:completed\s*)?(?:wks?|weeks?|w)\b/);
  if (explicit && Number(explicit[1]) > 0 && Number(explicit[1]) < 45) return Number(explicit[1]);
  return null;
}

/**
 * Removes the threshold phrase from the token text.
 *
 * The cutoff is carried separately in `weeks`, so leaving "before 37 completed weeks" in the tokens
 * would make "birth before 37 completed weeks" and "birth <37w" look like different outcomes. The
 * bare number is removed as well, because a cutoff that has already lost its unit ("before 37")
 * would otherwise survive as an ordinary token and defeat the comparison.
 */
function stripThresholdPhrase(lowerText: string, weeks: number | null): string {
  const text = lowerText
    .replace(/\b(?:before|under|less than|no more than|at most|no later than|prior to)\b\s*\d{1,2}\s*(?:completed\s*)?(?:wks?|weeks?|w)?/g, " ")
    .replace(/\b\d{1,2}\s*(?:completed\s*)?(?:wks?|weeks?|w)\b/g, " ")
    .replace(/\bless than or equal to\b/g, " ")
    .replace(/\bat most\b/g, " ");
  if (weeks === null) return text;
  return text.replace(new RegExp(`\\b${weeks}\\b`, "g"), " ");
}

export function normalizeOutcomeLabel(raw: string): NormalizedOutcome {
  const safe = stripUnsafeContent(raw).toLowerCase();
  const withWords = safe
    .replace(/<=|<=|≤/g, " less than or equal to ")
    .replace(/>=/g, " greater than or equal to ")
    .replace(/</g, " before ")
    .replace(/>/g, " after ")
    .replace(/\+/g, " plus ")
    // Parenthetical qualifiers ("patient-reported", "(N=120)") do not change the outcome.
    .replace(/\([^)]*\)/g, " ");
  const cleaned = withWords.replace(/[^a-z0-9\s-]/g, " ").replace(/[-\s]+/g, " ").trim();
  const weeks = extractWeeks(cleaned);
  const folded = stripThresholdPhrase(cleaned, weeks)
    .split(/\s+/)
    .filter(Boolean)
    .map(foldToken);
  const tokens = folded.filter(t => t.length > 0 && !GENERIC_MEASUREMENT_WORDS.has(t));
  return { text: folded.join(" "), tokens, weeks };
}

/**
 * Ranking asks the same few questions hundreds of times, so normalization is memoized. The cache
 * is bounded and dropped wholesale rather than evicted per entry; there is no value in an LRU here
 * because the working set is small and stable.
 */
const NORMALIZATION_CACHE_LIMIT = 2000;
const normalizationCache = new Map<string, NormalizedOutcome>();

function normalizeCached(text: string): NormalizedOutcome {
  const key = String(text ?? "");
  const hit = normalizationCache.get(key);
  if (hit) return hit;
  const computed = normalizeOutcomeLabel(key);
  if (normalizationCache.size >= NORMALIZATION_CACHE_LIMIT) normalizationCache.clear();
  normalizationCache.set(key, computed);
  return computed;
}

/**
 * Every token the domain actually uses, derived from the ontology rather than guessed.
 *
 * A plural is collapsed to a stem only when that stem is a real token here. "fibroids" becomes
 * "fibroid" because "fibroid" exists; "endometriosis" is left alone because "endometriosi" does not.
 */
const CANONICAL_VOCABULARY: ReadonlySet<string> = new Set([
  ...GENERIC_MEASUREMENT_WORDS,
  ...OUTCOME_ONTOLOGY.flatMap(candidate => [
    ...candidate.applicableConditions,
    ...candidate.applicableInterventions,
    ...candidate.keywords,
    candidate.label,
    candidate.shortLabel
  ]).flatMap(text => normalizeOutcomeLabel(text).tokens)
]);

function canonicalToken(token: string): string {
  if (token.length > 3 && token.endsWith("s") && CANONICAL_VOCABULARY.has(token.slice(0, -1))) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * The key two outcomes must share to be considered the same option.
 *
 * Distinct thresholds produce distinct keys on purpose; that is what allows a threshold-comparison
 * question to offer both <37 and <34 weeks while still collapsing "birth before 37 completed
 * weeks" into the same key as "preterm birth <37w".
 */
export function outcomeSemanticKey(raw: string): string {
  const { tokens, weeks } = normalizeCached(raw);
  const canonical = tokens.map(canonicalToken);
  const base = canonical.filter(t => !NON_DISTINCTING_MODIFIERS.has(t)).join(" ") || canonical.join(" ");
  return weeks === null ? base : `${base} @${weeks}w`;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * True when two labels would be indistinguishable to a clinician choosing what to measure.
 *
 * Three tests, in order of confidence: identical normalized key; a subset relationship where the
 * extra words are all non-distinguishing modifiers ("preterm birth" vs "spontaneous preterm
 * birth"); or very high token overlap at the same threshold.
 */
export function areNearDuplicates(a: string, b: string): boolean {
  const left = normalizeCached(a);
  const right = normalizeCached(b);
  if (!left.tokens.length || !right.tokens.length) return false;
  if (outcomeSemanticKey(a) === outcomeSemanticKey(b)) return true;
  // Different thresholds are genuinely different measurements, whatever else they share.
  if (left.weeks !== right.weeks) return false;

  const leftSet = new Set(left.tokens.map(canonicalToken).filter(t => !NON_DISTINCTING_MODIFIERS.has(t)));
  const rightSet = new Set(right.tokens.map(canonicalToken).filter(t => !NON_DISTINCTING_MODIFIERS.has(t)));
  if (!leftSet.size || !rightSet.size) return false;

  const small = leftSet.size <= rightSet.size ? leftSet : rightSet;
  const large = leftSet.size <= rightSet.size ? rightSet : leftSet;
  const extra = [...large].filter(t => !small.has(t));
  if (!extra.length) return true;
  if (extra.every(t => NON_DISTINCTING_MODIFIERS.has(t) || /^\d+$/.test(t))) return true;
  return jaccard(leftSet, rightSet) >= 0.85;
}

/**
 * Removes duplicates and near-duplicates, preserving the order given.
 *
 * The first occurrence wins so a higher-ranked or explicitly requested label survives.
 */
export function dedupeOutcomeLabels(labels: string[]): string[] {
  const kept: string[] = [];
  for (const label of labels) {
    const trimmed = String(label ?? "").trim();
    if (!trimmed) continue;
    if (kept.some(existing => areNearDuplicates(existing, trimmed))) continue;
    kept.push(trimmed);
  }
  return kept;
}

// ---------------------------------------------------------------------------- scoring

export type MatchTier = "specific" | "specialty" | "keyword" | "family" | "generic";

export interface ScoredOutcome {
  candidate: OutcomeCandidate;
  score: number;
  tier: MatchTier;
  matchedKeywords: string[];
}

const WEIGHTS = {
  conditionExact: 45,
  conditionKeywordOnly: 18,
  interventionExact: 24,
  /** Naming the concept the comparator asks about is decisive, on a par with matching the condition. */
  comparatorKeywordExact: 40,
  /**
   * Bonus for an outcome whose own keywords appear in what the clinician typed.
   *
   * Every outcome can list the same condition, so a condition match alone does not choose between
   * them: on an endometriosis question "Live birth" and "Patient-reported pain reduction" both match
   * the condition exactly, and the fertility endpoint won even though the clinician had typed
   * "pelvic pain" and "dyspareunia". The keyword bonus below was gated behind a non-matching
   * condition, so naming the outcome was worth nothing precisely when everything matched. Naming the
   * concept has to be decisive, for the same reason comparatorKeywordExact is.
   */
  inputKeywordExact: 26,
  specialtyExact: 14,
  specialtyAny: 7,
  /**
   * Penalty for an outcome scoped to other specialties than the one being asked about.
   *
   * "Spontaneous preterm birth before 37 completed weeks" is scoped to obstetrics, but it lists
   * "progesterone" among its keywords, so on an IVF question about luteal-phase progesterone it
   * scored 97 against 82 for "Live birth" and took the recommendation. That is a keyword naming a
   * related intervention, not the outcome being asked about, and it cannot outrank an outcome that
   * actually belongs to the question's specialty.
   */
  otherSpecialtyPenalty: 40,
  /**
   * Bonus for an accuracy measure when the question is about making or detecting a diagnosis.
   *
   * On a "detect aneuploidy" question about recurrent pregnancy loss, "Implantation rate" and
   * "Sperm retrieval success" outscored every accuracy measure. They are process rates: they say how
   * often a procedure worked, not how well a test recognises disease. The question type already
   * declares which kind of answer is wanted, so honour it. This has to outweigh conditionExact,
   * because "Miscarriage rate" is a real match for recurrent pregnancy loss and would otherwise
   * answer a question that is asking about a test.
   */
  diagnosticQuestionBonus: 50,
  questionTypeExact: 10,
  keywordPerHit: 4,
  keywordCap: 12,
  /**
   * Bonus for sharing a content term with what the question actually asks about.
   *
   * This has to outweigh the generic category bonuses (patientImportant + preferredPrimary = 26),
   * because those are constant within a specialty and were letting "Patient-reported pain
   * reduction" beat "Menstrual blood loss reduction" on a question about menstrual blood loss.
   */
  intentPerHit: 8,
  intentCap: 20,
  patientImportant: 16,
  measurable: 8,
  preferredPrimary: 10,
  genericPenalty: 18
} as const;

/**
 * Whole-token phrase containment over folded tokens.
 *
 * Both sides are folded before comparison. Comparing a folded phrase against raw text made the
 * match case-sensitive, so "GnRH agonist" in the question never matched the "gnrh agonist" entry.
 */
function containsPhrase(haystack: string, phrase: string): boolean {
  const needle = phrases(phrase);
  if (!needle.length) return false;
  const tokens = phrases(haystack);
  if (tokens.length < needle.length) return false;
  for (let start = 0; start + needle.length <= tokens.length; start++) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset++) {
      if (!stemEq(tokens[start + offset]!, needle[offset]!)) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function phrases(text: string): string[] {
  return normalizeCached(text).tokens;
}

/** Patient-important means "a difference here would change what a patient would choose". */
function isPatientImportant(candidate: OutcomeCandidate): boolean {
  return candidate.category === "patient-important" || candidate.family === "live-birth";
}

function isGenericEntry(candidate: OutcomeCandidate): boolean {
  return candidate.applicableConditions.every(c => c === "unknown" || c === "unspecified");
}

/**
 * Transparent deterministic score. Higher is better.
 *
 * The shape is intentional: a specific condition match (45) can outrank a generic
 * patient-important outcome on its own, which is what stops "adverse effects" from winning every
 * question, while the patient-important and measurability bonuses decide between two outcomes
 * that are both specific to the condition.
 */
export function scoreOutcome(candidate: OutcomeCandidate, context: OutcomeContext): ScoredOutcome {
  const contextText = [
    context.condition, context.population, context.intervention,
    context.comparator, context.originalInput, ...context.keywords
  ].filter(Boolean).join(" ");

  const conditionText = [context.condition, context.population, context.originalInput].filter(Boolean).join(" ");
  const interventionText = [context.intervention, context.comparator, context.originalInput].filter(Boolean).join(" ");
  const allText = phrases(contextText);

  let score = 0;
  let tier: MatchTier = "generic";

  const conditionHit = candidate.applicableConditions.some(c => containsPhrase(conditionText, phrases(c).join(" ")));
  const interventionHit = candidate.applicableInterventions.some(i => containsPhrase(interventionText, phrases(i).join(" ")));
  const matchedKeywords = candidate.keywords.filter(k => containsPhrase(allText.join(" "), phrases(k).join(" ")));
  // A keyword found in the comparator alone is far stronger evidence than one found anywhere in the
  // input, because the comparator states what the question is asking *about*. On an endometriosis
  // pain question, "pain" appearing in the comparator is what makes "Patient-reported pain
  // reduction" the answer; the same word in the population or intervention text says much less.
  const comparatorMatchedKeywords = context.comparator
    ? candidate.keywords.filter(k => containsPhrase(context.comparator!, phrases(k).join(" ")))
    : [];
  const specialtyHit = !!context.specialty && candidate.applicableSpecialties.includes(context.specialty);
  const questionTypeHit = !!context.questionType && candidate.applicableQuestionTypes.includes(context.questionType);

  if (conditionHit) {
    score += WEIGHTS.conditionExact;
    tier = "specific";
  } else if (matchedKeywords.length && !isGenericEntry(candidate)) {
    score += WEIGHTS.conditionKeywordOnly;
    tier = "keyword";
  }
  if (interventionHit) {
    score += WEIGHTS.interventionExact;
    if (tier === "generic" || tier === "keyword") tier = "specific";
  }
  if (comparatorMatchedKeywords.length) {
    // Decisive. Naming the concept the question asks about outweighs every category bonus, because
    // those bonuses are constant within a specialty and so cannot distinguish two outcomes that
    // both match the condition.
    score += WEIGHTS.comparatorKeywordExact
      + Math.min((comparatorMatchedKeywords.length - 1) * WEIGHTS.keywordPerHit, WEIGHTS.keywordCap);
    if (tier !== "specific") tier = "specific";
  }
  // Keywords the clinician typed themselves. Scoped to the free-text entry rather than the whole
  // question, because the condition and intervention fields are already scored on their own and
  // would otherwise count twice.
  const typedText = [context.originalInput, ...context.keywords].filter(Boolean).join(" ");
  const typedMatchedKeywords = typedText
    ? candidate.keywords.filter(k => containsPhrase(typedText, phrases(k).join(" ")))
    : [];
  // Scoped to a specialty that is not in play, and not rescued by an exact condition match. This is
  // what keeps the universal fallback universal: on an unrecognised specialty, no OB/GYN-scoped
  // outcome may be pulled in by a keyword the clinician happened to type.
  const scopedElsewhere = candidate.applicableSpecialties.length > 0 && !specialtyHit;
  if (typedMatchedKeywords.length && (!scopedElsewhere || conditionHit)) {
    score += WEIGHTS.inputKeywordExact
      + Math.min((typedMatchedKeywords.length - 1) * WEIGHTS.keywordPerHit, WEIGHTS.keywordCap);
    if (tier !== "specific") tier = "specific";
  }
  // Does the outcome name the thing the question is actually about?
  //
  // A keyword hit anywhere in the input is weak evidence, because the input also carries the
  // population and the intervention. Sharing a content term with the comparator or the condition
  // is the specific evidence, and it is what separates "Menstrual blood loss reduction" from
  // "Patient-reported pain reduction" on a fibroid question about blood loss.
  const intentTokens = comparatorIntentTokens(context);
  const labelTokens = new Set(
    phrases(candidate.label).map(canonicalToken).filter(t => !NON_DISTINCTING_MODIFIERS.has(t))
  );
  let intentHits = 0;
  for (const token of labelTokens) if (intentTokens.has(token)) intentHits++;
  score += Math.min(intentHits * WEIGHTS.intentPerHit, WEIGHTS.intentCap);
  score += specialtyHit ? WEIGHTS.specialtyExact : WEIGHTS.specialtyAny;
  // Scoped to other specialties. An entry that declares it does not apply here must not win on an
  // incidental keyword match. An exact condition match still overrides this: "Patient-reported pain
  // reduction" is scoped to gynaecology, but on an endometriosis question it names the exact
  // condition and is still the answer, whether the question arrived via the infertility or the
  // gynaecology route.
  if (
    context.specialty &&
    !conditionHit &&
    candidate.applicableSpecialties.length > 0 &&
    !specialtyHit
  ) {
    score -= WEIGHTS.otherSpecialtyPenalty;
  }
  if (questionTypeHit) {
    score += WEIGHTS.questionTypeExact;
    if (tier === "generic" && (specialtyHit || conditionHit)) tier = "specialty";
  }
  if (
    candidate.family === DIAGNOSTIC_ACCURACY_FAMILY &&
    context.questionType &&
    /diagnosis|screening/i.test(context.questionType)
  ) {
    score += WEIGHTS.diagnosticQuestionBonus;
  }
  score += Math.min(matchedKeywords.length * WEIGHTS.keywordPerHit, WEIGHTS.keywordCap);
  if (isPatientImportant(candidate)) score += WEIGHTS.patientImportant;
  if (candidate.measurable) score += WEIGHTS.measurable;
  if (candidate.preferredForPrimaryOutcome) score += WEIGHTS.preferredPrimary;

  // An outcome with no condition behind it, or with wording that names no clinical event, must
  // not win a specific question just because it is broad and patient-important. The penalty is
  // what keeps "adverse effects" and "clinical outcome" as last resorts instead of defaults.
  const labelIsGeneric = OVERLY_GENERIC_PATTERNS.some(re => re.test(candidate.label.trim().toLowerCase()));
  const genericEntryForSpecificQuestion = isGenericEntry(candidate) && context.condition.trim().length > 0;
  if (labelIsGeneric || genericEntryForSpecificQuestion) {
    score -= WEIGHTS.genericPenalty;
    tier = "family";
  }

  return { candidate, score, tier, matchedKeywords };
}

/** Stable ordering: score desc, then match tier, then ontology priority asc, then id asc. */
function compareScored(a: ScoredOutcome, b: ScoredOutcome): number {
  if (b.score !== a.score) return b.score - a.score;
  const tierA = TIER_RANK[a.tier];
  const tierB = TIER_RANK[b.tier];
  if (tierA !== tierB) return tierA - tierB;
  if (a.candidate.priority !== b.candidate.priority) return a.candidate.priority - b.candidate.priority;
  return a.candidate.id.localeCompare(b.candidate.id);
}

/** Tie-break only. Score remains the primary signal; see the note on slot filling. */
const TIER_RANK: Record<MatchTier, number> = {
  specific: 0,
  specialty: 1,
  keyword: 2,
  family: 3,
  generic: 4
};

/**
 * Content terms drawn from what the question actually asks about.
 *
 * These are the tokens that survive generic-measurement folding, so "reduce menstrual blood loss"
 * yields {blood, loss} while "live birth rate" yields {live, birth}. Used to prefer the outcome
 * that answers the stated question over one that merely scores well for the specialty.
 */
function comparatorIntentTokens(context: OutcomeContext): Set<string> {
  const text = [context.comparator, context.population, context.condition, context.originalInput]
    .filter(Boolean).join(" ");
  const out = new Set<string>();
  for (const token of phrases(text)) {
    const canonical = canonicalToken(token);
    if (!canonical || NON_DISTINCTING_MODIFIERS.has(canonical)) continue;
    if (/^\d+$/.test(canonical)) continue;
    out.add(canonical);
  }
  return out;
}

/**
 * True when the question itself is about comparing thresholds.
 *
 * Without this guard the selector would offer several preterm-birth thresholds on any
 * preterm-birth question, which is the "five options from one family" failure.
 */
export function questionWantsThresholdComparison(context: OutcomeContext): boolean {
  const text = [context.condition, context.population, context.intervention, context.originalInput, ...context.keywords]
    .filter(Boolean).join(" ").toLowerCase();
  if (/\bthreshold/.test(text)) return true;
  const inRange = (n: number): boolean => n > 0 && n < 45;
  const weeks = [...text.matchAll(/\b(\d{2})\s*(?:completed\s*)?(?:wks?|weeks?|w)\b/g)].map(m => Number(m[1]));
  if (new Set(weeks.filter(inRange)).size > 1) return true;
  // "before 34 versus 37 weeks" carries the unit once, at the end, so counting unit-bearing
  // numbers alone misses the comparison the clinician is actually asking for.
  const pair = text.match(/\b(\d{2})\s*(?:versus|vs\.?|or|and|compared (?:with|to))\s*(\d{2})\b/);
  return !!pair && inRange(Number(pair[1])) && inRange(Number(pair[2])) && pair[1] !== pair[2];
}

/** True when the population is a pregnancy, which is what makes neonatal outcomes relevant. */
function isPregnancyContext(context: OutcomeContext): boolean {
  const text = [context.population, context.condition, context.originalInput, ...context.keywords]
    .filter(Boolean).join(" ").toLowerCase();
  if (context.specialty === "obstetrics") return true;
  return /\b(pregnan|gestation|trimester|antenatal|maternal|foetus|fetus|neonat|newborn|preterm|labour|labor|delivery|birth)\b/.test(text);
}

// ---------------------------------------------------------------------------- rationale

/**
 * Builds the sentence shown under each option.
 *
 * It states why the outcome is relevant to this PICO and what it would be measured against. It
 * never states or implies that an intervention works, and it never introduces a population or
 * intervention that is not already in the context.
 */
export function buildRationale(candidate: OutcomeCandidate, context: OutcomeContext): string {
  if (candidate.id.startsWith("user-defined:")) {
    return "You entered this outcome, so it is carried into the question exactly as written.";
  }
  const intervention = context.intervention.trim();
  const comparator = context.comparator.trim();
  const condition = context.condition.trim();
  // The population is often just the condition restated, in which case "in <population>" reads as
  // a fragment ("in short cervix"). The comparison already carries the context, so drop it there.
  const population = context.population.trim();
  const populationClause = population && population.toLowerCase() !== condition.toLowerCase() ? population : "";

  const measuredAgainst = intervention
    ? comparator && !/^(none|no treatment|placebo|usual care)$/i.test(comparator)
      ? `when ${intervention} is compared with ${comparator}`
      : `for ${intervention}`
    : "";

  const suffix = measuredAgainst && populationClause
    ? ` It would be measured ${measuredAgainst} in ${populationClause}.`
    : measuredAgainst
      ? ` It would be measured ${measuredAgainst}.`
      : "";

  return `${candidate.rationale}${suffix}`;
}

/** PICO-specific candidate used for a free-text outcome the clinician typed. */
export function createUserDefinedOutcome(raw: string, context: OutcomeContext): OutcomeCandidate {
  const safe = stripUnsafeContent(raw).replace(/\s+/g, " ").trim().slice(0, MAX_FREE_TEXT_LENGTH);
  return {
    id: `user-defined:${outcomeSemanticKey(safe) || "custom"}`,
    label: safe,
    shortLabel: safe.length > 28 ? `${safe.slice(0, 27)}…` : safe,
    category: "clinical",
    family: `user-defined:${normalizeOutcomeLabel(safe).tokens.join(" ") || "custom"}`,
    priority: 1,
    applicableSpecialties: context.specialty ? [context.specialty] : [],
    applicableConditions: [],
    applicableInterventions: [],
    applicableQuestionTypes: [],
    keywords: [],
    rationale: "You defined this outcome, so it is carried into the question exactly as written.",
    measurable: false,
    preferredForPrimaryOutcome: false
  };
}

// ---------------------------------------------------------------------------- selection

function questionTextFor(context: OutcomeContext): string {
  const parts: string[] = [];
  if (context.condition) parts.push(context.condition);
  if (context.intervention) parts.push(context.intervention);
  if (context.comparator && !/^(none|no treatment|placebo)$/i.test(context.comparator)) {
    parts.push(`versus ${context.comparator}`);
  }
  return parts.length ? parts.join(" ") : "your clinical question";
}

/**
 * Chooses the option list: strictest layer first, widened only if it cannot fill the list.
 *
 * Layering is what keeps a specific question specific. Scoring alone would let a broadly
 * applicable patient-important outcome outrank a condition-matched one, and the clinician would be
 * offered "quality of life" for a cerclage question.
 */
export function selectOutcomes(
  context: OutcomeContext,
  options: { min?: number; max?: number; source?: OutcomeSelectionResponse["source"] } = {}
): OutcomeSelectionResponse {
  const min = Math.max(1, options.min ?? MIN_OUTCOME_OPTIONS);
  const max = Math.max(min, options.max ?? MAX_OUTCOME_OPTIONS);

  const scored = OUTCOME_ONTOLOGY.map(candidate => scoreOutcome(candidate, context)).sort(compareScored);
  const thresholdsWanted = questionWantsThresholdComparison(context);

  const acceptsQuestionType = (candidate: OutcomeCandidate): boolean =>
    !context.questionType || candidate.applicableQuestionTypes.length === 0 ||
    candidate.applicableQuestionTypes.includes(context.questionType);

  /**
   * Scope gate.
   *
   * Scoring awards a small bonus to every candidate when the specialty is unknown, which on its
   * own would let "Incidence of pre-eclampsia" answer a breast-cancer question. An outcome that
   * declares specific specialties is therefore only in scope when the specialty was recognised or
   * when the condition or intervention actually matched it. Entries with an empty specialty list
   * are universal by definition and always in scope.
   */
  const inScope = (entry: ScoredOutcome): boolean => {
    if (entry.candidate.applicableSpecialties.length === 0) return true;
    if (context.specialty && entry.candidate.applicableSpecialties.includes(context.specialty)) return true;
    return entry.tier === "specific";
  };

  const eligible = scored.filter(s => acceptsQuestionType(s.candidate) && inScope(s));
  const chosen: ScoredOutcome[] = [];
  const chosenIds = new Set<string>();
  const familiesUsed = new Map<string, number>();

  const familyAllowed = (candidate: OutcomeCandidate): boolean => {
    const seen = familiesUsed.get(candidate.family) ?? 0;
    if (seen === 0) return true;
    if (thresholdsWanted && candidate.family === THRESHOLD_EXCEPTION_FAMILY) return true;
    // Diagnostic accuracy is the one family whose members are complementary rather than
    // redundant: a test question is not answered by sensitivity alone, so capping it at one
    // left a diagnostic selection with too few options to choose between.
    const allowance = DIAGNOSTIC_FAMILY_ALLOWANCE[candidate.family] ?? 0;
    return seen < allowance;
  };

  // Slots are filled in score order, not tier order.
  //
  // Tier is only a relevance hint, and it disagrees with score: "Live birth" scores highest on an
  // IVF question (94, keyword tier) while "Implantation rate" scores lower (72, specific tier).
  // Iterating tier-first therefore filled slots from the weaker tier and then blocked the stronger
  // outcome, so the best-scoring outcome in the whole ontology was never offered at all. Ranking
  // by score and letting `compareScored` use tier as a tie-break keeps every signal consistent.
  const ranked = [...eligible].sort(compareScored);

  // One outcome per family while walking down the ranking.
  //
  // Without this the same generic patient-important endpoints won nearly every question in a
  // specialty, so sixteen different questions produced nine distinct recommendations and "Live
  // birth" appeared in six of them. The family cap is what stops one idea filling every slot;
  // relevance is still decided by the score alone.
  for (const entry of ranked) {
    if (chosen.length >= max) break;
    if (chosenIds.has(entry.candidate.id)) continue;
    if (!familyAllowed(entry.candidate)) continue;
    chosen.push(entry);
    chosenIds.add(entry.candidate.id);
    familiesUsed.set(entry.candidate.family, (familiesUsed.get(entry.candidate.family) ?? 0) + 1);
  }

  // Backfill by score if diversity left the selection short of the minimum.
  //
  // The family cap applies here too. Skipping it made this a loophole: a second outcome from an
  // already-used family could reappear through the backfill, so the deliberate-repeat allowance
  // stopped actually deciding how many accuracy measures a diagnostic question received.
  if (chosen.length < min) {
    for (const entry of ranked) {
      if (chosen.length >= min) break;
      if (chosenIds.has(entry.candidate.id)) continue;
      if (!familyAllowed(entry.candidate)) continue;
      chosen.push(entry);
      chosenIds.add(entry.candidate.id);
      familiesUsed.set(entry.candidate.family, (familiesUsed.get(entry.candidate.family) ?? 0) + 1);
    }
  }

  // Composition pass: an intervention question without a harm outcome, or a pregnancy question
  // without a neonatal outcome, is incomplete. When every slot is already filled the weakest
  // ranked option is displaced, because a missing harm or neonatal endpoint is a worse defect than
  // losing the sixth-best match.
  const pregnancy = isPregnancyContext(context);
  const wantsHarm = /therapy|prevention|harm/i.test(context.questionType || "");
  const ensureCategory = (category: OutcomeCategory): void => {
    if (chosen.some(s => s.candidate.category === category)) return;
    const add = eligible.find(e =>
      !chosenIds.has(e.candidate.id) && e.candidate.category === category && familyAllowed(e.candidate));
    if (!add) return;
    if (chosen.length >= max) {
      // `chosen` is in tier order rather than score order, so the weakest entry is found by score.
      let weakestIndex = 0;
      for (let i = 1; i < chosen.length; i++) {
        if (compareScored(chosen[i]!, chosen[weakestIndex]!) > 0) weakestIndex = i;
      }
      const [weakest] = chosen.splice(weakestIndex, 1);
      if (!weakest) return;
      chosenIds.delete(weakest.candidate.id);
      const remaining = (familiesUsed.get(weakest.candidate.family) ?? 1) - 1;
      if (remaining <= 0) familiesUsed.delete(weakest.candidate.family);
      else familiesUsed.set(weakest.candidate.family, remaining);
    }
    chosen.push(add);
    chosenIds.add(add.candidate.id);
    familiesUsed.set(add.candidate.family, (familiesUsed.get(add.candidate.family) ?? 0) + 1);
  };
  if (wantsHarm) ensureCategory("safety");
  if (pregnancy) ensureCategory("neonatal");

  chosen.sort(compareScored);
  const finalList = chosen.slice(0, max);
  const optionsOut = finalList.map(entry => ({
    ...entry.candidate,
    rationale: buildRationale(entry.candidate, context)
  }));
  const recommended = optionsOut[0] ?? {
    ...OUTCOME_ONTOLOGY[OUTCOME_ONTOLOGY.length - 1]!,
    rationale: buildRationale(OUTCOME_ONTOLOGY[OUTCOME_ONTOLOGY.length - 1]!, context)
  };

  return {
    questionText: questionTextFor(context),
    recommendedOutcome: recommended,
    options: optionsOut,
    allowFreeText: true,
    maxSelections: MAX_OUTCOME_SELECTIONS,
    source: options.source ?? "rules"
  };
}

/** Builds the selection context from an Analysis plus the answers collected so far. */
export function buildOutcomeContext(
  analysis: { specialty?: SpecialtyKey | null; condition?: string; intervention?: string; comparator?: string; questionType?: string; framework?: string } | null | undefined,
  answered: Record<string, string> | null | undefined,
  extras: { originalInput?: string; keywords?: string[]; population?: string } = {}
): OutcomeContext {
  const a = analysis ?? {};
  const ans = answered ?? {};
  const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  return {
    specialty: (a.specialty && ["infertility", "gynecology", "obstetrics"].includes(a.specialty)
      ? a.specialty
      : null) as SpecialtyKey | null,
    condition: text(ans.condition) || text(a.condition),
    population: text(extras.population) || text(ans.population) || text(ans.condition) || text(a.condition),
    intervention: text(ans.intervention) || text(a.intervention),
    comparator: text(ans.comparator) || text(a.comparator),
    questionType: text(ans.questionType) || text(a.questionType),
    framework: text(a.framework),
    originalInput: text(extras.originalInput),
    keywords: Array.isArray(extras.keywords) ? extras.keywords.filter(k => typeof k === "string" && k.trim()).map(k => k.trim()) : []
  };
}

// ---------------------------------------------------------------------------- wire schema

const outcomeCategorySchema = z.enum([
  "patient-important", "clinical", "maternal", "neonatal", "safety",
  "process", "fertility", "quality-of-life", "recurrence"
]);

const specialtyKeySchema = z.enum(["infertility", "gynecology", "obstetrics"]);

/** Strict on purpose: an unknown field means the payload came from somewhere unvetted. */
export const outcomeCandidateSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(200),
  shortLabel: z.string().min(1).max(120),
  category: outcomeCategorySchema,
  family: z.string().min(1).max(120),
  priority: z.number().finite(),
  applicableSpecialties: z.array(specialtyKeySchema).max(12),
  applicableConditions: z.array(z.string().max(120)).max(64),
  applicableInterventions: z.array(z.string().max(120)).max(64),
  applicableQuestionTypes: z.array(z.string().max(80)).max(12),
  keywords: z.array(z.string().max(80)).max(64),
  rationale: z.string().min(1).max(600),
  measurable: z.boolean(),
  preferredForPrimaryOutcome: z.boolean()
}).strict();

export const outcomeSelectionResponseSchema = z.object({
  questionText: z.string().max(600),
  recommendedOutcome: outcomeCandidateSchema,
  options: z.array(outcomeCandidateSchema).min(1).max(MAX_OUTCOME_OPTIONS + 4),
  allowFreeText: z.boolean(),
  maxSelections: z.number().int().min(1).max(3),
  source: z.enum(["rules", "ai", "hybrid"])
}).strict();

export type ParseOutcomeResult = {
  response: OutcomeSelectionResponse;
  usedFallback: boolean;
  reason?: string;
};

/**
 * Applies the structural invariants the schema cannot express on its own.
 *
 * A payload can be schema-valid and still unusable: the recommended outcome missing from
 * `options`, two entries sharing an id, or two entries that are the same outcome written twice.
 * Anything that fails here is repaired by promotion/deduplication, and only a payload that cannot
 * be repaired falls back to the deterministic selection.
 */
function repairSelection(parsed: z.infer<typeof outcomeSelectionResponseSchema>): OutcomeSelectionResponse | null {
  const byId = new Map<string, z.infer<typeof outcomeCandidateSchema>>();
  const options: z.infer<typeof outcomeCandidateSchema>[] = [];
  for (const candidate of parsed.options) {
    if (byId.has(candidate.id)) continue;
    if (options.some(existing => areNearDuplicates(existing.label, candidate.label))) continue;
    byId.set(candidate.id, candidate);
    options.push(candidate);
  }
  if (!options.length) return null;

  const recommended = byId.has(parsed.recommendedOutcome.id)
    ? parsed.recommendedOutcome
    : options[0]!;
  if (!options.some(o => o.id === recommended.id)) options.unshift(recommended);

  return {
    questionText: parsed.questionText,
    recommendedOutcome: recommended,
    options,
    allowFreeText: parsed.allowFreeText,
    maxSelections: parsed.maxSelections,
    source: parsed.source
  };
}

/**
 * Validates an untrusted payload against the shared schema.
 *
 * Returns the deterministic selection rather than a throw when the payload cannot be trusted, so
 * the caller never has to invent options of its own.
 */
export function parseOutcomeSelectionResponse(
  input: unknown,
  fallbackContext: OutcomeContext
): ParseOutcomeResult {
  const fallback = (): ParseOutcomeResult => ({
    response: selectOutcomes(fallbackContext, { source: "rules" }),
    usedFallback: true,
    reason: "schema validation failed"
  });

  const strict = outcomeSelectionResponseSchema.safeParse(input);
  if (strict.success) {
    const repaired = repairSelection(strict.data);
    if (repaired) return { response: repaired, usedFallback: false };
    return { ...fallback(), reason: "all options were duplicates" };
  }

  // Salvage pass: an LLM payload usually has the right shape with stray or missing fields, so
  // rebuild each option from the fields we recognise rather than discarding a usable list.
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const raw = input as Record<string, unknown>;
    const rawOptions = Array.isArray(raw.options) ? raw.options : [];
    const salvaged: unknown[] = [];
    for (const entry of rawOptions) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const o = entry as Record<string, unknown>;
      const label = typeof o.label === "string" ? o.label.trim() : "";
      if (!label || label.length > 200) continue;
      const base = OUTCOME_ONTOLOGY.find(c => c.id === o.id);
      salvaged.push({
        ...(base ?? {}),
        id: typeof o.id === "string" && o.id ? o.id : `llm:${outcomeSemanticKey(label)}`,
        label: stripUnsafeContent(label).slice(0, 200),
        shortLabel: typeof o.shortLabel === "string" && o.shortLabel
          ? o.shortLabel.slice(0, 120)
          : (base?.shortLabel ?? label.slice(0, 28)),
        category: outcomeCategorySchema.safeParse(o.category).success
          ? o.category
          : (base?.category ?? "clinical"),
        family: typeof o.family === "string" && o.family ? o.family : (base?.family ?? `llm:${outcomeSemanticKey(label)}`),
        priority: typeof o.priority === "number" && Number.isFinite(o.priority) ? o.priority : (base?.priority ?? 5),
        applicableSpecialties: base?.applicableSpecialties ?? [],
        applicableConditions: base?.applicableConditions ?? [],
        applicableInterventions: base?.applicableInterventions ?? [],
        applicableQuestionTypes: base?.applicableQuestionTypes ?? [],
        keywords: base?.keywords ?? [],
        rationale: typeof o.rationale === "string" && o.rationale.trim()
          ? o.rationale.trim().slice(0, 600)
          : (base?.rationale ?? "Suggested from the supplied clinical context."),
        measurable: typeof o.measurable === "boolean" ? o.measurable : (base?.measurable ?? false),
        preferredForPrimaryOutcome: typeof o.preferredForPrimaryOutcome === "boolean"
          ? o.preferredForPrimaryOutcome
          : (base?.preferredForPrimaryOutcome ?? false)
      });
    }
    const recommendedRaw = raw.recommendedOutcome;
    const recommendedId = recommendedRaw && typeof recommendedRaw === "object"
      ? (recommendedRaw as Record<string, unknown>).id
      : undefined;
    const assembled = {
      questionText: typeof raw.questionText === "string" ? raw.questionText.slice(0, 600) : questionTextFor(fallbackContext),
      recommendedOutcome: salvaged.find(s => (s as { id: string }).id === recommendedId) ?? salvaged[0],
      options: salvaged,
      allowFreeText: raw.allowFreeText === false ? false : true,
      maxSelections: typeof raw.maxSelections === "number" && raw.maxSelections >= 1 && raw.maxSelections <= 3
        ? raw.maxSelections
        : MAX_OUTCOME_SELECTIONS,
      source: raw.source === "ai" || raw.source === "hybrid" ? raw.source : "hybrid"
    };
    const salvagedParse = outcomeSelectionResponseSchema.safeParse(assembled);
    if (salvagedParse.success) {
      const repaired = repairSelection(salvagedParse.data);
      if (repaired) return { response: { ...repaired, source: "hybrid" }, usedFallback: false };
    }
  }

  return fallback();
}

// ---------------------------------------------------------------------------- advisory layer

/** Reads outcome references out of an arbitrary untrusted shape, ignoring anything unusable. */
function collectAdvisoryTokens(value: unknown, out: string[], depth = 0): void {
  if (depth > 3 || value === null || value === undefined) return;
  if (typeof value === "string") {
    if (value.trim()) out.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectAdvisoryTokens(entry, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && record.id.trim()) out.push(record.id.trim());
  for (const key of ["options", "outcomes", "recommendedOutcome", "primaryOutcome", "recommended"]) {
    if (key in record) collectAdvisoryTokens(record[key], out, depth + 1);
  }
}

function readAdvisoryRecommendation(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["recommendedOutcomeId", "recommendedOutcome", "primaryOutcome", "recommended"]) {
    const entry = record[key];
    if (typeof entry === "string" && entry.trim()) return entry.trim();
    if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).id === "string") {
      return ((entry as Record<string, unknown>).id as string).trim() || null;
    }
  }
  return null;
}

/**
 * Applies an untrusted ordering suggestion to a deterministic selection.
 *
 * The suggestion may only reorder and re-emphasise outcomes the deterministic selection already
 * produced. It cannot introduce an outcome, rename one, or alter a label, so a hallucinated id is
 * ignored rather than rendered. Matching accepts an ontology id or a label, because an LLM asked to
 * "reorder these outcomes" naturally echoes the wording it was given.
 *
 * A suggestion that names nothing usable leaves the deterministic order exactly as it was, so this
 * cannot return a worse selection than the one it was handed.
 */
export function applyOutcomeAdvisory(
  selection: OutcomeSelectionResponse,
  advisory: unknown
): OutcomeSelectionResponse {
  const tokens: string[] = [];
  collectAdvisoryTokens(advisory, tokens);

  const resolve = (token: string): OutcomeCandidate | undefined =>
    selection.options.find(o => o.id === token)
    ?? selection.options.find(o => o.label.toLowerCase() === token.toLowerCase())
    ?? selection.options.find(o => outcomeSemanticKey(o.label) === outcomeSemanticKey(token));

  const reordered: OutcomeCandidate[] = [];
  for (const token of tokens) {
    const match = resolve(token);
    if (match && !reordered.includes(match)) reordered.push(match);
  }
  if (!reordered.length) {
    return { ...selection, source: selection.source === "rules" ? "hybrid" : selection.source };
  }
  for (const option of selection.options) if (!reordered.includes(option)) reordered.push(option);

  const requested = readAdvisoryRecommendation(advisory);
  const recommended = (requested ? resolve(requested) : undefined) ?? reordered[0]!;
  return { ...selection, options: reordered, recommendedOutcome: recommended, source: "hybrid" };
}

/**
 * Validates a clinician-typed outcome.
 *
 * Returns a reason string instead of throwing so the UI can explain the refusal rather than
 * silently discarding what the user typed.
 */
export function validateFreeTextOutcome(raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  const rawText = String(raw ?? "");
  if (!rawText.trim()) return { ok: false, reason: "Enter an outcome." };
  const safe = stripUnsafeContent(rawText).replace(/\s+/g, " ").trim();
  if (!safe) return { ok: false, reason: "Enter an outcome." };
  if (safe.length > MAX_FREE_TEXT_LENGTH) {
    return { ok: false, reason: `Keep the outcome under ${MAX_FREE_TEXT_LENGTH} characters.` };
  }
  return { ok: true, value: safe };
}