import { auditRef, extractInTextCites, extractNumericCites, findKeyForCitation, type AuditableRef, type PicoElement } from "./relevance.ts";
import type { EvidenceSet } from "./evidence-set.ts";

/** One sentence of narrative prose, with the citations that were resolved for it. */
export interface FinalClaim {
  field: string;
  text: string;
  citationKeys: string[];
  supported: boolean;
  /** Why a sentence is not a supported finding, recorded so the decision is auditable. */
  reason?:
    | "no-citation"
    | "citation-not-in-evidence-set"
    | "pico-not-addressed"
    | "outcome-not-reported"
    | "direction-contradicted"
    | "not-an-assertion";
}

export interface ClaimFinalizationInput {
  /** Narrative fields to finalize, keyed by field name. */
  fields: Record<string, string>;
  evidenceSet: EvidenceSet;
  elements?: PicoElement[];
}

export interface ClaimFinalizationResult {
  fields: Record<string, string>;
  claims: FinalClaim[];
  removedClaims: string[];
  /** Sentences rewritten into explicit statements of uncertainty. */
  limitations: string[];
  warnings: string[];
}

/**
 * Words that turn a sentence into a claim about an effect.
 *
 * Background, method and limitation sentences are not claims, so they are never removed for
 * lacking a citation. A sentence is a claim when it asserts that something happened, differed or
 * should be done, which is exactly the kind of sentence a reader treats as a finding.
 */
const ASSERTION = new RegExp(
  "\\b(?:" +
    "reduc\\w*|decreas\\w*|lower(?:ed|s|ing)?|shorten\\w*|delay\\w*|" +
    "increas\\w*|rais(?:e|es|ed|ing)|higher|greater|longer|" +
    "improv\\w*|effective|efficacy|superior|inferior|benefi\\w*|" +
    "prevent\\w*|no\\s+(?:significant\\s+)?difference|" +
    "associated\\s+with|linked\\s+to|predict\\w*|" +
    "should\\s+be\\s+(?:offered|recommended|used)|is\\s+(?:safe|effective|superior)|are\\s+(?:safe|effective)" +
  ")",
  "i"
);

/** Direction an assertion claims, used to detect a source that reports the opposite. */
function assertedDirection(sentence: string): "reduction" | "increase" | "no-difference" | null {
  if (/\bno\s+(?:statistically\s+)?significant\s+difference\b/i.test(sentence)) return "no-difference";
  if (/\b(reduc\w*|decreas\w*|lower(?:ed|s)?|shorten\w*|delay\w*|prevent\w*)\b/i.test(sentence)) return "reduction";
  if (/\b(increas\w*|rais(?:e|es|ed)|higher|greater|longer)\b/i.test(sentence)) return "increase";
  return null;
}

/** Direction the source itself reports, read from its title and abstract text. */
function reportedDirection(rec: AuditableRef): "reduction" | "increase" | "no-difference" | null {
  const text = `${rec.title || ""} ${rec.context || ""}`;
  if (/\bno\s+(?:statistically\s+)?significant\s+(?:difference|effect)\b/i.test(text)) return "no-difference";
  if (/\b(did\s+not\s+(?:reduce|decrease)|failed\s+to\s+(?:reduce|decrease)|no\s+(?:reduction|benefit))\b/i.test(text)) {
    return "no-difference";
  }
  if (/\b(reduc\w*|decreas\w*|lower(?:ed|s)?|shorten\w*|delay\w*)\b/i.test(text)) return "reduction";
  if (/\b(increas\w*|rais(?:e|es|ed)|higher|greater)\b/i.test(text)) return "increase";
  return null;
}

const STOPWORDS = new RegExp(
  [
    "a|an|the|and|or|of|to|in|for|with|without|by|on|at|from|is|are|was|were|be|been|being|it|its",
    "this|that|these|those|there|their|they|we|our|us|you|your|he|she|his|her|not|no|than|then",
    "as|but|however|although|while|when|where|which|who|whom|whose|what|both|either|neither",
    "each|any|all|some|more|most|other|such|only|very|can|could|may|might|must|shall|should|will|would",
    "have|has|had|do|does|did|between|during|after|before|over|under|about|into|per|via|among",
  ].join("|"),
  "gi"
);

/** Words that describe the comparison rather than the finding. */
const COMPARISON = /\b(?:versus|vs|compared?|relative|than|group|groups|arm|arms|cohort|trial|study|studies|patients?|women|analysis|results?|data|evidence|review|meta|report)\w*/gi;

