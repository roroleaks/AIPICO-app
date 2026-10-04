import { formatReference, refSurnameYear, type PicoElement } from "./relevance.ts";
import type { AuditableRef } from "./relevance.ts";

export interface DeterministicCommentaryInput {
  selectedQuestion: string;
  outcomesText: string;
  /** Why no model synthesis was produced, phrased for the reader. */
  reason: string;
  pool: AuditableRef[];
  elements: PicoElement[];
}

/**
 * Deterministic commentary used when the AI writing service is unavailable: either no provider key
 * is configured (audit F-19, F-23) or the provider failed mid-request.
 *
 * This exists because `if (!KEY) return 503` in the engine route made the pre-existing fallback
 * unreachable in exactly the situation it was written for. Retrieval, claim filtering, evidence
 * set construction and citation integrity all work without a model, so failing the whole stage
 * discarded a result the deterministic core could already produce.
 *
 * The previous version of this function was worse than useless in a clinical tool, and every part
 * of it was wrong in the same direction: it asserted a finding it never read ("supports the
 * evaluated comparison"), it listed up to eight references while citing only the first, and it
 * hardcoded `keywords: ["short cervix", "progesterone", "cerclage", "preterm birth"]` regardless of
 * the question. Shipping that to a clinician would have presented fabricated synthesis as evidence.
 *
 * So this version does the only thing it can do honestly: describe the retrieval, cite every record
 * it lists, and state plainly that no narrative synthesis was performed and why. Nothing here
 * asserts a clinical finding, which is what lets `finalizeClaims` and `validateDeliverableIntegrity`
 * pass without rewriting the text into uncertainty boilerplate.
 *
 * References are emitted through `formatReference` - the same formatter used for the published
 * bibliography - so `resolveReference` matches them and authoritative source metadata is preserved
 * instead of the model recalling it.
 */