/**
 * Content words of a claim that are not part of the population, intervention or comparator.
 *
 * What is left is what the claim actually asserts about an outcome, and it is what a cited source
 * has to be shown to report. A sentence that names only the PICO vocabulary asserts no finding
 * about any particular outcome, so there is nothing for a source to support.
 */
function claimOutcomeTokens(sentence: string, elements: PicoElement[]): string[] {
  const pico = elements
    .filter(e => /population|intervention|comparator/i.test(e.label))
    .flatMap(e => String(e.value || "").toLowerCase().split(/[^a-z]+/))
    .filter(t => t.length >= 4);

  return (sentence.toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])
    .map(t => t.replace(/-/g, ""))
    .filter(t => !STOPWORDS.test(t) && !pico.includes(t) && !COMPARISON.test(t))
    .filter(t => !ASSERTION.test(t))
    .filter(t => t.length >= 4)
    // A repeated `RegExp` with `g` keeps `lastIndex`, so a fresh test is used per token.
    .filter(t => !/^(?:reduc|decreas|increas|prevent|improv|associat|linked|predict|shorten|delay|lower|higher|greater|longer|effect|efficac|superior|inferior|benefi|significant|difference|safe)/.test(t));
}

/** Loose stem overlap, so "preterm" matches "preterm" and "bleeding" matches "bleed". */
function reportsAny(text: string, tokens: string[]): boolean {
  const hay = text.toLowerCase().replace(/[^a-z]/g, "");
  return tokens.some(t => {
    const stem = t.replace(/(?:ing|ed|es|s)$/, "");
    return hay.includes(t) || (stem.length >= 5 && hay.includes(stem));
  });
}

/** A claim the sources contradict is not supported by them, so it is not retained. */
function directionSupportsClaim(sentence: string, rec: AuditableRef): boolean {
  const claimed = assertedDirection(sentence);
  if (!claimed) return true;
  const reported = reportedDirection(rec);
  if (!reported) return true;
  // A source that reports no difference cannot support a sentence asserting a difference.
  if (claimed === "no-difference") return reported === "no-difference";
  return reported === claimed;
}

const LIMITATION =
  "Direct evidence supporting this statement was not identified in the retained sources, " +
  "so it is reported here as an unresolved uncertainty rather than a finding.";

/**
 * Abbreviations whose trailing period does not end a sentence.
 *
 * The damaging member of this list is `et al.`: a naive boundary rule splits `(Smith et al. 2020)`
 * in half, leaving `... agree (Smith et al.` as one sentence and the orphaned `2020).` as the next.
 * Neither half contains a citation, so `extractInTextCites` finds nothing and `finalizeClaims`
 * judges the surrounding prose uncited and rewrites it into the uncertainty boilerplate. On a real
 * AI commentary this produced 17 stripped claims, seven repetitions of the same boilerplate
 * sentence in one paragraph, and stray `2026).` fragments left standing in the published text.
 */
const ABBREVIATION =
  /\b(?:et\s+al|e\.g|i\.e|cf|vs|Fig|Figs|Tab|No|Dr|Prof|Mr|Mrs|Ms|St|Jr|Sr|approx)\.(?=\s|$)/gi;

/**
 * Author initials. `(Agustin Conde Agudelo and Roberto J. Romero 2015)` was split at the period in
 * `J.`, stranding `Romero 2015).` as its own citation-less sentence, so the surrounding prose was
 * rewritten and the fragment was published in the final text.
 */
const AUTHOR_INITIAL = /\b[A-Z]\.(?=\s)/g;

/**
 * Sentence splitting that does not cut on a decimal point, a citation bracket or an abbreviation.
 */
export function splitSentences(text: string): string[] {
  // Mask abbreviation periods before splitting and restore them afterwards. Splitting first would
  // leave the fragments unrecoverable, because the boundary that cut the citation in half is
  // indistinguishable from a real sentence end once the text has been split.
  const abbreviations: string[] = [];
  const mask = (match: string) => {
    abbreviations.push(match);
    return `\u0000${abbreviations.length - 1}\u0000`;
  };
  const masked = String(text ?? "")
    .replace(ABBREVIATION, mask)
    .replace(AUTHOR_INITIAL, mask);

  return masked
    .split(/(?<=[.!?])["')\]]?\s+(?=[A-Z0-9"“(])/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => abbreviations[Number(i)] ?? ""));
}