export function generateDeterministicCommentary(
  opts: DeterministicCommentaryInput
): Record<string, unknown> {
  const pool = opts.pool.slice(0, 8);
  const question = opts.selectedQuestion.trim() || "the selected clinical question";
  const outcomesText = opts.outcomesText.trim() || "the selected outcome";

  // Only records that carry a resolvable surname and year can ever be cited: `checkCitations`
  // discards a reference with no year, so listing one would guarantee an "uncited reference"
  // finding and fail the integrity gate. Such a record is dropped from the bibliography rather than
  // published as an unverifiable entry.
  //
  // The citation token is derived from the FORMATTED reference, not from `rec.authors`. That
  // distinction matters: `surnamesOf` and `refSurnameYear` parse a full reference string and read
  // the name head before the first year, so passing a bare author list ("Owen C, Greiner K")
  // returns nothing at all - which is how the first version of this function emitted empty tokens
  // and dropped every reference on the floor.
  const entries = pool
    .map(r => {
      const formatted = formatReference(r);
      const parsed = refSurnameYear(formatted);
      return { formatted, surname: parsed?.surname || "", year: parsed?.year || "" };
    })
    .filter(e => e.surname && e.year);
  const refs = entries.map(e => e.formatted);
  const cites = entries.map(e => ({ surname: e.surname, year: e.year, token: `(${e.surname} ${e.year})` }));

  // Keywords come from this question's own inputs, as phrases. The old hardcoded list meant every
  // question about anything other than cervical insufficiency was published with progesterone and
  // cerclage as its keywords; splitting on whitespace instead of phrase boundaries would just
  // replace one wrong list with "short", "cervix" and "Vaginal".
  const STOP = new Set([
    "the", "and", "for", "with", "does", "what", "which", "that", "this", "from", "into", "vs",
    "patients", "women", "study", "studies", "versus", "among", "their", "there", "been", "are",
    "was", "were", "who", "how", "than", "then", "when", "while", "have", "has", "had", "but", "not",
    "you", "your", "our", "its", "his", "her", "can", "will", "would", "should", "could", "may"
  ]);
  // Question verbs and comparators. These survive the word-level fallback below and turn a
  // keyword list into "compared, improve" - accurate English, useless as a search term, and a
  // visible sign that the fallback ran on a question the phrase path could not parse.
  const QUESTION_VERB = /^(compare[ds]?|comparing|improv(e|es|ed|ing|ement)|reduc(e|es|ed|ing|tion)|increas(e|es|ed|ing)|decreas(e|es|ed|ing)|prevent(s|ed|ing|ion)?|affect(s|ed|ing)?|influence[ds]?|chang(e|es|ed|ing)|effect(s|ed)?|benefit(s|ed)?|outcome[s]?|result(s|ed)?|risk[s]?|safe|safety)$/i;
  const keywords: string[] = [];
  const addKeyword = (raw: string) => {
    const w = raw.replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
    if (w.length < 4 || w.length > 60) return;
    if (STOP.has(w.toLowerCase())) return;
    if (QUESTION_VERB.test(w)) return;
    if (keywords.some(k => k.toLowerCase() === w.toLowerCase())) return;
    keywords.push(w);
  };
  const PHRASE_SPLIT = /[,;()]| compared with | versus | vs\.? | and | in patients with | in women with /i;
  for (const phrase of [...opts.elements.map(e => e.value), outcomesText]) {
    if (keywords.length >= 6) break;
    for (const part of String(phrase || "").split(PHRASE_SPLIT)) addKeyword(part);
  }
  if (keywords.length < 3) {
    // Thin PICO: fall back to the significant words of the question itself.
    for (const w of question.split(/[^A-Za-z0-9-]+/)) {
      if (keywords.length >= 6) break;
      if (w.length < 4 || w.length > 40 || STOP.has(w.toLowerCase())) continue;
      addKeyword(w);
    }
  }
  const keywordList = keywords.slice(0, 6);

  const unavailable =
    `A narrative synthesis could not be generated because ${opts.reason}. ` +
    `The records below were retrieved and retained by the claim filter, and each is cited, but no ` +
    `interpretation of their findings has been produced. Treat this as an evidence list, not as a ` +
    `review, and re-run the commentary when the writing service is available.`;

  const listed = cites.map(c => c.token).join(", ");
  const first = cites[0];
  // Count `entries`, not `pool`: a record without a resolvable citation is deliberately not
  // published, so the narrative must not claim to have cited it.
  const n = entries.length;
  const plural = n === 1;

  // Restating the research question names clinical concepts ("short cervix", "progesterone"), so
  // `finalizeClaims` treats it as an assertive claim and replaces the sentence with an uncertainty
  // notice unless that same sentence carries a citation. The retained records are exactly the
  // evidence for this question, so naming them here is accurate rather than a workaround.
  //
  // The citations have to sit INSIDE the question's own sentence: the question ends in "?", which
  // `finalizeClaims` treats as a sentence boundary, so appending them after it strands them in a
  // separate fragment and the claim is still judged uncited and rewritten.
  const framed = n
    ? `The cited records ${listed} address the following question: `
    : `The question addressed is: `;

  return {
    title: `Evidence summary: ${question.length > 110 ? question.slice(0, 107).replace(/\s+\S*$/, "") + "…" : question}`,
    abstract:
      `Background: ${framed}${question} Methods: Records were ` +
      `retrieved and filtered for claim relevance against the specified PICO elements; ${n} record${plural ? "" : "s"} ` +
      `${plural ? "was" : "were"} retained for ${outcomesText}. Results: ` +
      `${unavailable} Conclusion: No evidence synthesis is presented in this response.`,
    keywords: keywordList,
    introduction:
      `${framed}${question} The intended outcomes were ${outcomesText}. ` +
      `The evidence base below was assembled deterministically and is listed in full, with no ` +
      `interpretation attached to it.`,
    discussion: n
      ? `${n} record${plural ? "" : "s"} address${plural ? "es" : ""} ` +
        `the selected population, intervention and outcome, and ${plural ? "is" : "are"} ` +
        `cited here without further comment: ${listed}. ${unavailable}`
      : `No records with a verifiable citation were retained for ${outcomesText}. ${unavailable}`,
    conclusion: n
      ? `The evidence base for this question comprises the ${n} cited record${plural ? "" : "s"} above` +
        (first ? `, beginning with ${first.token}` : "") +
        `. No conclusion about their findings is drawn in this response.`
      : `No supporting records were retained for this question.`,
    references: refs
  };
}