/**
 * Deterministic claim-level finalization.
 *
 * A citation proves only that a paper exists, not that it supports the sentence citing it. This
 * step therefore judges each sentence on its own: a sentence that asserts an effect is kept only
 * when at least one cited retained record addresses the population, the intervention or
 * comparator and the outcome, and no cited record reports the opposite direction. A strong
 * sentence whose citation does not survive is rewritten into an explicit statement of
 * uncertainty rather than left standing as a finding with its attribution removed, which would
 * present an unsupported assertion as though it were established.
 */
export function finalizeClaims(input: ClaimFinalizationInput): ClaimFinalizationResult {
  const elements = input.elements ?? [];
  const claims: FinalClaim[] = [];
  const removedClaims: string[] = [];
  const limitations: string[] = [];
  const warnings: string[] = [];
  const fields: Record<string, string> = {};

  for (const [field, raw] of Object.entries(input.fields)) {
    const kept: string[] = [];
    for (const sentence of splitSentences(String(raw ?? ""))) {
      const cites = extractInTextCites(sentence);
      const { citedNumbers } = extractNumericCites(sentence);
      const citationKeys: string[] = [];
      let unresolved = false;
      const records: AuditableRef[] = [];

      for (const c of cites) {
        const key = findKeyForCitation(c.author, c.year, input.evidenceSet.citationMap);
        if (!key || !input.evidenceSet.allowedCitationKeys.has(key)) {
          unresolved = true;
          continue;
        }
        if (!citationKeys.includes(key)) citationKeys.push(key);
        const rec = input.evidenceSet.citationMap.get(key);
        if (rec) records.push(rec as AuditableRef);
      }

      for (const num of citedNumbers) {
        const idx = num - 1;
        const rec = input.evidenceSet.retainedRecords[idx];
        if (rec) {
          const rawKey = rec.doi ? `doi:${rec.doi.toLowerCase()}` : rec.pmid ? `pmid:${rec.pmid}` : "";
          const foundKey = (rawKey && input.evidenceSet.allowedCitationKeys.has(rawKey))
            ? rawKey
            : Array.from(input.evidenceSet.allowedCitationKeys)[idx];
          if (foundKey) {
            if (!citationKeys.includes(foundKey)) citationKeys.push(foundKey);
            records.push(rec as AuditableRef);
          } else {
            citationKeys.push(`ref:${num}`);
            records.push(rec as AuditableRef);
          }
        } else {
          unresolved = true;
        }
      }

      if (!ASSERTION.test(sentence)) {
        // Background and method prose is not a finding, so it is retained as written.
        claims.push({ field, text: sentence, citationKeys, supported: false, reason: "not-an-assertion" });
        kept.push(sentence);
        continue;
      }

      const addressed = records.filter(r => {
        const audit = auditRef(r, elements);
        return !!(audit.population && (audit.intervention || audit.comparator) && audit.outcome);
      });
      const tokens = claimOutcomeTokens(sentence, elements);
      // A source has to report what the sentence asserts. A sentence that only restates the PICO
      // vocabulary asserts nothing about an outcome, so nothing is required of the source.
      const reportsOutcome = (r: AuditableRef) =>
        !tokens.length || reportsAny(`${r.title || ""} ${r.context || ""}`, tokens);
      const onTopic = addressed.filter(r => reportsOutcome(r));
      const consistent = onTopic.filter(r => directionSupportsClaim(sentence, r));

      let reason: FinalClaim["reason"];
      if (!cites.length && !citedNumbers.size) reason = "no-citation";
      else if (unresolved || !records.length) reason = "citation-not-in-evidence-set";
      else if (!addressed.length) reason = "pico-not-addressed";
      else if (!onTopic.length) reason = "outcome-not-reported";
      else if (!consistent.length) reason = "direction-contradicted";
      else reason = undefined;

      if (!reason) {
        claims.push({ field, text: sentence, citationKeys, supported: true });
        kept.push(sentence);
        continue;
      }

      removedClaims.push(sentence);
      warnings.push(`Unsupported claim removed from ${field}: ${reason}`);
      claims.push({ field, text: sentence, citationKeys, supported: false, reason });
      // Several consecutive unsupported sentences in one field all map to the same boilerplate.
      // Pushing it for each of them produced a paragraph that repeated the identical 33-word
      // sentence up to seven times, which reads as a rendering fault and buries the surviving
      // content. The claims and warnings still record every removal; only the duplicated prose is
      // collapsed, and only when it is directly adjacent.
      if (kept[kept.length - 1] !== LIMITATION) {
        kept.push(LIMITATION);
        limitations.push(LIMITATION);
      }
    }
    fields[field] = kept.join(" ").replace(/\s{2,}/g, " ").trim();
  }

  return { fields, claims, removedClaims, limitations, warnings };
}
